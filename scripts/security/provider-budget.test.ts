import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerBudgetConfig, ProviderBudgetError, providerBudgetResponse, reserveProviderAttempt, releaseProviderAttempt, withProviderBudget } from '../../src/lib/provider-budget';

import { memoryBudgetDb } from './provider-budget-fixture';

const config = () => {
  const value = providerBudgetConfig({});
  value.project = {hourly: 100, daily: 100, concurrency: 50};
  value.gemini = {enabled: true, hourly: 100, daily: 100, concurrency: 50};
  value.saleshandy = {enabled: true, hourly: 100, daily: 100, concurrency: 50};
  return value;
};
const denied = (reason: ProviderBudgetError['reason'], status = 429) => (error: unknown) => error instanceof ProviderBudgetError && error.reason === reason && error.status === status;

test('defaults protect all providers; invalid explicit config and kill switches fail closed', async () => {
  assert.deepEqual(providerBudgetConfig({}).project, {hourly: 200, daily: 1000, concurrency: 5});
  for (const value of ['', '0', '-1', '1.5', '1e3', 'no', '1000001']) assert.throws(() => providerBudgetConfig({PROVIDER_BUDGET_PROJECT_HOURLY: value}), denied('configuration', 503));
  assert.throws(() => providerBudgetConfig({GEMINI_WORK_ENABLED: 'yes'}), denied('configuration', 503));
  for (const key of ['PROVIDER_WORK_ENABLED', 'GEMINI_WORK_ENABLED']) {
    const f = memoryBudgetDb();
    await assert.rejects(withProviderBudget(f.db, 'dm', async () => assert.fail('paid work'), 1, {config: () => providerBudgetConfig({[key]: 'false'})}), denied('disabled', 503));
    assert.equal(f.values.size, 0);
  }
});

test('atomic shared project quota cannot be bypassed by concurrent submissions or different providers', async () => {
  const f = memoryBudgetDb(); const limits = config(); limits.project.hourly = 3;
  const outcomes = await Promise.allSettled(Array.from({length: 20}, (_, i) => reserveProviderAttempt(f.db, i % 2 ? 'dm' : 'enrichment', 1, {config: () => limits})));
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 3);
  assert.equal(outcomes.filter(result => result.status === 'rejected' && denied('quota')(result.reason)).length, 17);
  assert.equal(Math.max(...f.units() as number[]), 3);
});

test('global and provider concurrency reject without charging; owned release frees shared slot', async () => {
  const f = memoryBudgetDb(); const limits = config(); limits.project.concurrency = 2; limits.gemini.concurrency = 1;
  const first = await reserveProviderAttempt(f.db, 'dm', 1, {config: () => limits});
  await assert.rejects(reserveProviderAttempt(f.db, 'resume', 1, {config: () => limits}), denied('concurrency'));
  const second = await reserveProviderAttempt(f.db, 'enrichment', 1, {config: () => limits});
  const before = f.units();
  await assert.rejects(reserveProviderAttempt(f.db, 'enrichment', 1, {config: () => limits}), denied('concurrency'));
  assert.deepEqual(f.units(), before);
  await releaseProviderAttempt(f.db, first);
  await reserveProviderAttempt(f.db, 'dm', 1, {config: () => limits});
  await releaseProviderAttempt(f.db, second);
});

test('resume uses five units; enrichment charges every founder and project totals combine providers', async () => {
  const f = memoryBudgetDb(); const options = {config};
  await withProviderBudget(f.db, 'dm', async () => 'dm', 1, options);
  await withProviderBudget(f.db, 'resume', async () => 'resume', 1, options);
  await withProviderBudget(f.db, 'enrichment', async () => 'contacts', 4, options);
  assert.deepEqual(f.units().sort((a, b) => Number(a) - Number(b)), [4, 4, 6, 6, 10, 10]);
});

test('hour/day resets are independent, failures stay charged, and Retry-After covers denied windows', async () => {
  const f = memoryBudgetDb(); const limits = config(); limits.project.hourly = 1; limits.project.daily = 2;
  let now = Date.now(); const options = {config: () => limits, clock: () => now};
  await assert.rejects(withProviderBudget(f.db, 'dm', async () => {throw new Error('ambiguous');}, 1, options), /ambiguous/);
  await assert.rejects(reserveProviderAttempt(f.db, 'dm', 1, options), (error: unknown) => denied('quota')(error) && (error as ProviderBudgetError).retryAfterSeconds === 3600);
  now += 3_600_000;
  await withProviderBudget(f.db, 'dm', async () => {}, 1, options);
  now += 3_600_000;
  await assert.rejects(reserveProviderAttempt(f.db, 'dm', 1, options), (error: unknown) => denied('quota')(error) && (error as ProviderBudgetError).retryAfterSeconds === 79_200);
  now += 86_400_000;
  await reserveProviderAttempt(f.db, 'dm', 1, options);
});

test('crashed leases expire and stale release cannot remove the replacement owner', async () => {
  const f = memoryBudgetDb(); const limits = config(); limits.project.concurrency = 1;
  let now = Date.now(); const options = {config: () => limits, clock: () => now};
  const first = await reserveProviderAttempt(f.db, 'dm', 1, options);
  now += 120_001;
  await reserveProviderAttempt(f.db, 'dm', 1, options);
  await releaseProviderAttempt(f.db, first);
  await assert.rejects(reserveProviderAttempt(f.db, 'dm', 1, options), denied('concurrency'));
});

test('storage/config failures do not call paid work; failed release preserves result and charged units', async () => {
  const f = memoryBudgetDb(); f.down();
  await assert.rejects(withProviderBudget(f.db, 'dm', async () => assert.fail('provider called'), 1, {config}), denied('storage', 503));
  f.down(false);
  assert.equal(await withProviderBudget(f.db, 'dm', async () => {f.down(); return 'accepted';}, 1, {config}), 'accepted');
  assert.deepEqual(f.units(), [1, 1, 1, 1]);
  f.down(false);
  const anyQuota = [...f.values.keys()].find(path => path.startsWith('apiQuota/'))!;
  f.values.set(anyQuota, {startsAt: 'broken', units: 0});
  await assert.rejects(reserveProviderAttempt(f.db, 'dm', 1, {config}), denied('storage', 503));
});

test('deadline guard rejects delayed pre-submit IO before paid work can start', async () => {
  const f = memoryBudgetDb(); let now = Date.now(); let paid = false;
  await assert.rejects(withProviderBudget(f.db, 'enrichment', async assertFresh => {
    now += 120_001; // durable intent write took longer than the lease
    assertFresh(); paid = true;
  }, 1, {config, clock: () => now}), denied('concurrency', 503));
  assert.equal(paid, false);
});

test('safe response has typed status, bounded guidance and no internal provider data', async () => {
  const response = providerBudgetResponse(new ProviderBudgetError(429, 'quota', 3600))!;
  assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '3600');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), {error: 'Paid provider work is temporarily unavailable. Please try again later.', code: 'PROVIDER_LIMIT'});
  assert.equal(providerBudgetResponse(new Error('secret')), null);
});


test('provider-specific windows still deny when project budget has room', async () => {
  const f = memoryBudgetDb(); const limits = config(); limits.gemini.hourly = 1;
  await withProviderBudget(f.db, 'dm', async () => {}, 1, {config: () => limits});
  await assert.rejects(reserveProviderAttempt(f.db, 'dm', 1, {config: () => limits}), denied('quota'));
  await withProviderBudget(f.db, 'enrichment', async () => {}, 1, {config: () => limits});
  assert.deepEqual(f.units().sort((a, b) => Number(a) - Number(b)), [1, 1, 1, 1, 2, 2]);
});

test('corrupt lease state blocks admission and retry guidance is bounded', async () => {
  const f = memoryBudgetDb(); const lease = await reserveProviderAttempt(f.db, 'dm', 1, {config});
  await releaseProviderAttempt(f.db, lease);
  const path = [...f.values.keys()].find(path => path.startsWith('apiLeases/'))!;
  f.values.set(path, {slots: [{token: '', expiresAt: Date.now() + 1000}]});
  await assert.rejects(reserveProviderAttempt(f.db, 'dm', 1, {config}), denied('storage', 503));
  assert.equal(new ProviderBudgetError(429, 'quota', Infinity).retryAfterSeconds, 30);
  assert.equal(new ProviderBudgetError(429, 'quota', 1e9).retryAfterSeconds, 86400);
});

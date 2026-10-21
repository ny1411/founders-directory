import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnrichmentHandlers, type EnrichmentJob } from './enrichment-handler';
import { saleshandyRequest } from './saleshandy';

function fixture() {
  let starts = 0;
  let allowed = true;
  let authorized = true;
  let captured: string[] = [];
  const jobs = new Map<string, {founderIds: string[]; companySlug: string; job: {jobId: string; status: string}}>();
  const handlers = createEnrichmentHandlers({
    verify: async () => ({uid: 'owner'}),
    quota: async () => ({allowed, retryAfterSeconds: 40}),
    authorize: async () => authorized,
    start: async (_uid, ids, slug, key) => {
      captured = ids;
      const existing = jobs.get(key);
      if (existing && (existing.companySlug !== slug || existing.founderIds.length !== ids.length || existing.founderIds.some((id, index) => id !== ids[index]))) return {conflict: true as const};
      if (!existing) { starts++; jobs.set(key, {founderIds: ids, companySlug: slug, job: {jobId: 'a'.repeat(64), status: 'queued'}}); }
      return jobs.get(key)!.job;
    },
    status: async () => null,
  });
  return {handlers, starts: () => starts, ids: () => captured, deny: () => {allowed = false;}, forbid: () => {authorized = false;}};
}
const request = (body: unknown = {founderIds: ['one'], companySlug: 'company'}, headers = {}) => new Request('http://localhost/api/enrich-contact', {method: 'POST', headers: {authorization: 'Bearer test', 'idempotency-key': 'retry-key-1234', ...headers}, body: JSON.stringify(body)});
test('anonymous enrichment never reaches expensive work', async () => {
  const f = fixture();
  assert.equal((await f.handlers.POST(request(undefined, {authorization: ''}))).status, 401);
  assert.equal(f.starts(), 0);
});
test('durable quota denial includes retry-after', async () => {
  const f = fixture(); f.deny();
  const response = await f.handlers.POST(request());
  assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '40'); assert.equal(f.starts(), 0);
});
test('bounds raw batch count and validates before any target reads', async () => {
  const f = fixture();
  assert.equal((await f.handlers.POST(request({founderIds: Array(6).fill('one'), companySlug: 'company'}))).status, 400);
  assert.equal((await f.handlers.POST(request({founderIds: ['../private'], companySlug: 'company'}))).status, 400);
  assert.equal(f.starts(), 0);
});
test('deduplicates IDs and idempotent retries return same job', async () => {
  const f = fixture();
  assert.equal((await f.handlers.POST(request({founderIds: ['two', 'one', 'one'], companySlug: 'company'}))).status, 202);
  assert.deepEqual(f.ids(), ['one', 'two']);
  assert.equal((await f.handlers.POST(request({founderIds: ['one', 'two'], companySlug: 'company'}))).status, 202);
  assert.equal(f.starts(), 1);
});
test('reusing an idempotency key with different input cannot start more paid work', async () => {
  const f = fixture();
  assert.equal((await f.handlers.POST(request())).status, 202);
  const conflict = await f.handlers.POST(request({founderIds: ['two'], companySlug: 'company'}));
  assert.equal(conflict.status, 409);
  assert.match((await conflict.json()).error, /idempotency key/i);
  assert.equal(f.starts(), 1);
});
test('unauthorized targets and foreign jobs cannot be read', async () => {
  const f = fixture(); f.forbid();
  assert.equal((await f.handlers.POST(request())).status, 404);
  assert.equal((await f.handlers.GET(request(), 'a'.repeat(64))).status, 404);
});
test('streamed oversized body is bounded', async () => {
  const f = fixture();
  assert.equal((await f.handlers.POST(request({founderIds: ['one'], companySlug: 'x'.repeat(5000)}))).status, 400);
  assert.equal(f.starts(), 0);
});
test('quota-store failure fails closed and private results are no-store', async () => {
  const base = {verify: async () => ({uid: 'owner'}), authorize: async () => true, start: async () => null, status: async () => ({uid: 'owner', status: 'completed', expiresAt: Date.now() + 1000, results: [{workEmail: 'private@example.com'}]} as EnrichmentJob)};
  const handlers = createEnrichmentHandlers({...base, quota: async () => {throw Error('offline');}});
  assert.equal((await handlers.POST(request())).status, 503);
  const read = createEnrichmentHandlers({...base, quota: async () => ({allowed: true, retryAfterSeconds: 1})});
  assert.equal((await read.GET(request(), 'a'.repeat(64))).headers.get('cache-control'), 'private, no-store');
});
test('provider calls have explicit timeout and ambiguous paid failures are surfaced', async () => {
  process.env.SALESHANDY_API_KEY = 'test-not-a-real-key';
  process.env.SALESHANDY_BASE_URL = 'https://example.invalid/v1';
  let attempts = 0;
  await assert.rejects(saleshandyRequest('/enrich/contact', {method: 'POST'}, async (_url, init) => {
    attempts++; assert.ok(init?.signal); throw new DOMException('timeout', 'TimeoutError');
  }), {name: 'TimeoutError'});
  assert.equal(attempts, 1);
});


test('authenticated terminal pre-submission denial returns explicit retry-safe code and Retry-After', async () => {
  for (const status of [429, 503] as const) {
    const handlers = createEnrichmentHandlers({
      verify: async () => ({uid: 'owner'}), quota: async () => ({allowed: true, retryAfterSeconds: 0}),
      authorize: async () => true, start: async () => null,
      status: async () => ({status: 'failed', reason: 'PROVIDER_BUDGET_REJECTED', providerBudgetStatus: status, retryAfterSeconds: 120, expiresAt: Date.now() + 1000} as EnrichmentJob),
    });
    const response = await handlers.GET(request(), 'a'.repeat(64));
    assert.equal(response.status, status); assert.equal(response.headers.get('retry-after'), '120');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const body = await response.json(); assert.equal(body.code, 'PROVIDER_BUDGET_REJECTED'); assert.match(body.error, /120 seconds/);
  }
});

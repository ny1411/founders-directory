import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { hashIdentity } from './rate-limit';

export type PaidOperation = 'dm' | 'resume' | 'enrichment';
type Provider = 'gemini' | 'saleshandy';
type Limits = { hourly: number; daily: number; concurrency: number };
export type ProviderBudgetConfig = { enabled: boolean; project: Limits; gemini: Limits & { enabled: boolean }; saleshandy: Limits & { enabled: boolean } };
const LEASE_MS = 120_000;
const TTL_MS = 86_400_000;
const operationProvider: Record<PaidOperation, Provider> = { dm: 'gemini', resume: 'gemini', enrichment: 'saleshandy' };

export class ProviderBudgetError extends Error {
  readonly retryAfterSeconds: number;
  constructor(readonly status: 429 | 503, readonly reason: 'quota' | 'concurrency' | 'disabled' | 'configuration' | 'storage', retryAfterSeconds: number) {
    super('Paid provider work is temporarily unavailable. Please try again later.');
    this.retryAfterSeconds = Math.min(86_400, Math.max(1, Math.ceil(Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 30)));
  }
}

function integer(env: Record<string, string | undefined>, key: string, fallback: number, maximum = 1_000_000) {
  const value = env[key];
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum) throw new ProviderBudgetError(503, 'configuration', 60);
  return Number(value);
}
function enabled(env: Record<string, string | undefined>, key: string) {
  if (env[key] === undefined || env[key] === 'true') return true;
  if (env[key] === 'false') return false;
  throw new ProviderBudgetError(503, 'configuration', 60);
}
export function providerBudgetConfig(env: Record<string, string | undefined> = process.env): ProviderBudgetConfig {
  const limits = (scope: string, defaults: Limits): Limits => ({
    hourly: integer(env, `PROVIDER_BUDGET_${scope}_HOURLY`, defaults.hourly),
    daily: integer(env, `PROVIDER_BUDGET_${scope}_DAILY`, defaults.daily),
    concurrency: integer(env, `PROVIDER_BUDGET_${scope}_CONCURRENCY`, defaults.concurrency, 100),
  });
  return {
    enabled: enabled(env, 'PROVIDER_WORK_ENABLED'),
    project: limits('PROJECT', { hourly: 200, daily: 1000, concurrency: 5 }),
    gemini: { ...limits('GEMINI', { hourly: 150, daily: 750, concurrency: 4 }), enabled: enabled(env, 'GEMINI_WORK_ENABLED') },
    saleshandy: { ...limits('SALESHANDY', { hourly: 50, daily: 250, concurrency: 2 }), enabled: enabled(env, 'SALESHANDY_WORK_ENABLED') },
  };
}

type Slot = { token: string; expiresAt: number };
type Lease = { token: string; provider: Provider; expiresAt: number };
type BudgetOptions = { config?: () => ProviderBudgetConfig; clock?: () => number };
const quotaRef = (db: Firestore, scope: string) => db.collection('apiQuota').doc(hashIdentity(`provider-budget:v1:${scope}`));
const leaseRef = (db: Firestore, scope: string) => db.collection('apiLeases').doc(hashIdentity(`provider-budget:v1:${scope}`));

function activeSlots(value: unknown, now: number): Slot[] {
  if (!Array.isArray(value) || value.length > 100 || value.some(slot => !slot || typeof slot.token !== 'string' || !slot.token.length || slot.token.length > 100 || !Number.isSafeInteger(slot.expiresAt) || slot.expiresAt < 0)) throw new Error('Invalid provider lease state');
  return value.filter(slot => slot.expiresAt > now);
}

export async function reserveProviderAttempt(db: Firestore, operation: PaidOperation, enrichmentUnits = 1, options: BudgetOptions = {}): Promise<Lease> {
  const provider = operationProvider[operation];
  if (!provider || !Number.isInteger(enrichmentUnits) || enrichmentUnits < 1 || enrichmentUnits > 5) throw new ProviderBudgetError(503, 'configuration', 60);
  const units = operation === 'resume' ? 5 : operation === 'enrichment' ? enrichmentUnits : 1;
  let config: ProviderBudgetConfig;
  try { config = (options.config ?? providerBudgetConfig)(); }
  catch (error) { throw error instanceof ProviderBudgetError ? error : new ProviderBudgetError(503, 'configuration', 60); }
  if (!config.enabled || !config[provider].enabled) throw new ProviderBudgetError(503, 'disabled', 60);
  const limits = [
    { scope: 'project:hour', maximum: config.project.hourly, duration: 3_600_000 },
    { scope: 'project:day', maximum: config.project.daily, duration: 86_400_000 },
    { scope: `${provider}:hour`, maximum: config[provider].hourly, duration: 3_600_000 },
    { scope: `${provider}:day`, maximum: config[provider].daily, duration: 86_400_000 },
  ];
  const quotas = limits.map(limit => quotaRef(db, limit.scope));
  const leases = [leaseRef(db, 'project:active'), leaseRef(db, `${provider}:active`)];
  try {
    return await db.runTransaction(async transaction => {
      const snapshots = await transaction.getAll(...quotas, ...leases);
      const now = (options.clock ?? Date.now)();
      const windows = limits.map((limit, i) => {
        const previous = snapshots[i].data();
        if (previous && (!Number.isSafeInteger(previous.startsAt) || previous.startsAt < 0 || !Number.isSafeInteger(previous.units) || previous.units < 0)) throw new Error('Invalid provider quota state');
        const startsAt = previous && previous.startsAt + limit.duration > now ? previous.startsAt as number : now;
        const used = startsAt === previous?.startsAt ? previous!.units as number : 0;
        return { startsAt, used, retry: Math.max(1, Math.ceil((startsAt + limit.duration - now) / 1000)) };
      });
      const denied = windows.filter((window, i) => window.used + units > limits[i].maximum);
      if (denied.length) throw new ProviderBudgetError(429, 'quota', Math.max(...denied.map(window => window.retry)));
      const active = leases.map((_, i) => {
        const data = snapshots[quotas.length + i].data();
        return data ? activeSlots(data.slots, now) : [];
      });
      const capacities = [config.project.concurrency, config[provider].concurrency];
      const busy = active.filter((slots, i) => slots.length >= capacities[i]);
      if (busy.length) throw new ProviderBudgetError(429, 'concurrency', Math.max(1, Math.ceil((Math.min(...busy.flat().map(slot => slot.expiresAt)) - now) / 1000)));
      const token = randomUUID();
      windows.forEach((window, i) => transaction.set(quotas[i], { startsAt: window.startsAt, units: window.used + units, deleteAfter: new Date(window.startsAt + limits[i].duration + TTL_MS) }));
      active.forEach((slots, i) => transaction.set(leases[i], { slots: [...slots, { token, expiresAt: now + LEASE_MS }], deleteAfter: new Date(now + LEASE_MS + TTL_MS) }));
      return { token, provider, expiresAt: now + LEASE_MS };
    });
  } catch (error) {
    if (error instanceof ProviderBudgetError) throw error;
    throw new ProviderBudgetError(503, 'storage', 30);
  }
}

export async function releaseProviderAttempt(db: Firestore, lease: Lease) {
  const refs = [leaseRef(db, 'project:active'), leaseRef(db, `${lease.provider}:active`)];
  await db.runTransaction(async transaction => {
    const snapshots = await transaction.getAll(...refs);
    const now = Date.now();
    snapshots.forEach((snapshot, i) => {
      if (!snapshot.exists) return;
      transaction.set(refs[i], { slots: activeSlots(snapshot.data()?.slots, now).filter(slot => slot.token !== lease.token), deleteAfter: new Date(now + LEASE_MS + TTL_MS) });
    });
  });
}

// This wraps the actual paid submission, after user quotas/cache/idempotency.
// Never refund units: failures and ambiguous submissions may still be billed.
export async function withProviderBudget<T>(db: Firestore, operation: PaidOperation, work: (assertFresh: () => void) => Promise<T>, units = 1, options: BudgetOptions = {}): Promise<T> {
  const provider = operationProvider[operation];
  let lease: Lease;
  try { lease = await reserveProviderAttempt(db, operation, units, options); }
  catch (error) {
    if (error instanceof ProviderBudgetError) console.info(JSON.stringify({ event: 'provider_budget', provider, operation, outcome: 'rejected', reason: error.reason }));
    throw error;
  }
  console.info(JSON.stringify({ event: 'provider_budget', provider, operation, outcome: 'reserved' }));
  const assertFresh = () => {
    // Leave the complete provider timeout inside the lease, including after
    // asynchronous durable-intent writes. Never start work on an expired slot.
    if ((options.clock ?? Date.now)() + 60_000 >= lease.expiresAt) throw new ProviderBudgetError(503, 'concurrency', 30);
  };
  try { assertFresh(); return await work(assertFresh); }
  finally {
    try { await releaseProviderAttempt(db, lease); }
    catch { console.warn(JSON.stringify({ event: 'provider_budget', provider, operation, outcome: 'release_failed' })); }
  }
}

export function providerBudgetResponse(error: unknown): Response | null {
  if (!(error instanceof ProviderBudgetError)) return null;
  return Response.json({ error: error.message, code: 'PROVIDER_LIMIT' }, {
    status: error.status,
    headers: { 'Retry-After': String(error.retryAfterSeconds), 'Cache-Control': 'private, no-store' },
  });
}

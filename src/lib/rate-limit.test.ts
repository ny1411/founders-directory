import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import { acquireLease, releaseLease, reserveQuota, requestIp } from './rate-limit';

function database() {
  const values = new Map<string, Record<string, unknown>>();
  let pending = Promise.resolve();
  const snapshot = (key: string) => ({data: () => values.get(key)});
  const transaction = {getAll: async (...keys: string[]) => keys.map(snapshot), get: async (key: string) => snapshot(key), set: (key: string, data: Record<string, unknown>) => {values.set(key, data);}, delete: (key: string) => {values.delete(key);}};
  const db = {collection: (name: string) => ({doc: (id: string) => `${name}/${id}`}), runTransaction: <T>(fn: (tx: typeof transaction) => Promise<T>) => {
    const result = pending.then(() => fn(transaction)); pending = result.then(() => {}, () => {}); return result;
  }} as unknown as Firestore;
  return {db, values};
}
test('shared quota atomically limits concurrent instances and hashes subjects', async () => {
  const {db, values} = database();
  const responses = await Promise.all(Array.from({length: 10}, () => reserveQuota(db, 'paid', 'private-user', 'private-ip', [{name: 'hour', limit: 3, windowMs: 3600000, subject: 'user'}])));
  assert.equal(responses.filter(r => r.allowed).length, 3);
  assert.ok(responses.filter(r => !r.allowed).every(r => r.retryAfterSeconds > 0));
  assert.equal([...values.keys()].some(key => key.includes('private-user')), false);
});
test('IP limit is shared across different user accounts without consuming denied user quota', async () => {
  const {db} = database();
  const limits = [{name: 'user', limit: 10, windowMs: 60_000, subject: 'user' as const}, {name: 'ip', limit: 1, windowMs: 60_000, subject: 'ip' as const}];
  assert.equal((await reserveQuota(db, 'paid', 'user-one', 'same-ip', limits)).allowed, true);
  assert.equal((await reserveQuota(db, 'paid', 'user-two', 'same-ip', limits)).allowed, false);
  assert.equal((await reserveQuota(db, 'paid', 'user-two', 'other-ip', limits)).allowed, true);
});
test('leases serialize paid work and stale token cannot release newer owner', async () => {
  const {db, values} = database();
  const first = await acquireLease(db, 'work', 10000);
  assert.ok(first);
  assert.equal(await acquireLease(db, 'work', 10000), null);
  await releaseLease(db, 'work', 'wrong-token');
  assert.equal(await acquireLease(db, 'work', 10000), null);
  for (const value of values.values()) value.expiresAt = 0;
  const second = await acquireLease(db, 'work', 10000);
  assert.ok(second);
  await releaseLease(db, 'work', first);
  assert.equal(await acquireLease(db, 'work', 10000), null);
  await releaseLease(db, 'work', second);
  assert.ok(await acquireLease(db, 'work', 10000));
});
test('untrusted forwarding headers do not split the local IP quota bucket', () => {
  const previous = process.env.VERCEL;
  delete process.env.VERCEL;
  assert.equal(requestIp(new Request('http://localhost', {headers: {'x-forwarded-for': '1.2.3.4', 'x-vercel-forwarded-for': '1.2.3.4'}})), 'unavailable');
  if (previous === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous;
});

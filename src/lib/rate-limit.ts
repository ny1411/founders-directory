import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { Firestore } from 'firebase-admin/firestore';

export type QuotaLimit = { name: string; limit: number; windowMs: number; subject: 'user' | 'ip' };
export const hashIdentity = (value: string) => createHash('sha256').update(value).digest('hex');

// Vercel overwrites this header. Never trust client-supplied x-forwarded-for.
// Outside Vercel share a conservative bucket unless an explicit trusted proxy is added.
export function requestIp(request: Request) {
  const candidate = process.env.VERCEL ? request.headers.get('x-vercel-forwarded-for')?.split(',')[0].trim() : null;
  return candidate && isIP(candidate) ? candidate : 'unavailable';
}

export async function reserveQuota(db: Firestore, scope: string, uid: string, ip: string, limits: QuotaLimit[]) {
  const refs = limits.map(limit => db.collection('apiQuota').doc(hashIdentity(`${scope}:${limit.name}:${limit.subject === 'user' ? uid : ip}`)));
  return db.runTransaction(async transaction => {
    const snapshots = await transaction.getAll(...refs);
    const now = Date.now();
    const windows = limits.map((limit, i) => {
      const previous = snapshots[i].data();
      const startsAt = typeof previous?.startsAt === 'number' && previous.startsAt + limit.windowMs > now ? previous.startsAt : now;
      const attempts = startsAt === previous?.startsAt && Number.isInteger(previous?.attempts) ? Math.max(0, previous.attempts) : 0;
      return { startsAt, attempts, retryAfterSeconds: Math.max(1, Math.ceil((startsAt + limit.windowMs - now) / 1000)) };
    });
    const denied = windows.filter((window, i) => window.attempts >= limits[i].limit);
    if (denied.length) return { allowed: false, retryAfterSeconds: Math.max(...denied.map(window => window.retryAfterSeconds)) };
    windows.forEach((window, i) => transaction.set(refs[i], { startsAt: window.startsAt, attempts: window.attempts + 1, deleteAfter: new Date(window.startsAt + limits[i].windowMs + 86_400_000) }));
    return { allowed: true, retryAfterSeconds: 1 };
  });
}

export async function acquireLease(db: Firestore, key: string, ttlMs: number) {
  const ref = db.collection('apiLeases').doc(hashIdentity(key));
  return db.runTransaction(async transaction => {
    const previous = (await transaction.get(ref)).data();
    if (previous && previous.expiresAt > Date.now()) return null;
    const token = randomUUID();
    transaction.set(ref, { token, expiresAt: Date.now() + ttlMs, deleteAfter: new Date(Date.now() + ttlMs + 86_400_000) });
    return token;
  });
}

export async function releaseLease(db: Firestore, key: string, token: string) {
  const ref = db.collection('apiLeases').doc(hashIdentity(key));
  await db.runTransaction(async transaction => {
    if ((await transaction.get(ref)).data()?.token === token) transaction.delete(ref);
  });
}

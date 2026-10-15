import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';

export const RESUME_ATTEMPTS_PER_WINDOW = 5;
export const RESUME_USAGE_WINDOW_MS = 10 * 60 * 1000;

// A Firestore transaction shares the allowance across processes/instances. Reserve
// before calling Gemini; failed provider calls also count to bound paid retries.
// One document per user is reused, so this needs no TTL index or cleanup job.
export async function reserveResumeExtractionAttempt(db: Firestore, uid: string, clock = Date.now) {
  const key = createHash('sha256').update(uid).digest('hex');
  const ref = db.collection('resumeExtractionUsage').doc(key);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const previous = snapshot.data();
    // Reevaluate time on transaction retries. A later instance's timestamp may
    // appear in our future due to clock skew; keep that window and its count.
    const now = clock();
    const startsAt = typeof previous?.startsAt === 'number' && Number.isFinite(previous.startsAt)
      && previous.startsAt + RESUME_USAGE_WINDOW_MS > now ? previous.startsAt : now;
    const attempts = startsAt === previous?.startsAt && Number.isInteger(previous?.attempts)
      ? Math.max(0, previous.attempts as number) : 0;
    const retryAfterSeconds = Math.max(1, Math.ceil((startsAt + RESUME_USAGE_WINDOW_MS - now) / 1000));
    if (attempts >= RESUME_ATTEMPTS_PER_WINDOW) return { allowed: false, retryAfterSeconds };
    transaction.set(ref, { startsAt, attempts: attempts + 1 });
    return { allowed: true, retryAfterSeconds };
  });
}

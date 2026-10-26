import { send } from '@vercel/queue';
import { adminAuth, adminDb } from './firebase-admin';
import { createEnrichmentHandlers, type EnrichmentJob } from './enrichment-handler';
import { acquireLease, hashIdentity, releaseLease, requestIp, reserveQuota } from './rate-limit';
import type { Company, Founder } from './types';
import { saleshandyRequest } from './saleshandy';
import { createEnrichmentProcessor } from './enrichment-worker';
import { enrichmentEnabled, signEnrichmentMessage } from './enrichment-callback';
import { withProviderBudget } from './provider-budget';

const LIFETIME = 15 * 60 * 1000;
const ref = (id: string) => adminDb.collection('contactEnrichmentJobs').doc(id);
const enqueue = (jobId: string, step: number) => send('contact-enrichment', signEnrichmentMessage(jobId), {
  idempotencyKey: `${jobId}:${step}`,
  delaySeconds: step ? 3 : 0,
  retentionSeconds: LIFETIME / 1000,
});
async function targets(ids: string[], slug: string) {
  const [companies, founders] = await Promise.all([
    adminDb.collection('companies').where('slug', '==', slug).limit(1).get(),
    adminDb.getAll(...ids.map(id => adminDb.collection('founders').doc(id))),
  ]);
  if (companies.empty || founders.some(doc => !doc.exists || doc.data()?.companyId !== companies.docs[0].id)) return null;
  return {company: {...companies.docs[0].data(), id: companies.docs[0].id} as Company, founders: founders.map(doc => ({...doc.data(), id: doc.id}) as Founder)};
}
export const enrichmentHandlers = createEnrichmentHandlers({
  enabled: enrichmentEnabled,
  verify: token => adminAuth.verifyIdToken(token, true),
  quota: (uid, request) => reserveQuota(adminDb, 'enrichment-admission', uid, requestIp(request), [
    {name: 'user-minute', limit: 40, windowMs: 60_000, subject: 'user'},
    {name: 'ip-minute', limit: 100, windowMs: 60_000, subject: 'ip'},
  ]),
  authorize: async (ids, slug) => Boolean(await targets(ids, slug)),
  start: async (uid, founderIds, companySlug, key, request) => {
    // An idempotency key identifies one request for one user. Keep the payload
    // out of the document ID so reusing a key with different input cannot start
    // additional paid work after the first job's user lease has been released.
    const jobId = hashIdentity(JSON.stringify([uid, key]));
    const existing = (await ref(jobId).get()).data() as EnrichmentJob | undefined;
    if (existing) {
      if (existing.companySlug !== companySlug || existing.founderIds.length !== founderIds.length || existing.founderIds.some((id, index) => id !== founderIds[index])) return {conflict: true};
      if (existing.expiresAt < Date.now()) throw new Error('JOB_EXPIRED');
      if (existing.status === 'queued') await enqueue(jobId, 0);
      return {jobId, status: existing.status};
    }
    const userLease = await acquireLease(adminDb, `enrichment-user:${uid}`, LIFETIME);
    if (!userLease) return null;
    try {
      const quota = await reserveQuota(adminDb, 'enrichment-paid', uid, requestIp(request), [
        {name: 'user-hour', limit: 3, windowMs: 3_600_000, subject: 'user'},
        {name: 'user-day', limit: 10, windowMs: 86_400_000, subject: 'user'},
        {name: 'ip-day', limit: 30, windowMs: 86_400_000, subject: 'ip'},
      ]);
      if (!quota.allowed) {
        await releaseLease(adminDb, `enrichment-user:${uid}`, userLease);
        throw Object.assign(new Error('QUOTA_EXCEEDED'), {retryAfterSeconds: quota.retryAfterSeconds});
      }
      await ref(jobId).create({uid, founderIds, companySlug, status: 'queued', userLease, createdAt: Date.now(), expiresAt: Date.now() + LIFETIME, deleteAfter: new Date(Date.now() + 86_400_000)});
      await enqueue(jobId, 0);
      return {jobId, status: 'queued'};
    } catch (error) {
      if (!(await ref(jobId).get()).exists) await releaseLease(adminDb, `enrichment-user:${uid}`, userLease);
      throw error;
    }
  },
  status: async (uid, jobId) => {
    const job = (await ref(jobId).get()).data() as EnrichmentJob | undefined;
    return job?.uid === uid ? job : null;
  },
});
export const processEnrichmentJob = createEnrichmentProcessor({
  enabled: enrichmentEnabled,
  get: async id => (await ref(id).get()).data() as EnrichmentJob | undefined || null,
  update: (id, value, workerToken) => adminDb.runTransaction(async transaction => {
    const jobRef = ref(id);
    const workerLease = adminDb.collection('apiLeases').doc(hashIdentity(`enrichment-job:${id}`));
    const [job, lease] = await transaction.getAll(jobRef, workerLease);
    // Slow Firestore/provider work can outlive the delivery lease. Check current
    // ownership atomically with every write, not just the initial paid claim.
    if (!job.exists || !['queued', 'submitting', 'polling'].includes(job.data()?.status) ||
      lease.data()?.token !== workerToken || !(lease.data()?.expiresAt > Date.now())) return false;
    transaction.update(jobRef, value);
    return true;
  }),
  claimSubmission: (id, workerToken) => adminDb.runTransaction(async transaction => {
    const jobRef = ref(id);
    const workerLease = adminDb.collection('apiLeases').doc(hashIdentity(`enrichment-job:${id}`));
    const [job, lease] = await transaction.getAll(jobRef, workerLease);
    if (job.data()?.status !== 'queued' || lease.data()?.token !== workerToken || !(lease.data()?.expiresAt > Date.now() + 15_000)) return false;
    transaction.update(jobRef, {status: 'submitting'});
    return true;
  }),
  targets,
  acquire: (key, ttlMs) => acquireLease(adminDb, key, ttlMs),
  release: (key, token) => releaseLease(adminDb, key, token),
  enqueue,
  provider: saleshandyRequest,
  runPaid: (units, submit) => withProviderBudget(adminDb, 'enrichment', submit, units),
});

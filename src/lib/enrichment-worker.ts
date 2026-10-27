import type { EnrichmentJob } from './enrichment-handler';
import type { Company, Founder } from './types';
import { ProviderBudgetError } from './provider-budget';

interface ProviderData {payload?: {requestId?: unknown; status?: string; results?: unknown[]}}
interface Dependencies {
  enabled(): boolean;
  clock?(): number;
  get(id: string): Promise<EnrichmentJob | null>;
  // Every state transition must be committed under this delivery's live lease.
  // False means a replacement owns the job or it is already terminal.
  update(id: string, value: Partial<EnrichmentJob>, workerToken: string): Promise<boolean>;
  claimSubmission(id: string, workerToken: string): Promise<boolean>;
  targets(ids: string[], slug: string): Promise<{company: Company; founders: Founder[]} | null>;
  acquire(key: string, ttlMs: number): Promise<string | null>;
  release(key: string, token: string): Promise<void>;
  enqueue(id: string, step: number): Promise<unknown>;
  provider(path: string, init?: RequestInit): Promise<ProviderData>;
  runPaid<T>(units: number, submit: (assertFresh: () => void) => Promise<T>): Promise<T>;
}
class EnrichmentOwnershipLostError extends Error {
  constructor() { super('JOB_OWNERSHIP_LOST'); }
}
export function createEnrichmentProcessor(deps: Dependencies) {
  async function commit(id: string, value: Partial<EnrichmentJob>, workerToken: string) {
    // Throw so an expired delivery is retried if no replacement has advanced
    // the job yet. Returning would acknowledge and strand unfinished polling.
    if (!await deps.update(id, value, workerToken)) throw new EnrichmentOwnershipLostError();
  }
  async function finish(id: string, job: EnrichmentJob, value: Partial<EnrichmentJob>, workerToken: string) {
    await commit(id, value, workerToken);
    await deps.release(`enrichment-user:${job.uid}`, job.userLease);
    console.info(JSON.stringify({event: 'enrichment_finished', jobId: id, status: value.status, reason: value.reason}));
  }
  const clock = () => (deps.clock ?? Date.now)();
  return async (id: string) => {
    if (!deps.enabled()) throw new Error('ENRICHMENT_DISABLED');
    if (!/^[a-f0-9]{64}$/.test(id)) return;
    const workerDeadline = clock() + 90_000;
    const token = await deps.acquire(`enrichment-job:${id}`, 90_000);
    if (!token) throw new Error('JOB_BUSY');
    try {
      const job = await deps.get(id);
      if (!job) return;
      if (['completed', 'failed'].includes(job.status)) {
        await deps.release(`enrichment-user:${job.uid}`, job.userLease);
        return;
      }
      if (job.expiresAt < clock()) return await finish(id, job, {status: 'failed', reason: 'JOB_EXPIRED'}, token);
      if (job.status === 'submitting') return await finish(id, job, {status: 'failed', reason: 'SUBMISSION_UNCERTAIN'}, token);
      if (job.status === 'queued') {
        const target = await deps.targets(job.founderIds, job.companySlug);
        if (!target) return await finish(id, job, {status: 'failed', reason: 'TARGET_UNAVAILABLE'}, token);
        const payload = {
          linkedin_url: target.founders.filter(f => f.linkedinUrl).map(f => f.linkedinUrl),
          full_name_with_company: target.founders.filter(f => !f.linkedinUrl).map(f => ({first_name: f.name.split(' ')[0], last_name: f.name.split(' ').slice(1).join(' '), company_website: target.company.website})),
        };
        // Claim queued -> submitting atomically under the live worker lease.
        // Slow/stale deliveries cannot overwrite a replacement owner or charge twice.
        if (!await deps.claimSubmission(id, token)) throw new EnrichmentOwnershipLostError();
        let submitted: boolean;
        try {
          submitted = await deps.runPaid(job.founderIds.length, async (assertFresh) => {
            // The sole durable claim winner can spend. Ambiguous POSTs never retry.
            assertFresh();
            if (clock() + 15_000 >= workerDeadline) throw new ProviderBudgetError(503, 'concurrency', 30);
            try {
              const data = await deps.provider('/enrich/contact', {method: 'POST', body: JSON.stringify(payload)});
              const requestId = data.payload?.requestId;
              if (typeof requestId !== 'string' || !/^[\w-]{1,200}$/.test(requestId)) throw new Error('INVALID_PROVIDER_RESPONSE');
              await commit(id, {status: 'polling', requestId, polls: 0}, token);
              return true;
            } catch (error) {
              if (error instanceof EnrichmentOwnershipLostError) throw error;
              await finish(id, job, {status: 'failed', reason: 'PROVIDER_SUBMISSION_FAILED'}, token);
              return false;
            }
          });
        } catch (error) {
          if (error instanceof ProviderBudgetError) return await finish(id, job, {
            status: 'failed', reason: 'PROVIDER_BUDGET_REJECTED',
            providerBudgetStatus: error.status, retryAfterSeconds: error.retryAfterSeconds,
          }, token);
          throw error;
        }
        // A failed/ambiguous paid submission is terminal, even if release failed.
        if (!submitted) return;
        await deps.enqueue(id, 1);
        return;
      }
      if ((job.polls || 0) >= 15) return await finish(id, job, {status: 'failed', reason: 'POLLING_TIMEOUT'}, token);
      let data: ProviderData | undefined;
      try { data = await deps.provider(`/enrich/status/result/${encodeURIComponent(job.requestId!)}`); } catch { /* GET retry is safe. */ }
      const polls = (job.polls || 0) + 1;
      if (['completed', 'completed-with-errors'].includes(data?.payload?.status || '')) {
        const raw = Array.isArray(data?.payload?.results) ? data.payload.results.slice(0, job.founderIds.length).filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object') : [];
        const target = await deps.targets(job.founderIds, job.companySlug);
        if (!target) return await finish(id, job, {status: 'failed', reason: 'TARGET_UNAVAILABLE'}, token);
        const results = target.founders.map(founder => {
          const result = raw.find(value => founder.linkedinUrl ? value.linkedin_url === founder.linkedinUrl : `${value.first_name || ''} ${value.last_name || ''}`.trim().toLowerCase() === founder.name.trim().toLowerCase());
          const email = Array.isArray(result?.emails) ? result.emails.find(value => value && value.verificationStatus === 'valid')?.email : result?.email;
          return {founderId: founder.id, workEmail: typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null};
        });
        return await finish(id, job, {status: 'completed', results}, token);
      }
      await commit(id, {polls}, token);
      await deps.enqueue(id, polls + 1);
    } finally { await deps.release(`enrichment-job:${id}`, token); }
  };
}

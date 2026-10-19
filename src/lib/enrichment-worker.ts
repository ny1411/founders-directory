import type { EnrichmentJob } from './enrichment-handler';
import type { Company, Founder } from './types';

interface ProviderData {payload?: {requestId?: unknown; status?: string; results?: unknown[]}}
interface Dependencies {
  enabled(): boolean;
  get(id: string): Promise<EnrichmentJob | null>;
  update(id: string, value: Partial<EnrichmentJob>): Promise<void>;
  targets(ids: string[], slug: string): Promise<{company: Company; founders: Founder[]} | null>;
  acquire(key: string, ttlMs: number): Promise<string | null>;
  release(key: string, token: string): Promise<void>;
  enqueue(id: string, step: number): Promise<unknown>;
  provider(path: string, init?: RequestInit): Promise<ProviderData>;
}
export function createEnrichmentProcessor(deps: Dependencies) {
  async function finish(id: string, job: EnrichmentJob, value: Partial<EnrichmentJob>) {
    await deps.update(id, value);
    await deps.release(`enrichment-user:${job.uid}`, job.userLease);
    console.info(JSON.stringify({event: 'enrichment_finished', jobId: id, status: value.status, reason: value.reason}));
  }
  return async (id: string) => {
    if (!deps.enabled()) throw new Error('ENRICHMENT_DISABLED');
    if (!/^[a-f0-9]{64}$/.test(id)) return;
    const token = await deps.acquire(`enrichment-job:${id}`, 90_000);
    if (!token) throw new Error('JOB_BUSY');
    try {
      const job = await deps.get(id);
      if (!job) return;
      if (['completed', 'failed'].includes(job.status)) {
        await deps.release(`enrichment-user:${job.uid}`, job.userLease);
        return;
      }
      if (job.expiresAt < Date.now()) return finish(id, job, {status: 'failed', reason: 'JOB_EXPIRED'});
      if (job.status === 'submitting') return finish(id, job, {status: 'failed', reason: 'SUBMISSION_UNCERTAIN'});
      if (job.status === 'queued') {
        const target = await deps.targets(job.founderIds, job.companySlug);
        if (!target) return finish(id, job, {status: 'failed', reason: 'TARGET_UNAVAILABLE'});
        const payload = {
          linkedin_url: target.founders.filter(f => f.linkedinUrl).map(f => f.linkedinUrl),
          full_name_with_company: target.founders.filter(f => !f.linkedinUrl).map(f => ({first_name: f.name.split(' ')[0], last_name: f.name.split(' ').slice(1).join(' '), company_website: target.company.website})),
        };
        // Persist intent before the paid call; ambiguous submission must never
        // retry because the upstream offers no idempotency guarantee.
        await deps.update(id, {status: 'submitting'});
        try {
          const data = await deps.provider('/enrich/contact', {method: 'POST', body: JSON.stringify(payload)});
          const requestId = data.payload?.requestId;
          if (typeof requestId !== 'string' || !/^[\w-]{1,200}$/.test(requestId)) throw new Error('INVALID_PROVIDER_RESPONSE');
          await deps.update(id, {status: 'polling', requestId, polls: 0});
        } catch { return finish(id, job, {status: 'failed', reason: 'PROVIDER_SUBMISSION_FAILED'}); }
        await deps.enqueue(id, 1);
        return;
      }
      if ((job.polls || 0) >= 15) return finish(id, job, {status: 'failed', reason: 'POLLING_TIMEOUT'});
      let data: ProviderData | undefined;
      try { data = await deps.provider(`/enrich/status/result/${encodeURIComponent(job.requestId!)}`); } catch { /* GET retry is safe. */ }
      const polls = (job.polls || 0) + 1;
      if (['completed', 'completed-with-errors'].includes(data?.payload?.status || '')) {
        const raw = Array.isArray(data?.payload?.results) ? data.payload.results.slice(0, job.founderIds.length).filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object') : [];
        const target = await deps.targets(job.founderIds, job.companySlug);
        if (!target) return finish(id, job, {status: 'failed', reason: 'TARGET_UNAVAILABLE'});
        const results = target.founders.map(founder => {
          const result = raw.find(value => founder.linkedinUrl ? value.linkedin_url === founder.linkedinUrl : `${value.first_name || ''} ${value.last_name || ''}`.trim().toLowerCase() === founder.name.trim().toLowerCase());
          const email = Array.isArray(result?.emails) ? result.emails.find(value => value && value.verificationStatus === 'valid')?.email : result?.email;
          return {founderId: founder.id, workEmail: typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null};
        });
        return finish(id, job, {status: 'completed', results});
      }
      await deps.update(id, {polls});
      await deps.enqueue(id, polls + 1);
    } finally { await deps.release(`enrichment-job:${id}`, token); }
  };
}

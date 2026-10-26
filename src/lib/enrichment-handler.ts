import { boundedJson } from './bounded-json';
import { createCorrelationId, createObservability } from './observability';
import { instrumentApiRoute } from './observability-runtime';

const observability = createObservability();
export const MAX_ENRICHMENT_BATCH = 5;
export interface EnrichmentJob {
  uid: string;
  founderIds: string[];
  companySlug: string;
  status: 'queued' | 'submitting' | 'polling' | 'completed' | 'failed';
  createdAt: number;
  expiresAt: number;
  userLease: string;
  requestId?: string;
  polls?: number;
  results?: unknown[];
  reason?: string;
  providerBudgetStatus?: 429 | 503;
  retryAfterSeconds?: number;
}
interface Dependencies {
  enabled?(): boolean;
  verify(token: string): Promise<{uid: string}>;
  quota(uid: string, request: Request): Promise<{allowed: boolean; retryAfterSeconds: number}>;
  authorize(founderIds: string[], companySlug: string): Promise<boolean>;
  start(uid: string, founderIds: string[], companySlug: string, idempotencyKey: string, request: Request): Promise<{jobId: string; status: string} | {conflict: true} | null>;
  status(uid: string, jobId: string): Promise<EnrichmentJob | null>;
}
const json = (body: unknown, status = 200, headers = {}) => Response.json(body, {status, headers: {'Cache-Control': 'private, no-store', ...headers}});

export function createEnrichmentHandlers(deps: Dependencies) {
  async function authenticate(request: Request) {
    const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '')?.[1];
    if (!token) return null;
    try { return (await deps.verify(token)).uid || null; } catch { return null; }
  }
  return {
    POST: async (request: Request) => {
      const uid = await authenticate(request);
      if (!uid) return json({error: 'Unauthorized'}, 401);
      if (deps.enabled && !deps.enabled()) return json({error: 'Contact lookup temporarily unavailable'}, 503, {'Retry-After': '60'});
      try {
        const quota = await deps.quota(uid, request);
        if (!quota.allowed) return json({error: 'Too many requests. Please try again later.'}, 429, {'Retry-After': String(quota.retryAfterSeconds)});
        let body;
        try { body = await boundedJson(request) as Record<string, unknown>; } catch { return json({error: 'Invalid or oversized payload'}, 400); }
        const key = request.headers.get('idempotency-key');
        if (!Array.isArray(body?.founderIds) || !body.founderIds.length || body.founderIds.length > MAX_ENRICHMENT_BATCH || body.founderIds.some((id: unknown) => typeof id !== 'string' || !/^[\w-]{1,150}$/.test(id)) || typeof body.companySlug !== 'string' || !/^[\w-]{1,200}$/.test(body.companySlug) || !key || !/^[\w-]{8,100}$/.test(key)) return json({error: 'Choose up to five valid founders, a company, and an idempotency key.'}, 400);
        const founderIds = [...new Set<string>(body.founderIds as string[])].sort();
        if (!await deps.authorize(founderIds, body.companySlug)) return json({error: 'Founder or company not found'}, 404);
        const job = await deps.start(uid, founderIds, body.companySlug, key, request);
        if (!job) return json({error: 'An enrichment job is already running. Please wait.'}, 409, {'Retry-After': '10'});
        if ('conflict' in job) return json({error: 'This idempotency key was already used for another request.'}, 409);
        observability.log('contact_enrichment.accepted', createCorrelationId(), {
          route: '/api/enrich-contact', outcome: 'success', batch_size: founderIds.length, quota_decision: 'allowed',
        });
        return json({...job, statusUrl: `/api/enrich-contact/${job.jobId}`}, 202, {'Retry-After': '3'});
      } catch (error) {
        if (error && typeof error === 'object' && 'retryAfterSeconds' in error) return json({error: 'Enrichment limit reached'}, 429, {'Retry-After': String(error.retryAfterSeconds)});
        // Includes quota-store and queue failures: never bypass protection.
        return json({error: 'Enrichment temporarily unavailable'}, 503, {'Retry-After': '30'});
      }
    },
    GET: instrumentApiRoute({
      route: '/api/enrich-contact/[jobId]', event: 'contact_enrichment.status',
      durationMetric: 'contact_enrichment.status.duration_ms', provider: 'firestore',
    }, async (request: Request, jobId: string) => {
      const uid = await authenticate(request);
      if (!uid) return json({error: 'Unauthorized'}, 401);
      if (deps.enabled && !deps.enabled()) return json({error: 'Contact lookup temporarily unavailable'}, 503, {'Retry-After': '60'});
      if (!/^[a-f0-9]{64}$/.test(jobId)) return json({error: 'Job not found'}, 404);
      try {
        const quota = await deps.quota(uid, request);
        if (!quota.allowed) return json({error: 'Too many requests'}, 429, {'Retry-After': String(quota.retryAfterSeconds)});
        const job = await deps.status(uid, jobId);
        if (!job || job.expiresAt < Date.now()) return json({error: 'Job not found'}, 404);
        if (job.status === 'failed' && job.reason === 'PROVIDER_BUDGET_REJECTED' && job.providerBudgetStatus) return json({
          jobId, status: job.status, code: 'PROVIDER_BUDGET_REJECTED', error: `Contact lookup is temporarily limited. Try again in ${job.retryAfterSeconds || 30} seconds.`,
        }, job.providerBudgetStatus, {'Retry-After': String(job.retryAfterSeconds || 30)});
        return json({jobId, status: job.status, ...(job.status === 'completed' ? {results: job.results} : {}), ...(job.reason ? {reason: job.reason} : {})}, 200, {'Retry-After': '3'});
      } catch { return json({error: 'Enrichment temporarily unavailable'}, 503, {'Retry-After': '30'}); }
    }),
  };
}

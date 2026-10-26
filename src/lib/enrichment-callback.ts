import { createHmac, timingSafeEqual } from 'node:crypto';
import { boundedJson } from './bounded-json';
import { instrumentPrivateHandler } from './observability-runtime';

export interface SignedEnrichmentMessage { jobId: string; signature: string }
const validSecret = (secret: string | undefined): secret is string => typeof secret === 'string' && secret.length >= 32;
const configuredSecret = () => process.env.CONTACT_ENRICHMENT_QUEUE_SECRET;
export const enrichmentEnabled = () => process.env.CONTACT_ENRICHMENT_ENABLED === 'true' && validSecret(configuredSecret());

export function signEnrichmentMessage(jobId: string, secret = configuredSecret()): SignedEnrichmentMessage {
  if (!validSecret(secret)) throw new Error('QUEUE_SECRET_NOT_CONFIGURED');
  if (!/^[a-f0-9]{64}$/.test(jobId)) throw new Error('INVALID_JOB_ID');
  return { jobId, signature: createHmac('sha256', secret).update(`contact-enrichment:v1:${jobId}`).digest('hex') };
}

export function verifyEnrichmentMessage(value: unknown, secret = configuredSecret()): value is SignedEnrichmentMessage {
  if (!validSecret(secret) || !value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  if (Object.keys(payload).length !== 2 || typeof payload.jobId !== 'string' || !/^[a-f0-9]{64}$/.test(payload.jobId) || typeof payload.signature !== 'string' || !/^[a-f0-9]{64}$/.test(payload.signature)) return false;
  return timingSafeEqual(Buffer.from(payload.signature, 'hex'), Buffer.from(signEnrichmentMessage(payload.jobId, secret).signature, 'hex'));
}

// SDK v2 direct bodies reach the handler before the Queue API validates the
// receipt. Authenticate our producer payload before invoking any SDK operation.
// Pointer/legacy delivery modes intentionally fail closed; no SDK fetch fallback.
export function createSignedEnrichmentCallback(
  callback: (request: Request) => Promise<Response>,
  config = { enabled: () => process.env.CONTACT_ENRICHMENT_ENABLED === 'true', secret: configuredSecret },
) {
  return instrumentPrivateHandler({
    route: '/api/queues/enrich-contact', event: 'contact_enrichment.callback',
    durationMetric: 'contact_enrichment.callback.duration_ms', provider: 'vercel_queue',
  }, async (request: Request) => {
    const secret = config.secret();
    if (!config.enabled() || !validSecret(secret)) return new Response(null, {status: 503, headers: {'Retry-After': '60'}});
    const receipt = request.headers.get('ce-vqsreceipthandle');
    if (request.headers.get('ce-type') !== 'com.vercel.queue.v2beta' || request.headers.get('ce-vqsqueuename') !== 'contact-enrichment' || !receipt || receipt.length > 2048) return new Response(null, {status: 401});
    let payload: unknown;
    try { payload = await boundedJson(request, 4096); }
    catch { return new Response(null, {status: 400}); }
    if (!verifyEnrichmentMessage(payload, secret)) return new Response(null, {status: 401});
    const headers = new Headers(request.headers);
    headers.delete('content-length');
    headers.set('content-type', 'application/json');
    return callback(new Request(request.url, {method: 'POST', headers, body: JSON.stringify(payload)}));
  });
}

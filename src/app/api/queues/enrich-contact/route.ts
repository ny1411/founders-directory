import { handleCallback } from '@vercel/queue';
import { processEnrichmentJob } from '@/lib/enrichment-jobs';
import { createSignedEnrichmentCallback, verifyEnrichmentMessage, type SignedEnrichmentMessage } from '@/lib/enrichment-callback';
export const runtime = 'nodejs';
export const maxDuration = 60;
const callback = handleCallback<SignedEnrichmentMessage>(async (message) => {
  if (!verifyEnrichmentMessage(message)) throw new Error('INVALID_QUEUE_SIGNATURE');
  await processEnrichmentJob(message.jobId);
}, {retry: () => ({afterSeconds: 100})});
const signedCallback = createSignedEnrichmentCallback(callback);
export async function POST(request: Request) {
  return signedCallback(request);
}

import { handleCallback } from '@vercel/queue';
import { processEnrichmentJob } from '@/lib/enrichment-jobs';
export const runtime = 'nodejs';
export const maxDuration = 60;
const callback = handleCallback<{jobId: string}>(async ({jobId}) => {
  await processEnrichmentJob(jobId);
}, {retry: () => ({afterSeconds: 100})});
export async function POST(request: Request) {
  return callback(request);
}

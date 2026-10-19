import { enrichmentHandlers } from '@/lib/enrichment-jobs';
export const runtime = 'nodejs';
export async function GET(request: Request, context: {params: Promise<{jobId: string}>}) {
  return enrichmentHandlers.GET(request, (await context.params).jobId);
}

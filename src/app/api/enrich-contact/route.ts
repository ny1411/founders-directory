import { enrichmentHandlers } from '@/lib/enrichment-jobs';
import { adminAuth } from '@/lib/firebase-admin';
import { createBotProtectedPost } from '@/lib/bot-verification';
import { instrumentApiRoute } from '@/lib/observability-runtime';

export const runtime = 'nodejs';
const protectedPost = createBotProtectedPost({
  route: '/api/enrich-contact',
  verifyToken: (token) => adminAuth.verifyIdToken(token, true),
  handler: enrichmentHandlers.POST,
});

export const POST = instrumentApiRoute({
  route: '/api/enrich-contact',
  event: 'contact_enrichment',
  durationMetric: 'contact_enrichment.duration_ms',
  attemptMetric: 'contact_enrichment.attempts',
  provider: 'saleshandy',
}, protectedPost);

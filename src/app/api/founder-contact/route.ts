import { instrumentPrivateHandler } from "@/lib/observability-runtime";
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { createFounderContactHandler } from '@/lib/founder-contact';
import { requestIp, reserveQuota } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const POST = instrumentPrivateHandler({route: '/api/founder-contact', event: 'founder.contact', durationMetric: 'profile.duration_ms', provider: 'firestore'}, createFounderContactHandler({
  verify: token => adminAuth.verifyIdToken(token, true),
  quota: (uid, request) => reserveQuota(adminDb, 'founder-contact', uid, requestIp(request), [
    {name: 'user-minute', limit: 20, windowMs: 60_000, subject: 'user'},
    {name: 'ip-minute', limit: 60, windowMs: 60_000, subject: 'ip'},
    {name: 'user-day', limit: 100, windowMs: 86_400_000, subject: 'user'},
  ]),
  lookup: async (founderId, companySlug) => {
    const [companies, founder] = await Promise.all([
      adminDb.collection('companies').where('slug', '==', companySlug).limit(1).get(),
      adminDb.collection('founders').doc(founderId).get(),
    ]);
    if (companies.empty || !founder.exists || founder.data()?.companyId !== companies.docs[0].id) return null;
    const email = founder.data()?.email;
    return {email: typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null};
  },
}));

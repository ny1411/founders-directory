import { admissionResponse, type AdmissionCheck } from './admission-policy';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';

const rejectedCredentials = new Set([
  'auth/argument-error',
  'auth/invalid-argument',
  'auth/invalid-id-token',
  'auth/id-token-expired',
  'auth/id-token-revoked',
  'auth/user-disabled',
  'auth/user-not-found',
]);

function isRejectedCredential(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    && typeof error.code === 'string' && rejectedCredentials.has(error.code);
}

// Dependency injection keeps regression tests independent of Firebase credentials.
export function createAuthSyncHandler(
  auth: Pick<Auth, 'verifyIdToken'>,
  db: Pick<Firestore, 'collection'>,
  admit: AdmissionCheck,
) {
  return async function POST(req: Request) {
    const match = /^Bearer ([^\s]+)$/i.exec(req.headers.get('Authorization') ?? '');
    if (!match) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } });
    }

    let identity;
    try {
      // Revoked tokens and disabled users must not retain access to this write.
      identity = await auth.verifyIdToken(match[1], true);
    } catch (error) {
      if (isRejectedCredential(error)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } });
      }
      console.error('Error verifying account sync token:', error);
      return Response.json({ error: 'Unable to sync account' }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } });
    }

    if (!identity.email) {
      return Response.json({ error: 'An email address is required' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
    }

    const rejected = await admissionResponse(admit, identity.uid, req);
    if (rejected) return rejected;

    try {
      // Identity comes exclusively from Firebase, never from request JSON.
      await db.collection('users').doc(identity.uid).set({
        firebaseId: identity.uid,
        email: identity.email,
        updatedAt: new Date().toISOString(),
      }, { merge: true });

      // Do not read or serialize the user document: it contains private resume data.
      return Response.json({ user: { id: identity.uid, email: identity.email } }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
      console.error('Error syncing user:', error);
      return Response.json({ error: 'Unable to sync account' }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } });
    }
  };
}

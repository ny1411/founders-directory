import { createAdmissionCheck } from '@/lib/admission-policy';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { createAuthSyncHandler } from '@/lib/auth-sync-handler';

export const POST = createAuthSyncHandler(adminAuth, adminDb, createAdmissionCheck(adminDb, 'auth-sync'));

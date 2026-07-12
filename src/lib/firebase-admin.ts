import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

if (!getApps().length) {
  try {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
    // Enable ignoreUndefinedProperties so undefined fields are stripped instead of causing errors
    getFirestore().settings({ ignoreUndefinedProperties: true });
  } catch (error) {
    console.error('Firebase admin initialization error', error);
  }
}

const adminAuth = getAuth();
const adminDb = getFirestore();

export { adminAuth, adminDb };

import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { OnboardingStore } from '@/lib/onboarding/store';
import { getOnboardingReadiness } from '@/lib/onboarding/readiness';
import { toPublicOnboardingState } from '@/lib/onboarding/handler';

export async function GET(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let uid: string;
  try {
    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await adminAuth.verifyIdToken(idToken, true);
    uid = decodedToken.uid;
  } catch (error) {
    console.error('Error verifying profile session:', error);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const userDoc = await adminDb.collection('users').doc(uid).get();

    if (!userDoc.exists) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const user = userDoc.data();
    const onboarding = await new OnboardingStore(adminDb).load(uid);
    const publicOnboarding = toPublicOnboardingState(onboarding);
    return NextResponse.json({
      resumeText: user?.resumeText || null,
      profile: publicOnboarding.profile,
      goal: publicOnboarding.goal,
      readiness: getOnboardingReadiness(onboarding),
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await adminAuth.verifyIdToken(idToken, true);
    
    const { resumeText } = await req.json();
    if (typeof resumeText !== 'string' || resumeText.length > 1_000_000) {
      return NextResponse.json({ error: 'Invalid resume data' }, { status: 400 });
    }

    const userRef = adminDb.collection('users').doc(decodedToken.uid);
    await userRef.set({ resumeText, updatedAt: new Date().toISOString() }, { merge: true });

    return NextResponse.json({ success: true, resumeText });
  } catch (error) {
    console.error('Error updating profile:', error);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}

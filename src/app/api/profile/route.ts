import { createAdmissionCheck } from "@/lib/admission-policy";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { createOnboardingHandler } from "@/lib/onboarding/handler";
import { OnboardingStore } from "@/lib/onboarding/store";

export const runtime = "nodejs";

const handler = createOnboardingHandler(
  (token, revoked) => adminAuth.verifyIdToken(token, revoked),
  new OnboardingStore(adminDb),
  { read: createAdmissionCheck(adminDb, "profile-read"), write: createAdmissionCheck(adminDb, "profile-write") },
);
export const GET = handler.GET;
export const PATCH = handler.PATCH;
// POST is kept as a profile-answer update alias; legacy resumeText is read only during migration.
export const POST = handler.PATCH;

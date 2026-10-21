import { createAdmissionCheck } from "@/lib/admission-policy";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { createOnboardingHandler } from "@/lib/onboarding/handler";
import { OnboardingStore } from "@/lib/onboarding/store";

export const runtime = "nodejs";

const handler = createOnboardingHandler(
  (token, checkRevoked) => adminAuth.verifyIdToken(token, checkRevoked),
  new OnboardingStore(adminDb),
  { read: createAdmissionCheck(adminDb, "profile-read"), write: createAdmissionCheck(adminDb, "profile-write") },
);

export const GET = handler.GET;
export const POST = handler.POST;

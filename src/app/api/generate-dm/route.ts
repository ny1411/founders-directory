import { GoogleGenAI } from "@google/genai";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { createMessageHandler } from "@/lib/onboarding/messages";
import { OnboardingStore } from "@/lib/onboarding/store";
import type { Company, Founder } from "@/lib/types";

export const runtime = "nodejs";
const store = new OnboardingStore(adminDb);

export const POST = createMessageHandler({
  verifyToken: (token, revoked) => adminAuth.verifyIdToken(token, revoked),
  load: (uid) => store.load(uid),
  getResume: (uid, state) => store.getResumeContext(uid, state),
  getTarget: async (founderId, companySlug) => {
    const [companies, founderDocument] = await Promise.all([
      adminDb
        .collection("companies")
        .where("slug", "==", companySlug)
        .limit(1)
        .get(),
      adminDb.collection("founders").doc(founderId).get(),
    ]);
    if (
      companies.empty ||
      !founderDocument.exists ||
      founderDocument.data()?.companyId !== companies.docs[0].id
    )
      return null;
    return {
      company: {
        ...companies.docs[0].data(),
        id: companies.docs[0].id,
      } as Company,
      founder: { ...founderDocument.data(), id: founderDocument.id } as Founder,
    };
  },
  getCached: async (key) =>
    (await adminDb.collection("generatedMessages").doc(key).get()).data()
      ?.content || null,
  save: async (key, value) => {
    await adminDb.collection("generatedMessages").doc(key).set(value);
  },
  generate: async ({ instructions, data }) =>
    (
      await new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
      }).models.generateContent({
        model: "gemini-3.5-flash",
        contents: JSON.stringify(data),
        config: { systemInstruction: instructions },
      })
    ).text,
});

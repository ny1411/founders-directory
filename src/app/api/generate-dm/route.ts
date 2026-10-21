import { GoogleGenAI } from "@google/genai";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { createMessageHandler } from "@/lib/onboarding/messages";
import { OnboardingStore } from "@/lib/onboarding/store";
import type { Company, Founder } from "@/lib/types";
import {
  acquireLease,
  releaseLease,
  requestIp,
  reserveQuota,
} from "@/lib/rate-limit";
import { createBotProtectedPost } from "@/lib/bot-verification";
import { instrumentApiRoute } from "@/lib/observability-runtime";
import { withProviderBudget } from "@/lib/provider-budget";

export const runtime = "nodejs";
const store = new OnboardingStore(adminDb);

const generateMessage = createMessageHandler({
  quota: (uid, request, kind) =>
    reserveQuota(
      adminDb,
      `generate-dm-${kind}`,
      uid,
      requestIp(request),
      kind === "request"
        ? [
            {
              name: "user-minute",
              limit: 30,
              windowMs: 60_000,
              subject: "user",
            },
            { name: "ip-minute", limit: 60, windowMs: 60_000, subject: "ip" },
          ]
        : [
            {
              name: "user-hour",
              limit: 10,
              windowMs: 3_600_000,
              subject: "user",
            },
            {
              name: "user-day",
              limit: 30,
              windowMs: 86_400_000,
              subject: "user",
            },
            { name: "ip-day", limit: 60, windowMs: 86_400_000, subject: "ip" },
          ],
    ),
  acquire: (key) => acquireLease(adminDb, `generate-dm:${key}`, 120_000),
  release: (key, token) => releaseLease(adminDb, `generate-dm:${key}`, token),
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
  getCached: async (key) => {
    const draft = (
      await adminDb.collection("generatedMessages").doc(key).get()
    ).data();
    return draft &&
      typeof draft.expiresAt === "string" &&
      Date.parse(draft.expiresAt) > Date.now()
      ? draft.content || null
      : null;
  },
  save: async (key, value) => {
    await adminDb.collection("generatedMessages").doc(key).set(value);
  },
  generate: ({ instructions, data }) => withProviderBudget(adminDb, "dm", async () =>
    (
      await new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
      }).models.generateContent({
        model: "gemini-3.5-flash",
        contents: JSON.stringify(data),
        config: {
          systemInstruction: instructions,
          httpOptions: { timeout: 60_000, retryOptions: { attempts: 1 } },
        },
      })
    ).text),
});

const protectedPost = createBotProtectedPost({
  route: "/api/generate-dm",
  verifyToken: (token) => adminAuth.verifyIdToken(token, true),
  handler: generateMessage,
});

export const POST = instrumentApiRoute({
  route: "/api/generate-dm",
  event: "dm_generation",
  durationMetric: "dm_generation.duration_ms",
  attemptMetric: "dm_generation.attempts",
  provider: "gemini",
}, protectedPost);

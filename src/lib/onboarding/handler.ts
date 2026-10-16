import type { DecodedIdToken } from "firebase-admin/auth";
import { getOnboardingReadiness } from "./readiness";
import { getQuestionMap } from "./questionnaires";
import type { GoalStage, OnboardingState, OnboardingStep, UserIntent } from "./types";
import {
  isGoalStage, isUserIntent, OnboardingValidationError, validateAnswers,
  validateQuestionnaireVersion, validateRequiredAnswers,
} from "./validation";

interface Store {
  load(uid: string): Promise<OnboardingState>;
  selectIntent(uid: string, intent: UserIntent, stage: GoalStage): Promise<OnboardingState>;
  saveAnswers(uid: string, state: OnboardingState, profile: Record<string, string>, goal: Record<string, string>): Promise<void>;
  setStep(uid: string, goalId: string, step: OnboardingStep): Promise<void>;
  saveSummary(uid: string, goalId: string, summary: string): Promise<void>;
  complete(uid: string, goalId: string): Promise<void>;
}

type VerifyToken = (token: string, checkRevoked?: boolean) => Promise<DecodedIdToken>;
class UnauthorizedError extends Error {}

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status });
}

export function toPublicOnboardingState(state: OnboardingState) {
  return {
    ...state,
    profile: {
      ...state.profile,
      resumeData: undefined,
      hasResume: Boolean(state.profile.hasResume || state.profile.resumeData),
    },
  };
}

async function authenticate(request: Request, verifyToken: VerifyToken) {
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) throw new UnauthorizedError("Unauthorized");
  try { return await verifyToken(token, true); }
  catch { throw new UnauthorizedError("Unauthorized"); }
}

export function createOnboardingHandler(verifyToken: VerifyToken, store: Store) {
  return {
    GET: async (request: Request) => {
      try {
        const identity = await authenticate(request, verifyToken);
        const state = await store.load(identity.uid);
        return Response.json({ ...toPublicOnboardingState(state), readiness: getOnboardingReadiness(state) });
      } catch (error) {
        if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
        console.error("Unable to load onboarding:", error);
        return jsonError("Unable to load onboarding.", 500);
      }
    },
    POST: async (request: Request) => {
      let identity: DecodedIdToken;
      try { identity = await authenticate(request, verifyToken); }
      catch { return jsonError("Unauthorized", 401); }

      try {
        const body: unknown = await request.json();
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new OnboardingValidationError("Invalid request.");
        const input = body as Record<string, unknown>;
        const action = input.action;

        if (action === "select_intent") {
          if (!isUserIntent(input.intent) || !isGoalStage(input.stage)) throw new OnboardingValidationError("Choose a valid intent and stage.");
          const state = await store.selectIntent(identity.uid, input.intent, input.stage);
          return Response.json({ ...toPublicOnboardingState(state), readiness: getOnboardingReadiness(state) });
        }

        const state = await store.load(identity.uid);
        if (!state.goal) throw new OnboardingValidationError("Choose an intent first.");

        if (action === "save_answers") {
          validateQuestionnaireVersion(input.questionnaireVersion);
          validateQuestionnaireVersion(state.goal.questionnaireVersion);
          const answers = validateAnswers(state.goal.type, input.answers);
          await store.saveAnswers(identity.uid, state, answers.profile, answers.goal);
        } else if (action === "set_step") {
          const allowed = ["shared", "intent_questions", "review"];
          if (typeof input.step !== "string" || !allowed.includes(input.step)) throw new OnboardingValidationError("Invalid onboarding step.");
          const allAnswers = { ...state.profile.answers, ...state.goal.answers };
          if (input.step === "intent_questions") {
            const missingShared = [...getQuestionMap(state.goal.type).values()]
              .filter((question) => question.scope === "profile" && question.required && !allAnswers[question.id]?.trim());
            if (missingShared.length) throw new OnboardingValidationError("Complete the required profile questions first.");
          }
          if (input.step === "review") validateRequiredAnswers(state.goal.type, allAnswers);
          await store.setStep(identity.uid, state.goal.id, input.step as OnboardingStep);
        } else if (action === "save_summary") {
          if (typeof input.summary !== "string" || !input.summary.trim() || input.summary.trim().length > 1200) {
            throw new OnboardingValidationError("Add a summary of 1,200 characters or fewer.");
          }
          await store.saveSummary(identity.uid, state.goal.id, input.summary.trim());
        } else if (action === "complete") {
          const answers = { ...state.profile.answers, ...state.goal.answers };
          validateRequiredAnswers(state.goal.type, answers);
          const readiness = getOnboardingReadiness(state);
          if (readiness.reason === "resume_required") throw new OnboardingValidationError("Upload a resume before continuing.");
          if (!state.goal.summary?.trim()) throw new OnboardingValidationError("Review and save your summary first.");
          await store.complete(identity.uid, state.goal.id);
        } else {
          throw new OnboardingValidationError("Unknown onboarding action.");
        }

        const updated = await store.load(identity.uid);
        return Response.json({ ...toPublicOnboardingState(updated), readiness: getOnboardingReadiness(updated) });
      } catch (error) {
        if (error instanceof OnboardingValidationError || error instanceof SyntaxError) {
          return jsonError(error instanceof SyntaxError ? "Invalid JSON." : error.message, 400);
        }
        console.error("Unable to update onboarding:", error);
        return jsonError("Unable to update onboarding.", 500);
      }
    },
  };
}

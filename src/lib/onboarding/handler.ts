import type { DecodedIdToken } from "firebase-admin/auth";
import { OnboardingConflictError, OnboardingValidationError } from "./errors";
import { getOnboardingReadiness } from "./readiness";
import {
  getIntentQuestionnaire,
  QUESTIONNAIRE_VERSION,
  sharedQuestionnaire,
} from "./questionnaires";
import type {
  GoalStage,
  OnboardingState,
  OnboardingStep,
  UserIntent,
} from "./types";
import {
  isGoalStage,
  isUserIntent,
  validateAnswers,
  validateQuestionnaireVersion,
} from "./validation";

interface Store {
  load(uid: string): Promise<OnboardingState>;
  selectIntent(
    uid: string,
    intent: UserIntent,
    stage: GoalStage,
    expectedGoalId: string | null,
  ): Promise<OnboardingState>;
  saveAnswers(
    uid: string,
    state: OnboardingState,
    profile: Record<string, string>,
    goal: Record<string, string>,
  ): Promise<void>;
  setStep(
    uid: string,
    state: OnboardingState,
    step: OnboardingStep,
  ): Promise<void>;
  saveSummary(
    uid: string,
    state: OnboardingState,
    summary: string,
  ): Promise<void>;
  complete(uid: string, state: OnboardingState): Promise<void>;
}

type VerifyToken = (
  token: string,
  checkRevoked?: boolean,
) => Promise<DecodedIdToken>;
class UnauthorizedError extends Error {}

export function toPublicOnboardingState(state: OnboardingState) {
  return {
    account: state.account,
    profile: {
      answers: state.profile.answers,
      version: state.profile.version,
      updatedAt: state.profile.updatedAt,
      hasResume: Boolean(state.profile.hasResume),
      resumeSourceId: state.profile.resumeSourceId,
    },
    goal: state.goal,
  };
}

function response(state: OnboardingState) {
  return Response.json({
    ...toPublicOnboardingState(state),
    readiness: getOnboardingReadiness(state),
    questionnaireVersion: QUESTIONNAIRE_VERSION,
    questionnaires: {
      shared: sharedQuestionnaire,
      intent: state.goal ? getIntentQuestionnaire(state.goal.type) : null,
    },
  });
}

async function authenticate(request: Request, verifyToken: VerifyToken) {
  const token = /^Bearer\s+(\S+)$/i.exec(
    request.headers.get("authorization") ?? "",
  )?.[1];
  if (!token) throw new UnauthorizedError();
  try {
    const identity = await verifyToken(token, true);
    if (!identity.uid) throw new UnauthorizedError();
    return identity;
  } catch {
    throw new UnauthorizedError();
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const limit = 128 * 1024;
  const reader = request.body?.getReader();
  if (!reader)
    throw new OnboardingValidationError("A JSON request body is required.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new OnboardingValidationError("The request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new OnboardingValidationError("Invalid request.");
  return body as Record<string, unknown>;
}

function validateWriteContext(
  input: Record<string, unknown>,
  state: OnboardingState,
) {
  if (!state.goal)
    throw new OnboardingValidationError("Choose an intent first.");
  validateQuestionnaireVersion(input.questionnaireVersion);
  validateQuestionnaireVersion(state.goal.questionnaireVersion);
  if (
    input.goalId !== state.goal.id ||
    input.profileVersion !== state.profile.version ||
    input.goalRevision !== (state.goal.revision ?? 0)
  ) {
    throw new OnboardingConflictError(
      "This profile changed. Reload the latest saved answers before continuing.",
    );
  }
}

export function createOnboardingHandler(
  verifyToken: VerifyToken,
  store: Store,
) {
  async function handle(request: Request, profileOnly = false) {
    try {
      const identity = await authenticate(request, verifyToken);
      const input = await readBody(request);
      if (!profileOnly && input.action === "select_intent") {
        if (!isUserIntent(input.intent) || !isGoalStage(input.stage))
          throw new OnboardingValidationError(
            "Choose a valid intent and stage.",
          );
        if (
          input.activeGoalId !== null &&
          typeof input.activeGoalId !== "string"
        )
          throw new OnboardingValidationError(
            "Include the current active goal.",
          );
        return response(
          await store.selectIntent(
            identity.uid,
            input.intent,
            input.stage,
            input.activeGoalId,
          ),
        );
      }
      const state = await store.load(identity.uid);
      validateWriteContext(input, state);
      if (profileOnly || input.action === "save_answers") {
        const answers = validateAnswers(state.goal!.type, input.answers);
        if (profileOnly && Object.keys(answers.goal).length)
          throw new OnboardingValidationError(
            "Only reusable profile answers can be updated here.",
          );
        await store.saveAnswers(
          identity.uid,
          state,
          answers.profile,
          answers.goal,
        );
      } else if (input.action === "set_step") {
        if (
          typeof input.step !== "string" ||
          !["resume", "shared", "intent_questions", "review"].includes(
            input.step,
          )
        )
          throw new OnboardingValidationError("Invalid onboarding step.");
        await store.setStep(identity.uid, state, input.step as OnboardingStep);
      } else if (input.action === "save_summary") {
        if (typeof input.summary !== "string" || input.summary.length > 1200)
          throw new OnboardingValidationError(
            "Keep the summary within 1,200 characters.",
          );
        await store.saveSummary(identity.uid, state, input.summary.trim());
      } else if (input.action === "complete") {
        await store.complete(identity.uid, state);
      } else throw new OnboardingValidationError("Unknown onboarding action.");
      return response(await store.load(identity.uid));
    } catch (error) {
      return failure(error);
    }
  }

  function failure(error: unknown) {
    if (error instanceof UnauthorizedError)
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (error instanceof OnboardingConflictError)
      return Response.json(
        { error: error.message, code: "conflict" },
        { status: 409 },
      );
    if (
      error instanceof OnboardingValidationError ||
      error instanceof SyntaxError
    )
      return Response.json(
        {
          error: error instanceof SyntaxError ? "Invalid JSON." : error.message,
        },
        { status: 400 },
      );
    console.error("Unable to process onboarding:", error);
    return Response.json(
      { error: "Unable to process your profile. Try again later." },
      { status: 500 },
    );
  }

  return {
    GET: async (request: Request) => {
      try {
        const identity = await authenticate(request, verifyToken);
        return response(await store.load(identity.uid));
      } catch (error) {
        return failure(error);
      }
    },
    POST: (request: Request) => handle(request),
    PATCH: (request: Request) => handle(request, true),
  };
}

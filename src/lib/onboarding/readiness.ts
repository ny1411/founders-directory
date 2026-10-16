import { getQuestionMap } from "./questionnaires";
import type { OnboardingState } from "./types";
import { QUESTIONNAIRE_VERSION } from "./questionnaires";

export function getOnboardingReadiness(state: OnboardingState) {
  if (!state.goal)
    return {
      ready: false,
      reason: "intent_required" as const,
      missing: [] as string[],
    };
  if (state.goal.questionnaireVersion !== QUESTIONNAIRE_VERSION)
    return {
      ready: false,
      reason: "questionnaire_outdated" as const,
      missing: [] as string[],
    };
  if (
    state.goal.type === "job" &&
    !state.profile.hasResume &&
    !state.profile.resumeData
  ) {
    return {
      ready: false,
      reason: "resume_required" as const,
      missing: [] as string[],
    };
  }
  const answers = { ...state.profile.answers, ...state.goal.answers };
  const missing = [...getQuestionMap(state.goal.type).values()]
    .filter((question) => question.required && !answers[question.id]?.trim())
    .map((question) => question.id);
  if (missing.length)
    return { ready: false, reason: "answers_required" as const, missing };
  const ready =
    state.goal.currentStep === "complete" &&
    state.goal.status === "active" &&
    state.goal.summaryConfirmed === true &&
    Boolean(state.goal.summary?.trim()) &&
    state.goal.confirmedProfileVersion === state.profile.version;
  return {
    ready,
    reason: ready ? null : ("review_required" as const),
    missing,
  };
}

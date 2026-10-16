import { getQuestionMap } from "./questionnaires";
import type { OnboardingState } from "./types";

export function getOnboardingReadiness(state: OnboardingState) {
  if (!state.goal) return { ready: false, reason: "intent_required" as const, missing: [] as string[] };
  if (state.goal.type === "job" && !state.profile.hasResume && !state.profile.resumeData) {
    return { ready: false, reason: "resume_required" as const, missing: [] as string[] };
  }
  const answers = { ...state.profile.answers, ...state.goal.answers };
  const missing = [...getQuestionMap(state.goal.type).values()]
    .filter((question) => question.required && !answers[question.id]?.trim())
    .map((question) => question.id);
  if (missing.length) return { ready: false, reason: "answers_required" as const, missing };
  return { ready: state.goal.currentStep === "complete", reason: state.goal.currentStep === "complete" ? null : "review_required" as const, missing };
}

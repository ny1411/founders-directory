import { INTENTS, type GoalStage, type UserIntent } from "./types";
import { getQuestionMap, QUESTIONNAIRE_VERSION } from "./questionnaires";

const GOAL_STAGES: GoalStage[] = ["exploring", "actively_looking", "specific_opportunity", "ready_to_talk"];

export class OnboardingValidationError extends Error {}

export function isUserIntent(value: unknown): value is UserIntent {
  return typeof value === "string" && (INTENTS as readonly string[]).includes(value);
}

export function isGoalStage(value: unknown): value is GoalStage {
  return typeof value === "string" && GOAL_STAGES.includes(value as GoalStage);
}

export function validateAnswers(intent: UserIntent, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OnboardingValidationError("Answers must be an object.");
  }
  const questions = getQuestionMap(intent);
  const profile: Record<string, string> = {};
  const goal: Record<string, string> = {};
  for (const [id, rawAnswer] of Object.entries(value)) {
    const question = questions.get(id);
    if (!question) throw new OnboardingValidationError(`Unknown question: ${id}`);
    if (typeof rawAnswer !== "string") throw new OnboardingValidationError(`Invalid answer: ${id}`);
    const answer = rawAnswer.trim();
    if (answer.length > question.maxLength) throw new OnboardingValidationError(`Answer is too long: ${id}`);
    if ((question.input === "url" || id === "links") && answer) {
      const urls = id === "links" ? answer.split(/\s+/) : [answer];
      for (const url of urls) {
        try {
          const parsed = new URL(url);
          if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Unsupported protocol");
        } catch { throw new OnboardingValidationError(`Invalid URL: ${id}`); }
      }
    }
    (question.scope === "profile" ? profile : goal)[id] = answer;
  }
  return { profile, goal };
}

export function validateRequiredAnswers(intent: UserIntent, answers: Record<string, string>) {
  const missing = [...getQuestionMap(intent).values()]
    .filter((question) => question.required && !answers[question.id]?.trim())
    .map((question) => question.id);
  if (missing.length) throw new OnboardingValidationError(`Missing required answers: ${missing.join(", ")}`);
}

export function validateQuestionnaireVersion(value: unknown) {
  if (value !== QUESTIONNAIRE_VERSION) {
    throw new OnboardingValidationError("This questionnaire has changed. Refresh and review your answers.");
  }
}

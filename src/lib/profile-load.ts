import type { OnboardingState } from "./onboarding/types";

export type ProfileLoadState =
  | "loading"
  | "ready"
  | "empty"
  | "auth-error"
  | "backend-error";

export class ProfileRequestError extends Error {
  constructor(
    message: string,
    readonly state: "auth-error" | "backend-error",
  ) {
    super(message);
  }
}

/** Validate the new profile projection before allowing editing. */
export async function readOnboardingResponse(
  response: ProfileResponse,
): Promise<OnboardingState> {
  if (response.status === 401 || response.status === 403)
    throw new ProfileRequestError(
      "Sign in again to load your saved profile.",
      "auth-error",
    );
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : "Unable to load your saved profile.";
    throw new ProfileRequestError(error, "backend-error");
  }
  const object = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value));
  if (
    !object(data) ||
    !object(data.account) ||
    !["new", "in_progress", "complete"].includes(
      String(data.account.onboardingStatus),
    ) ||
    !(
      data.account.activeGoalId === null ||
      typeof data.account.activeGoalId === "string"
    ) ||
    !object(data.profile) ||
    !object(data.profile.answers) ||
    !Object.values(data.profile.answers).every(
      (answer) => typeof answer === "string",
    ) ||
    !Number.isSafeInteger(data.profile.version) ||
    typeof data.profile.updatedAt !== "string" ||
    !(
      data.goal === null ||
      (object(data.goal) &&
        typeof data.goal.id === "string" &&
        data.goal.id === data.account.activeGoalId &&
        object(data.goal.answers) &&
        Object.values(data.goal.answers).every(
          (answer) => typeof answer === "string",
        ) &&
        Number.isSafeInteger(data.goal.questionnaireVersion) &&
        ["job", "sell_services", "find_cofounder", "raise_capital"].includes(
          String(data.goal.type),
        ) &&
        ["resume", "shared", "intent_questions", "review", "complete"].includes(
          String(data.goal.currentStep),
        ))
    )
  ) {
    throw new ProfileRequestError(
      "The saved profile response could not be read. Please retry.",
      "backend-error",
    );
  }
  return data as unknown as OnboardingState;
}

export type ProfileLoadResult =
  | { state: "ready"; resumeText: string }
  | { state: Exclude<ProfileLoadState, "loading" | "ready"> };

type ProfileResponse = Pick<Response, "ok" | "status" | "json">;

/**
 * Interprets the profile endpoint without treating an expected missing profile
 * as a server failure. Invalid success payloads remain failures so callers never
 * enable editing while saved data may be unavailable.
 */
export async function readProfileResponse(
  response: ProfileResponse,
): Promise<ProfileLoadResult> {
  if (response.status === 401 || response.status === 403) {
    return { state: "auth-error" };
  }

  if (response.status === 404) {
    return { state: "empty" };
  }

  if (!response.ok) {
    return { state: "backend-error" };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { state: "backend-error" };
  }

  if (!data || typeof data !== "object" || !("resumeText" in data)) {
    return { state: "backend-error" };
  }

  const { resumeText } = data as { resumeText: unknown };
  if (resumeText == null || resumeText === "") {
    return { state: "empty" };
  }

  if (typeof resumeText !== "string") {
    return { state: "backend-error" };
  }

  return { state: "ready", resumeText };
}

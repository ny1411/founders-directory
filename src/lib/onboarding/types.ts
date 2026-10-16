export const INTENTS = ["job", "sell_services", "find_cofounder", "raise_capital"] as const;

export type UserIntent = (typeof INTENTS)[number];
export type OnboardingStep = "intent" | "resume" | "shared" | "intent_questions" | "review" | "complete";
export type GoalStage = "exploring" | "actively_looking" | "specific_opportunity" | "ready_to_talk";
export type QuestionInput = "text" | "textarea" | "url";

export interface QuestionnaireQuestion {
  id: string;
  label: string;
  helpText?: string;
  input: QuestionInput;
  required?: boolean;
  maxLength: number;
  scope: "profile" | "goal";
  usage: Array<"display" | "matching" | "outreach">;
}

export interface QuestionnaireSection {
  id: "shared" | UserIntent;
  title: string;
  description: string;
  questions: QuestionnaireQuestion[];
}

export interface ReusableProfile {
  answers: Record<string, string>;
  resumeData?: Record<string, unknown> | null;
  hasResume?: boolean;
  version: number;
  updatedAt: string;
}

export interface UserGoal {
  id: string;
  type: UserIntent;
  stage: GoalStage;
  status: "draft" | "active" | "archived";
  currentStep: OnboardingStep;
  answers: Record<string, string>;
  questionnaireVersion: number;
  summary?: string;
  summaryConfirmed?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingAccount {
  onboardingStatus: "new" | "in_progress" | "complete";
  activeGoalId: string | null;
}

export interface OnboardingState {
  account: OnboardingAccount;
  profile: ReusableProfile;
  goal: UserGoal | null;
}

export interface ProfileSource {
  type: "resume_pdf" | "legacy_resume";
  status: "ready" | "failed";
  extractedData: Record<string, unknown>;
  schemaVersion: number;
  importedAt: string;
  updatedAt: string;
}

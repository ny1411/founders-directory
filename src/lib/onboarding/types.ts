export const INTENTS = [
  "job",
  "sell_services",
  "find_cofounder",
  "raise_capital",
] as const;

export type UserIntent = (typeof INTENTS)[number];
export type OnboardingStep =
  | "intent"
  | "resume"
  | "shared"
  | "intent_questions"
  | "review"
  | "complete";
export type GoalStage =
  | "exploring"
  | "actively_looking"
  | "specific_opportunity"
  | "ready_to_talk";
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
  resumeSourceId?: string;
  resumeHash?: string;
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
  revision?: number;
  confirmedProfileVersion?: number;
  summaryProfileVersion?: number;
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
  /** Present only on an explicit authenticated resume-editor request. */
  resumeEditor?: { data: ResumeData | null; unavailable: boolean };
}

export interface ProfileSource {
  type: "resume_pdf" | "legacy_resume" | "resume_edit";
  status: "ready" | "failed";
  extractedData: Record<string, unknown>;
  schemaVersion: number;
  importedAt: string;
  updatedAt: string;
  contentHash: string;
  derivedFrom?: string;
  model: string;
  consentAt: string | null;
  consentBasis: "upload" | "legacy_migration" | "edit";
  rawFileRetention: "not_stored";
}

export interface ResumeItem {
  [key: string]: unknown;
  name?: string;
  company?: string;
  role?: string;
  institution?: string;
  degree?: string;
  duration?: string;
  issuer?: string;
  date?: string;
  description?: string[];
  url?: string;
}

export interface ResumeData extends Record<string, unknown> {
  name?: string;
  location?: string;
  email?: string;
  phone?: string;
  skills?: string[];
  links?: Array<{ label?: string; url: string }>;
  workExperience?: ResumeItem[];
  projects?: ResumeItem[];
  education?: ResumeItem[];
  certificates?: ResumeItem[];
  extracurriculars?: Record<string, ResumeItem[]>;
}

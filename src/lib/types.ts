export interface Company {
  id: string;
  slug: string;
  name: string;
  oneLiner: string | null;
  description: string | null;
  logoUrl: string | null;
  vcBacker: string | null;
  industry: string | null;
  employees: number | null;
  /** Absent on legacy records; omitted submissions are stored as null. */
  stage?: string | null;
  location: string | null;
  foundedYear: number | null;
  website: string | null;
  twitterUrl: string | null;
  linkedinUrl: string | null;
  tags: string[] | null;
  batch: string | null;
  ycUrl: string | null;
  createdAt: string; // Stored as ISO string
  updatedAt: string; // Stored as ISO string
}

export interface Founder {
  id: string;
  companyId: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  twitterUrl: string | null;
  linkedinUrl: string | null;
  bio: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  firebaseId: string;
  email: string;
  /** @deprecated Read only during migration to profile sources. */
  resumeText?: string | null;
  activeGoalId?: string | null;
  onboardingStatus?: "new" | "in_progress" | "complete";
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedMessage {
  id: string;
  userId: string;
  founderId: string;
  goalId: string;
  purpose: import('./onboarding/types').UserIntent;
  profileVersion: number;
  goalRevision: number;
  questionnaireVersion: number;
  playbookVersion: number;
  resumeHash: string;
  channel: "direct_message";
  action: "introduction";
  content: string;
  createdAt: string;
  updatedAt: string;
}

export type {
  GoalStage,
  OnboardingAccount,
  OnboardingState,
  OnboardingStep,
  ProfileSource,
  QuestionnaireQuestion,
  QuestionnaireSection,
  ReusableProfile,
  UserGoal,
  UserIntent,
} from './onboarding/types';

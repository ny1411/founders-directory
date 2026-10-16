import type { Firestore } from "firebase-admin/firestore";
import { QUESTIONNAIRE_VERSION } from "./questionnaires";
import { parseResumeData, profilePrefillFromResume } from "./resume";
import type { GoalStage, OnboardingState, OnboardingStep, ReusableProfile, UserGoal, UserIntent } from "./types";

export const PRIMARY_GOAL_ID = "primary";
const PROFILE_ID = "default";

function emptyProfile(now: string): ReusableProfile {
  return { answers: {}, hasResume: false, version: 1, updatedAt: now };
}

function newGoal(type: UserIntent, stage: GoalStage, now: string): UserGoal {
  return {
    id: PRIMARY_GOAL_ID,
    type,
    stage,
    status: "draft",
    currentStep: type === "job" ? "resume" : "shared",
    answers: {},
    questionnaireVersion: QUESTIONNAIRE_VERSION,
    summaryConfirmed: false,
    createdAt: now,
    updatedAt: now,
  };
}

export class OnboardingStore {
  constructor(private readonly db: Firestore, private readonly clock = () => new Date().toISOString()) {}

  private refs(uid: string, goalId = PRIMARY_GOAL_ID) {
    const user = this.db.collection("users").doc(uid);
    return {
      user,
      profile: user.collection("profiles").doc(PROFILE_ID),
      goal: user.collection("goals").doc(goalId),
      source: user.collection("sources").doc("resume-current"),
    };
  }

  async load(uid: string): Promise<OnboardingState> {
    const now = this.clock();
    const refs = this.refs(uid);
    const [userSnapshot, profileSnapshot] = await Promise.all([refs.user.get(), refs.profile.get()]);
    const userData = userSnapshot.data() ?? {};
    let activeGoalId = typeof userData.activeGoalId === "string" ? userData.activeGoalId : null;
    let profile = profileSnapshot.exists
      ? ({ answers: {}, hasResume: false, ...profileSnapshot.data() } as ReusableProfile)
      : emptyProfile(now);
    let goal: UserGoal | null = null;

    if (activeGoalId) {
      const goalSnapshot = await this.refs(uid, activeGoalId).goal.get();
      goal = goalSnapshot.exists ? ({ id: goalSnapshot.id, ...goalSnapshot.data() } as UserGoal) : null;
      if (!goal) activeGoalId = null;
    }

    if (!goal && typeof userData.resumeText === "string" && userData.resumeText.trim()) {
      let resumeData: Record<string, unknown> | null = null;
      try { resumeData = parseResumeData(JSON.parse(userData.resumeText)); } catch { /* prompt for a fresh upload */ }
      const prefill = resumeData ? profilePrefillFromResume(resumeData) : {};
      profile = {
        ...profile,
        ...prefill,
        answers: { ...(prefill.answers ?? {}), ...(profile.answers ?? {}) },
        version: profile.version || 1,
        updatedAt: now,
      };
      goal = newGoal("job", "actively_looking", now);
      goal.currentStep = resumeData ? "shared" : "resume";
      activeGoalId = PRIMARY_GOAL_ID;
      const batch = this.db.batch();
      batch.set(refs.user, { activeGoalId, onboardingStatus: "in_progress", updatedAt: now }, { merge: true });
      batch.set(refs.profile, profile, { merge: true });
      batch.set(refs.goal, goal, { merge: true });
      if (resumeData) {
        batch.set(refs.source, {
          type: "legacy_resume", status: "ready", extractedData: resumeData,
          schemaVersion: 1, importedAt: now, updatedAt: now,
        }, { merge: true });
      }
      await batch.commit();
    }

    return {
      account: {
        onboardingStatus: userData.onboardingStatus === "complete" ? "complete" : goal ? "in_progress" : "new",
        activeGoalId,
      },
      profile,
      goal,
    };
  }

  async selectIntent(uid: string, type: UserIntent, stage: GoalStage) {
    const now = this.clock();
    const refs = this.refs(uid);
    const goal = newGoal(type, stage, now);
    const batch = this.db.batch();
    batch.set(refs.user, { activeGoalId: PRIMARY_GOAL_ID, onboardingStatus: "in_progress", updatedAt: now }, { merge: true });
    batch.set(refs.goal, goal);
    await batch.commit();
    return this.load(uid);
  }

  async saveAnswers(uid: string, state: OnboardingState, profileAnswers: Record<string, string>, goalAnswers: Record<string, string>) {
    if (!state.goal) throw new Error("Goal not found");
    const now = this.clock();
    const refs = this.refs(uid, state.goal.id);
    const batch = this.db.batch();
    batch.set(refs.profile, {
      answers: { ...state.profile.answers, ...profileAnswers },
      version: (state.profile.version || 0) + 1,
      updatedAt: now,
    }, { merge: true });
    batch.set(refs.goal, { answers: { ...state.goal.answers, ...goalAnswers }, updatedAt: now }, { merge: true });
    await batch.commit();
  }

  async setStep(uid: string, goalId: string, currentStep: OnboardingStep) {
    await this.refs(uid, goalId).goal.set({ currentStep, updatedAt: this.clock() }, { merge: true });
  }

  async saveSummary(uid: string, goalId: string, summary: string) {
    await this.refs(uid, goalId).goal.set({ summary, summaryConfirmed: false, updatedAt: this.clock() }, { merge: true });
  }

  async complete(uid: string, goalId: string) {
    const now = this.clock();
    const refs = this.refs(uid, goalId);
    const batch = this.db.batch();
    batch.set(refs.goal, { currentStep: "complete", status: "active", summaryConfirmed: true, updatedAt: now }, { merge: true });
    batch.set(refs.user, { onboardingStatus: "complete", updatedAt: now }, { merge: true });
    await batch.commit();
  }

  async saveResume(uid: string, data: Record<string, unknown>) {
    const state = await this.load(uid);
    if (!state.goal || state.goal.type !== "job") throw new Error("A job-search goal is required");
    const now = this.clock();
    const prefill = profilePrefillFromResume(data);
    const refs = this.refs(uid, state.goal.id);
    const batch = this.db.batch();
    batch.set(refs.source, {
      type: "resume_pdf", status: "ready", extractedData: data,
      schemaVersion: 1, importedAt: now, updatedAt: now,
    }, { merge: true });
    batch.set(refs.profile, {
      hasResume: true,
      answers: { ...(prefill.answers ?? {}), ...state.profile.answers },
      version: (state.profile.version || 0) + 1,
      updatedAt: now,
    }, { merge: true });
    batch.set(refs.goal, { currentStep: "shared", updatedAt: now }, { merge: true });
    await batch.commit();
  }
}

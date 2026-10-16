import assert from "node:assert/strict";
import test from "node:test";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";

import { createOnboardingHandler } from "./handler";
import { getIntentQuestionnaire, getQuestionMap, QUESTIONNAIRE_VERSION, sharedQuestionnaire } from "./questionnaires";
import { getOnboardingReadiness } from "./readiness";
import { profilePrefillFromResume } from "./resume";
import { OnboardingStore } from "./store";
import type { GoalStage, OnboardingState, OnboardingStep, UserIntent } from "./types";
import { OnboardingValidationError, validateAnswers, validateQuestionnaireVersion, validateRequiredAnswers } from "./validation";

const now = "2026-10-16T00:00:00.000Z";

function state(intent: UserIntent = "sell_services", step: OnboardingStep = "shared"): OnboardingState {
  return {
    account: { onboardingStatus: step === "complete" ? "complete" : "in_progress", activeGoalId: "primary" },
    profile: { answers: {}, hasResume: intent === "job" && step !== "resume", version: 1, updatedAt: now },
    goal: {
      id: "primary", type: intent, stage: "actively_looking", status: step === "complete" ? "active" : "draft",
      currentStep: step, answers: {}, questionnaireVersion: QUESTIONNAIRE_VERSION,
      createdAt: now, updatedAt: now,
    },
  };
}

test("questionnaires expose stable, unique textual questions for every supported intent", () => {
  assert.equal(sharedQuestionnaire.questions.length, 8);
  const expectedCounts: Record<UserIntent, number> = { job: 19, sell_services: 19, find_cofounder: 23, raise_capital: 24 };
  for (const [intent, expected] of Object.entries(expectedCounts) as Array<[UserIntent, number]>) {
    const section = getIntentQuestionnaire(intent);
    assert.equal(section.questions.length, expected);
    assert.equal(new Set(section.questions.map((question) => question.id)).size, expected);
    assert.ok(section.questions.every((question) => question.input === "textarea"));
    assert.equal(getQuestionMap(intent).size, expected + sharedQuestionnaire.questions.length);
  }
});

test("answer validation splits reusable profile and goal answers and rejects untrusted keys", () => {
  assert.deepEqual(validateAnswers("job", { about: " Builder ", desired_role: "Engineer" }), {
    profile: { about: "Builder" }, goal: { desired_role: "Engineer" },
  });
  assert.throws(() => validateAnswers("job", { administrator: true }), OnboardingValidationError);
  assert.throws(() => validateAnswers("job", { about: "x".repeat(1201) }), OnboardingValidationError);
  assert.throws(() => validateQuestionnaireVersion(QUESTIONNAIRE_VERSION + 1), OnboardingValidationError);
});

test("required-answer and readiness checks are intent aware", () => {
  const service = state("sell_services", "review");
  assert.equal(getOnboardingReadiness(service).reason, "answers_required");
  assert.throws(() => validateRequiredAnswers("sell_services", {}), /Missing required answers/);

  const job = state("job", "shared");
  job.profile.hasResume = false;
  assert.equal(getOnboardingReadiness(job).reason, "resume_required");
  const cofounder = state("find_cofounder", "shared");
  assert.notEqual(getOnboardingReadiness(cofounder).reason, "resume_required");
});

test("resume prefill extracts reusable facts without inventing intent answers", () => {
  const prefill = profilePrefillFromResume({
    location: "Bengaluru", skills: ["TypeScript", "Postgres"],
    links: [{ label: "GitHub", url: "https://github.com/example" }],
  });
  assert.equal(prefill.answers?.location_timezone, "Bengaluru");
  assert.match(prefill.answers?.strengths ?? "", /TypeScript/);
  assert.equal("desired_role" in (prefill.answers ?? {}), false);
});

class FakeStore {
  current = state();
  calls: Array<[string, ...unknown[]]> = [];
  async load(uid: string) { this.calls.push(["load", uid]); return this.current; }
  async selectIntent(uid: string, intent: UserIntent, stage: GoalStage) {
    this.calls.push(["select", uid, intent, stage]); this.current = state(intent, intent === "job" ? "resume" : "shared"); return this.current;
  }
  async saveAnswers(uid: string, current: OnboardingState, profile: Record<string, string>, goal: Record<string, string>) {
    this.calls.push(["answers", uid, profile, goal]);
    this.current = { ...current, profile: { ...current.profile, answers: { ...current.profile.answers, ...profile } }, goal: current.goal ? { ...current.goal, answers: { ...current.goal.answers, ...goal } } : null };
  }
  async setStep(uid: string, goalId: string, step: OnboardingStep) { this.calls.push(["step", uid, goalId, step]); if (this.current.goal) this.current.goal.currentStep = step; }
  async saveSummary(uid: string, goalId: string, summary: string) { this.calls.push(["summary", uid, goalId, summary]); if (this.current.goal) this.current.goal.summary = summary; }
  async complete(uid: string, goalId: string) { this.calls.push(["complete", uid, goalId]); if (this.current.goal) this.current.goal.currentStep = "complete"; }
}

function request(body?: unknown, token = "valid") {
  return new Request("http://localhost/api/onboarding", {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("onboarding handler authenticates and branches job seekers through resume first", async () => {
  const store = new FakeStore();
  const verify = async (token: string, revoked?: boolean) => {
    assert.equal(token, "valid"); assert.equal(revoked, true); return { uid: "user-1" } as DecodedIdToken;
  };
  const handler = createOnboardingHandler(verify, store);
  const response = await handler.POST(request({ action: "select_intent", intent: "job", stage: "actively_looking" }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.goal.currentStep, "resume");
  assert.equal("resumeData" in payload.profile, false, "raw resume extraction must not be returned");
  assert.equal(payload.profile.hasResume, false);
  assert.deepEqual(store.calls[0], ["select", "user-1", "job", "actively_looking"]);
});

test("onboarding handler rejects unknown answers without writes", async () => {
  const store = new FakeStore();
  const handler = createOnboardingHandler(async () => ({ uid: "user-1" }) as DecodedIdToken, store);
  const response = await handler.POST(request({ action: "save_answers", questionnaireVersion: QUESTIONNAIRE_VERSION, answers: { unexpected: "value" } }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Unknown question/);
  assert.deepEqual(store.calls, [["load", "user-1"]]);
});

test("onboarding handler turns rejected credentials into 401 without database access", async () => {
  const store = new FakeStore();
  const handler = createOnboardingHandler(async () => { throw new Error("private auth diagnostic"); }, store);
  const response = await handler.GET(request());
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
  assert.deepEqual(store.calls, []);
});

test("legacy resumeText is migrated into a job goal, reusable profile, and source", async () => {
  const records = new Map<string, Record<string, unknown>>([
    ["users/user-1", { resumeText: JSON.stringify({ name: "Ada", location: "London", skills: ["Systems"] }) }],
  ]);
  const reference = (path: string): Record<string, unknown> => ({
    path,
    get: async () => ({ exists: records.has(path), id: path.split("/").at(-1), data: () => records.get(path) }),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      records.set(path, options?.merge ? { ...records.get(path), ...data } : data);
    },
    collection: (name: string) => ({ doc: (id: string) => reference(`${path}/${name}/${id}`) }),
  });
  const db = {
    collection: (name: string) => ({ doc: (id: string) => reference(`${name}/${id}`) }),
    batch: () => {
      const writes: Array<() => Promise<void>> = [];
      return {
        set: (ref: { set: (data: Record<string, unknown>, options?: { merge?: boolean }) => Promise<void> }, data: Record<string, unknown>, options?: { merge?: boolean }) => {
          writes.push(() => ref.set(data, options));
        },
        commit: async () => { await Promise.all(writes.map((write) => write())); },
      };
    },
  } as unknown as Firestore;

  const migrated = await new OnboardingStore(db, () => now).load("user-1");
  assert.equal(migrated.goal?.type, "job");
  assert.equal(migrated.goal?.currentStep, "shared");
  assert.equal(migrated.profile.answers.location_timezone, "London");
  assert.equal(migrated.profile.hasResume, true);
  assert.equal(migrated.profile.resumeData, undefined, "raw extraction belongs only in the source document");
  assert.deepEqual(records.get("users/user-1/sources/resume-current")?.type, "legacy_resume");
  assert.equal(records.get("users/user-1")?.resumeText !== undefined, true, "legacy data remains during transition");
});

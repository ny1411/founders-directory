import assert from "node:assert/strict";
import test from "node:test";
import {
  fixture,
  MemoryFirestore,
  resumeFixture,
} from "../../../scripts/onboarding/fixture";
import {
  getIntentQuestionnaire,
  getQuestionMap,
  QUESTIONNAIRE_VERSION,
  sharedQuestionnaire,
} from "./questionnaires";
import { getOnboardingReadiness } from "./readiness";
import { parseResumeData, resumePrefill } from "./resume";
import { INTENTS, type UserIntent } from "./types";
import { OnboardingValidationError, validateAnswers } from "./validation";

test("all four questionnaires retain the complete requested question sets", () => {
  const counts = {
    job: 19,
    sell_services: 19,
    find_cofounder: 23,
    raise_capital: 24,
  };
  assert.equal(sharedQuestionnaire.questions.length, 8);
  for (const intent of INTENTS) {
    const section = getIntentQuestionnaire(intent);
    assert.equal(section.questions.length, counts[intent]);
    assert.equal(getQuestionMap(intent).size, counts[intent] + 8);
    assert.ok(section.questions.every((q) => q.input === "textarea"));
  }
});

test("normal resume URLs and long prefills remain valid questionnaire answers", () => {
  const data = parseResumeData({
    ...resumeFixture,
    skills: Array.from({ length: 100 }, () => "Postgres".repeat(10)),
  });
  const { profile, goal } = resumePrefill(data);
  assert.doesNotThrow(() => validateAnswers("job", { ...profile, ...goal }));
  assert.equal(
    profile.links,
    "https://github.com/example\nhttps://linkedin.com/in/example",
  );
  assert.match(goal.relevant_experience, /Cut invoice processing time by 40%/);
  assert.match(goal.representative_projects, /50 teams/);
});

test("resume schema rejects empty/malformed extractions and normalizes legacy bullets", () => {
  for (const input of [
    {},
    [],
    { skills: 42 },
    { name: "Ada", workExperience: "wrong shape" },
    { name: "Ada", links: [{ url: "javascript:alert(1)" }] },
  ]) {
    assert.throws(() => parseResumeData(input));
  }
  assert.deepEqual(
    parseResumeData({
      name: "Ada",
      projects: [{ name: "Ledger", description: [{ point: "Shipped" }] }],
    }).projects?.[0].description,
    ["Shipped"],
  );
});

export function required(intent: UserIntent, scope: "profile" | "goal") {
  return Object.fromEntries(
    [...getQuestionMap(intent).values()]
      .filter((q) => q.scope === scope && q.required)
      .map((q) => [q.id, `${q.id} evidence`]),
  );
}

async function must(response: Promise<Response>, status = 200) {
  const result = await response;
  const data = await result.json();
  assert.equal(result.status, status, JSON.stringify(data));
  return data;
}

for (const intent of INTENTS) {
  test(`${intent}: real handlers and persistence complete, resume, review, and edit the full flow`, async () => {
    const f = fixture(intent);
    let state = await must(
      f.post({ action: "select_intent", intent, stage: "actively_looking" }),
    );
    assert.equal(
      state.goal.currentStep,
      intent === "job" ? "resume" : "shared",
    );
    if (intent === "job") {
      await must(f.post({ action: "set_step", step: "shared" }), 400);
      await must(
        f.post({
          action: "save_answers",
          answers: { about: "Cannot skip resume" },
        }),
        400,
      );
      await f.store.saveResume(f.uid, resumeFixture, "a".repeat(64));
      const source = f.memory.records.get(
        `users/${f.uid}/sources/resume-${"a".repeat(64)}`,
      )!;
      assert.equal(source.consentBasis, "upload");
      assert.ok(source.consentAt);
      assert.equal(source.rawFileRetention, "not_stored");
      assert.equal(source.model, "gemini-3.5-flash");
    }
    await must(
      f.post({ action: "save_answers", answers: required(intent, "profile") }),
    );
    await must(f.post({ action: "set_step", step: "intent_questions" }));
    await must(
      f.post({ action: "save_answers", answers: required(intent, "goal") }),
    );
    state = await must(f.post({ action: "set_step", step: "review" }));
    assert.ok(state.goal.summary);
    assert.equal(getOnboardingReadiness(state).ready, false);
    await must(
      f.post({
        action: "save_summary",
        summary: "An accurate, edited profile summary.",
      }),
    );
    state = await must(f.post({ action: "complete" }));
    assert.equal(state.readiness.ready, true);
    const reloaded = await f.state();
    assert.equal(
      reloaded.goal?.summary,
      "An accurate, edited profile summary.",
    );
    assert.equal(getOnboardingReadiness(reloaded).ready, true);
    assert.equal("resumeData" in state.profile, false);
    // A completed profile can be edited through the typed profile endpoint.
    state = await must(
      f.post(
        { answers: { about: "Updated reusable profile" } },
        undefined,
        true,
      ),
    );
    assert.equal(state.goal.currentStep, "review");
    assert.equal(state.readiness.ready, false);
    assert.equal(state.goal.summaryConfirmed, false);
    await must(
      f.post({
        action: "save_summary",
        summary: "Reconfirmed updated profile.",
      }),
    );
    assert.equal(
      (await must(f.post({ action: "complete" }))).readiness.ready,
      true,
    );
  });
}

test("stale versions and simultaneous writes cannot overwrite a newer profile", async () => {
  const f = fixture();
  await must(
    f.post({
      action: "select_intent",
      intent: "sell_services",
      stage: "exploring",
    }),
  );
  const snapshot = await f.state();
  const results = await Promise.all([
    f.post(
      { action: "save_answers", answers: { about: "First edit" } },
      snapshot,
    ),
    f.post(
      { action: "save_answers", answers: { about: "Stale edit" } },
      snapshot,
    ),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 409],
  );
  assert.equal((await f.state()).profile.answers.about, "First edit");
});

test("unchanged patches do not write and a lost response can be replayed", async () => {
  const f = fixture();
  await must(f.post({ action: "select_intent", intent: "sell_services", stage: "exploring" }));
  const initial = await f.state();
  const initialWrites = f.memory.writes;
  await must(f.post({ action: "save_answers", answers: {} }, initial));
  assert.equal(f.memory.writes, initialWrites);
  assert.equal((await f.state()).goal?.revision, initial.goal?.revision);

  const patch = { action: "save_answers", answers: { about: "A short introduction" } };
  await must(f.post(patch, initial));
  const saved = await f.state();
  const writes = f.memory.writes;
  await must(f.post(patch, initial));
  assert.equal(f.memory.writes, writes);
  assert.equal((await f.state()).goal?.revision, saved.goal?.revision);
  await must(f.post({ ...patch, answers: { about: "An older edit" } }, initial), 409);
});

test("stage transitions, unconfirmed summaries, and outdated questionnaires fail closed", async () => {
  const f = fixture();
  await must(
    f.post({
      action: "select_intent",
      intent: "sell_services",
      stage: "exploring",
    }),
  );
  await must(f.post({ action: "set_step", step: "review" }), 400);
  await must(f.post({ action: "save_summary", summary: "Skip review" }), 400);
  await must(f.post({ action: "complete" }), 400);
  const goal = f.memory.records.get(`users/${f.uid}/goals/goal-sell_services`)!;
  goal.questionnaireVersion = QUESTIONNAIRE_VERSION - 1;
  await must(f.post({ action: "complete" }), 400);
  assert.equal(getOnboardingReadiness(await f.state()).ready, false);
});

test("changing goals preserves old answers and switching back restores them", async () => {
  const f = fixture();
  await must(
    f.post({
      action: "select_intent",
      intent: "sell_services",
      stage: "exploring",
    }),
  );
  await must(
    f.post({
      action: "save_answers",
      answers: { about: "Builder", service: "Lifecycle marketing" },
    }),
  );
  await must(
    f.post({
      action: "select_intent",
      intent: "find_cofounder",
      stage: "actively_looking",
    }),
  );
  assert.equal(
    f.memory.records.get(`users/${f.uid}/goals/goal-sell_services`)?.status,
    "archived",
  );
  await must(
    f.post({
      action: "save_answers",
      answers: {
        building: "An accounting tool",
        about: "Builder with a new direction",
      },
    }),
  );
  const restored = await must(
    f.post({
      action: "select_intent",
      intent: "sell_services",
      stage: "ready_to_talk",
    }),
  );
  assert.equal(restored.goal.answers.service, "Lifecycle marketing");
  assert.equal(restored.profile.answers.about, "Builder with a new direction");
  assert.match(restored.goal.summary, /Builder with a new direction/);
  assert.equal(
    f.memory.records.get(`users/${f.uid}/goals/goal-find_cofounder`)?.answers
      .building,
    "An accounting tool",
  );
});

test("legacy migration is transactional, retains the original, and prefills job questions", async () => {
  const memory = new MemoryFirestore();
  memory.records.set("users/legacy", {
    resumeText: JSON.stringify(resumeFixture),
  });
  const f = fixture("legacy", memory);
  await Promise.all([f.state(), f.state()]);
  const state = await f.state();
  assert.equal(state.goal?.currentStep, "shared");
  assert.match(state.goal?.answers.relevant_experience ?? "", /40%/);
  assert.equal(state.profile.version, 1);
  assert.equal(state.profile.resumeData, undefined);
  assert.ok(memory.records.get("users/legacy")?.resumeText);
  const source = memory.records.get(
    `users/legacy/sources/${state.profile.resumeSourceId}`,
  )!;
  assert.equal(
    source.consentAt,
    null,
    "migration must not invent upload consent",
  );
});

test("repeat resume imports are idempotent and preserve explicit answer edits", async () => {
  const f = fixture();
  await must(
    f.post({ action: "select_intent", intent: "job", stage: "exploring" }),
  );
  await f.store.saveResume(f.uid, resumeFixture, "b".repeat(64));
  await must(
    f.post({
      action: "save_answers",
      answers: { relevant_experience: "My own account of the work." },
    }),
  );
  const version = (await f.state()).profile.version;
  await f.store.saveResume(f.uid, resumeFixture, "b".repeat(64));
  const state = await f.state();
  assert.equal(
    state.goal?.answers.relevant_experience,
    "My own account of the work.",
  );
  assert.equal(state.profile.version, version);
  assert.equal(
    [...f.memory.records.keys()].filter((path) => path.includes("/sources/"))
      .length,
    1,
  );
  await f.store.saveResume(
    f.uid,
    { ...resumeFixture, skills: ["Rust"] },
    "c".repeat(64),
  );
  const replaced = await f.state();
  assert.equal(
    replaced.profile.answers.strengths,
    "Rust",
    "replace prior automatic prefills",
  );
  assert.equal(
    replaced.goal?.answers.relevant_experience,
    "My own account of the work.",
    "retain user-authored answers",
  );
});

test("a malformed source from the first release returns job onboarding to resume upload", async () => {
  const memory = new MemoryFirestore();
  memory.records.set("users/old-release", {
    activeGoalId: "primary",
    onboardingStatus: "complete",
  });
  memory.records.set("users/old-release/profiles/default", {
    answers: {},
    hasResume: true,
    version: 1,
  });
  memory.records.set("users/old-release/goals/primary", {
    id: "primary",
    type: "job",
    stage: "exploring",
    status: "active",
    currentStep: "complete",
    answers: {},
    questionnaireVersion: 1,
    summaryConfirmed: true,
    summary: "Old summary",
  });
  memory.records.set("users/old-release/sources/resume-current", {
    extractedData: {},
  });
  const f = fixture("old-release", memory);
  const state = await f.state();
  assert.equal(state.goal?.currentStep, "resume");
  assert.equal(state.profile.hasResume, false);
  assert.equal(getOnboardingReadiness(state).ready, false);
  await f.store.saveResume(f.uid, resumeFixture);
  assert.equal((await f.state()).goal?.currentStep, "shared");
});

test("profile API rejects goal data and legacy resumeText writes; validation covers unsafe inputs", async () => {
  const f = fixture();
  await must(
    f.post({
      action: "select_intent",
      intent: "sell_services",
      stage: "exploring",
    }),
  );
  for (const answers of [
    { unknown: "x" },
    { about: 42 },
    { about: "x".repeat(1201) },
    { links: "javascript:alert(1)" },
  ]) {
    await must(f.post({ action: "save_answers", answers }), 400);
  }
  await must(
    f.post({ answers: { service: "Should be goal only" } }, undefined, true),
    400,
  );
  await must(
    f.post({ resumeText: "must not write this" }, undefined, true),
    400,
  );
  assert.throws(
    () => validateAnswers("job", { links: "https://name:secret@example.com" }),
    OnboardingValidationError,
  );
});

test("missing and rejected credentials do not read the body or touch private persistence", async () => {
  const f = fixture();
  for (const authorization of ["", "Bearer invalid"]) {
    const request = new Request("http://localhost/api/onboarding", {
      method: "POST",
      headers: { authorization },
      body: "{}",
    });
    assert.equal((await f.handlers.POST(request)).status, 401);
    assert.equal(request.bodyUsed, false);
    assert.equal(f.memory.writes, 0);
  }
});

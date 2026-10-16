import assert from "node:assert/strict";
import test from "node:test";
import type { Company, Founder } from "../types";
import { fixture, resumeFixture } from "../../../scripts/onboarding/fixture";
import { getQuestionMap } from "./questionnaires";
import {
  buildMessageInput,
  createMessageHandler,
  messageKey,
} from "./messages";
import { INTENTS, type OnboardingState, type UserIntent } from "./types";

const target = {
  company: {
    id: "company",
    name: "EarlyCo",
    description: "Accounting software",
    slug: "earlyco",
  } as Company,
  founder: { id: "founder", name: "Founder", companyId: "company" } as Founder,
};

async function complete(f: ReturnType<typeof fixture>, intent: UserIntent) {
  assert.equal(
    (
      await f.post({
        action: "select_intent",
        intent,
        stage: "actively_looking",
      })
    ).status,
    200,
  );
  if (intent === "job") await f.store.saveResume(f.uid, resumeFixture);
  const answers = Object.fromEntries(
    [...getQuestionMap(intent).values()]
      .filter((q) => q.required)
      .map((q) => [q.id, `${q.id} evidence`]),
  );
  assert.equal((await f.post({ action: "save_answers", answers })).status, 200);
  assert.equal(
    (await f.post({ action: "set_step", step: "intent_questions" })).status,
    200,
  );
  assert.equal(
    (await f.post({ action: "set_step", step: "review" })).status,
    200,
  );
  assert.equal((await f.post({ action: "complete" })).status, 200);
}

test("message identities separate user, target, intent, goals, evidence, and schema versions", async () => {
  const f = fixture();
  await complete(f, "job");
  const state = await f.state();
  const key = messageKey(f.uid, "founder", state);
  const variants: OnboardingState[] = [
    {
      ...state,
      profile: { ...state.profile, version: state.profile.version + 1 },
    },
    { ...state, profile: { ...state.profile, resumeHash: "different-source" } },
    { ...state, goal: { ...state.goal!, id: "other-job-goal" } },
    { ...state, goal: { ...state.goal!, type: "sell_services" } },
    {
      ...state,
      goal: { ...state.goal!, revision: (state.goal!.revision ?? 0) + 1 },
    },
    { ...state, goal: { ...state.goal!, questionnaireVersion: 999 } },
  ];
  for (const variant of variants)
    assert.notEqual(messageKey(f.uid, "founder", variant), key);
  assert.notEqual(messageKey("other-user", "founder", state), key);
  assert.notEqual(messageKey(f.uid, "other-founder", state), key);
});

test("real goal flows generate and cache distinct messages, including full private job evidence", async () => {
  const f = fixture();
  const cache = new Map<string, string>();
  const generated: ReturnType<typeof buildMessageInput>[] = [];
  const handler = createMessageHandler({
    verifyToken: async (_token, revoked) => {
      assert.equal(revoked, true);
      return { uid: f.uid };
    },
    load: () => f.state(),
    getResume: (uid, state) => f.store.getResumeContext(uid, state),
    getTarget: async () => target,
    getCached: async (key) => cache.get(key) ?? null,
    save: async (key, value) => {
      cache.set(key, value.content as string);
    },
    generate: async (input) => {
      generated.push(input);
      return `Draft ${generated.length}`;
    },
  });
  const request = () =>
    new Request("http://localhost/api/generate-dm", {
      method: "POST",
      headers: {
        authorization: "Bearer fixture",
        "content-type": "application/json",
      },
      body: JSON.stringify({ founderId: "founder", companySlug: "earlyco" }),
    });
  for (const intent of INTENTS) {
    await complete(f, intent);
    const response = await handler(request());
    assert.equal(response.status, 200);
    const first = await response.json();
    assert.deepEqual(await (await handler(request())).json(), first);
  }
  assert.equal(
    generated.length,
    4,
    "a second request for unchanged context reuses the draft",
  );
  assert.deepEqual(
    generated[0].data.resume,
    resumeFixture,
    "the server reads complete resume evidence from the private source",
  );
  assert.equal(
    "resume" in generated[1].data,
    false,
    "a service pitch must not accidentally inherit job-specific source data",
  );
  assert.match(generated[1].instructions, /B2B/);
  assert.match(generated[2].instructions, /cofounder/);
  assert.match(generated[3].instructions, /fundraising/);

  await f.post({
    action: "save_answers",
    answers: { about: "Profile edited after confirmation" },
  });
  assert.equal((await handler(request())).status, 409);
  assert.equal(
    generated.length,
    4,
    "unconfirmed edits never trigger paid generation",
  );
});

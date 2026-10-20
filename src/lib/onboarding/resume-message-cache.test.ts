import assert from "node:assert/strict";
import test from "node:test";
import { fixture, resumeFixture } from "../../../scripts/onboarding/fixture";
import type { Company, Founder } from "../types";
import { createMessageHandler } from "./messages";
import { getQuestionMap } from "./questionnaires";
import type { ResumeData } from "./types";

for (const mode of ["PDF replacement", "manual correction"] as const) {
  test(`${mode} refreshes the same founder's DM while unchanged requests reuse it`, async () => {
    const f = fixture();
    const founderId = "same-founder";
    const companySlug = "earlyco";
    const original: ResumeData = {
      ...resumeFixture,
      certificates: [
        { name: "Distributed systems", description: ["Original evidence"] },
      ],
    };
    // Certificate details are private source evidence, absent from questionnaire prefill.
    const edited: ResumeData = {
      ...original,
      certificates: [
        { name: "Distributed systems", description: ["Corrected evidence"] },
      ],
    };
    assert.equal(
      (await f.post({
        action: "select_intent",
        intent: "job",
        stage: "actively_looking",
      })).status,
      200,
    );
    await f.store.saveResume(
      f.uid,
      original,
      mode === "PDF replacement" ? "original-pdf-content-hash" : undefined,
    );
    const answers = Object.fromEntries(
      [...getQuestionMap("job").values()]
        .filter((question) => question.required)
        .map((question) => [question.id, `${question.id} evidence`]),
    );
    assert.equal((await f.post({ action: "save_answers", answers })).status, 200);

    async function confirm() {
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
    await confirm();

    // The old implementation queried any message for the user/founder pair.
    // Keep a matching unversioned document with a valid TTL to detect such reuse.
    const legacyPath = "generatedMessages/legacy-auto-generated-id";
    const legacy = {
      userId: f.uid,
      founderId,
      content: "Stale legacy draft",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    f.memory.records.set(legacyPath, legacy);
    const generated: ResumeData[] = [];
    const savedKeys: string[] = [];
    const handler = createMessageHandler({
      verifyToken: async (token, revoked) => {
        assert.equal(token, f.uid);
        assert.equal(revoked, true);
        return { uid: f.uid };
      },
      load: (uid) => f.store.load(uid),
      getResume: (uid, state) => f.store.getResumeContext(uid, state),
      getTarget: async (requestedFounder, requestedCompany) => {
        assert.equal(requestedFounder, founderId);
        assert.equal(requestedCompany, companySlug);
        return {
          company: {
            id: "company", name: "EarlyCo", slug: companySlug,
          } as Company,
          founder: {
            id: founderId, name: "Founder", companyId: "company",
          } as Founder,
        };
      },
      getCached: async (key) => {
        const draft = f.memory.records.get(`generatedMessages/${key}`);
        return draft && Date.parse(draft.expiresAt) > Date.now()
          ? draft.content
          : null;
      },
      save: async (key, draft) => {
        savedKeys.push(key);
        f.memory.records.set(`generatedMessages/${key}`, structuredClone(draft));
      },
      generate: async ({ data }) => {
        assert.ok(data.resume);
        generated.push(structuredClone(data.resume));
        return `Draft using ${data.resume.certificates![0].description![0]}`;
      },
    });
    function request() {
      return handler(
        new Request("http://localhost/api/generate-dm", {
          method: "POST",
          headers: {
            authorization: `Bearer ${f.uid}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ founderId, companySlug }),
        }),
      );
    }
    async function draft() {
      const response = await request();
      assert.equal(response.status, 200);
      return response.json();
    }

    const first = await draft();
    assert.deepEqual(first, { dmText: "Draft using Original evidence" });
    assert.deepEqual(await draft(), first);
    assert.equal(
      generated.length, 1,
      "unchanged requests must not spend another generation",
    );
    assert.deepEqual(generated[0], original);
    const beforeEdit = await f.state();

    await f.store.saveResume(
      f.uid,
      edited,
      mode === "PDF replacement" ? "replacement-pdf-content-hash" : undefined,
    );
    // A fresh load reads persisted data rather than a patched in-memory state.
    const afterEdit = await f.state();
    assert.notEqual(afterEdit.profile.resumeHash, beforeEdit.profile.resumeHash);
    assert.ok(afterEdit.profile.version > beforeEdit.profile.version);
    assert.deepEqual(afterEdit.profile.answers, beforeEdit.profile.answers);
    assert.deepEqual(afterEdit.goal!.answers, beforeEdit.goal!.answers);
    assert.deepEqual(await f.store.getResumeContext(f.uid, afterEdit), edited);
    assert.equal(
      (await request()).status, 409,
      "new evidence must be confirmed before generating",
    );
    assert.equal(generated.length, 1);
    await confirm();

    const second = await draft();
    assert.deepEqual(second, { dmText: "Draft using Corrected evidence" });
    assert.notDeepEqual(second, first);
    assert.deepEqual(await draft(), second);
    assert.equal(
      generated.length, 2,
      "the changed resume generates once, then reuses its new draft",
    );
    assert.deepEqual(generated[1], edited);
    assert.equal(
      new Set(savedKeys).size, 2,
      "old and new resume drafts have separate cache identities",
    );
    assert.equal(
      f.memory.records.get(`generatedMessages/${savedKeys[0]}`)?.content,
      first.dmText,
    );
    assert.equal(
      f.memory.records.get(`generatedMessages/${savedKeys[1]}`)?.content,
      second.dmText,
    );
    assert.deepEqual(
      f.memory.records.get(legacyPath), legacy,
      "legacy drafts are ignored without destructive cleanup",
    );
  });
}

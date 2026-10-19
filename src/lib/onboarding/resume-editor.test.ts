import assert from "node:assert/strict";
import test from "node:test";
import { fixture, MemoryFirestore, resumeFixture, writeContext } from "../../../scripts/onboarding/fixture";

async function job(uid = "resume-owner", memory = new MemoryFirestore()) {
  const f = fixture(uid, memory);
  assert.equal((await f.post({ action: "select_intent", intent: "job", stage: "actively_looking" })).status, 200);
  await f.store.saveResume(uid, resumeFixture);
  return f;
}

test("resume retrieval is explicit, authenticated, private, and scoped to the verified owner", async () => {
  const memory = new MemoryFirestore();
  const owner = await job("owner", memory);
  const other = await job("other", memory);
  await other.store.saveResume("other", { name: "Other person's private resume" });
  const standard = await owner.handlers.GET(new Request("http://localhost", { headers: { authorization: "Bearer owner" } }));
  const standardBody = await standard.json();
  assert.equal(standardBody.resumeEditor, undefined);
  assert.equal(standardBody.profile.resumeData, undefined);
  const privateResponse = await owner.post({ action: "load_resume", uid: "other" });
  assert.equal(privateResponse.status, 200);
  assert.equal(privateResponse.headers.get("cache-control"), "private, no-store");
  const data = await privateResponse.json();
  assert.equal(data.resumeEditor.data.name, resumeFixture.name);
  assert.equal(data.resumeEditor.unavailable, false);
  for (const token of [undefined, "other"]) {
    const response = await owner.handlers.POST(new Request("http://localhost", {
      method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action: "load_resume", ...writeContext(await owner.state()) }),
    }));
    assert.equal(response.status, 401);
  }
});

test("corrected private resume persists, updates prefills without overwriting questionnaire edits, and invalidates confirmation/hash", async () => {
  const f = await job();
  await f.post({ action: "save_answers", answers: { about: "My personally written answer" } });
  const before = await f.state();
  const result = await f.post({ action: "save_resume", resume: { ...resumeFixture, name: "Corrected name", workExperience: [{ company: "Corrected company", role: "Lead", duration: "2022 – 2026", description: ["Corrected result"] }] } }, before);
  assert.equal(result.status, 200);
  const saved = await f.state();
  assert.equal(saved.profile.answers.about, "My personally written answer");
  assert.match(saved.goal!.answers.relevant_experience, /Corrected company/);
  assert.notEqual(saved.profile.resumeHash, before.profile.resumeHash);
  assert.equal(saved.profile.version, before.profile.version + 1);
  assert.equal(saved.goal!.summaryConfirmed, false);
  assert.equal((await f.store.getResumeContext(f.uid, saved))?.name, "Corrected name");
  const source = f.memory.records.get(`users/${f.uid}/sources/${saved.profile.resumeSourceId}`)!;
  assert.equal(source.derivedFrom, before.profile.resumeSourceId);
  assert.equal(source.consentBasis, "edit");
  const reloaded = await f.post({ action: "load_resume" });
  assert.equal((await reloaded.json()).resumeEditor.data.workExperience[0].role, "Lead");
});

test("invalid edits and stale revisions preserve saved private data and expose actionable errors", async () => {
  const f = await job();
  const before = await f.state();
  const invalid = await f.post({ action: "save_resume", resume: { ...resumeFixture, projects: [{ name: "Example", url: "javascript:alert(1)" }] } });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /projects.*item 1.*url/);
  assert.deepEqual(await f.state(), before);
  await f.post({ action: "save_answers", answers: { about: "Another tab changed this" } });
  const response = await f.post({ action: "save_resume", resume: { name: "Stale edit" } }, before);
  assert.equal(response.status, 409);
  assert.equal((await f.store.getResumeContext(f.uid, await f.state()))?.name, resumeFixture.name);
});

test("malformed or missing legacy source can be recovered by saving corrected details", async () => {
  for (const malformed of [undefined, { name: "Legacy", skills: 42 }]) {
    const f = await job();
    const state = await f.state();
    const path = `users/${f.uid}/sources/${state.profile.resumeSourceId}`;
    if (malformed) f.memory.records.set(path, { extractedData: malformed });
    else f.memory.records.delete(path);
    const response = await f.post({ action: "load_resume" });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).resumeEditor, { data: null, unavailable: true });
    assert.equal((await f.post({ action: "save_resume", resume: { name: "Recovered person" } })).status, 200);
    assert.equal((await f.store.getResumeContext(f.uid, await f.state()))?.name, "Recovered person");
  }
});

test("resume editing rejects non-job goals and bounded oversized requests", async () => {
  const f = fixture();
  await f.post({ action: "select_intent", intent: "sell_services", stage: "exploring" });
  assert.equal((await f.post({ action: "load_resume" })).status, 400);
  assert.equal((await f.post({ action: "save_resume", resume: { name: "No job goal" } })).status, 400);
  assert.equal((await f.post({ action: "save_resume", resume: { name: "x".repeat(300_000) } })).status, 400);
});

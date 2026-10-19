import assert from "node:assert/strict";
import test from "node:test";
import { ColdDmErrorPanel } from "../../components/cold-dm-error-panel";
import type { Company, Founder } from "../types";
import { fixture, resumeFixture } from "../../../scripts/onboarding/fixture";
import { getQuestionMap } from "./questionnaires";
import {
  MessageGenerationError,
  readMessageGenerationResponse,
} from "./message-client";
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

type Element = { type: unknown; props: Record<string, unknown> };

function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}

function textContent(node: unknown): string {
  return elements(node)
    .flatMap((element) =>
      Array.isArray(element.props.children)
        ? element.props.children
        : [element.props.children],
    )
    .filter((child) => typeof child === "string" || typeof child === "number")
    .join(" ");
}

function request(authorization?: string) {
  return new Request("http://localhost/api/generate-dm", {
    method: "POST",
    headers: {
      ...(authorization ? { authorization } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify({ founderId: "founder", companySlug: "earlyco" }),
  });
}

function authFixture(
  verifyToken: (token: string, revoked: boolean) => Promise<{ uid: string }>,
) {
  const calls = {
    verify: 0,
    load: 0,
    resume: 0,
    target: 0,
    cache: 0,
    save: 0,
    generate: 0,
  };
  const unexpected = (name: Exclude<keyof typeof calls, "verify">) => {
    calls[name] += 1;
    throw new Error(`Unexpected ${name} call`);
  };
  return {
    calls,
    handler: createMessageHandler({
      verifyToken: async (token: string, revoked: boolean) => {
        calls.verify += 1;
        return verifyToken(token, revoked);
      },
      load: async () => unexpected("load"),
      getResume: async () => unexpected("resume"),
      getTarget: async () => unexpected("target"),
      getCached: async () => unexpected("cache"),
      save: async () => unexpected("save"),
      generate: async () => unexpected("generate"),
    }),
  };
}

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
  assert.notEqual(
    messageKey(f.uid, "founder", state, { companyUpdatedAt: "new-version" }),
    key,
  );
});

test("DM request quotas reject before profile reads and return Retry-After", async () => {
  const handler = createMessageHandler({
    verifyToken: async () => ({ uid: "user" }),
    quota: async (_uid, _request, kind) => {
      assert.equal(kind, "request");
      return { allowed: false, retryAfterSeconds: 42 };
    },
    load: async () => {
      throw new Error("Must not read profile");
    },
    getResume: async () => null,
    getTarget: async () => target,
    getCached: async () => null,
    save: async () => {},
    generate: async () => {
      throw new Error("Must not spend credits");
    },
  });
  const response = await handler(request("Bearer token"));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "42");
  const malformed = new Request("http://localhost/api/generate-dm", {
    method: "POST",
    headers: { authorization: "Bearer token" },
    body: "malformed JSON",
  });
  assert.equal(
    (await handler(malformed)).status,
    429,
    "admission must run before JSON parsing",
  );
  assert.equal(malformed.bodyUsed, false);
});

test("DM rejects streamed oversized JSON before profile or provider work", async () => {
  const f = authFixture(async () => ({ uid: "user" }));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          JSON.stringify({
            founderId: "founder",
            companySlug: "earlyco",
            padding: "x".repeat(5000),
          }),
        ),
      );
      controller.close();
    },
  });
  const streamed = new Request("http://localhost/api/generate-dm", {
    method: "POST",
    headers: { authorization: "Bearer token" },
    body,
    duplex: "half",
  } as RequestInit);
  assert.equal(streamed.headers.has("content-length"), false);
  assert.equal((await f.handler(streamed)).status, 413);
  assert.equal(f.calls.load, 0);
  assert.equal(f.calls.generate, 0);
});

test("shared DM leases prevent duplicate paid generation and release after completion", async () => {
  const f = fixture();
  await complete(f, "sell_services");
  let unlockGeneration!: () => void;
  const blocked = new Promise<void>((resolve) => {
    unlockGeneration = resolve;
  });
  let started!: () => void;
  const generating = new Promise<void>((resolve) => {
    started = resolve;
  });
  let lease: string | null = null;
  let generations = 0;
  let generationBudgets = 0;
  let cached: string | null = null;
  const handler = createMessageHandler({
    verifyToken: async () => ({ uid: f.uid }),
    load: () => f.state(),
    getResume: async () => null,
    getTarget: async () => target,
    getCached: async () => cached,
    quota: async (_uid, _request, kind) => {
      if (kind === "generation") generationBudgets++;
      return { allowed: true, retryAfterSeconds: 0 };
    },
    acquire: async () => {
      if (lease) return null;
      lease = "owner";
      return lease;
    },
    release: async (_key, token) => {
      assert.equal(token, "owner");
      lease = null;
    },
    save: async (_key, value) => {
      cached = value.content as string;
      const age =
        Date.parse(value.expiresAt as string) -
        Date.parse(value.createdAt as string);
      assert.ok(Math.abs(age - 86_400_000) < 1000);
    },
    generate: async () => {
      generations++;
      started();
      await blocked;
      return "one draft";
    },
  });
  const first = handler(request("Bearer token"));
  await generating;
  const duplicate = await handler(request("Bearer token"));
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.headers.get("retry-after"), "5");
  unlockGeneration();
  assert.equal((await first).status, 200);
  assert.equal(lease, null);
  assert.equal((await handler(request("Bearer token"))).status, 200);
  assert.equal(generations, 1);
  assert.equal(generationBudgets, 1);
});

test("exhausted DM generation budgets release the lease without paid generation", async () => {
  const f = fixture();
  await complete(f, "sell_services");
  let released = false;
  const handler = createMessageHandler({
    verifyToken: async () => ({ uid: f.uid }),
    load: () => f.state(),
    getResume: async () => null,
    getTarget: async () => target,
    getCached: async () => null,
    quota: async (_uid, _request, kind) => ({
      allowed: kind === "request",
      retryAfterSeconds: 600,
    }),
    acquire: async () => "owner",
    release: async () => {
      released = true;
    },
    save: async () => {
      throw new Error("Must not save");
    },
    generate: async () => {
      throw new Error("Must not generate");
    },
  });
  const response = await handler(request("Bearer token"));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "600");
  assert.equal(released, true);
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

test("missing and malformed message credentials return 401 before verification or data work", async () => {
  for (const authorization of [
    undefined,
    "",
    "Basic password",
    "Bearer",
    "Bearer one two",
  ]) {
    const f = authFixture(async () => ({ uid: "authenticated-user" }));
    const response = await f.handler(request(authorization));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized" });
    assert.deepEqual(f.calls, {
      verify: 0,
      load: 0,
      resume: 0,
      target: 0,
      cache: 0,
      save: 0,
      generate: 0,
    });
  }
});

test("invalid, expired, revoked, and disabled message credentials return 401 before data work", async () => {
  for (const code of [
    "auth/argument-error",
    "auth/invalid-argument",
    "auth/invalid-id-token",
    "auth/id-token-expired",
    "auth/id-token-revoked",
    "auth/user-disabled",
    "auth/user-not-found",
  ]) {
    const f = authFixture(async (token, revoked) => {
      assert.equal(token, "invalid-token");
      assert.equal(revoked, true);
      throw Object.assign(new Error("private Firebase diagnostic"), { code });
    });
    const response = await f.handler(request("Bearer invalid-token"));
    assert.equal(response.status, 401, code);
    assert.deepEqual(await response.json(), { error: "Unauthorized" });
    assert.equal(f.calls.verify, 1);
    assert.equal(f.calls.load, 0);
    assert.equal(f.calls.target, 0);
    assert.equal(f.calls.generate, 0);
  }
  const missingIdentity = authFixture(async () => ({ uid: "" }));
  const response = await missingIdentity.handler(request("Bearer no-identity"));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
  assert.equal(missingIdentity.calls.load, 0);
});

test("authentication infrastructure failures remain safe logged 5xx errors", async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
  const f = authFixture(async () => {
    throw Object.assign(
      new Error("private Firebase infrastructure diagnostic"),
      { code: "auth/internal-error" },
    );
  });
  const response = await f.handler(request("Bearer valid-shape"));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Unable to generate a message right now.",
  });
  assert.equal(f.calls.load, 0);
  assert.equal(f.calls.target, 0);
  assert.equal(f.calls.generate, 0);
  assert.equal(logged.length, 1);
  assert.match(String(logged[0][0]), /verify message generation session/);
});

test("unexpected data failures remain safe logged 5xx errors", async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
  const f = authFixture(async () => ({ uid: "authenticated-user" }));
  const response = await f.handler(request("Bearer valid-token"));
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.deepEqual(body, { error: "Unable to generate a message right now." });
  assert.equal(f.calls.load, 1);
  assert.equal(f.calls.target, 0);
  assert.equal(f.calls.generate, 0);
  assert.equal(logged.length, 1);
  assert.match(String(logged[0][0]), /generate message/);
  assert.doesNotMatch(JSON.stringify(body), /Unexpected load/);
});

test("message clients classify session expiry and never display unsafe 5xx details", async () => {
  await assert.rejects(
    readMessageGenerationResponse(
      Response.json(
        { error: "Firebase token decoding failed: private diagnostic" },
        { status: 401 },
      ),
    ),
    (error: unknown) =>
      error instanceof MessageGenerationError &&
      error.failure === "auth" &&
      /session has expired/.test(error.message) &&
      !/Firebase|private/.test(error.message),
  );
  await assert.rejects(
    readMessageGenerationResponse(
      Response.json(
        { error: "Gemini provider key leaked in private diagnostic" },
        { status: 500 },
      ),
    ),
    (error: unknown) =>
      error instanceof MessageGenerationError &&
      error.failure === "request" &&
      /try again/.test(error.message) &&
      !/Gemini|private/.test(error.message),
  );
  await assert.rejects(
    readMessageGenerationResponse(
      Response.json(
        {
          error:
            "Review and complete your profile before generating a message.",
        },
        { status: 409 },
      ),
    ),
    {
      message: "Review and complete your profile before generating a message.",
      failure: "request",
    },
  );
  assert.equal(
    await readMessageGenerationResponse(Response.json({ dmText: "Hello" })),
    "Hello",
  );
});

test("expired-session message UI exposes an actionable sign-in path", () => {
  let recoveries = 0;
  const tree = ColdDmErrorPanel({
    failure: "auth",
    message:
      "Your session has expired. Sign in again to create a custom message.",
    recoveringSession: false,
    onRecoverSession: () => {
      recoveries += 1;
    },
  });
  const nodes = elements(tree);
  assert.ok(nodes.some((node) => node.props.role === "alert"));
  assert.match(textContent(tree), /Your session has expired/);
  assert.match(textContent(tree), /Sign in again/);
  const button = nodes.find((node) => node.type === "button");
  assert.ok(button);
  (button.props.onClick as () => void)();
  assert.equal(recoveries, 1);
});

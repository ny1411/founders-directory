import assert from "node:assert/strict";
import { test } from "node:test";
import { ProfileLoadPanel } from "../src/components/profile-load-panel";
import {
  readProfileResponse,
  readOnboardingResponse,
  ProfileRequestError,
} from "../src/lib/profile-load";

type Element = { type: unknown; props: Record<string, unknown> };

function response(
  status: number,
  body: unknown,
): Pick<Response, "ok" | "status" | "json"> {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return body;
    },
  };
}

const handlers = { onRetry() {}, onRecoverSession() {} };

function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}

function textContent(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return elements(node)
    .flatMap((element) =>
      Array.isArray(element.props.children)
        ? element.props.children
        : [element.props.children],
    )
    .filter((child) => typeof child === "string" || typeof child === "number")
    .join(" ");
}

test("loading is visibly distinct and does not render profile editing controls", () => {
  const tree = ProfileLoadPanel({
    state: "loading",
    isRecoveringSession: false,
    ...handlers,
  });
  const nodes = elements(tree);

  assert.ok(nodes.some((node) => node.props.role === "status"));
  assert.match(textContent(tree), /Loading your profile/);
  assert.doesNotMatch(textContent(tree), /Upload Resume|Save Profile/);
});

test("an existing resume becomes ready with its saved content intact", async () => {
  const savedResume = '{"name":"Existing Founder"}';
  assert.deepEqual(
    await readProfileResponse(response(200, { resumeText: savedResume })),
    {
      state: "ready",
      resumeText: savedResume,
    },
  );
});

test("a missing document and an explicitly blank resume are genuine empty profiles", async () => {
  assert.deepEqual(
    await readProfileResponse(response(404, { error: "User not found" })),
    { state: "empty" },
  );
  assert.deepEqual(
    await readProfileResponse(response(200, { resumeText: null })),
    { state: "empty" },
  );
  assert.deepEqual(
    await readProfileResponse(response(200, { resumeText: "" })),
    { state: "empty" },
  );
});

test("unauthorized responses render session recovery without profile editing controls", async () => {
  assert.deepEqual(
    await readProfileResponse(response(401, { error: "Unauthorized" })),
    { state: "auth-error" },
  );
  assert.deepEqual(
    await readProfileResponse(response(403, { error: "Forbidden" })),
    { state: "auth-error" },
  );

  let recoveryCalls = 0;
  const tree = ProfileLoadPanel({
    state: "auth-error",
    isRecoveringSession: false,
    onRetry: handlers.onRetry,
    onRecoverSession: () => {
      recoveryCalls += 1;
    },
  });
  const nodes = elements(tree);
  const alert = nodes.find((node) => node.props.role === "alert");
  assert.ok(alert);
  assert.match(String(alert.props.className), /border-border/);
  assert.doesNotMatch(String(alert.props.className), /border-destructive/);
  assert.match(textContent(tree), /Your session has expired/);
  assert.match(textContent(tree), /Sign in again/);
  assert.doesNotMatch(textContent(tree), /Upload Resume|Save Profile/);
  const recoveryButton = nodes.find((node) => node.type === "button");
  assert.ok(recoveryButton);
  (recoveryButton.props.onClick as () => void)();
  assert.equal(recoveryCalls, 1);
});

test("server errors and invalid success payloads render a retry without profile editing controls", async () => {
  assert.deepEqual(
    await readProfileResponse(response(500, { error: "Internal error" })),
    { state: "backend-error" },
  );
  assert.deepEqual(await readProfileResponse(response(200, {})), {
    state: "backend-error",
  });
  assert.deepEqual(
    await readProfileResponse(response(200, { resumeText: 42 })),
    { state: "backend-error" },
  );

  let retryCalls = 0;
  const tree = ProfileLoadPanel({
    state: "backend-error",
    isRecoveringSession: false,
    onRetry: () => {
      retryCalls += 1;
    },
    onRecoverSession: handlers.onRecoverSession,
  });
  const nodes = elements(tree);
  const alert = nodes.find((node) => node.props.role === "alert");
  assert.ok(alert);
  assert.match(String(alert.props.className), /border-border/);
  assert.doesNotMatch(String(alert.props.className), /border-destructive/);
  assert.match(textContent(tree), /We couldn't load your profile/);
  assert.match(textContent(tree), /Try again/);
  assert.match(textContent(tree), /saved profile is still safe/);
  assert.doesNotMatch(textContent(tree), /Upload Resume|Save Profile/);
  const retryButton = nodes.find((node) => node.type === "button");
  assert.ok(retryButton);
  assert.match(String(retryButton.props.className), /bg-red-600/);
  assert.match(String(retryButton.props.className), /text-white/);
  assert.match(String(retryButton.props.className), /hover:bg-red-700/);
  (retryButton.props.onClick as () => void)();
  assert.equal(retryCalls, 1);
});

test("malformed JSON is a backend failure rather than an empty profile", async () => {
  const malformed = response(200, null);
  malformed.json = async () => {
    throw new SyntaxError("Unexpected token");
  };
  assert.deepEqual(await readProfileResponse(malformed), {
    state: "backend-error",
  });
});

test("intent onboarding accepts a new account without requiring resumeText", async () => {
  const onboarding = {
    account: { onboardingStatus: "new", activeGoalId: null },
    profile: { answers: {}, version: 0, updatedAt: "2026-10-16T00:00:00Z" },
    goal: null,
  };
  assert.deepEqual(
    await readOnboardingResponse(response(200, onboarding)),
    onboarding,
  );
});

test("intent onboarding preserves authentication and backend failure classification", async () => {
  for (const status of [401, 403]) {
    await assert.rejects(
      readOnboardingResponse(response(status, {})),
      (error: unknown) =>
        error instanceof ProfileRequestError && error.state === "auth-error",
    );
  }
  for (const body of [
    {},
    null,
    { account: {}, profile: { answers: [] }, goal: null },
    {
      account: {},
      profile: { answers: {}, version: 0, updatedAt: "now" },
      goal: null,
    },
  ]) {
    await assert.rejects(
      readOnboardingResponse(response(200, body)),
      (error: unknown) =>
        error instanceof ProfileRequestError && error.state === "backend-error",
    );
  }
  await assert.rejects(
    readOnboardingResponse(response(503, { error: "Please retry." })),
    /Please retry/,
  );
});

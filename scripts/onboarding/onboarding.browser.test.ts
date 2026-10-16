import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { once } from "node:events";
import path from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";
import { fixture, MemoryFirestore, resumeFixture } from "./fixture";
import {
  getIntentQuestionnaire,
  sharedQuestionnaire,
} from "../../src/lib/onboarding/questionnaires";
import { INTENTS, type UserIntent } from "../../src/lib/onboarding/types";
import { createResumeExtractionHandler } from "../../src/lib/resume-extraction-handler";

const labels = {
  job: "Find a job or internship",
  sell_services: "Sell services to businesses",
  find_cofounder: "Find a cofounder",
  raise_capital: "Raise capital",
};

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test(
  "rendered onboarding exercises real APIs/persistence, delayed saves, refresh, and all intent flows",
  { timeout: 120_000 },
  async (t) => {
    // Browser plugin not available. Bundle the production component without Firebase/OAuth;
    // use real API handlers + store with transactional in-memory persistence, and stub only the paid PDF model.
    const bundle = await build({
      stdin: {
        contents: `import React from "react"; import { createRoot } from "react-dom/client";
      import { OnboardingForm } from "./src/components/onboarding/onboarding-form";
      const uid = new URLSearchParams(location.search).get("uid");
      const request = async (method, body) => {
        const response = await fetch("/api/onboarding", {method, headers:{authorization:"Bearer " + uid,"content-type":"application/json"}, ...(body ? {body:JSON.stringify(body)} : {})});
        const data = await response.json(); if(!response.ok) throw new Error(data.error); return data;
      };
      const upload = async (file) => { const form=new FormData(); form.append("file",file);
        const response=await fetch("/api/extract-resume",{method:"POST",headers:{authorization:"Bearer " + uid},body:form});
        const data=await response.json(); if(!response.ok) throw new Error(data.error); return request("GET"); };
      createRoot(document.getElementById("root")).render(<OnboardingForm request={request} upload={upload} onExit={()=>{}} onLogout={async()=>{}} />);`,
        resolveDir: process.cwd(),
        loader: "tsx",
      },
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      minify: true,
      define: { "process.env.NODE_ENV": '"production"' },
      tsconfig: "tsconfig.json",
    });
    const memory = new MemoryFirestore();
    const fixtures = new Map<string, ReturnType<typeof fixture>>();
    const getFixture = (uid: string) => {
      if (!fixtures.has(uid)) fixtures.set(uid, fixture(uid, memory));
      return fixtures.get(uid)!;
    };
    const holds = new Map<
      string,
      {
        started: ReturnType<typeof deferred>;
        release: ReturnType<typeof deferred>;
      }
    >();
    const failures = new Set<string>();
    const cssDirectory = path.join(process.cwd(), ".next/static/css");
    const css = existsSync(cssDirectory)
      ? readdirSync(cssDirectory)
          .filter((name) => name.endsWith(".css"))
          .map((name) => readFileSync(path.join(cssDirectory, name), "utf8"))
          .join("\n")
      : "";
    const server = createServer(async (incoming, outgoing) => {
      try {
        if (incoming.url === "/client.js") {
          outgoing.setHeader("content-type", "text/javascript");
          outgoing.end(bundle.outputFiles[0].text);
          return;
        }
        if (incoming.url === "/style.css") {
          outgoing.setHeader("content-type", "text/css");
          outgoing.end(css);
          return;
        }
        if (incoming.url === "/favicon.ico") {
          outgoing.statusCode = 204;
          outgoing.end();
          return;
        }
        if (!incoming.url?.startsWith("/api/")) {
          outgoing.setHeader("content-type", "text/html");
          outgoing.end(
            '<!doctype html><html lang="en" class="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Profile onboarding</title><link rel="stylesheet" href="/style.css"></head><body><main id="root"></main><script src="/client.js"></script></body></html>',
          );
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const uid =
          incoming.headers.authorization?.replace("Bearer ", "") || "missing";
        const f = getFixture(uid);
        const request = new Request(`http://localhost${incoming.url}`, {
          method: incoming.method,
          headers: incoming.headers as HeadersInit,
          ...(["GET", "HEAD"].includes(incoming.method ?? "GET")
            ? {}
            : { body: Buffer.concat(chunks) }),
        });
        let result: Response;
        if (incoming.url === "/api/extract-resume") {
          result = await createResumeExtractionHandler({
            verifyToken: async (token) => {
              assert.equal(token, uid);
              return { uid };
            },
            authorizeUpload: async () => (await f.state()).goal?.type === "job",
            reserveAttempt: async () => ({
              allowed: true,
              retryAfterSeconds: 0,
            }),
            extract: async () => JSON.stringify(resumeFixture),
            persist: (owner, data, hash) =>
              f.store.saveResume(owner, data, hash),
          })(request);
        } else {
          const input =
            incoming.method === "POST"
              ? JSON.parse(Buffer.concat(chunks).toString())
              : {};
          if (input.action === "save_answers" && failures.delete(uid))
            result = Response.json(
              { error: "Temporary save failure. Please retry." },
              { status: 503 },
            );
          else {
            const hold =
              input.action === "save_answers" ? holds.get(uid) : undefined;
            if (hold) {
              holds.delete(uid);
              hold.started.resolve();
              await hold.release.promise;
            }
            result = await (
              incoming.method === "GET" ? f.handlers.GET : f.handlers.POST
            )(request);
          }
        }
        outgoing.writeHead(result.status, Object.fromEntries(result.headers));
        outgoing.end(Buffer.from(await result.arrayBuffer()));
      } catch (error) {
        outgoing.statusCode = 500;
        outgoing.end(String(error));
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    const browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.CHROMIUM_PATH ||
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    });

    const errors: string[] = [];
    const open = async (uid: string) => {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 900 },
      });
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" && !message.text().includes("503"))
          errors.push(message.text());
      });
      await page.goto(`${origin}/profile?uid=${uid}`);
      assert.equal(await page.title(), "Profile onboarding");
      await page
        .getByRole("heading", { name: "Build a profile with a purpose" })
        .waitFor();
      return page;
    };
    const choose = async (page: Page, intent: UserIntent) => {
      await page.getByRole("combobox", { name: "Primary goal" }).click();
      await page
        .getByRole("option", { name: labels[intent], exact: true })
        .click();
      await page
        .getByRole("combobox", { name: "Where are you today?" })
        .click();
      await page
        .getByRole("option", { name: "Actively looking", exact: true })
        .click();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
    };
    const saved = (page: Page) =>
      page.waitForFunction(
        () =>
          document.querySelector('[role="status"]')?.textContent ===
          "All changes saved",
      );
    const fillShared = async (page: Page) => {
      for (const question of sharedQuestionnaire.questions.filter(
        (q) => q.required,
      ))
        await page
          .locator(`#${question.id}`)
          .fill(`Thoughtful ${question.id} response`);
    };

    try {
      for (const intent of INTENTS) {
        await t.test(
          `${intent}: questionnaire → refresh → review → confirm → edit`,
          async () => {
            const page = await open(`browser-${intent}`);
            await choose(page, intent);
            if (intent === "job") {
              await page
                .getByText("Start with your resume", { exact: true })
                .waitFor();
              assert.equal(await page.locator("#about").count(), 0);
              await page
                .getByLabel("Choose a PDF resume")
                .setInputFiles({
                  name: "resume.pdf",
                  mimeType: "application/pdf",
                  buffer: Buffer.from("%PDF-1.7\nBrowser fixture"),
                });
              await page.locator("#about").waitFor();
              assert.match(
                await page.locator("#links").inputValue(),
                /^https:\/\/github/,
              );
            } else
              assert.equal(await page.locator('input[type="file"]').count(), 0);
            await fillShared(page);
            await page
              .getByRole("button", { name: "Continue", exact: true })
              .click();
            const section = getIntentQuestionnaire(intent);
            await page.locator(`#${section.questions[0].id}`).waitFor();
            for (const question of section.questions.filter((q) => q.required))
              await page
                .locator(`#${question.id}`)
                .fill(`${question.id} evidence for ${intent}`);
            await saved(page);
            await page.reload();
            await page.locator(`#${section.questions[0].id}`).waitFor();
            assert.equal(
              await page.locator(`#${section.questions[0].id}`).inputValue(),
              `${section.questions[0].id} evidence for ${intent}`,
            );
            await page
              .getByRole("button", { name: "Continue", exact: true })
              .click();
            await page
              .locator("#profile-summary")
              .fill(`Approved ${intent} summary.`);
            // Back navigation must flush even before the debounce fires, including summary edits.
            await page
              .getByRole("button", { name: "Edit answers", exact: true })
              .click();
            await page
              .getByRole("button", { name: "Continue", exact: true })
              .click();
            await page.locator("#profile-summary").waitFor();
            assert.equal(
              await page.locator("#profile-summary").inputValue(),
              `Approved ${intent} summary.`,
            );
            await page.reload();
            await page.locator("#profile-summary").waitFor();
            assert.equal(
              await page.locator("#profile-summary").inputValue(),
              `Approved ${intent} summary.`,
            );
            await page
              .getByRole("button", { name: "Confirm profile", exact: true })
              .click();
            await page
              .getByText("Your profile is ready", { exact: true })
              .waitFor();
            const f = getFixture(`browser-${intent}`);
            assert.equal((await f.state()).goal?.summaryConfirmed, true);
            await page
              .getByRole("button", { name: "Edit profile", exact: true })
              .click();
            await page.locator("#about").fill("Updated after completion");
            await saved(page);
            assert.equal(
              (await f.state()).profile.answers.about,
              "Updated after completion",
            );
            await page
              .getByRole("button", { name: "Change goal", exact: true })
              .click();
            const other =
              intent === "sell_services" ? "find_cofounder" : "sell_services";
            await choose(page, other);
            await page.locator("#about").waitFor();
            await page
              .getByRole("button", { name: "Change goal", exact: true })
              .click();
            await choose(page, intent);
            await page.locator("#about").waitFor();
            const restored = await f.state();
            assert.equal(
              restored.goal?.answers[section.questions[0].id],
              `${section.questions[0].id} evidence for ${intent}`,
            );
            if (intent === "sell_services") {
              if (process.env.ONBOARDING_SCREENSHOT_DIR)
                await page.screenshot({
                  path: path.join(
                    process.env.ONBOARDING_SCREENSHOT_DIR,
                    "onboarding-desktop.png",
                  ),
                });
              await page.setViewportSize({ width: 390, height: 844 });
              assert.equal(
                await page.evaluate(
                  () =>
                    document.documentElement.scrollWidth <= window.innerWidth,
                ),
                true,
                "mobile layout must not overflow",
              );
              if (process.env.ONBOARDING_SCREENSHOT_DIR)
                await page.screenshot({
                  path: path.join(
                    process.env.ONBOARDING_SCREENSHOT_DIR,
                    "onboarding-mobile.png",
                  ),
                });
            }
            await page.close();
          },
        );
      }

      await t.test(
        "typing during an in-flight save and navigating back never loses newer answers",
        async () => {
          const uid = "browser-race";
          const page = await open(uid);
          await choose(page, "sell_services");
          await page.locator("#about").waitFor();
          const hold = { started: deferred(), release: deferred() };
          holds.set(uid, hold);
          await page.locator("#about").fill("First snapshot");
          await hold.started.promise;
          await page.locator("#about").fill("Newer edit while saving");
          hold.release.resolve();
          await saved(page);
          await page.reload();
          await page.locator("#about").waitFor();
          assert.equal(
            await page.locator("#about").inputValue(),
            "Newer edit while saving",
          );
          await fillShared(page);
          await page
            .getByRole("button", { name: "Continue", exact: true })
            .click();
          await page.locator("#service").fill("Edited immediately before Back");
          await page.getByRole("button", { name: "Back", exact: true }).click();
          await page
            .getByRole("button", { name: "Continue", exact: true })
            .click();
          await page.locator("#service").waitFor();
          assert.equal(
            await page.locator("#service").inputValue(),
            "Edited immediately before Back",
          );
          await page.close();
        },
      );

      await t.test(
        "failed saves retain the draft and retry persists it",
        async () => {
          const uid = "browser-retry";
          const page = await open(uid);
          await choose(page, "sell_services");
          await page.locator("#about").waitFor();
          failures.add(uid);
          await page
            .locator("#about")
            .fill("Keep this draft after a failed save");
          await page.getByRole("alert").waitFor();
          assert.equal(
            await page.locator("#about").inputValue(),
            "Keep this draft after a failed save",
          );
          await page
            .getByRole("button", { name: "Retry save", exact: true })
            .click();
          await saved(page);
          await page.reload();
          await page.locator("#about").waitFor();
          assert.equal(
            await page.locator("#about").inputValue(),
            "Keep this draft after a failed save",
          );
          await page.close();
        },
      );
      assert.deepEqual(
        errors,
        [],
        "No browser runtime or application console errors",
      );
    } finally {
      for (const hold of holds.values()) hold.release.resolve();
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

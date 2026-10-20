import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import { ResumeContributions } from "../src/components/onboarding/resume-contributions";
import type { ResumeData } from "../src/lib/onboarding/types";

const extracurriculars: ResumeData["extracurriculars"] = {
  hackathons: [{ name: "Climate Hack", duration: "2024", description: ["Built an emissions dashboard."], url: "https://example.com/hack" }],
  "open-source": [{ name: "Accessible Web", duration: "2023 – present", description: ["Fixed keyboard navigation.", "Reviewed community pull requests."], url: "https://github.com/example/accessibility/pull/7" }],
  competitions: [{ name: "Robotics Final", duration: "2022", description: ["Placed second."], url: "https://example.com/competition" }],
  otherExtracurriculars: [{ name: "Volunteer mentor", description: ["Supported first-time contributors."] }],
  communityLeadership: [{ name: "Community organizer" }],
};

test("renders every extraction category and activity field, including open source", () => {
  const markup = renderToStaticMarkup(<ResumeContributions extracurriculars={extracurriculars} />);
  for (const text of ["Hackathons", "Open source contributions", "Competitions", "Other activities", "Community Leadership", "Accessible Web", "2023 – present", "Fixed keyboard navigation.", "Reviewed community pull requests."])
    assert.ok(markup.includes(text), `Missing ${text}`);
  assert.match(markup, /href="https:\/\/github.com\/example\/accessibility\/pull\/7"/);
  assert.match(markup, /rel="noopener noreferrer"/);
});

test("empty or missing optional fields do not produce blank sections or undefined text", () => {
  const emptySections: Array<ResumeData["extracurriculars"] | null> = [undefined, null, {}, { "open-source": [] }, { "open-source": [{}] }];
  for (const value of emptySections)
    assert.equal(renderToStaticMarkup(<ResumeContributions extracurriculars={value} />), "");
  const markup = renderToStaticMarkup(<ResumeContributions extracurriculars={{ "open-source": [{ description: ["A contribution without optional metadata."] }] }} />);
  assert.match(markup, /A contribution without optional metadata/);
  assert.doesNotMatch(markup, /undefined|null|href=/);
});

test("unsafe links are omitted and extracted markup is escaped", () => {
  const markup = renderToStaticMarkup(<ResumeContributions extracurriculars={{ "open-source": [
    { name: "<script>window.compromised = true</script>", url: "javascript:alert(1)" },
    { name: "Unsafe data", url: "data:text/html,example" },
    { name: "Credentialed URL", url: "https://name:password@example.com" },
    { name: "Invalid URL", url: "/relative" },
    { name: "HTTP contribution", url: "http://example.com/contribution" },
  ] }} />);
  assert.doesNotMatch(markup, /<script>|javascript:|data:text|password@|href="\/relative/);
  assert.match(markup, /&lt;script&gt;/);
  assert.match(markup, /href="http:\/\/example.com\/contribution"/);
  assert.match(renderToStaticMarkup(<ResumeContributions extracurriculars={{ constructor: [{ name: "Community project" }] }} />), /Community project/);
});

test("browser displays accessible contribution content and handles mobile width", async () => {
  // Browser plugin not available; exercise the production component in Chromium.
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    const html = renderToStaticMarkup(<ResumeContributions extracurriculars={extracurriculars} />);
    await page.setContent(`<html lang="en"><head><title>Resume contributions review</title><style>body{font:16px system-ui;margin:24px;max-width:740px}li{overflow-wrap:anywhere}a:focus-visible{outline:2px solid blue}</style></head><body>${html}</body></html>`);
    assert.equal(await page.title(), "Resume contributions review");
    assert.ok(await page.getByRole("region", { name: "Open source contributions", exact: true }).isVisible());
    assert.equal(await page.getByRole("link", { name: "View Accessible Web (opens in a new tab)", exact: true }).getAttribute("href"), "https://github.com/example/accessibility/pull/7");
    mkdirSync("/tmp/issue-14", { recursive: true });
    await page.setViewportSize({ width: 1280, height: 960 });
    await page.screenshot({ path: "/tmp/issue-14/contributions-desktop.png", fullPage: true });
    await page.getByRole("link", { name: "View Accessible Web (opens in a new tab)", exact: true }).focus();
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "View Accessible Web (opens in a new tab)");
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: "/tmp/issue-14/contributions-mobile.png", fullPage: true });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

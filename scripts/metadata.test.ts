import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");

function source(relativePath: string) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("root metadata keeps only the real homepage canonical", () => {
  const layout = source("src/app/layout.tsx");
  const alternates = layout.match(/alternates:\s*{([\s\S]*?)\n\s*},/)?.[1];

  assert.ok(alternates, "Expected root alternates metadata");
  assert.match(alternates, /canonical:\s*["']\/["']/);
  assert.doesNotMatch(alternates, /languages|en-US|\/en-US/);
  assert.match(
    layout,
    /metadataBase:\s*new URL\(process\.env\.NEXT_PUBLIC_APP_URL\s*\|\|\s*["']https:\/\/foundersdirectory\.com["']\)/,
  );
});

test("company metadata overrides the homepage with a self-canonical path", () => {
  const companyPage = source("src/app/company/[slug]/page.tsx");

  assert.match(
    companyPage,
    /alternates:\s*{\s*canonical:\s*`\/company\/\$\{params\.slug\}`\s*,?\s*}/,
  );
});

test("missing companies clear inherited canonicals and are not indexed", () => {
  const companyPage = source("src/app/company/[slug]/page.tsx");
  const missingBranch = companyPage
    .split("if (companySnapshot.empty) {")[1]
    ?.split("const company =")[0];

  assert.ok(missingBranch, "Expected missing-company metadata branch");
  assert.match(missingBranch, /canonical:\s*null/);
  assert.match(missingBranch, /index:\s*false/);
  assert.match(missingBranch, /follow:\s*false/);
});

test("sitemap constructs absolute URLs without duplicate slashes", () => {
  const sitemap = source("src/app/sitemap.ts");

  assert.match(sitemap, /const baseUrl = new URL\(/);
  assert.match(
    sitemap,
    /new URL\(`\/company\/\$\{data\.slug\}`, baseUrl\)\.toString\(\)/,
  );
  assert.match(sitemap, /new URL\(['"]\/['"], baseUrl\)\.toString\(\)/);
});

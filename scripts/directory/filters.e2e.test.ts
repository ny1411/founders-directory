import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { config } from "dotenv"
import { cert, initializeApp } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import { chromium, type Browser, type Page } from "playwright"

// Run against `next build && next start` to catch production navigation regressions.
// Only projected, public company fields are read; this suite never writes to Firestore.
const baseUrl = process.env.DIRECTORY_TEST_URL || "http://127.0.0.1:3000"
type StoredCompany = {
  id: string; slug: string; name?: string | null; industry?: string | null; tags?: string[] | null
  employees?: number | null; batch?: string | null; vcBacker?: string | null
}
let browser: Browser
let companies: StoredCompany[]

before(async () => {
  config({ quiet: true })
  for (const name of ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"]) {
    assert.ok(process.env[name], `Configure ${name} in .env for read-only integration tests`)
  }
  const app = initializeApp({ credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
  }) }, "directory-filter-tests")
  const snapshot = await getFirestore(app).collection("companies")
    .select("slug", "name", "industry", "tags", "employees", "batch", "vcBacker").get()
  companies = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as StoredCompany))
  assert.ok(companies.length, "The integration database must contain companies")
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
  })
})

after(async () => { await browser?.close() })

const isB2B = (company: StoredCompany) => Array.isArray(company.tags) && company.tags.includes("B2B")
const isHealthcare = (company: StoredCompany) => company.industry === "Healthcare" || company.tags?.includes("Healthcare") === true
const hasSmallTeam = (company: StoredCompany) => typeof company.employees === "number" &&
  Number.isSafeInteger(company.employees) && company.employees >= 1 && company.employees <= 50
const matchesSearch = (company: StoredCompany, query: string) => {
  const normalized = query.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US")
  return (company.name ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US").startsWith(normalized) ||
    company.slug.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US").startsWith(normalized)
}

async function verify(page: Page, matches: (company: StoredCompany) => boolean) {
  await page.locator('[aria-busy="false"]').waitFor({ state: "visible" })
  const params = new URL(page.url()).searchParams
  const ordered = companies.filter(matches).sort((a, b) =>
    ((a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) *
    (params.get("sort") === "desc" ? -1 : 1))
  const pageNumber = Math.min(Number(params.get("page")) || 1, Math.max(1, Math.ceil(ordered.length / 10)))
  assert.equal(Number(await page.locator("section span.text-3xl").innerText()), ordered.length)
  const slugs = await page.locator("a.block.h-full").evaluateAll(links =>
    links.map(link => link.getAttribute("href")!.split("/").pop()))
  assert.deepEqual(slugs, ordered.slice((pageNumber - 1) * 10, pageNumber * 10).map(company => company.slug))
}

async function withPage(run: (page: Page) => Promise<void>) {
  const page = await browser.newPage()
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await page.route("**/_next/image?**", route => route.fulfill({ status: 204 }))
  try { await run(page); assert.deepEqual(errors, [], "No browser runtime errors") }
  finally { await page.close() }
}

test("production B2B clicks and next/previous pages match only explicit Firestore tags", { timeout: 120_000 }, async () => {
  await withPage(async page => {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" })
    assert.match(await page.title(), /Founders Directory/)
    await page.locator("aside").getByRole("link", { name: "B2B", exact: true }).click()
    await page.waitForURL(url => url.searchParams.get("industry") === "B2B")
    await verify(page, isB2B)
    if (companies.filter(isB2B).length > 10) {
      await page.getByRole("link", { name: "Next", exact: true }).click()
      await page.waitForURL(url => url.searchParams.get("page") === "2")
      await verify(page, isB2B)
      await page.getByRole("link", { name: "Previous", exact: true }).click()
      await page.waitForURL(url => !url.searchParams.has("page"))
      await verify(page, isB2B)
    }
  })
})

test("multi-selection combines groups and survives batch, sort, search, and clearing", { timeout: 120_000 }, async () => {
  await withPage(async page => {
    await page.goto(`${baseUrl}/?industry=B2B`, { waitUntil: "domcontentloaded" })
    for (const [name, key, count] of [["Healthcare", "industry", 2], ["1-10", "employees", 1], ["11-50", "employees", 2]] as const) {
      await page.locator("aside").getByRole("link", { name, exact: true }).click()
      await page.waitForURL(url => url.searchParams.getAll(key).length === count)
    }
    const matches = (company: StoredCompany) => (isB2B(company) || isHealthcare(company)) && hasSmallTeam(company)
    await verify(page, matches)
    const batches = [...new Set(companies.filter(matches).map(company => company.batch).filter((batch): batch is string => !!batch))].slice(0, 2)
    assert.equal(batches.length, 2, "Two stored batches are needed to exercise multi-selection")
    const picker = page.getByRole("combobox", { name: "Batch", exact: true })
    for (const [index, batch] of batches.entries()) {
      if (!await page.getByRole("option", { name: batch, exact: true }).isVisible()) await picker.click()
      await page.getByRole("option", { name: batch, exact: true }).click()
      await page.waitForURL(url => url.searchParams.getAll("batch").length === index + 1)
    }
    await page.keyboard.press("Escape")
    const withBatch = (company: StoredCompany) => matches(company) && batches.includes(company.batch ?? "")
    await verify(page, withBatch)
    await page.getByRole("link", { name: "A-Z", exact: true }).click()
    await page.waitForURL(url => url.searchParams.get("sort") === "desc")
    await verify(page, withBatch)
    await page.locator("#search-input").fill("a")
    await page.locator("#search-input").press("Enter")
    await page.waitForURL(url => url.searchParams.get("q") === "a")
    for (const key of ["industry", "employees", "batch"]) assert.equal(new URL(page.url()).searchParams.getAll(key).length, 2)
    await verify(page, company => withBatch(company) && matchesSearch(company, "a"))
    await page.getByRole("button", { name: "Clear batches", exact: true }).click()
    await page.waitForURL(url => !url.searchParams.has("batch"))
    await verify(page, company => matches(company) && matchesSearch(company, "a"))
    await page.getByRole("link", { name: "Clear all filters", exact: true }).click()
    await page.waitForURL(url => !["industry", "employees", "batch", "vc"].some(key => url.searchParams.has(key)))
    await verify(page, company => matchesSearch(company, "a"))
  })
})

test("direct page links recover from invalid cursors without losing alphabetical order", { timeout: 120_000 }, async () => {
  await withPage(async page => {
    await page.goto(`${baseUrl}/?page=2&cursor=bad&sort=desc`, { waitUntil: "domcontentloaded" })
    await verify(page, () => true)
  })
})

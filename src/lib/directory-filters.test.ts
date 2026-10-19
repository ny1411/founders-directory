import assert from "node:assert/strict"
import test from "node:test"
import { directoryParams, FILTER_GROUPS, matchesCompanySearch, matchesDirectoryFilters, normalizeCompanySearch, parseCursor, parseDirectoryFilters, parsePage, toggleSelection, updateDirectoryParams, type DirectoryFilters } from "./directory-filters"
import type { Company } from "./types"

const options = { batches: ["Winter 2026", "Summer 2026"], vcs: ["YC", "Other"] }
const empty: DirectoryFilters = { q: "", sort: "asc", industry: [], employees: [], batch: [], vc: [] }
const company = (overrides: Partial<Company> = {}) => ({ id: "a", slug: "acme", name: "Acme", industry: "Fintech", tags: ["B2B"], employees: 10, batch: "Winter 2026", vcBacker: "YC", ...overrides } as Company)

test("repeated facets accept unique valid options and malformed scalar params are safe", () => {
  assert.deepEqual(parseDirectoryFilters({ industry: ["B2B", "Healthcare", "B2B", "invalid"], employees: ["1-10", "501+", "bad"], batch: options.batches, vc: options.vcs, q: [" ac ", "ignored"], sort: ["desc", "asc"] }, options), {
    q: "ac", sort: "desc", industry: ["B2B", "Healthcare"], employees: ["1-10", "501+"], batch: [...options.batches].sort(), vc: [...options.vcs].sort(),
  })
  assert.deepEqual(parseDirectoryFilters({ industry: "unknown", employees: "0", batch: "bad", vc: "bad", q: [], sort: ["bad"] }, options), empty)
  assert.deepEqual(parseDirectoryFilters({ industry: "B2B", employees: "1-10", batch: "Winter 2026", vc: "YC" }, options), { ...empty, industry: ["B2B"], employees: ["1-10"], batch: ["Winter 2026"], vc: ["YC"] })
})

test("each group uses OR and all groups together use AND including search", () => {
  const filters: DirectoryFilters = { q: "AC", sort: "asc", industry: ["B2B", "Healthcare"], employees: ["1-10", "501+"], batch: options.batches, vc: options.vcs }
  assert.equal(matchesDirectoryFilters(company(), filters), true)
  assert.equal(matchesDirectoryFilters(company({ industry: "Healthcare", tags: [], employees: 600, batch: "Summer 2026", vcBacker: "Other" }), filters), true)
  for (const overrides of [{ industry: "Education", tags: [] }, { employees: 11 }, { batch: "Winter 2025" }, { vcBacker: "Bad" }, { slug: "zebra", name: "Zebra" }]) {
    assert.equal(matchesDirectoryFilters(company(overrides), filters), false)
  }
  assert.equal(matchesDirectoryFilters(company({ industry: "B2B", tags: [] }), { ...empty, industry: ["B2B"] }), false)
  assert.equal(matchesDirectoryFilters(company({ tags: "B2B" as unknown as string[] }), { ...empty, industry: ["B2B"] }), false)
  assert.equal(matchesDirectoryFilters(company({ employees: null, batch: null, vcBacker: null, tags: null }), empty), true)
})

test("company-name search is case-insensitive, whitespace-normalized, and keeps slug compatibility", () => {
  assert.equal(normalizeCompanySearch("  10   By\t10  "), "10 by 10")
  assert.equal(matchesCompanySearch(company({ name: "10 By 10", slug: "ten-by-ten" }), "  10   bY  10 "), true)
  assert.equal(matchesCompanySearch(company({ name: "Ten by Ten", slug: "10-by-10" }), "10-by"), true)
  assert.equal(matchesCompanySearch(company({ name: "Another Company", slug: "another-company", description: "10 By 10" }), "10 by 10"), false)
})

test("toggle, group clear, clear all and sort preserve repeated selections and reset pagination", () => {
  const filters: DirectoryFilters = { ...empty, q: "ac", industry: ["B2B", "Healthcare"], employees: ["1-10", "501+"], batch: options.batches, vc: options.vcs }
  const current = directoryParams(filters)
  current.set("page", "4"); current.set("cursor", '["a","b"]'); current.set("direction", "prev")
  const added = updateDirectoryParams(current, { industry: toggleSelection(filters.industry, "Fintech") })
  assert.deepEqual(added.getAll("industry"), ["B2B", "Healthcare", "Fintech"])
  for (const key of ["page", "cursor", "direction"]) assert.equal(added.has(key), false)
  for (const group of ["employees", "batch", "vc"] as const) assert.deepEqual(added.getAll(group), filters[group])
  assert.deepEqual(toggleSelection(filters.industry, "B2B"), ["Healthcare"])
  const cleared = updateDirectoryParams(current, { industry: [] })
  assert.deepEqual(cleared.getAll("industry"), [])
  assert.deepEqual(cleared.getAll("batch"), options.batches)
  const allCleared = updateDirectoryParams(current, Object.fromEntries(FILTER_GROUPS.map(group => [group, []])))
  assert.equal(allCleared.toString(), "q=ac")
  const sorted = updateDirectoryParams(current, { sort: "desc" })
  assert.equal(sorted.get("sort"), "desc")
  assert.equal(sorted.has("cursor"), false)
  assert.deepEqual(sorted.getAll("industry"), filters.industry)
  const search = updateDirectoryParams(current, { q: "z" })
  assert.equal(search.get("q"), "z")
  assert.deepEqual(search.getAll("employees"), filters.employees)
  const next = updateDirectoryParams(directoryParams(filters), { page: 2, cursor: '["acme","a"]', direction: "next" })
  assert.equal(next.get("page"), "2")
  assert.equal(next.get("cursor"), '["acme","a"]')
  assert.deepEqual(next.getAll("industry"), filters.industry)
  assert.equal(current.get("page"), "4", "updates never mutate the original params")
})

test("page and cursor parsing rejects invalid URLs without crashes", () => {
  for (const raw of [undefined, "", "0", "-1", "1.5", "2oops", "NaN", "Infinity", "9007199254740992", []]) assert.equal(parsePage(raw), 1)
  assert.equal(parsePage(["2", "bad"]), 2)
  assert.equal(parsePage("3"), 3)
  for (const raw of [undefined, "bad", "null", "{}", "[]", '["a"]', '[1,"b"]', '[1,"a","b"]', '["a",""]', '["a","b/c"]', []]) assert.equal(parseCursor(raw), null)
  assert.deepEqual(parseCursor('["acme","id"]'), ["acme", "id"])
  assert.deepEqual(parseCursor(['["acme","id"]', "bad"]), ["acme", "id"])
})

test("search and facets normalize to bounded values before filtering cached snapshots", () => {
  const labels = Array.from({ length: 20 }, (_, index) => `VC ${index}`)
  const filters = parseDirectoryFilters({ q: "  WORD   ".repeat(100), vc: [...labels, ...labels].reverse() }, {
    batches: [], vcs: labels,
  })
  assert.equal(filters.q.length, 100)
  assert.equal(filters.q.includes("  "), false)
  assert.equal(filters.q, filters.q.toLowerCase())
  assert.equal(filters.vc.length, 10)
  assert.deepEqual(filters.vc, [...labels].sort().slice(0, 10))
  assert.equal(parseCursor(JSON.stringify(["x".repeat(501), "id"])), null)
})

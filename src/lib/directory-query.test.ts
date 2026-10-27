import assert from "node:assert/strict"
import test from "node:test"
import { buildDirectoryPage, loadDirectoryCompanies, type DirectoryIndex } from "./directory-page"
import { toDirectoryIndexEntry } from "./directory-index"
import { paginateCompanies } from "./company-pagination"
import { matchesDirectoryFilters, parseDirectoryFilters } from "./directory-filters"
import { memoryFirestore } from "../../scripts/directory/memory-firestore"
import { DirectoryAvailabilityError } from "./directory-availability"

const companies = Array.from({ length: 6_013 }, (_, number) => ({
  id: `id-${String(number).padStart(5, "0")}`, slug: `company-${String(Math.floor(number / 2)).padStart(5, "0")}`,
  name: number % 3 ? `Business ${number}` : `10 By 10 ${number}`, industry: number % 4 ? "Healthcare" : null,
  employees: number % 3 ? 10 : 600, batch: number % 2 ? "Winter 2026" : "Summer 2026",
  vcBacker: number % 2 ? "YC" : "Other", tags: number % 3 ? ["B2B"] : ["Travel"],
  description: "Card description", logoUrl: null, privateNote: "never serialize", founders: ["private"],
}))
const index: DirectoryIndex = {
  entries: companies.map(company => toDirectoryIndexEntry(company.id, company)),
  batches: ["Winter 2026", "Summer 2026"], vcs: ["YC", "Other"],
}
function fixture() {
  return memoryFirestore(companies.map(company => [`companies/${company.id}`, company]))
}

test("6,013 companies: cold first, later and descending pages each read exactly ten company documents", async () => {
  for (const params of [{}, { page: "501" }, { sort: "desc", page: "2" }]) {
    const f = fixture()
    const result = await buildDirectoryPage(index, params, ids => loadDirectoryCompanies(f.db, ids))
    const expected = paginateCompanies(companies, Number(params.page ?? 1), params.sort ?? "asc")
    assert.deepEqual(result.companies.map(company => company.id), expected.companies.map(company => company.id))
    assert.equal(result.totalCount, 6013)
    assert.equal(result.totalPages, 602)
    assert.deepEqual(f.reads, [{ collection: "companies", count: 10 }])
    for (const company of result.companies) {
      assert.equal("privateNote" in company, false)
      assert.equal("founders" in company, false)
    }
  }
})

test("combined multi-select facets, prefix search and exact counts select IDs before any company reads", async () => {
  const params = { industry: ["B2B", "Travel"], employees: ["1-10", "501+"],
    vc: ["YC", "Other"], batch: ["Winter 2026", "Summer 2026"], q: " 10  BY 10 ", sort: "desc", page: "3" }
  const f = fixture()
  const result = await buildDirectoryPage(index, params, ids => loadDirectoryCompanies(f.db, ids))
  const filters = parseDirectoryFilters(params, index)
  const expected = paginateCompanies(companies.filter(company => matchesDirectoryFilters(company, filters)), 3, "desc")
  assert.equal(result.totalCount, expected.totalCount)
  assert.deepEqual(result.companies.map(company => company.id), expected.companies.map(company => company.id))
  assert.deepEqual(f.reads, [{ collection: "companies", count: 10 }])
})

test("all numbered pages preserve duplicate-slug ID ordering without missing or repeated companies", async () => {
  const f = fixture()
  const ids: string[] = []
  for (let page = 1; page <= 602; page++) {
    const result = await buildDirectoryPage(index, { page: String(page) }, selected => loadDirectoryCompanies(f.db, selected))
    ids.push(...result.companies.map(company => company.id))
  }
  assert.equal(new Set(ids).size, 6013)
  assert.deepEqual(ids, companies.map(company => company.id))
  assert.ok(f.reads.every(read => read.count <= 10))
})

test("empty search reads no companies, stale page clamps to last page, batch reads are reordered", async () => {
  const f = fixture()
  const empty = await buildDirectoryPage(index, { q: "missing-company" }, ids => loadDirectoryCompanies(f.db, ids))
  assert.deepEqual(empty, { companies: [], totalCount: 0, totalPages: 0, page: 1 })
  assert.deepEqual(f.reads, [])
  const last = await buildDirectoryPage(index, { page: "100000" }, ids => loadDirectoryCompanies(f.db, ids))
  assert.equal(last.page, 602)
  assert.equal(last.companies.length, 3)
  assert.deepEqual(f.reads, [{ collection: "companies", count: 3 }])
})

test("oversized, duplicate and invalid ID batches fail before datastore work; stale index fails closed", async () => {
  const f = fixture()
  for (const ids of [companies.slice(0, 11).map(company => company.id), ["same", "same"], ["a/b"], [""]]) {
    await assert.rejects(loadDirectoryCompanies(f.db, ids), /Invalid directory page IDs/)
  }
  assert.deepEqual(f.reads, [])
  await assert.rejects(loadDirectoryCompanies(f.db, ["deleted-company"]),
    error => error instanceof DirectoryAvailabilityError && error.stage === "companies" && error.reason === "company_missing")
})

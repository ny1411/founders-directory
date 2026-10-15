import assert from "node:assert/strict"
import test from "node:test"
import type { CollectionReference } from "firebase-admin/firestore"
import { loadDirectoryCandidates, loadDirectoryPage } from "./directory-query"
import { parseCursor, type DirectoryFilters } from "./directory-filters"
import type { Company } from "./types"

const empty: DirectoryFilters = { q: "", sort: "asc", industry: [], employees: [], batch: [], vc: [] }
const data = Array.from({ length: 25 }, (_, index) => ({
  id: String(index).padStart(2, "0"), slug: `company-${String(Math.floor(index / 2)).padStart(2, "0")}`,
  industry: index % 3 === 0 ? "Healthcare" : "Fintech", tags: index % 2 === 0 ? ["B2B"] : [],
  employees: index % 2 === 0 ? 5 : 1000, batch: index % 2 === 0 ? "Winter 2026" : "Summer 2026", vcBacker: index % 2 === 0 ? "YC" : "Other",
} as Company))

function mockCollection(companies = data) {
  const calls: { method: string; args: unknown[] }[] = []
  type Condition = [string, string, unknown]
  const make = (conditions: Condition[] = [], sort = "asc", skip = 0, limit = Infinity, last = false, boundary?: { values: [string, string]; before: boolean }) => {
    const chain = (method: string, args: unknown[]) => calls.push({ method, args })
    const query = {
      where: (field: string, operator: string, value: unknown) => { chain("where", [field, operator, value]); return make([...conditions, [field, operator, value]], sort, skip, limit, last, boundary) },
      orderBy: (field: unknown, order: string) => { chain("orderBy", [field, order]); return make(conditions, order, skip, limit, last, boundary) },
      offset: (value: number) => { chain("offset", [value]); return make(conditions, sort, value, limit, last, boundary) },
      limit: (value: number) => { chain("limit", [value]); return make(conditions, sort, skip, value, false, boundary) },
      limitToLast: (value: number) => { chain("limitToLast", [value]); return make(conditions, sort, skip, value, true, boundary) },
      startAfter: (...values: [string, string]) => { chain("startAfter", values); return make(conditions, sort, skip, limit, last, { values, before: false }) },
      endBefore: (...values: [string, string]) => { chain("endBefore", values); return make(conditions, sort, skip, limit, last, { values, before: true }) },
      count: () => { chain("count", []); return { get: async () => ({ data: () => ({ count: select().length }) }) } },
      get: async () => {
        chain("get", [])
        let selected = select().sort((a, b) => ((a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0) || (a.id < b.id ? -1 : 1)) * (sort === "desc" ? -1 : 1))
        if (boundary) {
          const [slug, id] = boundary.values
          selected = selected.filter(company => {
            const compare = ((company.slug < slug ? -1 : company.slug > slug ? 1 : 0) || (company.id < id ? -1 : company.id > id ? 1 : 0)) * (sort === "desc" ? -1 : 1)
            return boundary.before ? compare < 0 : compare > 0
          })
        }
        selected = last ? selected.slice(-limit) : selected.slice(skip, skip + limit)
        return { docs: selected.map(company => ({ id: company.id, data: () => company })) }
      },
    }
    function select() {
      return companies.filter(company => conditions.every(([field, operator, value]) => {
        const stored = company[field as keyof Company]
        if (operator === "array-contains") return Array.isArray(stored) && stored.includes(value as string)
        if (operator === "==") return stored === value
        if (operator === ">=") return typeof stored === typeof value && (stored as string | number) >= (value as string | number)
        return typeof stored === typeof value && (stored as string | number) <= (value as string | number)
      }))
    }
    return query
  }
  return { collection: make() as unknown as CollectionReference, calls }
}

test("candidate orchestration unions selected batch queries and applies all groups locally", async () => {
  const { collection, calls } = mockCollection()
  const filters: DirectoryFilters = { ...empty, industry: ["B2B", "Healthcare"], employees: ["1-10", "501+"], batch: ["Winter 2026", "Summer 2026"], vc: ["YC", "Other"] }
  const result = await loadDirectoryCandidates(collection, filters)
  assert.deepEqual(calls.filter(call => call.method === "where").map(call => call.args), [["batch", "==", "Winter 2026"], ["batch", "==", "Summer 2026"]])
  assert.equal(calls.some(call => call.method === "orderBy"), false)
  assert.deepEqual(new Set(result.map(company => company.id)), new Set(data.filter(company => company.tags?.includes("B2B") || company.industry === "Healthcare").map(company => company.id)))
  const strict = await loadDirectoryCandidates(collection, { ...filters, industry: ["B2B"], employees: ["1-10"], vc: ["Other"] })
  assert.deepEqual(strict, [])
})

test("industry query unions deduplicate overlapping primary labels and tags", async () => {
  const { collection, calls } = mockCollection()
  const result = await loadDirectoryCandidates(collection, { ...empty, industry: ["B2B", "Healthcare", "Fintech"] })
  assert.equal(result.length, data.length)
  assert.equal(new Set(result.map(company => company.id)).size, data.length)
  assert.ok(calls.filter(call => call.method === "where").every(call => ["industry", "tags"].includes(String(call.args[0]))))
  assert.equal(calls.filter(call => call.method === "get").length, 5)
})

test("multi employee and VC candidates use only their selected field", async () => {
  for (const [group, values, field] of [["employees", ["1-10", "501+"], "employees"], ["vc", ["YC", "Other"], "vcBacker"]] as const) {
    const { collection, calls } = mockCollection()
    const result = await loadDirectoryCandidates(collection, { ...empty, [group]: [...values] })
    assert.equal(result.length, 25)
    assert.ok(calls.filter(call => call.method === "where").every(call => call.args[0] === field))
    assert.equal(calls.filter(call => call.method === "get").length, 2)
  }
})

test("combined filtering has stable pages, reverse ordering, clamping, and empty results", async () => {
  const { collection } = mockCollection()
  const filters = { ...empty, employees: ["1-10", "501+"] }
  const pages = await Promise.all([1, 2, 3].map(page => loadDirectoryPage(collection, filters, page, null, "next")))
  assert.deepEqual(pages.flatMap(page => page.companies.map(company => company.id)), data.map(company => company.id))
  assert.deepEqual(pages.map(page => page.totalCount), [25, 25, 25])
  const last = await loadDirectoryPage(collection, filters, 999, null, "next")
  assert.equal(last.page, 3)
  const descending = await loadDirectoryPage(collection, { ...filters, sort: "desc" }, 1, null, "next")
  assert.deepEqual(descending.companies.map(company => company.id), [...data].reverse().slice(0, 10).map(company => company.id))
  const none = await loadDirectoryPage(collection, { ...filters, q: "zzz" }, 999, null, "next")
  assert.equal(none.page, 1); assert.equal(none.totalCount, 0); assert.equal(none.totalPages, 0); assert.deepEqual(none.companies, [])
})

test("base path uses count and limited reads with valid two-part next/previous cursors", async () => {
  for (const sort of ["asc", "desc"] as const) {
    const { collection, calls } = mockCollection()
    const filters = { ...empty, sort }
    const first = await loadDirectoryPage(collection, filters, 1, null, "next")
    const second = await loadDirectoryPage(collection, filters, 2, parseCursor(first.lastItemCursor ?? undefined), "next")
    const previous = await loadDirectoryPage(collection, filters, 1, parseCursor(second.firstItemCursor ?? undefined), "prev")
    const expected = sort === "asc" ? data : [...data].reverse()
    assert.deepEqual(first.companies.map(company => company.id), expected.slice(0, 10).map(company => company.id))
    assert.deepEqual(second.companies.map(company => company.id), expected.slice(10, 20).map(company => company.id))
    assert.deepEqual(previous.companies, first.companies)
    assert.deepEqual(JSON.parse(first.lastItemCursor!), [first.companies[9].slug, first.companies[9].id])
    assert.equal(calls.filter(call => call.method === "count").length, 3)
    assert.equal(calls.filter(call => call.method === "get").length, 3)
    assert.equal(calls.filter(call => ["limit", "limitToLast"].includes(call.method)).length, 3)
  }
})

test("base path direct pages, invalid cursor fallback, clamping, search and no results", async () => {
  const { collection, calls } = mockCollection()
  const second = await loadDirectoryPage(collection, empty, 2, parseCursor('[5,"wrong","schema"]'), "next")
  assert.deepEqual(second.companies.map(company => company.id), data.slice(10, 20).map(company => company.id))
  assert.ok(calls.some(call => call.method === "offset" && call.args[0] === 10))
  const last = await loadDirectoryPage(collection, empty, 999, ["bad", "bad"], "next")
  assert.equal(last.page, 3); assert.equal(last.companies.length, 5)
  const searched = await loadDirectoryPage(collection, { ...empty, q: "COMPANY-01" }, 1, null, "next")
  assert.equal(searched.totalCount, 2)
  const none = await loadDirectoryPage(collection, { ...empty, q: "zzz" }, 4, null, "next")
  assert.equal(none.page, 1); assert.deepEqual(none.companies, [])
})

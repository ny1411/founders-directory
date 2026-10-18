import assert from "node:assert/strict"
import test from "node:test"
import type { CollectionReference } from "firebase-admin/firestore"
import { DIRECTORY_SCAN_LIMIT, loadDirectoryPage } from "./directory-query"
import { parseCursor, type DirectoryFilters } from "./directory-filters"
import type { Company } from "./types"

const empty: DirectoryFilters = { q: "", sort: "asc", industry: [], employees: [], batch: [], vc: [] }
const data = Array.from({ length: 450 }, (_, i) => ({
  id: String(i).padStart(3, "0"), slug: `company-${String(Math.floor(i / 2)).padStart(3, "0")}`,
  name: `Company ${i}`, batch: i % 2 ? "Winter 2026" : "Summer 2026", vcBacker: i % 2 ? "YC" : "Other",
  tags: i === 430 ? ["B2B"] : [], employees: i % 2 ? 5 : 1000,
} as Company))

function mockCollection(companies = data) {
  const calls: { method: string; value: unknown }[] = []
  let order = "asc", bound: [string, string] | null = null, take = Infinity
  let facet: { field: string; values: string[] } | null = null
  const query = {
    where(field: string, op: string, values: string[]) { assert.equal(op, "in"); facet = { field, values }; calls.push({ method: "where", value: field }); return query },
    orderBy(_field: unknown, value: string) { order = value; return query },
    startAfter(...value: [string, string]) { bound = value; return query },
    select(...fields: string[]) { calls.push({ method: "select", value: fields }); return query },
    limit(value: number) { take = value; calls.push({ method: "limit", value }); return query },
    async get() {
      assert.ok(Number.isFinite(take), "every get must have a hard limit")
      calls.push({ method: "get", value: take })
      const compare = (a: Company, b: { slug: string; id: string }) =>
        ((a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) * (order === "desc" ? -1 : 1)
      const docs = companies.filter(company => (!facet || facet.values.includes(String(company[facet.field as keyof Company]))) &&
        (!bound || compare(company, { slug: bound[0], id: bound[1] }) > 0))
        .sort(compare).slice(0, take).map(company => ({ id: company.id, data: () => company }))
      return { docs }
    },
  }
  return { collection: query as unknown as CollectionReference, calls }
}

test("default pages use at most 11 projected reads and forward/backward tie-breaker cursors", async () => {
  for (const sort of ["asc", "desc"] as const) {
    const firstMock = mockCollection()
    const filters = { ...empty, sort }
    const first = await loadDirectoryPage(firstMock.collection, filters, 1, null, "next")
    assert.equal(first.companies.length, 10)
    assert.deepEqual(firstMock.calls.filter(call => call.method === "get").map(call => call.value), [11])
    const fields = firstMock.calls.find(call => call.method === "select")!.value as string[]
    assert.ok(fields.includes("name")); assert.ok(!fields.includes("email"))
    const second = await loadDirectoryPage(mockCollection().collection, filters, 2, parseCursor(first.lastItemCursor!), "next")
    assert.equal(new Set([...first.companies, ...second.companies].map(company => company.id)).size, 20)
    const previous = await loadDirectoryPage(mockCollection().collection, filters, 1, parseCursor(second.firstItemCursor!), "prev")
    assert.deepEqual(previous.companies, first.companies)
  }
})

test("sparse filter windows stop at 200 and explicit continuation eventually discovers late records", async () => {
  const filters = { ...empty, industry: ["B2B"] }
  const first = await loadDirectoryPage(mockCollection().collection, filters, 1, null, "next")
  assert.deepEqual(first.companies, []); assert.equal(first.scanLimited, true); assert.equal(first.hasNext, true)
  const second = await loadDirectoryPage(mockCollection().collection, filters, 2, parseCursor(first.lastItemCursor!), "next")
  assert.deepEqual(second.companies, []); assert.equal(second.hasNext, true)
  const lastMock = mockCollection()
  const last = await loadDirectoryPage(lastMock.collection, filters, 3, parseCursor(second.lastItemCursor!), "next")
  assert.deepEqual(last.companies.map(company => company.id), ["430"])
  assert.equal(last.hasNext, false)
  assert.ok(lastMock.calls.every(call => call.method !== "get" || Number(call.value) <= DIRECTORY_SCAN_LIMIT))
})

test("indexed batch/VC selection and residual intersection preserve filtering", async () => {
  for (const [key, value, field] of [["batch", "Winter 2026", "batch"], ["vc", "YC", "vcBacker"]] as const) {
    const mocked = mockCollection()
    const result = await loadDirectoryPage(mocked.collection, { ...empty, [key]: [value], employees: ["1-10"] }, 1, null, "next")
    assert.equal(result.companies.length, 10)
    assert.ok(result.companies.every(company => company.employees === 5))
    assert.deepEqual(mocked.calls.filter(call => call.method === "where").map(call => call.value), [field])
  }
})

test("legacy displayed names still match, and a deep page without valid cursor resets instead of offset scanning", async () => {
  const companies = [{ ...data[0], name: "10 By 10", slug: "ten-by-ten" }]
  const result = await loadDirectoryPage(mockCollection(companies).collection, { ...empty, q: " 10   bY 10 " }, 100000, null, "next")
  assert.equal(result.page, 1); assert.equal(result.companies.length, 1)
  assert.equal(result.totalCount, null); assert.equal(result.hasNext, false)
})

test("normalization caps free text, facet fanout and cursor lengths", async () => {
  const { parseDirectoryFilters } = await import("./directory-filters")
  const labels = Array.from({ length: 20 }, (_, i) => `VC ${i}`)
  const parsed = parseDirectoryFilters({ q: "x".repeat(500), vc: labels }, { batches: [], vcs: labels })
  assert.equal(parsed.q.length, 100); assert.equal(parsed.vc.length, 10)
  assert.equal(parseCursor(JSON.stringify(["x".repeat(501), "id"])), null)
})

test("missing composite indexes fall back only to a bounded projected slug window", async () => {
  const base = mockCollection()
  const missing = {
    orderBy() { return missing }, select() { return missing }, limit() { return missing },
    async get(): Promise<never> { throw Object.assign(new Error("missing index"), { code: 9 }) },
  }
  const collection = new Proxy(base.collection, {
    get(target, key) { return key === "where" ? () => missing : Reflect.get(target, key) },
  })
  const result = await loadDirectoryPage(collection, { ...empty, batch: ["Winter 2026"] }, 1, null, "next")
  assert.equal(result.companies.length, 10)
  assert.ok(result.companies.every(company => company.batch === "Winter 2026"))
  assert.deepEqual(base.calls.filter(call => call.method === "get").map(call => call.value), [DIRECTORY_SCAN_LIMIT])
})

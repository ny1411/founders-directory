import assert from "node:assert/strict"
import test from "node:test"
import type { CollectionReference } from "firebase-admin/firestore"
import {
  companyCacheTag,
  loadCompanyBySlug,
  loadFoundersByCompanyId,
  normalizeCompanySlug,
} from "./company-query"
import CompanyImage from "../app/company/[slug]/opengraph-image"

function fakeCollection<T extends { id: string }>(documents: T[]) {
  let reads = 0
  const collection = {
    where(field: keyof T, operator: string, value: unknown) {
      assert.equal(operator, "==")
      return {
        limit(count: number) {
          assert.equal(count, 1)
          return { get: async () => {
            reads++
            const matches = documents.filter(document => document[field] === value).slice(0, count)
            return { empty: matches.length === 0, docs: matches.map(document => ({ id: document.id, data: () => document })) }
          } }
        },
        get: async () => {
          reads++
          const matches = documents.filter(document => document[field] === value)
          return { docs: matches.map(document => ({ id: document.id, data: () => document })) }
        },
      }
    },
  }
  return { collection: collection as unknown as CollectionReference, reads: () => reads }
}

test("valid company and founders load from bounded queries", async () => {
  const companies = fakeCollection([{ id: "company-1", slug: "acme", name: "Acme" }])
  const founders = fakeCollection([{ id: "founder-1", companyId: "company-1", name: "A" }])
  assert.equal(normalizeCompanySlug(" ACME "), "acme")
  assert.deepEqual(await loadCompanyBySlug(companies.collection, "acme"), {
    id: "company-1", slug: "acme", name: "Acme",
  })
  assert.deepEqual(await loadFoundersByCompanyId(founders.collection, "company-1"), [
    { id: "founder-1", companyId: "company-1", name: "A" },
  ])
  assert.equal(companies.reads(), 1)
  assert.equal(founders.reads(), 1)
})

test("changed company data uses the same scoped invalidation tag", async () => {
  const documents = [{ id: "company-1", slug: "acme", name: "Before" }]
  const companies = fakeCollection(documents)
  assert.equal((await loadCompanyBySlug(companies.collection, "acme"))?.name, "Before")
  documents[0].name = "After"
  assert.equal((await loadCompanyBySlug(companies.collection, "acme"))?.name, "After")
  assert.equal(companyCacheTag("acme"), "company:acme")
  assert.notEqual(companyCacheTag("acme"), companyCacheTag("other"))
})

test("unknown and invalid slugs return no company", async () => {
  const companies = fakeCollection([{ id: "company-1", slug: "acme" }])
  assert.equal(await loadCompanyBySlug(companies.collection, "missing"), null)
  assert.equal(normalizeCompanySlug("../../etc/passwd"), null)
  assert.equal(normalizeCompanySlug("a".repeat(201)), null)
  assert.equal(companies.reads(), 1)
})

test("legacy per-company preview points to the shared image on the same host", () => {
  const response = CompanyImage()
  assert.equal(response.status, 308)
  assert.equal(response.headers.get("Location"), "/opengraph-image")
  assert.match(response.headers.get("Cache-Control") ?? "", /s-maxage=86400/)
})

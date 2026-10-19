import assert from "node:assert/strict"
import test from "node:test"
import type { CollectionReference } from "firebase-admin/firestore"
import { loadDirectorySnapshot } from "./directory-query"

interface Fixture {
  id: string
  slug: string
  name: string
  batch?: string | null
  vcBacker?: string | null
  privateNote?: string
}

function mockCollection(fixtures: Fixture[]) {
  const calls: { method: string; args: unknown[] }[] = []
  let selectedFields: string[] = []
  let maximum = Infinity

  const query = {
    select: (...fields: string[]) => {
      calls.push({ method: "select", args: fields })
      selectedFields = fields
      return query
    },
    orderBy: (...args: unknown[]) => {
      calls.push({ method: "orderBy", args })
      return query
    },
    limit: (value: number) => {
      calls.push({ method: "limit", args: [value] })
      maximum = value
      return query
    },
    get: async () => {
      calls.push({ method: "get", args: [] })
      const sorted = [...fixtures].sort((left, right) => left.slug.localeCompare(right.slug)).slice(0, maximum)
      return {
        docs: sorted.map(fixture => ({
          id: fixture.id,
          data: () => Object.fromEntries(selectedFields
            .filter(field => field in fixture)
            .map(field => [field, fixture[field as keyof Fixture]])),
        })),
      }
    },
  }

  return { collection: query as unknown as CollectionReference, calls }
}

test("loads one bounded, ordered public projection and derives filter options", async () => {
  const { collection, calls } = mockCollection([
    { id: "b", slug: "beta", name: "Beta", batch: "Summer 2025", vcBacker: "Other", privateNote: "secret" },
    { id: "a", slug: "alpha", name: "Alpha", batch: "Winter 2026", vcBacker: "YC", privateNote: "secret" },
    { id: "c", slug: "charlie", name: "Charlie", batch: "Winter 2026", vcBacker: "YC", privateNote: "secret" },
  ])

  const result = await loadDirectorySnapshot(collection, 10)

  assert.deepEqual(result.companies.map(company => company.slug), ["alpha", "beta", "charlie"])
  assert.deepEqual(result.batches, ["Winter 2026", "Summer 2025"])
  assert.deepEqual(result.vcs, ["Other", "YC"])
  assert.equal(result.companies.some(company => "privateNote" in company), false)
  assert.deepEqual(calls.map(call => call.method), ["select", "orderBy", "limit", "get"])
  assert.deepEqual(calls.find(call => call.method === "orderBy")?.args, ["slug", "asc"])
  assert.deepEqual(calls.find(call => call.method === "limit")?.args, [11])
})

test("fails loudly instead of publishing a truncated directory", async () => {
  const fixtures = Array.from({ length: 4 }, (_, index) => ({
    id: String(index),
    slug: `company-${index}`,
    name: `Company ${index}`,
  }))
  const { collection } = mockCollection(fixtures)

  await assert.rejects(
    loadDirectorySnapshot(collection, 3),
    /exceeds its 3-record snapshot limit/,
  )
})

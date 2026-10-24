import assert from "node:assert/strict"
import test from "node:test"
import { decodeDirectoryShard, directoryIndexRef, directoryShard, directoryShardRef, DIRECTORY_INDEX_SHARDS,
  encodeDirectoryShard, MAX_INDEX_SHARD_BYTES, prepareDirectoryIndexUpdate, toDirectoryIndexEntry } from "./directory-index"
import { rebuildDirectoryIndex } from "./directory-index-rebuild"
import { memoryFirestore } from "../../scripts/directory/memory-firestore"

const companies = Array.from({ length: 6_013 }, (_, n) => [`companies/id-${String(n).padStart(5, "0")}`,
  { slug: `acme-${n}`, name: `Acme ${n}`, description: "Long description".repeat(200), email: "private@example.com",
    industry: "Healthcare", tags: ["B2B"], employees: 10, batch: "Winter 2026", vcBacker: "YC" }] as [string, Record<string, unknown>])

test("backfill dry run uses document cursors and bounded reads, validates sizes, and writes nothing", async () => {
  const f = memoryFirestore(companies)
  const report = await rebuildDirectoryIndex(f.db)
  assert.equal(report.companyCount, 6013)
  assert.equal(report.pages, 25)
  assert.equal(report.indexDocuments, 17)
  assert.ok(report.largestShardBytes < MAX_INDEX_SHARD_BYTES)
  assert.equal(f.records.size, 6013)
  const pages = f.reads.filter(read => read.collection === "companies")
  assert.ok(pages.every(read => read.limit === 250 && read.count <= 250))
  assert.equal(new Set(pages.slice(1).map(read => read.after)).size, 24)
})

test("publish stages all shards before swapping one manifest; compact index contains no card/private data", async () => {
  const f = memoryFirestore(companies)
  await rebuildDirectoryIndex(f.db, true)
  const manifest = (await directoryIndexRef(f.db).get()).data()!
  assert.equal(manifest.revision, 1)
  assert.ok(manifest.generation)
  const entries = (await Promise.all(Array.from({ length: DIRECTORY_INDEX_SHARDS }, async (_, shard) =>
    decodeDirectoryShard((await directoryShardRef(f.db, manifest.generation, shard).get()).data())))).flat()
  assert.equal(entries.length, 6013)
  assert.equal(new Set(entries.map(entry => entry.id)).size, 6013)
  for (const entry of entries) {
    assert.equal("description" in entry, false)
    assert.equal("email" in entry, false)
  }
})

test("concurrent company mutations fence a rebuild; failure preserves the previous manifest", async () => {
  const f = memoryFirestore(companies)
  await rebuildDirectoryIndex(f.db, true)
  const manifestRef = directoryIndexRef(f.db)
  const before = (await manifestRef.get()).data()!
  f.controls.onCompanyPage = () => {
    f.records.set(manifestRef.path, { ...before, revision: before.revision + 1 })
  }
  await assert.rejects(rebuildDirectoryIndex(f.db, true), /changed during index rebuild/)
  assert.equal((await manifestRef.get()).data()!.generation, before.generation)
  f.controls.onCompanyPage = undefined
  f.controls.failShardWrite = true
  await assert.rejects(rebuildDirectoryIndex(f.db, true), /Simulated shard write failure/)
  assert.equal((await manifestRef.get()).data()!.generation, before.generation)
})

test("transactional create, update and delete keep an initialized index accurate", async () => {
  const f = memoryFirestore()
  await rebuildDirectoryIndex(f.db, true)
  const generation = (await directoryIndexRef(f.db).get()).data()!.generation
  const id = "new-company"
  const ref = directoryShardRef(f.db, generation, directoryShard(id))
  for (const company of [{ slug: "acme", name: "Acme", description: "private" }, { slug: "acme", name: "Updated" }, null]) {
    await f.db.runTransaction(async transaction => {
      const commit = await prepareDirectoryIndexUpdate(f.db, transaction, id, company)
      commit()
    })
    const entries = decodeDirectoryShard((await ref.get()).data())
    assert.equal(entries.length, company ? 1 : 0)
    if (company) assert.equal(entries[0].name, company.name)
  }
  assert.equal((await directoryIndexRef(f.db).get()).data()!.revision, 4)
})

test("pre-backfill mutations increment revision and malformed/oversized data cannot publish", async () => {
  const f = memoryFirestore()
  await f.db.runTransaction(async transaction => {
    const commit = await prepareDirectoryIndexUpdate(f.db, transaction, "acme", { slug: "acme" })
    commit()
  })
  assert.deepEqual((await directoryIndexRef(f.db).get()).data(), { version: 1, generation: null, revision: 1 })
  assert.throws(() => toDirectoryIndexEntry("acme", { name: "Missing slug" }), /without/)
  assert.throws(() => encodeDirectoryShard([toDirectoryIndexEntry("acme", { slug: "acme", name: "x".repeat(MAX_INDEX_SHARD_BYTES) })]), /too large/)
  for (const data of [undefined, { version: 1, rows: "{}" }, { version: 2, rows: "[]" }]) {
    assert.throws(() => decodeDirectoryShard(data))
  }
  const invalid = memoryFirestore([["companies/acme", { name: "Missing slug" }]])
  await assert.rejects(rebuildDirectoryIndex(invalid.db, true), /without/)
  assert.equal(invalid.records.size, 1)
})

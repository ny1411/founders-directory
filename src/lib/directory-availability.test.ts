import assert from "node:assert/strict"
import test from "node:test"
import type { Firestore } from "firebase-admin/firestore"
import { directoryFailure, DirectoryAvailabilityError, directoryRead, logDirectoryFailure } from "./directory-availability"
import { loadDirectoryManifest, loadDirectoryShard } from "./directory-loader"
import { probeDirectoryAvailability } from "./directory-probe"
import { DIRECTORY_INDEX_SHARDS, encodeDirectoryShard, toDirectoryIndexEntry } from "./directory-index"
import { memoryFirestore } from "../../scripts/directory/memory-firestore"

test("backend status codes classify without serializing arbitrary errors or prototype keys", async () => {
  for (const [code, reason] of [[7, "permission_denied"], [8, "quota_exhausted"], [14, "backend_unavailable"],
    [16, "unauthenticated"], [5, "backend_not_found"], [4, "deadline"], ["app/invalid-credential", "credential_configuration"],
    ["constructor", "unknown"], ["private-project-token", "unknown"]] as const) {
    await assert.rejects(directoryRead("manifest", async () => { throw { code, message: "private database path", details: "secret" } }),
      error => error instanceof DirectoryAvailabilityError && error.stage === "manifest" && error.reason === reason)
  }
  assert.deepEqual(directoryFailure(new Error("quota private path")), { stage: "unknown", reason: "unknown" })
})

test("absent manifest is distinguishable from denied/backend reads and invalid published data", async () => {
  const f = memoryFirestore()
  await assert.rejects(loadDirectoryManifest(f.db), { stage: "manifest", reason: "manifest_uninitialized" })
  f.records.set("directoryIndexes/companies-v1", { version: 999, generation: "private", revision: 0 })
  await assert.rejects(loadDirectoryManifest(f.db), { stage: "manifest", reason: "manifest_invalid" })
  await assert.rejects(loadDirectoryShard(f.db, "fixture", 0), { stage: "shard", reason: "shard_invalid" })
  const denied = { collection: () => ({ doc: () => ({ get: async () => { throw { code: 7, message: "private denial" } } }) }) } as unknown as Firestore
  await assert.rejects(loadDirectoryManifest(denied), { stage: "manifest", reason: "permission_denied" })
})

function published() {
  const f = memoryFirestore([["directoryIndexes/companies-v1", { version: 1, generation: "fixture", revision: 1 }]])
  for (let shard = 0; shard < DIRECTORY_INDEX_SHARDS; shard++) {
    const rows = shard === 0 ? Array.from({ length: 12 }, (_, index) => {
      const id = `company-${index}`
      const data = { slug: id, name: id, privateContact: "private@example.com" }
      f.records.set(`companies/${id}`, data)
      return toDirectoryIndexEntry(id, data)
    }) : []
    f.records.set(`directoryIndexes/companies-v1/generations/fixture/directoryShards/${shard}`, encodeDirectoryShard(rows))
  }
  return f
}

test("uncached readiness probe reads all 17 index documents and at most ten cards, without scanning or changing records", async () => {
  const f = published()
  const before = JSON.stringify([...f.records])
  assert.deepEqual(await probeDirectoryAvailability(f.db), { status: "available", indexDocuments: 17, companyDocuments: 10 })
  assert.equal(f.reads.reduce((count, read) => count + read.count, 0), 27)
  assert.ok(f.reads.every(read => read.limit === undefined), "probe must use document reads rather than collection scans")
  assert.equal(JSON.stringify([...f.records]), before)
})

test("probe identifies a missing company, preserves backend failure stage, and bounds hanging reads", async () => {
  const f = published()
  f.records.delete("companies/company-0")
  assert.deepEqual(await probeDirectoryAvailability(f.db), { status: "unavailable", stage: "companies", reason: "company_missing" })
  const hung = { collection: () => ({ doc: () => ({ get: () => new Promise(() => {}) }) }) } as unknown as Firestore
  assert.deepEqual(await probeDirectoryAvailability(hung, 5), { status: "unavailable", stage: "manifest", reason: "deadline" })
})

test("a late manifest response after the probe deadline starts no shard or card reads", async () => {
  let finish!: (snapshot: { data: () => Record<string, unknown> }) => void
  let reads = 0
  const delayed = { collection: () => ({ doc: () => ({ get: () => {
    reads++
    return new Promise(resolve => { finish = resolve })
  } }) }) } as unknown as Firestore
  assert.deepEqual(await probeDirectoryAvailability(delayed, 5), { status: "unavailable", stage: "manifest", reason: "deadline" })
  finish({ data: () => ({ version: 1, revision: 1, generation: "fixture" }) })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reads, 1)
})

test("outage event logs contain only finite stage/reason values", t => {
  const logged: string[] = []
  t.mock.method(console, "warn", (value: unknown) => { logged.push(String(value)) })
  logDirectoryFailure("directory.home_unavailable", { code: 8, message: "private token", path: "private customer" })
  assert.deepEqual(logged.map(line => JSON.parse(line)), [{ event: "directory.home_unavailable", stage: "unknown", reason: "quota_exhausted" }])
  assert.doesNotMatch(logged.join(), /private|token|customer/)
})

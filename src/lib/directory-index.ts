import { createHash } from "node:crypto"
import type { Firestore, Transaction } from "firebase-admin/firestore"
import type { DirectoryCompany } from "./directory-types"

// Only fields needed to select IDs and compute facets/counts. Never card text,
// logos, contact data or founders. The full company documents remain canonical.
export const DIRECTORY_INDEX_FIELDS = ["slug", "name", "industry", "tags", "employees", "batch", "vcBacker"] as const
export type DirectoryIndexEntry = Pick<DirectoryCompany, "id" | typeof DIRECTORY_INDEX_FIELDS[number]>
export const DIRECTORY_INDEX_SHARDS = 16
export const DIRECTORY_INDEX_VERSION = 1
export const MAX_INDEX_SHARD_BYTES = 800_000

export interface DirectoryIndexManifest {
  version: number
  generation: string | null
  revision: number
}

export function directoryIndexRef(db: Firestore) {
  return db.collection("directoryIndexes").doc("companies-v1")
}

export function directoryShardRef(db: Firestore, generation: string, shard: number) {
  return directoryIndexRef(db).collection("generations").doc(generation)
    .collection("directoryShards").doc(String(shard))
}

export function directoryShard(id: string): number {
  return createHash("sha256").update(id).digest()[0] % DIRECTORY_INDEX_SHARDS
}

export function toDirectoryIndexEntry(id: string, data: Record<string, unknown>): DirectoryIndexEntry {
  if (typeof id !== "string" || !id || id.includes("/") || typeof data.slug !== "string" || !data.slug) {
    throw new Error("Cannot index a company without a document ID and slug")
  }
  const text = (value: unknown) => typeof value === "string" ? value : null
  return {
    id, slug: data.slug, name: text(data.name) ?? "",
    industry: text(data.industry),
    tags: Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === "string") : null,
    employees: typeof data.employees === "number" && Number.isSafeInteger(data.employees) ? data.employees : null,
    batch: text(data.batch), vcBacker: text(data.vcBacker),
  }
}

export function readIndexManifest(data: Record<string, unknown> | undefined): DirectoryIndexManifest {
  if (!data) return { version: DIRECTORY_INDEX_VERSION, generation: null, revision: 0 }
  if (data.version !== DIRECTORY_INDEX_VERSION || !Number.isSafeInteger(data.revision) ||
    (data.revision as number) < 0 || (data.generation !== null &&
      (typeof data.generation !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(data.generation)))) {
    throw new Error("Invalid directory index manifest")
  }
  return data as unknown as DirectoryIndexManifest
}

export function encodeDirectoryShard(entries: DirectoryIndexEntry[]) {
  // A JSON string avoids indexing every nested field/array member in Firestore.
  // Escaping this string for Next's cache stays below its 2 MB entry limit.
  const rows = JSON.stringify(entries)
  if (Buffer.byteLength(rows) > MAX_INDEX_SHARD_BYTES) {
    throw new Error("Directory index shard is too large; repartition before publishing")
  }
  return { version: DIRECTORY_INDEX_VERSION, rows }
}

export function decodeDirectoryShard(data: Record<string, unknown> | undefined): DirectoryIndexEntry[] {
  if (data?.version !== DIRECTORY_INDEX_VERSION || typeof data.rows !== "string" ||
    Buffer.byteLength(data.rows) > MAX_INDEX_SHARD_BYTES) throw new Error("Missing or invalid directory index shard")
  const rows: unknown = JSON.parse(data.rows)
  if (!Array.isArray(rows)) throw new Error("Invalid directory index rows")
  return rows.map(row => {
    if (!row || typeof row !== "object") throw new Error("Invalid directory index entry")
    return toDirectoryIndexEntry(row.id, row)
  })
}

/** Prepare all reads before the caller starts company/founder writes. */
export async function prepareDirectoryIndexUpdate(
  db: Firestore, transaction: Transaction, id: string, company: Record<string, unknown> | null,
): Promise<() => void> {
  const ref = directoryIndexRef(db)
  const manifest = readIndexManifest((await transaction.get(ref)).data())
  const shardRef = manifest.generation ? directoryShardRef(db, manifest.generation, directoryShard(id)) : null
  const entries = shardRef ? decodeDirectoryShard((await transaction.get(shardRef)).data()) : []
  const next = entries.filter(entry => entry.id !== id)
  if (company) next.push(toDirectoryIndexEntry(id, company))
  const shardData = shardRef ? encodeDirectoryShard(next) : null
  return () => {
    // Even pre-backfill writes increment the revision, fencing concurrent rebuilds.
    transaction.set(ref, { ...manifest, revision: manifest.revision + 1 })
    if (shardRef && shardData) transaction.set(shardRef, shardData)
  }
}

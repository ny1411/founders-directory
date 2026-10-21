import { randomUUID } from "node:crypto"
import { FieldPath, type Firestore, type QueryDocumentSnapshot } from "firebase-admin/firestore"
import { decodeDirectoryShard, directoryIndexRef, directoryShard, directoryShardRef,
  DIRECTORY_INDEX_FIELDS, DIRECTORY_INDEX_SHARDS, DIRECTORY_INDEX_VERSION, encodeDirectoryShard,
  readIndexManifest, toDirectoryIndexEntry, type DirectoryIndexEntry } from "./directory-index"

/** Administrative maintenance only. Ordinary requests never scan companies. */
export async function rebuildDirectoryIndex(db: Firestore, write = false) {
  const ref = directoryIndexRef(db)
  const before = readIndexManifest((await ref.get()).data())
  const shards: DirectoryIndexEntry[][] = Array.from({ length: DIRECTORY_INDEX_SHARDS }, () => [])
  let last: QueryDocumentSnapshot | undefined
  let companyCount = 0
  let pages = 0
  for (;;) {
    let query = db.collection("companies").select(...DIRECTORY_INDEX_FIELDS)
      .orderBy(FieldPath.documentId()).limit(250)
    if (last) query = query.startAfter(last)
    const snapshot = await query.get()
    pages++
    for (const document of snapshot.docs) {
      const entry = toDirectoryIndexEntry(document.id, document.data())
      shards[directoryShard(entry.id)].push(entry)
      companyCount++
    }
    if (snapshot.docs.length < 250) break
    last = snapshot.docs[snapshot.docs.length - 1]
  }
  // Validate ALL shard sizes/rows before staging any writes.
  const encoded = shards.map(entries => encodeDirectoryShard(entries))
  for (const shard of encoded) decodeDirectoryShard(shard)
  const report = { write, companyCount, pages, indexDocuments: DIRECTORY_INDEX_SHARDS + 1,
    largestShardBytes: Math.max(...encoded.map(shard => Buffer.byteLength(shard.rows))) }
  if (!write) return report

  const generation = randomUUID()
  // Independent writes avoid Firestore's 10 MB aggregate commit limit. Readers
  // cannot see this generation until all shards exist and the pointer commits.
  await Promise.all(encoded.map((data, shard) => directoryShardRef(db, generation, shard).set(data)))
  await db.runTransaction(async transaction => {
    const current = readIndexManifest((await transaction.get(ref)).data())
    if (current.revision !== before.revision || current.generation !== before.generation) {
      throw new Error("Companies changed during index rebuild; retry. The active index was not replaced.")
    }
    transaction.set(ref, { version: DIRECTORY_INDEX_VERSION, generation, revision: current.revision + 1 })
  })
  return report
}

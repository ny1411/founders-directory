import type { Firestore, Transaction } from "firebase-admin/firestore"

/** Call inside the company creation transaction, before any transaction writes.
 * Facet growth is bounded; a maintenance refresh removes obsolete labels. */
export async function readDirectoryMetadataUpdate(transaction: Transaction, db: Firestore,
  company: { batch?: string | null; vcBacker?: string | null }) {
  const ref = db.doc("metadata/directory-options")
  const snapshot = await transaction.get(ref)
  const data = snapshot.data()
  const add = (values: unknown, value: unknown) => [...new Set([
    ...(Array.isArray(values) ? values.filter((entry): entry is string => typeof entry === "string" && entry.length <= 200) : []),
    ...(typeof value === "string" && value.trim() && value.length <= 200 ? [value] : []),
  ])].sort().slice(0, 200)
  return { ref, data: { batches: add(data?.batches, company.batch), vcs: add(data?.vcs, company.vcBacker) } }
}

export async function updateDirectoryMetadata(db: Firestore, company: { batch?: string | null; vcBacker?: string | null }) {
  await db.runTransaction(async transaction => {
    const update = await readDirectoryMetadataUpdate(transaction, db, company)
    transaction.set(update.ref, update.data, { merge: true })
  })
}

import { config } from "dotenv"
import { FieldPath } from "firebase-admin/firestore"

// Explicit maintenance job, never executed on a web request. Reads public facet
// projections in pages of 200, writes only metadata/directory-options.
async function main() {
  config({ quiet: true })
  const { adminDb } = await import("../../src/lib/firebase-admin")
  const batches = new Set<string>()
  const vcs = new Set<string>()
  let cursor: string | undefined
  let read = 0
  for (;;) {
    let query = adminDb.collection("companies").select("batch", "vcBacker").orderBy(FieldPath.documentId()).limit(200)
    if (cursor) query = query.startAfter(cursor)
    const page = await query.get()
    for (const document of page.docs) {
      const data = document.data()
      if (typeof data.batch === "string" && data.batch.trim()) batches.add(data.batch)
      if (typeof data.vcBacker === "string" && data.vcBacker.trim()) vcs.add(data.vcBacker)
    }
    read += page.docs.length
    if (page.docs.length < 200) break
    cursor = page.docs[page.docs.length - 1].id
  }
  if (batches.size > 200 || vcs.size > 200) throw new Error("Facet metadata exceeds 200 values; review limits before publishing.")
  await adminDb.doc("metadata/directory-options").set({ batches: [...batches].sort(), vcs: [...vcs].sort(), updatedAt: new Date().toISOString() })
  console.log(`Refreshed public directory facet metadata from ${read} companies (${batches.size} batches, ${vcs.size} VCs).`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })

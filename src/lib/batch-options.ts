import { unstable_cache } from "next/cache"
import { adminDb } from "./firebase-admin"
import { sortBatches } from "./batch-filter"

export const getBatchOptions = unstable_cache(async () => {
  const snapshot = await adminDb.collection("companies").select("batch").get()
  return sortBatches(snapshot.docs.map(document => document.get("batch")))
}, ["company-batch-options"], { revalidate: 300 })

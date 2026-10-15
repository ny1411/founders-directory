import { unstable_cache } from "next/cache"
import { adminDb } from "./firebase-admin"
import { sortBatches } from "./batch-filter"
import { getVcOptions } from "./vc-filter"

/** Share one small, cached projection for all data-backed sidebar options. */
export const getDirectoryOptions = unstable_cache(async () => {
  const snapshot = await adminDb.collection("companies").select("batch", "vcBacker").get()
  return {
    batches: sortBatches(snapshot.docs.map(document => document.get("batch"))),
    vcs: getVcOptions(snapshot.docs.map(document => document.get("vcBacker"))),
  }
}, ["company-directory-options"], { revalidate: 300 })

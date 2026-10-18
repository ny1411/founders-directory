import { unstable_cache } from "next/cache"
import { adminDb } from "./firebase-admin"
import { sortBatches } from "./batch-filter"
import { getVcOptions } from "./vc-filter"

/** One metadata document replaces the former collection-wide projection scan.
 * Refresh it with scripts/directory/refresh-options.ts after bulk imports. */
export const getDirectoryOptions = unstable_cache(async () => {
  const snapshot = await adminDb.doc("metadata/directory-options").get()
  const data = snapshot.data()
  const fallbackBatches = Array.from({ length: 25 }, (_, i) => 2005 + i)
    .flatMap(year => ["Winter", "Spring", "Summer", "Fall"].map(season => `${season} ${year}`))
  return {
    batches: sortBatches(Array.isArray(data?.batches) ? data.batches.slice(0, 200) : fallbackBatches),
    vcs: getVcOptions(Array.isArray(data?.vcs) ? data.vcs.slice(0, 200) : ["YC"]),
  }
}, ["company-directory-options-v2"], { revalidate: 3600, tags: ["directory-options"] })

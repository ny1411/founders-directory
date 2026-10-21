import { unstable_cache } from "next/cache"
import { adminDb } from "./firebase-admin"
import { sortBatches } from "./batch-filter"
import { DIRECTORY_CACHE_TAG, DIRECTORY_REVALIDATE_SECONDS } from "./directory-cache"
import type { SearchParams } from "./directory-filters"
import type { DirectoryInitialData } from "./directory-types"
import { getVcOptions } from "./vc-filter"
import { createDirectoryReadFlight } from "./directory-read-flight"
import { decodeDirectoryShard, directoryIndexRef, directoryShardRef, DIRECTORY_INDEX_SHARDS,
  readIndexManifest } from "./directory-index"

import { buildDirectoryPage as selectDirectoryPage, loadDirectoryCompanies, logDirectoryRead,
  type DirectoryIndex } from "./directory-page"

const readOnce = createDirectoryReadFlight()

const getManifest = unstable_cache(() => readOnce("manifest", async () => {
  const snapshot = await directoryIndexRef(adminDb).get()
  logDirectoryRead("manifest", 1)
  const manifest = readIndexManifest(snapshot.data())
  if (!manifest.generation) throw new Error("Directory index is not initialized. Run directory:index before deploying.")
  return manifest
}), ["directory-index-manifest-v1"], { revalidate: DIRECTORY_REVALIDATE_SECONDS, tags: [DIRECTORY_CACHE_TAG] })

const getShard = unstable_cache((generation: string, shard: number) => readOnce(`shard:${generation}:${shard}`, async () => {
  const snapshot = await directoryShardRef(adminDb, generation, shard).get()
  logDirectoryRead("index", 1)
  return decodeDirectoryShard(snapshot.data())
}), ["directory-search-shard-v1"], { revalidate: DIRECTORY_REVALIDATE_SECONDS, tags: [DIRECTORY_CACHE_TAG] })

/** A compact materialized search index, not a snapshot of company card data. */
export async function getDirectoryIndex(): Promise<DirectoryIndex> {
  const manifest = await getManifest()
  const entries = (await Promise.all(Array.from({ length: DIRECTORY_INDEX_SHARDS },
    (_, shard) => getShard(manifest.generation!, shard)))).flat()
  return {
    entries,
    batches: sortBatches(entries.map(entry => entry.batch)),
    vcs: getVcOptions(entries.map(entry => entry.vcBacker)),
  }
}

const getCompanies = unstable_cache(
  (ids: string[]) => readOnce(`companies:${JSON.stringify(ids)}`, () => loadDirectoryCompanies(adminDb, ids)),
  ["directory-company-page-v1"], { revalidate: DIRECTORY_REVALIDATE_SECONDS, tags: [DIRECTORY_CACHE_TAG] },
)

export function buildDirectoryPage(index: DirectoryIndex, params: SearchParams) {
  return selectDirectoryPage(index, params, getCompanies)
}

export async function buildInitialDirectoryData(index: DirectoryIndex): Promise<DirectoryInitialData> {
  return { ...await buildDirectoryPage(index, {}), batches: index.batches, vcs: index.vcs }
}

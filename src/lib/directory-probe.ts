import type { Firestore } from "firebase-admin/firestore"
import { DirectoryAvailabilityError, directoryFailure, type DirectoryFailureStage } from "./directory-availability"
import { DIRECTORY_INDEX_SHARDS } from "./directory-index"
import { loadDirectoryManifest, loadDirectoryShard } from "./directory-loader"
import { buildDirectoryPage, loadDirectoryCompanies } from "./directory-page"

/** Uncached administrative read: at most 17 index documents and ten projected cards. */
export async function probeDirectoryAvailability(db: Firestore, timeoutMs = 10_000) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Error("Invalid probe deadline")
  let stage: DirectoryFailureStage = "manifest"
  let expired = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true
      reject(new DirectoryAvailabilityError(stage, "deadline"))
    }, timeoutMs)
  })
  try {
    const work = async () => {
      const manifest = await loadDirectoryManifest(db)
      if (expired) throw new DirectoryAvailabilityError(stage, "deadline")
      stage = "shard"
      const entries = (await Promise.all(Array.from({ length: DIRECTORY_INDEX_SHARDS },
        (_, shard) => loadDirectoryShard(db, manifest.generation!, shard)))).flat()
      if (expired) throw new DirectoryAvailabilityError(stage, "deadline")
      stage = "companies"
      const page = await buildDirectoryPage({ entries, batches: [], vcs: [] }, {}, ids => loadDirectoryCompanies(db, ids))
      return { status: "available" as const, indexDocuments: DIRECTORY_INDEX_SHARDS + 1, companyDocuments: page.companies.length }
    }
    return await Promise.race([work(), deadline])
  } catch (error) {
    return { status: "unavailable" as const, ...directoryFailure(error, stage) }
  } finally {
    clearTimeout(timer)
  }
}

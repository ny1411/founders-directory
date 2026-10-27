import type { Firestore } from "firebase-admin/firestore"
import { decodeDirectoryShard, directoryIndexRef, directoryShardRef, readIndexManifest } from "./directory-index"
import { DirectoryAvailabilityError, directoryRead } from "./directory-availability"
import { logDirectoryRead } from "./directory-page"

/** Shared by cached public loaders and the bounded, read-only operator probe. */
export async function loadDirectoryManifest(db: Firestore) {
  const snapshot = await directoryRead("manifest", () => directoryIndexRef(db).get())
  logDirectoryRead("manifest", 1)
  let manifest
  try { manifest = readIndexManifest(snapshot.data()) }
  catch { throw new DirectoryAvailabilityError("manifest", "manifest_invalid") }
  if (!manifest.generation) throw new DirectoryAvailabilityError("manifest", "manifest_uninitialized")
  return manifest
}

export async function loadDirectoryShard(db: Firestore, generation: string, shard: number) {
  const snapshot = await directoryRead("shard", () => directoryShardRef(db, generation, shard).get())
  logDirectoryRead("index", 1)
  try { return decodeDirectoryShard(snapshot.data()) }
  catch { throw new DirectoryAvailabilityError("shard", "shard_invalid") }
}

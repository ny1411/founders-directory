import type { CollectionReference } from "firebase-admin/firestore"
import type { Company } from "./types"

const SEASON_ORDER: Record<string, number> = { Winter: 0, Spring: 1, Summer: 2, Fall: 3 }
const BATCH_PATTERN = /^(Winter|Spring|Summer|Fall) (\d{4})$/

/** Use only stored labels; recent calendar seasons appear first. */
export function sortBatches(values: unknown[]): string[] {
  const batches = [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))]
  return batches.sort((left, right) => {
    const leftParts = BATCH_PATTERN.exec(left)
    const rightParts = BATCH_PATTERN.exec(right)
    if (leftParts && rightParts) {
      return Number(rightParts[2]) - Number(leftParts[2]) || SEASON_ORDER[rightParts[1]] - SEASON_ORDER[leftParts[1]]
    }
    if (leftParts) return -1
    if (rightParts) return 1
    return left.localeCompare(right)
  })
}

export function parseBatch(value: string | string[] | null | undefined, batches: readonly string[]): string {
  return typeof value === "string" && batches.includes(value) ? value : "all"
}

export function matchesBatch(value: unknown, batch: string): boolean {
  return batch === "all" || value === batch
}

export function updateBatchParams(current: URLSearchParams, batch: string | null): URLSearchParams {
  const params = new URLSearchParams(current)
  if (batch === "all" || batch === null) params.delete("batch")
  else params.set("batch", batch)
  for (const key of ["page", "cursor", "direction"]) params.delete(key)
  return params
}

/** Fetch a single batch without ordering; remaining facets are applied to its candidates. */
export async function loadBatchCandidates(collection: CollectionReference, batch: string): Promise<Company[]> {
  const query = batch === "all" ? collection : collection.where("batch", "==", batch)
  const snapshot = await query.get()
  return snapshot.docs.map(document => ({ ...document.data(), id: document.id } as Company))
}

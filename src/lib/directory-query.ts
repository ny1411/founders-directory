import { FieldPath, type CollectionReference, type Query } from "firebase-admin/firestore"
import { matchesDirectoryFilters, type DirectoryFilters } from "./directory-filters"
import type { Company } from "./types"

export const DIRECTORY_PAGE_SIZE = 10
export const DIRECTORY_SCAN_LIMIT = 200
export interface DirectoryPage {
  companies: Company[]
  totalCount: number | null
  totalPages: number | null
  page: number
  firstItemCursor: string | null
  lastItemCursor: string | null
  hasPrevious: boolean
  hasNext: boolean
  scanLimited: boolean
}

/** One indexed window per request; legacy residual filters never load a full
 * collection. Continuation keeps all records discoverable for sparse filters. */
export async function loadDirectoryPage(collection: CollectionReference, filters: DirectoryFilters, requestedPage: number,
  cursor: [string, string] | null, direction: string): Promise<DirectoryPage> {
  let query: Query = collection
  if (filters.batch.length) query = query.where("batch", "in", filters.batch.slice(0, 10))
  else if (filters.vc.length) query = query.where("vcBacker", "in", filters.vc.slice(0, 10))
  const backwards = direction === "prev" && cursor !== null
  const order = backwards ? (filters.sort === "asc" ? "desc" : "asc") : filters.sort
  query = query.orderBy("slug", order).orderBy(FieldPath.documentId(), order)
  if (cursor) query = query.startAfter(...cursor)
  const residual = !!(filters.q || filters.industry.length || filters.employees.length || (filters.batch.length && filters.vc.length))
  let readLimit = residual ? DIRECTORY_SCAN_LIMIT : DIRECTORY_PAGE_SIZE + 1
  const fields = ["slug", "name", "logoUrl", "oneLiner", "description", "vcBacker",
    "industry", "employees", "location", "tags", "batch"]
  let snapshot
  try {
    snapshot = await query.select(...fields).limit(readLimit).get()
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if ((code !== 9 && code !== "failed-precondition") || (!filters.batch.length && !filters.vc.length)) throw error
    // During index rollout, preserve availability with the same hard scan bound.
    // Never fall back to the old collection-wide candidate query.
    console.warn(JSON.stringify({ event: "directory_index_unavailable", fallback: "bounded_slug_window" }))
    let fallback = collection.orderBy("slug", order).orderBy(FieldPath.documentId(), order)
    if (cursor) fallback = fallback.startAfter(...cursor)
    readLimit = DIRECTORY_SCAN_LIMIT
    snapshot = await fallback.select(...fields).limit(readLimit).get()
  }
  const companies: Company[] = []
  let consumed = 0
  for (const document of snapshot.docs) {
    consumed++
    const company = { ...document.data(), id: document.id } as Company
    if (matchesDirectoryFilters(company, filters)) companies.push(company)
    if (companies.length === DIRECTORY_PAGE_SIZE) break
  }
  const toCursor = (index: number) => {
    const document = snapshot.docs[index]
    return document ? JSON.stringify([document.data().slug, document.id]) : null
  }
  const more = consumed < snapshot.docs.length || snapshot.docs.length === readLimit
  if (backwards) companies.reverse()
  return {
    companies, totalCount: null, totalPages: null,
    page: cursor ? Math.max(1, Math.min(Number.isSafeInteger(requestedPage) ? requestedPage : 1, 100000)) : 1,
    firstItemCursor: backwards ? toCursor(consumed - 1) : toCursor(0),
    lastItemCursor: backwards ? toCursor(0) : toCursor(consumed - 1),
    hasPrevious: backwards ? more : cursor !== null,
    hasNext: backwards ? cursor !== null : more,
    scanLimited: consumed === DIRECTORY_SCAN_LIMIT && companies.length < DIRECTORY_PAGE_SIZE,
  }
}

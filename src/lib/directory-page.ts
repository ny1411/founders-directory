import type { Firestore } from "firebase-admin/firestore"
import { matchesDirectoryFilters, parseDirectoryFilters, parsePage, type SearchParams } from "./directory-filters"
import { paginateCompanies } from "./company-pagination"
import type { DirectoryCompany, DirectoryPageData } from "./directory-types"
import type { DirectoryIndexEntry } from "./directory-index"

export const DIRECTORY_PAGE_SIZE = 10
export const DIRECTORY_FIELDS = ["slug", "name", "oneLiner", "description", "logoUrl", "vcBacker",
  "industry", "employees", "location", "tags", "batch"] as const

export interface DirectoryIndex {
  entries: DirectoryIndexEntry[]
  batches: string[]
  vcs: string[]
}

export function logDirectoryRead(kind: "manifest" | "index" | "companies", count: number) {
  // Count actual datastore work inside cache loaders; never log queries or rows.
  console.info(JSON.stringify({ event: "directory.datastore_read", kind, document_count: count }))
}

export async function loadDirectoryCompanies(db: Firestore, ids: string[]): Promise<DirectoryCompany[]> {
  if (ids.length > DIRECTORY_PAGE_SIZE || new Set(ids).size !== ids.length ||
    ids.some(id => !id || id.includes("/"))) throw new Error("Invalid directory page IDs")
  if (!ids.length) return []
  const documents = await db.getAll(...ids.map(id => db.collection("companies").doc(id)),
    { fieldMask: [...DIRECTORY_FIELDS] })
  logDirectoryRead("companies", documents.length)
  const byId = new Map(documents.map(document => [document.id, document]))
  // BatchGet response order is not guaranteed. Reapply the stable index ordering.
  return ids.map(id => {
    const document = byId.get(id)
    if (!document?.exists) throw new Error("Directory index is out of sync; rebuild it before serving this page")
    return { ...document.data(), id } as DirectoryCompany
  })
}

/** Select IDs in the index before fetching a single page. No Firestore offsets. */
export async function buildDirectoryPage(
  index: DirectoryIndex, params: SearchParams,
  loadCompanies: (ids: string[]) => Promise<DirectoryCompany[]>,
): Promise<DirectoryPageData> {
  const filters = parseDirectoryFilters(params, index)
  const result = paginateCompanies(index.entries.filter(entry => matchesDirectoryFilters(entry, filters)),
    parsePage(params.page), filters.sort, DIRECTORY_PAGE_SIZE)
  return {
    companies: await loadCompanies(result.companies.map(entry => entry.id)),
    totalCount: result.totalCount, totalPages: result.totalPages, page: result.page,
  }
}

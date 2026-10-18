import { unstable_cache } from "next/cache"
import { adminDb } from "./firebase-admin"
import { loadDirectoryPage } from "./directory-query"
import type { DirectoryFilters } from "./directory-filters"

export const EMPTY_DIRECTORY_FILTERS: DirectoryFilters = {
  q: "", sort: "asc", industry: [], employees: [], batch: [], vc: [],
}
export const getDefaultDirectory = unstable_cache(async () => {
  const [page, count] = await Promise.all([
    loadDirectoryPage(adminDb.collection("companies"), EMPTY_DIRECTORY_FILTERS, 1, null, "next"),
    adminDb.collection("companies").count().get(),
  ])
  return { ...page, totalCount: count.data().count }
}, ["directory-default-v2"], { revalidate: 3600, tags: ["directory-default"] })
export const getDirectorySearch = unstable_cache(async (filters: DirectoryFilters, page: number,
  cursor: [string, string] | null, direction: string) => {
  return loadDirectoryPage(adminDb.collection("companies"), filters, page, cursor, direction)
}, ["directory-search-v2"], { revalidate: 300, tags: ["directory-search"] })

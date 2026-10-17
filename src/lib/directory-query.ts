import { FieldPath, type CollectionReference, type Query } from "firebase-admin/firestore"
import { loadIndustryCandidates } from "./industry-filter"
import { loadEmployeeCandidates } from "./employee-filter"
import { loadBatchCandidates } from "./batch-filter"
import { loadVcCandidates } from "./vc-filter"
import { paginateCompanies } from "./company-pagination"
import { matchesDirectoryFilters, type DirectoryFilters } from "./directory-filters"
import type { Company } from "./types"

/** Union one facet's candidate queries, then intersect all groups in memory.
 * This avoids Firestore compound indexes and multiple array-contains clauses.
 */
export async function loadDirectoryCandidates(collection: CollectionReference, filters: DirectoryFilters): Promise<Company[]> {
  if (!filters.batch.length && !filters.industry.length && !filters.employees.length && !filters.vc.length) {
    const snapshot = await collection.get()
    return snapshot.docs
      .map(document => ({ ...document.data(), id: document.id } as Company))
      .filter(company => matchesDirectoryFilters(company, filters))
  }

  const [values, load] = filters.batch.length ? [filters.batch, loadBatchCandidates] :
    filters.industry.length ? [filters.industry, loadIndustryCandidates] :
      filters.employees.length ? [filters.employees, loadEmployeeCandidates] : [filters.vc, loadVcCandidates]
  const results = await Promise.all(values.map(value => load(collection, value)))
  return [...new Map(results.flat().map(company => [company.id, company])).values()]
    .filter(company => matchesDirectoryFilters(company, filters))
}

export async function loadDirectoryPage(collection: CollectionReference, filters: DirectoryFilters, requestedPage: number,
  cursor: [string, string] | null, direction: string, take = 10) {
  if (filters.q || filters.batch.length || filters.industry.length || filters.employees.length || filters.vc.length) {
    return paginateCompanies(await loadDirectoryCandidates(collection, filters), requestedPage, filters.sort, take)
  }

  // Keep the unfiltered directory efficient: count plus one limited page query.
  let query: Query = collection
  const count = await query.count().get()
  const totalCount = count.data().count
  const totalPages = Math.ceil(totalCount / take)
  const page = Math.min(Math.max(requestedPage, 1), Math.max(totalPages, 1))
  query = query.orderBy("slug", filters.sort).orderBy(FieldPath.documentId(), filters.sort)
  if (cursor && requestedPage === page && (page > 1 || direction === "prev")) {
    query = direction === "prev" ? query.endBefore(...cursor).limitToLast(take) : query.startAfter(...cursor).limit(take)
  } else {
    query = query.offset((page - 1) * take).limit(take)
  }
  const snapshot = await query.get()
  const companies = snapshot.docs.map(document => ({ ...document.data(), id: document.id } as Company))
  const toCursor = (company: Company | undefined) => company ? JSON.stringify([company.slug, company.id]) : null
  return { companies, totalCount, totalPages, page, firstItemCursor: toCursor(companies[0]), lastItemCursor: toCursor(companies[companies.length - 1]) }
}

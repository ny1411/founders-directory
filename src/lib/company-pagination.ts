import type { DirectoryCompany } from "./directory-types"

/** Sort by slug with a stable document ID tie-breaker before slicing candidates. */
export function paginateCompanies<T extends Pick<DirectoryCompany, "id" | "slug">>(companies: T[], requestedPage: number, sort: string, take = 10) {
  const sorted = [...companies].sort((left, right) => {
    const bySlug = left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0
    const byId = left.id < right.id ? -1 : left.id > right.id ? 1 : 0
    return (bySlug || byId) * (sort === "desc" ? -1 : 1)
  })
  const totalCount = sorted.length
  const totalPages = Math.ceil(totalCount / take)
  const page = Math.min(Math.max(Number.isSafeInteger(requestedPage) ? requestedPage : 1, 1), Math.max(totalPages, 1))
  const items = sorted.slice((page - 1) * take, page * take)
  const cursor = (company: T | undefined) => company ? JSON.stringify([company.slug, company.id]) : null
  return { companies: items, totalCount, totalPages, page, firstItemCursor: cursor(items[0]), lastItemCursor: cursor(items[items.length - 1]) }
}

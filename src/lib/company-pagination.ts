import type { Company } from "./types"

/** Sort by slug with a stable document ID tie-breaker before slicing candidates. */
export function paginateCompanies(companies: Company[], requestedPage: number, sort: string, take = 10) {
  const sorted = [...companies].sort((left, right) => {
    const bySlug = left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0
    const byId = left.id < right.id ? -1 : left.id > right.id ? 1 : 0
    return (bySlug || byId) * (sort === "desc" ? -1 : 1)
  })
  const totalCount = sorted.length
  const totalPages = Math.ceil(totalCount / take)
  const page = Math.min(Math.max(Number.isSafeInteger(requestedPage) ? requestedPage : 1, 1), Math.max(totalPages, 1))
  const items = sorted.slice((page - 1) * take, page * take)
  const cursor = (company: Company | undefined) => company ? JSON.stringify([company.slug, company.id]) : null
  return { companies: items, totalCount, totalPages, page, firstItemCursor: cursor(items[0]), lastItemCursor: cursor(items[items.length - 1]) }
}

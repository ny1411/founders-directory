import { EMPLOYEE_RANGES } from "./employee-filter"
import { INDUSTRIES } from "./industry-filter"
import { normalizeCompanySearch, type SearchParams } from "./directory-filters"

export const MAX_DIRECTORY_QUERY_LENGTH = 4096
export const MAX_DIRECTORY_SEARCH_LENGTH = 100
export const MAX_DIRECTORY_FACET_VALUES = 10
export const MAX_DIRECTORY_TOTAL_FACETS = 20
// Bound URL input independently of the collection size (one million companies).
export const MAX_DIRECTORY_PAGE = 100_000

const KEYS = ["q", "sort", "industry", "employees", "batch", "vc", "page"] as const
const FACETS = ["industry", "employees", "batch", "vc"] as const
const ALLOWED = new Set<string>(KEYS)
const INDUSTRY_BY_CASE = new Map(INDUSTRIES.map(value => [value.toLowerCase(), value]))

export type DirectoryRequestResult =
  | { ok: true; params: SearchParams; canonicalQuery: string }
  | { ok: false; error: string }

/** Validate before quota/snapshot work and serialize one stable URL for each query. */
export function parseDirectoryRequest(search: string): DirectoryRequestResult {
  if (search.length > MAX_DIRECTORY_QUERY_LENGTH) return invalid("Query is too long.")
  const input = new URLSearchParams(search)
  for (const key of input.keys()) {
    if (!ALLOWED.has(key)) return invalid("Unknown query parameter.")
  }

  for (const key of ["q", "sort", "page"] as const) {
    if (input.getAll(key).length > 1) return invalid(`Repeated ${key} parameter.`)
  }

  const params: SearchParams = {}
  const output = new URLSearchParams()
  const rawSearch = input.get("q") ?? ""
  if (rawSearch.length > MAX_DIRECTORY_SEARCH_LENGTH) return invalid("Search is too long.")
  const q = normalizeCompanySearch(rawSearch)
  // Unicode case folding can expand a bounded input (for example, İ → i̇).
  // Every accepted canonical query must remain valid without later truncation.
  if (q.length > MAX_DIRECTORY_SEARCH_LENGTH) return invalid("Search is too long.")
  if (q) { params.q = q; output.set("q", q) }

  const sort = input.get("sort") ?? "asc"
  if (sort !== "asc" && sort !== "desc") return invalid("Invalid sort order.")
  if (sort === "desc") { params.sort = sort; output.set("sort", sort) }

  let totalFacets = 0
  for (const facet of FACETS) {
    const values = input.getAll(facet)
    if (values.length > MAX_DIRECTORY_FACET_VALUES) return invalid("Too many facet values.")
    const normalized: string[] = []
    for (const raw of values) {
      if (!raw || raw !== raw.trim() || raw.length > 100) return invalid("Invalid facet value.")
      let value: string = raw
      if (facet === "industry") {
        const industry = INDUSTRY_BY_CASE.get(raw.toLowerCase())
        if (!industry) return invalid("Invalid industry.")
        value = industry
      } else if (facet === "employees" && !(EMPLOYEE_RANGES as readonly string[]).includes(raw)) {
        return invalid("Invalid employee range.")
      }
      normalized.push(value)
    }
    const unique = [...new Set(normalized)].sort()
    totalFacets += unique.length
    if (totalFacets > MAX_DIRECTORY_TOTAL_FACETS) return invalid("Too many facet selections.")
    if (unique.length) {
      params[facet] = unique
      for (const value of unique) output.append(facet, value)
    }
  }

  const rawPage = input.get("page") ?? "1"
  if (!/^[1-9]\d{0,5}$/.test(rawPage) || Number(rawPage) > MAX_DIRECTORY_PAGE) {
    return invalid("Invalid page number.")
  }
  if (rawPage !== "1") { params.page = rawPage; output.set("page", rawPage) }

  const canonicalQuery = output.toString()
  // URL.search includes its leading '?' on the following request.
  if (canonicalQuery.length >= MAX_DIRECTORY_QUERY_LENGTH) return invalid("Query is too long.")
  return { ok: true, params, canonicalQuery }
}

/** Dynamic labels require the compact index, but must precede card selection. */
export function hasKnownDirectoryFacets(params: SearchParams, options: { batches: readonly string[]; vcs: readonly string[] }): boolean {
  return ([['batch', options.batches], ['vc', options.vcs]] as const).every(([key, allowed]) => {
    const selected = params[key]
    return (typeof selected === "string" ? [selected] : selected ?? []).every(value => allowed.includes(value))
  })
}

function invalid(error: string): DirectoryRequestResult { return { ok: false, error } }

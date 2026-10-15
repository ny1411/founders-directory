import { INDUSTRIES, matchesIndustry } from "./industry-filter"
import { EMPLOYEE_RANGES, matchesEmployeeRange } from "./employee-filter"
import { matchesBatch } from "./batch-filter"
import { matchesVc } from "./vc-filter"
import type { Company } from "./types"

export type SearchParams = Record<string, string | string[] | undefined>
export const FILTER_GROUPS = ["industry", "employees", "batch", "vc"] as const
export type FilterGroup = typeof FILTER_GROUPS[number]
export interface DirectoryFilters {
  q: string
  sort: "asc" | "desc"
  industry: string[]
  employees: string[]
  batch: string[]
  vc: string[]
}

export function scalarParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : value?.[0] ?? ""
}

export function parseSelections(value: string | string[] | null | undefined, options: readonly string[]): string[] {
  const values = typeof value === "string" ? [value] : value ?? []
  return [...new Set(values.filter(item => options.includes(item)))]
}

export function parseDirectoryFilters(params: SearchParams, options: { batches: string[]; vcs: string[] }): DirectoryFilters {
  return {
    q: scalarParam(params.q).trim(),
    sort: scalarParam(params.sort) === "desc" ? "desc" : "asc",
    industry: parseSelections(params.industry, INDUSTRIES),
    employees: parseSelections(params.employees, EMPLOYEE_RANGES),
    batch: parseSelections(params.batch, options.batches),
    vc: parseSelections(params.vc, options.vcs),
  }
}

export function parsePage(value: string | string[] | undefined): number {
  const raw = scalarParam(value)
  const page = /^\d+$/.test(raw) ? Number(raw) : 1
  return Number.isSafeInteger(page) && page > 0 ? page : 1
}

export function parseCursor(value: string | string[] | undefined): [string, string] | null {
  try {
    const cursor: unknown = JSON.parse(scalarParam(value))
    return Array.isArray(cursor) && cursor.length === 2 && cursor.every(item => typeof item === "string") &&
      cursor[1].length > 0 && !cursor[1].includes("/")
      ? cursor as [string, string] : null
  } catch {
    return null
  }
}

export function matchesDirectoryFilters(company: Company, filters: DirectoryFilters): boolean {
  const q = filters.q.toLowerCase()
  return (!q || (company.slug >= q && company.slug <= q + "\uf8ff")) &&
    (!filters.industry.length || filters.industry.some(value => matchesIndustry(company, value))) &&
    (!filters.employees.length || filters.employees.some(value => matchesEmployeeRange(company.employees, value))) &&
    (!filters.batch.length || filters.batch.some(value => matchesBatch(company.batch, value))) &&
    (!filters.vc.length || filters.vc.some(value => matchesVc(company.vcBacker, value)))
}

export function directoryParams(filters: DirectoryFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.q) params.set("q", filters.q)
  if (filters.sort !== "asc") params.set("sort", filters.sort)
  for (const group of FILTER_GROUPS) for (const value of filters[group]) params.append(group, value)
  return params
}

/** All filter/search/sort edits reset pagination while preserving repeated selections. */
export function updateDirectoryParams(current: URLSearchParams, updates: Record<string, string | string[] | number | null>): URLSearchParams {
  const params = new URLSearchParams(current)
  if (Object.keys(updates).some(key => [...FILTER_GROUPS, "q", "sort"].includes(key))) {
    for (const key of ["page", "cursor", "direction"]) params.delete(key)
  }
  for (const [key, value] of Object.entries(updates)) {
    params.delete(key)
    if (value === null || value === "all" || (value === 1 && key === "page") || (value === "asc" && key === "sort")) continue
    for (const item of Array.isArray(value) ? value : [String(value)]) params.append(key, item)
  }
  return params
}

export function toggleSelection(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter(item => item !== value) : [...values, value]
}

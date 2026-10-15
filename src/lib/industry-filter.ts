import type { CollectionReference } from "firebase-admin/firestore"
import type { Company } from "./types"

export const INDUSTRIES = [
  "B2B",
  "Marketplace",
  "Travel",
  "Fintech",
  "Consumer",
  "Healthcare",
  "Education",
  "Industrials",
  "Real Estate and Construction",
  "Government",
  "Unspecified",
] as const

const TAG_ONLY_INDUSTRIES = new Set(["B2B", "Marketplace", "Travel"])

type IndustryCondition =
  | { field: "tags"; operator: "array-contains"; value: string }
  | { field: "industry"; operator: "=="; value: string }

/** Ignore malformed or unknown selections instead of querying arbitrary values. */
export function parseIndustry(value: string | string[] | undefined): string {
  return typeof value === "string" && INDUSTRIES.some(industry => industry === value)
    ? value
    : "all"
}

export function getIndustryConditions(industry: string): IndustryCondition[] {
  if (parseIndustry(industry) === "all") return []

  const tag: IndustryCondition = { field: "tags", operator: "array-contains", value: industry }
  // B2B must be an explicit tag: an industry label or description alone is insufficient.
  if (TAG_ONLY_INDUSTRIES.has(industry)) return [tag]

  return [{ field: "industry", operator: "==", value: industry }, tag]
}

export function matchesIndustry(company: Pick<Company, "industry" | "tags">, industry: string): boolean {
  if (industry === "Unspecified") {
    return !company.industry || company.industry === "Unspecified" || (Array.isArray(company.tags) && company.tags.includes(industry))
  }
  const conditions = getIndustryConditions(industry)
  return conditions.length === 0 || conditions.some(condition =>
    condition.operator === "array-contains"
      ? Array.isArray(company.tags) && company.tags.includes(condition.value)
      : company.industry === condition.value
  )
}

/** Single-field candidate queries avoid requiring a composite index for each filter combination. */
export async function loadIndustryCandidates(collection: CollectionReference, industry: string): Promise<Company[]> {
  // Firestore cannot query absent fields; include those companies in Unspecified explicitly.
  const conditions = getIndustryConditions(industry)
  const snapshots = industry === "Unspecified" || conditions.length === 0
    ? [await collection.get()]
    : await Promise.all(conditions.map(({ field, operator, value }) => collection.where(field, operator, value).get()))
  const companies = new Map<string, Company>()
  for (const snapshot of snapshots) {
    for (const document of snapshot.docs) {
      const company = { ...document.data(), id: document.id } as Company
      if (matchesIndustry(company, industry)) companies.set(document.id, company)
    }
  }
  return [...companies.values()]
}

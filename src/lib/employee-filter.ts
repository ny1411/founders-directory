import type { CollectionReference, Query } from "firebase-admin/firestore"
import type { Company } from "./types"

export const EMPLOYEE_RANGES = ["1-10", "11-50", "51-200", "201-500", "501+"] as const
export type EmployeeRange = typeof EMPLOYEE_RANGES[number]

const EMPLOYEE_BOUNDS: Record<EmployeeRange, readonly [number, number]> = {
  "1-10": [1, 10],
  "11-50": [11, 50],
  "51-200": [51, 200],
  "201-500": [201, 500],
  "501+": [501, Infinity],
}

export function parseEmployeeRange(value: string | string[] | undefined): EmployeeRange | "all" {
  return typeof value === "string" && EMPLOYEE_RANGES.some(range => range === value)
    ? value as EmployeeRange
    : "all"
}

/** Employee counts must be actual positive integers, not missing or coerced values. */
export function matchesEmployeeRange(value: unknown, range: string): boolean {
  const parsed = parseEmployeeRange(range)
  if (parsed === "all") return true
  const [minimum, maximum] = EMPLOYEE_BOUNDS[parsed]
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
}

/** Query only employees; other filters and alphabetical pagination run on these candidates. */
export async function loadEmployeeCandidates(collection: CollectionReference, range: string): Promise<Company[]> {
  const parsed = parseEmployeeRange(range)
  let query: Query = collection
  if (parsed !== "all") {
    const [minimum, maximum] = EMPLOYEE_BOUNDS[parsed]
    query = query.where("employees", ">=", minimum)
    if (Number.isFinite(maximum)) query = query.where("employees", "<=", maximum)
  }
  const snapshot = await query.get()
  return snapshot.docs
    .map(document => ({ ...document.data(), id: document.id } as Company))
    .filter(company => matchesEmployeeRange(company.employees, range))
}

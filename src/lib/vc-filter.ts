import type { CollectionReference } from "firebase-admin/firestore"
import type { Company } from "./types"

/** Offer only actual, nonempty string labels; retain their exact stored spelling. */
export function getVcOptions(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))]
    .sort((left, right) => left.localeCompare(right))
}

export function parseVc(value: string | string[] | null | undefined, vcs: readonly string[]): string {
  return typeof value === "string" && vcs.includes(value) ? value : "all"
}

export function matchesVc(value: unknown, vc: string): boolean {
  return vc === "all" || value === vc
}

/** Keep alphabetical sorting and other facets local to avoid composite index requirements. */
export async function loadVcCandidates(collection: CollectionReference, vc: string): Promise<Company[]> {
  const query = vc === "all" ? collection : collection.where("vcBacker", "==", vc)
  const snapshot = await query.get()
  return snapshot.docs
    .map(document => ({ ...document.data(), id: document.id } as Company))
    .filter(company => matchesVc(company.vcBacker, vc))
}

import { cache } from "react"
import { unstable_cache } from "next/cache"
import type { CollectionReference } from "firebase-admin/firestore"
import { adminDb } from "./firebase-admin"
import type { Company, Founder } from "./types"

export const COMPANY_REVALIDATE_SECONDS = 60 * 60

export function normalizeCompanySlug(slug: string): string | null {
  const normalized = slug.trim().toLowerCase()
  return /^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?$/.test(normalized)
    ? normalized
    : null
}

export function companyCacheTag(slug: string): string {
  return `company:${slug}`
}

export async function loadCompanyBySlug(
  collection: Pick<CollectionReference, "where">,
  slug: string,
): Promise<Company | null> {
  const snapshot = await collection.where("slug", "==", slug).limit(1).get()
  if (snapshot.empty) return null
  const document = snapshot.docs[0]
  return { ...document.data(), id: document.id } as Company
}

export async function loadFoundersByCompanyId(
  collection: Pick<CollectionReference, "where">,
  companyId: string,
): Promise<Founder[]> {
  const snapshot = await collection.where("companyId", "==", companyId).get()
  return snapshot.docs.map(document => ({ ...document.data(), id: document.id } as Founder))
}

// The persistent cache saves reads between requests; React cache shares one
// promise between generateMetadata and the page within the same render.
const getCompanyForRender = cache(async (slug: string): Promise<Company | null> =>
  unstable_cache(
    () => loadCompanyBySlug(adminDb.collection("companies"), slug),
    ["company", slug],
    { tags: [companyCacheTag(slug)], revalidate: COMPANY_REVALIDATE_SECONDS },
  )(),
)

const getFoundersForRender = cache(async (companyId: string): Promise<Founder[]> =>
  unstable_cache(
    () => loadFoundersByCompanyId(adminDb.collection("founders"), companyId),
    ["company-founders", companyId],
    { tags: [`company-founders:${companyId}`], revalidate: COMPANY_REVALIDATE_SECONDS },
  )(),
)

export async function getCompany(slug: string): Promise<Company | null> {
  const normalized = normalizeCompanySlug(slug)
  return normalized ? getCompanyForRender(normalized) : null
}

export function getCompanyFounders(companyId: string): Promise<Founder[]> {
  return getFoundersForRender(companyId)
}

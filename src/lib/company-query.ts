import { cache } from "react"
import { unstable_cache } from "next/cache"
import type { CollectionReference } from "firebase-admin/firestore"
import { adminDb } from "./firebase-admin"
import type { Company } from "./types"
import type { PublicFounder } from "./public-founder"

export const COMPANY_REVALIDATE_SECONDS = 60 * 60
// Public team display is deliberately bounded independently of the stricter
// submission limit. Read one sentinel so overflow never looks like a complete team.
export const MAX_COMPANY_FOUNDERS = 50
export const MAX_COMPANY_FOUNDERS_BYTES = 512 * 1024
export const PUBLIC_COMPANY_FIELDS = [
  "slug", "name", "oneLiner", "description", "logoUrl", "vcBacker", "industry",
  "employees", "stage", "location", "foundedYear", "website", "twitterUrl",
  "linkedinUrl", "tags", "batch", "ycUrl", "createdAt", "updatedAt",
] as const
export const PUBLIC_COMPANY_FOUNDER_FIELDS = [
  "companyId", "name", "role", "avatarUrl", "twitterUrl", "linkedinUrl", "bio",
] as const

export class CompanyFoundersUnavailableError extends Error {
  constructor(readonly reason: "limit_exceeded" | "invalid_record" | "payload_too_large") {
    super("Company founding team temporarily unavailable")
    this.name = "CompanyFoundersUnavailableError"
  }
}

function publicTeamMember(id: string, value: Record<string, unknown>, companyId: string): PublicFounder {
  if (value.companyId !== companyId || typeof value.name !== "string" || !value.name.trim() || value.name.length > 200) {
    throw new CompanyFoundersUnavailableError("invalid_record")
  }
  const optional = (key: "role" | "avatarUrl" | "twitterUrl" | "linkedinUrl" | "bio", max: number) => {
    const field = value[key]
    if (field == null) return null
    if (typeof field !== "string" || field.length > max) throw new CompanyFoundersUnavailableError("invalid_record")
    return field
  }
  return { id, companyId, name: value.name, role: optional("role", 200),
    avatarUrl: optional("avatarUrl", 2048), twitterUrl: optional("twitterUrl", 2048),
    linkedinUrl: optional("linkedinUrl", 2048), bio: optional("bio", 5000) }
}

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
  const snapshot = await collection.where("slug", "==", slug).limit(1).select(...PUBLIC_COMPANY_FIELDS).get()
  if (snapshot.empty) return null
  const document = snapshot.docs[0]
  return { ...document.data(), id: document.id } as Company
}

export async function loadFoundersByCompanyId(
  collection: Pick<CollectionReference, "where">,
  companyId: string,
): Promise<PublicFounder[]> {
  const snapshot = await collection.where("companyId", "==", companyId)
    .limit(MAX_COMPANY_FOUNDERS + 1).select(...PUBLIC_COMPANY_FOUNDER_FIELDS).get()
  if (snapshot.docs.length > MAX_COMPANY_FOUNDERS) throw new CompanyFoundersUnavailableError("limit_exceeded")
  const founders = snapshot.docs.map(document => publicTeamMember(document.id, document.data(), companyId))
  if (Buffer.byteLength(JSON.stringify(founders), "utf8") > MAX_COMPANY_FOUNDERS_BYTES) {
    throw new CompanyFoundersUnavailableError("payload_too_large")
  }
  return founders
}

// The persistent cache saves reads between requests; React cache shares one
// promise between generateMetadata and the page within the same render.
const getCompanyForRender = cache(async (slug: string): Promise<Company | null> =>
  unstable_cache(
    () => loadCompanyBySlug(adminDb.collection("companies"), slug),
    ["company-public-v2", slug],
    { tags: [companyCacheTag(slug)], revalidate: COMPANY_REVALIDATE_SECONDS },
  )(),
)

const getFoundersForRender = cache(async (companyId: string, slug: string): Promise<PublicFounder[]> =>
  unstable_cache(
    () => loadFoundersByCompanyId(adminDb.collection("founders"), companyId),
    ["company-founders-public-v2", companyId, slug],
    { tags: [`company-founders:${companyId}`, companyCacheTag(slug)], revalidate: COMPANY_REVALIDATE_SECONDS },
  )(),
)

export async function getCompany(slug: string): Promise<Company | null> {
  const normalized = normalizeCompanySlug(slug)
  return normalized ? getCompanyForRender(normalized) : null
}

export function getCompanyFounders(companyId: string, slug: string): Promise<PublicFounder[]> {
  const normalized = normalizeCompanySlug(slug)
  return normalized ? getFoundersForRender(companyId, normalized)
    : Promise.reject(new CompanyFoundersUnavailableError("invalid_record"))
}

import type { CollectionReference, DocumentData, QueryDocumentSnapshot } from "firebase-admin/firestore"
import { unstable_cache } from "next/cache"
import { adminDb } from "./firebase-admin"
import { sortBatches } from "./batch-filter"
import { DIRECTORY_CACHE_TAG, DIRECTORY_REVALIDATE_SECONDS } from "./directory-cache"
import { matchesDirectoryFilters, parseDirectoryFilters, parsePage, type SearchParams } from "./directory-filters"
import { paginateCompanies } from "./company-pagination"
import type { DirectoryCompany, DirectoryInitialData, DirectoryPageData } from "./directory-types"
import { getVcOptions } from "./vc-filter"

export const MAX_DIRECTORY_COMPANIES = 5_000
const MAX_DIRECTORY_BUCKET_COMPANIES = 2_000

const DIRECTORY_FIELDS = [
  "slug",
  "name",
  "oneLiner",
  "description",
  "logoUrl",
  "vcBacker",
  "industry",
  "employees",
  "location",
  "tags",
  "batch",
] as const

const DIRECTORY_BUCKETS: ReadonlyArray<readonly [string, string | null]> = [
  ["", "g"],
  ["g", "m"],
  ["m", "s"],
  ["s", null],
]

export interface DirectorySnapshot {
  companies: DirectoryCompany[]
  batches: string[]
  vcs: string[]
}

/**
 * Read one bounded, public projection for the ISR homepage.
 *
 * Query-string filters never call this function: they run over the serialized
 * snapshot in the browser. Reading one record beyond the cap makes growth fail
 * loudly instead of silently publishing an incomplete directory.
 */
export async function loadDirectorySnapshot(
  collection: CollectionReference,
  maximum = MAX_DIRECTORY_COMPANIES,
): Promise<DirectorySnapshot> {
  const snapshot = await collection
    .select(...DIRECTORY_FIELDS)
    .orderBy("slug", "asc")
    .limit(maximum + 1)
    .get()

  if (snapshot.docs.length > maximum) {
    throw new Error(`Company directory exceeds its ${maximum}-record snapshot limit`)
  }

  const companies = snapshot.docs.map(toDirectoryCompany)

  return createDirectorySnapshot(companies)
}

const getDirectoryBucket = unstable_cache(
  async (start: string, end: string | null): Promise<DirectoryCompany[]> => {
    let query = adminDb.collection("companies")
      .select(...DIRECTORY_FIELDS)
      .where("slug", ">=", start)
    if (end) query = query.where("slug", "<", end)

    const snapshot = await query
      .orderBy("slug", "asc")
      .limit(MAX_DIRECTORY_BUCKET_COMPANIES + 1)
      .get()
    if (snapshot.docs.length > MAX_DIRECTORY_BUCKET_COMPANIES) {
      throw new Error(`Company directory cache bucket exceeds ${MAX_DIRECTORY_BUCKET_COMPANIES} records`)
    }
    return snapshot.docs.map(toDirectoryCompany)
  },
  ["company-directory-bucket-v1"],
  {
    revalidate: DIRECTORY_REVALIDATE_SECONDS,
    tags: [DIRECTORY_CACHE_TAG],
  },
)

/**
 * Assemble four sub-2 MB cache entries. Next.js refuses individual Data Cache
 * values over 2 MB, while the current public projection is about 3.5 MB.
 */
export async function getDirectorySnapshot(): Promise<DirectorySnapshot> {
  const companies = (await Promise.all(
    DIRECTORY_BUCKETS.map(([start, end]) => getDirectoryBucket(start, end)),
  )).flat()

  if (companies.length > MAX_DIRECTORY_COMPANIES) {
    throw new Error(`Company directory exceeds its ${MAX_DIRECTORY_COMPANIES}-record snapshot limit`)
  }

  return createDirectorySnapshot(companies)
}

export function buildDirectoryPage(
  snapshot: DirectorySnapshot,
  params: SearchParams,
  take = 10,
): DirectoryPageData {
  const filters = parseDirectoryFilters(params, snapshot)
  const result = paginateCompanies(
    snapshot.companies.filter(company => matchesDirectoryFilters(company, filters)),
    parsePage(params.page),
    filters.sort,
    take,
  )

  return {
    companies: result.companies,
    totalCount: result.totalCount,
    totalPages: result.totalPages,
    page: result.page,
  }
}

export function buildInitialDirectoryData(snapshot: DirectorySnapshot): DirectoryInitialData {
  return {
    ...buildDirectoryPage(snapshot, {}),
    batches: snapshot.batches,
    vcs: snapshot.vcs,
  }
}

function toDirectoryCompany(document: QueryDocumentSnapshot<DocumentData>): DirectoryCompany {
  return { ...document.data(), id: document.id } as DirectoryCompany
}

function createDirectorySnapshot(companies: DirectoryCompany[]): DirectorySnapshot {
  return {
    companies,
    batches: sortBatches(companies.map(company => company.batch)),
    vcs: getVcOptions(companies.map(company => company.vcBacker)),
  }
}

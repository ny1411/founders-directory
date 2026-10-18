import { buildDirectoryPage, getDirectorySnapshot } from "@/lib/directory-query"
import type { SearchParams } from "@/lib/directory-filters"

export const dynamic = "force-dynamic"

const ALLOWED_PARAMS = new Set(["q", "sort", "industry", "employees", "batch", "vc", "page"])

export async function GET(request: Request) {
  const url = new URL(request.url)
  const params: SearchParams = {}

  for (const key of ALLOWED_PARAMS) {
    const values = url.searchParams.getAll(key)
    if (values.length === 1) params[key] = values[0]
    if (values.length > 1) params[key] = values
  }

  const snapshot = await getDirectorySnapshot()
  const result = buildDirectoryPage(snapshot, params)

  return Response.json(result, {
    headers: {
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  })
}

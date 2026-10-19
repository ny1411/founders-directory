import { buildDirectoryPage, getDirectorySnapshot } from "@/lib/directory-query"
import type { SearchParams } from "@/lib/directory-filters"
import { adminDb } from "@/lib/firebase-admin"
import { requestIp, reserveQuota } from "@/lib/rate-limit"
import { instrumentApiRoute } from "@/lib/observability-runtime"

export const dynamic = "force-dynamic"

const ALLOWED_PARAMS = new Set(["q", "sort", "industry", "employees", "batch", "vc", "page"])

async function directoryGet(request: Request) {
  const url = new URL(request.url)
  if (url.search.length > 4096) {
    return Response.json({ error: "Query is too long." }, {
      status: 400, headers: { "Cache-Control": "no-store" },
    })
  }
  const params: SearchParams = {}

  for (const key of ALLOWED_PARAMS) {
    const values = url.searchParams.getAll(key)
    if (values.length === 1) params[key] = values[0]
    if (values.length > 1) params[key] = values
  }

  try {
    // CDN hits need no origin work. Cache misses must reserve a durable IP quota
    // before loading the shared public snapshot or filtering any companies.
    const quota = await reserveQuota(adminDb, "directory-search", "", requestIp(request), [
      { name: "search-ip-minute", subject: "ip", limit: 60, windowMs: 60000 },
    ])
    if (!quota.allowed) {
      return Response.json({ error: "Too many searches. Try again shortly." }, {
        status: 429,
        headers: { "Retry-After": String(quota.retryAfterSeconds), "Cache-Control": "no-store" },
      })
    }
    const snapshot = await getDirectorySnapshot()
    const result = buildDirectoryPage(snapshot, params)
    return Response.json(result, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    })
  } catch (error) {
    console.error("Directory search failed", error)
    return Response.json({ error: "Search is temporarily unavailable. Please try again." }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    })
  }
}

export const GET = instrumentApiRoute({
  route: "/api/directory",
  event: "directory.query",
  durationMetric: "directory.query.duration_ms",
  provider: "firestore",
}, directoryGet)

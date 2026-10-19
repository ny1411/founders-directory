import { buildDirectoryPage, getDirectorySnapshot } from "@/lib/directory-query"
import { parseDirectoryRequest } from "@/lib/directory-request"
import { adminDb } from "@/lib/firebase-admin"
import { requestIp, reserveQuota } from "@/lib/rate-limit"
import { instrumentApiRoute } from "@/lib/observability-runtime"

export const dynamic = "force-dynamic"

async function directoryGet(request: Request) {
  if (request.url.length > 8192) {
    return Response.json({ error: "URL is too long." }, {
      status: 400, headers: { "Cache-Control": "no-store" },
    })
  }
  const url = new URL(request.url)
  const query = parseDirectoryRequest(url.search)
  if (!query.ok) {
    return Response.json({ error: query.error }, {
      status: 400, headers: { "Cache-Control": "no-store" },
    })
  }
  const canonicalSearch = query.canonicalQuery ? `?${query.canonicalQuery}` : ""
  if (url.search !== canonicalSearch) {
    // A redirect is cheap and makes equivalent URLs share the result cache key.
    return new Response(null, {
      status: 307,
      headers: { Location: `${url.pathname}${canonicalSearch}`, "Cache-Control": "no-store" },
    })
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
    const result = buildDirectoryPage(snapshot, query.params)
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

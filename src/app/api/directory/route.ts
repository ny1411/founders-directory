import { NextResponse } from "next/server"
import { adminDb } from "@/lib/firebase-admin"
import { getDirectorySearch } from "@/lib/directory-cache"
import { getDirectoryOptions } from "@/lib/directory-options"
import { parseCursor, parseDirectoryFilters, parsePage } from "@/lib/directory-filters"
import { requestIp, reserveQuota } from "@/lib/rate-limit"

export async function GET(request: Request) {
  const url = new URL(request.url)
  if (url.search.length > 4096) return NextResponse.json({ error: "Query is too long." }, { status: 400 })
  try {
    const quota = await reserveQuota(adminDb, "directory-search", "", requestIp(request), [
      { name: "search-ip-minute", subject: "ip", limit: 60, windowMs: 60000 },
    ])
    if (!quota.allowed) return NextResponse.json({ error: "Too many searches. Try again shortly." }, {
      status: 429, headers: { "Retry-After": String(quota.retryAfterSeconds), "Cache-Control": "no-store" },
    })
    const params = Object.fromEntries([...new Set(url.searchParams.keys())].map(key => [key, url.searchParams.getAll(key)]))
    const filters = parseDirectoryFilters(params, await getDirectoryOptions())
    const result = await getDirectorySearch(filters, parsePage(params.page), parseCursor(params.cursor),
      url.searchParams.get("direction") === "prev" ? "prev" : "next")
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("Directory search failed", error)
    return NextResponse.json({ error: "Search is temporarily unavailable. Please try again." }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    })
  }
}

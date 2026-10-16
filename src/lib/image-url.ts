export function normalizeImageUrl(value?: string | null) {
  const url = value?.trim()
  if (!url) return null

  let pathname: string

  if (url.startsWith("/") && !url.startsWith("//")) {
    pathname = url.split(/[?#]/, 1)[0]
  } else {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return null
    }

    // next.config.ts permits HTTPS remote images only. Reject unsupported
    // schemes here so malformed or legacy data renders the fallback instead
    // of throwing while next/image validates its source.
    if (parsed.protocol !== "https:") return null
    pathname = parsed.pathname
  }

  pathname = pathname.toLowerCase()
  return pathname.endsWith("/company/thumb/missing.png") ? null : url
}

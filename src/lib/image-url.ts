import { LOCAL_IMAGE_PATTERNS, REMOTE_IMAGE_PATTERNS, matchesImagePath } from "./image-policy"

export function normalizeImageUrl(value?: string | null) {
  // Firestore/scraped legacy values are untrusted at runtime despite TS types.
  if (typeof value !== "string") return null
  const raw = value.trim()
  if (!raw || raw.length > 3072 || /[\\\u0000-\u0020\u007f]/.test(raw)) return null

  try {
    const local = raw.startsWith("/")
    if (raw.startsWith("//")) return null
    const parsed = local ? new URL(raw, "https://image-policy.invalid") : new URL(raw)
    if (parsed.username || parsed.password || parsed.hash) return null
    if (parsed.pathname.toLowerCase().endsWith("/company/thumb/missing.png")) return null

    if (local) {
      const allowed = LOCAL_IMAGE_PATTERNS.some(pattern =>
        matchesImagePath(parsed.pathname, pattern.pathname) && parsed.search === pattern.search)
      return allowed ? parsed.pathname : null
    }

    const allowed = REMOTE_IMAGE_PATTERNS.some(pattern =>
      parsed.protocol === `${pattern.protocol}:` && parsed.hostname === pattern.hostname &&
      parsed.port === pattern.port && matchesImagePath(parsed.pathname, pattern.pathname) &&
      (pattern.search === undefined || parsed.search === pattern.search))
    return allowed ? parsed.href : null
  } catch {
    return null
  }
}

export function normalizeImageUrl(value?: string | null) {
  const url = value?.trim()
  if (!url) return null

  const pathname = url.split(/[?#]/, 1)[0].toLowerCase()
  return pathname.endsWith("/company/thumb/missing.png") ? null : url
}

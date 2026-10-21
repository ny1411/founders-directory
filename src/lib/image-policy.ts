import type { NextConfig } from "next"

// Keep config, submission validation, scraper ingestion and rendering on one
// source policy. Hosts are exact; never add a host or subdomain wildcard.
export const REMOTE_IMAGE_PATTERNS = [
  { protocol: "https", hostname: "bookface-images.s3.amazonaws.com", port: "", pathname: "/small_logos/**", search: "" },
  // Existing YC avatars/logos use signed S3 query strings. Preserve signatures;
  // arbitrary queries remain restricted to these paths on this exact bucket.
  { protocol: "https", hostname: "bookface-images.s3.us-west-2.amazonaws.com", port: "", pathname: "/avatars/**" },
  { protocol: "https", hostname: "bookface-images.s3.us-west-2.amazonaws.com", port: "", pathname: "/logos/**" },
  { protocol: "https", hostname: "logo.clearbit.com", port: "", pathname: "/*", search: "" },
  // Only the fixed icons already used by login and company pages.
  { protocol: "https", hostname: "www.svgrepo.com", port: "", pathname: "/show/475656/google-color.svg", search: "" },
  { protocol: "https", hostname: "thesvg.org", port: "", pathname: "/icons/x/default.svg", search: "" },
  { protocol: "https", hostname: "thesvg.org", port: "", pathname: "/icons/linkedin/default.svg", search: "" },
] satisfies NonNullable<NextConfig["images"]>["remotePatterns"]

export const LOCAL_IMAGE_PATTERNS = [
  { pathname: "/icon.png", search: "" },
  { pathname: "/logo.png", search: "" },
  { pathname: "/apple-touch-icon.png", search: "" },
  { pathname: "/images/**", search: "" },
]

export const IMAGE_CONFIG = {
  remotePatterns: REMOTE_IMAGE_PATTERNS,
  localPatterns: LOCAL_IMAGE_PATTERNS,
  // All current Image uses are fixed-size logos/avatars (16–96 CSS pixels).
  deviceSizes: [640],
  imageSizes: [16, 20, 32, 48, 64, 96, 128, 192, 256],
  qualities: [75],
  formats: ["image/webp"],
  maximumResponseBody: 5 * 1024 * 1024,
  maximumDiskCacheSize: 256 * 1024 * 1024,
  dangerouslyAllowSVG: false,
  contentDispositionType: "attachment",
  contentSecurityPolicy: "default-src 'none'; script-src 'none'; frame-src 'none'; sandbox;",
} satisfies NonNullable<NextConfig["images"]>

// Supported by the pinned Next 15 releases; these bound native decoder work,
// not project-wide request concurrency or the dimensions of a fallback original.
export const IMAGE_DECODER_CONFIG = {
  imgOptConcurrency: 2,
  imgOptMaxInputPixels: 16_000_000,
  imgOptTimeoutInSeconds: 5,
} satisfies NonNullable<NextConfig["experimental"]>

// This policy only uses literal paths and terminal /* or /** patterns.
export function matchesImagePath(pathname: string, pattern: string) {
  if (pattern.endsWith("/**")) return pathname.startsWith(pattern.slice(0, -2))
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1)
    const tail = pathname.slice(prefix.length)
    return pathname.startsWith(prefix) && Boolean(tail) && !tail.includes("/")
  }
  return pathname === pattern
}

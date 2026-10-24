import assert from "node:assert/strict"
import type { IncomingMessage } from "node:http"
import { before, mock, test } from "node:test"
import { PHASE_PRODUCTION_BUILD } from "next/constants"
import loadConfig from "next/dist/server/config"
import type { NextConfigComplete } from "next/dist/server/config-shared"
import { ImageOptimizerCache, fetchExternalImage, getSharp, optimizeImage } from "next/dist/server/image-optimizer"
import nextConfig from "../../next.config"
import { IMAGE_CONFIG, IMAGE_DECODER_CONFIG } from "../../src/lib/image-policy"
import { normalizeImageUrl } from "../../src/lib/image-url"
import { validateCompanySubmission } from "../../src/lib/company-submission"
import { parseCompany } from "../scraper/yc-company"
import type { YCCompany } from "../scraper/yc-directory"

const logo = "https://bookface-images.s3.amazonaws.com/small_logos/example.png"
const signed = "https://bookface-images.s3.us-west-2.amazonaws.com/avatars/example.jpg?X-Amz-Signature=fixture&X-Amz-Expires=3600"
let config: NextConfigComplete
before(async () => { config = await loadConfig(PHASE_PRODUCTION_BUILD, process.cwd(), { customConfig: nextConfig, silent: true }) })
const request = { headers: { accept: "image/webp" } } as IncomingMessage
const validate = (url: string, w = "64", q = "75") =>
  ImageOptimizerCache.validateParams(request, { url, w, q }, config, false)

test("the actual Next config uses exact host/path rules and bounded optimization settings", () => {
  assert.deepEqual(nextConfig.images, IMAGE_CONFIG)
  assert.deepEqual(nextConfig.experimental, IMAGE_DECODER_CONFIG)
  assert.equal(config.images.domains.length, 0)
  for (const pattern of IMAGE_CONFIG.remotePatterns) assert.doesNotMatch(pattern.hostname, /\*/)
  assert.equal(config.images.maximumResponseBody, 5 * 1024 * 1024)
  assert.equal(config.images.maximumDiskCacheSize, 256 * 1024 * 1024)
  assert.equal(config.images.dangerouslyAllowSVG, false)
  assert.equal(config.images.contentDispositionType, "attachment")
  assert.match(config.images.contentSecurityPolicy, /script-src 'none'/)
})

test("approved YC, signed legacy, Clearbit and fixed icon URLs agree with the optimizer allowlist", () => {
  for (const value of [logo, signed, signed.replace("/avatars/", "/logos/"),
    "https://logo.clearbit.com/quantierra.com", "/icon.png", "/images/og/og-image.jpg",
    "https://www.svgrepo.com/show/475656/google-color.svg", "https://thesvg.org/icons/x/default.svg",
    "https://thesvg.org/icons/linkedin/default.svg"]) {
    assert.equal(normalizeImageUrl(value), value)
    assert.ok(!("errorMessage" in validate(value)), value)
  }
  assert.equal(normalizeImageUrl(`  ${logo}  `), logo)
  assert.equal(normalizeImageUrl(logo.replace("https:", "HTTPS:")), logo)
})

test("direct optimizer calls reject unapproved origins, paths, ports, local APIs and cache-busting variants", () => {
  // Exercise Next's actual ingress validator, not only the UI helper. These
  // failures happen before the optimizer can fetch or decode an upstream image.
  for (const value of [
    "https://evil.example/logo.png", "http://127.0.0.1/logo.png", "https://[::1]/logo.png",
    "http://169.254.169.254/latest/meta-data", "//evil.example/logo.png",
    "https://bookface-images.s3.amazonaws.com.evil.example/small_logos/logo.png",
    "https://other-bucket.s3.amazonaws.com/small_logos/logo.png",
    logo.replace(".com/", ".com:8443/"), logo.replace("/small_logos/", "/unreviewed/"),
    `${logo}?noise=1`, "https://logo.clearbit.com/a/b", "https://logo.clearbit.com/a?noise=1",
    "https://www.svgrepo.com/show/other.svg", "https://thesvg.org/icons/other.svg",
    "/api/profile", "/company/example", "/images/../api/profile", "/images/%2e%2e/api/profile",
    "/icon.png?noise=1", "/images/og/og-image.jpg?noise=1", "/_next/image?url=/icon.png",
  ]) {
    assert.equal(normalizeImageUrl(value), null, value)
    assert.ok("errorMessage" in validate(value), value)
  }
})

test("render normalization rejects malformed legacy values, credentials, fragments and missing placeholders", () => {
  for (const value of [null, undefined, "", "invalid", "javascript:alert(1)", "data:image/png,abc",
    logo.replace("https://", "https://user:password@"), `${logo}#fragment`,
    logo.replace("/example", "/exa\nmple"), logo.replace("/small_logos/", "\\small_logos\\"),
    "/company/thumb/missing.png", "https://www.ycombinator.com/company/thumb/missing.png",
    "https://bookface-images.s3.amazonaws.com./small_logos/logo.png", "x".repeat(3073),
    42 as unknown as string, {} as unknown as string]) {
    assert.equal(normalizeImageUrl(value), null)
  }
})

test("direct optimizer callers cannot multiply quality or request oversized output variants", () => {
  assert.ok(!("errorMessage" in validate(logo, "192", "75")))
  assert.ok(!("errorMessage" in validate(logo, "640", "75")))
  for (const width of ["641", "1080", "3840", "100000"]) assert.ok("errorMessage" in validate(logo, width))
  for (const quality of ["1", "50", "99", "100"]) assert.ok("errorMessage" in validate(logo, "64", quality))
})

test("company and founder image fields reject unapproved sources without restricting ordinary website URLs", () => {
  const form = new FormData()
  form.set("name", "Example"); form.set("slug", "example"); form.set("founder_0_name", "Founder")
  form.set("website", "https://customer.example")
  for (const key of ["logoUrl", "founder_0_avatarUrl"]) {
    form.set(key, "https://customer.example/image.png")
    assert.match(validateCompanySubmission(form).fieldErrors?.[key] ?? "", /supported/)
    form.set(key, logo)
  }
  const valid = validateCompanySubmission(form).data!
  assert.equal(valid.company.logoUrl, logo)
  assert.equal(valid.founders[0].avatarUrl, logo)
  assert.equal(valid.company.website, "https://customer.example")
  form.set("logoUrl", ""); form.set("founder_0_avatarUrl", "")
  assert.equal(validateCompanySubmission(form).data?.company.logoUrl, null)
})

test("scraper ingestion drops unapproved page images and retains an approved listing fallback", () => {
  const company = { slug: "example", name: "Example", small_logo_url: "https://evil.example/a.png", founders: [] }
  const encoded = JSON.stringify({ props: { company } }).replace(/&/g, "&amp;").replace(/"/g, "&quot;")
  const html = `<div data-page="${encoded}"></div>`
  const listing = { slug: "example", small_logo_thumb_url: logo } as YCCompany
  assert.equal(parseCompany(html, listing).company.logoUrl, logo)
  assert.equal(parseCompany(html, { ...listing, small_logo_thumb_url: "https://evil.example/b.png" }).company.logoUrl, null)
})

test("the native fetcher enforces the configured cap against actual streamed bytes", async () => {
  const fetch = mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) {
      // No Content-Length is needed for the actual-body limit to reject this.
      controller.enqueue(new Uint8Array(IMAGE_CONFIG.maximumResponseBody))
      controller.enqueue(new Uint8Array(1))
      controller.close()
    },
  })))
  try {
    await assert.rejects(fetchExternalImage(logo, IMAGE_CONFIG.maximumResponseBody),
      (error: unknown) => error instanceof Error && "statusCode" in error && error.statusCode === 413)
  } finally { fetch.mock.restore() }
})

test("the native decoder refuses pixel expansion beyond the configured budget", async () => {
  const buffer = await getSharp(2)({ create: { width: 4001, height: 4000, channels: 3, background: "white" } }).png().toBuffer()
  await assert.rejects(optimizeImage({ buffer, contentType: "image/png", width: 64, quality: 75,
    concurrency: IMAGE_DECODER_CONFIG.imgOptConcurrency,
    limitInputPixels: IMAGE_DECODER_CONFIG.imgOptMaxInputPixels,
    timeoutInSeconds: IMAGE_DECODER_CONFIG.imgOptTimeoutInSeconds }), /pixel limit/i)
})

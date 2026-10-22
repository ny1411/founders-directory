# Image source and optimizer policy (#61)

`src/lib/image-policy.ts` is the shared policy for Next configuration and
`normalizeImageUrl`. Company submissions, scraper ingestion and `EntityImage`
rendering use the normalizer; unsupported legacy values render the existing
accessible company/person fallback without issuing an image request.

## Approved sources

The read-only inventory on 21 October 2026 covered 4,038 company records:
3,525 stable Bookface logos, 21 signed regional Bookface avatars/logos, two
Clearbit logos, and 490 empty/missing-placeholder values. No non-null founder
avatar records were found. No image data or historical documents were changed.

| Exact host | Allowed path | Query policy |
| --- | --- | --- |
| `bookface-images.s3.amazonaws.com` | `/small_logos/**` | None |
| `bookface-images.s3.us-west-2.amazonaws.com` | `/avatars/**`, `/logos/**` | Signed queries preserved |
| `logo.clearbit.com` | One path segment, e.g. `/quantierra.com` | None |
| `www.svgrepo.com` | `/show/475656/google-color.svg` | None |
| `thesvg.org` | `/icons/x/default.svg`, `/icons/linkedin/default.svg` | None |

All remote patterns require HTTPS and the standard port. No hostname or
subdomain wildcard is allowed. The regional S3 rules intentionally permit
query strings because existing URLs contain signatures: stripping or modifying
them breaks access. The normalizer preserves the original signature parameters;
it does not log them. Expired signed URLs may still fail and show the fallback;
the scraper prefers stable small logos when available.

Local optimization is limited to `/icon.png`, `/logo.png`,
`/apple-touch-icon.png` and `/images/**`, without queries. API endpoints,
company pages and other dynamic internal routes cannot be used as optimizer
sources. Credentials, fragments, control characters, backslashes and malformed
non-string values are rejected by the normalizer. Ordinary company websites
and social links retain their separate HTTP(S) URL policy.

New submission image fields return a field error for unsupported URLs and can
be left blank. Future image hosting must be added explicitly, with path/query
restrictions and tests. Do not restore a global `**` host rule to accommodate a
single new provider. This change neither provisions uploads/storage nor rewrites
historical data.

## Resource limits

The current image components use 16–96 CSS-pixel logos and avatars. The policy
allows widths `[16, 20, 32, 48, 64, 96, 128, 192, 256, 640]` and quality `75`.
Direct optimizer calls requesting other variants receive `400` before fetching
an upstream. Source responses are limited to 5 MiB of actual streamed bytes;
the self-hosted disk cache is capped at 256 MiB. Output negotiation uses WebP;
as in Next's default behavior, original formats may be returned when negotiation
or optimization does not apply. SVG optimization remains disabled, with
attachment disposition and a sandboxed image-response CSP. The three existing
fixed SVG icons continue through Next's normal unoptimized browser-image path.

Next 15's supported experimental decoder settings limit input to 16 million
pixels, native processing threads to two and processing time to five seconds.
These are decoder-work limits, not a project-wide concurrency quota. Next may
serve the bounded original when optimization fails; the pixel setting therefore
does not guarantee dimensions of every response. Upstream fetches retain Next's
native seven-second timeout.

The pinned Next 15 versions do **not** expose `maximumRedirects` or
`dangerouslyAllowLocalIP` image settings. This change does not invent unsupported
settings or disable framework protections. Approved image services are trusted
origins and Next's native fetch still follows redirects; this is not a claim of
redirect-target validation, DNS-rebinding prevention or network-level SSRF
isolation. Review redirect behavior when adding providers, and revisit the
framework's redirect/private-network controls on a supported upgrade. Direct
IP, unapproved-host and unapproved-path sources are rejected by the allowlist.
Edge rate limiting and project-wide request budgets remain separate work in
#59/#60. Merge dependency remediation #56 / PR #67 before production rollout;
an allowlist is not a substitute for patched image decoders.

## Verification

`scripts/security/image-policy.test.ts` loads the actual Next configuration and
uses its real optimizer ingress validator. It checks approved sources, signed
queries, direct disallowed requests, URL/variant bounds, submission validation,
scraper fallback, the native streamed byte cap and native decoder pixel limit.

`scripts/security/image-policy.browser.test.ts` runs the real `EntityImage` and
`next/image` in Chromium at desktop/mobile sizes, with fixture upstream bytes.
It checks approved loading, malformed/blocked/failed-source fallbacks, source
changes and absence of unapproved network requests. Browser plugin was not
available; Playwright is used. Both tests are included by `npm run test:security`.

```sh
npx tsx --test scripts/security/image-policy*.test.ts
npm run test:scraper
npx tsx --test src/lib/company-submission.test.ts
```

Production smoke checks should verify directory search, company navigation,
fixed icons and accessible image fallbacks, plus direct rejected
`/_next/image` calls. Hosted image optimization behavior should also be checked
in Preview; managed hosting may implement its own cache/decoder limits rather
than using every self-hosted setting.

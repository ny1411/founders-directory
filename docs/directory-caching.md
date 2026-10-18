# Directory caching and bounded search

`/` has no request/searchParams dependency and prerenders the default listing
page. Its ISR interval and default data TTL are one hour. After deployment,
repeat GET `/` and inspect `x-vercel-cache` for HIT/STALE; confirm the route is
prerendered in the Next build manifest and no function invocation on cache hits.

Interactive filters use GET `/api/directory`, with a durable IP quota (60/minute)
before the normalized five-minute Next data cache. Failures return 503; quota
rejections return 429 with Retry-After. Responses are no-store at HTTP level so
every request passes the quota. Vercel edge rules should cover this endpoint too.

Each search performs one slug/document-ID indexed query, fetching at most 200
public projected documents (11 for requests without residual filters), returning
at most 10 matches. Batch/VC equality facets narrow the indexed window. Other
legacy matching semantics (name prefix, industry tags, absent industry, employee
ranges, intersected groups) run only on that bounded window. Sparse windows can
contain fewer than 10 matches or none: use Next to continue. No offset queries,
unbounded candidate unions, or full-collection reads execute on a request.
Page numbers without valid cursors reset to the first page. Exact filtered
totals are deliberately omitted because computing them would require full scans;
the hero count remains the cached aggregate directory count. Previous navigation
reverses the index traversal and remains bounded, so sparse windows may group
matches differently when traversed backwards. All records remain discoverable.

Query strings are capped at 4096 characters, search text at 100, selections at
10 per group, and cursor components at 500. Only public card/filter fields are
selected; API responses never contain founder contacts or arbitrary company data.

Deploy the indexes in `firestore.indexes.json` using the existing Firebase project
and wait until READY for efficient batch/VC searches. Missing-index failures use a
bounded 200-document slug window so filtering remains available during rollout.
The additional historical
employees/industry composite indexes address the previously logged missing indexes.
This configuration should be merged with any externally managed existing indexes;
do not delete unrelated indexes during deployment.

Deployment verification on this task could list indexes but creation returned
PERMISSION_DENIED. The Firebase project owner must run the committed additive
`npx tsx scripts/directory/deploy-indexes.ts` with index-admin credentials. Existing
employees+slug was READY; missing batch/VC composites remain an ops prerequisite.
The facet metadata refresh succeeded against 4,038 companies, producing 46 batch
labels and one VC label, writing only `metadata/directory-options`.

The sidebar now reads `metadata/directory-options`, one bounded metadata document.
Before deployment, run `npx tsx scripts/directory/refresh-options.ts` using the
configured Firebase credentials. This explicit maintenance command reads public
facet projections in pages of 200 and writes only that metadata document. Repeat
after bulk imports. Until it exists, fallback YC seasons and YC are offered.
Company creation updates its VC facet through `updateDirectoryMetadata` in a
separate transaction after the company write commits. An options outage does
not turn a successful company submission into a retry; the maintenance refresh
repairs any missed facet update. The metadata is capped at 200 labels per group.

Invalidate `directory-default` only for listing changes; `directory-options` only
when facet metadata changes; `directory-search` on company listing changes. The
tags are directory-specific and do not invalidate company pages/OG/sitemaps.
Founder/contact-only writes should not invalidate directory caches. On installed
Next 15 use the supported one-argument revalidateTag API. No browser-persistent
cache is used, avoiding stale local snapshots and version migration concerns.

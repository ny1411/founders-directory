# Company detail and founding-team cache (#37)

Company metadata and page rendering share the normalized-slug React cache. The
persistent Next Data Cache retains each public company and founding team for one
hour, and the public page uses ISR with the same interval. Invalid slugs perform
no company lookup; a valid unknown slug caches its null company result. The
legacy per-company Open Graph endpoint still redirects to the shared static
image, without company reads or image processing.

## Bound cold reads and cached data

A cold company detail render issues one company query (`limit(1)`) and one
founding-team query (`limit(51)`): at most **52 returned documents**, including
an overflow sentinel. Warm company/team cache entries avoid those reads; a CDN
hit avoids rendering. Billing can still include minimum query charges, retries,
and independent image/API requests. A field mask reduces transferred/cached
fields, not Firestore's document-read charge.

Both queries now project explicit public fields. Founding-team queries exclude
email, phone, provider enrichment fields and arbitrary future fields at the
Firestore boundary. Company queries likewise exclude unregistered fields.
The `company-public-v2` and `company-founders-public-v2` cache namespaces avoid
reusing previous full-document cache entries after deployment. The page retains
its public-founder allowlist as a second serialization boundary.

The public founding-team display supports **at most 50 founders**. This is a
resource ceiling for legacy/imported teams, deliberately above the current
10-founder submission limit. It is not a claim that larger teams are invalid.
The query reads one additional document to detect overflow: it never presents
the first 50 as the complete team. A future need for larger teams requires a
reviewed paginated display; do not simply remove the query limit.

Selected records must have a matching company ID, a nonempty name of at most
200 characters, and public text fields within the submission limits: role 200,
URLs 2,048 each, and biography 5,000 characters. Missing optional fields become
null. The complete serialized public team must also fit within **512 KiB**, well
below Next's cached-entry limit. This byte check bounds the successful cached
payload; it does not limit bytes already transferred by Firestore. The query's
51-document ceiling and Firestore's individual document limit separately bound
that retrieval. No unbounded scan or second fallback query is attempted.

## Explicit incomplete state and recovery

Overflow, malformed public records and an excessive encoded team raise a typed
failure. They are never cached as an empty or partial team. The company page
preserves company information but displays **“Founding team temporarily
unavailable”** and emits the fixed event `company.founders_unavailable` with one
of `limit_exceeded`, `invalid_record`, or `payload_too_large`. No company ID,
slug, founder name, contact field or exception message appears in that event.
An actually empty successful query remains distinct and shows no founder cards.

Ordinary Firestore/SDK failures still propagate through the existing error path;
this change does not disguise a database outage as a healthy empty team. The
explicit unavailable page may itself be stored in the one-hour ISR cache. A
reload does not force regeneration. After fixing the underlying data or adding
a supported paginated display, invalidate the affected company tag/path through
the existing reviewed mutation mechanism, or wait for successful revalidation.
Repeated failures can keep the unavailable state visible.

Both company and founding-team entries carry `company:<normalized-slug>`. The
founder entry also retains `company-founders:<company-id>`. Invalidating the
company tag therefore refreshes that company's data and founders together,
without invalidating unrelated companies. Existing submission tag/path
invalidation is preserved. External imports/manual edits must use a reviewed
invalidation path or account for the one-hour data lifetime; this code does not
purge caches when someone edits Firestore outside the application.

## Verification

```bash
node --import tsx --test scripts/security/company-cache.test.ts src/lib/company-query.test.ts scripts/security/privacy-render.test.ts
```

The security suite automatically runs `scripts/security/company-cache.test.ts`.
Its isolated cache boundaries execute the real loaders, metadata and page code:
normalized metadata/page deduplication, reuse across renders, scoped company/team
invalidation, public field masks, all 50 supported founders, a 51-document
sentinel against 1,000 fixture records, bounded payload failures, explicit page
fallback, cached unknown slugs, and propagated datastore failures. No production
credentials, writes or provider calls are required. The cache harness checks the
application contract; it does not prove Vercel CDN or Next cache internals.

On a ready Preview deployment, inspect `x-vercel-cache`, `cache-control` and
`age` while requesting the same company and shared OG image repeatedly. Compare
Firestore read counts, then update a fixture company through an authorized
mutation and confirm only its company/team data refreshes. Record these deployed
results separately; READY builds and local tests alone do not establish cache
hit rates or live datastore availability.

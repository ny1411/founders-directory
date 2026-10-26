# Directory caching and read budget

The public homepage remains a force-static ISR route. Ordinary page requests
no longer scan the `companies` collection. No company/founder schema or composite
Firestore index is required. The configured database was verified as Standard
edition during implementation.

## Read path

1. Load the `directoryIndexes/companies-v1` manifest and its 16 hash-partitioned
   `generations/<generation>/directoryShards/<0..15>` documents. These contain
   only company IDs, slugs, names, industries/tags, employee counts, batches and
   VC labels. Each shard has a separate one-hour Next Data Cache entry. Card
   descriptions, logos, locations, founders and contact details are excluded.
2. Match name/slug prefixes and multi-select facets against this compact
   materialized search index. Compute exact counts and facet options there.
   Sort by `(slug, document ID)`, in either direction, and select ten IDs for the
   numbered page. This preserves the existing URL and filter semantics without
   Firestore OR-query expansion limits or billed document offsets.
3. Batch-get **only those ten company documents**, with a public field mask.
   Restore index order because BatchGet response ordering is not guaranteed.
   Cache each ordered ID batch for one hour. Empty results read no companies.
   Missing company documents or missing/corrupt index data fail closed; there is
   deliberately no request-time full-collection fallback.
4. Serialize only those cards, counts and initial filter options to the browser.
   Company detail pages continue to load only the selected company's founders.

This is pagination over a materialized search index followed by bounded company
reads, rather than Firestore cursor queries for every facet combination. The
administrative backfill uses document-ID cursors. Query execution still performs
in-memory work proportional to the compact index size. If this becomes a CPU
bottleneck, move search/counting to a dedicated search service; do not restore
full company document scans.

## Expected document reads

| Scenario | Index documents | Company documents |
| --- | ---: | ---: |
| Completely cold first request | 17 (manifest + 16 shards) | At most 10 |
| New page/search with warm index and uncached ID batch | 0 | At most 10 |
| Identical ID batch with warm Data Cache | 0 | 0 |
| CDN/ISR cache hit | 0 | 0 |
| Empty search with warm index | 0 | 0 |
| Entire directory cache invalidated, then first load | 17 | At most 10 |

The old implementation read ~4,000 company documents per complete snapshot
rebuild. The new cold budget is at most **27 document reads**, excluding the
API's independent quota transaction (normally one read and one write), retries,
and company detail prefetches. There are no aggregation query or offset charges
in this read path. Individual shards and ID batches revalidate independently.
Each actual datastore loader emits `directory.datastore_read` with `kind` and
`document_count`; it does not log rows, raw searches, IDs, IPs or contact data.
Absence of these events on warm requests plus CDN headers demonstrates reuse.
Overlapping cold reads in one process share an in-flight promise; different
server instances can still each incur the cold budget.

## Index maintenance

Company submissions and the YC scraper update the affected shard, company and
founders in the same transaction. Reads precede all writes. A manifest revision
increments on every mutation, even before initial backfill; rebuilds refuse to
publish if that revision changed during the scan. The submission action retains
its existing tag/path invalidation. Out-of-process scraper changes appear after
normal revalidation (up to an hour), or after a deliberate cache invalidation.
Future company update/delete/import paths must call
`prepareDirectoryIndexUpdate` in their transaction; deletion passes `null`.
Manual console edits bypass this contract and require a rebuild.

An indexed mutation adds two index document reads/writes (manifest and affected
shard) to the company transaction. The shared revision document can contend
during high-volume imports; the scraper retains its transaction retry policy.
This deliberately trades modest write amplification for fewer public reads.

Sixteen SHA-256 buckets replace the 5,000-company total cap and uneven alphabetical
2,000-company bucket caps. Each encoded shard is limited to 800 KB, below the
Firestore document and Next cache limits. Monitor `largestShardBytes` with the
maintenance command and repartition/version the index before reaching that
byte limit. This is a finite materialized index, not an unlimited search engine.
JSON string storage avoids indexing every nested tag/entry; optionally exempt
`directoryShards.rows` from single-field indexing to eliminate its unused index.
No query depends on that field's Firestore index.

## Initial rollout and rebuild

**Run the backfill before deploying the new reader.** A missing index fails the
homepage build and directory API instead of publishing an empty directory or
performing a full scan. The command defaults to a read-only dry run:

```bash
npm run directory:index -- --dry-run
npm run directory:index -- --write --project=<configured-project-id>
```

A full maintenance run reads the company collection once in batches of 250,
selecting only search fields. It validates every row and shard size, then writes
16 documents into a new generation. A transaction checks the manifest revision
and atomically switches the active generation only after every shard exists.
A failed scan, invalid record, failed shard write or concurrent indexed mutation
never replaces the active generation. Retry a conflicting rebuild. Staged/old
generations remain available for investigation/rollback; no automatic destructive
cleanup is included. Rebuilds should be deliberate maintenance, not scheduled
on every cache expiry.

For the **first rollout**, pause company writes/imports until backfill and reader/
writer deployment finish: the previous application version does not increment
index revisions. Alternatively deploy the new writer helper before backfill.
For later rebuilds, the revision fence protects concurrent app/scraper writes.
After publishing a generation, invalidate the `company-directory` tag and `/`
through the existing application mechanism or deploy with a fresh cache; a CLI
write cannot purge Next's cache. Do not assume publishing immediately replaces
already-cached CDN responses.

## Request controls and verification

The directory API retains canonical URLs, the 8,192-character URL and 4,096-
character query limits, 100-character search, ten values per facet and twenty
selections overall. Both raw and normalized search lengths and the final encoded
canonical query are bounded, so case-fold expansion or escaping cannot generate
a redirect target that the same parser rejects. Unknown keys, malformed scalar
values and invalid static facets are rejected before quota/index work;
noncanonical equivalents redirect before any database work. Dynamic batch/VC
selections must all exist with their exact stored spelling in the compact index.
Their membership check runs after quota admission and index loading, before
filtering or company-card reads. Unknown or mixed known/unknown selections return
an uncacheable 400 rather than silently dropping filters and caching the full
directory under attacker-invented labels. Page input is independently bounded to 100,000 rather
than tied to the removed 5,000-company snapshot cap. Pages beyond actual results
still clamp to the final page.

The existing durable per-IP quota runs before index work. Successful responses
retain `public, s-maxage=3600, stale-while-revalidate=86400`; errors retain
`no-store`. Firewall rate limits and anomaly monitoring remain necessary.

Run `npm run test:directory`, `npm run test:filters`, and `npm run test:scraper`.
Tests use 6,013 fixture companies, cover every page including duplicate slugs,
assert ten-or-fewer company reads for cold/filtered/later pages, verify public
field projection, and exercise atomic index updates and interrupted rebuilds.
No production credentials or paid database calls are needed for these tests.

The read-only backfill check on the existing 4,038 companies completed in 17
cursor pages; the largest encoded shard was 51,592 bytes. No index was published
by that check. A fixture-backed production build and desktop/mobile Playwright
flow also passed; Browser plugin was not available, so regular Playwright was
used. Local Vercel Analytics script 404s were the only browser resource errors.

On staging, backfill the index, deploy, and record these bounded scenarios:

1. Cold homepage: 17 index documents and at most ten company reads.
2. Repeat homepage: CDN/ISR hit and no loader events.
3. Next/previous page and multi-group search: warm index, at most ten company
   reads on an uncached ID batch, then reuse on repeat.
4. Empty search: no company reads; count is zero.
5. Create one fixture company: only its hash shard changes; after tag invalidation,
   the count, filter options and its matching page include it.
6. Inspect response headers (`x-vercel-cache`, `cache-control`, `age`) alongside
   loader events and provider usage. Do not infer database reads from HTTP
   request counts alone, and account for quota operations and link prefetches.

Production deployment, backfill publication and live read-count verification are
separate rollout steps; passing local fixtures does not establish deployed cache
behavior.

## Sitemap metadata

`/sitemap.xml` reuses the published directory index instead of scanning every
company document during a build. A cold index load reads the manifest and sixteen
bounded shards; warm loads share the existing directory cache. Sitemap generation
does not load company cards or founders. Slugs are validated and deduplicated, and
company modification dates are omitted because the compact index has no source
update timestamp.

If index storage is unavailable, the sitemap contains the public homepage and
emits the fixed `sitemap.index_unavailable` warning without database details.
The route revalidates every five minutes so recovery restores company URLs;
this fallback is degraded metadata, not evidence that Firestore is healthy.
Investigate recurring warnings and verify a subsequent sitemap includes company
URLs after the backend recovers. `sitemap.partition_required` means the index
exceeds the 50,000-URL protocol limit: split the sitemap before treating metadata
coverage as complete. No unbounded scan or quota retry is used as a fallback.

## Homepage availability during backend outages

The public homepage remains `force-static`; its HTML revalidates every five
minutes while the shared directory data cache keeps its one-hour lifetime.
If loading the index or initial company cards fails, the server renders
“Directory temporarily unavailable” with a manual reload link. It does not
pass fake empty results to the directory, start automatic polling, or expose
backend exception details. A fixed `directory.home_unavailable` event identifies
the degraded render. Component-rendering defects remain errors.

This explicit unavailable page can itself be cached. After five minutes, a
request can still receive the previous HTML while ISR regenerates in the
background; a reload does not force a database refresh. Recovery requires a
successful subsequent regeneration, and successful underlying data can remain
stale for the existing one-hour cache interval. Repeated backend failures keep
the unavailable state visible; they do not establish a healthy empty directory.
Monitor the fixed event, resolve backend quota/availability, and verify company
cards return after regeneration. Deployment success during a quota outage proves
the site can serve a clear unavailable state, not that directory data is healthy.

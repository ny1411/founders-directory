# Directory caching and query model

The public homepage is a force-static ISR route. Vercel can serve its response
from the CDN/ISR cache without invoking a Next.js Function for every request.

## Data flow

1. An ISR render assembles four alphabetical Firestore buckets ordered by
   `slug`. Each bucket is cached independently because Next.js limits one Data
   Cache value to 2 MB; the complete public projection is about 3.5 MB.
   Every bucket query is capped at 2,001 reads and fails if it contains more
   than 2,000 records, preserving the cache-size safety margin.
2. The query selects only fields displayed by directory cards or used by public
   filters. Private company/founder data is never included in the snapshot.
3. The snapshot is capped at 5,000 companies and reads one extra record to
   detect overflow. Overflow fails the render rather than silently omitting
   companies.
4. The static homepage serializes only the first ten companies plus filter
   options. Search, filtering, sorting, and later pages call a GET endpoint that
   uses the shared snapshot and returns only one page. Exact query responses are
   CDN-cacheable for one hour.
5. The snapshot revalidates after one hour. Creating a company invalidates the
   `company-directory` tag immediately and revalidates `/`.

## Search abuse controls

The directory API keeps successful public responses CDN-cacheable. On cache
misses, a durable per-IP quota (60 searches per minute) runs before loading the
shared snapshot or computing a page. Cache hits bypass the origin and quota;
edge firewall rules cover traffic before it reaches the application. Quota
rejections return 429 with `Retry-After` and `Cache-Control: no-store`. Quota or
snapshot failures fail closed with an uncacheable 503 response.

The API enforces a request schema before quota or database work. The complete
URL is capped at 8,192 characters and its query string at 4,096 characters.
Only `q`, `sort`, `industry`, `employees`, `batch`, `vc`, and `page` are accepted;
unknown keys, repeated scalar keys, invalid static labels, and empty facets get
an uncacheable 400 response. Search is capped at 100 decoded characters, then
whitespace is collapsed and case is normalized. `sort` is `asc` or `desc`.
`page` is a canonical decimal integer from 1 through 500, matching the
5,000-record snapshot and ten-record page caps. Each facet accepts up to ten
input values and all facets together accept at most twenty distinct selections.
Industry labels accept case variants; stored batch and VC labels retain their
exact case. Facets are deduplicated and sorted. Default `sort=asc` and `page=1`
are omitted.

Valid but noncanonical URLs receive a 307 redirect with `Cache-Control:
no-store` before quota or snapshot work. The canonical URL uses a fixed key
order and `URLSearchParams` encoding, including `+` for spaces. Canonical
successful responses have `public, s-maxage=3600,
stale-while-revalidate=86400`; 400, 429, and 503 responses have `no-store`.
The browser builds canonical requests, but the server repeats validation.
Page bounds and exact filtered counts continue to come from the cached
snapshot, preserving pagination behavior.

This does not eliminate unique valid searches from distributed clients.
Firewall rate limits and anomaly monitoring remain necessary. Do not use raw
queries as metric dimensions or server cache keys.

This snapshot model does not need directory facet metadata or composite index
maintenance. The previous `metadata/directory-options` document is no longer
read or updated; existing live data is left untouched. Historical composite
index deployment permission failures do not block this directory implementation.

This replaces the former request-time candidate queries and in-memory server
filtering. Those queries could read broad candidate sets for every URL variant
and required several Firestore composite indexes. The static snapshot needs
only Firestore's built-in single-field `slug` index, so the historical missing
compound indexes are no longer part of the homepage request path.

## Production verification

After deployment, make two ordinary requests without a `Pragma: no-cache`
header and inspect the response:

```bash
curl -sSI https://founders.neerajyamaji.com/ \
  | grep -iE 'x-vercel-cache|cache-control|age|x-matched-path'
```

The first request after a deploy/revalidation may be `MISS`, `PRERENDER`, or
`STALE`. Repeated homepage requests should be cache-served rather than execute
the page function. Also verify a filtered URL such as `/?industry=B2B` uses the
same static shell and that repeated `/api/directory?industry=B2B` responses are
served from the CDN after the initial request.

Monitor the snapshot size. Before the collection reaches 5,000 records, either
raise the reviewed server-side cap or migrate search to a dedicated index. Do
not serialize the complete snapshot into the browser: at 4,038 records its
public JSON projection is already approximately 3.5 MB.

import type { MetadataRoute } from 'next';
import { directoryFailure } from './directory-availability';

const MAX_SITEMAP_URLS = 50_000;
type SitemapIndex = { entries: Array<{ slug: string }> };

/** Use the published compact index; never scan company documents for metadata. */
export async function buildSitemap(
  baseUrl: URL,
  loadIndex: () => Promise<SitemapIndex>,
  warn: (event: string, failure?: ReturnType<typeof directoryFailure>) => void =
    (event, failure) => console.warn(JSON.stringify({ event, ...failure })),
): Promise<MetadataRoute.Sitemap> {
  const root: MetadataRoute.Sitemap = [{
    url: new URL('/', baseUrl).toString(),
    changeFrequency: 'daily',
    priority: 1,
  }];
  let index: SitemapIndex;
  try {
    index = await loadIndex();
  } catch (error) {
    // A temporary backend outage must not prevent deploying the application.
    // The route revalidates so this root-only fallback is not permanent.
    warn('sitemap.index_unavailable', directoryFailure(error));
    return root;
  }
  const slugs = new Set(index.entries.map(entry => entry.slug.trim().toLowerCase())
    .filter(slug => slug !== 'new' && /^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?$/.test(slug)));
  if (slugs.size + root.length > MAX_SITEMAP_URLS) {
    // Do not silently truncate a growing directory. Split sitemap files before
    // the protocol's per-file limit is reached; the fixed event is actionable.
    warn('sitemap.partition_required');
    return root;
  }
  return [...root, ...[...slugs].sort().map(slug => ({
    url: new URL(`/company/${slug}`, baseUrl).toString(),
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }))];
}

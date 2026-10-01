import { chromium, type APIRequestContext } from 'playwright';
import { retry } from './yc-runner';

export interface YCCompany {
  slug: string;
  name: string;
  batch: string;
  one_liner?: string;
  long_description?: string;
  website?: string;
  small_logo_thumb_url?: string;
  team_size?: number;
  all_locations?: string;
  industry?: string;
  tags?: string[];
  stage?: string;
}

export interface SearchResult {
  hits: YCCompany[];
  nbHits: number;
  nbPages: number;
  page: number;
  hitsPerPage: number;
  facets?: { batch?: Record<string, number> };
}

export type Search = (batch?: string, page?: number) => Promise<SearchResult>;

// The unfiltered directory exposes only its first 1,000 hits. Batch filters
// partition the index into smaller searches, each of which can be fully paged.
export async function collectDirectory(search: Search): Promise<YCCompany[]> {
  const root = await search();
  const batches = Object.keys(root.facets?.batch ?? {}).sort();
  if (!batches.length) throw new Error('YC search returned no batch facets.');
  const companies = new Map<string, YCCompany>();

  for (const batch of batches) {
    const first = await search(batch, 0);
    if (first.nbPages * first.hitsPerPage < first.nbHits) {
      throw new Error(`Batch ${batch} exceeds YC search pagination limits (${first.nbHits} hits).`);
    }
    const batchSlugs = new Set<string>();
    const collect = (result: SearchResult) => {
      for (const company of result.hits) {
        if (!company.slug || company.slug.includes('/') || !company.name) {
          throw new Error(`Invalid company in YC batch ${batch}.`);
        }
        batchSlugs.add(company.slug);
        companies.set(company.slug, company);
      }
    };
    collect(first);
    for (let page = 1; page < first.nbPages; page++) collect(await search(batch, page));
    if (batchSlugs.size !== first.nbHits) {
      throw new Error(`Incomplete batch ${batch}: collected ${batchSlugs.size}/${first.nbHits}.`);
    }
    console.log(`Discovered ${batch}: ${batchSlugs.size} companies (${companies.size} unique total).`);
  }

  if (companies.size !== root.nbHits) {
    throw new Error(`Incomplete YC directory: discovered ${companies.size}/${root.nbHits}. Rerun discovery.`);
  }
  return [...companies.values()];
}

export async function discoverCompanies(api: APIRequestContext): Promise<YCCompany[]> {
  // Read the public search configuration from a real directory request so
  // changing YC's search key, application ID, or index requires no code edit.
  const source = await retry(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const responsePromise = page.waitForResponse(response =>
        new URL(response.url()).hostname.includes('algolia') &&
        new URL(response.url()).pathname.endsWith('/queries') && response.ok(),
      { timeout: 60_000 });
      // Attach the rejection handler immediately if navigation fails first.
      void responsePromise.catch(() => {});
      await page.goto('https://www.ycombinator.com/companies', {
        waitUntil: 'domcontentloaded', timeout: 60_000,
      });
      const response = await responsePromise;
      const request = response.request();
      // Algolia sends JSON with a form content type; postDataJSON() treats it
      // as form fields. Parse the actual request body instead.
      const body = JSON.parse(request.postData() ?? '{}') as { requests: { indexName: string }[] };
      if (!body.requests?.[0]?.indexName) throw new Error('Missing YC search index configuration.');
      const headers = Object.fromEntries(Object.entries(request.headers())
        .filter(([key]) => key.startsWith('x-algolia-') || key === 'content-type'));
      return { url: request.url(), headers, indexName: body.requests[0].indexName };
    } finally {
      await browser.close();
    }
  }, 'Read YC directory search configuration');

  const search: Search = async (batch, page = 0) => retry(async () => {
    const params = new URLSearchParams({
      query: '', page: String(page), hitsPerPage: '500',
      facets: JSON.stringify(['batch']), maxValuesPerFacet: '1000',
      attributesToHighlight: '[]', analytics: 'false',
      ...(batch === undefined ? {} : { facetFilters: JSON.stringify([`batch:${batch}`]) }),
    });
    const response = await api.post(source.url, {
      headers: source.headers,
      data: { requests: [{ indexName: source.indexName, params: params.toString() }] },
    });
    try {
      if (!response.ok()) throw new Error(`YC search HTTP ${response.status()}`);
      const data = await response.json();
      const result = data.results?.[0] as SearchResult | undefined;
      if (!result || !Array.isArray(result.hits) || !Number.isInteger(result.nbHits) ||
          !Number.isInteger(result.nbPages) || !Number.isInteger(result.hitsPerPage)) {
        throw new Error('Unexpected YC search response.');
      }
      return result;
    } finally {
      // Playwright retains response bodies until disposed; free them each time.
      await response.dispose();
    }
  }, `Search YC ${batch ?? 'all batches'}, page ${page}`);

  return collectDirectory(search);
}

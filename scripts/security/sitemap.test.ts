import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildSitemap } from '../../src/lib/sitemap';
import { DirectoryAvailabilityError } from '../../src/lib/directory-availability';

const base = new URL('https://directory.example');

test('sitemap uses valid, unique public slugs without fabricated modification timestamps', async () => {
  let reads = 0;
  const result = await buildSitemap(base, async () => {
    reads++;
    return { entries: [' ACME ', 'acme', 'other-company', '../../api/profile', 'new', 'a'.repeat(201)]
      .map(slug => ({ slug })) };
  });
  assert.equal(reads, 1);
  assert.deepEqual(result.map(entry => entry.url), [
    'https://directory.example/', 'https://directory.example/company/acme',
    'https://directory.example/company/other-company',
  ]);
  assert.ok(result.every(entry => entry.lastModified === undefined));
});

test('an index outage returns only the root, logs no exception details, and recovers on the next regeneration', async () => {
  const warnings: string[] = [];
  let reads = 0;
  const load = async () => {
    reads++;
    if (reads === 1) throw new Error('private database quota details');
    return { entries: [{ slug: 'recovered' }] };
  };
  const failed = await buildSitemap(base, load, event => warnings.push(event));
  assert.deepEqual(failed.map(entry => entry.url), ['https://directory.example/']);
  assert.deepEqual(warnings, ['sitemap.index_unavailable']);
  const recovered = await buildSitemap(base, load, event => warnings.push(event));
  assert.equal(reads, 2);
  assert.equal(recovered[1].url, 'https://directory.example/company/recovered');
});

test('sitemaps beyond the protocol URL limit require partitioning instead of silent truncation', async () => {
  const warnings: string[] = [];
  const result = await buildSitemap(base, async () => ({
    entries: Array.from({ length: 50_000 }, (_, index) => ({ slug: `company-${index}` })),
  }), event => warnings.push(event));
  assert.equal(result.length, 1);
  assert.deepEqual(warnings, ['sitemap.partition_required']);
});

test('sitemap outage diagnostics preserve the classified backend cause without exception text', async () => {
  const warnings: unknown[] = [];
  const result = await buildSitemap(base, async () => {
    throw new DirectoryAvailabilityError('manifest', 'quota_exhausted');
  }, (event, failure) => warnings.push({ event, ...failure }));
  assert.equal(result.length, 1);
  assert.deepEqual(warnings, [{ event: 'sitemap.index_unavailable', stage: 'manifest', reason: 'quota_exhausted' }]);
});

test('the metadata route uses the cached bounded index and revalidates outage fallbacks', () => {
  const source = readFileSync(new URL('../../src/app/sitemap.ts', import.meta.url), 'utf8');
  assert.match(source, /export const revalidate = 300/);
  assert.match(source, /buildSitemap\(baseUrl, getDirectoryIndex\)/);
  assert.doesNotMatch(source, /adminDb|collection\(/);
});

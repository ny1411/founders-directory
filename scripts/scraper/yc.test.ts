import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectDirectory, type SearchResult, type YCCompany } from './yc-directory';
import { parseCompany } from './yc-company';
import { retry, runCompanies } from './yc-runner';
import { saveCompany } from './yc-store';
import type { Firestore } from 'firebase-admin/firestore';
import { normalizeImageUrl } from '../../src/lib/image-url';

const company = (slug: string, batch = 'Summer 2026'): YCCompany => ({ slug, name: slug, batch });
const result = (hits: YCCompany[], nbHits = hits.length): SearchResult => ({
  hits, nbHits, page: 0, nbPages: Math.ceil(nbHits / 500), hitsPerPage: 500,
});

test('batch discovery gets companies beyond the first 1,000 and follows all pages', async () => {
  const a = Array.from({ length: 600 }, (_, index) => company(`a-${index}`, 'A'));
  const b = Array.from({ length: 600 }, (_, index) => company(`b-${index}`, 'B'));
  const calls: string[] = [];
  const companies = await collectDirectory(async (batch, page = 0) => {
    if (!batch) return { ...result([...a, ...b].slice(0, 1000), 1200), facets: { batch: { A: 600, B: 600 } } };
    calls.push(`${batch}:${page}`);
    const hits = batch === 'A' ? a : b;
    return { ...result(hits.slice(page * 500, (page + 1) * 500), 600), page };
  });
  assert.equal(companies.length, 1200);
  assert.deepEqual(calls, ['A:0', 'A:1', 'B:0', 'B:1']);
});

test('discovery refuses truncated batches or an incomplete total', async () => {
  await assert.rejects(collectDirectory(async batch => batch
    ? { ...result([company('a')], 1001), nbPages: 2 }
    : { ...result([], 1001), facets: { batch: { A: 1001 } } }), /pagination limits/);
  await assert.rejects(collectDirectory(async batch => batch
    ? result([company('a')])
    : { ...result([], 2), facets: { batch: { A: 1 } } }), /Incomplete YC directory/);
  await assert.rejects(collectDirectory(async batch => batch
    ? result([company('a')], 2)
    : { ...result([], 2), facets: { batch: { A: 2 } } }), /Incomplete batch/);
});

test('saves 1,000 new unique companies despite 914 existing slugs and individual failures', async context => {
  context.mock.method(console, 'log', () => {});
  const companies = Array.from({ length: 1920 }, (_, index) => company(`company-${index}`));
  const existing = new Set(companies.slice(0, 914).map(item => item.slug));
  const saved = new Set<string>();
  const attempts = new Map<string, number>();
  const summary = await runCompanies({
    companies: [...companies, companies[914]], existingSlugs: existing, limit: 1000, delayMs: 0,
    scrape: async item => {
      const attempt = (attempts.get(item.slug) ?? 0) + 1;
      attempts.set(item.slug, attempt);
      if (item.slug === 'company-914') throw new Error('Persistent timeout');
      if (item.slug === 'company-915' && attempt === 1) throw new Error('Temporary timeout');
      return item;
    },
    save: async item => {
      if (item.slug === 'company-916') return false; // Saved by another run.
      assert.ok(!saved.has(item.slug));
      saved.add(item.slug);
      return true;
    },
  });
  assert.equal(summary.saved, 1000);
  assert.equal(summary.existing, 914);
  assert.equal(summary.skippedDuringRun, 1);
  assert.equal(saved.size, 1000);
  assert.deepEqual(summary.failedSlugs, ['company-914']);
  assert.equal(attempts.get('company-914'), 3);
  assert.equal(attempts.get('company-915'), 2);
  assert.ok(!attempts.has('company-0'));
  assert.ok(!attempts.has('company-1919'));
});

test('reruns only save the remainder and leave failures eligible', async () => {
  const existingSlugs = new Set<string>();
  const options = {
    companies: [company('a'), company('b'), company('c')], existingSlugs,
    limit: 2, delayMs: 0, scrape: async (item: YCCompany) => item,
    save: async () => true,
  };
  assert.equal((await runCompanies(options)).saved, 2);
  assert.equal((await runCompanies(options)).saved, 1);
  assert.equal((await runCompanies(options)).saved, 0);
});

test('database failure propagates without marking an unsaved company as existing', async () => {
  const existingSlugs = new Set<string>();
  await assert.rejects(runCompanies({
    companies: [company('a')], existingSlugs, limit: 1, delayMs: 0,
    scrape: async () => ({}), save: async () => { throw new Error('Permission denied'); },
  }), /Permission denied/);
  assert.equal(existingSlugs.size, 0);
});

test('a fatal database error waits for other in-flight commits before rejecting', async () => {
  const existingSlugs = new Set<string>();
  let secondCommitted = false;
  await assert.rejects(runCompanies({
    companies: [company('a'), company('b'), company('c')], existingSlugs,
    limit: 1000, concurrency: 2, delayMs: 0,
    scrape: async item => item,
    save: async item => {
      if (item.slug === 'a') throw new Error('Database unavailable');
      await new Promise(resolve => setTimeout(resolve, 5));
      secondCommitted = true;
      return true;
    },
  }), /Database unavailable/);
  assert.ok(secondCommitted);
  assert.ok(existingSlugs.has('b'));
  assert.ok(!existingSlugs.has('a'));
  assert.ok(!existingSlugs.has('c'));
});

test('retry recovers transient errors and stops immediately for permanent failures', async () => {
  let attempts = 0;
  const value = await retry(async () => {
    if (++attempts < 3) throw new Error('Transient error');
    return 'saved';
  }, 'test', { delayMs: 0 });
  assert.equal(value, 'saved');
  assert.equal(attempts, 3);
  attempts = 0;
  await assert.rejects(retry(async () => {
    attempts++;
    throw new Error('Permission denied');
  }, 'test', { delayMs: 0, retryable: () => false }), /Permission denied/);
  assert.equal(attempts, 1);
});

function profile(company: object) {
  const props = JSON.stringify({ props: { company } }).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<div data-page="${props}"></div>`;
}

test('extracts actual founder data, retains zero employees, and uses stable logos', () => {
  const details = parseCompany(profile({
    slug: 'a', name: 'A & B', team_size: 0, tags: ['AI'],
    small_logo_url: 'https://bookface-images.s3.amazonaws.com/small_logos/logo.png',
    logo_url: 'https://bookface-images.s3.us-west-2.amazonaws.com/logos/logo.png?X-Amz-Expires=3600',
    founders: [{ user_id: 1, full_name: 'Founder Name', title: 'Founder/CTO',
      founder_bio: 'Real bio', linkedin_url: 'https://linkedin.com/in/founder' }],
  }), company('a'));
  assert.equal(details.company.name, 'A & B');
  assert.equal(details.company.employees, 0);
  assert.equal(details.company.logoUrl, 'https://bookface-images.s3.amazonaws.com/small_logos/logo.png');
  assert.equal(details.founders[0].role, 'Founder/CTO');
  assert.equal(details.founders[0].twitterUrl, null);
  assert.deepEqual(details.company.tags, ['AI']);
});

test('normalizes supported image URLs and uses a valid listing logo', () => {
  assert.equal(normalizeImageUrl('/company/thumb/missing.png'), null);
  assert.equal(normalizeImageUrl('https://www.ycombinator.com/company/thumb/missing.png?size=64'), null);
  assert.equal(normalizeImageUrl('  https://bookface-images.s3.amazonaws.com/small_logos/logo.png  '), 'https://bookface-images.s3.amazonaws.com/small_logos/logo.png');
  assert.equal(normalizeImageUrl('/images/company-logo.png'), '/images/company-logo.png');
  assert.equal(normalizeImageUrl('http://example.com/insecure-logo.png'), null);
  assert.equal(normalizeImageUrl('//example.com/protocol-relative-logo.png'), null);
  assert.equal(normalizeImageUrl('not-a-valid-image-url'), null);
  assert.equal(normalizeImageUrl('javascript:alert(1)'), null);

  const listing = { ...company('a'), small_logo_thumb_url: 'https://bookface-images.s3.amazonaws.com/small_logos/listing.png' };
  const details = parseCompany(profile({
    slug: 'a', name: 'A', small_logo_url: '/company/thumb/missing.png', founders: [],
  }), listing);
  assert.equal(details.company.logoUrl, 'https://bookface-images.s3.amazonaws.com/small_logos/listing.png');
});

test('does not fabricate missing founders or save error/redirect pages as companies', () => {
  assert.equal(parseCompany(profile({ slug: 'a', name: 'A', founders: [] }), company('a')).founders.length, 0);
  assert.throws(() => parseCompany('<title>Access denied</title>', company('a')), /Missing YC company data/);
  assert.throws(() => parseCompany(profile({ slug: 'b', name: 'B', founders: [] }), company('a')), /redirected/);
});

// Simulates an atomic commit followed by a lost acknowledgement. The next
// transaction sees committed state exactly as a real retry would.
function fakeStore(options: { legacyRunId?: string; loseAcknowledgement?: boolean } = {}) {
  const writes = new Map<string, Record<string, unknown>>();
  if (options.legacyRunId) writes.set('companies/random-old-id', { slug: 'a', scrapeRunId: options.legacyRunId });
  let lost = false;
  const query = {
    collection: 'companies', where: () => query, limit: () => query,
    doc: (id: string) => ({ id, path: `companies/${id}` }),
  };
  const db = {
    collection: (name: string) => name === 'companies' ? query : {
      doc: (id: string) => ({ id, path: `${name}/${id}` }),
    },
    runTransaction: async (callback: (transaction: object) => Promise<boolean>) => {
      const pending = new Map<string, Record<string, unknown>>();
      const transaction = {
        get: async (ref: { path?: string }) => {
          if (ref.path) return { exists: writes.has(ref.path), data: () => writes.get(ref.path!) };
          const entries = [...writes].filter(([path, data]) => path.startsWith('companies/') && data.slug === 'a');
          return { empty: !entries.length, docs: entries.map(([, data]) => ({ get: (key: string) => data[key] })) };
        },
        set: (ref: { path: string }, data: Record<string, unknown>) => { pending.set(ref.path, data); },
        create: (ref: { path: string }, data: Record<string, unknown>) => {
          assert.ok(!writes.has(ref.path), 'must not overwrite an existing document');
          pending.set(ref.path, data);
        },
      };
      const saved = await callback(transaction);
      for (const [path, data] of pending) writes.set(path, data);
      if (options.loseAcknowledgement && !lost) {
        lost = true;
        throw Object.assign(new Error('Lost commit acknowledgement'), { code: 14 });
      }
      return saved;
    },
  } as unknown as Firestore;
  return { db, writes };
}

test('lost commit acknowledgement retries without duplicating companies or founders', async () => {
  const { db, writes } = fakeStore({ loseAcknowledgement: true });
  const details = parseCompany(profile({ slug: 'a', name: 'A',
    founders: [{ full_name: 'Real Founder', user_id: 1 }] }), company('a'));
  assert.equal(await saveCompany(db, details, 'run-1', 0), true);
  assert.equal(writes.size, 3);
  assert.equal(writes.get('companies/a')?.id, 'a');
  assert.equal(writes.get('founders/a-0')?.companyId, 'a');
  assert.equal(await saveCompany(db, details, 'run-2', 0), false);
  assert.equal(writes.size, 3);
});

test('existing random document IDs are skipped during persistence', async () => {
  const { db, writes } = fakeStore({ legacyRunId: 'old-run' });
  const details = parseCompany(profile({ slug: 'a', name: 'A', founders: [] }), company('a'));
  assert.equal(await saveCompany(db, details, 'new-run', 0), false);
  assert.equal(writes.size, 1);
  assert.ok(writes.has('companies/random-old-id'));
});

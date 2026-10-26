import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import { hasKnownDirectoryFacets, parseDirectoryRequest } from '../../src/lib/directory-request';
import { buildDirectoryPage as selectDirectoryPage, type DirectoryIndex } from '../../src/lib/directory-page';
import type { SearchParams } from '../../src/lib/directory-filters';

const index: DirectoryIndex = {
  entries: [
    { id: 'yc', name: 'YC Company', slug: 'yc-company', vcBacker: 'YC', batch: 'Winter 2026', tags: [], industry: null, employees: null },
    { id: 'other', name: 'Other Company', slug: 'other-company', vcBacker: 'Other VC', batch: 'Custom Cohort', tags: [], industry: null, employees: null },
  ],
  batches: ['Winter 2026', 'Custom Cohort'], vcs: ['YC', 'Other VC'],
};

const compiled = ts.transpileModule(readFileSync(new URL('../../src/app/api/directory/route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(options: { denied?: boolean; failQuota?: boolean; failSnapshot?: boolean; realPage?: boolean } = {}) {
  const operations: string[] = [];
  let receivedParams: Record<string, unknown> = {};
  const exports: { GET?: (request: Request) => Promise<Response> } = {};
  runInNewContext(compiled, {
    exports, Response, URL, console: { error() {} },
    require(name: string) {
      if (name === '@/lib/firebase-admin') return { adminDb: {} };
      if (name === '@/lib/directory-request') return { hasKnownDirectoryFacets, parseDirectoryRequest };
      if (name === '@/lib/rate-limit') return {
        requestIp: () => 'trusted-ip',
        reserveQuota: async (_db: unknown, scope: string, uid: string, ip: string, limits: unknown) => {
          operations.push('quota');
          assert.equal(scope, 'directory-search');
          assert.equal(uid, ''); assert.equal(ip, 'trusted-ip');
          assert.deepEqual(JSON.parse(JSON.stringify(limits)), [{ name: 'search-ip-minute', subject: 'ip', limit: 60, windowMs: 60000 }]);
          if (options.failQuota) throw new Error('private datastore details');
          return { allowed: !options.denied, retryAfterSeconds: 42 };
        },
      };
      if (name === '@/lib/observability-runtime') return {
        instrumentApiRoute: (_config: unknown, handler: (request: Request) => Promise<Response>) => handler,
      };
      if (name === '@/lib/directory-query') return {
        getDirectoryIndex: async () => {
          operations.push('snapshot');
          if (options.failSnapshot) throw new Error('private snapshot details');
          return index;
        },
        buildDirectoryPage: (_snapshot: unknown, params: SearchParams) => {
          operations.push('page'); receivedParams = params;
          if (options.realPage) return selectDirectoryPage(index, params, async ids => {
            operations.push(`cards:${ids.join(',')}`);
            return ids.map(id => ({ ...index.entries.find(entry => entry.id === id)!, description: null, logoUrl: null, location: null, oneLiner: null }));
          });
          return { companies: [], totalCount: 0, totalPages: 0, page: 1 };
        },
      };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  assert.ok(exports.GET);
  return { get: exports.GET, operations, params: () => receivedParams };
}

test('canonical directory cache misses reserve quota before snapshot/page work and keep successful responses public', async () => {
  const endpoint = fixture();
  const response = await endpoint.get(new Request('https://example.com/api/directory?industry=B2B&industry=Healthcare&page=2'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'public, s-maxage=3600, stale-while-revalidate=86400');
  assert.deepEqual(endpoint.operations, ['quota', 'snapshot', 'page']);
  assert.deepEqual(JSON.parse(JSON.stringify(endpoint.params())), { industry: ['B2B', 'Healthcare'], page: '2' });
});

test('unknown parameters and cache-busting variants fail before quota/snapshot work', async () => {
  const endpoint = fixture();
  for (const noise of ['a', 'b']) {
    const response = await endpoint.get(new Request(`https://example.com/api/directory?noise=${noise}`));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.deepEqual(endpoint.operations, []);
});

test('equivalent URL variants redirect to one canonical key without directory work or loops', async () => {
  const endpoint = fixture();
  const response = await endpoint.get(new Request('https://example.com/api/directory?industry=healthcare&industry=B2B&industry=B2B&sort=asc&page=1&q=%20AI%20%20TOOLS%20'));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), '/api/directory?q=ai+tools&industry=B2B&industry=Healthcare');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(endpoint.operations, []);
  const canonical = await endpoint.get(new Request(`https://example.com${response.headers.get('location')}`));
  assert.equal(canonical.status, 200);
  assert.equal(canonical.headers.get('location'), null);
  assert.deepEqual(endpoint.operations, ['quota', 'snapshot', 'page']);
});

test('directory quota denials are uncacheable and do not load the snapshot', async () => {
  const endpoint = fixture({ denied: true });
  const response = await endpoint.get(new Request('https://example.com/api/directory?q=test'));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('retry-after'), '42');
  assert.deepEqual(endpoint.operations, ['quota']);
});

test('quota and snapshot outages fail closed without exposing internal details or caching errors', async () => {
  for (const options of [{ failQuota: true }, { failSnapshot: true }]) {
    const endpoint = fixture(options);
    const response = await endpoint.get(new Request('https://example.com/api/directory'));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(!(await response.text()).includes('private'));
    assert.deepEqual(endpoint.operations, options.failQuota ? ['quota'] : ['quota', 'snapshot']);
  }
});

test('oversized queries fail before quota/snapshot access', async () => {
  const endpoint = fixture();
  const response = await endpoint.get(new Request(`https://example.com/api/directory?q=${'x'.repeat(4096)}`));
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(endpoint.operations, []);
});

test('oversized complete URLs fail before quota/snapshot access', async () => {
  const endpoint = fixture();
  const response = await endpoint.get(new Request(`https://${'a'.repeat(8192)}.example/api/directory`));
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(endpoint.operations, []);
});

test('invented dynamic facets never produce full-directory cache entries or company-card reads', async () => {
  for (const search of ['vc=random-a', 'vc=random-b', 'vc=yc', 'batch=Winter+2025', 'batch=Custom+Cohort&vc=Other+VC&vc=unknown']) {
    const endpoint = fixture({ realPage: true });
    const response = await endpoint.get(new Request(`https://example.com/api/directory?${search}`));
    assert.equal(response.status, 400, search);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('location'), null);
    assert.deepEqual(endpoint.operations, ['quota', 'snapshot']);
    assert.deepEqual(await response.json(), { error: 'Invalid batch or VC selection.' });
  }
});

test('valid dynamic facets still filter real index rows before loading a bounded company page', async () => {
  const endpoint = fixture({ realPage: true });
  const response = await endpoint.get(new Request('https://example.com/api/directory?batch=Custom+Cohort&vc=Other+VC'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'public, s-maxage=3600, stale-while-revalidate=86400');
  assert.deepEqual(endpoint.operations, ['quota', 'snapshot', 'page', 'cards:other']);
  const data = await response.json();
  assert.equal(data.totalCount, 1);
  assert.deepEqual(data.companies.map((company: { id: string }) => company.id), ['other']);
});

test('unknown dynamic facets cannot bypass quota admission and normalized oversized searches do no database work', async () => {
  const denied = fixture({ denied: true, realPage: true });
  assert.equal((await denied.get(new Request('https://example.com/api/directory?vc=random'))).status, 429);
  assert.deepEqual(denied.operations, ['quota']);
  const endpoint = fixture();
  const response = await endpoint.get(new Request(`https://example.com/api/directory?q=${encodeURIComponent('İ'.repeat(51))}`));
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(endpoint.operations, []);
});

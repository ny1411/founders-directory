import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync(new URL('../../src/app/api/directory/route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(options: { denied?: boolean; failQuota?: boolean; failSnapshot?: boolean } = {}) {
  const operations: string[] = [];
  let receivedParams: Record<string, unknown> = {};
  const exports: { GET?: (request: Request) => Promise<Response> } = {};
  runInNewContext(compiled, {
    exports, Response, URL, console: { error() {} },
    require(name: string) {
      if (name === '@/lib/firebase-admin') return { adminDb: {} };
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
        getDirectorySnapshot: async () => {
          operations.push('snapshot');
          if (options.failSnapshot) throw new Error('private snapshot details');
          return { companies: [] };
        },
        buildDirectoryPage: (_snapshot: unknown, params: Record<string, unknown>) => {
          operations.push('page'); receivedParams = params;
          return { companies: [], totalCount: 0, totalPages: 0, page: 1 };
        },
      };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  assert.ok(exports.GET);
  return { get: exports.GET, operations, params: () => receivedParams };
}

test('directory cache misses reserve quota before snapshot/page work and keep successful responses public', async () => {
  const endpoint = fixture();
  const response = await endpoint.get(new Request('https://example.com/api/directory?industry=B2B&industry=Healthcare&page=2&ignored=secret'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'public, s-maxage=3600, stale-while-revalidate=86400');
  assert.deepEqual(endpoint.operations, ['quota', 'snapshot', 'page']);
  assert.deepEqual(JSON.parse(JSON.stringify(endpoint.params())), { industry: ['B2B', 'Healthcare'], page: '2' });
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

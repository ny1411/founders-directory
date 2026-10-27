import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { publicFounder } from '../../src/lib/public-founder';

type Row = Record<string, unknown> & {id: string};
const require = createRequire(import.meta.url);
const compile = (path: string) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true},
}).outputText;
const queryCode = compile('../../src/lib/company-query.ts');

function fixture(companyRows: Row[] = [{id: 'c1', slug: 'acme', name: 'Acme'}], founderRows: Row[] = []) {
  const reads: Array<{collection: string; limit: number; fields: string[]; documents: number}> = [];
  const persisted = new Map<string, {tags: string[]; value: unknown}>();
  const renderMemos: Array<Map<string, unknown>> = [];
  let fail: Error | null = null;
  const query = {} as typeof import('../../src/lib/company-query');
  runInNewContext(queryCode, {exports: query, Buffer, require(name: string) {
    if (name === './firebase-admin') return {adminDb: {collection(collection: string) {return {where(field: string, operator: string, value: unknown) {
      assert.equal(operator, '==');
      let limit: number | undefined;
      let fields: string[] | undefined;
      const chain = {
        limit(max: number) {limit = max; return chain;},
        select(...keys: string[]) {fields = keys; return chain;},
        async get() {
          assert.ok(limit && fields, 'Real query must apply limit and field mask before get');
          if (fail) throw fail;
          const matches = (collection === 'companies' ? companyRows : founderRows).filter(row => row[field] === value).slice(0, limit);
          reads.push({collection, limit, fields: [...fields], documents: matches.length});
          return {empty: !matches.length, docs: matches.map(row => ({id: row.id, data: () => Object.fromEntries(fields!.filter(key => key in row).map(key => [key, row[key]]))}))};
        },
      };
      return chain;
    }}}}};
    if (name === 'react') return {cache(callback: (...args: unknown[]) => unknown) {
      const memo = new Map<string, unknown>(); renderMemos.push(memo);
      return (...args: unknown[]) => {const key = JSON.stringify(args); if (!memo.has(key)) memo.set(key, callback(...args)); return memo.get(key);};
    }};
    if (name === 'next/cache') return {unstable_cache(callback: () => Promise<unknown>, keys: string[], options: {tags: string[]; revalidate: number}) {
      assert.equal(options.revalidate, 3600);
      return async () => {const key = JSON.stringify(keys); if (persisted.has(key)) return persisted.get(key)!.value;
        const value = await callback(); persisted.set(key, {tags: options.tags, value}); return value;};
    }};
    throw new Error(`Unexpected query dependency ${name}`);
  }});
  return {query, reads, persisted,
    nextRender() {renderMemos.forEach(memo => memo.clear());},
    invalidate(tag: string) {for (const [key, value] of persisted) if (value.tags.includes(tag)) persisted.delete(key);},
    fail(error: Error) {fail = error;},
  };
}

function renderPage(query: typeof import('../../src/lib/company-query')) {
  const exports: {default?: (props: unknown) => Promise<React.ReactNode>; generateMetadata?: (props: unknown) => Promise<{title: string}>} = {};
  const warnings: string[] = [];
  runInNewContext(compile('../../src/app/company/[slug]/page.tsx'), {exports, console: {warn(value: string) {warnings.push(value);}}, require(name: string) {
    if (name === 'react/jsx-runtime') return require(name);
    if (name === '@/lib/company-query') return query;
    if (name === '@/lib/public-founder') return {publicFounder};
    if (name === 'next/navigation') return {notFound() {throw new Error('NOT_FOUND');}};
    if (name === '@/components/send-dm-button') return {SendDmButton: () => React.createElement('button', {}, 'Send Custom Text')};
    if (name === '@/components/ui/button') return {buttonVariants: () => ''};
    if (name === '@/components/json-ld') return {JsonLd: () => null};
    if (name === '@/components/entity-image') return {EntityImage: () => null};
    if (name === '@/lib/image-url') return {normalizeImageUrl: () => null};
    if (name === 'next/link') return {default: ({children}: React.PropsWithChildren) => React.createElement('a', {}, children), __esModule: true};
    if (name === 'next/image') return {default: () => null, __esModule: true};
    if (name === 'lucide-react') return new Proxy({}, {get: () => () => null});
    throw new Error(`Unexpected page dependency ${name}`);
  }});
  return {page: (slug = 'acme') => exports.default!({params: Promise.resolve({slug})}),
    metadata: (slug = 'acme') => exports.generateMetadata!({params: Promise.resolve({slug})}), warnings};
}

test('real company metadata/page share one normalized lookup and reuse only public cached data across renders', async () => {
  const f = fixture([{id: 'c1', slug: 'acme', name: 'Acme', privateNote: 'COMPANY-SECRET'}], [{id: 'f1', companyId: 'c1', name: 'Founder', email: 'PRIVATE-CONTACT', phone: 'PRIVATE-PHONE'}]);
  const rendered = renderPage(f.query);
  const [metadata, tree] = await Promise.all([rendered.metadata(' ACME '), rendered.page('acme')]);
  assert.equal(metadata.title, 'Acme');
  assert.match(renderToStaticMarkup(tree), /Founder/);
  assert.equal(f.reads.length, 2, 'one company lookup plus one founders query');
  assert.deepEqual(f.reads.map(row => [row.collection, row.limit, row.documents]), [['companies', 1, 1], ['founders', 51, 1]]);
  assert.ok(f.reads.every(row => !row.fields.some(field => ['email', 'phone', 'privateNote'].includes(field))));
  assert.doesNotMatch(JSON.stringify([...f.persisted.values()]), /PRIVATE|COMPANY-SECRET|email|phone/);
  f.nextRender(); await rendered.metadata(); await rendered.page();
  assert.equal(f.reads.length, 2, 'next render uses the persistent cache');
});

test('one company tag refreshes its company and founders cache while preserving another company', async () => {
  const companies = [{id: 'c1', slug: 'acme', name: 'Before'}, {id: 'c2', slug: 'other', name: 'Other'}];
  const founders = [{id: 'f1', companyId: 'c1', name: 'Before Founder'}];
  const f = fixture(companies, founders);
  await f.query.getCompany('acme'); await f.query.getCompanyFounders('c1', 'acme');
  await f.query.getCompany('other'); await f.query.getCompanyFounders('c2', 'other');
  companies[0].name = 'After'; founders[0].name = 'After Founder';
  f.invalidate(f.query.companyCacheTag('acme')); f.nextRender();
  assert.equal((await f.query.getCompany('acme'))?.name, 'After');
  assert.equal((await f.query.getCompanyFounders('c1', 'acme'))[0].name, 'After Founder');
  await f.query.getCompany('other'); await f.query.getCompanyFounders('c2', 'other');
  assert.equal(f.reads.length, 6, 'other company caches were retained');
});

test('real bounded founder lookup returns all 50 supported founders but rejects overflow without caching a partial team', async () => {
  const founders = Array.from({length: 1000}, (_, index) => ({id: `f${index}`, companyId: 'c1', name: `Founder ${index}`}));
  const f = fixture(undefined, founders);
  await assert.rejects(f.query.getCompanyFounders('c1', 'acme'), (error: unknown) => error instanceof f.query.CompanyFoundersUnavailableError && error.reason === 'limit_exceeded');
  assert.equal(f.reads[0].documents, 51);
  assert.equal(f.persisted.size, 0);
  founders.splice(50); f.nextRender();
  assert.equal((await f.query.getCompanyFounders('c1', 'acme')).length, 50, 'repair can load a complete team');
  assert.equal(f.persisted.size, 1);
});

test('malformed public fields and oversized encoded team fail explicitly before cache publication', async () => {
  for (const values of [{name: 42}, {name: 'Name', bio: 'x'.repeat(5001)}, {name: 'Name', role: {private: 'PRIVATE-CONTACT'}}]) {
    const f = fixture(undefined, [{id: 'f1', companyId: 'c1', ...values}]);
    await assert.rejects(f.query.getCompanyFounders('c1', 'acme'), (error: unknown) => error instanceof f.query.CompanyFoundersUnavailableError && error.reason === 'invalid_record');
    assert.equal(f.persisted.size, 0);
  }
  const f = fixture(undefined, Array.from({length: 50}, (_, index) => ({id: `f${index}`, companyId: 'c1', name: 'Founder', bio: 'x'.repeat(5000), avatarUrl: 'x'.repeat(2048), twitterUrl: 'x'.repeat(2048), linkedinUrl: 'x'.repeat(2048)})));
  await assert.rejects(f.query.getCompanyFounders('c1', 'acme'), (error: unknown) => error instanceof f.query.CompanyFoundersUnavailableError && error.reason === 'payload_too_large');
  assert.equal(f.persisted.size, 0);
});

test('overflow renders company information with explicit unavailable team and no partial/private founder data', async () => {
  const f = fixture(undefined, Array.from({length: 51}, (_, index) => ({id: `f${index}`, companyId: 'c1', name: 'PARTIAL-FOUNDER', email: 'PRIVATE-CONTACT'})));
  const rendered = renderPage(f.query);
  const html = renderToStaticMarkup(await rendered.page());
  assert.match(html, /Acme/);
  assert.match(html, /Founding team temporarily unavailable/);
  assert.doesNotMatch(html, /PARTIAL-FOUNDER|PRIVATE-CONTACT|51 Founders|Send Custom Text/);
  assert.deepEqual(rendered.warnings.map(line => JSON.parse(line)), [{event: 'company.founders_unavailable', reason: 'limit_exceeded'}]);
});

test('unknown slugs are cached as not-found; invalid slugs skip reads and datastore failures propagate', async () => {
  const f = fixture(); const rendered = renderPage(f.query);
  await assert.rejects(rendered.page('missing'), /NOT_FOUND/);
  f.nextRender(); await assert.rejects(rendered.page('missing'), /NOT_FOUND/);
  assert.equal(f.reads.length, 1);
  await assert.rejects(rendered.page('../invalid'), /NOT_FOUND/);
  assert.equal(f.reads.length, 1);
  await f.query.getCompany('acme');
  f.fail(new Error('PRIVATE-DATASTORE-ERROR'));
  await assert.rejects(rendered.page(), /PRIVATE-DATASTORE-ERROR/, 'ordinary datastore failures must remain errors, not an empty team');
  assert.deepEqual(rendered.warnings, []);
});

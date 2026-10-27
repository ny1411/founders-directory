import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import type { DirectoryInitialData } from '../../src/lib/directory-types';
import { DIRECTORY_REVALIDATE_SECONDS } from '../../src/lib/directory-cache';
import { directoryFailure } from '../../src/lib/directory-availability';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../../src/app/page.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const initialData: DirectoryInitialData = {
  companies: [], totalCount: 4, totalPages: 1, page: 1, batches: [], vcs: [],
};

function fixture(failure?: 'index' | 'cards' | 'render') {
  let currentFailure = failure;
  const warnings: string[] = [];
  const calls: string[] = [];
  const received: DirectoryInitialData[] = [];
  const exports: { default?: () => Promise<React.ReactNode>; dynamic?: string; revalidate?: number } = {};
  runInNewContext(code, {
    exports,
    console: { warn: (message: string) => warnings.push(message) },
    require(name: string) {
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
      if (name === '@/lib/directory-availability') return {
        logDirectoryFailure: (event: string, error: unknown) => warnings.push(JSON.stringify({ event, ...directoryFailure(error) })),
      };
      if (name === '@/lib/directory-query') return {
        async getDirectoryIndex() {
          calls.push('index');
          if (currentFailure === 'index') throw new Error('private quota/database details');
          return { entries: [] };
        },
        async buildInitialDirectoryData() {
          calls.push('cards');
          if (currentFailure === 'cards') throw new Error('private card/database details');
          return initialData;
        },
      };
      if (name === '@/components/directory') return {
        Directory: ({ initialData: data }: { initialData: DirectoryInitialData }) => {
          if (currentFailure === 'render') throw new Error('rendering defect');
          received.push(data);
          return React.createElement('div', { 'data-directory': true }, `${data.totalCount} companies`);
        },
      };
      if (name === '@/components/json-ld') return {
        JsonLd: () => React.createElement('script', { type: 'application/ld+json' }, '{}'),
      };
      throw new Error(`Unexpected homepage dependency: ${name}`);
    },
  });
  assert.ok(exports.default);
  return { home: exports.default, exports, calls, received, warnings, recover() { currentFailure = undefined; } };
}

for (const failure of ['index', 'cards'] as const) {
  test(`homepage renders an explicit unavailable state on ${failure} read failure, without empty results`, async () => {
    const f = fixture(failure);
    const html = renderToStaticMarkup(await f.home());
    assert.match(html, /Directory temporarily unavailable/);
    assert.match(html, /try again in a few minutes/);
    assert.match(html, /href="\/"[^>]*>Reload directory/);
    assert.match(html, /role="status"/);
    assert.doesNotMatch(html, /data-directory|0 companies|private|quota|database|application\/ld\+json/);
    assert.deepEqual(f.received, []);
    assert.deepEqual(f.calls, failure === 'index' ? ['index'] : ['index', 'cards']);
    assert.deepEqual(f.warnings, ['{"event":"directory.home_unavailable","stage":"unknown","reason":"unknown"}']);
  });
}

test('successful homepage rendering retains the real initial directory data', async () => {
  const f = fixture();
  const html = renderToStaticMarkup(await f.home());
  assert.match(html, /4 companies/);
  assert.match(html, /application\/ld\+json/);
  assert.doesNotMatch(html, /temporarily unavailable/);
  assert.deepEqual(f.received, [initialData]);
  assert.deepEqual(f.warnings, []);
});

test('rendering defects retain existing Suspense behavior instead of becoming backend outages', async () => {
  const f = fixture('render');
  const tree = await f.home();
  const html = renderToStaticMarkup(tree);
  assert.match(html, /Loading directory controls/);
  assert.doesNotMatch(html, /Directory temporarily unavailable/);
  assert.deepEqual(f.warnings, []);
});

test('a later successful regeneration restores real results after an unavailable render', async () => {
  const f = fixture('index');
  assert.match(renderToStaticMarkup(await f.home()), /Directory temporarily unavailable/);
  f.recover();
  const html = renderToStaticMarkup(await f.home());
  assert.match(html, /4 companies/);
  assert.doesNotMatch(html, /Directory temporarily unavailable/);
  assert.deepEqual(f.received, [initialData]);
  assert.equal(f.warnings.length, 1);
});

test('homepage stays force-static with five-minute route recovery and unchanged hourly data caching', () => {
  const f = fixture();
  assert.equal(f.exports.dynamic, 'force-static');
  assert.equal(f.exports.revalidate, 300);
  assert.equal(DIRECTORY_REVALIDATE_SECONDS, 3600);
});

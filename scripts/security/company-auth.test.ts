import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { redirect } = require('next/navigation') as { redirect: (url: string) => never };
const actionSource = readFileSync(new URL('../../src/app/actions.ts', import.meta.url), 'utf8');
const compiledAction = ts.transpileModule(actionSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

type FixtureOptions = {
  verify?: (token: string, checkRevoked: boolean) => Promise<unknown>;
  failCommit?: boolean;
};

// Execute the real server action with in-memory Firebase boundaries only.
// No credentials, Firebase initialization, or live database writes are involved.
function fixture(options: FixtureOptions = {}) {
  const operations: string[] = [];
  const tokens: Array<[string, boolean]> = [];
  const writes: Array<{ ref: { id: string }; data: Record<string, unknown> }> = [];
  const exports: { createCompany?: (data: FormData, token?: unknown) => Promise<{ error: string }> } = {};
  const batch = {
    set(ref: { id: string }, data: Record<string, unknown>) {
      operations.push('set');
      writes.push({ ref, data });
    },
    async commit() {
      operations.push('commit');
      if (options.failCommit) throw new Error('private database connection details');
    },
  };
  runInNewContext(compiledAction, {
    exports,
    console: { error() {} },
    require(name: string) {
      if (name === '@/lib/firebase-admin') return {
        adminAuth: {
          async verifyIdToken(token: string, checkRevoked: boolean) {
            tokens.push([token, checkRevoked]);
            operations.push('verify');
            const decoded = options.verify ? await options.verify(token, checkRevoked) : { uid: 'signed-in-user' };
            operations.push('verified');
            return decoded;
          },
        },
        adminDb: {
          collection(name: string) {
            operations.push(`collection:${name}`);
            return { doc: () => ({ id: `${name}-id` }) };
          },
          batch() {
            operations.push('batch');
            return batch;
          },
        },
      };
      if (name === 'next/cache') return { revalidatePath: (path: string) => operations.push(`revalidate:${path}`) };
      if (name === 'next/navigation') return { redirect };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  assert.ok(exports.createCompany);
  return { createCompany: exports.createCompany, operations, tokens, writes };
}

function submission() {
  const form = new FormData();
  form.set('name', 'Authenticated Company');
  form.set('slug', 'authenticated-company');
  form.set('founder_0_name', 'Founder One');
  form.set('founder_1_name', 'Founder Two');
  return form;
}

test('direct action calls with missing or malformed credentials never access Firestore', async () => {
  for (const token of [undefined, null, '', '   ', { uid: 'forged-user' }, new FormData()]) {
    const action = fixture();
    const result = await action.createCompany(submission(), token);
    assert.equal(result.error, 'Please sign in before adding a company.');
    assert.deepEqual(action.operations, []);
    assert.deepEqual(action.writes, []);
  }
});

for (const reason of ['auth/argument-error', 'auth/id-token-expired', 'auth/id-token-revoked', 'auth/user-disabled']) {
  test(`direct action calls reject ${reason} without database access or internal error exposure`, async () => {
    const action = fixture({ verify: async () => { throw new Error(`${reason}: private token details`); } });
    const result = await action.createCompany(submission(), 'rejected-token');
    assert.equal(result.error, 'Your session could not be verified. Please sign in again.');
    assert.deepEqual(action.tokens, [['rejected-token', true]]);
    assert.deepEqual(action.operations, ['verify']);
    assert.deepEqual(action.writes, []);
  });
}

test('Firestore is untouched until identity verification resolves', async () => {
  let allowVerification!: () => void;
  const verified = new Promise<void>(resolve => { allowVerification = resolve; });
  const action = fixture({ verify: async () => { await verified; return { uid: 'ordinary-user' }; } });
  const result = action.createCompany(submission(), 'fresh-token');
  assert.deepEqual(action.operations, ['verify']);
  allowVerification();
  await assert.rejects(result, /NEXT_REDIRECT/);
  assert.equal(action.operations[1], 'verified');
});

test('an ordinary authenticated user saves the company and founders once and preserves Next redirect', async () => {
  const action = fixture();
  await assert.rejects(action.createCompany(submission(), 'fresh-token'), (error: unknown) => {
    const redirectError = error as Error & { digest?: string };
    assert.equal(redirectError.message, 'NEXT_REDIRECT');
    assert.match(redirectError.digest ?? '', /\/company\/authenticated-company;307;/);
    return true;
  });
  assert.deepEqual(action.tokens, [['fresh-token', true]]);
  assert.equal(action.writes.length, 3);
  assert.equal(action.writes[0].data.name, 'Authenticated Company');
  assert.equal(action.writes[1].data.companyId, 'companies-id');
  assert.equal(action.writes[2].data.companyId, 'companies-id');
  assert.equal(action.operations.filter(operation => operation === 'commit').length, 1);
  assert.equal(action.operations.at(-1), 'revalidate:/');
});

test('an authenticated database failure returns a retryable error without redirecting or leaking details', async () => {
  const action = fixture({ failCommit: true });
  const result = await action.createCompany(submission(), 'fresh-token');
  assert.equal(result.error, 'Could not save the company. Please try again.');
  assert.ok(!action.operations.some(operation => operation.startsWith('revalidate:')));
});

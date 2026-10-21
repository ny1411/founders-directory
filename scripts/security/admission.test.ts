import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { createAdmissionCheck, type AdmissionCheck } from '../../src/lib/admission-policy';
import { createAuthSyncHandler } from '../../src/lib/auth-sync-handler';
import { createOnboardingHandler } from '../../src/lib/onboarding/handler';
import { createResumeExtractionHandler } from '../../src/lib/resume-extraction-handler';
import { fixture } from '../onboarding/fixture';

type Ref = { path: string; set(data: unknown): Promise<void> };
function database() {
  const values = new Map<string, Record<string, unknown>>();
  const businessWrites: unknown[] = [];
  let queue = Promise.resolve();
  let down = false;
  const db = {
    collection: (name: string) => ({ doc: (id: string): Ref => ({
      path: `${name}/${id}`,
      set: async data => { businessWrites.push(data); },
    }) }),
    runTransaction: <T>(fn: (tx: unknown) => Promise<T>) => {
      const result = queue.then(() => {
        if (down) throw new Error('private quota database diagnostic');
        return fn({
          getAll: async (...refs: Ref[]) => refs.map(ref => ({ data: () => values.get(ref.path) })),
          set: (ref: Ref, value: Record<string, unknown>) => values.set(ref.path, value),
        });
      });
      queue = result.then(() => {}, () => {});
      return result;
    },
  } as unknown as Firestore;
  return { db, values, businessWrites, fail: () => { down = true; } };
}

function request(path: string, method = 'GET', body?: string, token: string | null = 'alice') {
  return new Request(`http://localhost${path}`, {
    method,
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body }),
  });
}

// Run actual route modules and their handler factories; only replace external
// Firebase boundaries, not the policy factory or handler logic under review.
function loadRoute(path: string, db: Firestore, store: object, events: string[]) {
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const exports: Record<string, (request: Request) => Promise<Response>> = {};
  runInNewContext(compiled, {
    exports,
    require(name: string) {
      if (name === '@/lib/firebase-admin') return {
        adminDb: db,
        adminAuth: { verifyIdToken: async (token: string, revoked: boolean) => {
          events.push(`verify:${token}:${revoked}`);
          if (token === 'bad') throw Object.assign(new Error('rejected'), { code: 'auth/invalid-id-token' });
          return { uid: token, email: `${token}@example.com` };
        } },
      };
      if (name === '@/lib/admission-policy') return { createAdmissionCheck };
      if (name === '@/lib/auth-sync-handler') return { createAuthSyncHandler };
      if (name === '@/lib/onboarding/handler') return { createOnboardingHandler };
      if (name === '@/lib/onboarding/store') return { OnboardingStore: function () { return store; } };
      throw new Error(`Unexpected route dependency ${name}`);
    },
  });
  return exports;
}

async function routes() {
  const memory = database();
  const state = await fixture().state();
  const events: string[] = [];
  const store = { load: async () => { events.push('load'); return state; } };
  return {
    ...memory, events,
    onboarding: loadRoute('src/app/api/onboarding/route.ts', memory.db, store, events),
    profile: loadRoute('src/app/api/profile/route.ts', memory.db, store, events),
    sync: loadRoute('src/app/api/auth/sync/route.ts', memory.db, store, events),
  };
}

test('shared profile GET route policies atomically cap concurrent requests across aliases', async () => {
  const f = await routes();
  const responses = await Promise.all(Array.from({ length: 70 }, (_, i) =>
    (i % 2 ? f.profile : f.onboarding).GET(request(i % 2 ? '/api/profile' : '/api/onboarding'))));
  assert.equal(responses.filter(response => response.status === 200).length, 60);
  assert.equal(responses.filter(response => response.status === 429).length, 10);
  assert.equal(f.events.filter(event => event === 'load').length, 60);
  for (const response of responses.filter(response => response.status === 429)) {
    assert.ok(Number(response.headers.get('retry-after')) > 0);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
});

test('onboarding POST and profile POST/PATCH aliases share one write budget before parsing', async () => {
  const f = await routes();
  for (let i = 0; i < 40; i++) {
    const [handler, method] = i % 3 === 0 ? [f.onboarding.POST, 'POST'] : i % 3 === 1 ? [f.profile.PATCH, 'PATCH'] : [f.profile.POST, 'POST'];
    assert.equal((await handler(request('/api/profile', method, '{}'))).status, 400);
  }
  const before = f.events.filter(event => event === 'load').length;
  for (const handler of [f.onboarding.POST, f.profile.PATCH, f.profile.POST]) {
    const body = request('/api/profile', 'POST', 'not JSON');
    assert.equal((await handler(body)).status, 429);
    assert.equal(body.bodyUsed, false);
  }
  assert.equal(f.events.filter(event => event === 'load').length, before);
});

test('POST load_resume cannot bypass exhausted profile read budget', async () => {
  const f = await routes();
  for (let i = 0; i < 60; i++) await f.profile.GET(request('/api/profile'));
  assert.equal((await f.onboarding.POST(request('/api/onboarding', 'POST', JSON.stringify({ action: 'load_resume' })))).status, 429);
  assert.equal(f.events.filter(event => event === 'load').length, 60);
});

test('real route wiring verifies credentials before quota and fails closed before data work', async () => {
  const f = await routes();
  f.fail();
  for (const [handler, method] of [[f.sync.POST, 'POST'], [f.onboarding.GET, 'GET'], [f.onboarding.POST, 'POST'], [f.profile.GET, 'GET'], [f.profile.PATCH, 'PATCH'], [f.profile.POST, 'POST']] as const) {
    for (const token of [null, 'bad']) {
      assert.equal((await handler(request('/api/profile', method, method === 'GET' ? undefined : '{}', token))).status, 401);
    }
    const body = request('/api/profile', method, method === 'GET' ? undefined : '{}');
    const response = await handler(body);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(body.bodyUsed, false);
    assert.doesNotMatch(await response.text(), /private quota/);
  }
  assert.equal(f.values.size, 0);
  assert.equal(f.events.includes('load'), false);
  assert.equal(f.businessWrites.length, 0);
});

test('auth-sync route admits ten writes and rejects the next without another write', async () => {
  const f = await routes();
  for (let i = 0; i < 10; i++) assert.equal((await f.sync.POST(request('/api/auth/sync', 'POST'))).status, 200);
  const response = await f.sync.POST(request('/api/auth/sync', 'POST'));
  assert.equal(response.status, 429);
  assert.equal(f.businessWrites.length, 10);
});

test('early resume admission precedes profile load, multipart parsing and paid allowance', async () => {
  for (const fail of [false, true]) {
    const f = database();
    const admit = createAdmissionCheck(f.db, 'resume-upload');
    if (fail) f.fail();
    else for (let i = 0; i < 5; i++) await admit('alice', request('/api/extract-resume'));
    const events: string[] = [];
    const handler = createResumeExtractionHandler({
      admit,
      verifyToken: async token => { events.push('verify'); return { uid: token }; },
      authorizeUpload: async () => { events.push('load'); return true; },
      reserveAttempt: async () => { events.push('paid-quota'); return { allowed: true, retryAfterSeconds: 1 }; },
      extract: async () => { events.push('provider'); return '{}'; },
    });
    const body = request('/api/extract-resume', 'POST', 'not multipart');
    const response = await handler(body);
    assert.equal(response.status, fail ? 503 : 429);
    assert.equal(body.bodyUsed, false);
    assert.deepEqual(events, ['verify']);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
});

test('resume route always wires the early upload policy', () => {
  const source = readFileSync(new URL('../../src/app/api/extract-resume/route.ts', import.meta.url), 'utf8');
  assert.match(source, /admit:\s*createAdmissionCheck\(adminDb,\s*'resume-upload'\)/);
});


test('omitted admission callbacks fail closed instead of creating an unthrottled handler', async () => {
  const missing = undefined as unknown as AdmissionCheck;
  const db = database();
  const handler = createAuthSyncHandler({ verifyIdToken: async () => ({ uid: 'alice', email: 'alice@example.com' } as DecodedIdToken) } as Parameters<typeof createAuthSyncHandler>[0], db.db, missing);
  const response = await handler(request('/api/auth/sync', 'POST'));
  assert.equal(response.status, 503);
  assert.equal(db.businessWrites.length, 0);
});

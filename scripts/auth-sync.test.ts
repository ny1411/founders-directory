import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import type { Auth, DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { createAuthSyncHandler } from '../src/lib/auth-sync-handler';
import { syncAuthenticatedUser } from '../src/lib/sync-auth-user';

function fixture(options: { code?: string; databaseFailure?: boolean; email?: string | null } = {}) {
  const calls = { verified: [] as unknown[][], collections: [] as string[], writes: [] as unknown[][], reads: 0 };
  const auth = {
    verifyIdToken: async (...args: unknown[]) => {
      calls.verified.push(args);
      if (options.code) throw Object.assign(new Error('private token diagnostic'), { code: options.code });
      return { uid: 'authenticated-user', email: options.email === null ? undefined : options.email ?? 'verified@example.com' } as DecodedIdToken;
    },
  } satisfies Pick<Auth, 'verifyIdToken'>;
  const db = {
    collection: (collection: string) => {
      calls.collections.push(collection);
      return {
        doc: (id: string) => ({
          set: async (data: unknown, writeOptions: unknown) => {
            calls.writes.push([id, data, writeOptions]);
            if (options.databaseFailure) throw new Error('private database diagnostic');
          },
          get: async () => {
            calls.reads++;
            return { id, data: () => ({ resumeText: 'private resume', extraPrivateField: 'secret' }) };
          },
        }),
      };
    },
  } as unknown as Pick<Firestore, 'collection'>;
  return { calls, POST: createAuthSyncHandler(auth, db) };
}

function request(authorization?: string, body?: string) {
  return new Request('http://localhost/api/auth/sync', {
    method: 'POST',
    headers: authorization ? { Authorization: authorization } : {},
    ...(body === undefined ? {} : { body }),
  });
}

test('missing and malformed credentials are rejected before verification or database access', async () => {
  for (const header of [undefined, '', 'Basic password', 'Bearer', 'Bearer one two']) {
    const { POST, calls } = fixture();
    const response = await POST(request(header, JSON.stringify({ firebaseId: 'victim', email: 'attacker@example.com' })));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Unauthorized' });
    assert.equal(calls.verified.length, 0);
    assert.equal(calls.collections.length, 0);
  }
});

test('invalid, expired, revoked, disabled and deleted identities return 401 without writes', async () => {
  for (const code of ['auth/argument-error', 'auth/invalid-argument', 'auth/invalid-id-token', 'auth/id-token-expired', 'auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found']) {
    const { POST, calls } = fixture({ code });
    const response = await POST(request('Bearer bad-token'));
    assert.equal(response.status, 401, code);
    assert.deepEqual(await response.json(), { error: 'Unauthorized' });
    assert.deepEqual(calls.verified, [['bad-token', true]]);
    assert.equal(calls.collections.length, 0);
  }
});

test('a valid token only updates its owner and returns an explicit public projection', async () => {
  const { POST, calls } = fixture();
  const response = await POST(request('Bearer valid-token', JSON.stringify({ firebaseId: 'victim', email: 'attacker@example.com' })));
  assert.equal(response.status, 200);
  assert.deepEqual(calls.verified, [['valid-token', true]]);
  assert.deepEqual(calls.collections, ['users']);
  assert.equal(calls.writes.length, 1);
  const [id, data, options] = calls.writes[0];
  assert.equal(id, 'authenticated-user');
  assert.deepEqual(options, { merge: true });
  assert.equal((data as { firebaseId: string }).firebaseId, 'authenticated-user');
  assert.equal((data as { email: string }).email, 'verified@example.com');
  assert.equal(calls.reads, 0, 'private user documents must never be fetched');
  assert.deepEqual(await response.json(), { user: { id: 'authenticated-user', email: 'verified@example.com' } });
});

test('the request body is optional and is never parsed for identity', async () => {
  for (const body of [undefined, 'invalid JSON']) {
    const { POST } = fixture();
    assert.equal((await POST(request('Bearer valid-token', body))).status, 200);
  }
});

test('tokens without an email do not overwrite an existing user email', async () => {
  const { POST, calls } = fixture({ email: null });
  assert.equal((await POST(request('Bearer valid-token'))).status, 403);
  assert.equal(calls.collections.length, 0);
});

test('verification infrastructure and database failures are generic server errors', async (t) => {
  t.mock.method(console, 'error', () => undefined);
  for (const options of [{ code: 'auth/internal-error' }, { databaseFailure: true }]) {
    const { POST } = fixture(options);
    const response = await POST(request('Bearer valid-token'));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Unable to sync account' });
  }
});

test('login sync sends a Firebase bearer token without body-controlled identity', async () => {
  const getIdToken = mock.fn(async () => 'firebase-id-token');
  const request = mock.fn<typeof fetch>(async () => Response.json({ user: { id: 'authenticated-user' } }));
  await syncAuthenticatedUser({ getIdToken }, request);
  assert.equal(getIdToken.mock.callCount(), 1);
  assert.deepEqual(request.mock.calls[0].arguments, ['/api/auth/sync', {
    method: 'POST', headers: { Authorization: 'Bearer firebase-id-token' },
  }]);
});

test('login sync rejects failed responses and can be retried with the same signed-in user', async () => {
  const getIdToken = mock.fn(async () => 'firebase-id-token');
  let attempts = 0;
  const request: typeof fetch = async () => {
    attempts++;
    return attempts === 1 ? Response.json({ error: 'private server diagnostic' }, { status: 500 }) : Response.json({});
  };
  await assert.rejects(syncAuthenticatedUser({ getIdToken }, request), { message: 'Could not finish signing in. Please try again.' });
  await syncAuthenticatedUser({ getIdToken }, request);
  assert.equal(attempts, 2);
  assert.equal(getIdToken.mock.callCount(), 2);
});

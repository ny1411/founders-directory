import assert from 'node:assert/strict';
import { before, test } from 'node:test';

// Refuse accidental execution against a real project or a remote emulator.
const project = 'demo-founders-security';
const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.equal(host, '127.0.0.1:8080', 'Run with the isolated Firestore test runner.');
assert.equal(process.env.GCLOUD_PROJECT, project, 'A demo project is required.');
const database = `projects/${project}/databases/(default)`;
const origin = `http://${host}/v1/${database}/documents`;

// The Firestore emulator accepts unsigned Firebase Auth tokens. These tokens
// only identify test principals to the emulator; they are not real credentials.
function userToken(uid, claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    iss: `https://securetoken.google.com/${project}`,
    aud: project,
    iat: now,
    exp: now + 3600,
    auth_time: now,
    sub: uid,
    user_id: uid,
    firebase: { sign_in_provider: 'custom', identities: {} },
    ...claims,
  })}.`;
}

const actors = [
  ['anonymous', null],
  ['owner', userToken('alice')],
  ['other user', userToken('mallory')],
  ['claimed administrator', userToken('mallory', { admin: true, role: 'admin', email_verified: true })],
];

const documents = [
  'companies/example',
  'founders/example-0',
  'users/alice',
  'users/alice/profiles/default',
  'users/alice/goals/primary',
  'users/alice/sources/resume-current',
  'generatedMessages/message',
  'contactEnrichmentJobs/job',
  'apiQuota/quota',
  'apiLeases/lease',
  'resumeExtractionUsage/usage',
  'users/nonexistent/sources/orphan',
  'users/alice/unknown/document',
  'unknown/document',
  'unknown/document/nested/document',
];

function data(extra = {}) {
  return { fields: { uid: { stringValue: 'alice' }, secret: { stringValue: 'private-fixture' }, ...extra } };
}

async function request(path, token, method = 'GET', body) {
  return fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
}

async function denied(response, context) {
  const body = await response.json();
  assert.equal(response.status, 403, `${context}: ${JSON.stringify(body)}`);
  assert.equal(body.error?.status, 'PERMISSION_DENIED', context);
}

before(async () => {
  // `owner` is the emulator's privileged Admin bypass. It is never used for
  // client assertions and never leaves the validated loopback demo endpoint.
  for (const path of documents) {
    const response = await request(`/${path}`, 'owner', 'PATCH', data());
    assert.equal(response.status, 200, await response.text());
  }
});

test('trusted Admin fixture access remains available for the server-owned model', async () => {
  const read = await request('/users/alice/sources/resume-current', 'owner');
  assert.equal(read.status, 200);
  assert.equal((await read.json()).fields.secret.stringValue, 'private-fixture');
  const query = await request(':runQuery', 'owner', 'POST', {
    structuredQuery: { from: [{ collectionId: 'companies' }], limit: 1 },
  });
  assert.equal(query.status, 200);
  assert.equal((await query.json())[0].document.fields.uid.stringValue, 'alice');
});

for (const [name, token] of actors) {
  test(`${name}: document get/list/create/update/delete denied across all collections and nested paths`, async () => {
    for (const path of documents) {
      const label = `${name} ${path}`;
      const collection = path.slice(0, path.lastIndexOf('/'));
      await denied(await request(`/${path}`, token), `${label} get`);
      await denied(await request(`/${collection}`, token), `${label} list`);
      await denied(await request(`/${path}-new`, token, 'PATCH', data()), `${label} create`);
      await denied(await request(`/${path}`, token, 'PATCH', data({ role: { stringValue: 'admin' } })), `${label} update`);
      await denied(await request(`/${path}`, token, 'DELETE'), `${label} delete`);
    }
  });

  test(`${name}: collection-group queries cannot reveal private resume sources`, async () => {
    await denied(await request(':runQuery', token, 'POST', {
      structuredQuery: { from: [{ collectionId: 'sources', allDescendants: true }] },
    }), `${name} collection-group list`);
  });
}

test('owner cannot reset counters, hijack identity, pollute schema or bypass update validation', async () => {
  const owner = userToken('alice');
  const attacks = [
    ['apiQuota/quota', { attempts: { integerValue: '0' } }],
    ['resumeExtractionUsage/usage', { startsAt: { integerValue: '0' } }],
    ['users/alice', { uid: { stringValue: 'mallory' }, isAdmin: { booleanValue: true } }],
    ['users/alice/profiles/default', { unknown: { stringValue: 'pollution' } }],
    ['users/alice/sources/resume-current', { resume: { stringValue: 'x'.repeat(100_000) } }],
    ['contactEnrichmentJobs/job', { status: { stringValue: 'completed' } }],
    ['apiLeases/lease', { token: { stringValue: 'attacker' } }],
  ];
  for (const [path, fields] of attacks) {
    await denied(await request(`/${path}`, owner, 'PATCH', { fields }), path);
  }
});

test('a mixed atomic batch cannot mutate server records', async () => {
  await denied(await request(':commit', userToken('alice'), 'POST', {
    writes: [
      { update: { name: `${database}/documents/companies/new`, ...data() } },
      { delete: `${database}/documents/apiQuota/quota` },
    ],
  }), 'batch');
  assert.equal((await request('/companies/new', 'owner')).status, 404);
  assert.equal((await request('/apiQuota/quota', 'owner')).status, 200);
});

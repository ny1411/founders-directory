import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEnrichmentHandlers, type EnrichmentJob } from '../../src/lib/enrichment-handler';
import { createSignedEnrichmentCallback, signEnrichmentMessage } from '../../src/lib/enrichment-callback';

const jobId = 'a'.repeat(64);
const owner = 'private-owner-id';
const secret = 'isolated-private-queue-secret-32-characters';
const privateEmail = 'private-contact@example.com';
const auth = {authorization: 'Bearer PRIVATE-TOKEN'};
const statusRequest = () => new Request(`https://app.invalid/api/enrich-contact/${jobId}?token=PRIVATE-QUERY`, {headers: auth});
const callbackRequest = (payload: unknown = signEnrichmentMessage(jobId, secret)) => new Request('https://app.invalid/api/queues/enrich-contact', {
  method: 'POST',
  headers: {'ce-type': 'com.vercel.queue.v2beta', 'ce-vqsqueuename': 'contact-enrichment', 'ce-vqsreceipthandle': 'PRIVATE-RECEIPT'},
  body: JSON.stringify(payload),
});

async function capture(run: () => Promise<void>) {
  const logs: string[] = [];
  const original = console.info;
  console.info = value => {logs.push(String(value));};
  try { await run(); } finally { console.info = original; }
  assert.doesNotMatch(logs.join('\n'), /PRIVATE-TOKEN|PRIVATE-QUERY|PRIVATE-RECEIPT|private-owner-id|private-contact@example|isolated-private-queue-secret/);
  assert.ok(logs.every(line => !line.includes(jobId)), 'job IDs must not enter diagnostic records');
  return logs.map(line => JSON.parse(line));
}

test('enrichment polling audits real handler denials, quota failures and private success without identifiers', async () => {
  let allowed = true;
  let missing = false;
  let unavailable = false;
  const handlers = createEnrichmentHandlers({
    verify: async () => ({uid: owner}),
    quota: async () => {
      if (unavailable) throw new Error('PRIVATE-QUERY');
      return {allowed, retryAfterSeconds: 40};
    },
    authorize: async () => true,
    start: async () => null,
    status: async () => missing ? null : ({uid: owner, status: 'completed', expiresAt: Date.now() + 60_000, results: [{workEmail: privateEmail}]} as EnrichmentJob),
  });
  const records = await capture(async () => {
    const check = async (request: Request, expected: number) => {
      const response = await handlers.GET(request, jobId);
      assert.equal(response.status, expected);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      return response;
    };
    await check(new Request('https://app.invalid/api/enrich-contact'), 401);
    const success = await check(statusRequest(), 200);
    assert.equal((await success.json()).results[0].workEmail, privateEmail, 'authorized contact results stay in the response');
    missing = true; await check(statusRequest(), 404);
    allowed = false; const denied = await check(statusRequest(), 429);
    assert.equal(denied.headers.get('retry-after'), '40');
    unavailable = true; await check(statusRequest(), 503);
  });
  const events = records.filter(record => record.event === 'contact_enrichment.status');
  assert.deepEqual(events.map(event => event.outcome), ['rejected', 'success', 'not_found', 'rate_limited', 'error']);
  assert.deepEqual(events.map(event => event.status_code), [401, 200, 404, 429, 503]);
  assert.ok(events.every(event => event.route === '/api/enrich-contact/[jobId]'));
  assert.equal(records.filter(record => record.metric === 'api.quota_rejections').length, 1);
});

test('signed Queue callback audits all returned outcomes and preserves retry behavior for SDK errors', async () => {
  let enabled = false;
  let fail = false;
  let calls = 0;
  const route = createSignedEnrichmentCallback(async () => {
    calls++;
    if (fail) throw new Error('PRIVATE-RECEIPT');
    return new Response(null, {status: 204});
  }, {enabled: () => enabled, secret: () => secret});
  const records = await capture(async () => {
    const check = async (request: Request, expected: number) => {
      const response = await route(request);
      assert.equal(response.status, expected);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      return response;
    };
    assert.equal((await check(callbackRequest(), 503)).headers.get('retry-after'), '60');
    enabled = true;
    await check(callbackRequest({jobId}), 401);
    await check(callbackRequest('x'.repeat(5000)), 400);
    assert.equal(calls, 0, 'rejected inputs perform no SDK work');
    await check(callbackRequest(), 204);
    fail = true;
    await assert.rejects(route(callbackRequest()), /PRIVATE-RECEIPT/, 'SDK failure must still reach the Queue retry path');
    assert.equal(calls, 2);
  });
  const events = records.filter(record => record.event === 'contact_enrichment.callback');
  assert.deepEqual(events.map(event => event.outcome), ['error', 'rejected', 'rejected', 'success', 'error']);
  assert.ok(events.every(event => event.route === '/api/queues/enrich-contact'));
  assert.equal(events.at(-1).error_code, 'internal_error');
});

test('accepted enrichment audit retains bounded batch context while excluding the private job ID', async () => {
  const handlers = createEnrichmentHandlers({
    verify: async () => ({uid: owner}), quota: async () => ({allowed: true, retryAfterSeconds: 1}),
    authorize: async () => true, start: async () => ({jobId, status: 'queued'}), status: async () => null,
  });
  const records = await capture(async () => {
    const response = await handlers.POST(new Request('https://app.invalid/api/enrich-contact', {
      method: 'POST', headers: {...auth, 'idempotency-key': 'private-idempotency-key'},
      body: JSON.stringify({founderIds: ['first', 'second', 'first'], companySlug: 'private-company'}),
    }));
    assert.equal(response.status, 202);
    assert.equal((await response.json()).jobId, jobId, 'job identity remains available to the authorized client');
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].event, 'contact_enrichment.accepted');
  assert.equal(records[0].batch_size, 2);
  assert.equal(records[0].quota_decision, 'allowed');
  assert.doesNotMatch(JSON.stringify(records), /private-idempotency-key|private-company|first|second/);
});

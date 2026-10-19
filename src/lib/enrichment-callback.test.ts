import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSignedEnrichmentCallback, enrichmentEnabled, signEnrichmentMessage, verifyEnrichmentMessage } from './enrichment-callback';

const secret = 'mock-secret-with-at-least-32-characters';
const jobId = 'a'.repeat(64);
const validHeaders = {
  'ce-type': 'com.vercel.queue.v2beta',
  'ce-vqsqueuename': 'contact-enrichment',
  'ce-vqsreceipthandle': 'mock-receipt',
  'ce-vqsconsumergroup': 'mock-consumer',
  'ce-vqsmessageid': 'mock-message',
};
function request(payload: unknown = signEnrichmentMessage(jobId, secret), headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/queues/enrich-contact', {method: 'POST', headers: {...validHeaders, ...headers}, body: JSON.stringify(payload)});
}
function fixture(enabled = true, key: string | null = secret) {
  const calls: Request[] = [];
  const route = createSignedEnrichmentCallback(async request => {
    calls.push(request);
    assert.equal(verifyEnrichmentMessage(await request.json(), secret), true);
    return new Response(null, {status: 204});
  }, {enabled: () => enabled, secret: () => key ?? undefined});
  return {route, calls};
}
test('disabled and unconfigured callbacks never invoke SDK even for signed input', async () => {
  for (const [enabled, key] of [[false, secret], [true, null], [true, 'too-short']] as const) {
    const f = fixture(enabled, key);
    assert.equal((await f.route(request())).status, 503);
    assert.equal(f.calls.length, 0);
  }
});
test('unsigned/forged direct bodies never invoke SDK or worker', async () => {
  const f = fixture();
  for (const value of [{jobId}, {jobId, signature: '0'.repeat(64)}, {...signEnrichmentMessage(jobId, secret), jobId: 'b'.repeat(64)}, {jobId, signature: 'short'}, {jobId, signature: []}]) {
    assert.equal((await f.route(request(value))).status, 401);
  }
  assert.equal(f.calls.length, 0);
});
test('pointer-only and legacy event modes never invoke SDK or Queue API', async () => {
  const f = fixture();
  assert.equal((await f.route(request(undefined, {'ce-vqsreceipthandle': ''}))).status, 401);
  assert.equal((await f.route(request({messageId: 'pointer'}))).status, 401);
  assert.equal((await f.route(request(undefined, {'ce-type': 'com.vercel.queue.v1beta'}))).status, 401);
  assert.equal(f.calls.length, 0);
});
test('wrong topic and missing/oversized receipt never invoke SDK', async () => {
  const f = fixture();
  const cases: Record<string, string>[] = [{'ce-vqsqueuename': 'other-topic'}, {'ce-vqsreceipthandle': ''}, {'ce-vqsreceipthandle': 'x'.repeat(2049)}];
  for (const headers of cases) {
    assert.equal((await f.route(request(undefined, headers))).status, 401);
  }
  assert.equal(f.calls.length, 0);
});
test('actual streamed body is bounded before SDK independent of content-length', async () => {
  const f = fixture();
  const encoded = new TextEncoder().encode(JSON.stringify({...signEnrichmentMessage(jobId, secret), padding: 'x'.repeat(5000)}));
  const body = new ReadableStream({start(controller) {controller.enqueue(encoded.slice(0, 2000)); controller.enqueue(encoded.slice(2000)); controller.close();}});
  const streamed = new Request('http://localhost/api/queues/enrich-contact', {method: 'POST', headers: {...validHeaders, 'content-length': '1'}, body, duplex: 'half'} as RequestInit);
  assert.equal((await f.route(streamed)).status, 400);
  assert.equal(f.calls.length, 0);
});
test('valid signed v2 direct payload invokes SDK exactly once with reconstructed body', async () => {
  const f = fixture();
  assert.equal((await f.route(request(undefined, {'content-length': '1'}))).status, 204);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].headers.get('content-length'), null);
  assert.equal(f.calls[0].headers.get('ce-vqsreceipthandle'), 'mock-receipt');
  assert.equal(f.calls[0].headers.get('content-type'), 'application/json');
});
test('signature binds job identity, domain, version and configured secret', () => {
  const signed = signEnrichmentMessage(jobId, secret);
  assert.equal(verifyEnrichmentMessage(signed, 'different-secret-at-least-32-characters'), false);
  assert.equal(verifyEnrichmentMessage({...signed, unexpected: true}, secret), false);
  assert.equal(verifyEnrichmentMessage(signed, secret), true);
  assert.throws(() => signEnrichmentMessage(jobId, 'short'), /QUEUE_SECRET_NOT_CONFIGURED/);
});
test('producer and worker enable gate requires flag and a configured signing secret', () => {
  const beforeFlag = process.env.CONTACT_ENRICHMENT_ENABLED;
  const beforeSecret = process.env.CONTACT_ENRICHMENT_QUEUE_SECRET;
  try {
    process.env.CONTACT_ENRICHMENT_ENABLED = 'true';
    delete process.env.CONTACT_ENRICHMENT_QUEUE_SECRET;
    assert.equal(enrichmentEnabled(), false);
    process.env.CONTACT_ENRICHMENT_QUEUE_SECRET = secret;
    assert.equal(enrichmentEnabled(), true);
    process.env.CONTACT_ENRICHMENT_ENABLED = 'false';
    assert.equal(enrichmentEnabled(), false);
  } finally {
    if (beforeFlag === undefined) delete process.env.CONTACT_ENRICHMENT_ENABLED; else process.env.CONTACT_ENRICHMENT_ENABLED = beforeFlag;
    if (beforeSecret === undefined) delete process.env.CONTACT_ENRICHMENT_QUEUE_SECRET; else process.env.CONTACT_ENRICHMENT_QUEUE_SECRET = beforeSecret;
  }
});

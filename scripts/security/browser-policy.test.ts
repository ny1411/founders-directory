import assert from 'node:assert/strict';
import { test } from 'node:test';
import nextConfig from '../../next.config';
import { browserSecurityHeaders } from '../../src/lib/security-headers';
import { receiveCspReport } from '../../src/lib/csp-report';
import { instrumentPrivateHandler } from '../../src/lib/observability-runtime';
import { createAuthSyncHandler } from '../../src/lib/auth-sync-handler';
import { fixture } from '../onboarding/fixture';

test('Next applies baseline headers and report-only CSP without breaking popup authentication', async () => {
  const rules = await nextConfig.headers?.();
  const all = rules?.find(rule => rule.source === '/(.*)');
  assert.ok(all);
  const headers = new Headers(all.headers.map(({key, value}): [string, string] => [key, value]));
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
  assert.equal(headers.get('content-security-policy'), null, 'CSP must remain report-only until browser rollout verification');
  const policy = headers.get('content-security-policy-report-only')!;
  for (const permitted of ["script-src 'self' 'unsafe-inline'", 'https://accounts.google.com', 'https://*.firebaseapp.com', 'https://*.googleapis.com', 'https://*.vercel-scripts.com']) assert.ok(policy.includes(permitted), permitted);
  assert.match(policy, /report-uri \/api\/csp-report/);
  assert.ok(!browserSecurityHeaders(false)[0].value.includes("'unsafe-eval'"));
  assert.ok(browserSecurityHeaders(true)[0].value.includes("'unsafe-eval'"));
});

function report(body: string, type = 'application/csp-report') {
  return new Request('http://localhost/api/csp-report', {method:'POST', headers:{'content-type':type}, body});
}

test('CSP report receiver retains only bounded directives and discards private URLs/samples', async () => {
  const events: string[] = [];
  const response = await receiveCspReport(report(JSON.stringify({'csp-report': {
    'effective-directive':'connect-src',
    'document-uri':'https://app.invalid/profile?token=SECRET',
    'blocked-uri':'https://private.invalid/resume',
    'script-sample':'private extracted resume',
  }})), directive => events.push(directive));
  assert.equal(response.status, 204);
  assert.deepEqual(events, ['connect-src']);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const unknown = await receiveCspReport(report(JSON.stringify([{
    body:{effectiveDirective:'attacker@example.com'},
  }]), 'application/reports+json'), directive => events.push(directive));
  assert.equal(unknown.status, 204);
  assert.deepEqual(events, ['connect-src', 'other']);
});

test('malformed, wrong-type and oversized CSP reports fail without logging their contents', async () => {
  let calls = 0;
  for (const [request, status] of [
    [report('not json'),400],
    [report('x'.repeat(16_385)),413],
    [report('{}','text/plain'),415],
  ] as const) {
    assert.equal((await receiveCspReport(request,()=>{calls++})).status,status);
  }
  assert.equal(calls,0);
});

test('private API outcomes remain uncacheable and logs exclude request identity and bodies', async () => {
  const logs: unknown[] = [];
  const original = console.info;
  console.info = value => {logs.push(value)};
  try {
    for (const status of [200, 400, 401, 403, 409, 429, 500, 503]) {
      const handler = instrumentPrivateHandler({route:'/api/founder-contact',event:'founder.contact',durationMetric:'profile.duration_ms'},async()=>Response.json({email:'private@example.com'},{status}));
      const response = await handler(new Request('http://localhost/api/founder-contact?secret=unique',{
        method:'POST',headers:{authorization:'Bearer PRIVATE-TOKEN'},body:'private resume',
      }));
      assert.equal(response.status,status);
      assert.equal(response.headers.get('cache-control'),'private, no-store');
    }
  } finally {console.info=original}
  const records = logs.map(line => JSON.parse(String(line)));
  const outcomes = records.filter(record => record.event === 'founder.contact');
  assert.equal(outcomes.length,8);
  assert.equal(records.filter(record => record.metric === 'api.quota_rejections').length,1);
  assert.doesNotMatch(JSON.stringify(logs),/PRIVATE-TOKEN|unique|private resume|private@example/);
  assert.equal(outcomes[5].outcome,'rate_limited');
});

test('real auth-sync and onboarding handlers audit rejections and read-only profile outcomes', async () => {
  const logs: string[] = [];
  const original = console.info;
  console.info = value => {logs.push(value)};
  try {
    const auth = createAuthSyncHandler({verifyIdToken:async()=>{throw new Error('must not verify')}} as never,{} as never,async()=>({allowed:true,retryAfterSeconds:1}));
    const rejected = await auth(new Request('http://localhost/api/auth/sync'));
    assert.equal(rejected.status,401);
    const f = fixture('audit-private-owner');
    const read = await f.handlers.GET(new Request('http://localhost/api/onboarding',{headers:{authorization:'Bearer audit-private-owner'}}));
    assert.equal(read.status,200);
  } finally {console.info=original}
  const records=logs.map(line=>JSON.parse(line)).filter(record=>record.event !== 'metric');
  assert.equal(records[0].event,'auth.sync');
  assert.equal(records[0].outcome,'rejected');
  assert.equal(records[1].event,'profile');
  assert.equal(records[1].outcome,'success');
  assert.doesNotMatch(JSON.stringify(records),/audit-private-owner/);
});

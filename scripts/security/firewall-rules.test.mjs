import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { addRuleArgs, missingRules, observationRules } from './firewall-rules.mjs';
import { projectId, teamId } from './firewall-rules.mjs';
import { previewProbeRule, runPreviewProbe, verifyPreviewRule } from './firewall-preview.mjs';

test('every observation rule scopes environment, method and path and only logs exceeded limits', () => {
  const rules = observationRules();
  assert.equal(rules.length, 16);
  assert.equal(new Set(rules.map(rule => rule.name)).size, rules.length);
  for (const rule of rules) {
    for (const group of rule.conditionGroup) {
      const conditions = group.conditions;
      assert.deepEqual(conditions.slice(0, 3).map(c => c.type), ['environment', 'method', 'path']);
      assert.equal(conditions[0].value, 'production');
    }
    assert.equal(rule.action.mitigate.rateLimit.action, 'log');
    assert.equal(rule.action.mitigate.rateLimit.window, 600);
    assert.deepEqual(rule.action.mitigate.rateLimit.keys, ['ip']);
    const args = addRuleArgs(rule);
    assert.ok(args.includes('--non-interactive'));
    assert.ok(args.includes('--yes'));
    assert.ok(!args.includes('publish'));
  }
});

test('reruns preserve other rules and skip identical rules; conflicting tuned rules fail closed', () => {
  const desired = observationRules();
  assert.deepEqual(missingRules([{ name: 'Owner rule' }, ...desired]), []);
  assert.equal(missingRules(desired.slice(0, 3)).length, desired.length - 3);
  const tuned = structuredClone(desired[0]);
  tuned.action.mitigate.rateLimit.action = 'rate_limit';
  assert.throws(() => missingRules([tuned]), /differs/);
  assert.throws(() => missingRules([desired[0], desired[0]]), /Duplicate/);
  assert.throws(() => missingRules([{ name: 'FD #40 observe homepage' }]), /Legacy homepage/);
});

test('API optional defaults and property order do not duplicate staged rules', () => {
  const desired = observationRules();
  const existing = structuredClone(desired);
  for (const rule of existing) {
    rule.action.mitigate.redirect = null;
    rule.action.mitigate.actionDuration = null;
    for (const group of rule.conditionGroup) group.conditions = group.conditions.map(condition => ({ ...condition, neg: false }));
  }
  assert.deepEqual(missingRules(existing), []);
});

// Model the manifest's supported condition operators; this proves repository
// coverage, not publication, plan entitlement, or live Vercel classification.
function matches(rule, request) {
  return rule.conditionGroup.some(group => group.conditions.every(condition => {
    const actual = condition.type === 'header' ? request.headers?.[condition.key] : request[condition.type];
    if (condition.op === 'ex') return actual !== undefined && actual !== null;
    if (condition.op === 'inc') return condition.value.includes(actual);
    if (condition.op === 'pre') return typeof actual === 'string' && actual.startsWith(condition.value);
    if (condition.op === 'eq') return actual === condition.value;
    throw new Error(`Untested condition: ${condition.op}`);
  }));
}

test('every exported API method, including implicit HEAD and profile aliases, has observation coverage', () => {
  const root = new URL('../../src/app/api/', import.meta.url);
  const files = readdirSync(root, { recursive: true }).filter(file => String(file).endsWith('route.ts'));
  const rules = observationRules();
  let operations = 0;
  for (const file of files) {
    const source = readFileSync(new URL(String(file), root), 'utf8');
    const path = `/api/${String(file).replace(/\/route\.ts$/, '').replace(/\[[^\]]+\]/g, 'fixture-id')}`;
    const methods = new Set([...source.matchAll(/export\s+(?:const|(?:async\s+)?function)\s+(GET|POST|PATCH|PUT|DELETE|HEAD)\b/g)].map(match => match[1]));
    assert.ok(methods.size, `route scanner must recognize exports in ${file}`);
    if (methods.has('GET')) methods.add('HEAD');
    for (const method of methods) {
      operations += 1;
      const matched = rules.filter(rule => matches(rule, { environment: 'production', method, path }));
      if (path === '/api/queues/enrich-contact') {
        assert.equal(method, 'POST');
        assert.equal(matched.length, 0, 'signed Queue service callback intentionally excluded');
        assert.match(source, /handleCallback/);
      } else assert.equal(matched.length, 1, `${method} ${path} must have one observation budget`);
    }
  }
  assert.ok(operations >= 15, 'do not silently lose route coverage');
  for (const method of ['GET', 'HEAD']) {
    assert.ok(rules.some(rule => matches(rule, { environment: 'production', method, path: '/_next/image' })));
  }
});

test('Server Action transport coverage stays conditional on action metadata and serializes every OR group', () => {
  const rule = observationRules().find(rule => rule.name.endsWith('server-actions'));
  assert.equal(rule.conditionGroup.length, 2);
  assert.deepEqual(rule.conditionGroup.map(group => group.conditions[3]), [
    { type: 'server_action', op: 'ex' }, { type: 'header', key: 'next-action', op: 'ex' },
  ]);
  for (const path of ['/company/new', '/company/example', '/']) {
    for (const metadata of [{ server_action: 'fixture-action' }, { headers: { 'next-action': 'fixture-action' } }]) {
      assert.ok(matches(rule, { environment: 'production', method: 'POST', path, ...metadata }));
      assert.ok(!matches(rule, { environment: 'preview', method: 'POST', path, ...metadata }));
      assert.ok(!matches(rule, { environment: 'production', method: 'GET', path, ...metadata }));
    }
    assert.ok(!matches(rule, { environment: 'production', method: 'POST', path }));
  }
  const args = addRuleArgs(rule);
  assert.equal(args.filter(arg => arg === '--or').length, 1);
  const conditions = args.flatMap((arg, index) => arg === '--condition' ? [JSON.parse(args[index + 1])] : []);
  assert.deepEqual(conditions, rule.conditionGroup.flatMap(group => group.conditions));
  // Imported actions submit to the current canonical URL, not a
  // dedicated API endpoint. Guard this against framework upgrades.
  const transport = readFileSync(new URL('../../node_modules/next/dist/client/components/router-reducer/reducers/server-action-reducer.js', import.meta.url), 'utf8');
  assert.match(transport, /_fetch\.fetch\)\(state\.canonicalUrl,\s*\{\s*method: 'POST'/);
  assert.match(transport, /\[_approuterheaders\.ACTION_HEADER\]: actionId/);
});

test('profile aliases share one write budget and public routes do not match all API methods', () => {
  const rules = observationRules();
  const profile = rules.find(rule => rule.name.endsWith('profile-write'));
  assert.deepEqual(profile.conditionGroup[0].conditions[1].value, ['PATCH', 'POST']);
  const homepage = rules.find(rule => rule.name.endsWith('homepage'));
  assert.deepEqual(homepage.conditionGroup[0].conditions[2], { type: 'path', op: 'eq', value: '/' });
  assert.equal(homepage.name, 'FD #35 observe homepage');
  assert.equal(homepage.action.mitigate.rateLimit.limit, 100);
  const enrichment = rules.find(rule => rule.name.endsWith('enrichment'));
  assert.equal(enrichment.action.mitigate.rateLimit.limit, 10);
});

const previewId = 'dpl_previewFixture';
const probeKey = 'probe-fixture-'.repeat(4);
function previewFixture() {
  const deployment = { id: previewId, projectId, target: null, readyState: 'READY', url: 'preview-fixture.vercel.app' };
  const rule = { ...previewProbeRule(deployment, probeKey), id: 'rule_previewFixture', valid: true };
  const snapshot = { projectKey: `${projectId}#active`, ownerId: teamId, version: 3, firewallEnabled: true, rules: [rule] };
  return { deployment, deploymentId: previewId, snapshot, key: probeKey, log() {} };
}

test('Preview probe performs no requests for wrong deployments, drafts, unscoped or drifted rules', async () => {
  for (const mutate of [
    f => { f.deployment.target = 'production'; },
    f => { delete f.deployment.target; },
    f => { f.deployment.projectId = 'another-project'; },
    f => { f.deployment.readyState = 'BUILDING'; },
    f => { f.deployment.url = 'another-origin.example'; },
    f => { f.deployment.id = 'dpl_another'; },
    f => { f.snapshot.projectKey = `${projectId}#draft`; },
    f => { f.snapshot.ownerId = 'another-team'; },
    f => { f.snapshot.firewallEnabled = false; },
    f => { f.snapshot = { draft: f.snapshot }; },
    f => { f.snapshot.rules = []; },
    f => { f.snapshot.rules.push(structuredClone(f.snapshot.rules[0])); },
    f => { f.snapshot.rules[0].active = false; },
    f => { f.snapshot.rules[0].valid = false; },
    f => { f.snapshot.rules[0].conditionGroup[0].conditions = f.snapshot.rules[0].conditionGroup[0].conditions.filter(c => c.type !== 'host'); },
    f => { f.snapshot.rules[0].conditionGroup[0].conditions.find(c => c.type === 'environment').value = 'production'; },
    f => { f.snapshot.rules[0].conditionGroup[0].conditions.find(c => c.type === 'header').value = 'another-key'; },
    f => { f.snapshot.rules[0].action.mitigate.rateLimit.action = 'log'; },
    f => { f.snapshot.rules[0].action.mitigate.rateLimit.limit = 100; },
    f => { f.snapshot.rules[0].action.mitigate.rateLimit.window = 600; },
    f => { f.snapshot.rules.unshift({ active: true, action: { mitigate: { action: 'bypass' } } }); },
  ]) {
    const fixture = previewFixture();
    mutate(fixture);
    let sent = 0;
    await assert.rejects(runPreviewProbe({ ...fixture, fetchImpl: async () => { sent++; throw new Error('must not request'); } }), /no traffic sent/);
    assert.equal(sent, 0);
  }
});

test('Preview probe accepts reordered active API defaults, never a preferred but unpublished draft', () => {
  const f = previewFixture();
  const rule = f.snapshot.rules[0];
  rule.conditionGroup[0].conditions.reverse();
  rule.conditionGroup[0].conditions.forEach(condition => { condition.neg = false; });
  rule.action.mitigate.actionDuration = null;
  rule.action.mitigate.redirect = null;
  assert.deepEqual(verifyPreviewRule({ result: { active: f.snapshot, draft: { rules: [] } } }, f.deployment, probeKey), { ruleId: rule.id, configVersion: 3 });
  assert.throws(() => verifyPreviewRule({ active: { ...f.snapshot, rules: [] }, draft: f.snapshot }, f.deployment, probeKey), /no traffic sent/);
});

test('Preview requests are sequential, capped at eight and keep credentials off logs and results', async () => {
  const calls = [];
  const logs = [];
  const f = previewFixture();
  let inFlight = 0;
  let cancellations = 0;
  const result = await runPreviewProbe({ ...f, bypass: 'private-bypass-secret', log: line => logs.push(line), fetchImpl: async (url, options) => {
    assert.equal(inFlight++, 0);
    await Promise.resolve();
    calls.push({ url, options });
    inFlight--;
    return { status: calls.length <= 6 ? 200 : 429, body: { async cancel() { cancellations++; } } };
  } });
  assert.equal(calls.length, 8);
  assert.equal(cancellations, 8);
  assert.deepEqual(calls.map(c => c.options.method), ['GET', 'HEAD', 'GET', 'GET', 'GET', 'GET', 'GET', 'GET']);
  assert.equal(calls[2].options.headers['x-fd-firewall-probe'], undefined);
  for (const call of calls) {
    assert.ok(call.url.startsWith('https://preview-fixture.vercel.app/'));
    assert.equal(call.options.headers['x-vercel-protection-bypass'], 'private-bypass-secret');
    assert.equal(call.options.redirect, 'manual');
    assert.ok(call.options.signal instanceof AbortSignal);
  }
  assert.equal(result.requestBehaviorPassed, true);
  assert.equal(result.edgeAttributionVerified, false, '429 responses still need rule traffic and Function corroboration');
  assert.equal(result.ruleId, 'rule_previewFixture');
  assert.ok(!JSON.stringify({ logs, result }).includes(probeKey));
  assert.ok(!JSON.stringify({ logs, result }).includes('private-bypass-secret'));
});

test('Preview auth denials, redirects and managed checkpoint 429s fail controls before exercising limits', async () => {
  for (const status of [302, 401, 403, 404, 429, 500]) {
    let sent = 0;
    await assert.rejects(runPreviewProbe({ ...previewFixture(), fetchImpl: async () => {
      sent++; return { status, body: { async cancel() {} } };
    } }), /control failed/);
    assert.equal(sent, 1);
  }
});

test('Preview requires all three below-limit successes and two above-limit 429s without retrying', async () => {
  for (const statuses of [[200, 200, 200, 200, 200, 429], [200, 200, 200, 200, 200, 200, 200], [200, 200, 200, 200, 200, 200, 429, 403]]) {
    let sent = 0;
    await assert.rejects(runPreviewProbe({ ...previewFixture(), fetchImpl: async () => ({ status: statuses[sent++], body: { async cancel() {} } }) }), /threshold behavior failed/);
    assert.equal(sent, statuses.length);
  }
});

test('Preview window expiry and transport errors are inconclusive and cannot echo secret errors', async () => {
  let sent = 0;
  await assert.rejects(runPreviewProbe({ ...previewFixture(), now: () => sent >= 4 ? 60_000 : 0, fetchImpl: async () => {
    sent++; return { status: 200, body: { async cancel() {} } };
  } }), /exceeded its rate window/);
  assert.equal(sent, 4);
  await assert.rejects(runPreviewProbe({ ...previewFixture(), fetchImpl: async () => { throw new Error(probeKey); } }), error => !error.message.includes(probeKey) && /request failed/.test(error.message));
});

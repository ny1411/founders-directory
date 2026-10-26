import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { addRuleArgs, missingRules, observationRules } from './firewall-rules.mjs';

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

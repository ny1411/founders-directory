import assert from 'node:assert/strict';
import test from 'node:test';
import { addRuleArgs, missingRules, observationRules } from './firewall-rules.mjs';

test('every observation rule scopes environment, method and path and only logs exceeded limits', () => {
  const rules = observationRules();
  assert.equal(rules.length, 11);
  assert.equal(new Set(rules.map(rule => rule.name)).size, rules.length);
  for (const rule of rules) {
    const conditions = rule.conditionGroup[0].conditions;
    assert.deepEqual(conditions.map(c => c.type), ['environment', 'method', 'path']);
    assert.equal(conditions[0].value, 'production');
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
  assert.equal(missingRules(desired.slice(0, 3)).length, 8);
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
    rule.conditionGroup[0].conditions = rule.conditionGroup[0].conditions.map(condition => ({ value: condition.value, op: condition.op, type: condition.type, neg: false }));
  }
  assert.deepEqual(missingRules(existing), []);
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

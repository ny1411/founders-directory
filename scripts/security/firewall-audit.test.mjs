import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { auditFirewallSnapshot, readFirewallSnapshot } from './firewall-audit.mjs';
import { observationRules, projectId, teamId } from './firewall-rules.mjs';

function snapshot(rules = observationRules()) {
  return { projectKey: `${projectId}#active`, ownerId: teamId, version: 2, firewallEnabled: true, rules };
}
const state = config => auditFirewallSnapshot(config).coverage[0].state;

test('the observed single homepage rule reports observation and all 15 API/page gaps', () => {
  const config = snapshot(observationRules().slice(0, 1));
  config.managedRules = { bot_protection: { active: true, action: 'challenge' } };
  const report = auditFirewallSnapshot({ result: config });
  assert.deepEqual(report.counts, { missing: 15, observation: 1 });
  assert.equal(report.readyToCloseIssue40, false);
  assert.equal(report.coverage[0].configuredAction, 'log');
});

test('draft-only, missing, error and wrong-owner/project input never count as coverage', () => {
  for (const input of [null, {}, { error: 'not_found' }, { draft: snapshot() }, { ...snapshot(), projectKey: `${projectId}#draft` },
    { ...snapshot(), ownerId: 'another-team' }, { ...snapshot(), projectKey: 'another-project#active' },
    { ...snapshot(), rules: null }, { ...snapshot(), version: undefined }, { ...snapshot(), rules: [null] }]) {
    assert.throws(() => auditFirewallSnapshot(input), /Expected|Malformed/);
  }
  assert.equal(auditFirewallSnapshot({ result: { active: snapshot(), draft: snapshot([]) } }).counts.observation, 16);
});

test('disabled and invalid rules are distinguished from structurally configured enforcement', () => {
  const config = snapshot();
  config.firewallEnabled = false;
  assert.equal(state(config), 'disabled');
  config.firewallEnabled = true;
  config.rules[0].active = false;
  assert.equal(state(config), 'disabled');
  config.rules[0].active = true;
  config.rules[0].valid = false;
  assert.equal(state(config), 'invalid');
  delete config.rules[0].valid;
  for (const action of ['rate_limit', 'challenge', 'deny']) {
    config.rules[0].action.mitigate.rateLimit.action = action;
    assert.equal(state(config), 'enforcement_configured');
  }
});

test('same-name broadened scopes, changed thresholds, duplicate names and action changes require review', () => {
  for (const mutate of [
    rule => { rule.conditionGroup[0].conditions[0].value = 'preview'; },
    rule => { rule.conditionGroup[0].conditions.pop(); },
    rule => { rule.action.mitigate.rateLimit.limit = 1; },
    rule => { rule.action.mitigate.rateLimit.action = 'bypass'; },
    rule => { rule.action.mitigate.actionDuration = '1h'; },
    rule => { rule.action.mitigate.action = 'log'; },
  ]) {
    const config = snapshot(); mutate(config.rules[0]); assert.equal(state(config), 'drift');
  }
  const rule = observationRules()[0];
  assert.equal(state(snapshot([rule, rule])), 'conflict');
});

test('API optional defaults and reordered OR/AND values preserve coverage', () => {
  const config = snapshot();
  for (const rule of config.rules) {
    rule.conditionGroup.reverse();
    rule.conditionGroup.forEach(group => {
      group.conditions.reverse();
      group.conditions.forEach(condition => { condition.neg = false; if (Array.isArray(condition.value)) condition.value.reverse(); });
    });
    rule.action.mitigate.redirect = null;
    rule.action.mitigate.actionDuration = null;
  }
  assert.deepEqual(auditFirewallSnapshot(config).counts, { observation: 16 });
});

test('earlier bypass or enforcement rules require order review; disabled rules do not', () => {
  for (const mitigation of [{ action: 'bypass' }, { action: 'deny' }, { action: 'rate_limit', rateLimit: { action: 'rate_limit' } }]) {
    const config = snapshot([{ name: 'private unrelated rule', active: true, action: { mitigate: mitigation } }, ...observationRules()]);
    assert.equal(auditFirewallSnapshot(config).coverage[0].state, 'order_review');
    config.rules[0].active = false;
    assert.equal(auditFirewallSnapshot(config).coverage[0].state, 'observation');
  }
});

test('report excludes raw config conditions, unknown names, metadata and possible secrets', () => {
  const config = snapshot();
  config.updatedAt = 'private-token';
  config.rules.unshift({ name: 'private-token', active: false, conditionGroup: [{ conditions: [{ value: 'private-token' }] }] });
  config.secret = 'private-token';
  assert.ok(!JSON.stringify(auditFirewallSnapshot(config)).includes('private-token'));
});

test('offline reader bounds input and returns safe errors for invalid JSON', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'firewall-audit-'));
  const file = path.join(directory, 'snapshot.json');
  try {
    writeFileSync(file, JSON.stringify(snapshot()));
    assert.equal(auditFirewallSnapshot(readFirewallSnapshot(file)).counts.observation, 16);
    writeFileSync(file, 'private-token');
    assert.throws(() => readFirewallSnapshot(file), error => !error.message.includes('private-token') && /must be JSON/.test(error.message));
    writeFileSync(file, Buffer.alloc(1024 * 1024 + 1));
    assert.throws(() => readFirewallSnapshot(file), /exceeds 1 MiB/);
  } finally { rmSync(directory, { recursive: true }); }
});

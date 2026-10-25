import { closeSync, openSync, readSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { observationRules, projectId, teamId } from './firewall-rules.mjs';

const MAX_SNAPSHOT_BYTES = 1024 * 1024;

// Condition order and optional API defaults do not change a rule's semantics.
function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => item != null && !(key === 'neg' && item === false))
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalized(item)]));
  return value;
}
const same = (a, b) => JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));

/** Only a positively identified active snapshot can describe deployed coverage. */
export function auditFirewallSnapshot(snapshot) {
  const data = snapshot?.result ?? snapshot;
  const config = data?.active ?? data;
  if (!config || config.projectKey !== `${projectId}#active` || config.ownerId !== teamId ||
      !Array.isArray(config.rules) || typeof config.firewallEnabled !== 'boolean' ||
      !Number.isInteger(config.version) || config.version < 1) {
    throw new Error('Expected a verified active Firewall snapshot for the configured project/team. Drafts, missing identity and API errors are not coverage evidence.');
  }
  if (config.rules.some(rule => !rule || typeof rule !== 'object')) {
    throw new Error('Malformed Firewall rules; inspect the snapshot manually.');
  }
  const coverage = observationRules().map(desired => {
    const matches = config.rules.map((rule, index) => ({ rule, index })).filter(({rule}) => rule.name === desired.name);
    const row = { name: desired.name, state: 'missing' };
    if (!matches.length) return row;
    if (matches.length !== 1) return { ...row, state: 'conflict' };
    const { rule, index } = matches[0];
    if (!config.firewallEnabled || rule.active === false) return { ...row, state: 'disabled' };
    if (rule.active !== true || rule.valid === false || (Array.isArray(rule.validationErrors) && rule.validationErrors.length)) {
      return { ...row, state: 'invalid' };
    }
    const mitigation = rule.action?.mitigate;
    const rate = mitigation?.rateLimit;
    const { action: desiredAction, ...desiredRate } = desired.action.mitigate.rateLimit;
    const { action, ...actualRate } = rate ?? {};
    if (!same(rule.conditionGroup, desired.conditionGroup) || mitigation?.action !== 'rate_limit' ||
        !same(actualRate, desiredRate) || !['log', 'rate_limit', 'challenge', 'deny'].includes(action) ||
        mitigation.actionDuration != null || mitigation.redirect != null) {
      return { ...row, state: 'drift' };
    }
    // Do not pretend this is a general WAF evaluator. An earlier terminal rule
    // could supersede these conditions; require inspection rather than guessing
    // at unsupported condition operators or bypass semantics.
    const earlierTerminal = config.rules.slice(0, index).some(previous => {
      if (previous.active === false) return false;
      const mitigation = previous.action?.mitigate;
      return mitigation?.action !== 'log' && !(mitigation?.action === 'rate_limit' && mitigation.rateLimit?.action === 'log');
    });
    if (earlierTerminal) return { ...row, state: 'order_review', configuredAction: action };
    return { ...row, state: action === desiredAction ? 'observation' : 'enforcement_configured', configuredAction: action };
  });
  const counts = Object.fromEntries([...new Set(coverage.map(row => row.state))].sort()
    .map(state => [state, coverage.filter(row => row.state === state).length]));
  return {
    projectId, teamId, configVersion: config.version, firewallEnabled: config.firewallEnabled,
    snapshotUpdatedAt: typeof config.updatedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(config.updatedAt) && Number.isFinite(Date.parse(config.updatedAt)) ? config.updatedAt : null,
    counts, coverage,
    scope: 'Structural active-configuration audit only. Rule names alone, drafts and managed bot protection do not prove route coverage. Live matching, plan entitlement, threshold safety, regional counters and Preview/Production behavior need separate evidence.',
    readyToCloseIssue40: false,
  };
}

export function readFirewallSnapshot(path) {
  // Bound the bytes read, including special files and files that grow while read.
  const fd = openSync(path, 'r');
  const bytes = Buffer.alloc(MAX_SNAPSHOT_BYTES + 1);
  let length = 0;
  try {
    for (;;) {
      const read = readSync(fd, bytes, length, bytes.length - length, null);
      length += read;
      if (length > MAX_SNAPSHOT_BYTES) throw new Error('Firewall snapshot exceeds 1 MiB.');
      if (!read) break;
    }
  } finally { closeSync(fd); }
  try { return JSON.parse(bytes.subarray(0, length).toString('utf8')); }
  catch { throw new Error('Firewall snapshot must be JSON; input contents are not echoed.'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/security/firewall-audit.mjs <active-config.json>');
    const report = auditFirewallSnapshot(readFirewallSnapshot(process.argv[2]));
    console.log(JSON.stringify(report, null, 2));
    // This is a coverage report, not a live verification pass/fail gate.
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export const projectId = 'prj_oxUZTfhN9aAIwtcABk8dcX00nFvt';
export const teamId = 'team_uk1Ii5k2P5wcgjeFoxW9ojfC';
export const teamSlug = 'ny1411';

// #35 homepage and #40 API starting points, not measured safe enforcement thresholds.
const definitions = [
  ['homepage', ['GET'], '/', 'eq', 100],
  ['company', ['GET', 'HEAD'], '/company/', 'pre', 120],
  ['enrichment', ['POST'], '/api/enrich-contact', 'eq', 10],
  ['enrichment-status', ['GET', 'HEAD'], '/api/enrich-contact/', 'pre', 120],
  ['dm', ['POST'], '/api/generate-dm', 'eq', 20],
  ['resume', ['POST'], '/api/extract-resume', 'eq', 10],
  ['onboarding', ['POST'], '/api/onboarding', 'eq', 120],
  ['onboarding-read', ['GET', 'HEAD'], '/api/onboarding', 'eq', 120],
  ['auth-sync', ['POST'], '/api/auth/sync', 'eq', 30],
  ['profile-read', ['GET', 'HEAD'], '/api/profile', 'eq', 120],
  ['profile-write', ['PATCH', 'POST'], '/api/profile', 'eq', 30],
  ['directory', ['GET', 'HEAD'], '/api/directory', 'eq', 60],
  ['founder-contact', ['POST'], '/api/founder-contact', 'eq', 60],
  ['csp-report', ['POST'], '/api/csp-report', 'eq', 120],
  ['image-optimizer', ['GET', 'HEAD'], '/_next/image', 'eq', 300],
  ['server-actions', ['POST'], '/', 'pre', 30],
];

export function observationRules() {
  return definitions.map(([key, methods, path, op, limit]) => ({
    name: `FD #${key === 'homepage' ? '35' : '40'} observe ${key}`,
    active: true,
    description: `Issue #${key === 'homepage' ? '35' : '40'}: production observation only; review traffic before preview enforcement.`,
    conditionGroup: (key === 'server-actions' ? [
      { type: 'server_action', op: 'ex' },
      { type: 'header', key: 'next-action', op: 'ex' },
    ] : [null]).map(extra => ({ conditions: [
      { type: 'environment', op: 'eq', value: 'production' },
      { type: 'method', op: methods.length === 1 ? 'eq' : 'inc', value: methods.length === 1 ? methods[0] : methods },
      { type: 'path', op, value: path },
      ...(extra ? [extra] : []),
    ] })),
    action: { mitigate: { action: 'rate_limit', rateLimit: {
      algo: 'fixed_window', window: 600, limit, keys: ['ip'], action: 'log',
    } } },
  }));
}

// Leave existing rules/drafts in place, and refuse to revert a rule an owner has
// already tuned or enforced. Safe to re-run after a partially completed batch.
export function missingRules(existing, desired = observationRules()) {
  if (existing.some(rule => rule.name === 'FD #40 observe homepage')) {
    throw new Error('Legacy homepage rule exists; inspect or migrate it before staging #35 to avoid overlapping limits.');
  }
  return desired.filter(rule => {
    const matches = existing.filter(item => item.name === rule.name);
    if (matches.length > 1) throw new Error(`Duplicate rule name: ${rule.name}`);
    if (!matches.length) return true;
    const current = matches[0];
    for (const key of ['active', 'conditionGroup', 'action']) {
      if (JSON.stringify(normalize(current[key])) !== JSON.stringify(normalize(rule[key]))) {
        throw new Error(`Existing rule differs; inspect manually: ${rule.name}`);
      }
    }
    return false;
  });
}

// The API can serialize optional null fields and explicit neg:false; field
// ordering also differs from the CLI payload. Keep meaningful differences.
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key, item]) => item != null && !(key === 'neg' && item === false))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, normalize(item)]));
  }
  return value;
}

export function addRuleArgs(rule) {
  const rate = rule.action.mitigate.rateLimit;
  return ['--non-interactive', '--scope', teamSlug, 'firewall', 'rules', 'add', rule.name,
    '--project', projectId,
    ...rule.conditionGroup.flatMap((group, index) => [
      ...(index ? ['--or'] : []),
      ...group.conditions.flatMap(condition => ['--condition', JSON.stringify(condition)]),
    ]),
    '--description', rule.description, '--action', 'rate_limit',
    '--rate-limit-window', String(rate.window), '--rate-limit-requests', String(rate.limit),
    '--rate-limit-keys', 'ip', '--rate-limit-action', 'log', '--yes'];
}

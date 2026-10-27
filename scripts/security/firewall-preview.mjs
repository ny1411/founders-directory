import { projectId, teamId } from './firewall-rules.mjs';

const ruleName = 'FD #40 preview homepage probe';
export function previewDeployment(value, deploymentId) {
  const deployment = value?.result ?? value;
  if (!/^dpl_[A-Za-z0-9]+$/.test(deploymentId ?? '') || deployment?.id !== deploymentId ||
      deployment.projectId !== projectId || ![null, 'preview'].includes(deployment.target) ||
      deployment.readyState !== 'READY' || !/^[a-z0-9-]+\.vercel\.app$/.test(deployment.url ?? '')) {
    throw new Error('Expected a READY Preview deployment in the configured project; no traffic sent.');
  }
  return deployment;
}

/** Exact candidate shape for an owner-reviewed, separately published draft. */
export function previewProbeRule(deployment, key) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(key ?? '')) throw new Error('FIREWALL_PROBE_KEY must contain 32–128 random URL-safe characters.');
  return {
    name: ruleName,
    active: true,
    conditionGroup: [{ conditions: [
      { type: 'environment', op: 'eq', value: 'preview' },
      { type: 'host', op: 'eq', value: deployment.url },
      { type: 'method', op: 'eq', value: 'GET' },
      { type: 'path', op: 'eq', value: '/' },
      { type: 'header', op: 'eq', key: 'x-fd-firewall-probe', value: key },
    ] }],
    action: { mitigate: { action: 'rate_limit', rateLimit: {
      algo: 'fixed_window', window: 60, limit: 3, keys: ['ip'], action: 'rate_limit',
    } } },
  };
}

function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => item != null && !(key === 'neg' && item === false))
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalized(item)]));
  return value;
}
const same = (a, b) => JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));

export function verifyPreviewRule(snapshot, deployment, key) {
  const data = snapshot?.result ?? snapshot;
  const config = data?.active ?? data;
  if (config?.projectKey !== `${projectId}#active` || config.ownerId !== teamId ||
      config.firewallEnabled !== true || !Number.isInteger(config.version) || config.version < 1 || !Array.isArray(config.rules)) {
    throw new Error('Expected the configured project/team active Firewall snapshot; no traffic sent.');
  }
  const desired = previewProbeRule(deployment, key);
  const matches = config.rules.filter(rule => rule?.name === ruleName);
  if (matches.length !== 1) throw new Error('Publish exactly one reviewed Preview probe rule before testing; no traffic sent.');
  const rule = matches[0];
  if (rule.active !== true || rule.valid === false || (rule.validationErrors != null &&
      (!Array.isArray(rule.validationErrors) || rule.validationErrors.length)) ||
      !/^rule_[A-Za-z0-9_-]+$/.test(rule.id ?? '') || !same(rule.conditionGroup, desired.conditionGroup) ||
      !same(rule.action, desired.action)) {
    throw new Error('Preview probe rule is invalid or differs from the exact host/header/method/path and 3-per-60-second candidate; no traffic sent.');
  }
  const index = config.rules.indexOf(rule);
  if (config.rules.slice(0, index).some(previous => previous?.active !== false &&
      previous?.action?.mitigate?.action !== 'log' && !(previous?.action?.mitigate?.action === 'rate_limit' && previous.action.mitigate.rateLimit?.action === 'log'))) {
    throw new Error('An earlier potentially terminal Firewall rule needs manual order review; no traffic sent.');
  }
  return { ruleId: rule.id, configVersion: config.version };
}

/** Injectable, sequential and read-only: three controls plus five marked GETs. */
export async function runPreviewProbe({ deployment: raw, deploymentId, snapshot, key, bypass, fetchImpl = fetch, now = Date.now, log = console.log }) {
  const deployment = previewDeployment(raw, deploymentId);
  const evidence = verifyPreviewRule(snapshot, deployment, key);
  const accessHeaders = bypass ? { 'x-vercel-protection-bypass': bypass } : {};
  let requests = 0;
  async function request(path, method, marked) {
    requests += 1;
    let status;
    try {
      const response = await fetchImpl(`https://${deployment.url}${path}`, {
        method, headers: { ...accessHeaders, ...(marked ? { 'x-fd-firewall-probe': key } : {}) },
        redirect: 'manual', signal: AbortSignal.timeout(10_000),
      });
      status = response.status;
      await response.body?.cancel();
    } catch { throw new Error('Preview request failed; response details and credentials are not echoed.'); }
    log(`${method} ${path}: ${status}`);
    return status;
  }
  // A redirect, auth denial or managed challenge is a failed control, not
  // evidence that unrelated traffic remains usable.
  for (const [path, method, marked] of [['/robots.txt', 'GET', true], ['/', 'HEAD', true], ['/', 'GET', false]]) {
    const status = await request(path, method, marked);
    if (status < 200 || status >= 300) throw new Error('Preview control failed. Check deployment protection, managed challenges and application health before testing limits.');
  }
  const started = now();
  for (let index = 0; index < 5; index++) {
    if (now() - started >= 60_000) throw new Error('Probe exceeded its rate window; results are inconclusive.');
    const status = await request('/', 'GET', true);
    if (index < 3 ? status < 200 || status >= 300 : status !== 429) {
      throw new Error('Preview threshold behavior failed. Inspect rule-specific traffic, regional counters and managed challenges; do not infer edge enforcement.');
    }
  }
  if (now() - started >= 60_000) throw new Error('Probe exceeded its rate window; results are inconclusive.');
  return { deploymentId, ...evidence, requests, requestBehaviorPassed: true, edgeAttributionVerified: false };
}

import { spawnSync } from 'node:child_process';
import { projectId, teamSlug } from './firewall-rules.mjs';

// Eight sequential read-only requests maximum, never a production deployment.
const deploymentId = process.argv[2];
const key = process.env.FIREWALL_PROBE_KEY;
if (!/^dpl_[A-Za-z0-9]+$/.test(deploymentId ?? '') || !key || key.length < 32) {
  throw new Error('Pass a preview deployment ID and set FIREWALL_PROBE_KEY to the same 32+ character value used in the preview rule.');
}
const inspected = spawnSync('vercel', ['--non-interactive', '--scope', teamSlug, 'api', `/v13/deployments/${deploymentId}`, '--method', 'GET'], {
  encoding: 'utf8', timeout: 30_000, env: { ...process.env, VERCEL_TELEMETRY_DISABLED: '1' },
});
if (inspected.error) throw inspected.error;
if (inspected.status !== 0) throw new Error('Could not verify deployment metadata; no traffic sent.');
const raw = JSON.parse(inspected.stdout);
const deployment = raw.result ?? raw;
if (deployment.id !== deploymentId || deployment.projectId !== projectId ||
    deployment.target === 'production' || deployment.readyState !== 'READY' ||
    !/^[a-z0-9-]+\.vercel\.app$/.test(deployment.url ?? '')) {
  throw new Error('Deployment must be READY, belong to founders-directory, and have a non-production target; no traffic sent.');
}
const origin = `https://${deployment.url}`;
const headers = { 'x-fd-firewall-probe': key };
// Protection bypass is intentionally not accepted: use the protected-deployment
// access workflow if this preview requires authentication.
async function request(path, method = 'GET', marked = true) {
  const response = await fetch(`${origin}${path}`, { method, headers: marked ? headers : {}, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  await response.body?.cancel();
  console.log(`${method} ${path}: ${response.status}`);
  return response.status;
}
for (let index = 0; index < 5; index++) {
  const status = await request('/');
  if (index < 2 && (status < 200 || status >= 300)) throw new Error('Below-threshold request failed. Check Preview protection, stale counters, and application health.');
  if (index === 4 && status !== 429) throw new Error('No 429 above threshold. Verify published preview rule and rule-specific Firewall traffic.');
}
for (const [path, method, marked] of [['/robots.txt', 'GET', true], ['/', 'HEAD', true], ['/', 'GET', false]]) {
  const status = await request(path, method, marked);
  if (status === 429) throw new Error('Unrelated path, method, or unmarked navigation was rate limited.');
}
console.log('Bounded preview checks passed. Confirm the matching rule ID in Firewall traffic and absence of Function invocations for blocked requests.');

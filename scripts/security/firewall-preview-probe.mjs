import { spawnSync } from 'node:child_process';
import { projectId, teamId, teamSlug } from './firewall-rules.mjs';
import { vercelInvocation } from './vercel-cli.mjs';
import { previewDeployment, previewProbeRule, runPreviewProbe } from './firewall-preview.mjs';

// Metadata/config GETs precede at most eight application requests. No staging,
// publishing, retries, redirects, paid operations or Production traffic.
try {
  const deploymentId = process.argv[2];
  const key = process.env.FIREWALL_PROBE_KEY;
  if (process.argv.length !== 3 || !/^dpl_[A-Za-z0-9]+$/.test(deploymentId ?? '')) throw new Error('Pass one Preview deployment ID.');
  previewProbeRule({ url: 'validation-only.vercel.app' }, key);
  const { command, prefix } = vercelInvocation();
  function metadata(path) {
    const result = spawnSync(command, [...prefix, '--non-interactive', '--scope', teamSlug, 'api', path, '--method', 'GET'], {
      encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
      env: { ...process.env, VERCEL_TELEMETRY_DISABLED: '1' },
    });
    if (result.error || result.status !== 0) throw new Error('Could not verify Vercel metadata; no traffic sent.');
    try { return JSON.parse(result.stdout); }
    catch { throw new Error('Invalid Vercel metadata JSON; contents are not echoed and no traffic was sent.'); }
  }
  const deployment = previewDeployment(metadata(`/v13/deployments/${deploymentId}?teamId=${teamId}`), deploymentId);
  const snapshot = metadata(`/v1/security/firewall/config?projectId=${projectId}&teamId=${teamId}`);
  const result = await runPreviewProbe({ deployment, deploymentId, snapshot, key, bypass: process.env.VERCEL_AUTOMATION_BYPASS_SECRET });
  console.log(JSON.stringify(result));
  console.log('Request behavior passed; edge attribution remains unverified. Confirm the reported rule ID in Firewall traffic and absence of Function invocations for blocked requests.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Preview probe failed.');
  process.exitCode = 1;
}

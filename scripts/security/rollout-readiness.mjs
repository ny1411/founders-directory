import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { vercelInvocation } from './vercel-cli.mjs';

export const rolloutTarget = Object.freeze({
  projectId: 'prj_oxUZTfhN9aAIwtcABk8dcX00nFvt',
  projectName: 'foundersdirectory',
  teamId: 'team_uk1Ii5k2P5wcgjeFoxW9ojfC',
  teamSlug: 'ny1411',
});
const required = [
  'NEXT_PUBLIC_FIREBASE_API_KEY', 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', 'NEXT_PUBLIC_FIREBASE_APP_ID',
  'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY',
  'GEMINI_API_KEY', 'SALESHANDY_BASE_URL', 'SALESHANDY_API_KEY',
  'CONTACT_ENRICHMENT_QUEUE_SECRET',
];
const serverFlag = 'BOTID_ENFORCEMENT_ENABLED';
const clientFlag = 'NEXT_PUBLIC_BOTID_ENABLED';
function flag(entries, key) {
  const matching = entries.filter(entry => entry.key === key);
  if (!matching.length) return 'unset';
  if (matching.length !== 1 || matching[0].type !== 'plain') return 'unverified';
  return matching[0].value === 'true' ? 'enabled' : matching[0].value === 'false' ? 'disabled' : 'invalid';
}
function verifyProject(project) {
  if (project?.id !== rolloutTarget.projectId || project?.name !== rolloutTarget.projectName || project?.accountId !== rolloutTarget.teamId) {
    throw new Error('Project identity mismatch; no rollout readiness established.');
  }
}

/** Values stay in memory. Only fixed names, finite states and validated IDs leave this boundary. */
export function assessRollout(snapshot) {
  verifyProject(snapshot.project);
  if (!Array.isArray(snapshot.envs?.envs) || !snapshot.envs.envs.every(entry =>
    entry && typeof entry.key === 'string' && Array.isArray(entry.target))) {
    throw new Error('Environment metadata unavailable; no rollout readiness established.');
  }
  if (!Array.isArray(snapshot.deployments)) throw new Error('Deployment metadata unavailable.');
  if (!/^[a-f0-9]{40}$/.test(snapshot.expectedSha ?? '')) throw new Error('A full expected commit SHA is required.');
  const captured = new Date(snapshot.capturedAt);
  if (!Number.isFinite(captured.getTime())) throw new Error('Capture timestamp is required.');
  const environments = ['preview', 'production'].map(environment => {
    // Branch and custom-environment overrides must be checked for the exact deployment separately.
    const entries = snapshot.envs.envs.filter(entry => entry.target.includes(environment) && !entry.gitBranch && !entry.customEnvironmentIds?.length);
    const hidden = environment === 'production' && Number(snapshot.envs.hiddenProductionEnvCount) > 0;
    const flags = { server: flag(entries, serverFlag), client: flag(entries, clientFlag) };
    if (hidden) for (const key of Object.keys(flags)) if (flags[key] === 'unset') flags[key] = 'unverified';
    const effective = state => state === 'enabled' ? true : ['disabled', 'unset'].includes(state) ? false : null;
    const pair = Object.values(flags).some(state => ['invalid', 'unverified'].includes(state)) ? 'unverified'
      : effective(flags.server) !== effective(flags.client) ? 'mismatch'
        : effective(flags.server) ? 'enabled' : 'disabled';
    const deployment = snapshot.deployments.find(item =>
      (environment === 'production' ? item.target === 'production' : item.target === null || item.target === 'preview') &&
      (item.state ?? item.readyState) === 'READY' && item.meta?.githubCommitSha === snapshot.expectedSha &&
      (!item.projectId || item.projectId === rolloutTarget.projectId));
    const id = deployment?.id ?? deployment?.uid;
    return {
      environment,
      requiredVariables: required.map(key => ({ key, state: entries.some(entry => entry.key === key) ? 'configured_metadata_only' : hidden ? 'unverified' : 'missing' })),
      botId: { ...flags, pair, branchOverrides: snapshot.envs.envs.some(entry => entry.target.includes(environment) && Boolean(entry.gitBranch || entry.customEnvironmentIds?.length)) },
      enrichment: hidden && flag(entries, 'CONTACT_ENRICHMENT_ENABLED') === 'unset' ? 'unverified' : flag(entries, 'CONTACT_ENRICHMENT_ENABLED'),
      expectedDeployment: deployment && /^dpl_[A-Za-z0-9]+$/.test(id ?? '')
        ? { state: 'ready_metadata_only', id, sha: snapshot.expectedSha }
        : { state: 'unverified' },
    };
  });
  return {
    capturedAt: captured.toISOString(), target: rolloutTarget, expectedSha: snapshot.expectedSha,
    environments, readyForFlagRemoval: false,
    remainingEvidence: [
      'deployment_env_and_build_time_client_flag_pair', 'oidc_and_botid_human_browser_flows',
      'bot_rejection_zero_business_work', 'queue_signed_delivery_and_rejection',
      'firestore_deny_rules_and_ttl', 'firewall_preview_and_production_rollout',
      'alert_delivery_and_incident_exercise', 'production_monitoring_window',
    ],
  };
}

export function collectRollout(expectedSha, run = spawnSync) {
  const { command, prefix } = vercelInvocation();
  const api = path => {
    const result = run(command, [...prefix, '--non-interactive', '--scope', rolloutTarget.teamSlug,
      'api', path, '--method', 'GET'], { encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
    // CLI errors can include headers or remote values. Never forward either output stream.
    if (result.error || result.status !== 0) throw new Error('Read-only Vercel metadata request failed. Verify CLI access and target scope.');
    try { const parsed = JSON.parse(result.stdout); return parsed.result ?? parsed; }
    catch { throw new Error('Invalid Vercel metadata response.'); }
  };
  const query = `teamId=${rolloutTarget.teamId}`;
  const project = api(`/v9/projects/${rolloutTarget.projectId}?${query}`);
  verifyProject(project); // Never continue reads against a different project.
  const envs = api(`/v10/projects/${rolloutTarget.projectId}/env?${query}&decrypt=false`);
  const deployments = api(`/v6/deployments?${query}&projectId=${rolloutTarget.projectId}&limit=20`);
  return { project, envs, deployments: deployments.deployments, expectedSha, capturedAt: new Date().toISOString() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    let snapshot;
    if (args.length === 3 && args[0] === '--live' && args[1] === '--expected-sha' && /^[a-f0-9]{40}$/.test(args[2])) {
      snapshot = collectRollout(args[2]);
    } else if (args.length === 2 && args[0] === '--input') {
      snapshot = JSON.parse(readFileSync(args[1], 'utf8'));
    } else throw new Error('Usage: rollout-readiness.mjs --live --expected-sha <40-hex SHA> | --input <local snapshot.json>');
    console.log(JSON.stringify(assessRollout(snapshot), null, 2));
  } catch {
    console.error('Rollout metadata check failed. Verify arguments, exact project identity, metadata schema, and CLI access. No readiness established.');
    process.exitCode = 2;
  }
}

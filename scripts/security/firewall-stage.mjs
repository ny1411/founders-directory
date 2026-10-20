import { spawnSync } from 'node:child_process';
import { addRuleArgs, missingRules, observationRules, projectId, teamId, teamSlug } from './firewall-rules.mjs';
import { vercelInvocation } from './vercel-cli.mjs';

// Default is a local plan. Only --stage writes drafts; there is intentionally no
// publish, discard, attack-mode, system-mitigation or full-config PUT path.
const stage = process.argv.slice(2);
if (stage.length && (stage.length !== 1 || stage[0] !== '--stage')) {
  throw new Error('Usage: node scripts/security/firewall-stage.mjs [--stage]');
}
if (!stage.length) {
  console.log(JSON.stringify({ projectId, teamId, stageOnly: true, rules: observationRules() }, null, 2));
} else {
  const { command, prefix } = vercelInvocation();
  function cli(args) {
    const result = spawnSync(command, [...prefix, ...args], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, VERCEL_TELEMETRY_DISABLED: '1' } });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`CLI exited ${result.status}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim());
    return result.stdout;
  }
  const scope = ['--non-interactive', '--scope', teamSlug];
  // Inspect both versions in a single read. Never guess that auth/plan failures
  // mean an empty config. The unversioned GET returns active + draft configs.
  const config = JSON.parse(cli([...scope, 'api', `/v1/security/firewall/config?projectId=${projectId}&teamId=${teamId}`, '--method', 'GET']));
  const data = config.result ?? config;
  if (!Object.hasOwn(data, 'active') && !Object.hasOwn(data, 'draft')) {
    throw new Error('Unexpected config response; inspect with vercel firewall overview before staging.');
  }
  const existing = (data.draft ?? data.active)?.rules ?? [];
  const rules = missingRules(existing);
  console.log(`Preserving ${existing.length} existing rules; staging ${rules.length} observation rules.`);
  for (const rule of rules) {
    try { console.log(cli(addRuleArgs(rule))); }
    catch (error) {
      if (error.message.includes('Rate limiting is not available for this plan (401)')) {
        throw new Error(`Could not stage ${rule.name}: Vercel rejected rate limiting for this plan (401). Stop here; retrying or publishing will not add the remaining rules. The existing published homepage observation rule is unchanged. Check the project's Firewall plan entitlement before attempting Preview 429 tests or Production enforcement.`);
      }
      throw new Error(`Could not stage ${rule.name}: ${error.message}`);
    }
  }
  console.log(cli([...scope, 'firewall', 'rules', 'list', '--project', projectId, '--expand', '--json']));
  console.log(cli([...scope, 'firewall', 'diff', '--project', projectId, '--json']));
  console.log('Draft only. Owner must inspect every rule and review the complete draft before publishing.');
}

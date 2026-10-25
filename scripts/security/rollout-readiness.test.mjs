import assert from 'node:assert/strict';
import test from 'node:test';
import { assessRollout, collectRollout, rolloutTarget } from './rollout-readiness.mjs';

const sha = 'a'.repeat(40);
function fixture() {
  return {
    capturedAt: '2026-10-25T13:10:00.000Z', expectedSha: sha,
    project: { id: rolloutTarget.projectId, name: rolloutTarget.projectName, accountId: rolloutTarget.teamId },
    envs: { envs: [
      { key: 'BOTID_ENFORCEMENT_ENABLED', target: ['preview', 'production'], type: 'plain', value: 'false' },
      { key: 'NEXT_PUBLIC_BOTID_ENABLED', target: ['preview', 'production'], type: 'plain', value: 'false' },
      { key: 'GEMINI_API_KEY', target: ['production'], type: 'sensitive', value: 'PRIVATE_DO_NOT_PRINT' },
    ] },
    deployments: [{ id: 'dpl_Example', target: 'production', state: 'READY', meta: { githubCommitSha: sha } }],
  };
}
test('inventory never claims runtime protection or exposes any secret or unrelated metadata', () => {
  const input = fixture();
  input.project.secret = 'PROJECT_SECRET';
  input.deployments[0].meta.private = 'METADATA_SECRET';
  const report = assessRollout(input);
  assert.equal(report.readyForFlagRemoval, false);
  assert.equal(report.environments[1].botId.pair, 'disabled');
  assert.equal(report.environments[1].expectedDeployment.state, 'ready_metadata_only');
  assert.equal(report.environments[0].expectedDeployment.state, 'unverified');
  assert.equal(report.environments[1].requiredVariables.find(item => item.key === 'GEMINI_API_KEY').state, 'configured_metadata_only');
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_DO_NOT_PRINT|PROJECT_SECRET|METADATA_SECRET/);
});
test('mismatched project, incomplete metadata and missing expected SHA fail closed', () => {
  for (const change of [x => x.project.id = 'wrong', x => x.project.accountId = 'wrong', x => delete x.envs,
    x => delete x.deployments, x => x.expectedSha = 'main', x => delete x.capturedAt]) {
    const input = fixture(); change(input); assert.throws(() => assessRollout(input));
  }
});
test('unpaired flags, encrypted flags and branch overrides cannot establish an enabled pair', () => {
  const input = fixture();
  input.envs.envs[0].value = 'true';
  assert.equal(assessRollout(input).environments[0].botId.pair, 'mismatch');
  input.envs.envs[1].type = 'encrypted';
  assert.equal(assessRollout(input).environments[0].botId.pair, 'unverified');
  input.envs.envs[1].type = 'plain'; input.envs.envs[1].value = 'true';
  input.envs.envs[0].gitBranch = 'some-branch';
  const config = assessRollout(input).environments[0].botId;
  assert.equal(config.branchOverrides, true);
  assert.equal(config.server, 'unset');
  assert.equal(config.pair, 'mismatch');
});
test('hidden production variables are unknown and a different release is not a ready deployment', () => {
  const input = fixture(); input.envs.hiddenProductionEnvCount = 2;
  input.deployments[0].meta.githubCommitSha = 'b'.repeat(40);
  const report = assessRollout(input);
  assert.equal(report.environments[1].requiredVariables.find(item => item.key === 'FIREBASE_PRIVATE_KEY').state, 'unverified');
  assert.equal(report.environments[0].requiredVariables.find(item => item.key === 'FIREBASE_PRIVATE_KEY').state, 'missing');
  assert.equal(report.environments[1].expectedDeployment.state, 'unverified');
});
test('collector issues only scoped GETs without decrypting and stops on a wrong project', () => {
  const input = fixture(), calls = [];
  const run = (_command, args) => {
    calls.push(args);
    return { status: 0, stdout: JSON.stringify(calls.length === 1 ? input.project : calls.length === 2 ? input.envs : { deployments: input.deployments }) };
  };
  assert.equal(assessRollout(collectRollout(sha, run)).environments[1].botId.pair, 'disabled');
  assert.equal(calls.length, 3);
  assert.ok(calls.every(args => args.at(-1) === 'GET' && args.includes('ny1411') && args.some(arg => arg.includes(rolloutTarget.teamId))));
  assert.ok(calls[1].some(arg => arg.includes('decrypt=false')));
  let count = 0;
  assert.throws(() => collectRollout(sha, () => { count++; return { status: 0, stdout: '{"id":"wrong"}' }; }));
  assert.equal(count, 1);
  assert.throws(() => collectRollout(sha, () => ({ status: 1, stderr: 'SECRET' })), error => !error.message.includes('SECRET'));
});

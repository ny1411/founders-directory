# Rollout readiness for #47

The application repository is `ny1411/founders-directory`. The verified Vercel
project name is **`foundersdirectory`**, project ID
`prj_oxUZTfhN9aAIwtcABk8dcX00nFvt`, in team `ny1411`
(`team_uk1Ii5k2P5wcgjeFoxW9ojfC`). The older project name/ID in the original
issue is not the current target. Do not create another project or use an old ID.

## What is established

A read-only connector inspection on **25 October 2026** established:

| Item | Observed metadata | What this does not prove |
| --- | --- | --- |
| Project | Correct project ID, owner and `nextjs` framework | Every production request is healthy |
| Production build | `dpl_8frnxGAiFPfNWmqLGE7r1znyiup1` is READY at merged commit `72ea48538fc740b0bcadac8c37e8b0c803310482` | Auth, BotID, Queue delivery, or Firestore permissions work |
| Preview build | `dpl_FEfw4ybtj68Y5ej6vjgRtzsmPknv` is READY at PR head `88de8a5090212dc1128fcd931a5d7c45a05d91bf` | That Preview runs the exact merge commit |
| Firebase, Gemini, Saleshandy, Queue secret | Required variable names are configured for both Preview and Production | Values are correct, accessible by a deployment, or authorized by providers |
| BotID flags | Both server and client flags remain disabled in Preview and Production | BotID human/rejection flows have been tested |
| Enrichment | Feature remains disabled in both environments | Queue consumer delivery is ready to enable |

No variable value or credential is recorded here. Existing metadata must be
checked again before changing settings. Repository CI, a READY deployment and
configuration presence are separate kinds of evidence.

## Repeat the inventory safely

`scripts/security/rollout-readiness.mjs` reads only Vercel metadata. It issues
three bounded GETs, validates the project ID/name/team before continuing, requests
environment metadata with `decrypt=false`, and prints only fixed variable names,
finite status codes, validated deployment IDs and the expected commit SHA. It
never echoes CLI errors, raw environment values, provider responses or the raw
project object. It does not fetch application URLs or invoke paid providers.

With an already authenticated Vercel CLI installed:

```bash
node scripts/security/rollout-readiness.mjs --live --expected-sha 72ea48538fc740b0bcadac8c37e8b0c803310482
```

This uses `vercel api` because the report needs structured project ownership,
variable target/type metadata and exact deployment commit metadata together.
Every request pins the verified team and project; it does not depend on a local
link or initiate linking/login. The CLI must already be installed and
authenticated. The live CLI collector was covered with injected responses; the
current account evidence above came from the connected Vercel tools.

An operator can also pass a **local, uncommitted** snapshot:

```bash
node scripts/security/rollout-readiness.mjs --input /tmp/rollout-input.json
node --test scripts/security/rollout-readiness.test.mjs
```

The snapshot contains `capturedAt` (ISO timestamp), `expectedSha` (full SHA),
`project` (`id`, `name`, `accountId`), `envs` (`envs` array and optional
`hiddenProductionEnvCount`), and a `deployments` array. Environment entries need
only `key`, `type`, `target`, optional override metadata, and a plain value for
the three boolean flags. Omit all credential values. Do not commit raw API
exports or snapshots. Deployment entries need `id`, `target`, `state`, and
`meta.githubCommitSha`. The live scan checks at most 20 recent deployments;
missing exact-commit evidence means **unverified**, not proof no deployment exists.

Exit 0 means the metadata report completed, **not** that rollout passed.
Exit 2 means invalid inputs, schema, identity or access; no readiness is
established. `readyForFlagRemoval` deliberately remains false because these reads
cannot prove the external acceptance criteria. A branch/custom-environment
override requires inspecting the exact deployment separately. Project flags do
not establish the client flag frozen into an older build.

## Remaining work, in order

1. Verify actual deployment environment/build configuration, OIDC and BotID proxy
   paths. Enable the paired flags only in an approved Preview deployment, then
   exercise human, missing/malformed proof and provider-error cases using the
   [BotID runbook](vercel-bot-protection.md). Assert rejected requests perform no
   business Firestore, Queue, Gemini or Saleshandy work. Review mobile and desktop
   behavior; do not use paid calls merely as probes.
2. Verify signed Queue v2 direct-payload delivery and the rejection cases in #47.
   Preserve `CONTACT_ENRICHMENT_ENABLED` until the consumer and all prerequisites
   are proven. A configured Queue secret name is not that proof.
3. Inspect deployed deny rules and collection-group TTL policy independently.
   TTL activation and legacy-data migration need their separate retention review;
   this inventory neither deploys rules nor deletes data.
4. Complete [Firewall](vercel-firewall-rate-limits.md) observation, plan access and
   Preview validation. A log-only rule is not edge enforcement.
5. Complete [monitoring and incident readiness](vercel-usage-incident.md), including
   delivery to a monitored destination, the incident exercise and production
   watch. Record the actual owner and unassigned backup coverage honestly.
6. Promote validated protection through the documented staged rollout and record
   browser, deployment, rule and monitoring evidence. Only then remove the
   temporary BotID gates in a separate tested code change, preserving a paired
   client/server rollback procedure. Do not remove the gates just because this
   inventory or repository CI passes.

#47 stays open until that operational evidence exists. This change adds the
read-only inventory and records current blockers; it does not change deployed
settings, enable features, activate TTL, send notifications or prove completion.

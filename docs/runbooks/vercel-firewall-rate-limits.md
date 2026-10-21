# Vercel Firewall rate limits (#35, #40)

Project: `founders-directory` (`prj_oxUZTfhN9aAIwtcABk8dcX00nFvt`), team `ny1411` (`team_uk1Ii5k2P5wcgjeFoxW9ojfC`).

## Current rollout status

October 20, 2026: the owner published `FD #35 observe homepage`, a
Production-only `GET /` rate-limit observation rule with exceeded action `log`.
Managed Bot Protection remains in challenge mode. The next `FD #40` rule failed
to stage with `Rate limiting is not available for this plan (401)`; `firewall
diff` then reported no pending changes. No Preview rate-limit rule or 429 test
has been published. Inspect the current configuration before taking action,
because the owner may change it.

Read-only recheck on **October 21, 2026** confirmed only `FD #35 observe
homepage` active at 100 requests / 600 seconds with exceeded action `log`.
There is no active API rate-limit enforcement. Both BotID flags remain
explicitly `false` in Preview and Production; #47 retains the verified-human
rollout and later removal of the temporary gates. #59 extends repository
coverage and diagnostics only; no Firewall or environment setting was changed.

**Plan blocker:** do not rerun `--stage`, add the Preview probe rule, switch the
homepage rule to `rate_limit`, or expect an edge 429 until Vercel confirms this
project can create and edit rate-limit rules. The already published log-only
rule does not return 429. Ask Vercel which entitlement or plan is required;
do not assume the existing rule can be edited simply because it was accepted
earlier. Continue monitoring Bot Protection, Attack Mode, Function usage, and
application-level quotas while resolving the entitlement. The remaining
`FD #40` rules are proposed configuration, not active protection.

The connector's update operation targets `PATCH /v1/security/firewall/config`, while the CLI implements safe draft staging as `PATCH /v1/security/firewall/config/draft`. Do not substitute the connector update or a whole-config PUT for draft staging: that could change the active managed Bot Protection settings. These repository artifacts are ready for an authenticated operator; they do not themselves protect production.

## Observation thresholds

All entries use a 600-second fixed window, counting by IP, scoped to Production. The exceeded action is `log`. The homepage threshold starts at issue #35's suggested 100 requests per 10 minutes; API thresholds are issue #40's proposed starting points. Tune against legitimate traffic and shared-IP users before enforcement. Counters are per Vercel region, so they are not a global spending cap.

| Request | Requests / 10 minutes | Candidate enforcement after review |
| --- | ---: | --- |
| `GET /` (exact) | 100 | 429; challenge repeated automation |
| `GET` or `HEAD /company/*` | 120 | Challenge after crawler/link-preview review |
| `POST /api/enrich-contact` | 10 | 429 |
| `GET` or `HEAD /api/enrich-contact/*` job status | 120 | 429 |
| `POST /api/generate-dm` | 20 | 429 |
| `POST /api/extract-resume` | 10 | 429 |
| `POST /api/onboarding` | 120 | 429 after autosave review |
| `GET` or `HEAD /api/onboarding` | 120 | 429 |
| `POST /api/auth/sync` | 30 | 429 |
| `GET` or `HEAD /api/profile` | 120 | 429 |
| `PATCH` or `POST /api/profile` (shared budget) | 30 | 429 |
| `GET` or `HEAD /api/directory` | 60 | 429 |
| `GET` or `HEAD /_next/image` (exact) | 300 | 429 after image/navigation review |
| `POST /*` with Server Action metadata or `Next-Action` header | 30 | 429 after company submission review |

`scripts/security/firewall-rules.mjs` is the source of truth. The homepage rule is named `FD #35 observe homepage`; the other rules retain `FD #40` names. The directory endpoint introduced in #36 has its own bucket. Queue callbacks and static assets are excluded. Do not add a broad `/api/*` quota, spoofable user-agent whitelist, Android/Chrome Mobile deny, or shared-JA4 deny. Authentication, durable per-user quotas, deduplication, and provider budgets from #38 remain necessary against distributed traffic. See [traffic-abuse.md](traffic-abuse.md) for the incident response checklist.

If the older `FD #40 observe homepage` rule was previously staged or published,
the staging script stops. Inspect its existing action and conditions, then
deliberately migrate or remove it through a reviewed draft before staging
`FD #35 observe homepage`; two overlapping homepage limits would be confusing.

The API matrix includes Next's implicit HEAD handler for every exported GET.
The existing homepage rule remains GET-only to preserve its published shape.
The image threshold is a generous observation starting point, not a validated
safe value; image-source restrictions remain the separate P2 #69 work.

Server Action OR groups each include Production, POST, and path-prefix `/`.
The native `server_action` existence condition covers Vercel-classified actions
such as progressive multipart forms; a separate `Next-Action` header existence
condition covers the installed Next 15 imported-action transport. Next posts
to the current canonical URL, so restricting only to `/company/new` would leave
replays at other URLs outside this observation bucket. Ordinary POST requests
without action metadata do not match. Spoofed metadata can consume this IP
bucket but never bypass origin authentication, BotID, authorization or quotas.
The sole legitimate company-action UI is `/company/new`, which is included in
the browser challenge policy. Signed `/api/queues/enrich-contact` callbacks
are intentionally outside browser BotID and this IP quota, retaining signed
envelope verification and durable worker limits.

`firewall-rules.test.mjs` discovers actual route exports and checks every API
method and implicit HEAD against this matrix, with that signed Queue exclusion.
It also verifies both action OR groups survive CLI serialization and that the
current Next transport uses the canonical URL. These are local coverage tests;
live `server_action` classification, entitlement, draft validation, traffic,
edge 429 evidence and false-positive review still belong to #40.

## Stage and inspect

Install/authenticate Vercel CLI 64.5.0 or newer with access to team `ny1411`. Use a scoped token or `vercel login` in your own terminal. Do not commit tokens or CLI credentials.
On Windows, use the current PR branch: the staging and Preview probe scripts
launch npm's `vercel.cmd` package through Node so JSON conditions are passed
without a shell. If you saw `spawnSync vercel ENOENT`, pull the latest branch
commit and rerun; that error occurred before any draft was staged.

```bash
node --test scripts/security/firewall-rules.test.mjs
node scripts/security/firewall-stage.mjs
vercel --scope ny1411 firewall overview --project prj_oxUZTfhN9aAIwtcABk8dcX00nFvt --json
vercel --scope ny1411 firewall diff --project prj_oxUZTfhN9aAIwtcABk8dcX00nFvt --json
node scripts/security/firewall-stage.mjs --stage
```

The default script only prints the proposed rules. `--stage` reads active/draft configuration, preserves all existing settings and unrelated rules, skips identical named rules, and refuses to overwrite a conflicting rule (including a tuned/enforced version). Native noninteractive `rules add --yes` stages drafts without publishing. It stops on authentication, entitlement, schema, or unexpected-response errors. If the project's config remains missing, initialize it in Vercel's Firewall UI, then rerun; do not overwrite unknown configuration to get past a 404. A partial batch is safe to rerun after inspection. The confirmed plan error above blocks further rate-limit staging; resolve it with Vercel before using this command again.

Inspect every generated rule and the **entire** draft, including unrelated changes. For example:

```bash
vercel --scope ny1411 firewall rules inspect "FD #35 observe homepage" --project prj_oxUZTfhN9aAIwtcABk8dcX00nFvt --json
vercel --scope ny1411 firewall rules list --project prj_oxUZTfhN9aAIwtcABk8dcX00nFvt --expand --json
vercel --scope ny1411 firewall diff --project prj_oxUZTfhN9aAIwtcABk8dcX00nFvt --json
```

Only the project owner publishes the reviewed observation draft:

```bash
vercel --scope ny1411 firewall publish --project prj_oxUZTfhN9aAIwtcABk8dcX00nFvt --yes
```

Resume the paused project only as an explicit owner operation after protections and caching are ready. Collect representative traffic before moving to enforcement. Record each rule ID and open `https://vercel.com/ny1411/founders-directory/firewall/traffic?filter=<ruleId>`.

## Observe, validate in Preview, then enforce

For each rule, inspect matches by IP, JA4, ASN, country, verified/unknown bot classification, user agent, path and method. Compare total hits, distinct IPs, request rate, user reports, Function invocations and Active CPU. Preserve verified crawlers, link unfurlers, shared networks, signed-in navigation, onboarding saves and profile requests. A lack of matches on a paused project is not evidence that a threshold is safe.

```bash
vercel --scope ny1411 firewall traffic list --project prj_oxUZTfhN9aAIwtcABk8dcX00nFvt --since 1h --json
vercel --scope ny1411 firewall alerts list --project prj_oxUZTfhN9aAIwtcABk8dcX00nFvt --since 1h --json
vercel --scope ny1411 firewall traffic inspect rule <ruleId> --project prj_oxUZTfhN9aAIwtcABk8dcX00nFvt --since 1h --group-by ip --json
```

Keep Production observation rules intact. Add a **separate** Preview rule with the same method/path and candidate action, `environment = preview`, and a unique secret probe header condition. For a bounded homepage test, use `GET /`, key `ip`, window 60 seconds, limit 3, exceeded action `rate_limit`, plus `header x-fd-firewall-probe = <random 32+ character value>`. Never use a production URL or production limits to generate load. Inspect its conditions/diff, have the owner publish, and use a fresh header value so previous counters cannot affect the run.

```bash
# Set FIREWALL_PROBE_KEY locally to the exact secret value in the Preview rule.
# If Vercel Authentication protects the deployment, set
# VERCEL_AUTOMATION_BYPASS_SECRET from the approved Preview CI secret store.
# Pass a READY Preview deployment ID from Vercel, never its production ID.
node scripts/security/firewall-preview-probe.mjs dpl_PREVIEW_DEPLOYMENT_ID
```

The probe verifies deployment ownership and non-production target through Vercel's API before sending at most eight sequential GET/HEAD requests. It checks below/above-threshold responses and unrelated method/path/unmarked traffic. Redirects are not followed. If Vercel Authentication blocks the preview, create a narrowly scoped automation bypass in Deployment Protection and supply its secret through the local environment or CI secret store. The script sends the bypass only to the verified Preview deployment and never prints it. Do not disable deployment protection or use this secret against Production; the bypass does not bypass application BotID. Validate each expensive endpoint's rule separately with unauthenticated/invalid requests or mocked providers in Preview; never spend real enrichment credits or AI quota to test a firewall. Check the rule ID in Firewall traffic and confirm requests blocked at the edge did not invoke Functions; an application-generated 429 alone does not prove edge enforcement. Real verified-crawler behavior requires traffic review; spoofing a Googlebot user agent is insufficient.

After Preview verification **and** owner review of Production observations, stage the Production exceeded action change to `rate_limit` (or company-page `challenge`) with `rules edit`, retaining every environment/method/path condition. Inspect each rule and complete diff again, then have the owner publish. Do not tighten thresholds at the same time as first enforcing. Monitor for 24 hours and record CPU trends, unexpected 429/challenges and reports from legitimate users. Remove/disable temporary preview probe rules through a reviewed draft after testing.

## Rollback and emergency response

Prefer changing the affected rate limit's exceeded action back to `log`; this preserves monitoring. Disabling a named rule is the alternative. Never discard unrelated drafts.

```bash
vercel --scope ny1411 firewall rules edit "FD #35 observe homepage" --project prj_oxUZTfhN9aAIwtcABk8dcX00nFvt --rate-limit-action log --yes
vercel --scope ny1411 firewall diff --project prj_oxUZTfhN9aAIwtcABk8dcX00nFvt
# Owner reviews and publishes rollback.
vercel --scope ny1411 firewall publish --project prj_oxUZTfhN9aAIwtcABk8dcX00nFvt --yes
```

For an active attack, the owner may run `vercel --scope ny1411 firewall attack-mode enable --project prj_oxUZTfhN9aAIwtcABk8dcX00nFvt --duration 1h --yes` interactively. This immediately challenges unverified visitors; it is not a staging command. Automatic platform DDoS mitigation stays enabled. Never pause system mitigations or add broad IP/header bypasses. Firewall-blocked/challenged/rate-limited traffic does not invoke Functions; traffic served before mitigation or remaining only in log mode can still incur usage.

## Completion evidence

Keep #40 open until rule IDs/diff, owner observation publication, representative traffic review, Preview edge enforcement evidence, Production enforcement publication, crawler/navigation checks, rollback readiness, and 24-hour Function/CPU monitoring are recorded. Repository tests and staging artifacts alone do not satisfy those operational criteria.

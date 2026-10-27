# Vercel Firewall rate limits (#35, #40)

Vercel project: `foundersdirectory` (`prj_oxUZTfhN9aAIwtcABk8dcX00nFvt`), repository `ny1411/founders-directory`, team `ny1411` (`team_uk1Ii5k2P5wcgjeFoxW9ojfC`).

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

Read-only recheck on **25 October 2026** used the Vercel connector with the
explicit project/team IDs above. Active configuration version **2**, last
updated `2026-10-20T06:36:51.860Z`, still has the sole homepage observation rule
`rule_fd_35_observe_homepage_7Zngke`; managed Bot Protection is active with
`challenge`. Comparing that active snapshot against the 16 repository rules
reports **1 observation, 15 missing, 0 enforcement configured**. This includes
the newer founder-contact, CSP-report, image and Server Action rules. A draft
or a rule in repository source does not cover deployed traffic. The read-only
recheck does not retest the earlier plan denial or prove BotID flag values.

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
| `POST /api/founder-contact` | 60 | 429 |
| `POST /api/csp-report` | 120 | 429 |
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

## Read-only coverage audit

Before staging or changing anything, save a fresh configuration response locally
and compare its **active** version with the repository manifest:

```bash
vercel --non-interactive --scope ny1411 api '/v1/security/firewall/config?projectId=prj_oxUZTfhN9aAIwtcABk8dcX00nFvt&teamId=team_uk1Ii5k2P5wcgjeFoxW9ojfC' --method GET > /tmp/founders-firewall-config.json
node scripts/security/firewall-audit.mjs /tmp/founders-firewall-config.json
node --test scripts/security/firewall-audit.test.mjs
```

Alternatively, save the JSON result of the connector's `get_firewall_config`
with `configVersion=active` and the explicit project/team IDs. This avoids any
CLI linking or authentication changes. The audit itself makes no network
requests and never stages, publishes, retries denied plan operations, or writes
configuration. Do not commit raw configuration snapshots; unrelated rules can
contain private IP addresses or header values. Its output keeps only fixed rule
names, coverage states, the known project/team IDs and configuration metadata.
Input is limited to 1 MiB. API errors, a draft-only snapshot, missing identity,
and another project's configuration fail instead of being treated as empty.

| State | Meaning and next step |
| --- | --- |
| `missing` | No active-snapshot rule has the expected name; verify manually before planning a draft. |
| `observation` | The expected environment, methods, paths and rate policy are present with exceeded action `log`; requests are not rate limited by this rule. |
| `enforcement_configured` | The same structural policy has exceeded action `rate_limit`, `challenge` or `deny`; Preview behavior, legitimate traffic and live edge enforcement still need evidence. |
| `disabled` | The Firewall or matching rule is disabled. |
| `invalid` | The matching rule is not positively active or the API marks it invalid. |
| `drift` | Scope, threshold, counting policy, action or persistence differs; inspect the complete active rule rather than overwriting tuned settings. |
| `conflict` | The expected name occurs more than once; inspect duplicate rules. |
| `order_review` | An earlier potentially terminal rule may affect evaluation; inspect its conditions, priority and bypass behavior. |

The checker compares exact named structural coverage, not arbitrary WAF
expressions. Reordered AND/OR conditions and optional API null defaults are
accepted. Renamed equivalent rules remain `missing`, and earlier terminal rules
conservatively require review even when their paths may be unrelated. It does
not simulate managed rules, IP blocks, live classification, regional counters,
plan entitlement, threshold safety or actual request behavior. Exit status zero
means a report was produced, **not** that protection passed; the report always
leaves `readyToCloseIssue40=false`. Review the explicit counts and follow the
staged rollout below. Do not close #40 until its operational acceptance evidence
is complete.

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

Keep Production observation rules intact. Add a **separate** rule named exactly
`FD #40 preview homepage probe`, with `environment = preview`, `host` equal to
the immutable Preview deployment hostname, `method = GET`, `path = /`, and
`header x-fd-firewall-probe = <random 32–128 URL-safe characters>`; all five
conditions use exact equality in one AND group. Use key `ip`, algorithm
`fixed_window`, window 60 seconds, limit 3 and exceeded action `rate_limit`.
`previewProbeRule()` in `scripts/security/firewall-preview.mjs` defines that
exact candidate. Never use a production URL or production limits to generate
load. Inspect its conditions/diff and have the owner publish. Start with unused
rule counters or wait out the window; a new secret header value alone does not
prove that the rule's per-IP counters reset. Keep the header and bypass secret
out of committed config, terminal transcripts and shared artifacts.

```bash
# Set FIREWALL_PROBE_KEY locally to the exact secret value in the Preview rule.
# If Vercel Authentication protects the deployment, set
# VERCEL_AUTOMATION_BYPASS_SECRET from the approved Preview CI secret store.
# Pass a READY Preview deployment ID from Vercel, never its production ID.
node scripts/security/firewall-preview-probe.mjs dpl_PREVIEW_DEPLOYMENT_ID
```

The probe verifies the READY deployment ID/project/Preview target and the
explicit team's **active** Firewall configuration before sending traffic. It
requires the one valid, active probe rule to match the exact hostname, secret,
method, path, environment and rate policy above. Draft-only rules, duplicate
names, scope/threshold drift, disabled protection and earlier potentially
terminal custom rules stop without application requests. CLI reads pin team
and project IDs, bound metadata output, and do not echo raw errors or secrets.

The probe sends at most eight sequential GET/HEAD requests, with no retries or
redirect following: three unrelated path/method/unmarked controls must each
return 2xx, then three marked requests must return 2xx and two must return 429.
Auth redirects, denied controls and Security Checkpoint 429s fail the probe;
they are not healthy navigation or rate-limit evidence. A run taking a full
rate window is inconclusive, as are counter/window/region changes. No response
bodies are retained. Local regression tests exercise these cases without
network traffic and run in the existing Firewall test suite.

If Vercel Authentication blocks Preview, supply an approved narrowly scoped
automation bypass secret through the local environment or CI secret store.
The script sends it only to the verified Preview deployment and never prints
it. Do not disable deployment protection, managed Bot Protection or BotID to
make a probe pass. Validate each expensive endpoint's rule separately with
unauthenticated/invalid requests or mocked providers in Preview; never spend
real enrichment credits or AI quota to test a firewall. Even a passing probe
reports `edgeAttributionVerified=false`: corroborate the reported rule ID in
Firewall traffic and verify no Function invocation for the blocked requests.
An application-generated 429 or managed challenge can otherwise be mistaken
for the candidate's rate limit. Real verified-crawler behavior requires
traffic review; spoofing a Googlebot user agent is insufficient.

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

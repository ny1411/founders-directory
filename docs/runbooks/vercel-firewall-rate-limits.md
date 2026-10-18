# Vercel Firewall rate limits (#40)

Project: `founders-directory` (`prj_JeyY6SRrW4LOOSA3ggJceREyAHUQ`), team `ny1411` (`team_uk1Ii5k2P5wcgjeFoxW9ojfC`).

## Current rollout status

On October 18, 2026, the authenticated Vercel connector confirmed the project and returned `404 Config not found` for **both** active and draft firewall configuration. Vercel CLI 64.5.0 is available via npm, but the execution environment has no Vercel CLI credentials; the read-only overview command failed with `No existing credentials found` and a failed login fetch. No firewall rules have been staged or published by this change. No live enforcement, preview burst test, project resume, or 24-hour observation has been performed.

The connector's update operation targets `PATCH /v1/security/firewall/config`, while CLI 64.5.0 implements safe draft staging as `PATCH /v1/security/firewall/config/draft`. Do not substitute the connector update or a whole-config PUT for draft staging. These repository artifacts are ready for an authenticated operator; they do not themselves protect production.

## Observation thresholds

All entries use a 600-second fixed window, counting by IP, scoped to Production. The exceeded action is `log`. These are issue #40's proposed starting points; tune against legitimate traffic and shared-IP users before enforcement. Counters are per Vercel region, so they are not a global spending cap.

| Request | Requests / 10 minutes | Candidate enforcement after review |
| --- | ---: | --- |
| `GET /` (exact) | 60 | 429; challenge repeated automation |
| `GET /company/*` | 120 | Challenge after crawler/link-preview review |
| `POST /api/enrich-contact` | 10 | 429 |
| `GET /api/enrich-contact/*` job status | 120 | 429 |
| `POST /api/generate-dm` | 20 | 429 |
| `POST /api/extract-resume` | 10 | 429 |
| `POST /api/onboarding` | 120 | 429 after autosave review |
| `POST /api/auth/sync` | 30 | 429 |
| `GET /api/profile` | 120 | 429 |
| `PATCH` or `POST /api/profile` (shared budget) | 30 | 429 |
| `GET /api/directory` | 60 | 429 |

`scripts/security/firewall-rules.mjs` is the source of truth. The directory endpoint introduced in #36 has its own bucket. Queue callbacks and static assets are excluded. Do not add a broad `/api/*` quota, spoofable user-agent whitelist, Android/Chrome Mobile deny, or shared-JA4 deny. Authentication, durable per-user quotas, deduplication, and provider budgets from #38 remain necessary against distributed traffic.

## Stage and inspect

Install/authenticate Vercel CLI 64.5.0 or newer with access to team `ny1411`. Use a scoped token or `vercel login` in your own terminal. Do not commit tokens or CLI credentials.

```bash
node --test scripts/security/firewall-rules.test.mjs
node scripts/security/firewall-stage.mjs
vercel --scope ny1411 firewall overview --project prj_JeyY6SRrW4LOOSA3ggJceREyAHUQ --json
vercel --scope ny1411 firewall diff --project prj_JeyY6SRrW4LOOSA3ggJceREyAHUQ --json
node scripts/security/firewall-stage.mjs --stage
```

The default script only prints the proposed rules. `--stage` reads active/draft configuration, preserves all existing settings and unrelated rules, skips identical named rules, and refuses to overwrite a conflicting rule (including a tuned/enforced version). Native noninteractive `rules add --yes` stages drafts without publishing. It stops on authentication, entitlement, schema, or unexpected-response errors. If the project's config remains missing, initialize it in Vercel's Firewall UI, then rerun; do not overwrite unknown configuration to get past a 404. A partial batch is safe to rerun after inspection. Check rule quotas/plan entitlements if adding eleven rules is rejected; upgrade or deliberately select priorities rather than silently replacing existing protections.

Inspect every generated rule and the **entire** draft, including unrelated changes. For example:

```bash
vercel --scope ny1411 firewall rules inspect "FD #40 observe homepage" --project prj_JeyY6SRrW4LOOSA3ggJceREyAHUQ --json
vercel --scope ny1411 firewall rules list --project prj_JeyY6SRrW4LOOSA3ggJceREyAHUQ --expand --json
vercel --scope ny1411 firewall diff --project prj_JeyY6SRrW4LOOSA3ggJceREyAHUQ --json
```

Only the project owner publishes the reviewed observation draft:

```bash
vercel --scope ny1411 firewall publish --project prj_JeyY6SRrW4LOOSA3ggJceREyAHUQ --yes
```

Resume the paused project only as an explicit owner operation after protections and caching are ready. Collect representative traffic before moving to enforcement. Record each rule ID and open `https://vercel.com/ny1411/founders-directory/firewall/traffic?filter=<ruleId>`.

## Observe, validate in Preview, then enforce

For each rule, inspect matches by IP, JA4, ASN, country, verified/unknown bot classification, user agent, path and method. Compare total hits, distinct IPs, request rate, user reports, Function invocations and Active CPU. Preserve verified crawlers, link unfurlers, shared networks, signed-in navigation, onboarding saves and profile requests. A lack of matches on a paused project is not evidence that a threshold is safe.

```bash
vercel --scope ny1411 firewall traffic list --project prj_JeyY6SRrW4LOOSA3ggJceREyAHUQ --since 1h --json
vercel --scope ny1411 firewall alerts list --project prj_JeyY6SRrW4LOOSA3ggJceREyAHUQ --since 1h --json
vercel --scope ny1411 firewall traffic inspect rule <ruleId> --project prj_JeyY6SRrW4LOOSA3ggJceREyAHUQ --since 1h --group-by ip --json
```

Keep Production observation rules intact. Add a **separate** Preview rule with the same method/path and candidate action, `environment = preview`, and a unique secret probe header condition. For a bounded homepage test, use `GET /`, key `ip`, window 60 seconds, limit 3, exceeded action `rate_limit`, plus `header x-fd-firewall-probe = <random 32+ character value>`. Never use a production URL or production limits to generate load. Inspect its conditions/diff, have the owner publish, and use a fresh header value so previous counters cannot affect the run.

```bash
# Set FIREWALL_PROBE_KEY locally to the exact secret value in the Preview rule.
# Pass a READY Preview deployment ID from Vercel, never its production ID.
node scripts/security/firewall-preview-probe.mjs dpl_PREVIEW_DEPLOYMENT_ID
```

The probe verifies deployment ownership and non-production target through Vercel's API before sending at most eight sequential GET/HEAD requests. It checks below/above-threshold responses and unrelated method/path/unmarked traffic. Redirects are not followed. If Vercel Authentication blocks the preview, use the protected-deployment access workflow; do not disable deployment protection. Validate each expensive endpoint's rule separately with unauthenticated/invalid requests or mocked providers in Preview; never spend real enrichment credits or AI quota to test a firewall. Check the rule ID in Firewall traffic and confirm requests blocked at the edge did not invoke Functions; an application-generated 429 alone does not prove edge enforcement. Real verified-crawler behavior requires traffic review; spoofing a Googlebot user agent is insufficient.

After Preview verification **and** owner review of Production observations, stage the Production exceeded action change to `rate_limit` (or company-page `challenge`) with `rules edit`, retaining every environment/method/path condition. Inspect each rule and complete diff again, then have the owner publish. Do not tighten thresholds at the same time as first enforcing. Monitor for 24 hours and record CPU trends, unexpected 429/challenges and reports from legitimate users. Remove/disable temporary preview probe rules through a reviewed draft after testing.

## Rollback and emergency response

Prefer changing the affected rate limit's exceeded action back to `log`; this preserves monitoring. Disabling a named rule is the alternative. Never discard unrelated drafts.

```bash
vercel --scope ny1411 firewall rules edit "FD #40 observe homepage" --project prj_JeyY6SRrW4LOOSA3ggJceREyAHUQ --rate-limit-action log --yes
vercel --scope ny1411 firewall diff --project prj_JeyY6SRrW4LOOSA3ggJceREyAHUQ
# Owner reviews and publishes rollback.
vercel --scope ny1411 firewall publish --project prj_JeyY6SRrW4LOOSA3ggJceREyAHUQ --yes
```

For an active attack, the owner may run `vercel --scope ny1411 firewall attack-mode enable --project prj_JeyY6SRrW4LOOSA3ggJceREyAHUQ --duration 1h --yes` interactively. This immediately challenges unverified visitors; it is not a staging command. Automatic platform DDoS mitigation stays enabled. Never pause system mitigations or add broad IP/header bypasses. Firewall-blocked/challenged/rate-limited traffic does not invoke Functions; traffic served before mitigation or remaining only in log mode can still incur usage.

## Completion evidence

Keep #40 open until rule IDs/diff, owner observation publication, representative traffic review, Preview edge enforcement evidence, Production enforcement publication, crawler/navigation checks, rollback readiness, and 24-hour Function/CPU monitoring are recorded. Repository tests and staging artifacts alone do not satisfy those operational criteria.

# Vercel usage anomaly and incident response (#41)

This runbook is for sudden request, Function invocation, Active CPU, error, cache-miss, or Firewall growth in `ny1411/founders-directory`. The goal is to identify the responsible route or client cohort within 15 minutes, contain abuse without blocking broad legitimate populations, and recover with evidence.

For a plain-language explanation of the issue, ownership, costs, and remaining
setup, read [Monitoring explained](monitoring-explained.md).

## Verified project and current evidence

Read-only Vercel connector inspection on **25 October 2026** resolved team
`ny1411` (`team_uk1Ii5k2P5wcgjeFoxW9ojfC`) and project **`foundersdirectory`**
(`prj_oxUZTfhN9aAIwtcABk8dcX00nFvt`). The repository name remains
`founders-directory`; do not use that spelling to infer the Vercel project name.
The Observability configuration endpoint returned **404: Observability Plus is
not enabled**. This establishes that feature's current availability, not the
billing plan or absence of all platform alerts. No notification, alert setting,
paid feature, or production configuration was changed during this inspection.

## Ownership and current limitations

- **Incident owner:** the Vercel project owner (`ny1411`) until an on-call rotation is recorded here.
- **Escalation:** a second person who can respond if the owner is unavailable. A solo maintainer can leave this unassigned and record the coverage gap; do not claim the issue's two-operator exercise is complete until another person participates.
- **Notification destination:** an actively monitored destination must be selected and tested in Vercel. Repository code cannot configure or prove delivery to that destination.
- **Plan:** Observability Plus was confirmed unavailable on 25 October 2026. Billing tier, Active CPU percentage alerts, retention, saved-query availability, and notification settings still need inspection. Do not purchase a plan or assume an alert exists from this repository change.
- **Fallback:** measurements are emitted as bounded JSON records in Function logs. Combine these with available Web Analytics, Usage, and Firewall views; export evidence within the verified retention window. Logs provide evidence when inspected, but do not send alerts or perform continuous monitoring by themselves.
- **Metric transport:** without an injected emitter, `src/lib/observability.ts` writes each validated measurement as an `event: "metric"` record. Counts and durations are no longer discarded. An injected paid metrics emitter replaces this fallback to avoid duplicate measurements. Unit tests prove the contract; deployed ingestion remains to be verified.

Record the current primary owner, backup, destination, plan, alert IDs, saved-view URLs, and last notification test here before closing #41:

| Item | Current value | Verified at |
| --- | --- | --- |
| Primary owner | `ny1411` | Repository ownership only |
| Backup operator | Unassigned | Solo-maintainer coverage gap; two-person exercise pending |
| Alert destination | **TBD** | Not selected, configured, or tested |
| Vercel billing plan | **TBD** | Not established by the available response |
| Observability Plus | Not enabled | Vercel configuration API, 25 October 2026 |
| Project name / ID | `foundersdirectory` / `prj_oxUZTfhN9aAIwtcABk8dcX00nFvt` | Vercel project lookup, 25 October 2026; production rollout readiness remains separate |
| Last test notification | **TBD** | Not sent by this change |

## Telemetry contract

Application instrumentation must use the shared helper rather than constructing metric tags or log records ad hoc.

- Metrics use only registered names and bounded dimensions: normalized `route`, `outcome`, `cache_result`, `provider`, `quota_decision`, and `environment`.
- Correlation IDs appear in structured logs and **never** in metric tags.
- Logs accept only registered events and fields. They may contain elapsed/provider latency, status, cache/quota decisions, and bounded counts.
- User IDs, request IDs as dimensions, email/IP addresses, raw URLs or query strings, company names, contact data, authorization/cookies/tokens, resume content, generated private messages, payloads, and request bodies are rejected.
- Normalize paths before recording them. `/company/acme` becomes `/company/[slug]`; unknown paths become `/other`.
- Emit counts as numeric metric values, not tag values. Emit one attempt at the point the attempt is known; make retries explicit in application behavior so an at-least-once job is not mistaken for one logical operation.
- Do not log caught error messages or provider response bodies. Map failures to a stable `error_code` and keep private debugging material out of telemetry.

Candidate metrics are `directory.query.duration_ms`, `directory.query.result_count`, `directory.query.candidate_count`, `company.load.duration_ms`, `contact_enrichment.attempts`, `contact_enrichment.batch_size`, `dm_generation.attempts`, `api.quota_rejections`, `onboarding.save.attempts`, and `onboarding.save.duration_ms`.

## Alerts and initial thresholds

Enable every supported alert in Vercel, route it to the recorded monitored destination, and send a test notification. If a threshold is unavailable on the current plan, mark it **unavailable** in the table and implement the documented fallback rather than marking it complete.

| Signal | Starting threshold | Required action |
| --- | --- | --- |
| Monthly Function Active CPU | 50% | Investigate trend, top Functions, cache misses, and forecast |
| Monthly Function Active CPU | 75% | Assign incident owner; prepare containment |
| Monthly Function Active CPU | 90% | Contain immediately; consider disabling the responsible feature |
| Function invocations | Sudden growth or 5× corresponding recent hourly baseline | Compare routes, deployments, cache results, and Firewall traffic |
| Function errors | Sustained elevation or recurring Firestore index/provider errors | Inspect stable error code and route; page owner if user-visible |
| Homepage requests | More than 5× corresponding recent hourly baseline | Check visitor ratio and cohort concentration |
| One client/fingerprint | More than 60 homepage requests per 10 minutes | Inspect IP/JA4/ASN/bot evidence; tune the narrow #40 rule |
| Route concentration | One route exceeds 80% during elevated traffic | Identify whether it reaches Functions; contain that route first |
| Web Analytics | Pageviews exceed visitors by 20× for one hour | Compare no-referrer and browser/device/country cohorts |
| Cohort concentration | One browser/device/country cohort exceeds 80% of anomaly | Correlate with Firewall evidence; do not block on cohort alone |
| Cacheable public route | Hit rate below post-#36/#37 target | Check `MISS`/`BYPASS`, cache reason, ISR writes, and deployment changes |
| Firewall | Unexpected rate-limit/challenge/deny growth | Determine whether attack or legitimate users are affected |

Tune these thresholds after representative production traffic. Alerts must have an owner and a specific next action; avoid notifications for every small change.

## Evaluate an aggregate snapshot locally

`scripts/monitoring/usage-anomaly.mjs` turns the thresholds above into an
executable investigation aid. It runs with the repository's Node 24 runtime,
makes no network requests, changes no settings, and sends no notifications.
Prepare a **local, uncommitted aggregate** snapshot from the verified project's
Usage, request/cache, Firewall and Web Analytics views. Do not pass raw exports,
logs, IPs, JA4 values, user agents, tokens or private content. Unknown schema
fields and raw dynamic paths are rejected without echoing them.

```bash
node scripts/monitoring/usage-anomaly.mjs /tmp/usage-snapshot.json
node --test scripts/monitoring/usage-anomaly.test.mjs
```

The JSON schema is illustrated below. Replace the example timestamps and counts
with actual observations before running it; stale examples fail closed.
`current` is mandatory. Every optional signal may be `null` or omitted when its
source is unavailable; the report then lists that gap explicitly. Empty cache
coverage also remains incomplete. Missing evidence never becomes an all-clear.

```json
{
  "schemaVersion": 1,
  "projectId": "prj_oxUZTfhN9aAIwtcABk8dcX00nFvt",
  "teamId": "team_uk1Ii5k2P5wcgjeFoxW9ojfC",
  "environment": "production",
  "capturedAt": "2026-10-26T05:01:00Z",
  "windowStart": "2026-10-26T04:00:00Z",
  "windowEnd": "2026-10-26T05:00:00Z",
  "current": {"requests": 1000, "functionInvocations": 100, "functionErrors": 0, "homepageRequests": 500},
  "baseline": {
    "windowStart": "2026-10-25T04:00:00Z",
    "windowEnd": "2026-10-25T05:00:00Z",
    "requests": 1000, "functionInvocations": 100, "homepageRequests": 500
  },
  "cpu": {
    "scope": "team_all_environments",
    "usedMilliseconds": 100, "allowanceMilliseconds": 1000,
    "periodStart": "2026-10-01T00:00:00Z", "periodEnd": "2026-11-01T00:00:00Z"
  },
  "publicCache": [
    {"route": "/", "requests": 500, "hits": 450},
    {"route": "/company/[slug]", "requests": 200, "hits": 180},
    {"route": "/api/directory", "requests": 100, "hits": 90}
  ],
  "analytics": {"pageviews": 1000, "visitors": 200, "topCohortPageviews": 300},
  "firewall": {"requests": 1000, "mitigated": 0},
  "largestClientHomepageRequestsTenMinutes": 20,
  "topRoute": {"route": "/", "requests": 500}
}
```

Use one closed **60-minute window**, one environment and one project for request,
Function, cache, Firewall and analytics counts. Finish collection and evaluation
within 15 minutes of its end. `baseline` must be another 60-minute window at the
same UTC hour, 1–28 days earlier, for the same sources/environment/project; choose
representative traffic and record collection provenance separately. Traffic and
Function counts remain independent: do not derive Function work by subtracting
cache hits or mitigations. Include only 5xx failures in `functionErrors`.
`publicCache` contains `HIT` counts for the three listed public routes. Normalize
company slugs and other dynamic routes using the application's registered route
vocabulary before supplying `topRoute`. `topCohortPageviews` and the largest-client
count contain counts only, never the cohort/client identifiers. The client count
is the largest observed homepage count in any 10-minute interval within the hour.

CPU is a separate monthly allowance signal. Both numbers must use milliseconds,
the same allowance period, and the declared scope: `team_all_environments` or
`project_all_environments`. Use team totals for a shared team allowance; comparing
one project's consumption against a shared allowance would miss other projects'
usage. Do not invent a project allowance. Set `cpu` to `null` if usage, allowance,
units or scope cannot be established. The report exposes `cpuScope` so that this
signal cannot be mistaken for the selected environment's CPU attribution.

The evaluator emits fixed signal/action codes and only registered routes. CPU
selects the highest crossed 50/75/90% tier. Traffic growth requires more than 5×
baseline **and at least 100 current observations**; a zero baseline warns only at
that floor, while zero-over-zero stays quiet. Error warnings require at least
100 invocations, five errors and a 5% error rate. Cache warnings require at least
100 observations and less than 80% hits. Analytics ratio warnings require at least
100 pageviews and more than 20 pageviews per visitor (including zero visitors).
Route/cohort concentration above 80% is actionable only alongside elevated
traffic. Firewall mitigation share above 80% requires at least 100 requests; it
prompts review for abuse or harmed users, without claiming origin work. The
largest-client warning begins above 60 homepage requests per 10 minutes.
These are initial investigation thresholds, defined in the exported `thresholds`
object; tune them through a reviewed code change after observing normal traffic.

| Exit | Meaning | Operator action |
| --- | --- | --- |
| `0` | Complete supplied evidence crossed no threshold | Continue the assigned watch; this is no proof of health or alert delivery |
| `1` | One or more findings, possibly with evidence gaps | Follow the fixed action codes and the Detect/Contain procedure |
| `2` | Invalid/stale/wrong-scope snapshot or unreadable input | Repair collection; no assessment was established |
| `3` | No finding, but one or more sources unavailable | Obtain the missing evidence; do not treat as healthy |

Only regular files of at most 64 KiB are accepted. Reads remain bounded if a file
grows; FIFOs/devices are rejected without waiting for a writer. Errors do not
print file paths or input values. An operator or an explicitly configured external
monitor must collect fresh data and run this tool. It does **not** schedule
collection, prove Vercel ingestion, continuously monitor traffic, or establish
notification delivery. Supported platform alerts, recipients, a tested delivery,
saved views, Preview simulation, the operator exercise and the 24-hour watch
remain required before closing #41.

## Dashboards and saved queries

Create one saved incident dashboard for Production and an equivalent Preview view. Save direct URLs in the ownership table or the incident ticket. Query syntax and fields depend on the enabled Vercel product and plan; inspect schemas before copying a command.

### Function and route behavior

- Function invocations grouped by route/function, with Production separated from Preview.
- Active CPU grouped by route/function where available; otherwise compare total Active CPU with invocation count, duration metrics, and structured logs.
- Duration percentiles (`p50`, `p95`, `max`) and error rate grouped by normalized route and stable outcome.
- Top request paths, then map dynamic paths to normalized application routes.
- Deployment markers overlaid on request, error, and CPU graphs.

### Cache and ISR behavior

- `vercel.request.count` grouped by `cache_result`.
- Cache hit rate for `/` and `/company/[slug]` after #36/#37.
- `MISS` and `BYPASS` grouped by route/request path.
- Cache reasons including `cold`, `crawler`, `stale_time`, and `stale_error` when exposed.
- ISR write/revalidation activity and frequency; investigate loops or a path whose revalidation rate tracks request rate.

Start with:

```bash
vercel metrics schema vercel.request.count -S ny1411 -p prj_oxUZTfhN9aAIwtcABk8dcX00nFvt
vercel metrics vercel.request.count -S ny1411 -p prj_oxUZTfhN9aAIwtcABk8dcX00nFvt \
  --prod --group-by cache_result --since 1h
```

### Application metrics and logs

Invoke each instrumented operation on a deployed environment before expecting its metric schema to exist. Confirm dimensions before querying:

```bash
vercel metrics schema -S ny1411 -p prj_oxUZTfhN9aAIwtcABk8dcX00nFvt
vercel metrics schema directory.query.duration_ms -S ny1411 -p prj_oxUZTfhN9aAIwtcABk8dcX00nFvt
vercel metrics directory.query.duration_ms -S ny1411 -p prj_oxUZTfhN9aAIwtcABk8dcX00nFvt \
  -a p95 --group-by route --since 1h
vercel metrics api.quota_rejections -S ny1411 -p prj_oxUZTfhN9aAIwtcABk8dcX00nFvt \
  -a sum --group-by route --since 1h
```

Those Custom Metrics commands apply only after entitlement and transport are
verified. With the currently confirmed fallback, filter Function logs by
`event = metric`, then by `metric` and bounded `tags.route` / `tags.outcome`.
For example, an application quota denial emits:

```json
{"event":"metric","metric":"api.quota_rejections","value":1,"tags":{"route":"/api/generate-dm","outcome":"rate_limited","quota_decision":"rejected"},"timestamp":"2026-10-25T00:00:00.000Z"}
```

For one environment, deployment, and time window:

- Sum `value` for `api.quota_rejections` by `tags.route` to find rejected calls.
- Sum `value` for an `.attempts` metric to count instrumented handler responses.
  These are handler attempts, including denials, not a billing ledger or proof
  that a provider call occurred.
- Use `value` for `.duration_ms` metrics to compare route durations; average,
  maximum, and percentiles require a tool that supports the aggregation.
- Operation records such as `event = dm_generation` retain route, outcome,
  status, elapsed time, and correlation ID. Use them for investigation. Do not
  add these records to metric counts: timer measurements and operation records
  describe the same operation.

Only captured logs are represented; expiration, sampling, log limits, and
unlogged edge traffic can leave gaps. An absent log is not proof of zero traffic.
Record the export window and deployment with the evidence. Never paste raw
private requests into an incident ticket. These log records neither create a
saved Vercel Custom Metric nor configure an alert destination.

A shared API wrapper emits one duration metric and one operation record, plus
one attempt metric when configured and one quota metric for a `429`: two to four
records per completed wrapper call. Each record has a fixed schema; volume still
grows with request count. Independent security/provider logs may add records.
Include this added volume when checking retention and log-usage limits.

### Firewall behavior

- Actions grouped by rate limit, challenge, deny, and log.
- Top IP, JA4, ASN, country, user agent, normalized path, and verified/unknown bot classification.
- Persistent actions currently affecting clients.
- Rules with unexpectedly high matches from legitimate navigation, crawlers, link previews, shared networks, or onboarding autosave.

```bash
vercel firewall traffic list --scope ny1411 --project prj_oxUZTfhN9aAIwtcABk8dcX00nFvt --since 1h --json
vercel firewall alerts list --scope ny1411 --project prj_oxUZTfhN9aAIwtcABk8dcX00nFvt --since 1h --json
```

Treat IP/JA4/user-agent as investigation evidence, not identity or proof of malice. Do not copy these values into application metrics.

### Web Analytics anomaly signals

Save hourly views for pageviews versus unique visitors, recent-baseline comparison, no-referrer share, browser/device/OS/country concentration, and route concentration. Web Analytics is an aggregate signal; use Firewall and Function evidence to decide whether requests reached compute.

## Incident procedure

Open an incident record immediately. Use timestamps with timezone, and preserve screenshots/exports before retention expires.

### Detect (target: first 5 minutes)

1. Confirm the alert time window, environment, deployment, and whether traffic is still active.
2. Check Firewall traffic and alerts. Note action, rule ID, top paths, and whether requests are already blocked/challenged upstream.
3. Compare Web Analytics pageviews and visitors; inspect route, no-referrer, country, browser, device, and OS concentration.
4. Check Function invocations, Active CPU, duration, errors, and `cache_result` in the same window.
5. Decide whether the anomaly reaches Functions. A Firewall-blocked request should not invoke a Function; an application 429 still does.
6. Assign owner/severity and record the first-known-good and first-known-bad timestamps.

### Contain (target: by minute 10)

1. Tighten only the relevant staged Firewall rule from [#40](https://github.com/ny1411/founders-directory/issues/40). Preserve environment, method, and path conditions.
2. Prefer a narrow rate limit or challenge over broad user-agent, shared fingerprint, IP-range, country, or ASN denial.
3. Use Attack Mode only for an active incident with explicit project-owner confirmation; record enable time and intended expiry.
4. If edge control is insufficient, disable the specific expensive feature/provider path before pausing the entire project. Preserve directory availability where safe.
5. Record exact before/after rule configuration, rule ID, actor, timestamp, and expected rollback.
6. Confirm containment in Firewall traffic **and** falling Function invocations/CPU. Do not infer edge blocking from an application-generated 429.

### Diagnose (target: by minute 15)

1. Rank top paths and classify each as static, cacheable/ISR, dynamic Function, or expensive external-provider API.
2. For cacheable paths, compare `HIT`, `MISS`, `BYPASS`, and cache reason. Check whether each request triggered a Function or ISR write.
3. Correlate request growth with Active CPU, duration, stable error codes, Firestore index errors, provider attempts/latency, Queue activity, and deployments.
4. Compare IP/JA4/ASN/user-agent/bot combinations, but do not assume a shared fingerprint is malicious.
5. Use correlation IDs to join privacy-safe logs for individual operations. Correlation IDs are not metric dimensions and must not encode identity.
6. Export permitted logs, aggregate query results, Firewall evidence, and screenshots before retention expires. Verify exports contain no credentials or private content.

### Recover

1. Verify the reviewed Firewall protection is active and producing the expected action.
2. Confirm [#36](https://github.com/ny1411/founders-directory/issues/36) and [#37](https://github.com/ny1411/founders-directory/issues/37) caching on representative homepage/company routes. Confirm cache hits do not invoke Functions.
3. Unpause the project or redeploy the last known-good Production deployment only after protections are active and an owner approves.
4. Run low-volume smoke tests for homepage, company page, authentication, profile, onboarding, and expensive APIs. Use invalid/mocked provider requests where possible; do not spend paid credits merely to test containment.
5. Verify normal status, cache headers/results, Function error rate, queue behavior, and no unexpected legitimate-user challenge/429.
6. Begin the 24-hour watch below. Roll back or loosen only the affected rule if legitimate users are harmed.

### Review

1. Write a short timeline: detection, acknowledgement, containment, diagnosis, recovery, and end of monitoring.
2. Record detection/containment gaps, alert delivery failures, and whether the responsible route/client cohort was identified within 15 minutes.
3. Tune alert thresholds and Firewall rules from observed normal and incident traffic.
4. Assign owners and deadlines to follow-ups; link deployments, rule diffs, dashboards, and evidence.
5. Audit captured telemetry and incident artifacts for sensitive data. Delete or restrict any unsafe artifact according to policy and fix the source.
6. Run a tabletop with two operators: both must locate dashboards, interpret the alert, stage a narrow rule, and describe rollback.

## Bounded Preview simulation

Never load-test Production. Keep Production observation rules intact and use a ready Preview deployment owned by this project.

1. Create a separate Preview-only Firewall test rule with an exact route/method, a unique secret probe-header condition, a small threshold (for example 3 requests per 60 seconds), and `rate_limit` after the threshold. Do not commit the secret.
2. Review the complete draft and have the owner publish it. If deployment protection is enabled, use the approved protected-preview access workflow; do not disable protection.
3. Deploy route instrumentation with an injected Custom Metrics emitter when available and structured logs in all cases.
4. Send at most eight sequential requests: below threshold, above threshold, and control requests without the marker or with another method/path. Do not call paid providers or submit personal data.
5. Verify allowed requests produce exactly the expected normalized metric/log records. Confirm a quota rejection increments only `api.quota_rejections` with bounded tags.
6. Verify logs have correlation ID and timing but no token, secret header, raw query, IP/email, body, resume, generated message, or enrichment result.
7. Verify edge-limited requests appear under the test rule and do not increment Function invocation/application metrics. An application 429 is not sufficient evidence.
8. Save sanitized screenshots/query output in the issue, then remove the temporary rule through a reviewed Firewall draft.

Repository preflight:

```bash
npx tsx --test src/lib/observability.test.ts
```

The local test proves vocabulary and privacy guards, not Vercel ingestion, alert delivery, edge enforcement, or plan entitlement.

## 24-hour post-recovery watch

Assign an owner for the full period. Record observations at recovery, +1h, +4h, +12h, and +24h (more frequently while traffic remains elevated):

- request and pageview rate versus unique visitors and baseline;
- top route/cohort concentration and no-referrer share;
- Firewall actions and legitimate-user reports;
- Function invocations, Active CPU/allowance, duration, and errors;
- cache hit/miss/bypass and ISR write/revalidation rate;
- Firestore/provider/Queue failures and quota rejections;
- status of the mitigated feature and current deployment.

End the watch only after 24 hours of stable traffic and explicit owner sign-off. If the anomaly returns, reopen Detect and preserve the new time window. Do not silently remove containment at the end of the watch.

## Related controls and follow-ups

Review this runbook whenever any linked implementation changes:

- [#35 — incident analysis and protection strategy](https://github.com/ny1411/founders-directory/issues/35)
- [#36 — homepage CDN/ISR caching and Firestore query bounds](https://github.com/ny1411/founders-directory/issues/36)
- [#37 — company and Open Graph caching](https://github.com/ny1411/founders-directory/issues/37)
- [#38 — expensive API authentication and quotas](https://github.com/ny1411/founders-directory/issues/38)
- [#39 — onboarding write reduction](https://github.com/ny1411/founders-directory/issues/39)
- [#40 — Vercel edge Firewall rate limits](https://github.com/ny1411/founders-directory/issues/40)

Issue #41 remains operationally incomplete until supported alerts and recipients are verified, deployed routes emit telemetry, saved views exist, a bounded Preview exercise succeeds, two operators complete the tabletop, and the 24-hour post-recovery watch is recorded.

## Browser policy and audit follow-up (#64)

The repository now supplies report-only CSP and baseline browser headers, a
bounded privacy-safe CSP report receiver, and CI checks described in
[Browser security](../security/browser-security.md). During rollout, verify actual
Preview/Production headers and Google sign-in/BotID flows before considering CSP
enforcement. Review `security.csp_report` only as an untrusted bounded diagnostic.
Auth sync, onboarding/profile, founder-contact and company-submission outcomes
now supplement existing generation/enrichment telemetry. No raw provider or
Firebase exception is needed for these audits.

Before declaring operational rollout complete, record branch protection required
checks and bypass access, operator MFA status, backup operator, and the tested
alert destination. CI and code changes do not enable these external settings.

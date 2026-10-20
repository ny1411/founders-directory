# Homepage traffic abuse response (#35)

## Current state

On October 20, 2026, project `prj_oxUZTfhN9aAIwtcABk8dcX00nFvt` in team
`ny1411` had an active Firewall configuration with managed Bot Protection in
challenge mode, but no custom rules or IP blocks. There was no draft. The
rule manifest targets this project; **no repository-defined rule has been
staged, published, or tested in Preview**. Inspect the active and draft
configuration before staging. Preserve the managed protection and any rules
added since this check.

## First hour of an incident

Use the confirmed team and project identifiers in these commands. Inspect the
last hour before changing rules:

```bash
vercel --scope ny1411 firewall traffic list --project PROJECT_ID --since 1h --json
vercel --scope ny1411 firewall alerts list --project PROJECT_ID --since 1h --json
vercel --scope ny1411 firewall rules list --project PROJECT_ID --expand --json
vercel --scope ny1411 firewall diff --project PROJECT_ID --json
```

Filter the traffic report to `GET /` and record the number of requests per
minute, top IP or privacy-safe client group, JA4, ASN, country, user agent, bot
classification, matched rule and Firewall action. Inspect the same interval's
Vercel request/Function data for route, method, cache result (`HIT`, `MISS`,
`BYPASS`, `STALE`), invocations, and Active CPU. A log-only match still
reaches the Function. Compare ordinary sessions, shared-IP users, verified
search crawlers, and link previewers before choosing a threshold. Neither a
mobile user agent nor one JA4 value is proof of abuse.

## Planned protection

`scripts/security/firewall-rules.mjs` defines the exact production `GET /`
observation rule, `FD #35 observe homepage`: 100 requests per 600 seconds per
IP, with exceeded action `log`. It also defines method-scoped observation
rules for expensive APIs. Use the staging and inspection procedure in
[vercel-firewall-rate-limits.md](vercel-firewall-rate-limits.md). The owner must
publish the reviewed observation draft. Record the rule ID and review its
traffic, grouped by IP, JA4, ASN, country, user agent, path, and action:

```bash
vercel --scope ny1411 firewall traffic inspect rule RULE_ID --project PROJECT_ID --since 1h --group-by ip --json
```

Rate-limit counters are per region and per IP, so the threshold is not a global
cap or a durable per-user quota. If the Vercel plan rejects rate limits, use a
shared durable store for application limits, scoped to authenticated users
where available. Do not use a process-local `Map` across Functions.

## Validate before production enforcement

Keep the Production rule in observation mode. Add a separate, narrowly scoped
Preview rule for `GET /` with a secret probe header, publish it after review,
and run `scripts/security/firewall-preview-probe.mjs` against a verified READY
Preview deployment. The probe checks a below-threshold visit, an exceeded
request, a different path and method, and unmarked navigation. Confirm the
Firewall rule ID shows edge actions and that blocked requests did not invoke
Functions. Test expensive API rules separately without spending live provider
credits. Review Production observation data for legitimate browsers and
verified crawlers before staging any Production `rate_limit` or `challenge`
action. Keep method, path, and environment conditions intact and inspect the
complete draft before the owner publishes it. Monitor 429s/challenges, user
reports, Function use, and Active CPU for 24 hours.

## Rollback and emergency mode

To stop enforcing, stage an edit that returns the affected rule's exceeded
action to `log`, inspect its conditions and the full diff, then have the owner
publish the rollback. Disabling the specific rule is an alternative. Do not
discard unrelated drafts.

```bash
vercel --scope ny1411 firewall rules edit "FD #35 observe homepage" --project PROJECT_ID --rate-limit-action log --yes
vercel --scope ny1411 firewall rules inspect "FD #35 observe homepage" --project PROJECT_ID --json
vercel --scope ny1411 firewall diff --project PROJECT_ID --json
# Owner publishes the reviewed rollback:
vercel --scope ny1411 firewall publish --project PROJECT_ID --yes
```

During an active attack, the owner can enable Attack Mode interactively for a
short period with `vercel --scope ny1411 firewall attack-mode enable --project
PROJECT_ID --duration 1h --yes`. It takes effect immediately and challenges
unverified visitors. Review verified crawler access and disable it when the
incident ends. Never pause Vercel's automatic DDoS mitigations or block broad
Android/Chrome Mobile user-agent strings or shared JA4 fingerprints.

Issue #35 remains operationally incomplete until the observation rule is
published, Preview behavior is demonstrated, legitimate traffic is reviewed,
Production enforcement is published if safe, and 24-hour monitoring is recorded.

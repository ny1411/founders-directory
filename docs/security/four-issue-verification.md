# Open security issue implementation review

Reviewed on October 27, 2026 against main commit
`f3ad4b874a19a5773f8069f4f059ee7810383261`, using one implementation reviewer
for each of the four open issues and an independent review of the resulting diff.

| Issue | Repository result |
| --- | --- |
| #43 BotID | Existing integration covers all four selected authenticated operations. This follow-up rejects malformed SDK classification results as a sanitized, private `503` before request buffering or downstream work. |
| #62 Provider bounds | Already implemented in merged #85: Gemini deadlines/output caps, fenced owner extraction leases, bounded Saleshandy streaming and no ambiguous paid POST retries. Latest main preserves these controls and strengthens worker fencing. |
| #63 Private retention | Already implemented in merged #86: public founder projection, authenticated scoped contact lookup, account-scoped recovery clearing, logical message expiry and timestamp TTL fields for messages/superseded sources. |
| #64 Headers, CI and telemetry | Already implemented in merged #87. This follow-up pins workflow actions and the downloaded scanner version and disables persisted checkout credentials. |

Focused provider, privacy/render/recovery, browser policy, audit, BotID and
company-action regression tests passed. The BotID regression injects incomplete,
null and nonboolean classifications and verifies authentication happens first,
the request body remains unread and no handler/database/provider work runs.

## Existing deployment evidence

- GitHub Security run [40453675733](https://github.com/ny1411/founders-directory/actions/runs/40453675733)
  passed for the reviewed main commit, including verification and secret-scanning
  jobs. Verification includes a clean install, type/lint, security, browser,
  onboarding, profile, directory, scraper, isolated Firestore rules and shipped
  dependency audit checks.
- Vercel production deployment `dpl_3GB8LaZsfqUdnjZDBxa5f2RHHi4G` is `READY`
  for that same commit, Next.js on Node 24, with build completion recorded.
  Production alias: <https://foundersdirectory.neerajyamaji.com>.
- Vercel's grouped runtime-error query returned no errors in its one-hour
  observation window. This is a bounded observation, not proof of every flow.
- An authenticated deployment URL fetch reached a `429` Vercel Security
  Checkpoint (`x-vercel-mitigated: challenge`). The active Firewall configuration
  confirms managed bot protection uses `challenge`. This response does not
  verify application headers, Google sign-in or BotID human flows.
- GitHub denied the integration's branch-protection read with `403 Resource not
  accessible by integration`; protection settings remain unverified.

## Operational work remains separate

Do not close an issue solely because its repository implementation is present.
BotID paired-flag activation, genuine human/mobile/keyboard flow verification,
managed-rule observations and 24-hour monitoring remain rollout work documented
in [the BotID runbook](../runbooks/vercel-bot-protection.md) and issue #47.
Firestore TTL activation, retention-policy approval and any legacy-data cleanup
require the separately reviewed rollout in [data retention](data-retention.md).
Deployed-header checks, branch protection, operator MFA and tested alert
destinations remain service-side checks in [browser security](browser-security.md).
This review changes no live settings and performs no cleanup or paid provider
calls. New-commit CI and Preview status are recorded on the follow-up PR.

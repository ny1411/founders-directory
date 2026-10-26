# Browser policy, security checks, and audit events

The application sends `nosniff`, `DENY` framing, a strict-origin referrer policy,
a limited Permissions Policy, and `same-origin-allow-popups` COOP. The latter
preserves Firebase Google popup sign-in. These policies do not add CORS permission
or replace Firebase bearer verification, authorization, BotID, admission limits,
or Next Server Action origin checks.

The CSP is **report-only**. It allows Next inline bootstrap/theme scripts, the
Firebase Google authentication frame and API origins, fonts, and Vercel/BotID
resources. Production does not allow `unsafe-eval` in the report-only policy;
local development does for tooling. Image sources remain broad in this trial
policy; Next's existing image optimizer allowlist still applies separately.
No browser resource is blocked by the trial CSP. Do not switch to enforcing CSP
or add COEP without testing Google popup/redirect sign-in and all protected flows.

`POST /api/csp-report` accepts JSON browser reports, limits the entire body to
16 KiB, considers at most five reports, and logs only a finite directive name
(or `other`). It never retains URLs, query strings, script samples, document
paths, tokens, browser metadata or report bodies. Responses are no-store.
Reports are untrusted diagnostic hints, not proof of an attack. The endpoint
performs no database/provider work. Apply a separate edge rate limit if reporting
volume becomes excessive; do not interpret received report counts as unique users.

## Preview review before policy enforcement

1. Inspect deployed response headers for `/`, a company page, `/profile`, and
   representative API success/error responses. Confirm the CSP header is
   `Content-Security-Policy-Report-Only` and no conflicting enforcing policy
   was inherited at the host.
2. Exercise Google sign-in and redirect fallback, sign-out/account switching,
   Next navigation, copy buttons, resume review, contact lookup, and enabled
   BotID human/rejection paths on desktop/mobile. These are browser checks;
   passing unit tests does not establish provider compatibility.
3. Review DevTools CSP warnings alongside `security.csp_report` structured logs.
   The logs intentionally cannot identify a blocked URL. Reproduce the flow in
   Preview to inspect its origin locally; do not add raw report logging.
4. Narrow origins only after reviewing legitimate dependencies. Establish nonce
   or hash handling for inline scripts before dropping `unsafe-inline`. Record
   the policy/rollback and operator approval before enabling enforcement.

## Audit coverage and privacy

The shared runtime records bounded normalized route, outcome, duration and HTTP
status for auth sync, onboarding reads/writes, profile aliases, founder contact,
and the existing generation/enrichment routes. Enrichment job polling and signed
Queue callbacks also record finite status/callback events, including signature
denials, feature-unavailable responses and SDK errors. Callback responses use
`private, no-store` and preserve SDK exceptions for Queue retries. Accepted-job
events retain only batch size and quota outcome; job IDs and Queue receipts are
excluded from logs. Company submission records an
outcome, including authentication/validation/quota failures; Next redirects count
as success. Private API success and error responses use `private, no-store`,
including quota and BotID rejection. Public directory caching is preserved.
Firebase/provider exceptions are never interpolated into new audit logs; private
contents, authorization headers, user IDs, founder IDs and emails are excluded.
A new route or event must be added to the explicit finite vocabulary. Metrics
still use the documented structured-log fallback until plan support is verified.

## Repository checks

`.github/workflows/security.yml` runs on PRs, main pushes, weekly, and manually.
It uses Node 24 (matching the Firebase SDK minimum of Node 24.12), a clean npm
install, type/lint checks, isolated security/onboarding/browser/profile/directory/
scraper tests, demo Firestore emulator rules tests, and an audit
of shipped dependencies at high severity. Browser/provider fixtures require no
production Firebase credentials and spend no provider credits. Gitleaks scans
history with redacted findings and without publishing finding artifacts/comments.
A historical secret finding requires rotation/remediation; never allowlist a real
credential just to make CI pass. Dependabot checks npm and action updates weekly.

The workflow has `contents: read`, no deployment step, and no production secrets.
GitHub's normal read-only token is used by the secret scanner. Rules tests strip
Firebase/Google environment configuration and use the existing demo project.
Never run these jobs with `pull_request_target` against untrusted PR code.

Required service-side checks remain separate: enable and verify branch protection
against the Security verification/secrets jobs; review bypass permissions and
require reviews; enable GitHub secret scanning/push protection where available;
verify operator MFA, Firebase IAM/backups, a monitored alert destination and a
backup operator. Repository files cannot establish those settings. Record Preview
header/browser evidence and actual service-side settings in the rollout issue #47.

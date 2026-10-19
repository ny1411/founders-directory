# Vercel BotID protection

This application uses `botid@1.5.11` as a defense-in-depth gate for four
authenticated, human-initiated operations:

- `POST /company/new` (the `createCompany` Server Action)
- `POST /api/enrich-contact`
- `POST /api/extract-resume`
- `POST /api/generate-dm`

Public directory reads, status polling, static assets, queue callbacks, and
other server-to-server work are deliberately not protected by BotID.

Enforcement is temporarily **default-off** so this code can be deployed before
the Vercel project is provisioned. The server enforces BotID only when
`BOTID_ENFORCEMENT_ENABLED=true`; the browser initializes the challenge only
when `NEXT_PUBLIC_BOTID_ENABLED=true`. Set both variables in the same Preview
deployment, validate the flow below, and later promote both to Production.
Never enable the server flag without the matching public client flag, because
legitimate browser requests would fail closed.

## Request order and failure contract

Each protected server path verifies Firebase credentials first. BotID runs only
for an authenticated request and before request-body buffering, Firestore reads
or writes, durable quota mutations, queue submission, Saleshandy, or Gemini.
The existing handler repeats authentication and remains authoritative for
authorization, quotas, payload limits, idempotency, and other business rules.

BotID responses are stable and contain no proof, token, fingerprint, uploaded
resume, contact data, or generated message:

| Condition | HTTP | Code | Client behavior |
| --- | --- | --- | --- |
| Missing/malformed proof or non-human classification | `403` | `BOT_VERIFICATION_REQUIRED` | Stop; ask the user to refresh once |
| BotID/OIDC/provider failure | `503` | `BOT_VERIFICATION_UNAVAILABLE` | Stop; retry manually after 30 seconds |

Server Actions return the same sanitized message in their existing `{ error }`
shape. There is no automatic retry loop. Logs use only the normalized route and
the bounded outcomes `allowed`, `bot_rejected`, or `verification_error`.

## Required Vercel configuration

BotID needs Vercel OIDC enabled for the project. Production and Preview
deployments must have access to the request-scoped `x-vercel-oidc-token`; do not
store an OIDC token in the repository or expose it to the browser.

The installed SDK also requires its first-party proxy rewrites. The repository
owner for `next.config.ts` must wrap the existing config before deployment:

```ts
import { withBotId } from 'botid/next/config';

const nextConfig = {
  // existing configuration
};

export default withBotId(nextConfig);
```

This wrapper proxies the challenge script through the application domain and
adds the SDK's frame/CSP headers. A deployment without it will fail closed on
the four protected operations.

In the Vercel dashboard, enable BotID for the project. Observe managed Bot
Protection classifications in the Firewall traffic view before adding any
challenge or deny rule. Start in Preview, then enable one Production operation
at a time after reviewing false positives.

After the project, OIDC, and BotID configuration are ready, remove this
temporary default-off feature gate in a follow-up change so a missing or
misspelled environment variable cannot silently disable protection.

## Preview verification

1. Deploy the SDK integration and `withBotId` rewrite to Preview with both
   `BOTID_ENFORCEMENT_ENABLED=true` and `NEXT_PUBLIC_BOTID_ENABLED=true`.
2. Confirm the challenge and proxy paths return `200` through the Preview host.
3. Sign in with a test Firebase account and exercise each operation from a
   desktop browser, a mobile browser, and keyboard-only navigation.
4. Confirm an allowed request reaches the existing quota/handler behavior.
5. Send a request without the browser-generated proof and confirm `403` with no
   Firestore/provider work.
6. Temporarily simulate a BotID service failure and confirm `503`,
   `Retry-After: 30`, and no downstream work.
7. Review `bot_verification` events and BotID classifications for false
   positives before Production enforcement.

Privacy extensions or content blockers can prevent the challenge script from
loading. The UI tells the user to refresh once. If the problem persists, ask
them to allow the application domain for that session; never instruct them to
paste a token or use a query-string bypass.

## Local and automated tests

The SDK's documented local behavior treats requests as human when
`NODE_ENV !== 'production'`. Unit tests inject SDK classifications directly to
exercise human, bot, malformed, and provider-error paths without network or
paid-provider calls. `developmentOptions.bypass` may be used only in a local
process to simulate `HUMAN` or `BAD-BOT`; the SDK ignores it in production, and
the application does not expose an environment-variable, header, cookie, or
query-string bypass.

Preview browser automation must run the real client challenge. If Deployment
Protection is enabled, store `VERCEL_AUTOMATION_BYPASS_SECRET` only in the CI
secret store and use `x-vercel-protection-bypass` plus
`x-vercel-set-bypass-cookie: true` for the initial Preview navigation. That
secret bypasses Deployment Protection, not this application's BotID decision.
Do not send it to Production or add it to application request handling.

Approved server automation must call its dedicated authenticated server-to-
server endpoint (for example the signed queue callback), not replay one of the
human endpoints. This keeps BotID out of background jobs without creating a
public bypass.

## Rollout and rollback

Roll out in this order: resume extraction, message generation, contact
enrichment, then company creation. For each step, watch BotID decisions, route
volume, quota rejections, user reports, and provider usage for at least 24
hours.

During the temporary rollout period, roll back BotID by setting both feature
flags to `false` in the same deployment. After the temporary gate is removed,
roll back an action by removing only that route from client protection and its
server BotID wrapper in the same deployment. Authentication, authorization,
quotas, payload limits, idempotency, and Firewall rules must stay enabled.
Removing only client protection while leaving server enforcement active causes
legitimate requests to fail closed.

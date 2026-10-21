# Expensive API protection (#38)

Contact enrichment is disabled by default. Set `CONTACT_ENRICHMENT_ENABLED=true` only after the following prerequisites are verified in Preview and production:

1. Merge the following deny rules into the existing Firestore rules and audit for overlapping broad allow rules. Firestore grants access if **any** matching rule allows it. These collections must have no direct client read/write access, including authenticated clients. Do not replace existing application rules with this fragment.

   ```
   match /contactEnrichmentJobs/{document=**} { allow read, write: if false; }
   match /apiQuota/{document=**} { allow read, write: if false; }
   match /apiLeases/{document=**} { allow read, write: if false; }
   ```

2. Enable Firestore TTL on the `deleteAfter` timestamp for those three collection groups. Quota windows and leases reuse deterministic hashed keys, but public IP churn and expired contact data otherwise accumulate. Job access expires after 15 minutes; physical deletion is scheduled after 24 hours. TTL is asynchronous.
3. Configure Vercel Queues and deploy the `contact-enrichment` consumer trigger in `vercel.json`. Set a new random server-only `CONTACT_ENRICHMENT_QUEUE_SECRET` of at least 32 characters. Never return this secret/signature to clients, log it, or store it in job documents. The producer signs each queued job ID using HMAC-SHA256 with a versioned topic-specific domain. API and worker remain disabled when the secret is missing/short, even if the enable flag is true.

   **Verify v2 direct-payload delivery in Preview before enabling.** The route requires `ce-type: com.vercel.queue.v2beta`, the exact `contact-enrichment` topic, and a bounded receipt-handle header. It caps the actual streamed JSON body at 4 KiB and verifies its HMAC using a constant-time comparison **before calling the Queue SDK**. The SDK's direct-payload mode does not authenticate the payload before running a handler, so provider credentials or receipt headers alone are insufficient. Unsigned, legacy, and pointer-only callbacks are rejected without calling the SDK or Queue API. There is intentionally no insecure pointer-fetch fallback. If Vercel delivers pointer mode in the selected project/environment, leave enrichment disabled and resolve direct delivery support first. Reconstructed bounded requests preserve event headers for SDK acknowledgment; the SDK handler validates the signature again. Secret rotation invalidates outstanding signed messages, so drain/expire jobs or accept their failure before rotating.
4. Set `SALESHANDY_API_KEY` and the explicit HTTPS `SALESHANDY_BASE_URL`. No dummy defaults are used. Keep these secrets server-only. Confirm provider response matching (`linkedin_url`, or exact first/last name) using a controlled account. Results with no safe identity match return no contact.
5. Validate staged Firewall logging rules before enforcing the API limits. Test anonymous401, duplicate job replay, quota429/Retry-After, private status lookup, and provider failure using mocks before controlled integration tests.

The initiating POST requires a revoked-token-checked Firebase bearer token, company slug, 1–5 IDs (raw input cap, validated/deduplicated), and a stable `Idempotency-Key`. A key is bound to one authenticated user and one normalized founder/company payload; exact retries return the existing job, while reuse with different input returns `409` and cannot start more paid work. The referenced company must contain every requested founder. Any signed-in user may enrich founders belonging to a published directory company; the server never accepts arbitrary provider targets. If entitlement restrictions are introduced, add them to `authorize` before enabling paid access.

The shared Firestore admission allowance is 40 requests/minute/user and 100/minute/IP, including status reads. Paid jobs are limited to 3/hour/user, 10/day/user, and 30/day/IP, with one active job/user. A job contains at most five founders. Quota storage errors return503 rather than bypassing limits; exhaustion returns429 with Retry-After. On Vercel only the platform-overwritten `x-vercel-forwarded-for` identifies IPs; other environments share the `unavailable` bucket.

Jobs, contacts, and status responses are private to their owning user and `no-store`. Contact data is not copied into public founder documents. The initiating request publishes and returns202; delayed queue deliveries perform bounded10-second provider requests and at most15 polls. The paid submission intent is persisted **before** the upstream POST. An ambiguous timeout or crash fails the job and never automatically resubmits that paid POST. Status GETs are safe to retry. A100-second queue retry exceeds the90-second worker lease, allowing crash recovery; expiration makes stale jobs terminal. Inspect failures from queue delivery telemetry rather than silently acknowledging them.

DM drafts have admission limits30/minute/user and60/minute/IP, plus paid-generation limits10/hour/user,30/day/user,60/day/IP. The shared lease covers the versioned user+founder+profile+goal+prompt identity; a concurrent duplicate returns409/Retry-After. The provider timeout is60 seconds and lease120 seconds. Cached results expire after24 hours and invalidate when founder/company data, profile, goal, resume, or playbook version changes. Provider failures count toward paid quotas. No request/provider payloads are logged.

Do not close #38 as operationally complete until the private rules, TTL policies, Queue trigger and staged Firewall rules have been verified in the owning projects.

Queue messages retain at most 15 minutes of retry history, matching the job's
access lifetime. Delayed polling does not create indefinite poison-message retries.

## Authenticated admission policies (#57)

The following origin budgets are always wired through `src/lib/admission-policy.ts`.
They use the same transactional `apiQuota` store and trusted IP derivation as paid
API quotas; missing or failed admission dependencies fail closed. Authentication
runs before UID admission, and admission runs before body parsing or business
Firestore reads/writes. BotID remains an independent control where configured.

| Operation | UID limits | IP limits |
| --- | --- | --- |
| Account sync | 10/minute | 30/minute |
| Profile/onboarding GET | 60/minute shared | 180/minute shared |
| Profile/onboarding writes | 40/minute, 600/hour, 2,000/day shared | 120/minute shared |
| Company submission attempts | 3/hour, 10/day | 10/hour, 30/day |
| Resume upload admission | 5/minute, 30/day | 15/minute, 90/day |

`GET /api/profile` and `GET /api/onboarding` use one read scope. Profile POST/PATCH
and every onboarding POST use one write scope: intent selection, answers, summary,
steps, completion, and resume load/save cannot evade the write budget by using an
alias. `load_resume` additionally consumes the shared read budget before loading
profile/source data. Write rates allow the 1.8-second autosave cadence and brief
interaction/retry bursts, while hourly/daily caps bound sustained automation.
These are starting application policies; review legitimate traffic before tuning.

Resume admission occurs before `authorizeUpload` loads/migrates a profile and
before reading multipart bytes. It is separate from the existing five model
attempts per ten minutes, which is still reserved only after PDF validation.
Invalid/retried authenticated requests consume admission allowance; denied
reservations do not increment any subject's quota. Company limits count submission
attempts including invalid/duplicate-slug attempts; this bounds validation and cache
invalidation attempts without storing untrusted business data.

Quota exhaustion returns private/no-store HTTP 429 with Retry-After; quota-storage
failure returns private/no-store HTTP 503 with a safe retry message. Company
creation is a Next.js Server Action, whose framework transport is not a normal API
429 response: it returns the existing structured error result with `RATE_LIMITED`
or `LIMIT_UNAVAILABLE` code and `retryAfterSeconds`, and the form displays the safe
retry message while retaining input. It does not write or invalidate caches when
admission fails.

Production needs the same server-only `apiQuota` access and `deleteAfter` TTL
prerequisites already tracked in #47. Origin limits do not prevent Function/Auth
or quota-store costs, and anonymous/auth-failure traffic is not counted by these
UID policies. Edge pre-authentication limits and actual Firewall enforcement remain
#40/#47; outside Vercel all callers share the conservative `unavailable` IP bucket.
Do not replace it with client-controlled forwarding headers. No deployment flag
can silently disable these admission checks.

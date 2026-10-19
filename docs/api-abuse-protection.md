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

The initiating POST requires a revoked-token-checked Firebase bearer token, company slug, 1–5 IDs (raw input cap, validated/deduplicated), and a stable `Idempotency-Key`. The referenced company must contain every requested founder. Any signed-in user may enrich founders belonging to a published directory company; the server never accepts arbitrary provider targets. If entitlement restrictions are introduced, add them to `authorize` before enabling paid access.

The shared Firestore admission allowance is 40 requests/minute/user and 100/minute/IP, including status reads. Paid jobs are limited to 3/hour/user, 10/day/user, and 30/day/IP, with one active job/user. A job contains at most five founders. Quota storage errors return503 rather than bypassing limits; exhaustion returns429 with Retry-After. On Vercel only the platform-overwritten `x-vercel-forwarded-for` identifies IPs; other environments share the `unavailable` bucket.

Jobs, contacts, and status responses are private to their owning user and `no-store`. Contact data is not copied into public founder documents. The initiating request publishes and returns202; delayed queue deliveries perform bounded10-second provider requests and at most15 polls. The paid submission intent is persisted **before** the upstream POST. An ambiguous timeout or crash fails the job and never automatically resubmits that paid POST. Status GETs are safe to retry. A100-second queue retry exceeds the90-second worker lease, allowing crash recovery; expiration makes stale jobs terminal. Inspect failures from queue delivery telemetry rather than silently acknowledging them.

DM drafts have admission limits30/minute/user and60/minute/IP, plus paid-generation limits10/hour/user,30/day/user,60/day/IP. The shared lease covers the versioned user+founder+profile+goal+prompt identity; a concurrent duplicate returns409/Retry-After. The provider timeout is60 seconds and lease120 seconds. Cached results expire after24 hours and invalidate when founder/company data, profile, goal, resume, or playbook version changes. Provider failures count toward paid quotas. No request/provider payloads are logged.

Do not close #38 as operationally complete until the private rules, TTL policies, Queue trigger and staged Firewall rules have been verified in the owning projects.

Queue messages retain at most 15 minutes of retry history, matching the job's
access lifetime. Delayed polling does not create indefinite poison-message retries.

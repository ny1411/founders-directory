# Provider resource limits

Gemini resume extraction has one 60-second SDK HTTP attempt, at most 8,192 output
tokens, and a 256 KiB raw JSON guard before JSON parsing. DM generation has one
60-second attempt and at most 1,024 output tokens. Existing schema and message
validation still apply; invalid or truncated responses fail with safe errors.
Provider budgets continue to reserve before the SDK call and never refund
ambiguous/failed paid attempts.

A `resume-extraction:<verified uid>` lease in the existing server-only `apiLeases`
collection permits only one extraction for an owner. It lasts 120 seconds and
uses the existing token-fenced lease implementation. Valid PDFs acquire this
lease before consuming the extraction-attempt allowance or provider budget;
duplicate work returns 429 with Retry-After. Lease storage failure returns 503
without provider calls. The allowance, provider work, and output validation are
inside a finally release; failures are safe, bounded audit events. A failed
release/crashed process recovers through logical lease expiry, independently of
asynchronous Firestore TTL deletion. Before SDK submission, the handler verifies
that at least the complete SDK timeout remains in the lease, including quota
storage latency. There is no application Promise.race that releases a Gemini
lease while an uncancelled generation continues.

Saleshandy uses one ten-second deadline covering fetch headers and streamed
response data. Decoded response bytes are capped at 256 KiB regardless of
Content-Length, and overflow/deadline failures cancel the reader. HTTP failure,
invalid JSON, oversized responses, and invalid shapes produce fixed errors with
no provider body. Only bounded request/status/result fields needed by the worker
survive validation; unknown fields are discarded. Up to 100 result records and
20 email entries per record fit within the byte cap; the existing worker still
returns only results belonging to the job's maximum five requested founders.
Paid POSTs are never automatically retried. Existing bounded GET polling can
retry safe read failures without creating another paid submission.

These are application limits. Provider account quotas and platform rate limits
remain complementary operational controls. Changing these constants requires
review of expected resume size, output quality, lease duration, and paid work
budgets. No production account/configuration changes are needed for this code.

Isolated checks (no provider credentials or calls):

```bash
node --import tsx --test scripts/security/provider-resources.test.ts scripts/security/resume-extraction.test.ts scripts/security/provider-budget-wiring.test.ts src/lib/enrichment-worker.test.ts
```

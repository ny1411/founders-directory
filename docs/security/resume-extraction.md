# Resume extraction protection

`POST /api/extract-resume` requires a Firebase ID token in the `Authorization: Bearer ...` header. The server verifies the token, including revocation, and checks for an active job-search goal before reading the upload. Non-job profiles receive HTTP 409 without incurring model charges. The profile page obtains the token from the signed-in Firebase user.

Uploads must contain exactly one `file` part with MIME type `application/pdf`, a PDF signature (`%PDF-`), and at most **5 MiB**. The server bounds the entire multipart body to **5 MiB + 64 KiB**, including chunked requests without a Content-Length header. The signature check is a format guard, not a complete PDF integrity parser; Gemini remains responsible for reading the document.

A Firestore transaction reserves at most **5 extraction attempts per user per 10-minute window** before a model call. The counter is stored in `resumeExtractionUsage/{sha256(uid)}` and reused across requests and server instances. The window starts at the first reserved attempt; failed model calls count against the allowance because they may still incur charges. Invalid or oversized uploads do not consume model allowance. A failure to read/write the counter fails closed with HTTP 503. No new credentials, indexes, scheduled cleanup, or external service are needed. The deployed service account needs permission to transact on that collection, and browser Firestore access to it should remain denied by the project's rules.

Rate rejection returns HTTP 429 with `Retry-After`. Authentication, malformed uploads, size, and format errors return 401, 400, 413, and 415 respectively. Provider failures return 502 with a safe message. Rejected uploads and provider failures do not update saved resumes or overwrite the profile editor's existing content.

Model output is validated against the resume schema, including list/item types, bounded text, meaningful content, and HTTP(S) links. Empty objects and malformed extractions are rejected before persistence. Success returns structured `{ resume: ResumeData }` and atomically saves a private source with a PDF content hash, model/schema versions, and upload-consent metadata. No original PDF bytes are retained. Prefills preserve user edits; only job message generation reads the complete private source. Browser Firestore access to user source documents should remain denied. See [onboarding architecture](../onboarding.md).

Run isolated verification without contacting Firebase or Gemini:

```sh
npx tsx --test scripts/security/resume-extraction.test.ts
npx tsc --noEmit
npm run lint
```

The tests inject fake token verification, Firestore transactions, and model extraction into the same request handler used by the production route. They cover authentication ordering, bounded uploads, format checks, rate rejection and failure, shared counters, out-of-order instance clocks, transaction retries, and successful extraction. They do not verify live Firebase rules, credential setup, or billable Gemini behavior.

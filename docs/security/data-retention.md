# Private data boundaries and retention

Public company pages pass an explicit founder allowlist into rendering and client
props. Email, phone and future internal fields are excluded from HTML/Flight.
After sign-in, the Email action reads existing contact details through
`POST /api/founder-contact`: revoked tokens are checked, user/IP quotas precede
business reads, and the founder must belong to the requested company. Responses
are always `private, no-store`. A missing email may proceed to the separately
protected enrichment flow. This endpoint never calls a paid provider.

Onboarding recovery stores changed answers and only a changed summary under a
versioned user key for at most 24 hours. Auth callbacks clear drafts belonging
to other accounts, and sign-out clears all onboarding drafts. A session owner
gate prevents late old-account requests from recreating a cleared draft.
Storage failures disable recovery rather than bypassing the owner gate. Browser
storage is a recovery aid, not a secure vault: shared-device users should sign
out, and scripts running on the same origin can access it. Resume editor drafts
stay in component memory. Account-keyed profile/message components unmount old
private state before another account renders.

## Firestore retention for new writes

Generated messages retain the existing 24-hour logical expiry and now have a
native timestamp `deleteAfter` field for physical TTL cleanup. Logical expiry
must continue to be enforced even when Firestore TTL cleanup is delayed.

An active resume source has `deleteAfter: null`. Replacing it stamps the previous
source with `supersededAt` and a timestamp `deleteAfter` 30 days later. Selecting
the same content-hashed source again clears its TTL field in the same profile
transaction (including A → B → A edits). Only that verified owner's source path
is affected. Raw PDF bytes are never stored. Historical source pointers may
eventually refer to a removed document; the application must tolerate absence.

The proposed 30-day history policy and activation of physical deletion need
operator/product review before enabling TTL. This change does not activate TTL,
run a live migration, or delete existing data.

## Explicit rollout and existing records

1. Review the 24-hour message / 30-day superseded-resume policies and any legal
   retention requirements. Confirm the actual deployed Firebase project.
2. Audit collection-group `sources` consumers before applying TTL: the field
   must only be populated for superseded sources; active sources use null.
3. Enable Firestore TTL on `generatedMessages.deleteAfter` and
   `sources.deleteAfter` only after policy approval. SDK Date values become
   Firestore timestamps; ISO date strings are not TTL timestamps.
4. Design a separate read-only migration report for legacy message/source
   documents. For every user, preserve the currently referenced source. Do not
   infer safe deletion only from `importedAt`, a content hash, or `derivedFrom`.
5. Review that report and a separately authorized bounded migration before
   adding deadlines to historical records. Confirm backups and rollback needs;
   TTL deletion itself is irreversible. Legacy `users.resumeText` also needs an
   explicit reviewed migration; do not silently bulk-delete it here.
6. Verify expired messages are not served and observe TTL cleanup in staging,
   including reactivation of old resume content. Confirm public caches have
   expired/revalidated after removing contact props from the deployed page.

## Owner export and deletion design

Export/deletion must be a separate authenticated operation with revoked-token
checks and recent-auth confirmation for destructive requests. Derive the owner
from the verified token; never accept a body-supplied uid, collection path, or
document ID as authorization. Exports should stream bounded pages from that
owner's profile, goals and sources plus generated messages filtered by userId,
with `private, no-store`; exclude other users' messages and quota/lease secrets.

Deletion should first mark the verified owner as deleting and block new private
writes, then remove that owner's derived messages, sources and recovery data in
bounded resumable batches. Remove profile/source references only with the
corresponding owner state update; do not modify founder/company records. Use
server-maintained progress, idempotency and privacy-safe aggregate audit counts.
This repository change does not expose a deletion endpoint or perform deletion;
the workflow and existing-data policy require separate review and acceptance
tests for ownership, interruption and retries before release.

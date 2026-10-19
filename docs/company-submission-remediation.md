# Existing company data: audit before remediation

New manual submissions validate every known company/founder field, store blank optional fields as null, and use the scraper's deterministic `companies/{slug}` ID. A Firestore transaction checks both that ID and a slug query before creating the company and founders. This prevents races between manual submissions and the existing scraper, and detects older random-ID records with the same slug. No existing document is updated by submission.

`stage` uses the scraper's existing nullable string field. Legacy company reads tolerate an absent stage; blank or omitted new submissions persist null.

## Read-only audit

Use an authorized, read-only export of `companies` as a JSON array, retaining each document's actual `id`. Keep exports outside the repository. This change intentionally performs no live reads, writes, or automatic migration.

```
npx tsx scripts/company/audit-submissions.ts /path/to/companies.json
```

The command reads only that local file and prints invalid fields and duplicate canonical slugs. It flags invalid employee counts (including JSON-serialized NaN as null only where represented as text), malformed URLs, missing/overlong names, invalid years, stage lengths, and slug casing/duplicates. A historical NaN serialized as JSON null cannot be distinguished from an intentional null; inspect the Firestore export's typed values when investigating that case. Review founder records separately using the same validation limits before any correction.

## Nondestructive remediation plan

1. Take a restorable backup and retain original IDs and values in a private review artifact. Run the audit. Review duplicate groups with a human; do not automatically select or delete a winner.
2. For each duplicate slug, identify the canonical company and all related founders via `companyId`. Preserve its existing document ID. Assign a distinct, reviewed slug to unrelated companies. For genuine duplicate entities, review all differing fields and references before preparing a merge; retain source documents and a reversible mapping until references have been verified.
3. Review noncanonical/invalid slugs before accepting new submissions that could collide after normalization. Plan explicit redirects for any existing public URL changes. Never rename document IDs in place or silently replace a company at an occupied deterministic ID.
4. Correct invalid counts from a verified source; do not infer `50` from `50-100`. Use null when unknown. Replace invalid URLs only from verified sources. Preserve original values in the private review artifact. Stage remains null when unknown.
5. Prepare a separate reviewed migration with a dry-run diff, transaction preconditions on old values, small batches, and a rollback mapping. Pause company writes during legacy slug remediation and require every future importer/writer to use the deterministic-ID transaction pattern. Rerun the audit and verify founder references and public detail pages before resuming writes.

This PR does not change existing data or deploy database rules. Server submissions use authenticated Firebase Admin access; preserve the existing public/client write restrictions when configuring Firestore.

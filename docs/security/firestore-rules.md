# Firestore client isolation

Issue: #58. Deployment and TTL follow-up: #47.

The versioned rules deny every direct Firestore client read and write, including
authenticated owners and tokens with administrator claims. Public pages remain
public through the Next.js server; public visibility does not require public
Firestore SDK access.

## Access inventory

The browser uses Firebase Authentication. `src/lib/firebase.ts` initializes and
exports a Firestore client, but no application consumer imports that `db` or
performs Firestore client operations. All current persistence uses the trusted
Admin SDK:

| Data | Server access |
| --- | --- |
| `companies`, `founders` | Directory/company loaders, sitemap, validated company action, scraper and enrichment target loaders |
| `users/{uid}` | Auth sync and onboarding store |
| `users/{uid}/profiles`, `/goals`, `/sources` | Owner-scoped onboarding/resume handlers |
| `generatedMessages` | Authenticated DM generation handler |
| `contactEnrichmentJobs` | Owner-scoped status/creation and signed worker callback |
| `apiQuota`, `apiLeases`, `resumeExtractionUsage` | Server admission, concurrency and usage reservations |
| Unknown collections or deeper subcollections | Denied to direct clients by the recursive catch-all |

These rules are a prototype for the repository's current server-only access
model. They do not add a rules-level admin role or trust client-provided UID,
owner, role, or custom claims. They deliberately do not define client schema
validators: no client create or update is permitted at all. Existing field
validation and authorization remain in server handlers. Admin SDK access bypasses
Firestore Security Rules and depends on IAM/service-account protection and those
handlers; these rules cannot repair an insecure server endpoint.

No live database edition or deployed policy was inspected or changed. The local
Firestore emulator compiles the rules and tests their Firebase Rules semantics.
Before applying them, verify the target database's edition/mode supports this
rules model and inventory any clients outside this repository.

## Reproduce the authorization tests

Prerequisites: Node.js 20+ compatible with Firebase CLI 15.34.0, npm, Java 21+,
Linux/macOS or WSL, and an unused loopback port 8080.

```sh
node scripts/security/run-firestore-rules-tests.mjs
```

The runner obtains version-pinned `firebase-tools@15.34.0` using `npm exec`, so
the application dependency graph and lockfile are unchanged. The first run
requires package-registry and official emulator-download network access. For
offline CI, provision the CLI/npm cache and Firebase emulator artifact cache
through the normal verified toolchain first. The runner times out after five
minutes and exits unsuccessfully on launch, emulator compilation, or test failure.
Native Windows is explicitly unsupported; use WSL instead.

`firebase.json` binds only Firestore to `127.0.0.1:8080` and disables its UI. The
runner uses the fixed `demo-founders-security` project and strips inherited
Firebase/Google project and credential environment variables. Tests refuse to
run unless the CLI exports that demo project and the exact loopback endpoint.
They use the emulator REST API and unsigned emulator-only user tokens, never
production credentials or real Firebase Auth tokens.

The `owner` bearer token is the emulator's trusted Admin bypass for seeding and
verifying fixtures. It is distinct from the ordinary `alice` owner test user.
Successful Admin reads/queries prove that trusted server access still works;
the bypass is never used for client assertions. Emulator fixtures are disposable
and are not exported or written to production.

The suite checks:

- Anonymous, document owner, other-user, and claimed-admin principals cannot
  get, list, create, update, or delete documents in every listed collection.
- Nested/orphaned user subcollections, unknown collections and collection-group
  queries stay denied.
- Quota resets, lease takeover, ownership/role changes, schema pollution,
  oversized fields and forged completed-job states stay denied.
- A denied mixed batch leaves its writes unapplied.
- Trusted Admin fixture creation, document reads, and directory queries work.

Rules syntax is validated by the actual emulator compilation, not a text-based
mock. This suite is separate from `npm run test:security` because it requires
Java and an emulator process.

The focused `.github/workflows/firestore-rules.yml` runs this command on rules,
emulator configuration, runner, test or workflow changes and supports manual
dispatch. It uses Node 22/Java 21, read-only repository permissions, no secrets,
and no deployment step.

### Verification on 21 October 2026

All eleven tests passed against the official Google Cloud SDK Firestore emulator
1.22.0, with `--database-edition=standard`, `--rules=firestore.rules`, strict
single-demo-project mode and the loopback endpoint. This exercises more than 300
individual denied operations plus trusted Admin access and batch atomicity.

The Firebase CLI's download from `storage.googleapis.com` was denied by this
workspace's network policy. For local validation, the same-version official
Cloud SDK component was obtained from its allowed `dl.google.com` distribution:

- Manifest: `https://dl.google.com/dl/cloudsdk/channels/rapid/components-2.json`
- Archive: `components/google-cloud-sdk-cloud-firestore-emulator-20260717053915.tar.gz`
- Archive SHA-256 verified against that manifest:
  `e962450b637827664094959571fd92c3680de863936bd481bd0a050f76ca91ba`

The SDK JAR is a different packaging of emulator 1.22.0 and was launched using
its shipped `com.google.cloud.datastore.emulator.firestore.CloudFirestore` entry
point; it was not substituted into Firebase CLI's artifact cache. The committed
runner continues to use the CLI's expected official artifact for reproducible
CI. Node syntax checks and `git diff --check` also passed. No deployed rules or
production resources were accessed.

## Deployment and rollback boundary

Do not deploy solely because the local suite passes. Before a separate reviewed
deployment:

1. Confirm the correct project/database and edition; export or save the existing
   deployed rules and identify any external SDK clients using them.
2. Compare the entire ruleset. Firestore permits a request if **any** matching
   allow succeeds; adding a deny fragment cannot override an existing broad
   authenticated or recursive allow.
3. Review this complete server-only policy against all real consumers, and run
   the emulator tests plus authenticated/anonymous Preview application smoke
   checks using the existing Admin-backed APIs.
4. Deploy only the reviewed rules in the owning project, with rollback to the
   saved prior version. Record the release and verification in #47.
5. Separately enable and verify `deleteAfter` timestamp TTL for `apiQuota`,
   `apiLeases` and `contactEnrichmentJobs`. Rules do not activate TTL, provision
   indexes, or change IAM. Keep enrichment disabled until its other prerequisites
   are verified.

If direct client access becomes a product requirement, change the access design,
schema/owner validators, and emulator tests together. Do not add a general
authenticated allow as an error workaround.

## Rules-auditor assessment

```json
{
  "score": 5,
  "summary": "The repository's server-only access model is enforced with recursive default-deny. This assessment covers the proposed rules, not deployed rules or Admin handler/IAM security.",
  "findings": []
}
```

I've set up prototype Security Rules to keep the data in Firestore safe. They
are designed to be secure for this server-only access model because every direct
client read and write is denied, including owner and privileged-claim requests.
However, you should review and verify them before broadly sharing your app. If
you'd like, I can help you harden these rules.

# Intent onboarding

After login, `/profile` restores the active goal and its saved step. Job seekers upload a PDF before answering questions; the other three intents start with shared questions. Users can edit their profile, summary, or resume after completing onboarding, and change goals without deleting previous answers.

## Persistence and concurrency

- `users/{uid}` stores the active goal ID and onboarding status.
- `users/{uid}/profiles/default` stores shared answers, the profile version, and a pointer/hash for the private resume source.
- `users/{uid}/goals/goal-{intent}` stores intent answers, questionnaire version, revision, progress, summary, and confirmation. The older `primary` ID remains readable.
- `users/{uid}/sources/resume-{contentHash}` stores the validated extraction, schema/model versions, import/consent metadata, and retention policy. Raw PDF bytes are never stored. Parsed sources remain private account data; account deletion tooling must include these subcollections.

All updates use Firestore transactions. Mutations carry the active goal ID, profile version, and goal revision. A stale tab receives HTTP 409 rather than replacing newer answers. Legacy `resumeText` migration is transactional and keeps the original data. Switching intent archives the previous goal and restores the selected goal's existing answers.

An answer edit or resume replacement invalidates summary confirmation. Outreach requires a current questionnaire, all required answers, a reviewed summary, and confirmation against the current profile version.

## API

All endpoints require a Firebase bearer token; the server verifies revocation and derives ownership from the token.

`GET /api/onboarding` and `GET /api/profile` return the public profile projection, active goal, readiness, and questionnaire definitions. They do not return raw resume extraction. The original legacy resume field is used only during migration.

`POST /api/onboarding` accepts these actions:

- `select_intent`: `intent`, `stage`, and the current `activeGoalId` (or null for a new account).
- `save_answers`: a patch of answers keyed by stable question IDs.
- `set_step`: a valid next/back/edit step.
- `save_summary`: a draft summary, including an empty draft while editing.
- `complete`: confirm a nonempty summary from the review step.

Every action except `select_intent` must include `goalId`, `profileVersion`, `goalRevision`, and `questionnaireVersion`. `PATCH /api/profile` (and its POST alias) accepts the same context and an `answers` patch restricted to shared profile questions. Writing `resumeText` is no longer supported.

`POST /api/extract-resume` accepts a bounded PDF multipart upload for job goals and returns `{ resume: ResumeData }`. The validated extraction is persisted before success is returned. Imported facts prefill shared and job questions; replacing a resume updates previous automatic prefills while preserving explicit user edits.

`POST /api/generate-dm` reads the confirmed goal and, for job introductions only, its private resume source. Message cache identity includes owner, goal/intent, target, profile/goal versions, resume hash, questionnaire/playbook versions, channel, and action. Cache lookups use deterministic document IDs, so no new composite indexes are needed.

## Client saving

The onboarding form maintains a local draft separately from the last server snapshot. One save queue drains edits made during earlier requests. Forward/back navigation, goal changes, logout, and confirmation wait for that queue. Summary edits also autosave. Failed requests keep the draft available for retry; a browser unload warning protects changes that have not finished saving.

## Verification

```sh
npm run test:onboarding
npm run test:onboarding:browser
npx tsx --test scripts/security/resume-extraction.test.ts
```

The browser suite bundles the production onboarding form and exercises the production handlers/store through a local HTTP server. Firebase token verification and the paid extraction model use fixtures; Firestore operations use a transactional in-memory implementation. It covers all four intents, PDF-first branching, refresh/resume, summary edits, post-completion editing, goal switching, saves during typing, immediate back navigation, and failed-save retry. It does not claim live OAuth, deployed Firebase rules, or billable Gemini verification.

For styled screenshot evidence, build first, then set `ONBOARDING_SCREENSHOT_DIR` to an existing directory outside the repository. Browser QA uses Playwright because the Browser plugin is unavailable in this environment.

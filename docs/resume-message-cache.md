# Resume changes and generated messages

Job introduction drafts use a deterministic cache identity containing the user,
founder, profile version, goal revision, resume content hash, questionnaire version,
playbook version, and available target update timestamps. Saving a different PDF
or corrected resume data changes that identity. The next confirmed request for the
same founder generates a new draft using the current private resume source.
Repeated requests with unchanged context reuse that new draft.

Resume saves invalidate summary confirmation. Until the updated profile is
reviewed and confirmed, message requests return HTTP 409 before cache lookup or
generation. Saving the source does not make unreviewed evidence available to the
message generator.

Invalidation is logical: old drafts are not deleted during the resume save.
Historical documents created with random IDs and only a user/founder pair are
ignored because the API reads only the current deterministic document ID.
Versioned drafts have a 24-hour expiry checked on read. Firestore TTL cleanup is
operational housekeeping; cache correctness does not depend on physical deletion.

Run `npm run test:onboarding` for the regression in
`src/lib/onboarding/resume-message-cache.test.ts`. It exercises real onboarding
handlers and `OnboardingStore` with in-memory Firestore and a deterministic
generation stub. Both PDF replacement and manual data correction must refresh a
same-founder draft even when questionnaire answers remain unchanged, ignore a
matching legacy document, and reuse the new draft without another generation.
No database credentials, deployed project, or paid model calls are required.

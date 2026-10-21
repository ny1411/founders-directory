# Dependency security remediation (#56)

Reviewed against the npm advisory registry on 21 October 2026. Audit counts are
vulnerable package entries, including transitive/metavulnerability entries, and
are not counts of demonstrated exploitable application flaws.

## Runtime prerequisite

**Use Node.js 22 or newer for local development, CI, and Vercel builds/runtime.**
Firebase Admin 14 requires Node 22; this is declared in `package.json` engines.
Confirm the owning Vercel project's Node version before deploying this branch.
The verification environment uses Node 24.19.0. This change does not alter any
deployment setting or deploy the application.

Firebase Admin 12/13 retained older Google client/UUID dependency branches.
Updating to Admin 14.5 removes those vulnerable branches without an unsafe
cross-major UUID override. This app uses the supported modular Admin
initialization, Auth and Firestore APIs. Firebase browser SDK stays on its
existing major version.

## Changes and rationale

| Dependency | Before | Resolved after | Reason |
| --- | --- | --- | --- |
| Next.js | 15.5.20 | 15.5.28 | Patch Server Action, image optimization and cache advisories while remaining on Next 15 |
| eslint-config-next | 16.2.10 | 15.5.28 | Match framework major/patch; adapt legacy presets to ESLint 9 with FlatCompat |
| Firebase browser SDK | 12.16.0 | 12.19.0 | Compatible maintenance refresh |
| Firebase Admin | 12.7.0 | 14.5.0 | Replace vulnerable Admin/Google/UUID dependency branches |
| sharp | 0.34.5 | 0.35.5 | Patched image-parser dependencies, supported by Next 15.5.28's optional dependency range |
| shadcn | 4.13.0 | 4.22.1 (development) | Update CLI dependencies and keep build-time CSS/CLI out of production-only installs |

The complete compatible dependency graph was refreshed in the lockfile, including
`undici`, MCP SDK, Hono, `proxy-addr` and parser dependencies. No
`npm audit fix --force`, downgraded framework, audit exclusion or advisory
suppression was used.

Two overrides are intentional:

- `next > postcss: ^8.5.23`: Next 15.5.28 still pins PostCSS 8.4.31. Require a
  patched PostCSS 8 maintenance version; the lockfile resolves 8.5.31. Remove the
  override when the supported Next release no longer pins a vulnerable version.
- `@grpc/grpc-js: ^1.14.5`: browser Firebase still resolves an older gRPC 1.x
  dependency with certificate-validation/error-disclosure advisories. Use a
  patched release within the same gRPC major (1.14.6 in this lockfile), rather
  than accepting npm's unrelated Firebase downgrade suggestion. Remove the
  override once all supported parents request patched gRPC versions.

`shadcn/tailwind.css` is imported by `src/app/globals.css`, so shadcn is still
required during the build. Build with development dependencies installed; the
generated CSS/application does not execute the shadcn CLI at runtime.

## Audit results and remaining work

| Audit | Before | After |
| --- | --- | --- |
| All dependencies | 2 critical, 27 high, 12 moderate (41 total) | 9 high, 0 critical/moderate |
| Production dependencies | 2 critical, 25 high, 12 moderate (39 total) | 0 vulnerabilities |

The nine remaining development package entries trace to one advisory:
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
stack exhaustion when `braces <=3.0.3` parses deeply nested patterns. npm's latest
published braces is 3.0.3; no patched compatible release is currently available.
The affected paths are ESLint's Next plugin and the shadcn/registry/ts-morph
toolchain through fast-glob/micromatch. These tools are not imported by application
handlers, and production-only installs do not contain the affected graph.

This remains a build/development risk: do not run lint/component-generation tools
on untrusted patterns or projects in a privileged environment. Recheck the
advisory and parent releases during dependency maintenance, upgrade as soon as
compatible fixes exist, and retain least-privilege CI. An audit gate for every
high development advisory must explicitly account for this outstanding upstream
finding rather than silently ignoring it. Broader security CI is tracked in #64.

Reproduce the dependency checks with:

```sh
npm ci
npm audit --package-lock-only
npm audit --package-lock-only --omit=dev
```

The full audit intentionally continues to exit nonzero for the documented
development finding. Audit results are time-dependent; rerun them before release.

## Verification

Verified on Node 24.19.0:

- `npm ci`: passed from the committed lockfile.
- `npx tsc --noEmit --incremental false`: passed.
- `npm run lint`: passed.
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:security`: 98 security tests and
  four Firewall manifest tests passed, including BotID and browser JSON-LD tests.
- `npm run test:onboarding`: 35 passed.
- `npm run test:filters`: 33 passed.
- `npm run test:scraper`: 12 passed.
- Additional account-sync, company-validation/query and directory-request tests:
  22 passed.
- Native sharp AVIF-to-PNG round trip: passed with sharp 0.35.5.
- `npm run build`: passed; homepage retains hourly ISR, company pages retain SSG,
  and protected API routes remain dynamic.
- `git diff --check`: passed.

The regression tests use isolated Firebase/provider boundaries. The build used
read-only Firestore data for public static pages. No paid model/enrichment calls,
production data mutations, rules changes or deployment changes were made.

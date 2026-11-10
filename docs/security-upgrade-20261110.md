# Security compatibility release — 10 November 2026

Status of this committed report: **local qualification complete; publication is
conditional on green CI for the exact release revision and post-release checks**.
This document records the pre-publication qualification, not a claim that a READY
deployment already serves the public domain.

The approved scope is the full technical upgrade in the reviewed plan, including
the already committed receiving/print improvements. Baseline source is
`850d4c2ad4e99cb72008306ca64b7af013d95548`; the production site still serves
`ecf64c68d423ac0f8f547fea3f4eccaab9cd070e` until the qualified release passes CI.
No changes to accounting policy, workflow layout, tariff entitlements, customer
records or the five protected lifetime organizations are authorized by this release.

## Required completion audit

| Requirement | State | Evidence / remaining work |
| --- | --- | --- |
| Preserve baseline and measure opening dashboard, POS, products and receiving | Captured | Isolated compiled Next 14 baseline; 16 navigation samples; desktop/mobile screenshots |
| Inventory all original dependency findings and previous exceptions | Captured | 128 unique advisories / 47 package versions / 162 matches, with dependency owners |
| Select and adapt compatible patched packages | Locally qualified | Next 15, React 19, next-intl 4, Zod 4, Vitest 4, Capacitor 8 patch and owning-package fixes |
| Preserve authentication, tenant/store isolation and plan gates | Local checks passed; CI required | Promise-only request APIs, JWT revocation, existing role/store/plan regressions |
| Preserve money, inventory, receiving recovery and payment idempotency | Local checks passed; CI required | Full regression and 20 receiving browser scenarios; disposable PostgreSQL/Redis only; providers disabled |
| Verify every existing test plus meaningful compatibility regressions | Local checks passed; final CI required | Full initial execution plus explicitly recorded superseding reruns; no deleted test or weakened assertion |
| Check types, lint, translations, production build and complete security scan | Local final checks passed; CI required | Fresh final build, types, lint, translations and frozen offline install; real nonempty inventory; only two conditional publisher-range exceptions |
| Compare relevant desktop/mobile visuals in RU/KG/EN and both themes | Local checks passed | 20 receiving scenarios per version, 6 purchase-order states, 16 theme states and a warm-cache PWA transition; screenshots inspected |
| Verify native Android/iOS and Linux worker builds | Pending CI | Updated Node 22 and Capacitor patch; no signing credentials collected |
| Verify unchanged lifetime-free organizations | Pending final read-only comparison | mpo.kg, roksosh, skladondemand, Avant, Catwalk |
| Publish only exact qualified revision and verify production | Pending | Existing deployment gate stays enabled; no business-data migration required |
| Stop owned QA services and remove disposable heavyweight data | Pending | No unrelated local services or customer backups may be deleted |

Detailed local evidence is stored in `.local/qa/security-upgrade-20261110/` and
the preceding receiving verification directory. Local evidence is not deployed.

## Application and compatibility verification

The migration awaits request cookies, headers and dynamic parameters rather than
using Next 15's temporary synchronous bridge. Existing tenant/role revalidation,
revoked-session rejection, route access, dynamic responses and explicit image cache
policy remain. No database schema or business-data migration is introduced.

Zod input/output types, error mapping and native JSON schema conversion were adapted
without changing domain limits. A baseline/candidate comparison of **49 Baam actions
and 147 localized workflow field arrays has zero differences**; **628 focused tests
in 30 files pass**. Raw `__proto__` rejection is retained before Zod 4 can discard the
key. Blank, omitted, zero and fractional values are tested separately. Existing
discount validation is asserted by its stable issue/path/constraint rather than an
upstream English default sentence.

The first complete local run executed **4,285 tests in 487 files**: 4,274 passed,
eight failed and three were skipped. Seven failures were isolated QA connection
pool starvation during deliberately concurrent transactions; changing only the
disposable runner's pool from three to eight produced **72/72** passes in the three
affected files. The eighth was the upstream Zod error-sentence assertion; the
corrected four-test contract suite passes. The three skipped tests are PgBouncer
checks run separately by the mandatory CI pooling job, not external provider tests.
Five new purchase-order regression tests also pass. After the final image-security
and slug tests supersede whole-file results, the deduplicated combined local result
is **4,343 passed, three separately assigned pooling checks, zero unresolved
failures, 490 files**. This is not presented as a single fresh full run;
the final CI must execute the complete candidate afresh. Additional targeted runs
overlap this total and must not be added to it as unique tests.
The core CI job explicitly uses the same eight-connection disposable pool instead
of deriving a smaller pool from runner CPU count; production pooling is untouched.

Other local qualification includes **123 request/runtime/component tests**, real
React 19 chart fragment rendering, Query subscription recovery and Radix focus
lifecycle, four dependency-consumer checks, **48 print checks** and **54 release
control checks**. Types, lint, translations and the standalone production build
pass. QZ Tray remains at the original exact 2.2.6: its unnecessary semver refresh
introduced an optional unresolved `lna` import; retaining the scanned-compatible
baseline avoids changing printer behavior during the framework migration.

### Demonstrated purchase-order defects found during acceptance

The old compiled version was tested before applying these corrections. Selecting
a pack of six twice at 4.25 per base unit displayed 8.50 in the new-order form,
although the persisted quantity was correctly 12 and the detailed order displayed
51.00. Product-selection cache updates had discarded pack metadata. The selection
now preserves the already loaded metadata; schema-parsed watched quantities also
drive the live presentation. Existing server calculations and persistence remain.

Native number inputs now explicitly permit the existing three-decimal quantity
contract. A stale delayed blur callback is cancelled on refocus/close/unmount so
rapid product selection cannot close the newly reopened search. Existing picker
layout, actions, fractional limits and delayed blur behavior remain.

The actual purchase-order create/detail/edit flow passes **six browser states**
(RU/KG/EN at 1440 and 390 pixels), covering blank, zero, fractional and pack rows,
66.00 -> 69.90 totals, 12 persisted base units and unchanged inventory, prices and
subscription records. Browser/page/HTTP errors are empty in that run.

### Speed comparison

These are local single-user measurements on the isolated data, not a capacity
promise or a 50-client load test. The three warm navigation samples per route have
median response times before/after of dashboard **26/33 ms**, POS **28/29 ms**,
products **28/23 ms**, receiving **24/18 ms**. The small dashboard delta lies within
the observed cold/warm/local run variability and is not an unexplained broad
regression. The same 43 product-search requests have median **10/7 ms** and 29
receiving previews **23/10 ms**. The single measured committed receiving request is
**374/350 ms**; one sample cannot establish a performance percentile.

Raw artifacts: `local-regression-audit.json`, the named JSON test reports,
`browser-before/`, `browser-after/`, `purchase-orders-browser/` and
`performance-comparison.json` in the ignored local evidence directory.

## Existing CodeQL alerts reviewed before publication

The baseline also contained **12 open CodeQL alerts**, independently of the 128
dependency advisory IDs. They were individually reviewed against main, not assumed
resolved because the analysis job was green. See the full
[CodeQL review](security/codeql-review-20261110.md).

Two actual image-fetch SSRF paths are corrected: the authenticated image-source
endpoint no longer accepts a trusted-looking pathname on an arbitrary host, and
export no longer fetches unsanitized stored private URLs. The shared bounded HTTP
transport checks every redirect and DNS answer, pins the validated connection
addresses and retains HTTPS hostname/certificate verification. Managed local files
remain available through canonical filesystem containment rather than a loopback
network exception; legitimate public imported-photo URLs remain exportable.
**58 route/transport tests pass**, including real local fixtures and ZIP delivery;
the existing public catalogue proxy's **44 tests also pass**. A read-only production
aggregation confirmed that stored image-origin families remain compatible; image
paths and customer identities are not retained in the report.

The third true algorithm finding, modulo-biased public slug generation, now uses
bounded cryptographic sampling with the same 12-character format and alphabet;
existing links are not regenerated. Three focused tests pass. The other nine alerts
are specifically reviewed synthetic legacy-protocol fixtures or custom-guard/value
classification findings. No CodeQL rules, alerts or dataflow paths were globally
suppressed; no GitHub alert was dismissed during this release. The new exact-commit
analysis and any new locations must still be checked after CI.

## PWA transition and visual limits

An actual warm Chromium Service Worker was loaded from compiled Next 14.2.35, then
the same loopback origin was switched to the new 15.5.29 standalone server. The old
client read the new session API, the new bundle loaded after reload, and the existing
one-shot receiving-to-product-form draft handoff restored quantity 3 / cost 123.45
exactly once. Business fingerprints matched and page/proxy/HTTP errors were empty.
Private API responses remain excluded from the static cache. This is a migration
probe, not a newly added general receiving autosave feature.

Light/dark before/after checks cover receiving and purchase-order forms at 1440 and
390 pixels (**16 states**), retaining column proportions, mobile navigation and
action placement. Viewport screenshots avoid treating full-page captures of fixed
headers as application layout defects. Chromium mobile emulation does not prove a
physical iPhone keyboard or every installed iOS PWA state; no such claim is made.

## Release and recovery conditions

The existing exact-revision Vercel release gate remains enabled. Native Android,
iOS Simulator, Linux worker, database pooling, browser, full regression and security
jobs must all succeed before publishing. The already running site and Render worker
are both on `ecf64c68d423ac0f8f547fea3f4eccaab9cd070e`; READY candidates with no public
alias are not counted as publication. The worker's existing checks-passed auto-deploy
is observed rather than creating a duplicate paid service or deployment.

After CI, verify the public version and health, the protected route redirects,
unpublished legal pages, the worker's actual live revision and the read-only
commercial fingerprints of all five protected lifetime organizations. No business
migration accompanies this upgrade, so returning application/worker code to the
recorded previous deployment does not require restoring or deleting customer
business data. That emergency fallback would temporarily restore its older security
exposure and is not a substitute for finishing the patched release.

Provider activation flags, GoPay Test/Live status, keys and merchant onboarding are
not changed by this technical release. Runtime publication, final protected-access
comparison and cleanup are recorded in the final release result after the commit
has passed the above gates.

## Dependency evidence

The completed dependency-only scan covers **1,010 final package versions**, compared
with **1,346** in the baseline. All **47 affected baseline package versions** are
absent from the final graph. The original **128 advisory IDs / 162 package-advisory
matches** are traced individually to their owners, replacements and verification in
[`docs/security/dependency-audit-20261110.json`](security/dependency-audit-20261110.json).
This dependency result does not certify the pending application, browser, native or
production checks above.

| Main dependency | Final exact version |
| --- | --- |
| Next.js / matching ESLint config | 15.5.29 |
| React / React DOM | 19.2.9 |
| NextAuth | 4.24.15 |
| next-intl | 4.9.2 |
| Zod | 4.6.7 |
| Vitest / V8 coverage / mocker | 4.1.12 |
| Vite | 7.3.8 |
| Capacitor core / CLI / Android / iOS | 8.5.1 |
| Capacitor assets | 4.0.0 |
| sharp | 0.35.5 |
| music-metadata | 11.16.1 |
| Vendored official SheetJS | 0.20.3 |
| Node local / CI / worker Docker selection | 22.23.4 |

The latest compatible fixes replace old XML, archive, globbing, selectors, HTTP,
source-map and other copies. Two narrow owner overrides are qualified by their
consumers: TypeScript ESLint uses minimatch 11.0.1 with a real typed project glob
fixture; Next's compatible PostCSS 8 resolution is checked by the production build
and visual acceptance. Capacitor's Xcode writer uses UUID 11.1.1, which retains
CommonJS support; its real project parse/write/UUID fixture passes. Broader major
versions were not substituted indiscriminately.

The official **OSV 2.3.0 final scan exits 0 with no unhandled findings**. A second
control scan with **no exceptions** exits 1 and reports exactly two SheetJS labels,
with no other findings and the same 1,010-package inventory. Both scans explicitly
include `xlsx@0.20.3`; vendoring does not hide it from the scanner.

The two SheetJS records are demonstrable range false positives: their own details
and `last_known_affected_version_range` limit the flaws to versions below 0.19.3
and 0.20.2, but their machine-readable npm ranges only contain `introduced:0`.
SheetJS's maintained publisher distribution is 0.20.3; the npm registry remains at
0.18.5. The two former ajv/esbuild exclusions are removed: their resolved versions
are now 6.15.0 and 0.28.2. No whole-package exclusion is allowed.

The two reviewed exceptions in `osv-scanner.toml` are conditional on a mandatory
pre-install gate, `scripts/deployment/dependency-policy.mjs`. It verifies:

- The manifest uses only `file:vendor/xlsx-0.20.3.tgz`.
- Publisher metadata points to the exact official archive URL.
- Actual vendored bytes match the reviewed SHA512 and SHA256.
- The lockfile pins that same integrity and contains no second XLSX package or snapshot.
- The real OSV inventory contains exactly the reviewed npm package/version.
- The configuration contains only the two justified advisory exceptions, with no
  broad package override, extra exception or ambiguous table/key.

The official archive's SHA512 SRI is
`sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==`.
The gate never removes or rewrites scanner findings; the official fail-on-vulnerability
reporter remains mandatory for all other present or future advisories. **33 offline
controls pass**, including missing/corrupt reports, missing XLSX inventory, old
second copies, modified bytes or checksums, and whitespace-obscured broad exclusions.
**Four real format/tool consumer tests pass** for XLSX, legacy XLS, typed ESLint
project selection and Capacitor's Xcode writer. Native sync completed; executable
Android/iOS compilation remains subject to the required CI jobs.

Primary references:
[Node distribution inventory](https://nodejs.org/dist/index.json),
[Vitest 4 migration](https://v4.vitest.dev/guide/migration.html),
[Capacitor native proxy advisory](https://github.com/ionic-team/capacitor/security/advisories/GHSA-rvm3-566m-v7fv),
[SheetJS official distribution](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/),
[SheetJS prototype advisory](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6),
[SheetJS ReDoS advisory](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9),
[OSV 2.3.0 configuration](https://github.com/google/osv-scanner/blob/v2.3.0/docs/configuration.md).
Local raw evidence: `scan-final.json`, `scan-final-unfiltered.json`, their logs,
`advisory-matrix.json`, `dependency-policy-tests.log`, `dependency-unit.log` and
`sheetjs-source-integrity.json` under `.local/qa/security-upgrade-20261110/`.

## CI compatibility follow-up before publication

The first candidate, `b34fceee`, was correctly held by CI run
[42816453753](https://github.com/i-iangurazov/bazaar/actions/runs/42816453753).
The dependency and CodeQL analyses, both native builds, worker container, catalogue
scale, Baam, landing, stock browser and stabilization jobs passed. Two browser
checks demonstrated compatibility defects; they were fixed before publication,
without weakening assertions or disabling the release gate.

Report grouping triggered a server-route navigation despite `scroll:false`:
the same mounted navigation node moved from viewport y=486.47 to 1634.47. A local
instrumented trace showed scrollY 887 -> 0 while document height and node identity
remained unchanged. Report filters now use Next 15's documented native-history URL
integration. Query validation, fresh report requests, replacement of the current
history entry, deep links and stale-export/account/store guards remain. The original
**20 desktop/mobile scroll cases**, including their unchanged 4-pixel tolerance,
pass; **10 browser loading/error/retry/search/export/history checks** and **26 focused
unit checks** pass. No report amounts, markup or CSS changed.

Returning from product creation exposed a delayed receiving-draft restoration:
the old field regained focus after the new quantity input had already been focused.
Pending restorations now check their identity and are invalidated on successful
product handoff. The saved catalogue scroll is restored independently, including a
cache hit that completes before the first timer. Missing/failed product resolution
keeps the existing restoration fallback. Six actual-component timer regressions
pass, including a demonstrated failing cache-hit control before the final fix.
The new-document desktop/mobile and existing-document handoffs passed **3/3** real
browser cases against the final standalone build, with viewport screenshots
inspected and unchanged stock, prices, costs, movements and subscription fingerprints.
Existing document layouts and accounting remain.

The final local whole-file regression audit after these changes contains **4,351
passing tests in 491 files**, with the same three PgBouncer cases assigned to CI.
This remains an explicitly combined full run plus superseding focused reruns, not a
claim of a fresh complete execution. The next exact-revision CI and actual site and
worker publication must still finish successfully before the release is complete.

Local evidence: `ci-reporting-failure/`, `receiving-handoff-browser-before/`,
`receiving-handoff-browser/`, `receiving-handoff-unit-final.log`,
`ci-browser-fixes-unit.json`, and `local-regression-audit.json`.

Primary reference: [Next 15 native history integration](https://nextjs.org/docs/15/app/getting-started/linking-and-navigating#native-history-api).

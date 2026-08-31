# Final-readiness reconciliation draft — 2026-08-31

Status: **DRAFT / DO NOT APPLY**

This document reconciles the frozen 230-row readiness tracker with the current worktree,
completed provisional evidence, and the final validation lanes. The full isolated deterministic
database lane completed while this draft was prepared; browser, build, manual, and external lanes
remain separately gated. It is not a readiness snapshot, does not alter
`readiness-current.json`, and does not authorize a production release.

The rules used here are deliberately fail-closed:

- a source change is not browser evidence;
- a Playwright collection count is not a passed Playwright run;
- a focused database run is not the final full database result;
- a route smoke is not a mutation-workflow test;
- an automated contrast calculation is not the required manual accessibility review;
- a synthetic provider preflight is not evidence of real provider behavior;
- a requirement is not promoted beyond the exact wording covered by its evidence.

## Reconciled starting point

The live tracker remains the immutable starting point for any eventual update:

| Item                        |     Current value |
| --------------------------- | ----------------: |
| Requirements                |               230 |
| PASS                        |                54 |
| PARTIAL                     |               107 |
| FAIL                        |                25 |
| BLOCKED                     |                44 |
| Open defects                |                26 |
| Calculated readiness        |             47.8% |
| Application-owned readiness |             48.5% |
| Execution coverage          | 186 / 230 (80.9%) |
| Verified PASS coverage      |  54 / 230 (23.5%) |

The score is currently capped at 49% by open CRITICAL `BZR-PRD-001`. If that defect closes while
HIGH money/stock defect `REPORTS-001` remains open, the protected-domain HIGH cap still prevents a
production-ready score. Independently, BLOCKED requirements remain in the denominator with value
zero. Consequently, **100% cannot be truthfully claimed while the legal, provider, device,
manual-accessibility, publication-authority, and remaining application gaps below are unresolved**.

## Evidence gates

Every eventual tracker patch should point to a durable repo-relative evidence ledger containing the
exact command, final result, timestamp, and relevant assertion files. The gates below are references
used throughout this draft.

| Gate  | Required evidence                                                                                                                                                                                                                                                           | State at draft cutoff                                                                                                                                                                                                   |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `S1`  | `pnpm exec vitest run` with the final file/test count after all source regressions landed                                                                                                                                                                                   | Earlier standalone non-DB run passed 197 files / 1,010 tests. The later `DB1` run included deterministic source/unit files; retain the standalone count as provisional unless a final no-DB rerun is desired.           |
| `S2`  | `pnpm exec tsc --noEmit --pretty false`, `pnpm i18n:check`, scoped/full ESLint, Prettier or `git diff --check`                                                                                                                                                              | At the `DB1` cutoff, full TypeScript, scoped ESLint, and Prettier passed. `pnpm i18n:check` passed at the preceding public-source cutoff. Rerun only after later source changes.                                        |
| `DB1` | Safety-gated full deterministic database run: `NODE_ENV=test RUN_DB_TESTS=1 ALLOW_TEST_DB_RESET=1 EXPECTED_TEST_DB_NAME=bazaar_hardening_agent4_platform DATABASE_TEST_URL=<isolated-loopback-test-db> DATABASE_URL=<isolated-loopback-test-db> pnpm test:db:deterministic` | **PASS — 277 / 277 files and 1,543 / 1,543 tests in 184.34 s.** The isolated DB had all 99 migrations applied and none pending.                                                                                         |
| `P1`  | `pnpm test:e2e:public` with external traffic blocked                                                                                                                                                                                                                        | 174 tests collected in source; final runtime result pending. The current public config starts `next dev`, so production-only HTTP/cache claims also need `B1` or a production preview. Collection is not PASS evidence. |
| `A0`  | `pnpm test:e2e:authenticated:seed` with the gated QA fixture and explicit allowlisted local DB identity                                                                                                                                                                     | Fixture/source guard exists; execution evidence pending.                                                                                                                                                                |
| `A1`  | `pnpm test:e2e:authenticated` against the local production build and gated fixture                                                                                                                                                                                          | 620 tests represented by the current config/spec; final runtime result pending. Collection is not PASS evidence.                                                                                                        |
| `B1`  | Production build/start smoke with a valid ephemeral local-only configuration and no provider traffic                                                                                                                                                                        | Pending final result.                                                                                                                                                                                                   |
| `M1`  | Recorded manual WCAG review: affected contrast samples, keyboard tour, 200% zoom, and screen-reader workflows                                                                                                                                                               | Not completed.                                                                                                                                                                                                          |
| `E1`  | Authorized sandbox/device/counsel evidence for the specific external boundary                                                                                                                                                                                               | Not available except for synthetic, no-network preflight.                                                                                                                                                               |

Already completed supporting evidence remains in
`docs/production-readiness/evidence/provisional-non-browser-evidence-2026-08-31.md`. It includes
the exact focused DB results, isolated Redis contract, provider-lane preflight, dependency audits,
99-migration status, native source/config checks, localization checks, and the latest named public
source run (7 files / 34 tests). Those results must not be silently relabeled as final browser or
provider evidence.

## Requirement reconciliation

All 230 requirements are accounted for exactly once at the end of this document:

- 54 are already `PASS` in the live tracker;
- 80 non-PASS rows have a legitimate evidence-backed or conditional improvement path from the
  remediation now present;
- 83 non-PASS rows still have an application-owned coverage or implementation gap that the current
  final lanes do not fully close;
- 13 non-PASS rows remain legal, external, manual, device, performance-environment, or explicit
  authorization boundaries.

### A. Provisional non-browser transitions already supported

These 13 transitions are structurally encoded in the separate provisional manifest. They are the
only requirement changes currently backed by completed, named non-browser results. They still must
be copied into a final manifest only after the evidence cutoff and final counts are updated.

| Requirement    | Live    | Conservative draft target | Evidence / boundary                                                                                                                                 |
| -------------- | ------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BZR-REQ-0015` | PARTIAL | PASS                      | Developer URL source regression; no placeholder remains.                                                                                            |
| `BZR-REQ-0018` | FAIL    | PASS                      | Orders and Customers categories/articles, localized content, app-owned route catalog, and search regressions.                                       |
| `BZR-REQ-0019` | PARTIAL | PASS                      | 15 consequential workflows / 61 steps have localized location, control, and expected-result guidance.                                               |
| `BZR-REQ-0040` | FAIL    | PASS                      | Focused DB order lane created line-bearing valid orders. Zero-line rejection is separately scored.                                                  |
| `BZR-REQ-0059` | FAIL    | PASS                      | Exact persisted 80.46 KGS audit case and independent 80.90 KGS master case.                                                                         |
| `BZR-REQ-0060` | FAIL    | PARTIAL                   | Core inventory/product read models and product CSV agree. `DB1` is green; named all-consumer and runtime reconciliation is still required for PASS. |
| `BZR-REQ-0074` | BLOCKED | PASS                      | Completed isolated order applied exactly one intended stock effect.                                                                                 |
| `BZR-REQ-0085` | FAIL    | PARTIAL                   | Focused product/list/detail/pricing/store/CSV values agree; all UI/report/export totals are not yet covered.                                        |
| `BZR-REQ-0112` | BLOCKED | PARTIAL                   | Real second-tenant DB isolation exists; direct authenticated UI/API boundary still needs `A1`.                                                      |
| `BZR-REQ-0169` | FAIL    | PARTIAL                   | Corrected product CSV cost values and green `DB1`; all report/export totals still require report-specific UI/download evidence.                     |
| `BZR-REQ-0194` | FAIL    | PARTIAL                   | Public form labels/errors/select associations pass named source tests; authenticated application breadth is pending.                                |
| `BZR-REQ-0195` | FAIL    | PARTIAL                   | Public route-specific H1/title and shared authenticated PageHeader H1 contracts pass; rendered all-route proof needs `P1` and `A1`.                 |
| `BZR-REQ-0207` | FAIL    | PASS                      | RU/KG/EN pluralization regressions and `pnpm i18n:check` pass.                                                                                      |

Second-stage promotions must not be inferred from the provisional target:

- `0060` needs every valuation, margin/profit, analytics, report, and purchase-cost consumer named
  from the green `DB1` result and reconciled through the remaining runtime surfaces before PASS.
- `0085` and `0169` need UI plus CSV/XLSX reconciliation, including the `REPORTS-001` write-off
  case, before PASS.
- `0112` needs the second-tenant direct-URL and owned/foreign dynamic matrix in `A1` before PASS.
- `0194` needs representative authenticated forms and programmatic error associations before PASS.
- `0195` needs every reconciled public/authenticated route to render one meaningful H1 in `P1` and
  `A1` before PASS.

### B. Runtime-route candidates

The following 24 rows can improve because their remediation and deterministic source coverage now
exist. The target shown is the highest defensible result after the stated runtime evidence; it is not
the current result.

| Requirements           | Highest defensible next status                                       | Exact evidence needed                                                                                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0002`                 | PASS                                                                 | Reconcile the 116 canonical tracker patterns to the public and authenticated inventories, then attach green `P1` + `A1` direct-load results. A raw 174/620 count is insufficient without the mapping.                                                        |
| `0010`                 | PASS                                                                 | Green `A1` owned-ID cases for all 11 dynamic patterns using the seeded fixture.                                                                                                                                                                              |
| `0011`                 | PASS                                                                 | Green `A1` malformed and missing cases for all 11 authenticated patterns, no mutation controls, plus the real localized catalog 404 in `P1`.                                                                                                                 |
| `0143`                 | PASS                                                                 | `P1` + `A1` finite-terminal assertions: visible H1/dialog heading, no busy/loading terminal, and no loop.                                                                                                                                                    |
| `0150`, `0151`, `0152` | PASS                                                                 | Reconciled route inventory plus green desktop 1440, tablet 1024, and mobile 390 matrices in `P1` + `A1`. Do not use responsive test totals until every canonical tracker pattern maps once.                                                                  |
| `0005`                 | PASS only after augmentation                                         | Existing matrices prove direct terminal loads, not refresh of every major route. Add explicit refresh/deep-link assertions for the affected dynamic, KKM, and compatibility states; otherwise leave PARTIAL.                                                 |
| `0007`                 | PASS only after augmentation                                         | For every compatibility alias, assert exact query/fragment/selected state, no loop, and Back/Forward restoration. Current exact-location source coverage alone leaves this PARTIAL.                                                                          |
| `0008`                 | PARTIAL from the existing final matrix; PASS only after augmentation | Green `/inventory?action=receive` redirect at 1440/1024/390 and visible receiving controls can remove FAIL. PASS/`COMPAT-001` closure additionally needs refresh plus Back/Forward state assertions.                                                         |
| `0013`                 | PASS                                                                 | `P1` keyboard activation of `/privacy` footer/legal controls in all locale/viewport projects, durable `/privacy` response, and sitemap entry; pair with `B1` for the production route smoke.                                                                 |
| `0117`                 | PARTIAL                                                              | `P1` proves malformed token routes are non-actionable and recoverable. PASS additionally needs DB-backed malformed, unknown, expired, reused, wrong-purpose, and valid-control integration cases; the current mocked service test is not server integration. |
| `0196`                 | PARTIAL                                                              | Green computed-contrast assertions in `P1`. PASS and `PUBLIC-008` closure still require recorded manual `M1` review of every affected state.                                                                                                                 |
| `0218`                 | PASS                                                                 | Green `P1` + `A1` with no broken route images/assets and explicit favicon/resource bodies.                                                                                                                                                                   |
| `0220`                 | PASS                                                                 | Green `P1` + `A1` page/console audit with no unexpected errors, warnings caused by remediated dialogs, or failed assets.                                                                                                                                     |
| `0222`                 | PASS                                                                 | `P1` HTTP 200/content-type/body validation for complete sitemap, including privacy/legal/Guide destinations, plus a production-build resource smoke in `B1`.                                                                                                 |
| `0230`                 | PASS                                                                 | `P1` favicon HTTP 200, ICO signature/body, explicit public cache policy, and validator header, confirmed against `B1` because the current public config uses Next dev.                                                                                       |
| `0046`, `0047`         | PASS                                                                 | Positive `A1` organization-owner and platform-owner direct routes using the dedicated fixture accounts.                                                                                                                                                      |
| `0048`                 | PASS                                                                 | `S1` dependency-specific KKM source state plus a targeted authenticated browser check at 1440/1024/390 that asserts the named recovery state/action and records response statuses. Generic `A1` is supporting route/console evidence only.                   |
| `0110`, `0111`         | PASS                                                                 | Positive owner routes plus ordinary-role denial in `A1`; preserve organization/platform boundary assertions.                                                                                                                                                 |
| `0137`                 | PASS                                                                 | Green root-overflow measurements for every mapped route in `P1` + `A1`. Layout-defect closure still needs each defect's exact breakpoint/data/action acceptance, not only this broad row.                                                                    |
| `0144`                 | PARTIAL                                                              | Green root containment in `A1` removes the current global overflow FAIL. PASS still needs targeted assertions that wide tables scroll internally and all row/header actions remain reachable.                                                                |

### C. Database/workflow candidates

These 43 rows have meaningful current service/source coverage. `DB1` is now green; they may improve
to the stated ceiling where the named tests cover the full wording and, where explicitly stated,
browser evidence also completes. Full-suite success is necessary but not sufficient: each tracker
patch must cite the named assertion file(s), not merely the aggregate 277-file count.

| Requirements   | Highest defensible next status       | Exact evidence needed                                                                                                                                                                                                                                                                                                             |
| -------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0022`         | PARTIAL                              | `tests/integration/bundles.test.ts` create/assemble/idempotency/value tests in `DB1`. A browser create/save/inspect lifecycle is still needed for PASS.                                                                                                                                                                           |
| `0025`         | PASS                                 | `tests/integration/products.test.ts` exact SKU/barcode/normalized-name duplicate diagnostics and `tests/integration/imports.test.ts` blocking-conflict/warning assertions in `DB1`.                                                                                                                                               |
| `0026`         | PASS                                 | `tests/integration/imports.test.ts` preview create/update/skipped/invalid conflict, bounded response, apply and rollback cases in `DB1`; attach the harmless fixture inventory.                                                                                                                                                   |
| `0027`         | PARTIAL                              | Product upload/storage/image-studio source/unit tests and image-related DB cases in `S1`/`DB1`. PASS still needs safe browser upload, invalid type/size, persisted display, and cleanup.                                                                                                                                          |
| `0039`         | PASS                                 | `tests/integration/customers.test.ts` create/read/normalization, CRUD role/store scope, import/dedupe and isolation cases in `DB1`.                                                                                                                                                                                               |
| `0057`         | PASS                                 | Product creation/initial stock/store assignment and POS exact barcode/search availability across `tests/integration/products.test.ts`, `inventory.test.ts`, and `pos.test.ts` in `DB1`.                                                                                                                                           |
| `0032`         | PASS                                 | `tests/integration/stock-counts.test.ts` idempotent apply and positive/negative precise-WAC corrections in `DB1`.                                                                                                                                                                                                                 |
| `0033`, `0062` | PARTIAL only with current source     | `tests/integration/inventory.test.ts` now proves paired detail lines and balanced store/quantity legs. However `src/components/inventory/movement-print-document.tsx#getPrintableLines` still filters a transfer to outgoing lines when present. Fix and regress detail plus print/export before PASS or `INVENTORY-001` closure. |
| `0041`         | PASS after `A1`                      | Green `DB1` includes `tests/integration/sales-orders.test.ts` revenue/cost/profit metric assertions; add an owned seeded order detail rendered in `A1`.                                                                                                                                                                           |
| `0067`         | PASS                                 | `tests/integration/stock-counts.test.ts` expected-vs-counted apply, exact snapshot delta, movement value, and idempotency in `DB1`.                                                                                                                                                                                               |
| `0069`         | PASS                                 | `tests/integration/purchase-orders.test.ts` valid partial/final receipt states and rejected invalid transitions in `DB1`.                                                                                                                                                                                                         |
| `0070`         | PASS after assertion review          | `purchase-orders.test.ts` must explicitly reconcile PO ID, supplier, receipt movements, received quantities, and inventory snapshots. Add any missing link assertion before promotion.                                                                                                                                            |
| `0071`         | PASS                                 | `tests/integration/sales-orders.test.ts` zero-line rejection before record/sequence allocation in `DB1`. `ORDERS-001` itself remains UI-gated.                                                                                                                                                                                    |
| `0072`         | PARTIAL                              | Existing DB tests prove initial line creation and line-price totals, but no complete add/remove/re-total browser lifecycle is recorded.                                                                                                                                                                                           |
| `0073`         | PASS after assertion review          | Named sales-order lifecycle/status/customer relationship assertions in `sales-orders.test.ts`; do not infer from order creation alone.                                                                                                                                                                                            |
| `0075`, `0076` | PASS                                 | POS math/source tests plus `tests/integration/pos.test.ts` active discount snapshots, quantity/cart concurrency, line price and total reconciliation in `S1`/`DB1`.                                                                                                                                                               |
| `0077`         | PASS                                 | Exact split and transfer payment total assertions in `pos.test.ts`. This is non-fiscal and does not close `0083`.                                                                                                                                                                                                                 |
| `0078`         | PASS                                 | Idempotent completed sale, one receipt/history/payment/inventory effect in `pos.test.ts`.                                                                                                                                                                                                                                         |
| `0079`         | PASS                                 | Completed return restores the original frozen inventory value and reverses/refunds money in `pos.test.ts` and `product-cost-sales-returns.test.ts`.                                                                                                                                                                               |
| `0080`         | PASS                                 | Discounted debt creation, balance, settlement, payment and shift assertions in `pos.test.ts`.                                                                                                                                                                                                                                     |
| `0081`         | PASS                                 | Cash pay-in/pay-out, negative-drawer rejection and cash-movement reconciliation in `pos.test.ts` plus focused cash unit tests.                                                                                                                                                                                                    |
| `0082`         | PASS                                 | Shift open uniqueness, held-sale close guard, close expected/counted/discrepancy and payment breakdown assertions in `pos.test.ts`.                                                                                                                                                                                               |
| `0108`         | PASS only after coverage map         | Map every export/print endpoint to role assertions: `exports.test.ts`, receipt/PO PDF route tests, connector/label/price-tag tests, and POS artifact authorization. Otherwise retain PARTIAL.                                                                                                                                     |
| `0113`         | PASS after `A1`                      | Green `DB1` includes multi-store data/service tests; add authenticated store-scoped routes/fixture state and explicitly prove switching never leaks the other store's records.                                                                                                                                                    |
| `0123`, `0149` | PASS                                 | Operation-request replay/fingerprint/concurrency tests plus inventory, PO, POS, and order idempotency/rapid-submit assertions in `DB1`.                                                                                                                                                                                           |
| `0124`         | PARTIAL                              | Concurrency/operation-request tests prove several stale-write boundaries. PASS needs a stale browser edit demonstrating user-visible conflict/recovery rather than overwrite.                                                                                                                                                     |
| `0130`         | PASS                                 | Stable bounded pagination plus the 5,000-document first-page/concurrent-page regression in `DB1`; attach the seeded cardinality and threshold.                                                                                                                                                                                    |
| `0133`         | PASS after coverage map              | Named rejected/cancelled inventory, order, POS, and operation-request cases must each assert zero stock/financial side effects in `DB1`.                                                                                                                                                                                          |
| `0084`         | PARTIAL                              | `reports.test.ts` now includes posted write-off/correction cost detail and `analytics.test.ts` covers completed sale/return totals. `REPORTS-001` UI reload and CSV/XLSX reconciliation still block PASS.                                                                                                                         |
| `0164`, `0165` | PASS only with explicit assertions   | Cite store/filter/date boundary assertions in report tests and add missing inclusive/timezone/empty cases. A generic green reports file is not enough.                                                                                                                                                                            |
| `0166`         | PARTIAL                              | Cost and report DB regressions remove the original no-baseline FAIL, but created transaction vs UI/export reconciliation remains incomplete while `REPORTS-001` is open.                                                                                                                                                          |
| `0170`         | PASS                                 | `exports.test.ts` CSV BOM/stable headers and XLSX stable headers, plus exact date/currency/locale formatting assertions for every export type. Add any missing formatting assertions before promotion.                                                                                                                            |
| `0171`         | PASS after assertion review          | `pos.test.ts` shift close/payment breakdown plus receipt/PDF source tests. Attach an exact receipt/close report reconciliation, not route render alone.                                                                                                                                                                           |
| `0174`, `0175` | PASS only after integration-page map | Map every listed integration to empty/invalid validation and secret masking assertions across source/unit/DB tests, then pair with green `A1` route renders. Otherwise retain PARTIAL.                                                                                                                                            |
| `0186`         | PASS after `A1`                      | Green `DB1` includes store-isolation/switch tests; add seeded two-store authenticated state across inventory, orders, POS and reports.                                                                                                                                                                                            |
| `0188`         | PARTIAL                              | `tests/integration/users.test.ts` and role-policy tests can prove safe invite-record/role assignment behavior. PASS requires the authorized email inbox lifecycle in `E1`.                                                                                                                                                        |
| `0209`         | PARTIAL                              | Green deterministic source/DB coverage for localized export headings/encoding and print sources can remove BLOCKED. PASS needs RU/KG/EN rendered report and print/export output.                                                                                                                                                  |
| `0213`         | PASS after `A1`                      | `inventory-large-document-performance.test.ts` passed within green `DB1`; cite its 5,000-document, concurrent-page, <2,500 ms assertion and prove the responsive route remains usable in `A1`.                                                                                                                                    |

### D. Remaining application-owned gaps with no current status increase

The following 83 non-PASS rows are not candidates for a mechanical promotion from the current
lanes. They need new implementation or targeted evidence beyond the final aggregate source/DB/route
smokes. A green aggregate command must not change them.

| Gap class                                         | Requirements                                                                                                   | Missing evidence or implementation                                                                                                                                                                                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation, state and complete workflow parity    | `0003`, `0004`, `0009`, `0017`, `0023`, `0024`, `0034`, `0035`, `0036`, `0037`                                 | Reach every applicable route through UI navigation; breadcrumbs/active/back state; all state families; all Guide articles vs live UI; complete categories/units/attributes, product-list controls, rendered movement print, supplier, PO and POS UI lifecycles. |
| Form and data-boundary breadth                    | `0049`, `0050`, `0051`, `0052`, `0053`, `0054`, `0055`, `0056`, `0066`, `0068`, `0086`, `0087`                 | Systematic required/min/max/decimal/rounding/Unicode/date/upload/unsaved cases; interrupted inventory mutations; PO total edges; currency consistency; explicit QA cleanup inventory.                                                                           |
| Authentication, session and in-page authorization | `0089`, `0091`, `0092`, `0093`, `0094`, `0096`, `0097`, `0098`, `0106`, `0107`, `0115`, `0116`, `0122`, `0127` | Invalid/duplicate login, logout/back/multitab/expiry, redirect-to-origin, authenticated `/login`, denied mutations, full CRUD role map, observed UI API payload review, valid token lifecycles, refresh/session-loss recovery.                                  |
| Reliability and interaction UX                    | `0128`, `0129`, `0131`, `0134`, `0136`, `0138`, `0139`, `0140`, `0141`, `0142`, `0145`, `0146`, `0147`         | Natural failure recovery, empty data, unsaved protection, workflow request audit, visual review, terminology/action/confirmation/toast/empty guidance, filters, modal focus and sticky-focus behavior.                                                          |
| Mobile workflows                                  | `0155`, `0156`, `0157`, `0158`, `0159`, `0160`, `0161`, `0162`, `0163`                                         | Actual lookup/save/stock/POS/order/customer/report/settings actions on mobile, not route render; responsive dates, scanners, printing, dropdowns, tables and long labels.                                                                                       |
| Reporting, integration and operations             | `0167`, `0176`, `0177`, `0179`, `0183`, `0184`, `0185`, `0187`                                                 | Guaranteed-empty report range; verified setup/disconnect/error guidance; current-data reconciliation; response-level exposure review; onboarding/settings mutation; useful compliance/hardware checks.                                                          |
| Broad accessibility and localization              | `0189`, `0190`, `0191`, `0192`, `0193`, `0197`, `0198`, `0205`, `0206`, `0208`, `0210`                         | Full keyboard/focus/order/modal/name/error/status audit, complete rendered mixed-language review, all date/number/currency and validation locales, long-label clipping across authenticated locales.                                                            |
| Performance and visual stability                  | `0211`, `0212`, `0214`, `0216`, `0217`, `0219`                                                                 | Defined throttled budgets and measurements for initial/client navigation/search/reports/exports plus CLS instrumentation. Unit/source timing helpers are not user-observed performance evidence.                                                                |

### E. Legal, external, manual, device, environment, or authorization boundaries

These 13 rows cannot be promoted merely by completing the current local final lanes:

| Requirement    | Boundary and exact evidence needed                                                                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0014`         | Counsel-approved controller/operator identity, contact, retention/deletion, rights/complaint process, effective date and locale parity. The first-party page is reachable, but app authors must not invent legal facts. |
| `0083`         | Authorized non-production fiscal/KKM connector and tax/receipt target: pairing, transmit, retry, reconciliation and failure recovery without a real fiscal event.                                                       |
| `0118`, `0119` | Authorized email sender sandbox and inbox for signup/reset delivery and complete account lifecycle, including retry/redaction/duplicate prevention.                                                                     |
| `0120`, `0181` | Explicit authority and disposable tenant/catalog target to publish, verify ownership/permissions, and cleanly roll back a public catalog.                                                                               |
| `0180`         | Authorized provider sandbox for connect/validate/sync/disconnect/retry/audit/masking/tenant isolation. Synthetic preflight proves lane safety only.                                                                     |
| `0182`         | Billing sandbox and non-production payment method for mutation, idempotency, webhook/retry, authorization and reconciliation.                                                                                           |
| `0199`, `0200` | Recorded manual 200% zoom/narrow-viewport review and formal screen-reader workflows.                                                                                                                                    |
| `0226`, `0227` | Production Apple application identifiers and Android signing fingerprints/paths plus physical-device association validation. Current empty-but-valid files are not configuration success.                               |
| `0229`         | Approved transfer budget, production HTML measurements, mobile throttling and field Web Vitals. Payload-source reduction and a local byte script are supporting evidence only.                                          |

The product decision for unpriced positive adjustments is also still required before complete
inventory-valuation certification, even though it is tracked in `EXTERNAL_BLOCKERS.md` rather than
as a separate numbered requirement.

## Defect reconciliation

No defect should be closed solely because its implementation file changed. The final manifest must
apply each defect independently from its related requirement row.

Strict accounting: 5 conclusively supportable closures, 17 code-remediated but evidence-gated
defects, 2 unresolved application-owned gaps, and 2 external/product boundaries = 26 defects.

### Conclusively supportable from completed non-browser evidence

These five defects have acceptance-shaped source/unit evidence already completed:

| Defect          | Draft disposition  | Evidence                                                                                                                                                            |
| --------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC-006`    | RESOLVED candidate | Public form label/error/select associations, `aria-invalid`, resolvable descriptions and alert semantics in the named 7-file / 34-test public source run.           |
| `PUBLIC-007`    | RESOLVED candidate | Localized route-specific metadata/H1 source contracts and shared authenticated PageHeader H1 regression. Rendered coverage still contributes to broader row `0195`. |
| `PUBLIC-012`    | RESOLVED candidate | Exact production developer URL and rejected placeholder phrases.                                                                                                    |
| `PUBLIC-014`    | RESOLVED candidate | Locale-aware RU/KG/EN article count tests and green i18n check.                                                                                                     |
| `AUTH-A11Y-001` | RESOLVED candidate | Dialog title/description linkage and warning-free modal unit regressions.                                                                                           |

The provisional manifest also marks `PUBLIC-003` and `PUBLIC-011` resolved. That is only defensible
if the acceptance phrase “verify against production UI and applicable roles” is interpreted as
current app-source route/role parity. Under the stricter runtime interpretation used by this final
reconciliation, retain both as **conditional closure candidates** until `P1` renders every new Guide
route and an authenticated role/UI parity review is attached.

### Code-remediated but final evidence still required

| Defect        | Required closure evidence                                                                                                                                                                                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BZR-PRD-001` | `DB1` is green for the cost lifecycle, policies, product paths, sales/returns, reports and exports, including the exact 80.46/80.90 cases. Closure still requires a named acceptance-to-test map for initial stock/multiple receipts/round boundaries and rendered UI/report/export reconciliation. Until that completes, the CRITICAL cap stays. |
| `PUBLIC-001`  | Green `P1` footer/legal keyboard navigation across locale/viewports, durable privacy/legal pages and sitemap discovery, plus a production-build/preview resource smoke in `B1`.                                                                                                                                                                   |
| `REPORTS-001` | `DB1` now passes the posted write-off/correction service regression. Remaining closure evidence is a targeted UI immediate/reload workflow plus CSV/XLSX reconciliation by movement ID, qty, value, store and timestamp with inclusive timezone/store scope. The service test does not cover the full acceptance.                                 |
| `PUBLIC-003`  | `P1` routes plus documented authenticated production UI/role parity for Orders create/edit/status/cancel and Customers/history. Source parity alone is the provisional assumption.                                                                                                                                                                |
| `PUBLIC-004`  | Green `P1` Meta+K and Control+K focus, visible 3:1 focus treatment, and keyboard activation.                                                                                                                                                                                                                                                      |
| `PUBLIC-005`  | Green `P1` non-actionable token pages plus a real DB integration covering unknown/expired/reused/wrong-purpose tokens and authoritative mutation rejection. Current mocked service tests are insufficient for “server-enforcement integration.”                                                                                                   |
| `PUBLIC-008`  | Green automated `P1` ratios plus recorded manual `M1` contrast review of every formerly affected state.                                                                                                                                                                                                                                           |
| `PUBLIC-010`  | Green `P1` real HTTP 404 response with localized friendly title and H1.                                                                                                                                                                                                                                                                           |
| `PUBLIC-011`  | `P1` Guide route render plus authenticated production UI/role review for all 15 consequential workflows / 61 steps. Source parity alone is the provisional assumption.                                                                                                                                                                            |
| `LAYOUT-001`  | Data-loaded movement table at 768, 1024 and 1440: root overflow <=1 px, internal table scrolling, fixed shell/sidebar, actions reachable. Generic route smoke does not assert all acceptance points.                                                                                                                                              |
| `LAYOUT-002`  | Data-loaded receipt routes at 1024: root overflow <=1 px, internal table scrolling and all actions reachable.                                                                                                                                                                                                                                     |
| `ORDERS-001`  | `DB1` now passes the exact no-record/no-sequence zero-line rejection. A targeted browser invalid submit must still prove the client rejects and requires an active product/variant and positive quantity.                                                                                                                                         |
| `ORDERS-002`  | `DB1` passes direct canceled-state tracking/confirmation rejection and no tracking/confirmation email logs. Add an explicit no-new-audit assertion and a seeded CANCELLED-order browser check that every tracking/save/send/confirmation control is disabled. Current authenticated fixture has no cancelled-order case.                          |
| `KKM-002`     | Green dependency-specific source regression and a targeted authenticated browser case at 1440/1024/390 that asserts the named state/action and records failing response statuses. Generic `A1` only checks the terminal H1/console and cannot by itself prove no unexplained 403.                                                                 |
| `DYNAMIC-001` | Green `A1` valid owned, malformed and missing cases for all 11 patterns, finite terminal state and no controls; the deterministic source suite alone is not rendered-route evidence.                                                                                                                                                              |
| `COMPAT-001`  | Green targeted browser assertions at 1440/1024/390 for final URL and visible receiving controls, plus refresh and Back/Forward persistence. The source regression and generic route matrix do not cover history behavior.                                                                                                                         |
| `PUBLIC-013`  | Green `P1` favicon HTTP status, content type, ICO body, public cache policy and ETag/Last-Modified.                                                                                                                                                                                                                                               |

### Genuine unresolved app-owned defect gaps

`INVENTORY-001` is **not** closure-ready. The detail service and DB regression now expose balanced
`TRANSFER_OUT` and `TRANSFER_IN` lines, but
`src/components/inventory/movement-print-document.tsx#getPrintableLines()` returns outgoing lines
when they exist and only falls back to incoming lines. This directly conflicts with the defect's
requirement that every detail and print/export view show exactly one balanced source and destination
leg. The current `tests/unit/product-movements-source.test.ts` even locks in the
`TRANSFER_OUT` filter, so that expectation must be replaced rather than cited as closure evidence.
Fix the print representation, add a focused rendered/component regression that asserts both legs
and balanced totals/stores, then run `DB1` and the owned movement print route before closure.

`PUBLIC-015` is also **not** closure-ready. The scoped-message regression and
`readiness:public-html` helper are useful remediation scaffolding, but no completed production HTML
budget result, mobile-throttled measurement, or field Web Vitals evidence exists. Treat the default
150,000-byte helper threshold as a draft budget until it is explicitly approved and run against a
production build; then complete the throttled/field acceptance before closure.

### External/product defect boundaries

| Defect       | Boundary                                                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC-002` | Counsel-approved operational legal notice; do not infer operator identity or retention terms.                                           |
| `PUBLIC-009` | Production Apple/Android identifiers and physical-device verification, or an explicit product decision that association is unsupported. |

## Stale tracker/supporting text to replace only after final evidence

The following statements are now stale or conditionally stale, but must be changed through an
explicit final manifest/status-doc update rather than by editing the tracker in this draft:

- The environment note that the browser E2E runner/configuration is missing is stale. Separate
  public and authenticated configs/specs/fixtures now exist; runtime results remain pending.
- Role supporting metrics still say only four of six roles are credentialed and list both owner
  roles as blocked. The authenticated fixture now defines positive organization-owner and
  platform-owner accounts; update these metrics only after `A0` + `A1` pass.
- Cross-tenant supporting metrics still say false. A legitimate second tenant passes the full DB
  lane and exists in the fixture; set true only after the authenticated foreign-record matrix also
  passes.
- Requirement notes for Orders/Customers Guide absence, developer placeholder, weighted-average
  80.75, zero-line order acceptance, missing H1/forms/pluralization/favicon/privacy link, invalid
  dynamic loading, generic KKM state, and compatibility query removal describe reproduced baseline
  behavior and should be superseded with exact final evidence when their gates pass.
- Route/workflow/responsive/localization supporting metrics must be recomputed from final evidence;
  they must not be mechanically copied from the old audit or inferred from collected test counts.

## Complete 230-row accounting

This appendix is the mechanical coverage check for the reconciliation. Each requirement appears in
exactly one top-level bucket.

### Already PASS in the live tracker — 54

`0001 0006 0012 0016 0020 0021 0028 0029 0030 0031 0038 0042 0043 0044 0045 0058 0061 0063 0064 0065 0088 0090 0095 0099 0100 0101 0102 0103 0104 0105 0109 0114 0121 0125 0126 0132 0135 0148 0153 0154 0168 0172 0173 0178 0201 0202 0203 0204 0215 0221 0223 0224 0225 0228`

### Improvement candidates in sections A–C — 80

`0002 0005 0007 0008 0010 0011 0013 0015 0018 0019 0022 0025 0026 0027 0032 0033 0039 0040 0041 0046 0047 0048 0057 0059 0060 0062 0067 0069 0070 0071 0072 0073 0074 0075 0076 0077 0078 0079 0080 0081 0082 0084 0085 0108 0110 0111 0112 0113 0117 0123 0124 0130 0133 0137 0143 0144 0149 0150 0151 0152 0164 0165 0166 0169 0170 0171 0174 0175 0186 0188 0194 0195 0196 0207 0209 0213 0218 0220 0222 0230`

### Application-owned hold rows in section D — 83

`0003 0004 0009 0017 0023 0024 0034 0035 0036 0037 0049 0050 0051 0052 0053 0054 0055 0056 0066 0068 0086 0087 0089 0091 0092 0093 0094 0096 0097 0098 0106 0107 0115 0116 0122 0127 0128 0129 0131 0134 0136 0138 0139 0140 0141 0142 0145 0146 0147 0155 0156 0157 0158 0159 0160 0161 0162 0163 0167 0176 0177 0179 0183 0184 0185 0187 0189 0190 0191 0192 0193 0197 0198 0205 0206 0208 0210 0211 0212 0214 0216 0217 0219`

### Legal/external/manual/device/environment/authority rows in section E — 13

`0014 0083 0118 0119 0120 0180 0181 0182 0199 0200 0226 0227 0229`

Counts: `54 + 80 + 83 + 13 = 230`.

## Safe final update procedure

1. Preserve the completed `DB1` result. Freeze source changes, rerun it only if relevant source
   changes, and complete `S1`/`S2` as needed plus `B1`, `P1`, `A0`, and `A1` with exact durable
   results. Do not reuse provisional aggregate counts for a later changed worktree.
2. Complete only the authorized targeted/manual/external gates; record uncompleted boundaries as
   BLOCKED or non-PASS, never N/A for score improvement.
3. Re-review every candidate above against its exact wording and evidence ceiling. Remove candidates
   whose named assertion did not run or did not cover the stated boundary.
4. Create a new explicit updater manifest with one supplied ISO timestamp and repo-relative evidence
   paths. Do not edit `readiness-current.json` by hand.
5. Validate the manifest to a new temporary output path with `pnpm readiness:update -- --manifest
<final-manifest> --output <new-temp-file>`.
6. Inspect calculator invariants, immutable fingerprints/baselines, history entries, defect caps,
   requirement counts, and supporting metrics before replacing any official file.
7. Apply the generated snapshot and update status/checkpoint docs only after review. Preserve this
   draft and the provisional ledger as historical evidence; do not rewrite their results.

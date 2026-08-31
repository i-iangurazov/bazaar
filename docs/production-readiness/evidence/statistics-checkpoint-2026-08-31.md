# Bazaar statistics checkpoint — 2026-08-31

Status: OFFICIAL EVIDENCE RECONCILIATION. Application and test source remained frozen. No full matrix was run for this checkpoint.

## Source freeze

- Branch: `main`
- HEAD / starting commit: `7db455397eb38e9bcaa09bda5acc951964df5ab2`
- Frozen application/config scope: 715 files, 10726862 bytes
- Scope SHA-256: `c534b39acaa30f6ba9eaa7714666fe34629259b79ee010a48c600702ef3070c0`
- Working-tree status identity before audit-only checkpoint files: 445 entries, `474729951025a7f9a0a1e87a921c7b3c27eba6c77203efc45ab1fcf8e5c4f0eb`
- Tracked diff identity: `fcf59f670c53ee2af99bc9b063d08fbccadfb1b08d1e4e01fbd82c9f47ca5d7b`
- No application or test file was changed during this checkpoint; only tracker/evidence files were added or regenerated.

## Official score and coverage

| Metric | Previous official | Reconciled official |
| --- | ---: | ---: |
| Overall readiness | 47.8% | **49.0%** (raw 51.4%; Critical cap 49%) |
| Application-owned readiness | 48.5% | **52.2%** |
| Execution coverage | 186/230 = 80.9% | **188/230 = 81.7%** |
| Verified PASS rate | 54/230 = 23.5% | **58/230 = 25.2%** |
| Critical-workflow execution | 49/67 = 73.1% | **51/67 = 76.1%** |
| Critical-workflow PASS | 21/67 = 31.3% | **23/67 = 34.3%** |

Requirement states: **58 PASS / 114 PARTIAL / 16 FAIL / 42 BLOCKED**. BLOCKED remains in the denominator.

## Coverage detail

| Dimension | Execution coverage | Verified PASS coverage / outcome |
| --- | ---: | ---: |
| 132 supplied exact forms | 132/132 = 100.0% | 25/132 = 18.9%; 25 PASS / 97 PARTIAL / 10 FAIL |
| 116 canonical routes | 116/116 = 100.0% | 15/116 = 12.9%; 15 PASS / 91 PARTIAL / 10 FAIL |
| Workflows | 63/85 = 74.1% | 24/85 = 28.2%; 24 PASS / 37 PARTIAL / 2 FAIL / 22 BLOCKED |
| Role requirements | 31/47 = 66.0% | 18/47 = 38.3% |
| Expected role credentials | 6/6 = 100.0% | Direct role matrix not complete |
| Tenant-isolation requirements | 4/4 = 100.0% | 0/4 = 0.0%; 4 PARTIAL; cross-tenant browser flag remains false |
| Desktop exact forms | 132/132 = 100.0% | No viewport-specific PASS rollup encoded |
| Tablet exact forms | 123/132 = 93.2% | No viewport-specific PASS rollup encoded |
| Mobile exact forms | 123/132 = 93.2% | No viewport-specific PASS rollup encoded |
| Responsive requirements | 33/35 = 94.3% | 5/35 = 14.3% |
| Localization requirements | 10/12 = 83.3% | 5/12 = 41.7%; full route/locale cross-product false |
| Accessibility requirements 0189-0200 | 10/12 = 83.3% | 0/12 = 0.0%; 9 PARTIAL / 1 FAIL / 2 BLOCKED |
| Public matrix | Historical artifact says PASS | Not current-source-valid; no route promotion |
| Authenticated matrix | Interrupted after approximately 352 passed | Not passed; no individual pass ledger retained |

The retained baseline viewport counters remain 153/153 public checks and 210/210 admin checks. They are execution history, not a clean final-source matrix result.

## Exact requirement status delta

| Requirement ID | Previous | Current | Risk | Evidence | Reason for promotion |
| --- | --- | --- | ---: | --- | --- |
| BZR-REQ-0018 | FAIL | PARTIAL | 1 | Guide content/search regressions plus historical public render; current-source browser breadth withheld | The original FAIL can advance to PARTIAL because named content/search regressions passed and the historical public matrix rendered the Guide. PASS is withheld because the retained browser pass predates current relevant source and the acceptance requires current production UI and applicable-role verification. |
| BZR-REQ-0040 | FAIL | PASS | 3 | Focused isolated PostgreSQL repair set: 4 files / 18 tests PASS | The narrow requirement asks whether a valid line-bearing order can be created. Focused DB tests prove that positive path. Zero-line rejection remains separately scored by BZR-REQ-0071 and ORDERS-001 and is not inferred here. |
| BZR-REQ-0059 | FAIL | PASS | 5 | Focused weighted-cost audit/master cases: 1 file / 2 tests PASS; 80.46 and 80.90 | Both the audit formula and an independent master case reconcile cost-basis quantity, inventory snapshot, movement value, receiving on-hand, and persisted average cost. Broader consumers are scored separately. |
| BZR-REQ-0060 | FAIL | PARTIAL | 5 | Focused weighted-cost read models and product CSV PASS; broader consumers excluded | Focused evidence conclusively removes the original all-consumer FAIL for core inventory and product read models, but the requirement is broader than the completed lane; PARTIAL preserves the unverified report and profit boundaries. |
| BZR-REQ-0074 | BLOCKED | PASS | 5 | Focused completed-order database case proves one intended stock effect | The focused DB regression directly asserts the completed order's intended single inventory effect, including the persisted snapshot and movement cardinality. |
| BZR-REQ-0085 | FAIL | PARTIAL | 5 | Focused product/list/detail/pricing/CSV reconciliation; broad UI/report/export excluded | The original demonstrated cross-surface cost mismatch is corrected in focused data/read/export paths, supporting PARTIAL. The all-UI/all-export wording is broader than the completed non-browser evidence and cannot pass yet. |
| BZR-REQ-0112 | BLOCKED | PARTIAL | 5 | Focused legitimate second-organization service isolation PASS; browser isolation excluded | The former BLOCKED reason—no second tenant—no longer applies to backend/service isolation. PARTIAL is conservative because the completed evidence does not replace the still-running authenticated browser matrix. |
| BZR-REQ-0169 | FAIL | PARTIAL | 5 | Focused product CSV cost values PASS; other exports and aggregates excluded | The originally failing product-cost export values are corrected and persisted, supporting PARTIAL. The plural wording covers more exports and totals than the two completed product-CSV cases, so PASS is deferred. |
| BZR-REQ-0194 | FAIL | PARTIAL | 3 | Named public form DOM/source run: 7 files / 34 tests PASS; app-wide browser breadth excluded | The specific public-form defect is source- and DOM-regression complete, but the tracker requirement is application-wide. PARTIAL preserves the unverified authenticated-form and runtime breadth. |
| BZR-REQ-0195 | FAIL | PARTIAL | 1 | Named public H1/title and shared PageHeader regressions PASS; all-route browser breadth excluded | The specific public auth/error defect is source-regression complete, but the broad application heading-order requirement still needs the final browser route matrix; PARTIAL is the conservative outcome. |
| BZR-REQ-0207 | FAIL | PASS | 1 | Locale-aware RU/KG/EN plural regression and i18n check PASS; corroborated by 1,673-test run | Dedicated plural regressions exercise the known Russian failure and representative Russian plural categories, while KG/EN assertions and the green i18n catalog check cover the supported locales. |

## Test-result reconciliation

| Reported result | Still valid? | Official scoring use |
| --- | --- | --- |
| 1,673 deterministic tests (312 files) | Valid exact session result; no workspace JUnit/raw log | Corroborates named preserved focused evidence; not blanket credit for 230 rows |
| Public browser matrix | Valid historical PASS artifact for its then-current source | No final-source credit: route inventory, locale messages, and 50 relevant files are newer |
| Admin route inventory | Valid static inventory: 75 canonical / 81 exact authenticated forms | Inventory mapping only; not runtime route coverage |
| 47/47 focused correction run | Aggregate PASS report retained, exact command/case artifact absent | No requirement promotion |
| Cross-store isolation run | Backend focused evidence is preserved; browser pass ledger absent | BZR-REQ-0112 advances only to PARTIAL |
| Latest authenticated matrix | Artifact explicitly says INTERRUPTED; approximately 352 passes reported | No matrix PASS; no individual credit because passed-case identities were not retained |
| Interrupted/aborted matrices | Valid as incomplete run history | Zero PASS credit |

## External blocked requirements and theoretical maximum

If every non-external requirement passed and all defects were closed, the four external BLOCKED rows would cap raw official readiness at **98.3906%**. Their combined impact is **1.6094 percentage points**. Application-owned theoretical maximum is 100.0%. The current unresolved Critical defect independently caps the official score at 49%.

| Requirement | Risk | Exact official impact | Missing external evidence |
| --- | ---: | ---: | --- |
| BZR-REQ-0083 | 5 | 0.7092 pp | Authorized non-production fiscal/KKM connector, tax fixture, and safe receipt-transmission target |
| BZR-REQ-0118 | 3 | 0.3383 pp | Authorized email-delivery sandbox, sender identity, and test inbox |
| BZR-REQ-0180 | 5 | 0.2809 pp | Authorized provider sandbox credentials and non-production integration target |
| BZR-REQ-0182 | 5 | 0.2809 pp | Authorized billing-provider sandbox and non-production payment method |

## Defects

Remaining: **Blocker 0 / Critical 1 / High 2 / Medium 18 / Low 3 = 24 open**. Only PUBLIC-014 and AUTH-A11Y-001 were resolved in this reconciliation. No Critical or High defect was closed.

| Severity | ID | Remaining defect / acceptance gap |
| --- | --- | --- |
| CRITICAL | BZR-PRD-001 | Receiving computes and exports the wrong weighted-average cost — Use the full pre-receipt on-hand quantity and value in a transactional weighted-average calculation; round only at the defined persistence/display boundary; UI, movement-derived value, reports, and CSV agree for initial-stock and multi-receipt regression cases. |
| HIGH | PUBLIC-001 | Landing legal links bypass the published Privacy Policy — Footer privacy opens /privacy in every locale and viewport; legal information has a durable public page; /privacy is in sitemap.xml; keyboard/mobile navigation regressions pass. |
| HIGH | REPORTS-001 | Reports overview omits a completed in-range write-off after reload — Every posted write-off appears immediately and after reload for an inclusive, timezone-correct date range and matching store scope; on-screen rows and CSV/XLSX exports reconcile by movement ID, quantity, value, store, and timestamp. |
| LOW | PUBLIC-012 | Developer documentation retains a deployment placeholder — Replace placeholder copy with the exact production URL and cover it in content review tests. |
| LOW | PUBLIC-013 | Conventional favicon path returns 404 — Serve or redirect /favicon.ico with the correct content type and cache headers. |
| LOW | PUBLIC-015 | Static public pages ship unusually large HTML documents — Set a transfer budget, reduce serialized/inline payload, and retest under mobile throttling with field Web Vitals. |
| MEDIUM | COMPAT-001 | Inventory receive action query is removed and ignored — /inventory?action=receive deterministically opens the receiving state or redirects to /inventory/receiving at every viewport; Back/Forward and refresh preserve the intended state; route tests assert the final URL and visible receiving controls. |
| MEDIUM | DYNAMIC-001 | Invalid dynamic IDs fail to terminate safely on multiple authenticated routes — Malformed and nonexistent IDs for every dynamic pattern return a deterministic terminal 404/not-found state; all edit/apply/save controls remain absent or disabled; loading stops; valid owned IDs continue to render; automated tests cover both negative forms for all 11 patterns. |
| MEDIUM | INVENTORY-001 | Transfer movement detail omits the destination inventory leg — Every transfer detail and print/export view shows exactly one balanced source leg and one balanced destination leg; totals and store balances reconcile. |
| MEDIUM | KKM-002 | KKM queue terminates in a generic error with Fetch 403 responses at every viewport — For an authorized ADMIN, resolve the failing request or map each expected configuration/permission/service state to an explicit message and next action; identify the affected dependency instead of showing generic retry text; verify clean terminal behavior with no unexplained 403 at 1440, 1024, and 390 without requiring a fiscal action. |
| MEDIUM | LAYOUT-001 | Inventory movement table causes root-document horizontal overflow at desktop/tablet widths — Constrain the table/grid parent so horizontal overflow is internal at every breakpoint; document root has zero overflow at 768, 1024, and 1440; sidebar/navigation never pans. |
| MEDIUM | LAYOUT-002 | Receipt register causes root-document overflow at 1024 px — Root overflow is zero at 1024 px for both receipt routes after data loads; table overflow remains internal and all actions remain reachable. |
| MEDIUM | ORDERS-001 | Customer-order creation accepts a zero-line, zero-total draft — Client and server reject zero-line orders without creating a record; at least one active product/variant and positive quantity are required; regression asserts no sequence/record allocation on rejected submit. |
| MEDIUM | ORDERS-002 | Cancelled customer order still exposes enabled tracking and confirmation controls — For Cancelled orders, disable every tracking field and save/send/confirmation action; API mutations fail closed with no tracking, status, audit-log, or outbound-message side effects; regression covers UI and direct API authorization/state guards. |
| MEDIUM | PUBLIC-002 | Privacy Policy lacks operational controller and retention details — Publish a counsel-reviewed notice with operator identity, direct contact, retention/deletion terms, rights/complaint process, effective date, and locale parity. |
| MEDIUM | PUBLIC-003 | Bazaar Guide has no Orders or Customers instructions — Publish current create/edit/status/cancel/customer-history guides and verify each against production UI and applicable roles. |
| MEDIUM | PUBLIC-004 | Guide advertises a non-working Command+K shortcut and gives search no visible focus indicator — Make platform-appropriate shortcuts focus search and add a clearly visible WCAG-compliant focus treatment with keyboard regression tests. |
| MEDIUM | PUBLIC-005 | Invalid reset and business-registration tokens render actionable forms before validation — Validate token on load, show a non-actionable invalid/expired state with recovery guidance, and add server-enforcement integration tests. |
| MEDIUM | PUBLIC-006 | Several public form errors and selects are not programmatically associated — Associate labels/error IDs, set aria-invalid, announce submit errors, and give every select a stable accessible name. |
| MEDIUM | PUBLIC-007 | Auth and error pages use generic titles and skip the H1 heading level — Set localized route-specific titles and promote the primary visible heading to H1 without changing visual style. |
| MEDIUM | PUBLIC-008 | Repeated public text-contrast misses fall below WCAG AA — Adjust all affected state colors to measured WCAG AA ratios and verify with automated and manual contrast review. |
| MEDIUM | PUBLIC-009 | Native app association resources configure no applications — Populate correct production identifiers/fingerprints/paths and validate on physical devices, or explicitly document that association is unsupported. |
| MEDIUM | PUBLIC-010 | Unknown catalog slugs are HTTP soft-404 pages — Return a real 404 document while preserving the friendly localized state, title, and H1. |
| MEDIUM | PUBLIC-011 | Complex Guide articles illustrate only the first step — Add current step-specific captures or concrete control/location detail and verify every guide against applicable roles and production UI. |

## Why the official tracker stayed at 47.8%

1. `readiness-current.json` was still the baseline snapshot generated at 2026-08-30T19:22:30.825Z; its requirements, defects, and supporting metrics had never been promoted.
2. The updater is deliberately non-inferential and non-overwriting: test output does not change a requirement unless an explicit evidence manifest is validated and promoted.
3. The earlier 13-row manifest was provisional and intentionally not applied. This checkpoint rejected three source-only PASS claims and retained only exact behavior/evidence-bounded changes.
4. The public PASS artifact predates relevant source changes, and the authenticated artifact is interrupted. Neither could truthfully complete the route/auth matrices.
5. Open Critical BZR-PRD-001 imposes a 49% official cap even though the reconciled raw score is 51.4%.

## Source statistics at the application freeze

| Item | Count |
| --- | ---: |
| Production application files changed | 215 |
| Files under tests/ | 174 (142 executable tests; 32 support/fixtures) |
| Audit/harness files changed | 61 (29 outside `tests/`; 32 test-support files already included in the 174 test-tree count) |
| Dedicated audit tooling within that harness count | 7 |
| Generated readiness evidence/tracker files before this checkpoint | 8 |
| Generated readiness evidence/tracker files after this checkpoint | 12 (four audit-only additions) |
| Tracked modifications | 242 |
| Tracked deletions | 1 |
| Untracked files | 202 |
| Tracked additions/deletions | +16234 / -11089 |
| Untracked text additions | +65545 plus one binary favicon |
| Inclusive text additions/deletions | +81779 / -11089 |

The freeze scope contains 222 changed paths when root runtime/configuration inputs are included. The stricter production-code classification is 215 files. Audit-only checkpoint files created after the freeze do not change either number. After adding the evidence JSON, update manifest, reconciled snapshot, report, and current-status section, `git status` contains 449 entries (242 tracked modifications, one tracked deletion, and 206 untracked files). Current inclusive text volume is +96,738 / -11,089; the tracked diff itself remains +16,234 / -11,089.

## Every remaining PARTIAL, FAIL, or BLOCKED requirement

Count: 172 (114 PARTIAL, 16 FAIL, 42 BLOCKED).

| Requirement | Status | Risk | Requirement | Exact missing evidence or behavior |
| --- | --- | ---: | --- | --- |
| BZR-REQ-0002 | PARTIAL | 3 | Open every canonical route or pattern directly | All 116 canonical patterns received direct browser checks, but the post-reproduction exact-form matrix still contains ten FAIL outcomes. |
| BZR-REQ-0003 | PARTIAL | 1 | Reach routes through application navigation where navigation exists | Representative landing, Guide, sidebar, reports, and workflow navigation was exercised; not every canonical route was reached through UI navigation. |
| BZR-REQ-0004 | PARTIAL | 1 | Verify page title, primary heading, breadcrumbs, active navigation, and back navigation | Broad DOM checks were recorded, but public auth/error routes have generic titles and missing H1; not every breadcrumb/active-state path was manually verified. |
| BZR-REQ-0005 | PARTIAL | 3 | Refresh and deep-link routes without blank, 500, loop, or perpetual loading states | Most focused routes survived deep links/refresh and focused KKM checks reached a finite generic retry state; several malformed/nonexistent dynamic IDs still remain loading or expose nonterminal shells. |
| BZR-REQ-0007 | PARTIAL | 1 | Compatibility redirects preserve exact query, fragment, selected state, and avoid loops | Eight exact URL/history mappings pass, but the three cash aliases have no matching hash target or machine-detectable selected UI state. |
| BZR-REQ-0008 | FAIL | 3 | Inventory action=receive compatibility state opens the receiving workflow | COMPAT-001: the query is removed at all three viewports and leaves the ordinary inventory list. |
| BZR-REQ-0009 | PARTIAL | 3 | Exercise loading, empty, success, validation, permission, and error states where safe | All state families were sampled, but not for every major form/route. |
| BZR-REQ-0010 | PARTIAL | 3 | Use valid owned dynamic IDs for dynamic routes | Only purchase-orders/{id} received a genuine owned-value visit in the systematic dynamic matrix; valid-value coverage was 1/11 and ten patterns remain blocked there, despite separate workflow-owned records elsewhere. |
| BZR-REQ-0011 | FAIL | 3 | Malformed and nonexistent dynamic IDs fail safely without internal leakage | DYNAMIC-001: eight authenticated patterns remain loading or show actionable editor shells; catalog is also a soft 404. No stack/SQL/ORM leakage was observed. |
| BZR-REQ-0013 | FAIL | 3 | Landing legal controls navigate to the published Privacy Policy | PUBLIC-001: legal/privacy controls link to WhatsApp instead of /privacy at all three viewports. |
| BZR-REQ-0014 | PARTIAL | 3 | Privacy page is reachable and contains operationally complete production policy information | Page is readable/localized but controller, retention, and operational details are incomplete and it is omitted from the sitemap. |
| BZR-REQ-0015 | PARTIAL | 1 | Developer documentation is production-specific and free of deployment placeholders | Documentation renders and navigates, but production copy retains a post-deployment placeholder. |
| BZR-REQ-0017 | PARTIAL | 3 | Guide instructions match the live authenticated UI for every article | Several workflows were cross-checked through live use, but complete authenticated parity for all 20 articles was not recorded. |
| BZR-REQ-0018 | PARTIAL | 1 | Guide provides actionable Orders and Customers instructions | Orders and Customers Guide content, search, route catalog and earlier rendered public coverage prove that the formerly empty areas are now populated. The current public inventory and related source changed after the retained browser pass, and production UI/role parity is not preserved as final-source evidence. |
| BZR-REQ-0019 | PARTIAL | 1 | Guide provides sufficient step-specific visual guidance for multi-stage workflows | Articles are structurally complete but generally use one step-1 image for 2–5-step workflows. |
| BZR-REQ-0022 | BLOCKED | 3 | Create and verify a bundle product | Bundle form route/empty state was inspected, but no bundle lifecycle was created. |
| BZR-REQ-0023 | PARTIAL | 3 | Manage categories, units, and attributes | Pages and validation surfaces were inspected; a complete create/edit/delete lifecycle for each setting was not recorded. |
| BZR-REQ-0024 | PARTIAL | 3 | Search, filter, sort, and paginate products | Populated list, controls, sorting and pagination were present and sampled, but the full state lifecycle was not traced for every operation. |
| BZR-REQ-0025 | BLOCKED | 3 | Reject or warn about duplicate products | Duplicate-check UI was visible, but a safe duplicate submission/result was not recorded. |
| BZR-REQ-0026 | BLOCKED | 3 | Validate harmless product imports and report invalid rows | Import routes loaded; no production file upload/import validation was executed. |
| BZR-REQ-0027 | BLOCKED | 1 | Product image add/validation/display workflow works | Image controls/routes were inspected only; no safe upload lifecycle was recorded. |
| BZR-REQ-0032 | BLOCKED | 5 | Perform or safely inspect and apply an inventory count | Count pages were inspected; applying a production count was unsafe and not authorized. |
| BZR-REQ-0033 | FAIL | 3 | Movement history and detail represent inventory actions completely | Transfer detail omits the destination +1 leg even though balances changed correctly. |
| BZR-REQ-0034 | PARTIAL | 3 | Movement print output is generated and verified | Print routes and controls were reached, but full rendered-output reconciliation for every movement type was not recorded. |
| BZR-REQ-0035 | PARTIAL | 3 | Create and inspect a supplier | Supplier workflow screenshots exist, but a complete structured create/search/edit/archive trace is absent. |
| BZR-REQ-0036 | PARTIAL | 3 | Create, edit, and inspect a purchase order | Draft creation/update and restoration are evidenced; totals/status/receiving lifecycle is incomplete. |
| BZR-REQ-0037 | PARTIAL | 5 | POS product lookup, cart, quantity, discount, and customer operations work | Product/cart and mobile entry are evidenced; quantity, discount, and customer scenarios are not fully traced. |
| BZR-REQ-0039 | PARTIAL | 3 | Create and inspect a test customer | Customer create UI is evidenced, but full search/edit/archive relationship coverage is incomplete. |
| BZR-REQ-0041 | PARTIAL | 3 | Sales-order metrics and owned dynamic order detail render | Routes and an owned detail record rendered, but metrics were not reconciled against a completed order. |
| BZR-REQ-0046 | BLOCKED | 3 | Platform page works for a platform owner | No platform-owner account was available; supplied ADMIN denial is not proof of platform-owner functionality. |
| BZR-REQ-0047 | BLOCKED | 3 | Organization-owner diagnostics page works for the owner | Supplied ADMIN was correctly denied as a non-owner; no organization-owner account was available to prove functionality. |
| BZR-REQ-0048 | PARTIAL | 5 | KKM queue reaches a terminal usable, empty, or recoverable-error state | Focused reproduction at 1440, 1024, and 390 widths withdrew the loading/denial finding, but every width displays the same opaque generic error with Retry and one or two Fetch 403s; this is finite but does not prove a usable queue or diagnostic recovery state (KKM-002). |
| BZR-REQ-0049 | PARTIAL | 3 | Important forms reject empty submissions and missing required fields | Public auth, product, receiving, and several create forms were sampled; coverage is not exhaustive. |
| BZR-REQ-0050 | PARTIAL | 5 | Important forms enforce minimum, maximum, zero, and negative restrictions | Receiving rejects 0/-1 and product negative price was rejected, but empty-order creation violates structural validation and maximum bounds were not broadly tested. |
| BZR-REQ-0051 | PARTIAL | 3 | Important numeric forms handle decimals and rounding | Decimal receipt amounts were accepted, but resulting cost rounding/calculation is wrong. |
| BZR-REQ-0052 | BLOCKED | 1 | Forms handle leading/trailing spaces, long input, Unicode, Cyrillic, and Kyrgyz safely | Locale UI was exercised, but these input-boundary cases were not systematically submitted. |
| BZR-REQ-0053 | PARTIAL | 1 | Phone and email formatting validation is correct | Email required/malformed cases passed; phone formatting was not comprehensively exercised. |
| BZR-REQ-0054 | BLOCKED | 1 | Invalid, past, and future date validation is correct | Date controls rendered; invalid and boundary date submissions were not recorded. |
| BZR-REQ-0055 | BLOCKED | 1 | Upload controls reject invalid file types and sizes | No production upload was attempted. |
| BZR-REQ-0056 | BLOCKED | 3 | Cancel and unsaved-change behavior protects user input | No complete unsaved-change warning/recovery trace was recorded. |
| BZR-REQ-0057 | PARTIAL | 3 | Product creation propagates to inventory and POS availability | The audit product appeared in product/inventory workflows; POS availability was sampled but not fully reconciled across stores. |
| BZR-REQ-0060 | PARTIAL | 5 | Inventory valuation, margin/profit, and purchase-cost consumers use the correct cost | The corrected persisted basis now agrees across inventory snapshot, valued movements, product list, product detail, product pricing, store pricing, and product CSV for both weighted-cost cases. Margin/profit reports and every remaining purchase-cost consumer still await the full repaired DB/report lane. |
| BZR-REQ-0062 | FAIL | 3 | Transfer detail, print, and audit trail show both balanced legs | Destination +1 line is absent from the detail table. |
| BZR-REQ-0066 | PARTIAL | 5 | Cancelled or interrupted inventory operations do not mutate stock | Invalid/cancel boundaries were sampled, but refresh/interruption was not tested for every inventory workflow. |
| BZR-REQ-0067 | BLOCKED | 5 | Inventory-count application reconciles counted and expected stock | Applying a production count was intentionally stopped before the side-effect boundary. |
| BZR-REQ-0068 | PARTIAL | 5 | Purchase-order line totals and document totals are correct | Draft/update screens were inspected, but an evidence-backed total calculation and edge set is incomplete. |
| BZR-REQ-0069 | PARTIAL | 3 | Purchase-order status transitions are correct | Draft state was exercised; full confirm/receive/cancel lifecycle was not completed. |
| BZR-REQ-0070 | PARTIAL | 5 | Purchase order, receiving document, supplier, and inventory are linked consistently | Both workflows were exercised separately; a complete PO-to-receiving chain was not completed. |
| BZR-REQ-0071 | FAIL | 5 | Sales order rejects zero-line or zero-total creation | ORDERS-001: a zero-line 0 KGS draft was created. |
| BZR-REQ-0072 | BLOCKED | 5 | Sales-order add/remove lines and totals are correct | No completed valid line-item order is evidenced. |
| BZR-REQ-0073 | PARTIAL | 3 | Sales-order status changes and customer relationship remain consistent | Draft/cancel controls were inspected, but a valid lifecycle and relationship reconciliation are incomplete. |
| BZR-REQ-0075 | PARTIAL | 5 | POS discounts compute correctly and reject invalid values | Discount UI was inspected in cart context; no complete structured boundary/calculation trace is available. |
| BZR-REQ-0076 | PARTIAL | 5 | POS quantity changes and cart totals reconcile | A one-item cart is evidenced; multiple quantities and independent total reconciliation are incomplete. |
| BZR-REQ-0077 | BLOCKED | 5 | POS split-payment amounts reconcile to the sale total | Payment/fiscal submission was intentionally not completed; no sandbox was available. |
| BZR-REQ-0078 | BLOCKED | 5 | POS completed sale creates a correct receipt and history entry | No real payment/fiscal sale was authorized; held/cancelled receipt only. |
| BZR-REQ-0079 | BLOCKED | 5 | POS return restores stock and reverses money correctly | No safe completed sale existed to return. |
| BZR-REQ-0080 | BLOCKED | 5 | POS debt lifecycle and balances reconcile | Debt creation/collection was not authorized or completed. |
| BZR-REQ-0081 | BLOCKED | 5 | Cash pay-in and pay-out movements reconcile | Cash movements were stopped before production financial side effects. |
| BZR-REQ-0082 | PARTIAL | 5 | Shift opening, closing, and cash reconciliation are correct | An existing open shift and shift pages were inspected; opening/closing/reconciliation were not executed. |
| BZR-REQ-0083 | BLOCKED | 5 | Fiscal/KKM and tax behavior is correct | Authorized non-production fiscal/KKM connector, tax fixture, and safe receipt-transmission target |
| BZR-REQ-0084 | FAIL | 5 | Report totals match source transactions | Inventory-cost inputs are demonstrably wrong, so valuation/margin outputs cannot reconcile even though report pages render. |
| BZR-REQ-0085 | PARTIAL | 5 | Totals remain consistent across UI pages and exports | For the two focused cost cases, persisted basis, movement-derived value, product list/detail/pricing/store-pricing values, and product CSV agree, including the corrected audit value KGS 80.46. Broad UI pages, reports, and every export total still await final DB and browser reconciliation. |
| BZR-REQ-0086 | PARTIAL | 3 | Currency formatting and decimal display are consistent | KGS formatting is broadly consistent, but not all document/export/print contexts or alternate store currencies were reconciled. |
| BZR-REQ-0087 | PARTIAL | 1 | Test records are safely cleaned up or explicitly inventoried | Balances were reversed/zeroed, but immutable audit records and some created workflow records remain for disclosure. |
| BZR-REQ-0089 | PARTIAL | 5 | Invalid password and unknown account fail generically | Unknown-account generic 401 passed; a separately evidenced invalid-password attempt was not recorded. |
| BZR-REQ-0091 | BLOCKED | 1 | Repeated login submission is safely de-duplicated | No deliberate repeated credential submission was performed to avoid lockout/rate-limit effects. |
| BZR-REQ-0092 | PARTIAL | 5 | Logout blocks protected routes and leaves no sensitive session content | Signed-out /reports correctly redirected to /login?next=/reports; full logout/back chain is not structurally evidenced. |
| BZR-REQ-0093 | PARTIAL | 3 | Redirect back after login returns to the original protected route | The next parameter is preserved, but the complete signed-out-to-login-to-original-route chain was not recorded. |
| BZR-REQ-0094 | BLOCKED | 3 | Authenticated user opening /login is handled correctly | No focused authenticated /login behavior artifact was recorded. |
| BZR-REQ-0096 | BLOCKED | 5 | Back navigation after logout cannot restore protected content | No complete logout/back cache test was recorded. |
| BZR-REQ-0097 | BLOCKED | 3 | Multi-tab session consistency | No multi-tab sign-in/sign-out consistency test was recorded. |
| BZR-REQ-0098 | BLOCKED | 5 | Expired or invalid session fails safely | The production session was not deliberately invalidated. |
| BZR-REQ-0106 | PARTIAL | 5 | Denied in-page actions are enforced | Route boundaries are strong, but action-level denial inside accessible pages was only sampled. |
| BZR-REQ-0107 | PARTIAL | 5 | Create/edit/delete permissions match role policy | ADMIN workflows and lower-role route gates were tested; action-level CRUD denial is incomplete. |
| BZR-REQ-0108 | PARTIAL | 3 | Export and printing permissions match role policy | Restricted report routes passed; in-page export/print action enforcement was not exhaustively exercised. |
| BZR-REQ-0110 | PARTIAL | 3 | Organization-owner diagnostics are restricted and functional | Non-owner ADMIN denial passed, but functionality remains unverified without an organization-owner account. |
| BZR-REQ-0111 | BLOCKED | 3 | Platform-owner functionality and restriction are verified with a platform owner | No platform-owner credentials were available. |
| BZR-REQ-0112 | PARTIAL | 5 | Cross-organization tenant isolation is verified with a legitimate second tenant | Isolated DB tests created legitimate second-organization records and rejected cross-organization customer, purchase-order, supplier, API-key, product, and integration access without side effects. The final authenticated direct-URL and UI/API matrix is still pending. |
| BZR-REQ-0113 | PARTIAL | 5 | Store-level data separation and store switching are correct | Two-store transfer balances and selectors were exercised, but all modules/actions were not isolated per store. |
| BZR-REQ-0115 | PARTIAL | 5 | Observed UI API responses contain no cross-role or cross-tenant sensitive data | No leakage was observed, but a legitimate second tenant was unavailable and this was not a direct API audit. |
| BZR-REQ-0116 | BLOCKED | 3 | Valid invite/reset/verify/business-registration token lifecycles work | No valid tokens or inbox were available. |
| BZR-REQ-0117 | FAIL | 3 | Invalid, malformed, expired, and reused token routes fail before collecting actionable data | Reset and business-registration invalid tokens render actionable forms before validation; expired/reused cases were unavailable. |
| BZR-REQ-0118 | BLOCKED | 3 | Signup and reset email delivery completes | Authorized email-delivery sandbox, sender identity, and test inbox |
| BZR-REQ-0119 | BLOCKED | 3 | Signup mode and complete account-creation lifecycle work | Form validation was tested but no account was created. |
| BZR-REQ-0120 | BLOCKED | 3 | Published catalog access and ownership are correct | An existing published slug was discovered but not opened; no audit-owned published slug was available to validate ownership, and only the nonexistent state was tested. |
| BZR-REQ-0122 | PARTIAL | 3 | Refresh during multi-step workflows recovers safely | PO draft restoration and Guide state persistence were observed; critical POS/inventory multi-step refresh coverage is incomplete. |
| BZR-REQ-0123 | PARTIAL | 5 | Repeated clicks and duplicate submissions do not create duplicates | Repeated inventory interaction and single receiving post were safe; broad repeated-submit coverage is incomplete. |
| BZR-REQ-0124 | BLOCKED | 3 | Stale pages do not overwrite newer state | No controlled concurrent/stale edit test was recorded. |
| BZR-REQ-0127 | BLOCKED | 5 | Loss of session is handled safely during an active workflow | Session invalidation was not performed. |
| BZR-REQ-0128 | PARTIAL | 3 | Naturally encountered failed requests show safe recovery | Negative resources and auth errors rendered safe states; retry/recovery was not demonstrated for every failure. |
| BZR-REQ-0129 | PARTIAL | 1 | Empty data states are useful and do not masquerade as errors | Several empty states rendered correctly; zero-line order creation and Guide Orders emptiness are defects. |
| BZR-REQ-0130 | PARTIAL | 1 | Existing large lists remain usable | 139 movement rows and multi-page report/product lists rendered, but horizontal-layout defects reduce usability. |
| BZR-REQ-0131 | BLOCKED | 3 | Unsaved changes are preserved or explicitly warned | No focused unsaved-change test artifact exists. |
| BZR-REQ-0133 | PARTIAL | 5 | Cancelled operations leave no unintended stock or financial effect | Invalid receiving and cancelled held receipt were safe; all workflows were not covered. |
| BZR-REQ-0134 | PARTIAL | 3 | Console errors and failed UI requests are absent or user-safe | No unexpected public exceptions; expected 403/404s and accessibility warnings occurred. Focused KKM 403s produced a finite recoverable error, while some invalid dynamic-ID states still fail to terminate usefully. |
| BZR-REQ-0136 | PARTIAL | 1 | Visual alignment and spacing are coherent | Representative screenshots were reviewed; no exhaustive visual-diff baseline was used. |
| BZR-REQ-0137 | FAIL | 3 | Content does not overlap or clip and root does not horizontally overflow | Movement journal has physical root overflow at 768–1440 and receipt register overflows at 1024. |
| BZR-REQ-0138 | PARTIAL | 1 | Terminology and translations are consistent | Broadly understandable, but Guide pluralization and some incomplete/mixed localized content remain. |
| BZR-REQ-0139 | PARTIAL | 1 | Buttons and disabled states communicate the correct action | Representative actions were reviewed; every disabled state was not validated. |
| BZR-REQ-0140 | PARTIAL | 3 | Destructive actions provide suitable confirmation and warning | Some archive/delete warnings are visible; confirmation behavior was not traced for every destructive action. |
| BZR-REQ-0141 | PARTIAL | 3 | Notifications provide clear non-conflicting success/error feedback | Success/error toasts appeared, but repeated harness attempts left overlapping stale validation messages in one create trace. |
| BZR-REQ-0142 | PARTIAL | 1 | Empty-state guidance is actionable | Many empty states guide users, while Guide Orders is empty and invalid token forms are misleading. |
| BZR-REQ-0143 | FAIL | 1 | Loading feedback is finite and useful | Focused KKM checks now terminate with a generic retry state, but DYNAMIC-001 remains: several malformed/nonexistent IDs persist on loading screens or actionable nonterminal shells. |
| BZR-REQ-0144 | FAIL | 3 | Tables remain usable with internal scrolling and reachable actions | Movement and receipt tables expand the application root at key widths. |
| BZR-REQ-0145 | PARTIAL | 1 | Filters and search are discoverable and operable | Guide/product/report controls are visible; Command+K Guide shortcut does not work and focus feedback is weak. |
| BZR-REQ-0146 | PARTIAL | 3 | Modals lock scroll, trap focus, restore focus, and close predictably | Landing menu and Guide annotation dialog passed representative behavior; authenticated dialogs have missing-description warnings and incomplete focus evidence. |
| BZR-REQ-0147 | PARTIAL | 1 | Sticky navigation and focus retention remain stable | Navigation works normally, but root horizontal panning can move the app shell off-screen. |
| BZR-REQ-0149 | PARTIAL | 3 | Accidental double submissions are prevented | Receiving posted once and one repeated interaction was safe; broad double-submit coverage is incomplete. |
| BZR-REQ-0150 | PARTIAL | 3 | Every canonical route receives a desktop responsive smoke | All routes were swept at desktop, but some dynamic valid states and principal workflows remain incomplete. |
| BZR-REQ-0151 | FAIL | 3 | Every canonical route receives a tablet responsive smoke | Route sweep executed, but movement root overflow reaches 604–844 px and receipt tables overflow 206 px. |
| BZR-REQ-0152 | PARTIAL | 3 | Every canonical route receives a mobile responsive smoke | Mobile route coverage executed and focused reproduction withdrew the apparent ADMIN denials; dynamic valid-state and principal-workflow coverage remains incomplete. |
| BZR-REQ-0155 | PARTIAL | 3 | Critical mobile product lookup works | Product list/search surface rendered on mobile; end-to-end lookup/select action was not fully traced. |
| BZR-REQ-0156 | BLOCKED | 3 | Critical mobile product creation or editing works | Mobile route rendered, but the create/edit save workflow was executed only on desktop. |
| BZR-REQ-0157 | PARTIAL | 5 | Critical mobile inventory interactions work | Inventory routes/cards render on mobile without root overflow; stock mutation lifecycle was desktop-only. |
| BZR-REQ-0158 | PARTIAL | 5 | Critical mobile POS interaction works | Mobile POS entry and the 16-row receipt register render, and KKM reaches a recoverable terminal state; payment, split, return, and fiscal completion remain blocked. |
| BZR-REQ-0159 | PARTIAL | 3 | Critical mobile orders interaction works | Orders routes rendered on mobile; valid create/edit/status lifecycle was not completed. |
| BZR-REQ-0160 | PARTIAL | 3 | Critical mobile customers interaction works | Customer route/dialog rendered; create/edit lifecycle was not completed on mobile. |
| BZR-REQ-0161 | PARTIAL | 3 | Critical mobile reports interaction works | Focused mobile reproduction rendered /reports/receipts with 16 rows and no denial/loading; complete mobile filter/export interaction and report-to-ledger reconciliation remain incomplete or defected. |
| BZR-REQ-0162 | PARTIAL | 3 | Critical mobile settings and navigation work | Profile/settings and mobile app navigation rendered; full menu interaction probe was inconclusive. |
| BZR-REQ-0163 | PARTIAL | 1 | Tables, dropdowns, dates, scanners, print controls, and long labels work responsively | Representative controls were inspected, but table overflow and incomplete scanner/print interaction prevent a pass. |
| BZR-REQ-0164 | PARTIAL | 3 | Report filters work | Filter controls and presets rendered; not every filter/result pair was reconciled. |
| BZR-REQ-0165 | PARTIAL | 3 | Report date ranges work | Preset/custom date controls were present; boundary/invalid/empty range set is incomplete. |
| BZR-REQ-0166 | FAIL | 5 | Reports compare correctly against created audit transactions | Wrong inventory cost invalidates cost/margin reporting and no completed sale/order baseline was available. |
| BZR-REQ-0167 | BLOCKED | 1 | Reports handle an empty date range | No explicit evidence of a guaranteed-empty range interaction was recorded. |
| BZR-REQ-0169 | PARTIAL | 5 | Exported values and totals are correct | The product CSV now exports correct average-cost and purchase-price values for both focused weighted-cost cases, including KGS 80.46 for the original audit case. Other export types and aggregate totals were not included in the completed focused DB lane. |
| BZR-REQ-0170 | PARTIAL | 3 | Export encoding, headings, dates, and currency are correct | UTF-8/BOM and Russian headings were correct in the sampled product CSV; dates/currency and all export types were not covered. |
| BZR-REQ-0171 | PARTIAL | 3 | Receipt and close reports are operationally correct | Routes render; receipt tablet overflow exists and no shift close/reconciliation was executed. |
| BZR-REQ-0174 | PARTIAL | 3 | Integration validation is correct | Configuration surfaces were inspected; safe empty/invalid submissions were not completed for every integration. |
| BZR-REQ-0175 | PARTIAL | 3 | Integration secrets are masked | No visible secret leakage was recorded, but every credential field/state was not manually inspected. |
| BZR-REQ-0176 | PARTIAL | 3 | Integration connection state and setup guidance are clear | Pages show states/guidance; correctness against real providers was not verified. |
| BZR-REQ-0177 | BLOCKED | 3 | Integration disconnect warnings are clear | No live service was disconnected and the full confirm boundary was not evidenced. |
| BZR-REQ-0179 | PARTIAL | 1 | Integration empty and error states are useful | Representative states rendered; natural provider failure/retry was unavailable. |
| BZR-REQ-0180 | BLOCKED | 5 | Connect or disconnect a live integration safely | Authorized provider sandbox credentials and non-production integration target |
| BZR-REQ-0181 | BLOCKED | 5 | Publish and verify a public catalog | Catalog publishing was explicitly outside authorization. |
| BZR-REQ-0182 | BLOCKED | 5 | Billing mutations are safe and correct | Authorized billing-provider sandbox and non-production payment method |
| BZR-REQ-0183 | PARTIAL | 3 | Administrative operational pages show understandable current data | Jobs/metrics/support/etc. render; operational freshness and every action were not independently reconciled. |
| BZR-REQ-0184 | PARTIAL | 5 | Operational pages expose only appropriate data | No obvious leakage observed and route gates pass; second-tenant and full action-level verification are missing. |
| BZR-REQ-0185 | PARTIAL | 3 | Onboarding and organization/store settings are usable | Onboarding/settings were inspected but not completed because that would alter the production organization. |
| BZR-REQ-0186 | PARTIAL | 5 | Store switching and store-level operational state are correct | Store selectors and two-store inventory effects were exercised; all modules were not reconciled per store. |
| BZR-REQ-0187 | PARTIAL | 3 | Compliance and hardware pages are useful and correctly restricted | Routes/access rendered; real device/fiscal configuration was not changed. |
| BZR-REQ-0188 | BLOCKED | 5 | Employee invitation and role assignment lifecycle works | No email invitation was sent and no production user was created. |
| BZR-REQ-0189 | PARTIAL | 3 | Keyboard-only navigation works | Landing/auth/Guide keyboard interactions were sampled; no full authenticated keyboard tour was completed. |
| BZR-REQ-0190 | PARTIAL | 1 | Visible focus is always present | Focus generally appears, but Guide search/Command+K has missing visible focus behavior. |
| BZR-REQ-0191 | PARTIAL | 1 | Focus order is logical | Representative public flows were inspected; full application order was not manually audited. |
| BZR-REQ-0192 | PARTIAL | 1 | Modal focus trapping and restoration work | Guide/landing samples pass; authenticated dialog restoration coverage is incomplete. |
| BZR-REQ-0193 | PARTIAL | 1 | Buttons and icon controls have accessible names | Many controls are named, but sampled public selects and some controls are unnamed. |
| BZR-REQ-0194 | PARTIAL | 3 | Form labels and errors are programmatically associated | Audited signup, invite, token-invite, and business-registration forms now expose label/control associations, aria-invalid, aria-describedby, alert roles, polite announcements, and stable select names. The shared FormControl regression references only rendered description/error IDs. A complete authenticated-form browser inventory remains pending. |
| BZR-REQ-0195 | PARTIAL | 1 | Heading order provides a meaningful H1 | All audited login, signup, invite, reset, verify, and business-registration routes now provide localized route metadata and a primary H1. The missing-catalog state has localized metadata and H1 source coverage. Full runtime heading-order coverage for every authenticated route remains pending. |
| BZR-REQ-0196 | FAIL | 3 | Text color contrast meets WCAG AA | Measured samples fall below 4.5:1, including values as low as 2.77:1. |
| BZR-REQ-0197 | PARTIAL | 1 | Errors are indicated by more than color | Visible text errors exist, but programmatic association/status coverage is incomplete. |
| BZR-REQ-0198 | PARTIAL | 1 | Status and validation messages are screen-reader friendly | Some roles/pressed states are exposed; form status announcement coverage is incomplete. |
| BZR-REQ-0199 | BLOCKED | 1 | 200% zoom and narrow viewport accessibility | Narrow viewports were tested, but formal 200% zoom was not. |
| BZR-REQ-0200 | BLOCKED | 1 | Formal screen-reader workflow session | Tool-assisted accessibility trees were used; no screen-reader session was performed. |
| BZR-REQ-0205 | PARTIAL | 1 | No untranslated keys or mixed-language screens | No widespread raw keys were observed, but complete route-by-route content review was not recorded. |
| BZR-REQ-0206 | PARTIAL | 3 | Date, number, and currency localization is correct | Representative formatting is localized; every report/print/export/store currency combination is not covered. |
| BZR-REQ-0208 | PARTIAL | 1 | Validation messages are localized | Representative Russian errors were visible; full RU/KG/EN validation matrix is absent. |
| BZR-REQ-0209 | BLOCKED | 3 | Reports and print output are localized | Russian report UI was inspected, but printed/export output was not verified across RU/KG/EN. |
| BZR-REQ-0210 | PARTIAL | 1 | Long translated labels do not clip | Public routes fit; authenticated tablet table/root overflow prevents a full pass. |
| BZR-REQ-0211 | PARTIAL | 1 | Initial page loading is practically observed | Navigation timing was recorded on unthrottled Chrome; this is not field or throttled performance evidence. |
| BZR-REQ-0212 | PARTIAL | 1 | Client-side navigation is responsive | Representative navigation was responsive; rapid sequential sweeps had a few timing artifacts. |
| BZR-REQ-0213 | PARTIAL | 1 | Large tables render without unreasonable delay | Populated lists rendered, but no defined performance budget and layout defects remain. |
| BZR-REQ-0214 | PARTIAL | 1 | Search and filters respond without unnecessary delay | Representative search/filter interactions worked; no latency budget or throttled measurement was used. |
| BZR-REQ-0216 | PARTIAL | 1 | Reports render practically | Overview/reload rendered; full analytics/export latency was not measured. |
| BZR-REQ-0217 | PARTIAL | 1 | Exports complete practically | Sample product CSV query returned 200; asynchronous export jobs/large exports were not timed. |
| BZR-REQ-0218 | PARTIAL | 1 | Images load without broken assets | Guide images/icons passed, but conventional /favicon.ico is 404. |
| BZR-REQ-0219 | PARTIAL | 1 | Visible layout shifts are absent | No major shift was documented, but no CLS instrumentation was performed. |
| BZR-REQ-0220 | FAIL | 1 | Console warnings and failed assets are absent | Favicon 404 and missing dialog-description warnings are reproducible. |
| BZR-REQ-0222 | PARTIAL | 1 | sitemap.xml is valid and complete | 200 valid XML with Guide URLs, but /privacy is omitted. |
| BZR-REQ-0226 | PARTIAL | 1 | Apple app-site association is production-configured | Valid 200 JSON but application and webcredentials associations are empty. |
| BZR-REQ-0227 | PARTIAL | 1 | Android assetlinks are production-configured | Valid 200 JSON but empty association array. |
| BZR-REQ-0229 | PARTIAL | 1 | Public static documents stay within a defined mobile transfer budget | Unthrottled loads were quick, but HTML transfers were roughly 460–513 KB and no production budget is defined. |
| BZR-REQ-0230 | FAIL | 1 | Conventional favicon resource resolves | /favicon.ico returns 404. |

## Checkpoint conclusion

Official readiness is **49.0%** (raw 51.4%); application-owned readiness is **52.2%**. The tracker is reconciled, but Bazaar is not production-ready. No further implementation or matrix execution was performed.

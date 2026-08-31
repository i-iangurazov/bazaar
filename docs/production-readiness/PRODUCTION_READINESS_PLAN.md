# Bazaar production-readiness plan

Status: active  
Baseline audit window: 2026-08-30T18:03:33.843Z–2026-08-30T19:20:10.904Z  
Engineering baseline initialized: 2026-08-31 (Asia/Bishkek)

## Objective

Bring Bazaar as close as honestly possible to 100% verified production readiness. The official score remains the original 230-requirement, risk-weighted audit score. A requirement changes status only after reproducible evidence exists; external blockers remain in the official denominator.

The work stops only when every application-owned requirement passes or further progress genuinely requires external authority, an external sandbox, or a product/legal decision.

## Immutable baseline

The frozen audit is preserved in `readiness-baseline.json`. Every source row has a stable `BZR-REQ-0001`–`BZR-REQ-0230` ID, original CSV row, immutable fingerprint, baseline outcome, execution flag, provenance, and verification timestamp. The current tracker begins as an exact evidence copy in `readiness-current.json`.

| Artifact                         | SHA-256                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `production-readiness-audit.md`  | `21c93f600d3cb6e92eda332bea8f0bc580ead9cbe7cb226988879c1e428e2fea` |
| `scoring-requirements.csv`       | `c19251b253093cf7decdcaf9cba2aeccc290fc9f571c7ddd36f06789a75b5519` |
| `scoring-calculation.md`         | `22417113e3936e1b6b676faab212e307a7f1d425e41da0ed57d6fce7beb68500` |
| `scoring-calculation.json`       | `b79c32868f59d9ad864a502118b9d96444bb142f91d1674670c0472a1fb4b224` |
| `defect-register.md`             | `4879211bc02ba3301198ecdcfd38b956d53b81bd5f167aa3afd15b464ff67085` |
| `defect-register.json`           | `800c55a932725267bfedd359f3d177e448d4cceb477caed97532d23702a8a63f` |
| `route-matrix-exact-132.csv`     | `58ef90b36c84a9a8c029aa7707497372f0dd31c9bc1090776b35f17b807d1119` |
| `route-matrix-canonical-116.csv` | `08a7914f1c0f14f77ac8d24589f6f5c135de027c36f5c78f51138ef450f488a6` |
| `workflow-matrix.csv`            | `fcf35fe56308a8154bcbcf1344b8012b2da09ff64ecefcf6baa9778e4de7a0`   |

The source directory recorded by the importer is provenance only. The checked-in baseline JSON is the durable row-level preservation; many original screenshot paths under `/private/tmp` are historical references and are not represented as currently available evidence.

## Evidence and score protocol

Run:

```bash
pnpm readiness:calculate
pnpm readiness:calculate:json
```

The calculator:

- validates all 230 stable IDs against the immutable baseline;
- detects drift in requirement text, category, risk, source row, fingerprints, and baseline outcomes;
- applies PASS=1, PARTIAL=0.5, FAIL/BLOCKED=0 and excludes N/A only with written justification;
- keeps externally blocked verification in the official denominator;
- calculates category scores at full precision and rounds only displayed results;
- applies the original 49% and 64% defect caps dynamically;
- reports official and secondary application-owned readiness, execution, verified pass, risk-5 workflow, route, role, responsive, localization, and defect metrics;
- refuses a changed row without history and current evidence.

`tests/unit/readiness-calculator.test.ts` is the golden regression: the frozen baseline must reproduce 47.8%, 186/230 execution, 54/230 verified passes, and 49/67 risk-5 execution.

## Milestones

### Milestone 0 — Baseline and governance

- Preserve and checksum the audit evidence.
- Run install, formatting, lint, types, unit, database integration, i18n, build, migration, security, and existing E2E checks.
- Record pre-existing failures separately.
- Establish the tracker, calculator, decisions, status, and blocker ledger.

Exit: calculator reproduces the frozen audit exactly and baseline validation is documented.

### Milestone 1 — Critical inventory and financial correctness

- Reproduce BZR-PRD-001 before implementation.
- Correct weighted-average cost for initial stock and receiving.
- Define and test precise value accumulation and the rounding boundary.
- Cover multiple receipts, transfers, write-offs, adjustments, stock counts, sales, returns, zero/full depletion, negative-stock policy, variants, concurrent receipts, and receipt edits/rollbacks.
- Verify product detail, inventory, movement journal, reporting, profitability, and exports use the same cost basis.
- Add migration/backfill and a reconciliation report that distinguishes deterministic repair from records requiring reviewed revaluation.

Exit: every affected inventory/cost test passes, the master 5 × 80.20 + 10 × 81.25 case produces quantity 15, value 1,213.50 KGS, and average 80.90 KGS, and BZR-PRD-001 has closure evidence. No lower-severity product work begins before this exit.

### Milestone 2 — Report and ledger reconciliation

- Fix REPORTS-001 with explicit loss classification and correction netting.
- Reconcile receiving, adjustment, count, transfer, sale, return, and write-off inclusion.
- Standardize Bishkek date-only bounds.
- Use stored historical movement costs in ledger exports.
- Make displayed and complete CSV/XLSX report rows identical in scope and fields.

Exit: receiving → write-off → stock/value → report → export passes across store/date boundaries and edits.

### Milestone 3 — Legal and privacy routing

- Route every privacy control to `/privacy` in every supported locale and viewport.
- add `/privacy` to the sitemap and verify keyboard behavior.
- Keep counsel-dependent policy copy explicitly blocked until approved; do not invent legal language.

Exit: PUBLIC-001 is closed with route/link tests; PUBLIC-002 remains separately tracked if legal copy is unavailable.

### Milestone 4 — Post-save/post-apply interaction reliability

- Align the Radix dependency family so only one DismissableLayer/FocusScope stack resolves.
- Close menus before opening dialogs/navigation.
- Move mobile toasts outside navigation hit areas.
- Treat the server response as the commit boundary and bound/background cache reconciliation.
- Reuse stable operation keys across duplicate submissions.
- Restore focus to a connected trigger or destination heading.
- Run the required save/apply matrix at desktop/mobile and normal/delayed network conditions.

Exit: no residual pointer lock/overlay, navigation remains clickable, focus is sensible, and every mutation has exactly one request and one ledger/domain effect.

### Milestones 5–7 — Remaining defects, access, and isolation

- Resolve remaining HIGH, then MEDIUM/LOW defects without severity dilution.
- Repair deterministic baseline failures in timezone, effective-price ordering, and Unicode search portability.
- Sanitize deterministic test-provider defaults while retaining separate Redis/provider-enabled verification lanes.
- Add owner/platform-owner, all-role action, valid-token, second-tenant, cross-store, and cross-organization tests.
- Resolve dependency advisories, prioritizing critical/high production dependencies.

Exit: every application-owned defect and access requirement has reproducible passing evidence.

### Milestone 8 — Browser E2E and canonical route matrix

- Install and pin Playwright as a project dependency.
- Add configuration and non-production fixtures.
- Cover all 116 canonical patterns, important query/fragment states, dynamic owned/malformed/missing resources, roles, locales, and responsive boundaries.
- Cover high-risk product, inventory, purchasing, POS, orders, reporting, and settings lifecycles with `QA-BAZAAR-*` data.

Exit: deterministic desktop/mobile route and workflow suites pass without real fiscal, payment, email, billing, catalog-publication, or integration side effects.

### Milestone 9 — Full validation and final verdict

- Run format, lint, typecheck, full unit/integration/E2E, production build, migration, security, accessibility, responsive, localization, PWA/offline, performance, and rollback/recovery checks.
- Update every affected requirement and defect with evidence and timestamps.
- Produce baseline-to-final comparison, unresolved external blockers, deployment/runbook notes, and explicit onboarding verdict.

Exit: no application-owned failures remain. Pilot onboarding additionally requires no blocker/critical issue, 100% verified critical workflows, 100% application-owned readiness, at least 95% overall execution, no unresolved tenant/auth/data-integrity issue, and passed migration/recovery checks.

## Safety boundaries

- Use only isolated local/test databases and `QA-BAZAAR-*` records.
- Never use production credentials in commands, logs, screenshots, or documentation.
- Do not deploy, push, alter production infrastructure, send real communications, process payments, submit fiscal receipts, mutate billing, publish catalogs, or connect live integrations without explicit authorization.
- Preserve unrelated user work and never weaken tests, scoring, acceptance criteria, or severity to obtain a higher number.

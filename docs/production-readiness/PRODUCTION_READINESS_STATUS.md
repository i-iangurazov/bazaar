# Bazaar production-readiness status

## Checkpoint 1 — Evidence reconciliation

Official overall readiness: 47.8% → **49.0%**  
Raw evidence-derived readiness: **51.4%** (capped at 49% by open Critical `BZR-PRD-001`)  
Application-owned readiness: 48.5% → **52.2%**  
Execution coverage: 186/230 (80.9%) → **188/230 (81.7%)**  
Verified pass rate: 54/230 (23.5%) → **58/230 (25.2%)**  
Critical-workflow coverage: 21/67 (31.3%) → **23/67 (34.3%)** verified; 49/67
(73.1%) → **51/67 (76.1%)** executed

Requirement states:

- PASS: 58
- PARTIAL: 114
- FAIL: 16
- BLOCKED: 42

Defects remaining:

- Blocker: 0
- Critical: 1
- High: 2
- Medium: 18
- Low: 3

Resolved in this checkpoint:

- `PUBLIC-014` — locale-aware RU/KG/EN plural regression and localization integrity check pass.
- `AUTH-A11Y-001` — rendered modal title/description association and no-warning regressions pass.

Evidence and boundaries:

- The validated 11-row evidence manifest is
  `docs/production-readiness/manifests/statistics-checkpoint-update-2026-08-31.json`.
- The full result reconciliation and all 172 remaining non-PASS rows are in
  `docs/production-readiness/evidence/statistics-checkpoint-2026-08-31.md`.
- The public Playwright artifact is a historical pass, not final-source evidence: its route
  inventory, locale messages, and relevant source changed afterward.
- The authenticated matrix is explicitly interrupted. Its retained artifact does not contain a
  passed-case ledger, so it receives no complete-matrix or individual-case PASS credit.
- No Critical or High defect was closed. The exact weighted-cost requirement passes, but
  `BZR-PRD-001` remains open until UI/report/export breadth and the complete acceptance map reconcile.
- No application or test source changed and no validation matrix was run during this checkpoint.

External ceiling:

- Four externally BLOCKED requirements remain in the denominator and remove exactly 1.6094
  percentage points. Assuming every non-external row passes and every defect closes, the theoretical
  official maximum is 98.3906%; application-owned theoretical maximum is 100.0%.

## Checkpoint 0 — Baseline initialization

Overall readiness: 47.8% → 47.8%  
Application-owned readiness: 48.5%  
Execution coverage: 186/230 = 80.9%  
Verified pass rate: 54/230 = 23.5%  
Critical workflow coverage: 21/67 = 31.3% verified; 49/67 = 73.1% executed

Defects remaining:

- Blocker: 0
- Critical: 1
- High: 2
- Medium: 18
- Low: 5

Resolved in this checkpoint:

- None. Baseline/governance work does not change audited outcomes.

Evidence:

- `pnpm install --frozen-lockfile` — PASS.
- `pnpm exec prettier --check .` — FAIL: 346 pre-existing style issues, including generated mobile artifacts and source/docs/tests. No unrelated mass reformat was performed.
- `pnpm exec next lint --quiet` — PASS.
- `pnpm typecheck` — PASS.
- `pnpm exec vitest run` — PASS for runnable unit lane: 177 files passed, 67 database suites skipped; 881 tests passed, 466 skipped.
- `pnpm i18n:check` — PASS.
- `pnpm build` with the inherited local environment — correctly stopped at preflight because `CRON_SECRET` was absent/too short.
- Controlled build with a non-secret ephemeral conforming `CRON_SECRET` — PASS; production bundle compiled and 114 static pages generated.
- Isolated PostgreSQL 16 cluster under `/private/tmp`, safety-allowlisted database `bazaar_hardening_ci` — all 96 migrations applied; `prisma migrate status` reports up to date.
- Isolated database integration run — 57 files passed, 10 failed; 448/466 tests passed, 18 failed in 301.51 seconds.
- Integration failure triage: 15 require a sanitized provider/Redis rerun before classification; two deterministic application defects are confirmed (Bishkek raw SQL timezone handling and effective-price SQL ordering); one global-search failure requires Unicode collation/normalization confirmation.
- Deterministic-lane remediation is now implemented: default setup neutralizes ambient Redis/provider state, blocks unmocked external fetches, and moves Redis/provider verification into separately gated database-free contract configurations. The 466-test database baseline still requires a clean rerun before its historical 18 failures can be reclassified.
- `pnpm audit --prod` — FAIL: 44 production dependency advisories: 2 critical, 19 high, 20 moderate, 3 low. Critical paths include `next-auth` and transitive `fast-xml-parser`; high findings include `next`, `xlsx`, `lodash`, and additional XML-parser advisories.
- Existing E2E attempt — BLOCKED: the checked-in test imports `@playwright/test`, but the dependency, project script, and full configuration are absent (`playwright` command not found).
- `pnpm readiness:calculate` — PASS and reproduces the official 47.8% baseline.
- `pnpm exec vitest run tests/unit/readiness-calculator.test.ts` — PASS, 2/2.

Regressions:

- None introduced. Application source behavior is unchanged at this checkpoint.

Blocked:

- External fiscal/KKM, live email, provider-integration, and billing verification require authorized sandboxes.
- Complete operational privacy copy requires a counsel-approved product/legal decision.
- Browser E2E is an application-owned infrastructure gap, not an external blocker.

Next:

- Milestone 1: reproduce and repair BZR-PRD-001 weighted-average inventory cost, beginning with initial stock plus receiving and the required 80.90 KGS master case.

## Baseline engineering-failure register

| Area                    | Baseline result                                                   | Classification / next evidence                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting              | 346 files fail repository-wide Prettier check                     | Pre-existing hygiene/config gap; avoid generated-file churn and establish a scoped ignore/cleanup policy later.                                                |
| Default local build     | Environment preflight rejects missing/short `CRON_SECRET`         | Local configuration gap; controlled conforming environment builds successfully.                                                                                |
| DB integration          | 18/466 historical baseline fail                                   | Deterministic no-provider defaults and separate Redis/provider contract configurations are implemented; rerun the allowlisted DB lane before reclassification. |
| Reports timezone        | Bishkek boundary assertion fails                                  | Confirmed application SQL defect; fix in Milestone 2.                                                                                                          |
| Effective-price sort    | SQL order disagrees with UTC JS enrichment                        | Confirmed application SQL defect; schedule after Milestone 1/2 constraints.                                                                                    |
| Global search           | Unicode/case ranking fixture missing under temporary DB collation | Verify database collation and make search portable; do not rely on workstation collation.                                                                      |
| Production dependencies | 44 advisories                                                     | Upgrade/replace with regression and migration review; `xlsx` advisories have no patched npm version in the audit output and may require replacement.           |
| Browser E2E             | Runner missing                                                    | Add pinned runner/config/fixtures and canonical route suite in Milestone 8.                                                                                    |

No readiness percentage changes until `readiness-current.json` contains new evidence for the affected stable requirement IDs and the calculator produces the new number.

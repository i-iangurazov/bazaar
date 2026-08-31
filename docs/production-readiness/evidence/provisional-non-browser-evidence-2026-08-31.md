# Provisional non-browser readiness evidence — 2026-08-31

Evidence cutoff: `2026-08-30T22:26:00.000Z` (UTC).

This is a provisional, non-browser evidence ledger for the draft readiness-update manifest. It
does not claim final production readiness. The final repaired database rerun, production build,
public and authenticated Playwright matrices, manual accessibility checks, and every external
provider/device workflow were still pending at this cutoff.

Secrets and ephemeral targets are deliberately absent. `<isolated-loopback-test-db>` and
`<isolated-loopback-redis>` denote safety-checked local test targets, not production services.

## Completed command ledger

| Lane                                                    | Exact safe command representation                                                                                                                                                                                                                                                                                                                                                                                            | Completed result                                                                                                                                                                                                                                                                      | Scoring use in the draft                                                                                                                                                                                  |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deterministic non-DB                                    | `pnpm exec vitest run`                                                                                                                                                                                                                                                                                                                                                                                                       | PASS — 197 files, 1,010 tests. This run predates the newest added tests, so its count is provisional rather than the final repository total. DB-gated and isolated contract lanes were separate.                                                                                      | Guide/content/source/modal regressions that existed in this run.                                                                                                                                          |
| Focused isolated PostgreSQL repair set                  | `NODE_ENV=test RUN_DB_TESTS=1 ALLOW_TEST_DB_RESET=1 EXPECTED_TEST_DB_NAME=bazaar_hardening_agent4_platform DATABASE_TEST_URL=<isolated-loopback-test-db> DATABASE_URL=<isolated-loopback-test-db> pnpm exec vitest run tests/integration/b0-agent-3-access-cache-p0.test.ts tests/integration/b0-agent-3-orders-p0.test.ts tests/integration/catalog-discounts.test.ts tests/integration/product-cost-initial-stock.test.ts` | PASS — 4 files, 18 tests.                                                                                                                                                                                                                                                             | Focused order, idempotency, store/organization isolation, discount snapshot, and weighted-cost outcomes only. It is not a substitute for the pending full DB rerun.                                       |
| Weighted-cost audit/master cases                        | `NODE_ENV=test RUN_DB_TESTS=1 ALLOW_TEST_DB_RESET=1 EXPECTED_TEST_DB_NAME=bazaar_hardening_agent4_platform DATABASE_TEST_URL=<isolated-loopback-test-db> DATABASE_URL=<isolated-loopback-test-db> pnpm exec vitest run tests/integration/product-cost-initial-stock.test.ts`                                                                                                                                                 | PASS — 1 file, 2 tests. The audit case persisted and exposed KGS 80.46 after `5 × 80.25 + 2 × 81.00`; the master case persisted and exposed KGS 80.90 after `5 × 80.20 + 10 × 81.25`. Product list, detail, pricing, store pricing, movement value, snapshot, and product CSV agreed. | Exact weighted-average mathematics can pass. Broader profit/report consumers and the critical defect stay non-PASS/open until their remaining acceptance evidence completes.                              |
| Public form/auth/legal/landing/catalog source contracts | `pnpm exec vitest run tests/unit/form-control-accessibility.test.tsx tests/unit/public-auth-accessibility.test.ts tests/unit/public-legal-routes.test.ts tests/unit/marketing-landing-localization.test.ts tests/unit/marketing-landing-source.test.ts tests/unit/landing-theme-source.test.ts tests/unit/public-catalog-accessibility.test.tsx`                                                                             | PASS — 7 files, 34 tests.                                                                                                                                                                                                                                                             | Programmatic public-form association and audited auth/error title/H1 source coverage, plus landing/catalog source contracts. Browser-dependent HTTP, viewport, and manual-contrast outcomes are excluded. |
| Localization catalog integrity                          | `pnpm i18n:check`                                                                                                                                                                                                                                                                                                                                                                                                            | PASS.                                                                                                                                                                                                                                                                                 | Corroborates locale-key parity and the dedicated pluralization regression; it does not prove every rendered localized workflow.                                                                           |
| TypeScript source validation                            | `pnpm exec tsc --noEmit`                                                                                                                                                                                                                                                                                                                                                                                                     | PASS.                                                                                                                                                                                                                                                                                 | Supporting source integrity only; no readiness row is scored from typecheck alone.                                                                                                                        |
| Isolated Redis contract                                 | `REDIS_URL=<isolated-loopback-redis> pnpm test:contract:redis`                                                                                                                                                                                                                                                                                                                                                               | PASS — `tests/contract/redis/redis-isolation.contract.test.ts`, 1 file / 1 test. Only the run-scoped `bazaar:test:<run-id>:` namespace was written and cleaned.                                                                                                                       | Supporting test-lane isolation only; no product Redis behavior row is inferred.                                                                                                                           |
| Synthetic provider-lane preflight                       | `pnpm test:contract:provider`                                                                                                                                                                                                                                                                                                                                                                                                | PASS — 1 file / 1 test. Loopback-only `openai` placeholder, sandbox acknowledgement, empty key, Redis disabled, and network guard remained active.                                                                                                                                    | Supporting provider-lane safety only; no actual external-provider behavior is claimed.                                                                                                                    |
| Test-runtime isolation source regression                | `pnpm exec vitest run tests/unit/test-runtime-isolation.test.ts`                                                                                                                                                                                                                                                                                                                                                             | PASS — 1 file / 7 tests.                                                                                                                                                                                                                                                              | Supporting lane-safety evidence only.                                                                                                                                                                     |
| Production dependency audit                             | `pnpm audit --prod --audit-level low`                                                                                                                                                                                                                                                                                                                                                                                        | PASS — 434 dependencies, 0 known vulnerabilities at every severity.                                                                                                                                                                                                                   | Supporting release evidence only; the tracker has no requirement whose complete wording is solely this audit.                                                                                             |
| Full dependency audit                                   | `pnpm audit --audit-level low`                                                                                                                                                                                                                                                                                                                                                                                               | PASS — 1,042 dependencies, 0 known vulnerabilities at every severity.                                                                                                                                                                                                                 | Supporting release evidence only.                                                                                                                                                                         |
| Migration status                                        | `DATABASE_URL='postgresql://inventory@127.0.0.1:55432/bazaar_hardening_agent4_platform?schema=public' pnpm exec prisma migrate status`                                                                                                                                                                                                                                                                                       | PASS — 99 migrations found; schema reported up to date with 0 pending migrations.                                                                                                                                                                                                     | Supporting release evidence only; it does not replace the pending full DB suite.                                                                                                                          |
| Native configuration                                    | `pnpm mobile:validate`                                                                                                                                                                                                                                                                                                                                                                                                       | PASS — app ID `kg.bazaar.app`, production origin `https://www.bazaar.kg`, 11 plugins.                                                                                                                                                                                                 | Supporting native configuration only; association resources and physical-device verification remain excluded.                                                                                             |
| Native unit/config contracts                            | `pnpm mobile:test`                                                                                                                                                                                                                                                                                                                                                                                                           | PASS — 12 files / 56 tests plus configuration validation.                                                                                                                                                                                                                             | Supporting native code/config only; no App Store, Play Store, association, or device claim is made.                                                                                                       |
| Authenticated-lane source contract                      | `pnpm exec vitest run tests/unit/authenticated-playwright-lane-source.test.ts`                                                                                                                                                                                                                                                                                                                                               | PASS — 1 file / 13 tests.                                                                                                                                                                                                                                                             | Confirms the gated browser lane is structurally defined; it does not count as browser execution evidence.                                                                                                 |

The previously reported anonymous public runs of 7 files / 23 tests and 3 files / 15 tests are not
used as manifest command evidence because their exact argv was not retained. The named 7-file /
34-test run above supersedes those results and the intermediate named 3-file / 17-test result.

## Durable source and regression anchors

### Product cost

- `tests/integration/product-cost-initial-stock.test.ts`
- `tests/unit/product-cost-readiness.test.ts`
- `src/server/services/productCost.ts`
- `src/server/services/costReadModels.ts`

### Orders, idempotency, and isolation

- `tests/integration/b0-agent-3-orders-p0.test.ts`
- `tests/integration/b0-agent-3-access-cache-p0.test.ts`
- `tests/integration/catalog-discounts.test.ts`
- `src/server/services/salesOrders.ts`
- `src/server/services/purchaseOrders.ts`

### Guide and public content

- `tests/unit/developer-docs-public-url.test.ts`
- `tests/unit/help-route-catalog.test.ts`
- `tests/unit/help-contextual-routes.test.ts`
- `tests/unit/help-guide-search.test.ts`
- `tests/unit/help-consequential-guidance.test.ts`
- `tests/unit/help-pluralization.test.ts`
- `src/content/help/orders-customers.ts`
- `src/content/help/consequential-guidance.ts`

### Public accessibility and modal semantics

- `tests/unit/form-control-accessibility.test.tsx`
- `tests/unit/public-auth-accessibility.test.ts`
- `tests/unit/public-legal-routes.test.ts`
- `tests/unit/page-header-accessibility.test.tsx`
- `tests/unit/modal-description.test.tsx`

## Conservative scoring boundaries

- `BZR-REQ-0059` is narrowly the mathematical weighted-average outcome and is supported by two
  exact persisted cases. `BZR-PRD-001` remains open because its acceptance also requires broader
  report consumers and initial-stock plus multi-receipt coverage through the final repaired DB lane.
- Broad cost-consumer, cross-surface total, and export requirements advance only to `PARTIAL`.
- A completed isolated customer order with exactly one stock effect supports the narrow order
  creation/inventory-effect rows. Zero-line rejection and cancelled-order UI/API acceptance are not
  inferred; `ORDERS-001` and `ORDERS-002` remain open.
- Backend multi-store/multi-organization isolation advances the cross-organization row only to
  `PARTIAL`; the final authenticated direct-URL matrix remains required for `PASS`.
- Narrow public source defects may resolve while the broader all-application accessibility rows
  remain `PARTIAL` pending browser/manual coverage.
- Guide defect acceptance expressly permits concrete control/location detail instead of a capture
  for every step. The 15 consequential workflows contain 61 localized, role-checked steps.

## Explicitly excluded at this cutoff

- Final full repaired DB suite and report/export reconciliation.
- Production build and startup evidence.
- Public and authenticated Playwright results, including actual HTTP status/content-type/cache
  behavior, route matrices, viewports, console/page errors, dynamic IDs, KKM, and overflow.
- Manual contrast review, screen-reader session, and 200% zoom.
- Real email, billing, fiscal, marketplace/provider, catalog-publication, and device-association
  behavior.
- Product/accounting decision D-009 for positive unpriced adjustments.

## Draft-manifest validation

The draft was validated without writing to `readiness-current.json`:

`pnpm readiness:update -- --manifest docs/production-readiness/manifests/provisional-non-browser-update-2026-08-31.json --output /private/tmp/bazaar-provisional-readiness-non-browser-2026-08-31.json`

- PASS — 13 explicit requirement patches and 7 explicit defect patches.
- The updater validated both the source and generated snapshot through the immutable baseline and
  existing readiness calculator.
- Provisional calculated outcome: raw 51.7%, capped 49% because `BZR-PRD-001` remains an unresolved
  CRITICAL defect; app-owned readiness 52.5%; 61 PASS / 111 PARTIAL / 16 FAIL / 42 BLOCKED.
- Supporting route/workflow/role/responsive/localization metrics were deliberately unchanged because
  final browser and full-DB matrix reconciliation were not complete.

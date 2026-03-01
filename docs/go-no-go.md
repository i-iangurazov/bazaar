# Bazaar Pre-Live Go/No-Go Audit
Date: 2026-03-01 (for live run on 2026-03-02)

## Verdict
GO (for live run on 2026-03-02), with manual checklist execution required on live morning.

## Gate Results
- `pnpm lint`: PASS
- `pnpm typecheck`: PASS
- `pnpm i18n:check`: PASS
- `CI=1 GITHUB_ACTIONS=true pnpm test:ci` with `DATABASE_TEST_URL=.../inventory_test` and local Redis: PASS (`61/61` files, `233/233` tests, no integration skips)
- `pnpm build`: PASS
- Final full chain re-run after patches (`lint && typecheck && i18n:check && test:ci && build`): PASS

## P0 Blockers (Must Fix Before Live)
None at this time.

Resolved P0:
1. DB-backed integration coverage execution.
- Resolution: strict DB-backed suite was executed successfully against `inventory_test` with Redis up.
- Result: all integration and unit suites passed (`233` tests total).

## P1 Risks (Fix If Time)
1. FIXED: `/api/preflight` did not include migration readiness.
- Patch: `src/app/api/preflight/route.ts`
- Change: added explicit migrations check and readiness failure on pending/failed migrations.
- Test added: `tests/unit/preflight-route.test.ts`
- Manual verify:
1. Call `/api/preflight` as admin or with `x-health-secret`.
2. Confirm response contains `checks.migrations`.
3. Confirm status is `not_ready` when migrations are pending.

2. FIXED: price tags modal regression (selected items list not shown).
- Patch: `src/app/(app)/products/page.tsx`
- Change: print modal now renders full selected queue from `printQueue` (including off-page selections fetched via `products.byIds`).
- Manual verify:
1. Select items across multiple pages.
2. Open "Print price tags".
3. Confirm all selected items are listed in modal (name + SKU), not only current page items.

## P2 Notes (Later)
1. Build logs still show Redis connection warning in this sandbox (`AggregateError [EPERM]`), but build completes. Re-validate in production network with real `REDIS_URL`.
2. CI behavior can look green while DB integration tests are skipped when DB is unreachable. Keep strict DB gating in release/pre-live pipeline.

## Critical Path Audit Snapshot
- Auth/RBAC: code paths and router-level role guards are in place; no obvious tenant leak found in reviewed routes/services.
- Product catalog/barcodes: org-scoped barcode uniqueness is enforced (`@@unique([organizationId, value])`); find-by-barcode normalizes scanner input.
- Scanning: Enter submit path, leading-zero preservation, not-found handling, and stock count scan paths are present and covered by unit tests.
- Inventory operations: receive/adjust/transfer use transactions + row locks (`FOR UPDATE`) + idempotency keys + audit logs.
- Sales orders: line pricing/totals computed server-side; completion writes SALE movements with idempotency.
- Purchase orders: approve/receive transitions enforced; partial receive path updates stock + on-order atomically.
- Price tags PDF: barcode images are generated via `bwip-js`; layout tests cover overlap bounds; PDF route has quantity caps and barcode confirmation guard.
- Exports: async job + download route present; CSV generator includes UTF-8 BOM for Excel compatibility.
- Redis/realtime/jobs: production requires `REDIS_URL`; SSE and job locks include Redis paths with non-prod fallback.

## Live Test Checklist (2026-03-02)
1. System readiness
1. Open `/api/preflight` (admin or `x-health-secret`) and confirm `status=ready` with `checks.startup=db=redis=migrations=ok`.
2. Open `/api/health` and confirm `status=ok`, `db=up`, `redis=up`, `migrations=ok`.
3. Confirm no Redis warning banner/log indicating fallback mode in production.

2. Store setup
1. Confirm correct store is selected in UI.
2. Run scanner smoke test: scan known barcode, verify exact product opens/resolves.
3. Run printer smoke test: print a single price tag/PDF from selected item.

3. Workflow sequence (must pass in order)
1. Create 3 test products with unique barcodes.
2. Receive stock for all 3 products.
3. Make 3 sales by scanning items (including one quantity edit via clear+type).
4. Verify inventory decreased correctly for sold items.
5. Print one price tag and scan it back (exact match).
6. Export one report (balances or stock movements), download file, open in Excel, verify Cyrillic + columns.

4. Purchase orders (if used tomorrow)
1. Create PO.
2. Approve PO.
3. Receive partial quantity.
4. Receive remaining quantity.
5. Generate PO PDF and verify Cyrillic text is readable.

5. Emergency procedures
1. If fiscalization/printing fails: use PDF print fallback.
2. If scan fails: use search by SKU/name and continue sale.
3. If plan/limit error appears: open `/billing` and resolve plan gate.

## Production Env Preflight (Must Exist)
- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `JOBS_SECRET`
- `REDIS_URL`

Build/runtime fail-fast checks for production are active via runtime env assertions and prebuild env check script.

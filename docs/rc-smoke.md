# RC Smoke Checklist

Date: 2026-02-11

## Automated Smoke
- `pnpm lint` -> PASS
- `pnpm typecheck` -> PASS
- `pnpm i18n:check` -> PASS
- `CI=1 DATABASE_TEST_URL=... pnpm test:ci` -> PASS
- `pnpm build` -> PASS

## Manual Smoke (to execute before prod cutover)

### 1) Auth / Session
- Login as ADMIN, MANAGER, STAFF.
- Verify redirects and role-based page access are correct.
- Verify profile preference save (theme + locale) persists after reload.

### 2) Tenant Isolation
- For two orgs, verify list/details APIs never leak cross-org data.
- Verify sales/purchase order IDs from org A are inaccessible from org B.

### 3) Realtime / Redis
- Open two sessions in same org; perform inventory change in one session.
- Verify second session receives SSE update.
- Check logs: no recurring `subscriber mode` Redis errors.

### 4) Orders
- Purchase Orders: create -> submit -> approve -> receive.
- Sales Orders: create -> add lines -> confirm -> ready -> complete.
- Verify completion creates one set of stock movements (idempotent re-click does not duplicate).

### 5) Imports
- Run one CSV/XLSX import with image URLs.
- Verify product rows import and images resolve without private-network fetch attempts.
- Verify rollback path archives/reverts without deleting stock movement ledger.

### 6) Exports / PDF
- Generate each critical export format and download file.
- Generate PO/price-tag PDF and verify Cyrillic rendering.

### 7) Plan / Billing
- Verify plan gates for users/stores/products/features by role and plan.
- Verify `/billing` summary values match DB counters.

### 8) UI Responsiveness
- Check Dashboard, Products, Inventory, PO, Sales Orders on ~375px width.
- Check action bars, selection tools, dialogs, and guidance overlays for overlap/overflow.

## Release Decision Rule
Release only if:
- all automated checks pass,
- manual sections 1-8 have no P0/P1 failures,
- no cross-org leak and no ledger integrity regression.


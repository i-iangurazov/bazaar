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

---

# Final 375px Smoke Pass

Date: 2026-02-13
Viewport target: 375px width (mobile-first critical path)
Result: `GO` (release-ready)

## Automated Gates (final run)
- `pnpm lint` -> PASS
- `pnpm typecheck` -> PASS
- `pnpm i18n:check` -> PASS
- `pnpm build` -> PASS

## 375px Scenario Checklist (concrete paths)

### 1) App shell + header + drawer
- Path: any app page (`/dashboard`, `/products`, `/pos/sell`)
- Checks:
  - mobile header actions remain single-row and tappable
  - drawer opens/closes cleanly, no overlay artifacts
  - super-plus action remains in drawer and keeps full-width CTA
- Status: PASS

### 2) Dashboard mobile composition
- Path: `/dashboard`
- Checks:
  - KPI cards stack from 1 column on 375px
  - section headers do not collide with badges/buttons
  - low-stock / pending PO rows do not overflow horizontally
- Status: PASS

### 3) Sales order create flow
- Path: `/sales/orders/new`
- Checks:
  - add-line search + qty input stack properly on 375px
  - line qty editor and remove action fit in row without overflow
  - primary/secondary action buttons become full-width and readable
- Status: PASS

### 4) POS sell flow (draft behavior + mobile usability)
- Path: `/pos/sell`
- Checks:
  - draft is not auto-opened unexpectedly on page entry
  - explicit draft decision is shown: continue or discard
  - item rows, qty input, totals, payment rows render without clipping
  - payment actions are usable on narrow width
- Status: PASS

### 5) Import settings responsiveness + token consistency
- Path: `/settings/import`
- Checks:
  - mapping and validation panels remain readable on 375px
  - action groups wrap cleanly (no broken overlaps)
  - semantic colors are token-based (no hardcoded blue/indigo/amber/emerald blocks)
- Status: PASS

### 6) Guidance / modal behavior
- Path: any screen with tips modal
- Checks:
  - modal appears centered on mobile viewport
  - header/body spacing and close action are consistent with design system
  - no half-hidden panel at top
- Status: PASS

## Release-Ready Verdict
- P0 blockers: none
- P1 blockers: none
- Decision: `GO`

## Residual Risk (non-blocking)
- Do one final physical-device tap test (iOS Safari + Android Chrome) for keyboard overlap on input-heavy screens (`/pos/sell`, `/sales/orders/new`, `/settings/import`).

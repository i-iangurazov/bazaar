# Final Improvement Summary

## Font, Switch, And Integration Polish - 2026-05-05

### Changed

- Switched the global app font stack to `Jost`, with `Inter` and system UI as fallbacks.
- Tuned the shared Switch component so the off state remains visibly switch-like and the on state is less aggressive.
- Kept the public catalog and integration page UI aligned with the sharp/no-radius direction.
- Fixed public catalog image presentation so product cards are square and transparent PNG padding is only applied when transparency actually exists.
- Expanded Bazaar API product payloads for external integrations while keeping private accounting/cost fields out of the public API response.

### Validation

- `git diff --check` passed.
- `pnpm i18n:check` passed.
- `pnpm prisma migrate status` passed: 55 migrations found and the database schema is up to date.
- `pnpm prisma migrate dev` passed: already in sync, no pending migration.
- `pnpm prisma generate` passed.
- `CI=1 pnpm test` passed with local PostgreSQL enabled: 96 files passed, 438 tests passed.
- `pnpm build` passed, including Prisma generation, environment preflight, Next build, static generation, and route trace collection.
- `pnpm prisma studio` started successfully on `http://localhost:5555`; `curl -I` returned `HTTP/1.1 200 OK`, and Studio was stopped after verification.

## Integrations And Bazaar Catalog QA - 2026-05-05

### Changed

- Checked the integration surfaces for Bazaar Catalog, Bazaar API, Bakai Store, M-Market, and Product Image Studio.
- Removed page-level rounded styling from `/operations/integrations`, individual integration pages, Bazaar Catalog settings, and the public catalog shell/cart/product UI so those routes follow the sharp UI direction instead of bypassing shared radius tokens.
- Changed public catalog product media to render as square `1:1` images.
- Fixed catalog image processing so only images with actual transparent pixels receive padded framing; opaque JPEG/WebP/PNG product photos are square-cropped without added whitespace.
- Changed catalog image transformation from `4:3` to square output so the public catalog image pipeline matches the card ratio.
- Expanded `GET /api/bazaar/v1/products` payloads with safe product details needed by integrations: categories, description, unit/base unit, supplier, barcodes, packs, bundle flag, timestamps, image objects, variants, variant attribute values, stock by variant, currency code, and currency rate.
- Verified `POST /api/bazaar/v1/orders` still creates API orders from the same product identifiers exposed by `GET /api/bazaar/v1/products`.

### Tests Added Or Updated

- Added `tests/integration/bazaar-api.test.ts` for rich Bazaar API product payloads and API order creation.
- Updated catalog image transform tests for square output, transparent-only framing, and opaque photo square output.
- Focused integration test set passed for Bazaar API, Bazaar Catalog, Bakai Store, M-Market, Product Image Studio, and related payload/unit tests.

### Validation

- `git diff --check` passed.
- `pnpm typecheck` passed.
- `pnpm lint` passed with no warnings/errors.
- `pnpm i18n:check` passed.
- Focused integration/catalog tests passed: 8 files passed, 45 tests passed.
- `CI=1 pnpm test` passed with local PostgreSQL enabled: 96 files passed, 438 tests passed.
- `rm -rf .next` passed.
- `pnpm build` passed, including Prisma generation, environment preflight, Next build, static generation, and route trace collection.

### Remaining Risks

- I did not run a browser screenshot pass for the public catalog; validation is code/test/build based.
- The expanded Bazaar API product payload intentionally omits private cost/accounting fields.

## Real Retail Workflow QA Bug-Fix Pass - 2026-05-05

### QA Coverage

- Product creation and product readiness were covered through the product integration suite and the full tRPC contract smoke flow.
- Stock receiving, adjustments, transfers, movement history, low/negative inventory paths, stock counts, and inventory recomputation were covered through inventory, stock-count, purchase-order, and tRPC contract tests.
- Barcode/label printing was covered through label print-flow, price-tag route, price-tag PDF/layout, and print source tests, including saved-profile quick print behavior and selected-currency label output.
- POS sale, payment, receipt, stock decrement, returns/refunds, cash drawer movement, shift open/close, and transaction currency snapshots were covered through the POS integration suite.
- Receipt/PDF/export behavior was covered through receipt print payload/PDF tests, receipt PDF route tests, purchase-order PDF route tests, and export integration tests.
- Reports, dashboard-adjacent analytics, all-store/base-currency behavior, and role navigation filtering were covered through reports, analytics, middleware, role-access, AppShell navigation, and command palette tests.
- Browser-console testing was not run in a live browser in this slice; the production build completed cleanly and source/tests covered the validated flows.

### Bug Found And Fixed

- Shift close accepted a non-zero cash difference without a closing note.
- Added a server-side guard in `closeRegisterShift` so API/tRPC callers cannot close a shift with a surplus/shortage unless `notes` is supplied.
- Added UI validation on `/pos/shifts` so the close button stays disabled for a non-zero difference until a note is entered, and the user sees a localized explanation.
- Added `posShiftDifferenceNoteRequired` error translations and shift-close helper text in `en`, `ru`, and `kg`.
- Updated POS integration coverage so a close attempt with a cash shortage fails without a note and succeeds once the note is supplied.
- Added a source-level POS shift UI regression test for the note-required guard.

### Files Touched In This Slice

- `src/server/services/pos.ts`
- `src/app/(app)/pos/shifts/page.tsx`
- `messages/en.json`
- `messages/ru.json`
- `messages/kg.json`
- `tests/integration/pos.test.ts`
- `tests/unit/pos-entry-source.test.ts`
- `docs/final-improvement-summary.md`

### Validation

- `git diff --check` passed.
- `pnpm typecheck` passed.
- `pnpm lint` passed with no warnings/errors.
- `pnpm i18n:check` passed.
- Focused workflow tests passed with local PostgreSQL enabled: products, inventory, label printing, price-tag route, exports, reports, sales orders, purchase orders, AppShell navigation, role access, and command palette navigation.
- `CI=1 pnpm test` passed with local PostgreSQL enabled: 95 files passed, 435 tests passed.
- `rm -rf .next` passed.
- `pnpm build` passed, including Prisma generation, environment preflight, Next build, static generation, and route trace collection.
- `pnpm prisma migrate status` passed: 55 migrations found and the database schema is up to date.
- `pnpm prisma generate` passed.

### Remaining Risks

- This was not a browser-driven end-to-end QA run; it used integration/unit/source tests plus production build validation.
- No new workflow behavior was added beyond the required note enforcement for shift close discrepancies.

## Historical Currency Snapshots - 2026-05-05

### Changed

- Added nullable transaction currency snapshots to sales/orders, POS shifts, payments, cash drawer movements, returns, fiscal receipts, refund requests, and purchase orders.
- Added a non-destructive schema migration plus a separate backfill migration that copies current store currency/rate into existing rows where possible.
- Added `currencySourceWithFallback` and `resolveCurrencySnapshot` to centralize "snapshot first, store fallback second" behavior.
- POS shift open, sale draft/complete, payment writes, sale returns, refund requests, cash movements, manual/API/catalog customer orders, fiscal receipt queueing, and purchase orders now persist transaction currency context.
- POS sell/history/shifts, receipt registry, receipt print payload/PDF, sales order list/detail, purchase order list/detail/PDF, and receipt/shift/cash exports now display historical rows with saved snapshots instead of the current store currency.
- Export rows for receipt registries, shift reports, and cash drawer movements now include `currencyCode` and `currencyRateKgsPerUnit` alongside KGS-backed amounts.
- Review pass tightened receipt payload fallback so legacy rows can use a fiscal receipt snapshot before falling back to current store currency.
- Added `docs/currency-snapshot-plan.md` and updated `docs/currency-deep-audit.md`.

### Files Touched In This Slice

- Schema/migrations: `prisma/schema.prisma`, `prisma/migrations/20260504194525_currency_snapshots`, `prisma/migrations/20260504194600_currency_snapshot_backfill`.
- Helpers/services: `src/lib/currencyDisplay.ts`, `src/server/services/pos.ts`, `src/server/services/salesOrders.ts`, `src/server/services/purchaseOrders.ts`, `src/server/services/bazaarApi.ts`, `src/server/services/bazaarCatalog.ts`, `src/server/services/kkmConnector.ts`, `src/server/services/receiptPrintPayload.ts`, `src/server/services/exports.ts`.
- UI/API display: POS pages, sales order pages, purchase order pages, purchase-order PDF route, and receipt registry.
- Tests/docs: POS/catalog integration tests, currency/receipt unit tests, currency docs, and this summary.

### Tests Added

- Currency helper test proving saved snapshots beat current store currency and old rows fall back safely.
- POS integration test proving sale, payment, shift, and cash movement snapshots survive a later store currency change.
- Receipt print payload test proving receipt/PDF data uses the sale snapshot instead of current store currency.
- Receipt print payload test proving fiscal receipt snapshot fallback beats current store currency for legacy rows.
- POS refund integration assertions proving sale return and manual refund request snapshots are persisted.
- Purchase-order PDF route assertion proving totals format through the purchase-order snapshot source.
- Public catalog checkout integration expectation for persisted order currency snapshots.
- Source-level purchase-order UI expectation updated for snapshot-aware order detail currency.

### Remaining Risks

- Snapshot fields preserve display currency/rate only; this is not a full multi-currency accounting ledger.
- All-store mixed-currency aggregates remain base KGS unless a future reporting pass groups by currency or adds conversion rules.
- Legacy/imported rows that bypass the backfill and keep null snapshots still fall back to related store currency, which can be imperfect after later currency changes.
- `PurchaseOrderLine.unitCost` remains store-denominated by convention; purchase orders now snapshot currency, but the line field name still does not encode currency.

### Validation

- `git diff --check` passed.
- `pnpm typecheck` passed.
- `pnpm lint` passed with no warnings/errors.
- `pnpm i18n:check` passed.
- `CI=1 pnpm test` passed: 95 files passed, 434 tests passed.
- `rm -rf .next` passed.
- `pnpm build` passed, including Prisma generation, environment preflight, Next build, static generation, and route trace collection.
- `pnpm prisma migrate status` passed: database schema is up to date.
- `pnpm prisma migrate dev` passed: already in sync, no pending migration.
- `pnpm prisma generate` passed.

## Conservative Role Navigation Pass - 2026-05-05

### Changed

- Reverted the role-navigation direction back to the existing app shell mental model: same groups, item order, labels, sidebar CTA placement, command palette grouping, and dashboard layout.
- Added `src/lib/roleAccess.ts` as a central permission helper for role-aware UI filtering and middleware route denial.
- Added permission metadata to the existing AppShell nav items without moving or renaming them.
- Filtered command palette actions and global search results by the same role permissions as navigation.
- Filtered Dashboard quick actions and needs-attention links when a role cannot access the target area, without changing the dashboard composition.
- Added middleware role denial for sensitive/private routes after authentication.
- Updated `docs/role-navigation-audit.md` and `docs/permission-matrix.md` to describe this as a conservative filtering pass, not a redesign.

### Preserved

- Previous navigation groups: Core, Operations, Insights, Admin, Help.
- Previous item order and labels.
- Previous sidebar layout and large command-palette CTA visual style.
- Previous platform/admin/support placement, with filtering and route denial layered on top.
- Existing command palette categories and ordering.

### Tests Added

- Role permission matrix and route-access helper tests.
- Middleware denied/allowed route tests for cashier, manager, admin, and platform-owner cases.
- Source-level regression tests for AppShell group/order/CTA preservation.
- Source-level regression tests for command palette action order and permission filtering.

### Remaining Risks

- This slice aligns navigation, dashboard links, command palette links, and middleware. It does not redesign every tRPC/API procedure permission.
- Platform owners with non-admin org roles can access `/platform` directly if `isPlatformOwner` is set, but the sidebar item remains in its previous admin/platform-owner placement to avoid changing the nav IA.
- Cash/shift links remain where the current UI already places them, mostly under POS.

### Validation

- `git diff --check` passed.
- `pnpm typecheck` passed after Prisma generation.
- `pnpm lint` passed with no warnings/errors.
- `pnpm i18n:check` passed.
- `CI=1 pnpm test` passed: 95 files passed; 428 tests passed.
- `rm -rf .next` passed.
- `pnpm build` passed, including Prisma generation, environment preflight, Next build, type/lint checks, static generation, and route trace collection.

## Currency Deep Pass - 2026-05-05

### Changed

- Added `src/lib/currencyDisplay.ts` to centralize store-currency resolution, KGS-storage display conversion, selected-currency-to-KGS input conversion, store-denominated formatting, and explicit base-accounting formatting.
- Added `docs/currency-deep-audit.md` with the source of truth, audited surfaces, intentional KGS uses, multi-store rules, and remaining risks.
- Updated POS sell/open-shift/shifts/history flows so selected register/store currency is used for cashier display, payment autofill, counted cash, cash movements, and receipt totals while mutations still persist KGS-backed values.
- Updated POS receipt PDFs and receipt registry exports to format totals and payment breakdowns with the receipt store currency.
- Updated sales/orders, purchase orders, purchase-order PDF, analytics reports, dashboard-linked charts, product quick-search snippets, platform/admin metrics, and integration price displays to use selected store currency or explicit base accounting currency.
- Updated README and the older currency/localization audit to document `en`, `ru`, and `kg` support plus the current store-currency display model.
- Fixed receipt print payload fallback safety so older/mocked payloads without store currency fields fall back cleanly instead of throwing.
- Added explicit all-store report notices for base KGS mixed-store totals.
- Clarified purchase-order unit-cost copy so it follows the selected/order store currency, not supplier currency.
- Passed store currency context through additional store-scoped product-search snippets.

### Files Touched In This Slice

- Currency helpers: `src/lib/currencyDisplay.ts`, `src/lib/posPaymentDrafts.ts`.
- POS/cash/receipts: `src/app/(app)/pos/page.tsx`, `src/app/(app)/pos/sell/page.tsx`, `src/app/(app)/pos/history/page.tsx`, `src/app/(app)/pos/shifts/page.tsx`, `src/server/services/pos.ts`, `src/server/services/receiptPrintPayload.ts`, `src/server/services/posReceiptPdf.ts`, `src/server/printing/types.ts`, `src/components/pos/receipt-registry.tsx`.
- Sales/orders/reports/purchase orders: `src/server/services/salesOrders.ts`, `src/app/(app)/sales/orders/*`, `src/app/(app)/reports/analytics/page.tsx`, `src/components/analytics-charts.tsx`, `src/app/(app)/purchase-orders/*`, `src/app/api/purchase-orders/[id]/pdf/route.ts`.
- Products/labels/admin/integrations/docs/tests: `src/components/product-search-result-item.tsx`, `src/server/services/priceTagsPdf.ts`, `src/app/(app)/platform/page.tsx`, `src/app/(app)/admin/metrics/page.tsx`, integration pages, README, currency docs, and currency/POS receipt tests.

### Verified

- No app-facing usage of `formatCurrencyKGS` remains under `src/app`, `src/components`, `src/server`, or `tests`.
- Hardcoded `KGS` now remains only in explicit defaults, KGS-backed storage semantics, billing/integration rules, settings UI, migrations, tests, and docs that intentionally describe base accounting or billing.
- POS payment and cash inputs display selected-currency amounts but convert back to KGS before sending mutations.
- Receipt/PDF currency tests cover a non-KGS store and verify the output does not emit `KGS`.
- Product quick-search, reports, orders, and purchase-order surfaces receive store currency context where a single store is known.
- Multi-store/admin/platform views use explicit base accounting currency rather than guessing a store currency.
- All-store analytics and sales-order metrics visibly explain that mixed-store totals are shown in base accounting currency.
- Purchase-order forms visibly state the unit-cost currency source.

### Validation

- `git diff --check` passed.
- `pnpm typecheck` passed after Prisma generation.
- `pnpm lint` passed with no warnings/errors.
- `pnpm i18n:check` passed.
- `CI=1 pnpm test` passed: 92 files passed; 408 tests passed.
- `rm -rf .next && pnpm build` passed, including Prisma generation, environment preflight, Next build, type/lint checks, static generation, and route trace collection.

### Remaining Risks

- Historical sales and receipts still read the current store currency/rate. If a store changes currency later, historical display can change until currency snapshots are added to persisted sale/receipt records.
- Purchase-order `unitCost` is treated as store-denominated because the schema does not mark it as `*Kgs`; a future schema pass should make that explicit.
- All-store reports remain base KGS by design because mixed-currency aggregation needs a product decision.

## Restrained Color And Product UX Slice - 2026-05-04

### Changed

- Added `docs/ui-color-semantics.md` with strict rules for neutral surfaces, brand blue, critical red, warning orange, success green, and info blue.
- Changed shared `Badge` styling from solid color blocks to compact, subtle, bordered status treatments.
- Toned down Dashboard: removed decorative KPI icons, kept KPI cards neutral, muted zero-count attention badges, and reserved warning/danger color for non-zero attention counts.
- Toned down Products table: added one `Readiness` column and removed duplicate missing-price/missing-barcode badges from the product name, price, and barcode cells.
- Updated product readiness states to summarize as Ready, Missing price, Missing barcode, Missing stock, or Negative stock.
- Simplified the new Product form through a quick-create mode: photo, SKU, name, category, sale price, and barcode stay up front; cost, description, gallery/order, packs, and variants sit behind Advanced.
- Toned down Inventory warnings: summary cards are neutral, low stock is warning/subtle, and only negative stock remains critical.
- Replaced POS history solid status pills with subtle semantic status badges.
- Added a regression expectation to `tests/unit/ui-sharp-primitives.test.tsx` so badges stay square and subtle.

### Files Touched In This Slice

- Docs: `docs/ui-color-semantics.md`, `docs/final-improvement-summary.md`, `docs/ui-rounded-cleanup-audit.md`.
- Shared UI: `src/components/ui/badge.tsx`.
- High-traffic UI: `src/app/(app)/dashboard/page.tsx`, `src/app/(app)/products/page.tsx`, `src/app/(app)/products/new/page.tsx`, `src/app/(app)/inventory/page.tsx`, `src/app/(app)/pos/history/page.tsx`, `src/components/product-form.tsx`.
- Localization: `messages/en.json`, `messages/ru.json`, `messages/kg.json`.
- Tests: `tests/unit/ui-sharp-primitives.test.tsx`.

### Verified

- Dashboard is mostly neutral: no colorful KPI icon row, no green success decoration, and only Start sale remains the main primary dashboard CTA.
- Product rows no longer show "Missing price" or "Missing barcode" multiple times; readiness is the single status summary.
- Missing price remains visible through the readiness badge while the price cell stays calm.
- Inventory low stock uses warning treatment; negative stock remains critical without also showing low stock for the same row.
- New Product uses a faster quick-create layout while preserving advanced product fields behind the Advanced section.
- New strings exist in `en`, `ru`, and `kg`.
- No currency behavior or barcode/route/seed/support logic was intentionally changed in this slice.

### Validation

- `git diff --check` passed.
- `pnpm typecheck` passed.
- `pnpm lint` passed with no warnings/errors.
- `pnpm i18n:check` passed.
- `CI=1 pnpm test` passed: 90 files passed; 399 tests passed.
- `rm -rf .next` passed.
- `pnpm build` passed, including Prisma generation, environment preflight, Next build, type/lint checks, static generation, and route trace collection.

### Remaining Risks

- Some lower-traffic pages still use bright warning/success panels where the state may be legitimate but should be visually reviewed later: imports, billing, integrations, and onboarding.
- The new product quick-create flow is code-validated but still needs visual/browser review to fine-tune field density and sticky save placement.
- Existing email templates still have rounded visual styling outside the app shell; this was not part of the merchant-admin UI slice.

## Merchant UX Workflow Slice - 2026-05-04

### Changed

- Fixed the product label workflow so Product list, selected-products bulk print, row print, and Product detail primary print all use the saved store print profile immediately instead of opening the full settings modal.
- Fixed Inventory selected-label printing so it uses the same saved-profile quick print path and no longer opens print settings during normal printing.
- Added a first-time print setup prompt when no saved store print profile exists, plus a dedicated `/settings/printing` entry that points users to per-store hardware/label setup.
- Kept print settings explicit: Products and Product detail now expose "Print settings" / "Change print settings" as secondary actions that route to store hardware settings.
- Isolated the legacy Products print modal behind a dev-only `window.__seedLegacyProductsPrintModalQueue` hook and removed normal user-facing references to it.
- Isolated the legacy Inventory print modal behind a dev-only guard with no user-facing opener.
- Removed the KGS-looking label preview fallback from Products; preview/PDF currency now uses the selected store currency or a neutral unavailable-state string.
- Redesigned Products hierarchy: one dominant "New product" action, secondary actions in a menu, compact readiness filters, clearer bulk action bar, leaner default columns, and visible missing barcode/missing price/negative stock signals.
- Added server-side product readiness filters for missing barcode, missing price, low stock, and negative stock.
- Redesigned Dashboard around business KPIs, needs-attention items, and merchant quick actions, with recent activity pushed lower.
- Redesigned POS entry around cashier flow: auto-select single register, redirect open shifts to sell screen, and make opening a shift the dominant closed-shift action.
- Redesigned Inventory action hierarchy: primary Receive stock, secondary stock actions grouped in a menu, compact stock summary, and stronger low/negative stock highlighting.
- Updated `docs/barcode-printing-redesign.md` and `docs/ui-rounded-cleanup-audit.md` to reflect the real workflow changes and remaining legacy print/radius risks.

### Files Touched

- Printing workflow: `src/lib/labelPrintFlow.ts`, `src/app/(app)/products/page.tsx`, `src/app/(app)/products/[id]/page.tsx`, `src/app/(app)/inventory/page.tsx`, `src/app/(app)/settings/printing/page.tsx`, `src/server/services/priceTagsPdf.ts`.
- Products/inventory readiness data: `src/server/trpc/routers/products.schemas.ts`, `src/server/services/products/read.ts`, `src/server/trpc/routers/inventory.ts`.
- Merchant pages: `src/app/(app)/dashboard/page.tsx`, `src/app/(app)/pos/page.tsx`, `src/app/(app)/inventory/page.tsx`.
- Navigation/locales/docs: `src/components/app-shell.tsx`, `messages/en.json`, `messages/ru.json`, `messages/kg.json`, `docs/barcode-printing-redesign.md`, `docs/ui-rounded-cleanup-audit.md`, `docs/final-improvement-summary.md`.
- Tests: `tests/unit/label-print-flow.test.ts`, `tests/unit/print-flow-source.test.ts`, `tests/unit/price-tags-pdf.test.ts`.

### Verified

- Selecting products and clicking the main bulk `Print labels` path no longer opens print settings when a saved profile exists; it calls the PDF quick-print path with saved defaults.
- Product detail primary `Print labels` uses saved defaults and no longer shows the full settings modal.
- Inventory selected-label `Print selected` uses saved defaults and no longer shows the full settings modal.
- Missing saved profile opens a setup prompt, not the full print settings form.
- Explicit settings/change-settings actions route to store hardware settings or `/settings/printing`.
- Saved default copies are respected by shared label print flow tests.
- Source-level regression tests verify normal Products and Inventory print controls do not call the legacy modal openers.
- Non-KGS label currency formatting is covered by a PDF unit test and does not emit `KGS`.
- New UI strings exist in `en`, `ru`, and `kg`.

### Validation

- `git diff --check` passed.
- `pnpm typecheck` passed.
- `pnpm lint` passed with no warnings/errors.
- `pnpm i18n:check` passed.
- `CI=1 pnpm test` passed with local PostgreSQL enabled: 90 files passed; 399 tests passed.
- `rm -rf .next && pnpm build` passed after Prisma generation, environment preflight, Next build, type/lint checks, static generation, and route trace collection.

### Remaining Risks

- The legacy product print modal still exists for a dev-only seed/fallback path; normal Product list/detail and Inventory print no longer opens it, but the code should eventually be retired or moved fully into settings.
- The legacy inventory print modal is still present behind a dev-only guard for short-term rollback safety, but no user-facing action opens it.
- Stores that already had an older `StorePrinterSettings` row receive migrated label defaults and count as having a saved profile. This is safe for quick printing, but it may not force a setup prompt for stores that previously configured only receipt printing.
- Inventory summary problem counts are currently based on loaded rows for some cards; exact global counts should move server-side if the page needs strict totals.
- Dashboard "today" metrics use server-day boundaries rather than explicit store timezone rules.
- Some remaining rounded classes exist in legacy/lower-traffic UI, especially legacy print modals and public surfaces; the high-traffic workflow cleanup reduced visible clutter but did not attempt a blind global class removal.

## UI Cleanup Slice - 2026-05-04

### Changed

- Added `docs/ui-rounded-cleanup-audit.md` with the rounded-class classification requested for shared components, high-traffic app pages, intentional exceptions, and remaining public-site work.
- Made shared UI primitives explicitly sharp with `rounded-none`: Button, Input, Select, Textarea, Dialog/Modal, Dropdown, Tooltip, Card, Badge, Switch, Toast, ActionMenu, and TableContainer.
- Added sharp shared primitives for future cleanup work: `src/components/ui/popover.tsx` and `src/components/ui/tabs.tsx`.
- Standardized modal footers through `ModalFooter` in saved table views, product variant/image modals, billing/platform modals, POS open-shift/return modals, sales order line modal, and import rollback modal.
- Cleaned visible radius from high-traffic private surfaces: Dashboard, Products list/detail, Inventory/counts, POS entry/history/shifts, Sales order detail, Settings attributes/import/users, and Reports analytics chart panels.
- Kept intentional `rounded-full` only for progress bars and range sliders in the touched high-traffic surfaces.
- Added `tests/unit/ui-sharp-primitives.test.tsx` to lock square corners and modal footer layout for shared primitives.
- Fixed an existing Vitest JSX-runtime fragility in `Card` and `Modal` by adding runtime `React` imports.

### Files Touched

- Docs: `docs/ui-rounded-cleanup-audit.md`, `docs/final-improvement-summary.md`.
- Shared UI/components: `src/components/ui/*` touched in this slice, `src/components/app-shell.tsx`, `src/components/form-layout.tsx`, guidance controls, command palette, import previews, product form/search, selection toolbar, page skeleton/loading, and analytics charts.
- High-traffic pages: dashboard, products, inventory/counts, POS, sales order detail, settings attributes/import/users, billing, and platform modal consistency.
- Tests: `tests/unit/ui-sharp-primitives.test.tsx`.

### Verified

- No barcode printing, route protection, seed guard, or support bundle logic was changed in this slice.
- New UI text was not introduced, so existing `en`, `ru`, and `kg` locale coverage remains unchanged and `i18n:check` passed.
- No currency formatting logic was changed and no new currency hardcoding was introduced.
- High-traffic private app scan now only shows visible radius in public catalog/landing components outside this slice, plus intentional progress/range exceptions.

### Validation

- `git diff --check` passed.
- `pnpm typecheck` passed.
- `pnpm lint` passed with no warnings/errors.
- `pnpm i18n:check` passed.
- `CI=1 pnpm test` passed with local PostgreSQL enabled: 88 files passed; 387 tests passed.
- `pnpm build` initially failed after compilation with stale `.next` page metadata for `/api/health` and `/api/bakai-store/jobs/[id]/workbook`; after clearing `.next`, `pnpm build` passed.

### Remaining Risks

- Public catalog and landing components still contain visible rounded classes and need a separate storefront/public-site visual pass.
- Some lower-traffic private areas outside this slice, especially integrations, stores compliance/support, and purchase-order/supplier checkboxes, still contain page-specific rounded utilities.
- `rounded-sm`, `rounded-md`, and `rounded-lg` still appear in older page code, but the configured tokens resolve those classes to `0px`; future work should keep replacing visible or confusing usages with explicit `rounded-none`.

## Changed

- Added a Shopify-inspired UI investigation and project improvement/audit docs.
- Expanded middleware authentication coverage for private app routes.
- Added production guard for demo/local seed users and clarified README credentials as local-only.
- Introduced sharp UI radius tokens and updated shared UI components toward the no-rounded direction.
- Standardized tips/help icon buttons as fixed square controls with accessible labels.
- Added a store-level default barcode/price-label print profile.
- Changed product list/product detail label printing to use saved print defaults for fast printing.
- Kept a secondary "Change print settings" path for adjusting the profile.
- Updated price-tag PDF generation to use selected store currency and saved display defaults.
- Redacted sensitive support bundle audit data and narrowed exported store fields.

## Files Touched

- Docs: `docs/full-product-improvement-plan.md`, `docs/shopify-ui-investigation.md`, `docs/ui-system-audit.md`, `docs/barcode-printing-redesign.md`, `docs/route-protection-audit.md`, `docs/permission-matrix.md`, `docs/currency-localization-audit.md`, `docs/final-improvement-summary.md`.
- Security/auth: `middleware.ts`, `prisma/seed.ts`, `README.md`.
- Design system: `tailwind.config.ts`, `src/app/globals.css`, shared UI components under `src/components/ui`, `src/components/guidance`, `src/components/app-shell.tsx`, `src/components/form-layout.tsx`.
- Printing: `prisma/schema.prisma`, `prisma/migrations/20260504161000_store_printer_label_profile/migration.sql`, `src/server/services/storePrinterSettings.ts`, `src/server/trpc/routers/stores.ts`, `src/app/(app)/stores/[id]/hardware/page.tsx`, `src/app/(app)/products/page.tsx`, `src/app/(app)/products/[id]/page.tsx`, `src/app/api/price-tags/pdf/route.ts`, `src/server/services/priceTagsPdf.ts`.
- Localization: `messages/en.json`, `messages/ru.json`, `messages/kg.json`.
- Tests: `tests/unit/middleware.test.ts`, `tests/unit/admin-access.test.ts`, `tests/unit/currency.test.ts`, `tests/unit/guidance-buttons.test.tsx`, `tests/unit/price-tags-route.test.ts`, `tests/integration/stores.test.ts`, `tests/integration/support.test.ts`, `tests/integration/billing.test.ts`.

## Security Fixes

- Middleware now treats `/admin`, `/billing`, `/cash`, `/customers`, `/dev`, `/finance`, `/operations`, `/orders`, `/platform`, `/pos`, `/sales`, and other app routes as private.
- Unauthenticated private routes redirect to `/login?next=...`.
- The protected-prefix list was checked against the actual `src/app` private route tree, including dashboard, POS, cash, finance, inventory, purchase orders, products, stores, suppliers, reports, orders, sales, onboarding, settings, operations, admin, billing, platform, and private help pages.
- Public auth/catalog routes remain public: `/`, `/login`, `/signup`, `/invite`, `/verify`, `/reset`, `/register-business`, `/c/[slug]`, static assets, and public API routes.
- Platform/admin/support procedure guards are covered by unit/integration tests.
- Support bundle exports redact password/token/secret/API-key-like fields recursively.
- Support bundle debugging fields remain available: audit id, actor, action, entity, entity id, request id, timestamps, and non-sensitive store profile fields.
- Production seed now refuses to create/reset local demo users when `NODE_ENV=production` or `VERCEL_ENV=production`.

## UX Fixes

- Shared controls now resolve border radius through zero-radius tokens for sharper UI.
- Buttons, cards, badges, modals, switches, toasts, and shell controls were moved toward a consistent sharp system.
- Icon buttons include fixed dimensions and `shrink-0`, preventing squeezed tips/help controls.
- Modal action rows use a consistent bordered footer pattern through `FormActions` and `ModalFooter`.

## Barcode Printing Flow

- Print profile is configured once under store hardware settings.
- Profile supports template, paper/printer mode, barcode type, copies, label dimensions, margins, roll calibration, and show/hide product name, price, SKU, and store name.
- Product list and product detail quick print now use saved defaults without opening the full settings modal.
- "Change print settings" remains available as a secondary action.
- Price-tag PDFs now apply store currency and store display preferences.
- Roll label prints update calibration and `labelLastPrintedAt`.
- The migration is additive only: all new non-null fields have defaults, `labelLastPrintedAt` is nullable, and existing stores work through service-level defaults when no profile exists.

## Self-Review Fixes

- Fixed fast product-list printing so omitted copy count uses the saved profile default instead of always forcing `1`.
- Fixed product-detail label quantity initialization so saved default copies are respected when available.
- Removed the KGS-looking print preview string from product label UI and formatted the preview with the selected store currency.
- Changed outdated onboarding/README wording that implied KGS-only display behavior.
- Aligned support bundle redaction output with tests while preserving non-sensitive debugging context.
- Replaced remaining rounded print-modal classes touched in this slice with the shared radius token.

## Verified Items

- Reviewed the full git diff for accidental broad behavior changes; the implemented slice stays scoped to docs, route protection, seed safety, shared UI radius/tips, print profile defaults, currency-aware price tags, support redaction, and tests.
- Checked middleware against the current route tree under `src/app`; no discovered private app route is missing from protected prefixes.
- Manually inspected changed shared UI components: Button, Card, Modal/Dialog, Badge, Switch, Toast, Tooltip, tips/help buttons, AppShell shell controls, and FormActions. Input/Select still use shared radius classes that now resolve to zero-radius tokens.
- Classified remaining `rounded-*` classes: shared component radius now resolves through tokens; important touched print UI was fixed; many page-specific legacy classes remain for a later visual cleanup; progress bars and imagery are acceptable exceptions until the broader design pass.
- Verified new print/profile UI strings exist in `messages/en.json`, `messages/ru.json`, and `messages/kg.json`.
- Verified barcode/price-tag PDF generation uses selected store currency and touched print files no longer rely on old KGS-only display formatting.

## Shopify-Inspired Principles Applied

- Clearer action hierarchy: fast primary actions stay fast, setup moves to settings.
- Reduced ad hoc visual shape by centralizing radius.
- Index/list workflows now separate primary print from configuration.
- Technical/admin routes remain hidden by role and enforced by server procedures.
- Help/tips controls behave like stable utility controls instead of layout-affecting pills.

## Tests Added

- Middleware private/public route coverage.
- Server-side admin/platform guard coverage.
- Currency normalization/conversion/formatting coverage.
- Guidance icon button sizing/accessibility coverage.
- Price-tag route coverage for store currency and saved print timestamp/profile persistence.
- Store hardware integration coverage for saving/reading the label profile.
- Support bundle integration coverage for sensitive audit redaction.
- Billing integration expectation aligned with the plan catalog's STARTER product limit.

## Commands

- `git diff --check` passed.
- `pnpm typecheck` passed.
- `pnpm lint` passed with no warnings/errors.
- `pnpm i18n:check` passed.
- `CI=1 pnpm test` passed with local PostgreSQL enabled: 90 files passed; 399 tests passed.
- `pnpm build` passed, including Prisma generation, environment preflight, Next.js type/lint checks, static generation, and route trace collection.
- `rm -rf .next` was run before the final production build.
- `pnpm prisma migrate status` passed: 53 migrations found and the database schema is up to date.
- `pnpm prisma migrate dev` passed after the local migration generated by Prisma was renamed from `20260504175914_new` to `20260504175914_align_prisma_constraints`: no schema changes or pending migrations remained, and Prisma Client generated successfully.
- `pnpm prisma generate` passed.
- `pnpm prisma studio` started successfully on `http://localhost:5555`; `curl -I http://localhost:5555` returned `HTTP/1.1 200 OK`, and Studio was stopped after verification.

## Database Migration Note

- `prisma/migrations/20260504175914_align_prisma_constraints/migration.sql` was generated by Prisma from the current schema and applied locally.
- The migration aligns existing constraint/index names and relation actions with the Prisma schema, and removes stale database-level defaults from several `updatedAt` columns that Prisma manages in application writes.
- It does not drop application tables or data, and the full test/build validation passed after applying it.

## Remaining Risks

- Currency display across POS, reports, purchase orders, sales orders, and admin/platform metrics was handled in the 2026-05-05 currency deep pass above.
- The no-rounded direction was applied to shared components and high-traffic private app surfaces, but public storefront/landing and lower-traffic private pages still need follow-up cleanup.
- POS/dashboard/onboarding/report redesign was audited and planned, but this pass prioritized route security, shared UI direction, and the barcode printing workflow.

## PWA Installation Slice

### Changed

- Added `public/manifest.webmanifest` with standalone display metadata, launcher icons, maskable icons, and shortcuts for Dashboard, POS, Products, and Inventory.
- Generated PWA icon assets from the original Bazaar icon on a plain white square background; `public/brand/icon.png` was not modified.
- Added Next.js metadata for manifest discovery, apple web app mode, apple touch icon, app title, and theme color.
- Added a conservative service worker and static offline fallback that avoid caching API/auth/private responses.
- Added a small localized `Install app` header action beside tips and the language switcher.
- Added iOS Add to Home Screen guidance and unsupported/in-app browser guidance.
- Added PWA install detection utilities for `beforeinstallprompt`, standalone mode, iOS, in-app browsers, and secure install context.
- Added README and `docs/pwa-installation-plan.md` installation guidance.

### Safety Notes

- The service worker only precaches static shell-safe files and uses network-first navigation fallback.
- API routes, auth routes, login/signup/reset/invite/verify pages, and `/_next/data` are explicitly excluded from SW caching.
- Offline mode does not pretend POS, inventory, orders, or authenticated mutations work without a network connection.
- Final launcher icon polish still needs design approval; current generated assets use the original Bazaar mark on white.

### Tests Added

- Manifest required fields, icon sizes, maskable icons, and shortcuts.
- Service worker source checks for private/API cache exclusions and network-first offline fallback.
- Install hook prompt capture and `prompt()` call.
- Standalone detection hides the install button.
- iOS and unsupported browser paths open the correct guidance modals.
- Header source check keeps the install action beside tips and language switcher.

### Validation

- `git diff --check` passed.
- `pnpm typecheck` passed.
- `pnpm lint` passed with no warnings/errors.
- `pnpm i18n:check` passed.
- Targeted PWA tests passed: `pnpm exec vitest run tests/unit/pwa-install.test.tsx tests/unit/pwa-manifest.test.ts tests/unit/pwa-service-worker-source.test.ts`.
- `CI=1 pnpm test` passed: 99 files, 448 tests.
- `rm -rf .next` completed before the production build.
- `pnpm build` passed, including Prisma generation, environment preflight, Next.js compile, type/lint checks, static generation, and route trace collection.
- Manual device QA is still required for real browser install behavior: Chrome desktop prompt, Android Chrome prompt, iOS Safari Add to Home Screen instructions, installed standalone launch, icon/splash appearance, login, dashboard/POS/products loading, and API/auth cache behavior in production HTTPS.

### Pre-Push Review Findings

- Manifest was validated from the built production server and through Chrome DevTools Protocol `Page.getAppManifest`; Chrome returned no manifest errors.
- Manifest fields are present: `name`, `short_name`, `description`, `start_url: /dashboard`, `scope: /`, `display: standalone`, portrait orientation, theme/background colors, 192/512 icons, maskable icons, and shortcuts.
- Icon assets were verified on disk:
  - `public/icons/icon-192.png` is 192x192.
  - `public/icons/icon-512.png` is 512x512.
  - `public/icons/maskable-192.png` is 192x192.
  - `public/icons/maskable-512.png` is 512x512.
  - `public/apple-touch-icon.png` is 180x180.
- PWA icons use the original Bazaar icon on a plain white square background. The original `public/brand/icon.png` was not changed.
- iOS Safari metadata is present in the built HTML: `apple-mobile-web-app-capable`, `apple-mobile-web-app-title`, `apple-mobile-web-app-status-bar-style`, and `apple-touch-icon`.
- The production server served `/manifest.webmanifest`, `/sw.js`, and `/offline.html` with `HTTP/1.1 200 OK`.
- `public/sw.js` parses with `node --check`.
- Headless Chrome confirmed the service worker registered and became active with script URL `http://127.0.0.1:3000/sw.js`.
- Browser cache inspection after registration showed only static shell-safe entries: offline page, brand/logo icons, generated PWA icons, apple touch icon, and manifest.
- No API, auth, login, dashboard, or private page response was present in the service worker cache.
- Unauthenticated `/dashboard` on the production server still returned `307 Temporary Redirect` to `/login`.
- `/login` served normally with PWA metadata present, so logout/login pages are not blocked by the service worker cache.
- Offline fallback page contains English, Russian, and Kyrgyz offline copy and does not include private data.
- Install button behavior remains covered by tests: standalone mode hides it; Chromium prompt calls `prompt()`; iOS opens instructions; unsupported/in-app browser opens guidance.
- Safari now has a separate calm install-in-Safari guidance path instead of being treated as unsupported. The warning-style unsupported copy is reserved for in-app or genuinely unsupported browsers.
- Service worker registration is production-only in `PwaServiceWorkerRegister`, with localhost allowed as a secure install context for local production smoke tests.
- `pnpm start` launched the built app and served requests successfully. Next.js still prints its existing warning that `next start` is not the preferred command with `output: "standalone"`; this was not changed in the PWA slice.

### Pre-Push Review Validation

- `node --check public/sw.js` passed.
- Manifest file and referenced icon paths validated with a local script.
- `git diff --check` passed.
- `pnpm typecheck` passed.
- `pnpm lint` passed with no warnings/errors.
- `pnpm i18n:check` passed.
- `CI=1 pnpm test` passed: 99 files, 448 tests.
- `rm -rf .next` completed before the clean production build.
- `pnpm build` passed.
- `pnpm start` production smoke test passed on `127.0.0.1:3000`; server was stopped after review.

## AI Category Arrangement Fix

### Changed

- Fixed `Упорядочить категории с ИИ` so products without an existing category are no longer excluded before analysis.
- Expanded category arrangement evidence from only name/category/description to include SKU, variants, variant SKUs, variant attributes such as size, product images, and existing categories.
- Added local classification for common apparel/footwear signals and adult size ranges so many products are handled without an OpenAI call.
- Added ordinary category inference for uncategorized products, for example `Платья`, `Обувь`, `Футболки`, `Брюки`, and similar categories.
- Ordinary inferred categories are now restricted to the organization's existing category list. AI/local inference can reuse `Платья`, `Обувь`, or another existing category, but it will not create a new ordinary product category when no existing match is available.
- Existing category matching is language-tolerant for common apparel groups, so an AI/local suggestion such as `Платья` can reuse an existing `Dresses` category instead of creating a duplicate.
- Updated the saved category structure so categoryless apparel can become `Мужчины` or `Женщины` as primary category with a matching existing product category preserved underneath when available.
- Added image-aware AI fallback for products that remain ambiguous after local rules.
- Reduced slow AI behavior by adding a category-specific model fallback, shortening the timeout, using smaller AI batches when image inputs are present, and running fallback AI batches in parallel.
- Updated the confirmation copy in EN/RU/KG to clarify that names, variants, sizes, descriptions, categories, and images are used.

### Tests Added

- Categoryless dress with variant size is arranged locally as `Женщины` / existing `Dresses`.
- Categoryless shoes with adult men size are arranged locally as `Мужчины` / existing `Shoes`.
- Categoryless item does not create a new ordinary category when the inferred category is not already available.
- Categoryless image-based product uses AI fallback and maps Russian category output to an existing English ordinary category.

### Validation

- `pnpm typecheck` passed.
- `pnpm lint` passed with no warnings/errors.
- `pnpm i18n:check` passed.
- `git diff --check` passed.
- `CI=1 pnpm test` passed before the existing-category allow-list refinement: 99 files, 451 tests.
- After the allow-list and language-tolerant matching refinement, sandboxed `CI=1 pnpm test` could not reach local PostgreSQL through Prisma and therefore skipped DB tests: 67 files passed, 32 skipped, 303 tests passed, 149 skipped.
- Product integration regression was rerun with direct local PostgreSQL access: `DATABASE_TEST_URL='postgresql://inventory:inventory@127.0.0.1:5432/inventory_test?schema=public' CI=1 pnpm test tests/integration/products.test.ts` passed: 1 file, 23 tests.
- `pnpm build` passed.

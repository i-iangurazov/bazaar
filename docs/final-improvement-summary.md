# Final Improvement Summary

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

- Many existing POS, reports, purchase-order, sales-order, and admin-metrics screens still use `formatCurrencyKGS`; they need a deeper store/org currency context pass.
- The no-rounded direction was applied to shared components and high-traffic private app surfaces, but public storefront/landing and lower-traffic private pages still need follow-up cleanup.
- POS/dashboard/onboarding/report redesign was audited and planned, but this pass prioritized route security, shared UI direction, and the barcode printing workflow.

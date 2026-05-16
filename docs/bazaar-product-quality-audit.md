# Bazaar Product Quality Audit

## Executive Summary

Bazaar has solid production foundations in several sensitive areas: the backend uses typed tRPC procedures, many mutations call role-gated procedures, store access is commonly enforced through `assertUserCanAccessStore`, PWA basics exist, product image upload has timeout/retry handling, and the new stock receiving flow is built as a dedicated document-style page rather than a one-product modal.

The main product risk is not one isolated broken page. It is inconsistent mobile architecture and inconsistent store-scoped behavior surfacing in the UI. The desktop application is mostly an admin-style SaaS shell, while the mobile app still often feels like a compressed desktop web app. Some screens use responsive cards, but the mobile shell, task flow, sticky actions, and bottom navigation expected from a mobile POS/PWA are not yet present.

This pass intentionally does not rewrite large flows. It fixes three safe issues found during the audit:

1. `/settings/profile` now makes the selected store explicit inside the product settings card, so SKU/barcode/similar-product toggles are clearly saved for the store the user is editing.
2. Shared mobile list pagination controls now use larger mobile tap targets.
3. Product search placeholder translations are complete for all supported locales, so the SKU-disabled product search UI has a valid localized label.

Larger issues are documented as backlog because they require product/design decisions or multi-route refactors.

## Critical Issues

| Page / Flow      | Problem                                                                                                                                                                  | Severity | Type        | Evidence                                                                                                                                                                        | Recommended action                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile app shell | Phone users still get a desktop-style drawer/header instead of a true mobile app shell with bottom navigation and safe-area behavior.                                    | Critical | Mobile / UX | `src/components/app-shell.tsx` uses a hamburger drawer for `lg:hidden`; no `MobileBottomNav` or mobile shell component exists. POS `/pos/sell` bypasses the app shell entirely. | Needs larger refactor. Build `MobileAppShell` with bottom nav: POS, Products, Inventory, Sales, More. Keep desktop shell unchanged.   |
| POS mobile       | Mobile POS is separated from desktop, but still behaves like one long form instead of a fast mobile sale flow with product selection, cart, payment, and receipt states. | Critical | Mobile / UX | `src/app/(app)/pos/sell/page.tsx` contains `MobileLegacyPosSaleView`, but it renders a long vertical page.                                                                      | Needs larger refactor. Keep shared POS controller; convert mobile view to task flow with sticky cart summary and cart/payment screen. |
| Printing setup   | Printing settings expose technical provider/QZ concepts and can imply readiness even when a connector is not implemented.                                                | Critical | UX / Logic  | `src/app/(app)/settings/printing/page.tsx`; `src/server/printing/adapter.ts` throws `printerConnectorNotImplemented` for kiosk silent print.                                    | Needs larger refactor. Replace technical settings-first UI with setup wizard and truthful readiness states.                           |

## High Priority Issues

| Page / Flow                    | Problem                                                                                                                                                                                                                         | Severity | Type               | Evidence                                                                                         | Recommended action                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Store/profile product settings | Store-scoped product toggles were easy to misread because the product settings card did not expose a real store selector in the section itself. Users could disable barcodes for one store while viewing products from another. | High     | UX / Store scoping | `src/app/(app)/settings/profile/page.tsx`; products page has independent store filtering.        | Fixed in this pass.                                                  |
| Product create/edit            | The form is comprehensive but too large for mobile. It exposes photo, sales fields, stock, barcodes, variants, and advanced controls in one long screen.                                                                        | High     | Mobile / UX        | `src/components/product-form.tsx`; used by `/products/new` and `/products/[id]`.                 | Needs phased mobile form split into sections with sticky save.       |
| Products mobile list           | Product page has mobile cards, but filter/view/column controls remain desktop-admin oriented and visually heavy for a phone catalog.                                                                                            | High     | Mobile / UX        | `src/app/(app)/products/page.tsx` uses `ResponsiveDataList`, saved views, columns, bulk actions. | Needs mobile-specific filter sheet and card/list controls.           |
| Inventory mobile               | Inventory cards exist, but the page still exposes desktop table concepts, saved views, and dense controls on phone.                                                                                                             | High     | Mobile / UX        | `src/app/(app)/inventory/page.tsx`; `ResponsiveDataList` plus table controls.                    | Needs mobile inventory cards, quick filters, and task-first actions. |
| Receiving mobile               | Dedicated receiving exists and has mobile cards, but summary/action area is not a phone-style sticky bottom action.                                                                                                             | High     | Mobile / UX        | `src/app/(app)/inventory/receiving/page.tsx` uses `xl:sticky`; mobile summary is inline.         | Needs mobile sticky summary and card-first receiving flow.           |
| Customer destructive actions   | Customer delete uses `window.confirm`, which is inconsistent and weak for a SaaS production UI.                                                                                                                                 | High     | UI / Data safety   | `src/app/(app)/customers/page.tsx`.                                                              | Needs controlled confirmation dialog with clear destructive copy.    |

## Medium / Low Priority Issues

| Page / Flow                | Problem                                                                                                                                                                            | Severity | Type                 | Evidence                                                                                                                     | Recommended action                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Auth / registration        | Flow has rate limits, email verification, invited staff handling, and business registration, but needs end-to-end tests for edge cases like existing invited email becoming owner. | Medium   | QA / Logic           | `src/server/trpc/routers/publicAuth.ts`.                                                                                     | Add focused auth/onboarding integration tests.               |
| Subscription / trial       | Mutations are gated by active plan, while reads remain available. That may be intentional, but needs product confirmation and copy around read-only expired state.                 | Medium   | Logic / UX           | `src/server/trpc/trpc.ts` `ensureActivePlan`.                                                                                | Needs product decision and QA cases.                         |
| Reports / metrics          | Reports are likely desktop-oriented and chart/table heavy on mobile.                                                                                                               | Medium   | Mobile / Performance | `src/app/(app)/reports/page.tsx`, `src/app/(app)/dashboard/page.tsx`, admin metrics routes.                                  | Add mobile report summaries before detailed tables/charts.   |
| Settings                   | Settings pages are functionally separated but not grouped as a mobile settings hub.                                                                                                | Medium   | Mobile / UX          | `/settings/profile`, `/settings/printing`, `/settings/users`, `/settings/import`, `/settings/attributes`, `/settings/units`. | Needs mobile settings index/grouping.                        |
| Empty/error/loading states | Many pages have local empty states, but the tone and placement vary.                                                                                                               | Medium   | UI / UX              | `ResponsiveDataList`, product/inventory/sales/customers pages.                                                               | Define shared empty/error patterns and audit route-by-route. |
| PWA install                | Manifest and service worker exist, but installed app experience lacks mobile navigation, safe-area bottom controls, and offline task messaging beyond fallback page.               | Medium   | PWA                  | `public/manifest.webmanifest`, `public/sw.js`, `src/components/pwa-install-button.tsx`.                                      | Improve after mobile shell is introduced.                    |

## Page-by-Page Audit

### Auth / Registration

Findings:

- Public auth has rate limiting and explicit flows for signup, verification, reset, invitation, and business registration.
- Email verification is a soft-block in app shell rather than a hard route blocker, which is reasonable for SaaS onboarding but needs clear QA coverage.
- Invited staff and new owner/business creation are sensitive edge cases that should be covered by integration tests.

Fixes:

- None in this pass. No localized low-risk bug was confirmed from source inspection.

Backlog:

- Add integration tests for invited email already existing, invited user trying to create a business, email verification resend, and business registration token reuse.
- Add manual QA script for username/email login if username login remains supported.

### Onboarding / Business Creation

Findings:

- Routes exist for `/onboarding` and `/register-business/[token]`.
- Business creation and profile store settings share store/business concepts, so user copy must be precise about when a setting is personal and when it is store-scoped.

Fixes:

- None in this pass.

Backlog:

- Add mobile onboarding review after the mobile app shell exists.
- Add smoke test for creating a business after signup and landing on the correct store context.

### Store/Profile Settings

Findings:

- `/settings/profile` includes business currency/legal/profile fields and product behavior settings.
- Product behavior settings are store-scoped, but the section previously displayed the store as static text. That made it easy to save settings for Airport Store and then look at Products filtered to Downtown Store.
- The backend update is correctly admin/owner gated through `trpc.stores.updateProductSettings`.

Fixes:

- Added a real store selector inside the product settings section.
- Added helper copy that settings apply only to the selected store.
- Kept settings store-scoped and did not delete SKU/barcode data.

Backlog:

- Add a small “current products page store differs” warning if the app keeps independent store filters across pages.
- Add E2E test: disable barcode for Store A, keep barcode enabled for Store B, refresh, and verify product create/list/POS visibility per store.

### Users / Roles / Permissions

Findings:

- Role access is centralized in `src/lib/roleAccess.ts`.
- tRPC has role procedures such as `adminProcedure`, `managerProcedure`, and `cashierProcedure`.
- Store access checks appear throughout sensitive services and routers.

Fixes:

- None in this pass.

Backlog:

- Add permission matrix tests for cashier, staff, manager, admin, org owner, and platform owner across product, inventory, POS, settings, and billing routes.

### Products

Findings:

- Products list supports responsive cards through `ResponsiveDataList`, product settings, duplicate options, barcode visibility, store pricing, and saved views.
- Product search placeholder adapts when SKU is disabled.
- The page still carries desktop concepts on mobile: saved views, columns, table/grid mode, and multi-filter layout.

Fixes:

- Shared mobile pagination controls in `ResponsiveDataList` now use larger mobile tap targets.

Backlog:

- Build a mobile-specific products list with search, filter bottom sheet, product rows/cards, and compact overflow actions.
- Add E2E coverage for SKU/barcode toggles across product list, create, edit, inventory search, and POS search display.

### Product Create/Edit, Duplication, Variants, Images, SKU/Barcode

Findings:

- Product create/edit is handled by `src/components/product-form.tsx`.
- Product behavior settings are already wired into create/edit props and form visibility.
- Image upload has progress/error/retry handling and upload timeout helpers.
- Variant initial stock fields exist, and source tests check variant stock wiring.
- Product duplication supports copy images / no images and avoids blindly reusing SKU/barcode according to source-level checks.

Fixes:

- None in the form itself during this pass.

Backlog:

- Convert mobile product form to grouped sections: basic info, photos, price, stock, SKU/barcode, variants, advanced.
- Add integration tests around duplicate with photos, duplicate without photos, currency in non-KGS stores, and barcode clearing.
- Add manual QA for variant stock persistence and inventory/POS display.

### POS Desktop

Findings:

- Desktop POS is intentionally separate from mobile and should remain untouched.
- Current desktop page contains a broad product grid plus checkout panel model suitable for larger screens.

Fixes:

- None in this pass.

Backlog:

- Add screenshot regression coverage at `1440px` to protect the desktop POS layout before further mobile work.

### POS Mobile

Findings:

- Mobile POS now renders a separate `MobileLegacyPosSaleView` at `<768px`, so desktop is not merely squeezed into phone width.
- The mobile view includes product search, item cards, editable price, discount, payment rows, and completion action.
- It still lacks a real mobile sale flow with product selection, cart, payment, and sale-complete screens.

Fixes:

- None in this pass.

Backlog:

- Split mobile POS into product selection, cart/payment, and sale complete screens using the same shared sale logic.
- Add sticky cart summary and touch-first product search results.
- Add mobile QA for no horizontal overflow, state preservation on resize, receipt reprint, and duplicate mutation prevention.

### Customer Selection In POS

Findings:

- Customer logic is supported in POS, but phone UX should use a bottom sheet with search and large touch rows.

Fixes:

- None in this pass.

Backlog:

- Build mobile customer selector bottom sheet. Keep desktop selector unchanged.

### Sales / Receipts / PDF / Print

Findings:

- Sales/orders use responsive lists and mobile cards.
- Receipt/print code exists, with QZ Tray support and server printing adapter boundaries.
- Print readiness must be represented carefully because a kiosk connector path can be unimplemented.

Fixes:

- None in this pass.

Backlog:

- Add receipt print/reprint QA matrix for browser print, QZ trusted/untrusted, PDF download, and unsupported connector states.
- Improve mobile sale complete receipt actions.

### Inventory

Findings:

- Inventory page uses `ResponsiveDataList` and has mobile cards.
- The old one-product adjustment is no longer the main receiving workflow; dedicated receiving route exists.
- Inventory still carries desktop-heavy controls and saved views on phone.

Fixes:

- Shared mobile pagination tap target improvement applies here.

Backlog:

- Build mobile inventory cards with quick filters: low stock, out of stock, negative, store.
- Move secondary actions into mobile action sheet.

### Receiving / Оприходование

Findings:

- `/inventory/receiving` is a dedicated document-style receiving page.
- Backend receiving mutation validates store access and posts lines transactionally according to the inventory service structure.
- Mobile receiving line cards exist, but summary/action placement is not yet a sticky mobile task action.

Fixes:

- None in this pass.

Backlog:

- Add mobile sticky summary: product count, quantity, total, and “Провести”.
- Add E2E around transaction rollback when one line is invalid.

### Stock Adjustment / Transfers / Minimum Stock

Findings:

- Inventory mutations are role-gated and store-scoped in the router/service layer.
- Stock adjustment remains a secondary/admin workflow, which is appropriate if receiving is the primary inbound stock path.

Fixes:

- None in this pass.

Backlog:

- Add manual QA for cashier rejection, manager/admin rules, transfer rollback, and movement history.

### Customers / Client Base

Findings:

- Customer list uses responsive cards and server-side list behavior.
- Destructive delete uses `window.confirm`, which is inconsistent and not ideal for production mobile UX.

Fixes:

- None in this pass because replacing confirmation patterns across pages should be done consistently.

Backlog:

- Replace `window.confirm` with shared confirmation dialog.
- Add mobile customer profile and purchase-history pattern.

### Reports / Metrics

Findings:

- Reports and dashboards exist, but likely remain desktop-dashboard oriented.
- Mobile users need summaries and drill-downs instead of wide charts/tables.

Fixes:

- None in this pass.

Backlog:

- Create mobile report summary cards and lazy-load detailed charts.

### Subscription / Owner Platform

Findings:

- Plan enforcement is centralized for protected mutations.
- Platform owner procedures exist for organization/billing administration.
- Need explicit product decision on whether expired plans should keep read-only access.

Fixes:

- None in this pass.

Backlog:

- Add tests: active paid subscription overrides expired trial; expired trial blocks mutations but allows intended reads; owner platform can update plan state.

### Imports / Exports

Findings:

- Import/export routes and actions exist, but mobile ergonomics are lower priority than POS/products/inventory.
- Import flows are naturally desktop-heavy.

Fixes:

- None in this pass.

Backlog:

- Keep imports desktop-first; add clear mobile message if file import is not supported well on phone.

### Language / i18n

Findings:

- RU/EN/KG message files are used.
- Some new product/receiving strings exist across all three locales.

Fixes:

- Added product settings store hint in RU/EN/KG.

Backlog:

- Run copy audit for mixed Russian/English terms in technical settings and mobile POS.

### Mobile / PWA

Findings:

- Manifest is present with standalone display, icons, theme color, and shortcuts.
- Service worker has static caching and offline fallback behavior.
- The installed-app feeling is limited because the app still uses desktop navigation patterns on phone.

Fixes:

- Shared pagination tap targets improved for phone.

Backlog:

- Build `MobileAppShell`, `MobileBottomNav`, safe-area support, mobile top header, install guidance, and route-level skeletons.

### Empty / Error / Loading States

Findings:

- Many pages have local empty states and spinner handling.
- Error/toast style is inconsistent, especially across POS, uploads, and settings.

Fixes:

- None in this pass.

Backlog:

- Define shared empty/error/loading guidelines and replace route-specific ad hoc states incrementally.

## Fixes Implemented In This Pass

### 1. Store-scoped product settings are explicit on `/settings/profile`

Before:

- The product settings card displayed the store as static text.
- The settings were correctly store-scoped in data, but users could miss that they were editing a different store than the one selected on Products/POS/Inventory.

Root cause:

- The product settings form had `storeId` state but did not expose a selector in the product settings section itself.

Changed files:

- `src/app/(app)/settings/profile/page.tsx`
- `messages/ru.json`
- `messages/en.json`
- `messages/kg.json`
- `tests/unit/products-page-source.test.ts`

After:

- Product settings card has a real store selector.
- The selector calls the same store change handler as the business profile section.
- On load, the product settings card initializes from the same remembered Products store filter when one exists, so `/settings/profile` is less likely to edit Airport while `/products` is showing Downtown.
- Helper text explains the settings apply only to the selected store.
- Backend permission and persistence remain handled by `trpc.stores.updateProductSettings`.

### 2. Mobile pagination controls are easier to tap

Before:

- Shared mobile pagination buttons and page-size select used `h-8` sizing, which is small for phone use.

Root cause:

- Desktop-sized controls were reused inside the mobile card list footer.

Changed files:

- `src/components/responsive-data-list.tsx`
- `tests/unit/products-page-source.test.ts`

After:

- Mobile controls use `h-10` / `w-10`, with `sm:h-8` / `sm:w-8` preserving denser sizing on larger screens.

### 3. SKU-disabled product search placeholder has complete i18n keys

Before:

- `products.searchPlaceholderNameOnly` was referenced by the products page when SKU search display is disabled, but the key was missing from RU/EN/KG messages.

Root cause:

- A similar inventory translation key existed, but the products namespace did not have its own key.

Changed files:

- `messages/ru.json`
- `messages/en.json`
- `messages/kg.json`

After:

- `pnpm i18n:check` passes.
- Product search can use a localized name-only placeholder when SKU is hidden.

## Backlog / Larger Work

### Phase 1: Mobile App Shell

Severity: Critical  
Complexity: Large  
Action:

- Add `MobileAppShell`.
- Add bottom navigation: `Касса`, `Товары`, `Запасы`, `Продажи`, `Ещё`.
- Hide desktop sidebar/drawer on phone.
- Add safe-area support.
- Keep desktop `AppShell` visually unchanged.

### Phase 2: Mobile POS Task Flow

Severity: Critical  
Complexity: Large  
Action:

- Keep desktop POS untouched.
- Keep shared POS business logic.
- Convert phone POS into product selection, cart/payment, and success screens.
- Add sticky cart summary, mobile customer selector, and receipt actions.

### Phase 3: Mobile Products

Severity: High  
Complexity: Large  
Action:

- Mobile product list with cards and filter bottom sheet.
- Mobile product form with grouped sections and sticky save.
- Preserve SKU/barcode/settings behavior.

### Phase 4: Mobile Inventory / Receiving

Severity: High  
Complexity: Medium / Large  
Action:

- Mobile stock cards with quick filters.
- Mobile receiving with editable line cards and sticky summary.
- Keep transactional backend receiving unchanged.

### Phase 5: Printing Wizard

Severity: Critical  
Complexity: Medium / Large  
Action:

- Replace technical-first printing settings with setup wizard.
- Explicitly show QZ trusted/untrusted/certificate states.
- Do not imply unimplemented connector readiness.

### Phase 6: Permission and Store-Scoping QA

Severity: High  
Complexity: Medium  
Action:

- Add integration/E2E tests for cross-store blocking and role rejection across products, inventory, POS, settings, and customers.

## Manual QA Checklist

Auth / onboarding:

- Sign up new owner.
- Verify email resend works.
- Create business after signup.
- Accept staff invitation with a new email.
- Try invitation with already-used email.

Profile/settings:

- Open `/settings/profile`.
- Change selected store in product settings.
- Disable SKU, save, refresh, confirm disabled.
- Disable barcode, save, refresh, confirm disabled.
- Disable similar product check, save, refresh, confirm disabled.
- Switch to another store and confirm its settings are independent.
- Try updating product settings as non-admin and confirm backend rejection.

Products:

- Product list hides SKU/barcode according to selected store settings.
- Product create hides SKU/barcode according to selected store settings.
- Product edit preserves existing hidden SKU/barcode data.
- Create multiple new products and confirm SKU is fresh when enabled.
- Duplicate with photos and without photos.
- Duplicate in non-KGS store and verify currency.
- Create variants, edit variant stock, save, reopen.

POS desktop:

- Open POS at `1440px`.
- Confirm current desktop layout remains unchanged.
- Add product, edit cart, take payment, complete sale.
- Reprint/download receipt if supported.

POS mobile:

- Open POS at `390px`.
- Confirm mobile view, not desktop right panel.
- Search by name/SKU/barcode where settings allow.
- Add product, edit price/discount/quantity, remove product.
- Add/remove payment.
- Complete sale.
- Confirm no horizontal overflow.

Inventory:

- Open inventory at desktop and mobile widths.
- Confirm receiving is a dedicated page.
- Search products in receiving.
- Add multiple lines, edit quantity and unit cost.
- Post receiving and confirm stock increases.
- Try invalid line and confirm no partial update.
- Test transfer between stores.
- Test minimum stock update.

Customers:

- Search customers.
- Create/edit customer.
- Test delete confirmation behavior.

Printing:

- Open printing settings.
- Confirm QZ status is truthful.
- Test browser print/PDF.
- Test trusted/untrusted QZ behavior if available.
- Confirm unsupported connector state does not claim ready.

Subscription / owner:

- Expired trial blocks intended mutations.
- Active paid subscription overrides expired trial.
- Platform owner can manage organization subscription state.

Mobile/PWA:

- Install PWA on iOS/Android where possible.
- Confirm no desktop sidebar on phone after mobile shell work.
- Confirm safe-area spacing around bottom controls.
- Test offline fallback.

## Verification Results

- `pnpm exec prettier --write src/app/\(app\)/settings/profile/page.tsx src/components/responsive-data-list.tsx tests/unit/products-page-source.test.ts messages/ru.json messages/en.json messages/kg.json docs/bazaar-product-quality-audit.md` passed.
- `pnpm exec vitest run tests/unit/products-page-source.test.ts` passed: 9 tests.
- `git diff --check` passed.
- `pnpm typecheck` passed.
- `pnpm lint` passed.
- `pnpm i18n:check` initially found missing `products.searchPlaceholderNameOnly`; after adding RU/EN/KG keys, it passed.
- `pnpm test --run` passed: 81 files passed, 35 skipped; 374 tests passed, 195 skipped.
- `pnpm build` passed.

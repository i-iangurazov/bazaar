# Bazaar Mobile PWA Transformation Plan

## 1. Audit Findings

Bazaar already has responsive pieces, but it does not yet have a coherent mobile app architecture. The current app uses a desktop-first shell with a mobile hamburger drawer, plus per-page responsive adaptations. That is better than a broken mobile site, but it still feels like an admin panel compressed into a phone.

Desktop should remain protected. The desktop sidebar, dense tables, POS split layout, and current desktop product/inventory workflows should continue to render at `>= 768px` unless a specific desktop bug is found.

Mobile should be treated as a separate presentation layer over the same business logic: same tRPC mutations, same permissions, same store scoping, same validations, same sale/inventory/product services.

### Current Mobile Audit Table

| Screen / Flow                     | Current mobile state                                                                                 | Squeezed desktop?               | Biggest usability problems                                                                                                              | Required mobile pattern                                                                             | Complexity     | Priority |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------- | -------- |
| POS / Касса                       | `/pos/sell` already has `MobileLegacyPosSaleView` selected below `768px`; desktop view is split out. | Partly no, but still long-form. | Single long page, no sticky cart summary, cart/payment/product search are stacked, sale-complete state is not a full mobile task state. | Three-screen mobile sale flow: product selection, cart/payment, sale complete. Sticky cart summary. | Large          | Critical |
| Products / Товары                 | Uses `ResponsiveDataList`; mobile cards exist.                                                       | Partly.                         | Desktop controls leak into mobile: saved views, columns, bulk actions, table/grid toggles, dense filters.                               | Search-first product list, filter bottom sheet, product rows/cards, overflow actions.               | Medium / Large | High     |
| Product create/edit               | Shared `ProductForm` is comprehensive and mobile-scrollable.                                         | Yes.                            | Too long; image, stock, price, variants, SKU/barcode, bundles, duplicate checks all appear in one route-level form.                     | Sectioned mobile form with sticky save and progressive disclosure.                                  | Large          | High     |
| Inventory / Запасы                | Uses `ResponsiveDataList`; mobile stock cards exist.                                                 | Partly.                         | Dense table concepts remain: saved views, column controls, selection toolbar, print/settings actions.                                   | Stock cards, quick filters, action sheet for secondary actions.                                     | Medium / Large | High     |
| Оприходование                     | Dedicated `/inventory/receiving` page exists; mobile line cards exist.                               | Partly.                         | Summary/post action is inline, not task-sticky; document form/table mental model still dominates.                                       | Receiving flow with product search, editable line cards, sticky summary/post bar.                   | Medium         | High     |
| Sales / Продажи                   | Sales orders use responsive cards. Receipt routes are still desktop-report-like.                     | Partly.                         | Detail/receipt actions are not optimized for mobile sale review and reprint.                                                            | Searchable sale list, compact sale cards, receipt detail actions as sticky bottom actions.          | Medium         | Medium   |
| Customers / Клиентская база       | Uses `ResponsiveDataList`; customer cards exist.                                                     | Partly.                         | Customer actions are still form/modal oriented; delete confirmation patterns are not mobile-app-like.                                   | Search list, customer cards, call/edit/receipt actions, bottom sheet selector in POS.               | Medium         | Medium   |
| Settings / Настройки              | Settings are separate desktop pages under sidebar navigation.                                        | Yes.                            | No mobile settings hub; users must navigate desktop menu structure.                                                                     | Grouped settings index: store, products, printing, users, subscription, language, support.          | Medium         | High     |
| Printing settings                 | Technical QZ/provider settings are exposed directly.                                                 | Yes.                            | Too technical for store owners; readiness can be confusing; not wizard-like.                                                            | Setup wizard: provider, connect, select printer, test print, done.                                  | Medium / Large | High     |
| Store/profile settings            | `/settings/profile` has store product settings and store selector.                                   | Partly.                         | Business/profile/product settings live in a long settings page; mobile users need grouped sections.                                     | Mobile settings sections and store/product settings cards with sticky save.                         | Medium         | High     |
| Auth/onboarding/business creation | Auth pages are simpler than app pages and mostly card-based.                                         | Partly.                         | Onboarding/business forms are still web-form oriented, not app steps.                                                                   | Step-based onboarding with clear progress and mobile inputs.                                        | Medium         | Medium   |

## 2. Proposed Mobile Navigation

### Breakpoint

- Mobile app shell: `< 768px`
- Desktop shell: `>= 768px`

Use the same breakpoint as the existing POS split and Tailwind `md` boundary.

### Bottom Navigation

Primary bottom tabs:

1. `Касса` -> `/pos/sell` or `/pos`
2. `Товары` -> `/products`
3. `Запасы` -> `/inventory`
4. `Продажи` -> `/sales/orders`
5. `Ещё` -> mobile more hub

Rules:

- Bottom nav is visible only on mobile app routes.
- Use large tap targets, at least `44px`.
- Respect `env(safe-area-inset-bottom)`.
- Active state must be obvious.
- Badges can show open shift, low stock, or pending actions later, but initial shell should stay minimal.

### Top Mobile Header

Top header should replace the current hamburger-first pattern.

Recommended content:

- Current store name, truncated.
- Optional context status: open shift/register on POS, selected store on inventory/products.
- Page action icon when needed: search, scan, add, filter.
- Profile/user entry via `Ещё` or small avatar button.

Avoid:

- Desktop logo/sidebar.
- Dense global scan/search on every mobile page.
- Technical setup controls in the global header.

### More Tab

`Ещё` should contain:

- Customers
- Reports
- Settings
- Printing
- Users/roles
- Billing/subscription
- Help/support
- Language
- Logout

The More tab should reuse the same permission model as desktop navigation.

## 3. Page-by-Page Mobile Redesign Plan

### POS Mobile

Target structure:

1. Product selection
   - Search/scanner input at top.
   - Category chips horizontal.
   - Product rows/cards with image, name, price, stock.
   - Sticky cart summary: `3 товара · 1 280 KGS · Открыть чек`.

2. Cart / Чек
   - Full-screen route state or bottom sheet.
   - Item list with quantity stepper, editable price where current POS allows it, discount collapsed by default.
   - Customer selector as bottom sheet.
   - Payment method and amount.
   - Sticky primary action: `Завершить продажу`.

3. Sale complete
   - Receipt number.
   - Print status.
   - Actions: new sale, reprint, download/share receipt.

Do not duplicate sale logic. Extract or preserve the existing shared controller/actions and render only different mobile views.

### Products Mobile

Target list:

- Search at top.
- Filter chips for store/category/status.
- Filter bottom sheet for advanced filters.
- Product rows/cards:
  - image
  - name
  - price
  - stock
  - status/readiness
  - overflow menu: edit, duplicate, archive/delete if allowed

Target create/edit form:

Sections:

1. `Основное`
2. `Фото`
3. `Цена`
4. `Остатки`
5. `SKU/штрихкод`, only if enabled for selected store
6. `Варианты`
7. `Дополнительно`

Primary action:

- Sticky bottom `Сохранить`.

Images:

- Mobile uploader with multiple selection, per-image loading/error, retry.

Variants:

- Cards, not wide table rows.

### Inventory Mobile

Target inventory list:

- Search products.
- Quick filter chips: low stock, out of stock, negative stock.
- Stock cards:
  - image/product
  - current stock
  - minimum stock
  - store
  - quick action

Main actions:

- `Оприходование`
- `Перемещение`
- `Инвентаризация` / `Корректировка`, if supported

Secondary actions should move to a bottom action sheet.

### Receiving Mobile

Target flow:

- Document details collapsed after store/date are selected.
- Product search at top.
- Added products as editable cards.
- Quantity and unit cost are large touch inputs.
- Sticky summary:
  - `12 товаров`
  - `45 шт`
  - total value
  - `Провести`

Backend stays unchanged: one transactional post receiving mutation.

### Customers Mobile

Target:

- Search by name/phone/email.
- Customer cards.
- Quick actions: call, edit, view purchases.
- POS customer selector as bottom sheet.

### Sales Mobile

Target:

- Sale cards with number, date, customer, total, status.
- Search/filter sheet.
- Receipt actions as sticky bottom actions on detail.

### Settings Mobile

Target settings hub:

- Store profile
- Product settings
- Printing
- Users/roles
- Subscription
- Language
- Support

Store product settings:

- SKU toggle
- Barcode toggle
- Similar product check toggle
- Currency
- Receipt preferences

### Printing Mobile

Target wizard:

1. Choose provider
2. Connect service
3. Select printer
4. Test print
5. Done

Do not expose QZ certificate/signing fields as the first mobile experience. Keep diagnostics available under advanced settings.

### Auth / Onboarding Mobile

Target:

- Step-based business creation.
- Clear progress.
- Mobile-safe input spacing.
- No desktop navigation assumptions.

## 4. Component Architecture

### Shell

Add:

- `MobileAppShell`
- `MobileBottomNav`
- `MobileTopBar`
- `MobileMoreMenu`
- `useIsMobileAppShell`

Keep:

- Current desktop `AppShell` layout at `>= 768px`.
- Current route permissions.
- Current desktop navigation groups.

Recommended implementation:

- `AppShell` chooses desktop shell vs mobile shell after mount or via CSS-only layout where safe.
- Avoid mounting duplicate components that execute side effects.
- Do not mount desktop and mobile POS at the same time.

### Route Components

Use naming like:

- `DesktopPosSaleView`
- `MobilePosSaleView`
- `MobileProductList`
- `MobileProductForm`
- `MobileInventoryView`
- `MobileReceivingView`
- `MobileSettingsView`

### Shared Business Logic

Keep shared:

- tRPC hooks
- mutations
- validation schemas
- permissions
- store scoping
- POS sale state/actions
- product settings behavior
- inventory posting logic

Do not create:

- mobile-only sale mutation
- mobile-only inventory mutation
- mobile-only product validation

## 5. Implementation Phases

### Sprint 1: Mobile App Shell and POS Protection

Scope:

- Add mobile app shell with bottom nav.
- Keep desktop shell unchanged.
- Keep current POS desktop unchanged.
- Preserve existing mobile POS route split.
- Add source tests to protect desktop shell and verify mobile nav exists.

Acceptance:

- Desktop sidebar remains at `>= 768px`.
- Phone no longer shows desktop sidebar/drawer as primary navigation.
- Bottom nav exists on mobile app routes.
- POS route still renders mobile view below `768px`.

### Sprint 2: Mobile POS Product/Cart Flow

Scope:

- Convert mobile POS from long page to product selection + cart/payment + success flow.
- Add sticky cart summary.
- Add customer bottom sheet.
- Add sale complete screen.

Acceptance:

- Product search remains fast.
- Add/update/remove cart works.
- Payment and sale completion use current backend.
- No duplicate sale/print mutations.

### Sprint 3: Mobile Products

Scope:

- Mobile product list.
- Filter bottom sheet.
- Mobile product form sections.
- Mobile image uploader improvements.
- Variant cards.

Acceptance:

- SKU/barcode toggles still respected.
- Product creation/editing behavior unchanged on desktop.
- Duplicate product behavior unchanged except mobile presentation.

### Sprint 4: Mobile Inventory and Receiving

Scope:

- Mobile inventory cards.
- Mobile receiving sticky summary and editable line cards.
- Mobile transfer/count flows only after inventory cards are stable.

Acceptance:

- Transactional receiving remains backend-owned.
- Store scoping remains enforced.
- Desktop inventory table remains unchanged.

### Sprint 5: Mobile Settings, Printing Wizard, PWA Polish

Scope:

- Mobile settings hub.
- Printing setup wizard.
- Safe-area polish.
- Offline messaging.
- Install prompt placement.

Acceptance:

- Technical print diagnostics remain available but not primary.
- PWA installed mode feels app-like.
- No fake offline mutation success.

## 6. Risk List

| Risk                                                              | Impact   | Mitigation                                                                                                  |
| ----------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| Desktop regression                                                | High     | Keep desktop components unchanged; add source/screenshot checks before route rewrites.                      |
| Duplicate side effects from rendering desktop and mobile together | Critical | Do not mount both for POS or mutation-heavy screens. Use mounted media-query switch or route-level split.   |
| Store scoping drift between mobile and desktop                    | Critical | Keep shared hooks/services; never create mobile-only backend logic.                                         |
| POS sale state loss on resize                                     | Medium   | Decide expected behavior; keep controller state above view split where feasible.                            |
| Mobile shell conflicts with POS custom layout                     | Medium   | Let POS opt into full-screen task shell if needed, but keep bottom nav accessible outside active sale task. |
| Printing wizard hides needed diagnostics                          | Medium   | Keep advanced diagnostics link inside wizard.                                                               |
| Long lists become slow on mobile                                  | Medium   | Use pagination/virtualization for product/inventory lists.                                                  |
| Offline behavior misleading users                                 | High     | Show offline state; do not queue stock/sale mutations unless sync model exists.                             |

## 7. QA Checklist

### Shell

- Desktop at `1440px`: sidebar and current desktop layout unchanged.
- Mobile at `390px`: bottom nav visible, no desktop sidebar.
- Safe-area: bottom nav does not collide with iOS home indicator.
- Active tab state is correct for POS, Products, Inventory, Sales, More.
- Role permissions hide unavailable destinations.

### POS

- Desktop POS still uses current desktop view.
- Mobile POS uses mobile view.
- Search product by name/SKU/barcode where settings allow.
- Add product.
- Open cart.
- Edit quantity, price, discount.
- Add customer.
- Add payment.
- Complete sale.
- Reprint/download receipt.
- Resize desktop to mobile and back without duplicate sale mutation.

### Products

- Mobile list has no horizontal overflow.
- SKU/barcode hidden when disabled for selected store.
- Product create/edit preserves existing data when fields are hidden.
- Image upload works on mobile.
- Variant stock cards save correctly.

### Inventory / Receiving

- Mobile inventory cards show correct stock.
- Filters work.
- Receiving product search works.
- Add multiple lines.
- Edit quantity/unit cost.
- Sticky summary totals are correct.
- Post receiving updates stock transactionally.

### Settings / Printing

- Product settings save per store.
- Printing wizard can test print.
- QZ trusted/untrusted states are clear.
- Unsupported connector state is not shown as ready.

### PWA

- Manifest loads.
- Icons are valid.
- Standalone display works.
- Offline fallback appears for navigation.
- Slow network shows skeleton/loading states.

## 8. First Implementation Recommendation

Implement Sprint 1 first:

1. Add `MobileAppShell`.
2. Add `MobileBottomNav`.
3. Keep desktop `AppShell` untouched at `>= 768px`.
4. Wire mobile shell into `(app)/layout`.
5. Add safe-area bottom padding.
6. Add tests that assert mobile shell exists and POS desktop/mobile split is preserved.

Do not start mobile product form or inventory redesign until the shell contract is stable.

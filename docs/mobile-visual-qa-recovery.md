# Mobile Visual QA Recovery

This pass stopped new mobile feature work and treated UI work as visual QA. The app was opened locally through Chrome/CDP at phone widths, the 768px boundary, and desktop width. The highest-priority recovery work was done on Inventory and Inventory Receiving.

Local base URL: `http://localhost:3000`

Viewports tested:
- `390 x 1000`
- `430 x 1000`
- `768 x 1000`
- `1440 x 1000`

Final visual QA artifacts:
- Screenshots: `tmp/mobile-visual-qa-recovery/full/*.png`
- Metrics: `tmp/mobile-visual-qa-recovery/full/metrics.json`
- Final metrics result: all captured routes reported `horizontalOverflow: false`.

Notes:
- The CDP metric named `bottomNavPresent` is selector-based and can match desktop sidebar `nav` elements. It is not used as proof that the mobile bottom nav is visible on desktop; screenshots were inspected for that.
- The app has no separate customer detail route; customer detail remains a card/list interaction on `/customers`.
- `/inventory/counts/new` redirects to `/inventory/counts` in the checked seed session, so the list view is the verifiable state for that route.

## Mobile App Shell / Bottom Navigation

Route: `/dashboard`

Viewports tested: `390`, `430`, `768`, `1440`

Status: Fixed

Problems found:
- At `768px`, the app still rendered the compact tablet/mobile-style header instead of the desktop sidebar boundary expected by the product rule.

Fixes made:
- Removed the intermediate `md:flex lg:hidden` shell header/drawer path.
- Desktop sidebar now starts at `md` (`>=768px`); mobile shell remains below `768px`.

Desktop regression checked: yes

Screenshots:
- `tmp/mobile-visual-qa-recovery/full/mobile-home-390.png`
- `tmp/mobile-visual-qa-recovery/full/mobile-home-768.png`
- `tmp/mobile-visual-qa-recovery/full/mobile-home-1440.png`

Remaining issues:
- Top-bar icon buttons are visually large on phone, but tap targets are safe and no overlap/overflow was found.

## Mobile Home / Главная

Route: `/dashboard`

Viewports tested: `390`, `430`, `768`, `1440`

Status: Good

Problems found:
- No blocking visual defect in this pass.

Fixes made:
- None in this pass.

Desktop regression checked: yes

Screenshots:
- `tmp/mobile-visual-qa-recovery/full/mobile-home-390.png`
- `tmp/mobile-visual-qa-recovery/full/mobile-home-430.png`
- `tmp/mobile-visual-qa-recovery/full/mobile-home-1440.png`

Remaining issues:
- Future polish can reduce visual density, but the route is usable.

## POS / Касса

Route: `/pos/sell`

Viewports tested: `390`, `430`, `768`, `1440`

Status: Good

Problems found:
- No horizontal overflow or bottom-nav overlap in the checked viewports.

Fixes made:
- None in this pass.

Desktop regression checked: yes

Screenshots:
- `tmp/mobile-visual-qa-recovery/full/pos-sell-390.png`
- `tmp/mobile-visual-qa-recovery/full/pos-sell-430.png`
- `tmp/mobile-visual-qa-recovery/full/pos-sell-1440.png`

Remaining issues:
- This was visual QA only; no POS business flow was changed.

## Products / Товары

Route: `/products`

Viewports tested: `390`, `430`, `768`, `1440`

Status: Still needs polish

Problems found:
- Product mobile cards are usable and no longer overflow, but the page remains visually heavy: large cards, visible select controls, and dense filter chips.

Fixes made:
- No new product-list redesign in this pass. This was left documented rather than widened into a product redesign task.

Desktop regression checked: yes

Screenshots:
- `tmp/mobile-visual-qa-recovery/full/products-390.png`
- `tmp/mobile-visual-qa-recovery/full/products-430.png`
- `tmp/mobile-visual-qa-recovery/full/products-1440.png`

Remaining issues:
- Needs a focused mobile product-list polish pass: compact row/card option, less dominant bulk selection, and cleaner filter disclosure.

## Product Create

Route: `/products/new`

Viewports tested: `390`, `430`, `768`, `1440`

Status: Good

Problems found:
- No horizontal overflow in the checked viewports.

Fixes made:
- None in this pass.

Desktop regression checked: yes

Screenshots:
- `tmp/mobile-visual-qa-recovery/full/product-new-390.png`
- `tmp/mobile-visual-qa-recovery/full/product-new-430.png`
- `tmp/mobile-visual-qa-recovery/full/product-new-1440.png`

Remaining issues:
- The mobile section strip is still scrollable; acceptable for now.

## Product Edit

Route: `/products/fddd9760-7fb7-4cd8-b61f-86ef04d262cc`

Viewports tested: `390`, `430`, `768`, `1440`

Status: Fixed

Problems found:
- The mobile sticky Save action sat too close to the bottom nav and covered content.
- The product image placeholder was too tall on phone, pushing useful product data below the fold.

Fixes made:
- Moved the floating Save action above the mobile bottom nav.
- Added extra bottom padding for the mobile sticky action.
- Reduced the mobile product detail image area height while preserving desktop sizing.

Desktop regression checked: yes

Screenshots:
- `tmp/mobile-visual-qa-recovery/full/product-edit-390.png`
- `tmp/mobile-visual-qa-recovery/full/product-edit-430.png`
- `tmp/mobile-visual-qa-recovery/full/product-edit-1440.png`

Remaining issues:
- The sticky Save bar still overlays the next section while scrolling; content remains reachable because of added bottom padding.

## Inventory / Запасы

Route: `/inventory`

Viewports tested: `390`, `430`, `768`, `1440`

Status: Fixed

Problems found:
- Desktop header actions and filters were still influencing mobile layout.
- Mobile inventory action area exposed too many large controls.
- Product cards were carrying a repeated checkbox/select-all pattern and too many visible actions.
- Some stock labels truncated awkwardly at 390px.

Fixes made:
- Hid desktop `PageHeader` actions/filters from the mobile inventory layout.
- Replaced the mobile action row with one primary `Оприходование` action and a single overflow menu for secondary stock actions.
- Removed the mobile select-all block and per-card checkbox from inventory cards.
- Simplified inventory cards around image, name, optional SKU, status, stock metrics, and one overflow action.
- Kept SKU/barcode visibility tied to current store settings.

Desktop regression checked: yes

Screenshots:
- `tmp/mobile-visual-qa-recovery/full/inventory-390.png`
- `tmp/mobile-visual-qa-recovery/full/inventory-430.png`
- `tmp/mobile-visual-qa-recovery/full/inventory-1440.png`

Remaining issues:
- The global mobile top bar is still visually bulky. Inventory itself is no longer a squeezed table and has no horizontal overflow.

## Inventory Receiving / Оприходование

Route: `/inventory/receiving`

Viewports tested: `390`, `430`, `768`, `1440`

Status: Fixed

Problems found:
- Mobile receiving used too much vertical space for document details.
- Product search result metadata was too long for phone and the 768px boundary.
- The desktop receiving table/layout created overflow at the 768px boundary after the desktop shell correction.
- The sticky summary was too tall and crowded the product search area.

Fixes made:
- Converted supplier/reference/note into a compact `Дополнительно` section below `lg`.
- Shortened the mobile search placeholder and result metadata.
- Kept the receiving line-card layout active until `lg`; the desktop receiving table waits until there is enough width.
- Tightened the sticky mobile summary and kept it above the mobile bottom nav.
- Added localized `receiving` breadcrumb text and `common.additional`.

Desktop regression checked: yes

Screenshots:
- `tmp/mobile-visual-qa-recovery/full/receiving-390.png`
- `tmp/mobile-visual-qa-recovery/full/receiving-430.png`
- `tmp/mobile-visual-qa-recovery/full/receiving-768.png`
- `tmp/mobile-visual-qa-recovery/full/receiving-1440.png`

Remaining issues:
- The sticky receiving summary intentionally overlays the lower viewport while scrolling; page bottom padding keeps the final content reachable.

## Stock Transfer / Adjustment / Count

Routes:
- `/inventory` with transfer action opened
- `/inventory` with adjustment action opened
- `/inventory/counts`
- `/inventory/counts/new`
- `/inventory/counts/cmp6n6oic0002c6xlfgu5v5ns`

Viewports tested: `390`, `430`, `768`, `1440`

Status: Fixed

Problems found:
- Stock count detail rendered a wide table at `768px`, creating horizontal overflow.
- `/inventory/counts/new` redirects to `/inventory/counts` in the checked seed session.

Fixes made:
- Added a `desktopBreakpoint` option to `ResponsiveDataList`.
- Stock count detail now keeps the card/list presentation through the 768px boundary and switches to the table at `lg`.

Desktop regression checked: yes

Screenshots:
- `tmp/mobile-visual-qa-recovery/full/inventory-transfer-390.png`
- `tmp/mobile-visual-qa-recovery/full/inventory-adjustment-390.png`
- `tmp/mobile-visual-qa-recovery/full/inventory-counts-390.png`
- `tmp/mobile-visual-qa-recovery/full/inventory-count-detail-768.png`
- `tmp/mobile-visual-qa-recovery/full/inventory-count-detail-1440.png`

Remaining issues:
- New count creation was not independently verifiable because the route redirects for this seed user/session.

## Sales / Продажи

Routes:
- `/sales/orders`
- `/sales/orders/cmp94n5bg0005ppwg53o83qas`
- `/pos/history`

Viewports tested: `390`, `430`, `768`, `1440`

Status: Good

Problems found:
- No horizontal overflow or primary action overlap in the checked screenshots.

Fixes made:
- None in this pass.

Desktop regression checked: yes

Screenshots:
- `tmp/mobile-visual-qa-recovery/full/sales-orders-390.png`
- `tmp/mobile-visual-qa-recovery/full/sales-order-detail-390.png`
- `tmp/mobile-visual-qa-recovery/full/pos-history-390.png`

Remaining issues:
- Sales/orders and POS history are separate product areas; naming remains a product clarity issue outside this recovery pass.

## Customers / Клиенты

Routes:
- `/customers`
- `/customers?add=1`

Viewports tested: `390`, `430`, `768`, `1440`

Status: Good

Problems found:
- No horizontal overflow in the checked screenshots.

Fixes made:
- None in this pass.

Desktop regression checked: yes

Screenshots:
- `tmp/mobile-visual-qa-recovery/full/customers-390.png`
- `tmp/mobile-visual-qa-recovery/full/customer-new-390.png`
- `tmp/mobile-visual-qa-recovery/full/customers-1440.png`

Remaining issues:
- No dedicated customer detail route exists to open; detail is not separately verifiable as a route.

## Settings / Profile Settings

Route: `/settings/profile`

Viewports tested: `390`, `430`, `768`, `1440`

Status: Good

Problems found:
- No horizontal overflow in the checked screenshots.

Fixes made:
- None in this pass.

Desktop regression checked: yes

Screenshots:
- `tmp/mobile-visual-qa-recovery/full/settings-profile-390.png`
- `tmp/mobile-visual-qa-recovery/full/settings-profile-430.png`
- `tmp/mobile-visual-qa-recovery/full/settings-profile-1440.png`

Remaining issues:
- This was visual QA only; product setting isolation/business logic was not changed in this recovery pass.

## Printing Settings

Route: `/settings/printing`

Viewports tested: `390`, `430`, `768`, `1440`

Status: Good

Problems found:
- No horizontal overflow in the checked screenshots.

Fixes made:
- None in this pass.

Desktop regression checked: yes

Screenshots:
- `tmp/mobile-visual-qa-recovery/full/settings-printing-390.png`
- `tmp/mobile-visual-qa-recovery/full/settings-printing-430.png`
- `tmp/mobile-visual-qa-recovery/full/settings-printing-1440.png`

Remaining issues:
- The QZ setup copy is still technical, but the wizard is readable and was not redesigned here.

## More Menu / Ещё

Route: `/dashboard` with More opened

Viewports tested: `390`, `430`, `768`, `1440`

Status: Good

Problems found:
- No horizontal overflow in the checked screenshots.

Fixes made:
- None in this pass.

Desktop regression checked: yes

Screenshots:
- `tmp/mobile-visual-qa-recovery/full/more-menu-390.png`
- `tmp/mobile-visual-qa-recovery/full/more-menu-430.png`
- `tmp/mobile-visual-qa-recovery/full/more-menu-1440.png`

Remaining issues:
- At desktop widths this route naturally shows the dashboard/desktop sidebar, not the mobile More sheet.

## Auth / Onboarding

Routes:
- `/login`
- `/signup`
- `/onboarding`

Viewports tested: `390`, `430`, `768`, `1440`

Status: Good

Problems found:
- No horizontal overflow in the checked screenshots.

Fixes made:
- None in this pass.

Desktop regression checked: yes

Screenshots:
- `tmp/mobile-visual-qa-recovery/full/login-390.png`
- `tmp/mobile-visual-qa-recovery/full/signup-390.png`
- `tmp/mobile-visual-qa-recovery/full/onboarding-390.png`

Remaining issues:
- None blocking from the visual pass.

## Fixes Implemented In This Pass

- `/inventory`: hid desktop header controls on mobile, simplified mobile inventory actions, removed mobile selection clutter, cleaned stock cards.
- `/inventory/receiving`: compacted document details, shortened search/result text, kept line cards through the 768px boundary, tightened sticky summary.
- `/dashboard` shell: made `>=768px` use the desktop sidebar instead of the compact tablet drawer.
- `/inventory/counts/[id]`: kept card/list layout through the 768px boundary to avoid wide table overflow.
- `/products/[id]`: moved mobile Save above the bottom nav, added bottom padding, reduced oversized mobile image placeholder.
- Shared: added `PageHeader` class hooks and `ResponsiveDataList.desktopBreakpoint`; extended visual QA script route coverage and filtering.

## Reverts / Feature Flags

- Reverted pages: none.
- Feature-flagged pages: none.

## Manual QA Checklist

- Open every route listed above at `390`, `430`, `768`, and `1440`.
- Confirm no horizontal overflow.
- Confirm mobile bottom nav does not cover primary actions.
- Confirm Inventory uses compact stock cards and one primary receiving action.
- Confirm Receiving uses compact document details, product search cards, and sticky summary above the bottom nav.
- Confirm desktop sidebar appears at `768` and `1440`.
- Confirm desktop layouts remain visually desktop-oriented.

## Verification Results

- `git diff --check`: passed.
- `pnpm i18n:check`: passed.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm exec vitest run tests/unit/mobile-inventory-source.test.ts`: passed, 3 tests.
- `pnpm build`: passed.

## Targeted Follow-Up: Profile, Products, More Navigation

Date: 2026-05-17

Routes:
- `/settings/profile`
- `/products`
- `/sales/orders`
- `/dashboard` with the mobile `Ещё` sheet open

Viewports tested: `390`, `430`, `768`, `1440`

Status: Fixed

Problems found:
- `/settings/profile`: mobile settings hub used literal text arrows (`>`), which looked unprofessional.
- `/settings/profile`: one-at-a-time section switching clipped access to the full profile content on phone.
- `/products`: mobile product list used wide image blocks; product thumbnails were not consistently square.
- `/products`: mobile edit action inherited the desktop `target="_blank"` behavior.
- Mobile bottom nav still gave primary placement to `Запасы` instead of sales/orders.
- Mobile `Ещё` sheet placed the language switcher too prominently above navigation.

Fixes made:
- Replaced literal arrows on `/settings/profile` cards with `ChevronDownIcon` rotated as a right chevron.
- Restored `/settings/profile` to a normal scrollable mobile page and changed mobile save actions from sticky bars to in-flow full-width buttons.
- Changed mobile product cards to list-style cards with square `h-24 w-24` thumbnails.
- Forced only mobile product edit actions to use same-tab navigation.
- Changed the mobile bottom nav to `Главная / Касса / Товары / Продажи / Ещё`; moved `Запасы` into `Ещё`.
- Reordered and simplified `Ещё`: navigation links first, then compact language switcher, install card, and sign out.

Visual QA:
- No horizontal overflow reported for all checked routes at all tested widths.
- `/settings/profile` bottom scroll check confirmed content reaches store profile save and product settings save.

Screenshots:
- `tmp/mobile-visual-qa-recovery/followup/settings-profile-390.png`
- `tmp/mobile-visual-qa-recovery/followup/settings-profile-390-bottom.png`
- `tmp/mobile-visual-qa-recovery/followup/products-390.png`
- `tmp/mobile-visual-qa-recovery/followup/more-menu-390.png`
- `tmp/mobile-visual-qa-recovery/followup/sales-orders-390.png`

Remaining issues:
- `/products` mobile card density is usable after the square thumbnail fix, but it still carries inline-edit controls from the shared product list and should get a dedicated mobile action sheet in a separate pass.

## Targeted Follow-Up: POS Access and Mobile Sale Entry

Date: 2026-05-17

Routes:
- `/pos`
- `/pos/sell`
- `/pos/sell` after adding products to the cart

Viewports tested: `390`, `430`, `768`, `1440`

Status: Fixed

Problems found:
- Mobile bottom nav opened `/pos/sell` directly, so phone users could not naturally access the POS hub for shift/register state and related cashier actions.
- `/pos` mobile reused the desktop shift layout, burying the main `Продажа` action under previous-shift details.
- `/pos/sell` was usable, but the register panel consumed top-screen space before product selection.

Fixes made:
- Changed the mobile `Касса` bottom tab to open `/pos`; `/pos/sell` remains available from the POS hub and active under the same tab.
- Added a mobile-only `/pos` task hub with shift status, register selector, a dominant `Продажа` button, `Закрыть смену`, and cashier quick actions. The existing desktop `/pos` layout remains behind the `md` breakpoint.
- Hid the `/pos/sell` register panel when it is not needed; it remains visible when the cashier must choose/open a register.

Visual QA:
- `/pos` at `390`: main sale action is visible in the first screen, no horizontal overflow, bottom nav does not cover content.
- `/pos/sell` at `390`: product search, category chips, product images, price, and cart summary are visible; no horizontal overflow.
- `/pos/sell` cart at `390`: product images, editable start price, quantity controls, discount action, payment amount, and `Завершить продажу` are visible and tappable; no horizontal overflow.
- `/pos` and `/pos/sell` at `768` and `1440`: desktop/tablet-wide layouts remain desktop-oriented.

Screenshots:
- `tmp/mobile-visual-qa-recovery/pos-access-after2/pos-entry-390.png`
- `tmp/mobile-visual-qa-recovery/pos-access-after2/pos-entry-430.png`
- `tmp/mobile-visual-qa-recovery/pos-access-after2/pos-entry-768.png`
- `tmp/mobile-visual-qa-recovery/pos-access-after2/pos-entry-1440.png`
- `tmp/mobile-visual-qa-recovery/pos-access-after2/pos-sell-390.png`
- `tmp/mobile-visual-qa-recovery/pos-access-after2/pos-sell-430.png`
- `tmp/mobile-visual-qa-recovery/pos-access-after2/pos-sell-768.png`
- `tmp/mobile-visual-qa-recovery/pos-access-after2/pos-sell-1440.png`
- `tmp/mobile-visual-qa-recovery/pos-access-cart/pos-sell-cart-390.png`
- `tmp/mobile-visual-qa-recovery/pos-access-cart/pos-sell-cart-430.png`
- `tmp/mobile-visual-qa-recovery/pos-access-cart/pos-sell-cart-768.png`
- `tmp/mobile-visual-qa-recovery/pos-access-cart/pos-sell-cart-1440.png`

Remaining issues:
- `/pos/sell` still shows the register selector when multiple registers are available. That is intentional for correctness, but the control can be converted to a smaller bottom-sheet selector in a later mobile-only polish pass.

## Targeted Follow-Up: POS Cart Quantity Stepper

Date: 2026-05-17

Route:
- `/pos/sell` after adding products to the cart

Viewports tested: `390`, `430`, `768`, `1440`

Status: Fixed

Problems found:
- On the mobile cart line item, the quantity control reserved only `96px` for three controls, so the `+` increment button was clipped off-screen/inside the card.

Fixes made:
- Increased the mobile cart quantity stepper column to `132px`.
- Set each control (`-`, quantity input, `+`) to `44px` for visible, tappable phone controls.

Visual QA:
- `/pos/sell` cart at `390`: `-`, quantity, and `+` are all visible for each line item; no horizontal overflow.
- `/pos/sell` cart at `430`, `768`, and `1440`: no horizontal overflow reported.

Screenshots:
- `tmp/mobile-visual-qa-recovery/pos-stepper-fix/pos-sell-cart-390.png`
- `tmp/mobile-visual-qa-recovery/pos-stepper-fix/pos-sell-cart-430.png`
- `tmp/mobile-visual-qa-recovery/pos-stepper-fix/pos-sell-cart-768.png`
- `tmp/mobile-visual-qa-recovery/pos-stepper-fix/pos-sell-cart-1440.png`

Remaining issues:
- None for the quantity stepper visibility.

## Production Readiness Follow-Up: Content-Covering Actions And Breadcrumbs

Date: 2026-05-17

Routes:
- `/products/new`
- `/products/fddd9760-7fb7-4cd8-b61f-86ef04d262cc`
- `/settings/profile`
- `/settings/printing`

Viewports tested: `390`, `430`, `768`, `1440`

Status: Fixed

Problems found:
- `/products/new`: the shared mobile product form Save action was fixed to the viewport and visually covered form fields.
- `/products/[id]`: the product detail page had a second fixed mobile Save action, which covered the stock card at 390px.
- `/settings/printing`: breadcrumbs exposed the raw route segment `printing` in the Russian UI.
- `/settings/profile`: prior concern was that inner settings content could be clipped; follow-up bottom-scroll capture confirmed store/product settings are reachable and the bottom nav does not hide the product settings Save action.

Fixes made:
- Changed the shared product form mobile Save action from fixed/sticky overlay to an in-flow full-width action at the end of the form.
- Changed the product detail mobile Save action from fixed overlay to in-flow on mobile while preserving the desktop fixed action at `md` and above.
- Added a localized breadcrumb label for the `printing` route segment.
- Extended the CDP visual QA script with bottom-scroll captures for product forms and profile settings.

Visual QA:
- `/products/new` at `390`: no Save overlay covers the photo URL field; no horizontal overflow.
- `/products/new` bottom at `390`: Save action is reachable in normal scroll and not hidden by the bottom nav.
- `/products/[id]` at `390`: stock card is fully visible; no Save overlay covers the card.
- `/products/[id]` bottom at `390`: Save action is reachable in normal scroll and not hidden by the bottom nav.
- `/settings/profile` bottom at `390`: product settings controls and Save action are visible; no horizontal overflow.
- `/settings/printing` at `390`: breadcrumb now reads `Главная / Настройки / Настройки печати`.
- Desktop `1440` captures for product create/edit and printing settings remained desktop-oriented.

Screenshots:
- `tmp/mobile-visual-qa-recovery/prod-readiness-followup-2/product-new-390.png`
- `tmp/mobile-visual-qa-recovery/prod-readiness-bottom/product-new-bottom-390.png`
- `tmp/mobile-visual-qa-recovery/prod-readiness-followup-3/product-edit-390.png`
- `tmp/mobile-visual-qa-recovery/prod-readiness-bottom/product-edit-bottom-390.png`
- `tmp/mobile-visual-qa-recovery/prod-readiness-profile-bottom/settings-profile-bottom-390.png`
- `tmp/mobile-visual-qa-recovery/prod-readiness-followup/settings-printing-390.png`

Latest verification:
- `pnpm exec vitest run tests/unit/mobile-shell-source.test.ts tests/unit/pos-entry-source.test.ts tests/unit/mobile-products-source.test.ts tests/unit/mobile-inventory-source.test.ts tests/unit/mobile-settings-source.test.ts tests/unit/mobile-printing-source.test.ts tests/unit/mobile-sales-source.test.ts tests/unit/mobile-customers-source.test.ts tests/unit/pwa-polish-source.test.ts tests/unit/products-page-source.test.ts tests/integration/profile-settings.test.ts`: passed 42 tests, 4 profile-settings integration tests skipped by the suite guard.
- `git diff --check`: passed.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm build`: passed.

Remaining issues:
- Mobile products and customers remain visually dense. They are usable and no longer have blocking overflow/overlay defects, but they should still get a separate focused polish pass before calling the whole mobile app final-polished.

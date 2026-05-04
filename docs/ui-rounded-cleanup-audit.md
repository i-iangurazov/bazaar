# UI Rounded Cleanup Audit

## Scope

This audit covers remaining radius utilities in shared UI, guidance helpers, navigation, and high-traffic app routes after the first sharp-UI slice. It intentionally excludes the business logic for barcode printing, route protection, seed guards, and support bundle export.

## Current Radius Baseline

- `rounded-sm`, `rounded-md`, and `rounded-lg` resolve through Tailwind radius tokens, and those tokens currently resolve to `0px`.
- `rounded`, `rounded-xl`, `rounded-2xl`, and `rounded-full` still produce visible radius unless explicitly replaced.
- Shared components should prefer explicit `rounded-none` so local overrides are easier to spot in review.

## Findings By Class

- `rounded-sm`: mostly select items, switch thumbs, and breadcrumb text affordances. Shared component issue. Replace in shared controls with `rounded-none`; leave tiny non-control markers only if intentionally visual.
- `rounded`: appears on native checkboxes, small icon hit areas, code pills, label previews, and a few success metric boxes. Page-specific UI issue. Replace where it controls visible UI surfaces; keep only if a browser-native control requires it, which is not currently needed.
- `rounded-md`: dominant class across shared controls, app shell, cards, menus, inputs, modals, and page surfaces. Shared component issue where it lives in `src/components/ui`; acceptable tokenized compatibility when passed by old page code. Replace shared primitives with explicit `rounded-none` first.
- `rounded-lg`: visible page-specific issue on dashboard metric cards, products tables/modals, inventory segmented controls/tables, settings empty states, product form panels, command palette panels, and a few admin/support cards. Replace now in shared/high-traffic surfaces.
- `rounded-xl`: visible page-specific issue on product detail media shells, command palette sections, catalog/public components, page skeletons, and integration pages. Replace now in app/shared surfaces touched in this slice; leave public catalog/landing for a separate public-site pass.
- `rounded-2xl`: limited to public catalog surfaces. Page-specific issue outside the private-app cleanup scope. Leave for a later public catalog pass.
- `rounded-full`: used for progress bars, range sliders, spinner shells, status pills, and product-form chips. Intentional exception for progress/range/thumb-like indicators; should be replaced now for badges/pills and ordinary buttons because the product direction says badges should not be rounded.

## Classification

### Shared Component Issues

- `src/components/ui/button.tsx`, `input.tsx`, `select.tsx`, `textarea.tsx`, `modal.tsx`, `dropdown-menu.tsx`, `tooltip.tsx`, `card.tsx`, `badge.tsx`, `switch.tsx`, `toast.tsx`.
- `src/components/app-shell.tsx`, `src/components/language-switcher.tsx`, `src/components/page-breadcrumbs.tsx`, `src/components/command-palette.tsx`, `src/components/product-form.tsx`.
- Missing shared primitives: `Popover` and `Tabs`. Add sharp primitives so future popovers/tabs do not reintroduce rounded styles.

### Page-Specific UI Issues

- Dashboard metric cards and activity rows use `rounded-lg`.
- Products list/detail has visible `rounded-lg/xl/full` on segmented controls, tables, modal panels, and status/progress surfaces.
- Inventory has visible `rounded-lg/full` on segmented controls, tables, preview panels, and sliders.
- POS history uses `rounded-full` status badges.
- Settings import/attributes/users pages use `rounded`, `rounded-lg`, and tokenized old panel classes.
- Sales order detail empty states use `rounded-lg`.

### Intentional Exceptions

- Progress bars and slider tracks/thumb-like range inputs can keep `rounded-full` because the shape communicates progress/drag affordance and avoids jagged fill rendering.
- Image/object previews can keep tokenized `rounded-md` because the token is `0px`; this keeps class compatibility while rendering sharp.
- Public catalog and landing components are not part of this private-app cleanup pass and need a separate storefront visual review.

### Should Be Replaced Now

- Shared UI primitive base radius classes.
- Command palette panels and result rows.
- Product form panels, chips, and inline icon hit areas.
- High-traffic app `rounded-lg/xl` panel/table/empty-state wrappers.
- Page-owned `rounded-full` badges/status pills.
- Standalone `rounded` on high-traffic page panels, previews, code blocks, and checkboxes where it creates visible rounding.

## Post-Cleanup Expectations

- Shared controls render sharp even before token resolution.
- Page-specific `rounded-lg/xl/2xl/full` instances are reduced to known exceptions.
- Modal footers use the same border-top, right-aligned action pattern and avoid wrapping squeezed buttons.
- Tip/help buttons remain fixed square controls with accessible labels.

## Cleanup Slice Result

- Shared UI primitives now use explicit `rounded-none` for buttons, inputs, textareas, selects, dropdowns, tooltips, cards, badges, switches, toasts, modals, table containers, popover surfaces, and tab controls.
- High-traffic private app surfaces for dashboard, products, inventory, POS, sales/orders, reports, and settings no longer have visible `rounded`, `rounded-xl`, or `rounded-2xl` classes.
- Remaining high-traffic `rounded-full` classes are limited to progress bars and range sliders.
- Remaining visible radius classes in `src/components/catalog/public-catalog-page.tsx` and `src/components/landing/PreviewTabs.tsx` are intentional out-of-scope public storefront/landing work for a later pass.

## UX Redesign Follow-Up - 2026-05-04

- The follow-up slice intentionally moved beyond mechanical radius cleanup and addressed action hierarchy on Products, Dashboard, POS, and Inventory.
- Products now prioritizes one primary action, moves secondary operations into menus, uses a clearer bulk action bar, and makes missing barcode/price/stock readiness easier to scan.
- Dashboard now leads with business KPIs, needs-attention items, and merchant quick actions instead of recent technical activity.
- POS entry now focuses on register/shift state and sends users with an open shift directly toward the sell screen.
- Inventory now groups secondary stock actions and highlights negative/low stock more strongly.
- Remaining visible radius risk is concentrated in legacy product/inventory print modals and lower sections that are not part of the normal quick-print flow.

## Color Semantics Follow-Up - 2026-05-04

- The latest slice did not change the no-radius direction; it focused on reducing visual noise after the sharp UI work.
- Shared badges remain `rounded-none` but now use subtle neutral/semantic treatments instead of solid bright blocks.
- Product readiness is consolidated into a single status badge per row, reducing repeated red/orange status pills.
- Dashboard and Inventory keep sharp cards and neutral surfaces while limiting warning/danger color to actual attention values.
- Remaining radius risks are unchanged: lower-traffic private pages and public storefront/landing surfaces still need separate visual review.

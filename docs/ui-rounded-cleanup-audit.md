# UI Rounded Cleanup Audit

## Scope

This audit originally covered remaining radius utilities in shared UI, guidance helpers, navigation, and high-traffic app routes after the first sharp-UI slice. The product direction has since changed to small Bazaar rounding across the system.

## Current Radius Baseline

- `rounded-md` is the standard Bazaar radius utility for shared controls, panels, cards, menus, inputs, modals, page surfaces, app surfaces, landing surfaces, and public catalog surfaces.
- Directional corners should use the matching `rounded-*-md` utility when a directional radius is required.
- Non-standard radius utilities should not be introduced without an explicit product/design reason and review.

## Findings By Class

- `rounded-md`: standard class across shared controls, app shell, cards, menus, inputs, modals, page surfaces, public catalog, and landing UI.
- `rounded-*-md`: allowed only for directional cases such as mobile sheets.
- Non-standard radius utilities have been removed from `src` and `tests`.

## Classification

### Shared Component Issues

- `src/components/ui/button.tsx`, `input.tsx`, `select.tsx`, `textarea.tsx`, `modal.tsx`, `dropdown-menu.tsx`, `tooltip.tsx`, `card.tsx`, `badge.tsx`, `switch.tsx`, `toast.tsx`.
- `src/components/app-shell.tsx`, `src/components/language-switcher.tsx`, `src/components/page-breadcrumbs.tsx`, `src/components/command-palette.tsx`, `src/components/product-form.tsx`.
- Missing shared primitives: `Popover` and `Tabs`. Add sharp primitives so future popovers/tabs do not reintroduce rounded styles.

### Page-Specific UI Issues

- No remaining non-standard radius utilities are expected in `src`.

### Intentional Exceptions

- No oversized radius exceptions remain in `src`.
- Image/object previews use `rounded-md` to keep the Bazaar system radius consistent.

### Should Be Replaced Now

- Shared UI primitive base radius classes.
- Command palette panels and result rows.
- Product form panels, chips, and inline icon hit areas.
- High-traffic app panel/table/empty-state wrappers.
- Page-owned oversized radius on badges/status pills.
- Standalone `rounded` on high-traffic page panels, previews, code blocks, and checkboxes where it creates visible rounding.

## Post-Cleanup Expectations

- Shared controls render with `rounded-md`.
- Page-specific oversized radius classes do not reappear in `src`.
- Modal footers use the same border-top, right-aligned action pattern and avoid wrapping squeezed buttons.
- Tip/help buttons remain fixed `rounded-md` controls with accessible labels.

## Cleanup Slice Result

- Shared UI primitives now use small `rounded-md` corners for buttons, inputs, textareas, selects, dropdowns, tooltips, cards, badges, switches, toasts, modals, table containers, popover surfaces, and tab controls.
- High-traffic private app surfaces for dashboard, products, inventory, POS, sales/orders, reports, and settings use `rounded-md`.
- Public catalog and landing components now also use `rounded-md`.
- `rg` over `src` and `tests` should not return non-standard radius utilities or arbitrary radius classes.

## UX Redesign Follow-Up - 2026-05-04

- The follow-up slice intentionally moved beyond mechanical radius cleanup and addressed action hierarchy on Products, Dashboard, POS, and Inventory.
- Products now prioritizes one primary action, moves secondary operations into menus, uses a clearer bulk action bar, and makes missing barcode/price/stock readiness easier to scan.
- Dashboard now leads with business KPIs, needs-attention items, and merchant quick actions instead of recent technical activity.
- POS entry now focuses on register/shift state and sends users with an open shift directly toward the sell screen.
- Inventory now groups secondary stock actions and highlights negative/low stock more strongly.
- Remaining visible radius risk is concentrated in legacy product/inventory print modals and lower sections that are not part of the normal quick-print flow.

## Color Semantics Follow-Up - 2026-05-04

- The latest slice did not change the no-radius direction; it focused on reducing visual noise after the sharp UI work.
- Shared badges use small rounding and subtle neutral/semantic treatments instead of solid bright blocks.
- Product readiness is consolidated into a single status badge per row, reducing repeated red/orange status pills.
- Dashboard and Inventory keep sharp cards and neutral surfaces while limiting warning/danger color to actual attention values.
- Remaining radius risks are unchanged: lower-traffic private pages and public storefront/landing surfaces still need separate visual review.

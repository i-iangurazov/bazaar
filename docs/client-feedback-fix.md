# Client Feedback Fix Pack

## Checklist
- [x] 1) Product edit: pricing editing + store overrides in product edit + duplicate action
- [x] 2) Sidebar super-plus + command panel categories + global search fix
- [x] 3) `/sales/orders/new`: unit price + line totals + order total + strict price validation
- [x] 4) `/sales/orders` empty state copy + CTA
- [x] 5) Copy simplification (onboarding / insights / compliance naming)
- [x] 6) Tips panel mobile responsiveness (bottom sheet + instant behavior)

## Verification Gates
- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm i18n:check`
- [x] `CI=1 pnpm test:ci`
- [x] `pnpm build`

## Changes Summary
- Product duplication:
  - Added `products.duplicate` server mutation.
  - Duplicates catalog card with new unique SKU (`<SKU>-COPY`...), copies variants/components/images/packs, and intentionally skips barcodes.
- Product detail pricing:
  - Added `products.storePricing` query.
  - Added store-by-store pricing section in `/products/[id]` with inline override editing for `ADMIN/MANAGER`.
  - `STAFF` gets read-only state.
- Product list actions:
  - Removed row-level "set store price" action/modal from `/products`.
  - Added row-level duplicate action.
- Command palette:
  - Added category model and filtering helper in `src/lib/command-palette.ts`.
  - Added role-neutral categorized action sections and routes.
  - Wired sidebar/mobile super-plus trigger to open command palette.
- Sales order create:
  - Draft line now resolves and stores unit price immediately.
  - Added line totals and order total with strict "price not set" blocking before submit.
- Empty state and copy:
  - Added `/sales/orders` empty state CTA.
  - Applied simpler RU/KG labels for onboarding/insights/compliance labels.
- Tips mobile:
  - Tips panel uses mobile bottom-sheet layout and keeps optimistic hide behavior.

### Key Files
- `src/server/services/products.ts`
- `src/server/trpc/routers/products.ts`
- `src/app/(app)/products/page.tsx`
- `src/app/(app)/products/[id]/page.tsx`
- `src/components/command-palette.tsx`
- `src/components/app-shell.tsx`
- `src/app/(app)/sales/orders/new/page.tsx`
- `src/app/(app)/sales/orders/page.tsx`
- `src/components/guidance/page-tips-button.tsx`
- `src/lib/command-palette.ts`
- `tests/unit/command-palette.test.ts`
- `tests/integration/sales-orders.test.ts`
- `messages/ru.json`
- `messages/kg.json`

## Manual Smoke
1) Products:
- Open `/products`, use row action `Дублировать`, verify redirect to new product card and SKU suffix `-COPY`.
- Open duplicated card `/products/[id]`, verify "Цены по магазинам" block is visible.
2) Store price overrides:
- As `ADMIN` or `MANAGER`, change store price in `/products/[id]`, save, verify success toast and updated effective price in profitability card.
- As `STAFF`, verify block is read-only.
3) Command panel:
- Click super-plus in sidebar and mobile header; verify command panel opens and search input is focused.
- Type `продажа`, `постав`, `набор`; verify filtered actions appear and route navigation works.
4) Sales orders:
- Open `/sales/orders/new`, add line, verify unit price/line total/order total render.
- If a line has no price, verify localized warning and submit is blocked.
5) Empty state:
- Open `/sales/orders` with no data; verify localized empty text + `Создать заказ` CTA.
6) Mobile tips:
- On mobile width (375px), open page tips and verify bottom-sheet layout with internal scroll.

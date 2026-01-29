# Productization Audit

Date: 2026-01-26

## Page/module list
- Auth: `/login`
- Dashboard: `/dashboard`
- Inventory: `/inventory`
- Products: `/products`, `/products/new`, `/products/[id]`
- Purchase Orders: `/purchase-orders`, `/purchase-orders/new`, `/purchase-orders/[id]`
- Suppliers: `/suppliers`
- Stores: `/stores`
- Users: `/settings/users`

## Findings (Phase 0)

### Missing actions / dead ends
- Products: no “unarchive/restore” flow for archived items (server/UI only support archive).
- Suppliers: no delete/archive action (CRUD incomplete).
- Inventory: reorder/forecast insights returned by API are not surfaced in UI.
- Product detail: no movement history entry point (inventory has it; product detail does not).

### Missing messages / validation
- Empty states lack CTAs (users, stores, suppliers, products, inventory).
- Purchase order detail actions are outside `PageHeader` action slot (inconsistent layout).

### Overloaded screens (too much shown at once)
- Products list: CSV import card always visible.
- Product form: barcodes + variants + advanced attributes always visible.
- Suppliers page: create/edit form always visible above list.

### UX consistency gaps
- `PageHeader` has no built-in filters row; list pages use ad-hoc filter blocks.
- Action placement varies (PO detail vs other pages).

## Fixes applied (update as you go)
- Added PageHeader filters row and aligned filters/actions across list pages.
- Added CTAs in empty states (users, stores, suppliers, products, inventory, POs).
- Added supplier delete flow with server guard + UI confirmation.
- Added product restore flow + archived toggle in products list.
- Added inventory planning toggle + “Why” breakdown details.
- Added product movement history modal (store-scoped).
- Added store details modal (view for non-managers).
- Added progressive disclosure: product details/advanced toggles, products import toggle, suppliers form modal, dashboard “More” section.
- Added RBAC UI gating for users/products/suppliers/PO create pages.
- Added tests for users update RBAC + inventory idempotency.

## Files touched (update as you go)
- docs/productization-audit.md
- src/components/page-header.tsx
- src/components/icons.ts
- src/components/product-form.tsx
- src/app/(app)/dashboard/page.tsx
- src/app/(app)/inventory/page.tsx
- src/app/(app)/products/page.tsx
- src/app/(app)/products/new/page.tsx
- src/app/(app)/products/[id]/page.tsx
- src/app/(app)/purchase-orders/page.tsx
- src/app/(app)/purchase-orders/new/page.tsx
- src/app/(app)/purchase-orders/[id]/page.tsx
- src/app/(app)/stores/page.tsx
- src/app/(app)/suppliers/page.tsx
- src/app/(app)/settings/users/page.tsx
- src/server/services/products.ts
- src/server/services/suppliers.ts
- src/server/trpc/routers/products.ts
- src/server/trpc/routers/suppliers.ts
- messages/ru.json
- messages/kg.json
- tests/integration/users.test.ts
- tests/integration/inventory.test.ts

## QA checklist (update as you go)
- Users: admin can update user; manager blocked.
- Suppliers: delete blocked when supplier is referenced by products/POs.
- Products: archive + restore; archived toggle reveals restored item.
- Inventory: planning toggle shows/hides breakdown; idempotent receive/transfer validated.
- Purchase orders: staff cannot create new orders; action buttons align with status.
- Dashboard: “More” reveals recent activity.

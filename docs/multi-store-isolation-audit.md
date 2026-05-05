# Multi-Store Isolation Audit

Date: 2026-05-06

## Current Model

- `Organization` owns users, stores, products, imports, integrations, and accounting records.
- `Product` remains an organization-level master catalog item.
- Store-specific operational data already existed in `Store`, `InventorySnapshot`, `StockMovement`, `StorePrice`, `ReorderPolicy`, `PosRegister`, `RegisterShift`, `CustomerOrder`, `SalePayment`, `CashDrawerMovement`, `PurchaseOrder`, catalog/API keys, and report/export rows.
- The missing boundary was explicit product availability per store and explicit user access per store.

## Bugs Found

- Product creation/import could create base inventory snapshots for every store in an organization, so a new store could appear to contain the first store's products.
- Product list/search used `storeId` mainly for enrichment and display; it did not require that the product was available in that store.
- POS product lookup could find an organization product even if it was not assigned to the register store.
- Store selector returned every organization store for every user role.
- Store creation UI defaulted inventory copy too aggressively.

## New Store-Scoped Tables

- `UserStoreAccess`: explicit user-to-store assignment for non-admin roles.
- `StoreProduct`: explicit product-to-store availability for the operational catalog.

`Product` is still the master catalog. `StoreProduct` controls whether that product is available in a store.

## Store-Scoped Rules Implemented

- Admin/org owner/platform owner retain all-store access inside the organization context.
- Manager/staff/cashier access is explicit through `UserStoreAccess`.
- Store selector only returns stores the current user can access.
- Dashboard store bootstrap, summary, and activity endpoints only use stores the current user can access.
- Sales order list/detail/mutation endpoints enforce store access; an unfiltered list for a restricted user resolves to accessible stores, not the whole organization.
- Reports, analytics, and core export job endpoints enforce store access; unfiltered reads for restricted users resolve to assigned stores instead of organization-wide data.
- Explicit inaccessible store filters in reports, analytics, and export creation return `FORBIDDEN`.
- Product list, quick search, product ids, CSV export, Bazaar API products, and public catalog products require active `StoreProduct` assignment when a store context exists.
- Product import from `/settings/import` requires a target store and applies imported products/store prices/minimum-stock settings only to that selected store.
- Creating a product requires an explicit target store in the create form and assigns it only to that store.
- Creating/importing products without a store in a multi-store organization no longer assigns the product to all stores.
- Receiving/adjusting/transferring stock assigns the product to the affected store as part of that explicit stock action.
- Store price updates assign the product to that store.
- POS register list is filtered by accessible stores, and POS sale pricing rejects products not available in the register store.
- New store cloning now copies assortment only when the admin explicitly chooses a clone source/copy options.

## Migration Behavior

Migrations:

- `20260506120000_store_scope_assignments`
- `20260506121000_store_scope_updated_at_defaults`

- Non-destructive: only creates new tables, indexes, and foreign keys.
- The second migration aligns `updatedAt` defaults with Prisma `@updatedAt` behavior by dropping database defaults from the new tables.
- `UserStoreAccess` backfill gives existing manager/staff/cashier users access to current organization stores to preserve existing production behavior.
- Single-store organizations get every existing product assigned to their only store.
- Multi-store product backfill uses concrete evidence only:
  - non-zero inventory snapshots;
  - stock movements;
  - store prices;
  - reorder policies;
  - purchase order lines;
  - customer order lines;
  - products with exactly one historical inventory snapshot store.
- Empty snapshots created by old broad product initialization do not by themselves make a product available in every store.

## UI Changes

- User create/edit includes store assignment checkboxes for non-admin roles.
- Product creation shows a target-store selector before the form so admins can choose the store the product should belong to.
- Products empty-store state now offers explicit actions to create a product, import into the selected store, or add existing organization catalog products to the store.
- "Add existing products" opens a selection modal backed by `products.assignToStore`; it creates/reactivates `StoreProduct` rows and does not copy stock.
- Settings > Users now shows an admin reminder to review store assignments after the migration/backfill.
- Store creation copy inventory is no longer enabled by default.

## Risks / Follow-Up

- The "Add existing products" flow is functional and explicit; a later UX pass can make it richer with saved filters, select-all catalog search, and per-product availability hints.
- Manager/staff users created before this migration are intentionally backfilled to all current stores to avoid surprise lockouts; Settings > Users now surfaces this as an admin review task.
- Marketplace integrations still have some organization-level inclusion lists by design. This pass classified them as integration configuration/product-selection state, while stock/export payloads remain store/mapping based. A later integrations UX pass should decide whether marketplace inclusion should become per-store.
- Full browser QA for the new empty-store state was not run in this slice.

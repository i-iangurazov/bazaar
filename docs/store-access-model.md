# Store Access Model

Date: 2026-05-06

## Principles

- Store is the operational boundary.
- Organization is the legal/account/catalog container.
- Products can exist in the organization master catalog without being available in every store.
- A new store starts empty unless an admin explicitly copies assortment or performs a store-scoped action.

## Access Rules

| User type | Store access |
| --- | --- |
| Org owner / Admin | All stores in the organization |
| Platform owner | All stores only inside the active organization/platform context |
| Manager | Explicit `UserStoreAccess` rows |
| Staff | Explicit `UserStoreAccess` rows |
| Cashier | Explicit `UserStoreAccess` rows |

Central helper: `src/server/services/storeAccess.ts`

- `userHasAllStoreAccess(user)`
- `listAccessibleStores(client, user)`
- `resolveAccessibleStoreIds(client, user)`
- `canAccessStore(client, user, storeId)`
- `assertUserCanAccessStore(client, user, storeId)`
- `resolveDefaultStoreId(client, user, preferredStoreId)`
- `assignProductToStore(client, input)`

## Product Availability

- `Product` is organization master data.
- `StoreProduct` means "this product is available in this store".
- Operational product lists and search use selected/accessed store plus active `StoreProduct`.
- POS lookup and sale creation require the product to be assigned to the register store.
- Inventory actions assign a product to the store only when the action explicitly affects that store.
- Dashboard and sales-order reads use the user's accessible store set; restricted users do not get organization-wide data when no store filter is supplied.
- Reports, analytics, and export job reads use the user's accessible store set when no store filter is supplied.
- Export creation, report filters, and analytics filters reject explicit inaccessible `storeId` values server-side.

## Store Selector

- Only accessible stores are returned.
- Admins see all organization stores.
- Non-admin users with no store assignment get an empty store list and cannot access store-scoped data.

## Backward Compatibility

- Single-store orgs keep current behavior by assigning all products to their only store.
- Existing non-admin users are backfilled to current stores so production users are not locked out.
- Multi-store org product assignment is inferred only from concrete historical store evidence.

## Expected Product UX

- Store A product list shows Store A assigned products.
- Store B product list starts empty after Store B is created.
- Product creation asks for a target store; a product created for Store B appears in Store B only.
- Product import asks for a target store; imported products are assigned to that selected store only.
- Store product lists have an explicit "Add existing products" action that attaches selected master-catalog products to the selected store without copying stock.
- Store A-only product does not appear in Store B POS lookup.
- Copying assortment between stores must remain explicit and auditable.

## Integrations

- Bazaar Catalog is store-scoped: each public catalog belongs to one store and product payloads only include products assigned to that store.
- Marketplace integrations such as M-Market and Bakai Store still keep product inclusion toggles at organization level by design. Their stock/export payloads remain store/mapping-aware, but the inclusion UX is not yet per-store.
- The org-level marketplace inclusion model is a documented product decision, not a store-access bypass for POS, inventory, product lists, dashboard, reports, or core exports.

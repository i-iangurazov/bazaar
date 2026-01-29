# Tables Audit

## Products Store Column — Source of truth
- Product is organization-wide (no `storeId` on `Product`).
- Store availability is derived from `InventorySnapshot` entries per store.
- Products list is org-wide (no store selector), so Store column shows a store count/summary.

## Products list
- Current columns: SKU, Name, Category, Unit, Actions.
- Missing essentials: Barcodes, Store availability.
- Changes: add Barcodes summary and Store availability (count + names tooltip); base price not shown because there is no price field in the schema.

## Inventory list
- Current columns: Product, On hand, Min stock, Status, On order, Reorder target, Actions.
- Missing essentials: Store column not needed because the page is store-scoped via the selector.
- Changes: none (store selector remains source of truth).

## Purchase orders list
- Current columns: Supplier, Store, Status, Created.
- Missing essentials: Total amount, Order ID/number.
- Changes: add Total (from line unit costs) and a short Order ID column.

## Purchase order detail lines
- Current columns: Product, Variant, Ordered, Received, Unit cost, Line total.
- Missing essentials: none.
- Changes: none.

## Suppliers list
- Current columns: Name, Email, Phone, Notes, Actions.
- Missing essentials: none.
- Changes: none.

## Stores list
- Current columns: Name, Code, Allow negative stock.
- Missing essentials: Actions.
- Changes: add an action to toggle allow-negative-stock (admin-only, uses existing policy mutation).

## Users list
- Current columns: Name, Email, Role.
- Missing essentials: Locale, Active status.
- Changes: add Locale (preferredLocale) and Status columns.

## Import preview (Products CSV)
- Current columns: SKU, Name, Category, Unit.
- Missing essentials: none for preview.
- Changes: none.

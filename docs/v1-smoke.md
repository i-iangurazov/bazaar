# V1 Smoke Checklist

Date: 2026-01-26

Use a real seed DB (or demo data). Run on desktop and 375px mobile width.

## Admin flows
- Users: create user, edit user, deactivate/reactivate user
- Stores: create store, edit store profile
- Products: create product, add variant, delete variant (blocked if movements), archive + restore

## Catalog + barcode
- Global barcode scan/search; create-on-miss to new product form
- Product search by name/SKU/barcode

## Inventory
- Receive stock, adjust stock (with reason), transfer stock between stores
- Movement history for product/store

## Suppliers
- Create supplier, edit supplier
- Attempt to delete supplier referenced by products/POs (should be blocked with error)

## Purchase Orders
- Create PO (draft), submit, approve, receive (idempotent), export PDF
- Verify role-gated actions by status

## Localization
- Switch RU/KG, verify key pages render localized labels

## Mobile (375px)
- Dashboard, inventory, products, PO detail: tables scroll and actions remain reachable
- Forms: dialogs scroll and actions stay visible

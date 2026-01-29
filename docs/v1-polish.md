# V1 Polish Checklist

| Feature | Missing UX/logic | Fixes applied | Files changed | Manual QA steps |
| --- | --- | --- | --- | --- |
| App header search | No global scan/search for barcodes | Added scan/search input with barcode lookup + quick search + toast CTA | src/components/app-shell.tsx, src/server/trpc/routers/products.ts | Scan barcode, Enter → product page; missing barcode → CTA to create |
| Products | Barcode editing + variant removal guard | Barcode add/remove UI, variant deletion guard, archive action + toasts | src/components/product-form.tsx, src/app/(app)/products/page.tsx, src/app/(app)/products/[id]/page.tsx, src/server/services/products.ts | Edit product → add/remove barcode; try remove variant with stock; archive product |
| Inventory | Actions hidden/inline, no movements UI | Added action dialogs, movements modal, toasts, retry on errors | src/app/(app)/inventory/page.tsx, src/server/trpc/routers/inventory.ts | Receive/adjust/transfer/min stock; open movements modal |
| Stores | Missing create/edit + legal details | Added create/edit modal, legal details modal, policy update, toasts | src/app/(app)/stores/page.tsx, src/server/trpc/routers/stores.ts, src/server/services/stores.ts | Create/edit store; edit legal details; toggle negative stock |
| Users | Missing add/edit/reset + RBAC controls | Added add/edit modal, reset password, enable/disable, toasts | src/app/(app)/settings/users/page.tsx, src/server/trpc/routers/users.ts, src/server/services/users.ts | Admin adds user; edit role/locale; reset password |
| Purchase orders | No line management or cancel, weak feedback | Add/edit/remove lines, cancel, status actions with toasts | src/app/(app)/purchase-orders/page.tsx, src/app/(app)/purchase-orders/[id]/page.tsx, src/app/(app)/purchase-orders/new/page.tsx, src/server/services/purchaseOrders.ts, src/server/trpc/routers/purchaseOrders.ts | Create draft + submit; edit lines; cancel draft/submitted; approve/receive |
| Suppliers | Missing form hints + success feedback | Added placeholders, notes hints, toasts | src/app/(app)/suppliers/page.tsx | Create/edit supplier with notes |
| i18n + errors | Missing keys for new UI | Added ru/kg keys, new error messages | messages/ru.json, messages/kg.json | Switch RU/KG; check labels/toasts |
| Tests | Gaps in RBAC + variants | Added users RBAC, inventory receive, variant removal guard | tests/integration/users.test.ts, tests/integration/inventory.test.ts, tests/integration/products.test.ts | Run CI test suite |


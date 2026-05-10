# Permission Matrix

## Roles

- `CASHIER`: POS selling, open shifts, payment capture, receipt flows.
- `STAFF`: basic authenticated access where enabled; no product/admin mutations.
- `MANAGER`: inventory, purchase orders, reports, suppliers, store operations, POS supervision, customer database, customer import, and integrations.
- `ADMIN`: full organization admin, users, product mutations, imports, billing, technical admin pages.
- `ORG_OWNER`: owner-only diagnostics/profile actions where explicitly checked.
- `PLATFORM_OWNER`: cross-organization platform area only.

## Current Server-Side Procedures

- `protectedProcedure`: any authenticated active-plan user.
- `cashierProcedure`: `ADMIN`, `MANAGER`, `STAFF`, `CASHIER`.
- `managerProcedure`: `ADMIN`, `MANAGER`.
- `adminProcedure`: `ADMIN`.
- `orgOwnerProcedure`: authenticated org owner.
- `adminOrOrgOwnerProcedure`: `ADMIN` or org owner.
- `platformOwnerProcedure`: authenticated user with `isPlatformOwner`.

## Route-Level Expectations

| Area | Minimum Access |
| --- | --- |
| Dashboard | admin/manager by navigation; cashier/staff land on POS |
| POS / Cash | cashier-capable authenticated roles |
| Products list/detail | authenticated for read, admin for mutation |
| Inventory | authenticated read, manager/admin changes |
| Purchase orders | authenticated read, manager/admin changes |
| Suppliers | authenticated read, manager/admin changes |
| Reports | manager/admin |
| Customer database | manager/admin |
| Customer import | manager/admin |
| Product import | admin |
| Settings/users/attributes/units | admin |
| Email marketing | manager/admin |
| Diagnostics | org owner |
| Admin jobs/metrics/support | admin plus feature gate where applicable |
| Platform | platform owner |
| Public catalog | public, tenant-scoped, no private fields |

## Conservative Navigation Filtering

Navigation keeps the existing app shell groups, labels, item order, and sidebar CTA. Role work should filter the existing model in place rather than creating a new IA:

- Cashier/staff: POS, sales/order history where allowed, cash/shift flows where allowed, Help/Profile.
- Manager: the existing operational nav items that match permissions: Dashboard, POS, Products, Inventory, Sales/orders, Customer Database, Purchase orders, Suppliers, Stores, Reports, Integrations, and Customer Import.
- Admin/owner: the previous full business/admin nav, filtered only for explicit platform/org-owner gates.
- Platform/support/system routes stay in their previous placement but are hidden and middleware-denied unless the matching permission is present.

# Permission Matrix

## Roles

- `CASHIER`: POS selling, open shifts, payment capture, receipt flows.
- `STAFF`: basic authenticated access where enabled; no product/admin mutations.
- `MANAGER`: inventory, purchase orders, reports, suppliers, store operations, POS supervision.
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
| Dashboard | authenticated |
| POS / Cash | cashier-capable authenticated roles |
| Products list/detail | authenticated for read, admin for mutation |
| Inventory | authenticated read, manager/admin changes |
| Purchase orders | authenticated read, manager/admin changes |
| Suppliers | authenticated read, manager/admin changes |
| Reports | manager/admin |
| Settings/users/import/attributes/units | admin |
| Diagnostics | org owner |
| Admin jobs/metrics/support | admin plus feature gate where applicable |
| Platform | platform owner |
| Public catalog | public, tenant-scoped, no private fields |

## Follow-Up

The navigation should expose fewer items by role:

- Cashier: POS, Sales/orders if allowed, Cash shift, Help/Profile.
- Manager: Dashboard, Products, Inventory, Purchase orders, Suppliers, Reports, POS if allowed.
- Admin/owner: Settings, users, stores, integrations, billing.
- Technical/admin tools grouped under System/Admin and hidden from normal users.

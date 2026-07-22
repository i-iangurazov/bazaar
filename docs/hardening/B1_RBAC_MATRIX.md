# Phase B1 RBAC and isolation matrix

Baseline: `343079b4e6cd6140f84a8448610259b2d7573704`

Scope: the 24 confirmed P0-A findings only. `ALLOW` means both the route/procedure and the underlying resource scope permit the operation. `DENY` means the server rejects the direct request even when the UI is bypassed. A resource outside the authenticated organization or effective store set is always denied regardless of role.

| Capability | Admin | Manager | Cashier | Limited / Staff | Additional scope invariant |
| --- | --- | --- | --- | --- | --- |
| Dashboard and analytics | ALLOW | ALLOW | DENY | DENY | Queries use only effective stores |
| Organization billing and upgrade history | ALLOW | DENY | DENY | DENY | Organization derived from session |
| Reports and protected exports | ALLOW | ALLOW | DENY | DENY | Export identity and download owner must match |
| Global search: products | ALLOW | ALLOW | ALLOW | DENY | Results limited to assigned stores |
| Global search: suppliers, stores, purchase orders | ALLOW | ALLOW | DENY | DENY | Result types are filtered server-side |
| Product/category management | ALLOW | ALLOW | DENY | DENY | Product and source/target store must be accessible |
| Initial variant stock | ALLOW | DENY | DENY | DENY | Admin-only mutation; no stock side effect on denial |
| Inventory counts, lots, price tags and connector print | ALLOW | ALLOW | DENY | DENY | Document/product/store are checked before read or render |
| Purchase orders and suppliers | ALLOW | ALLOW | DENY | DENY | Direct API and PDF routes enforce role and store scope |
| Marketplace/integration overview and mutations | ALLOW | ALLOW | DENY | DENY | Selected store and job/artifact must be accessible |
| POS sale/read in assigned store | ALLOW | ALLOW | ALLOW | ALLOW | Register, shift, draft and receipt are bound to an allowed store |
| Register administration and protected POS operations | ALLOW | Policy-specific | DENY where elevated | DENY where elevated | Service layer is authoritative; UI visibility is not relied upon |
| Period close | ALLOW | ALLOW for assigned stores | DENY | DENY | Same-org inaccessible store and cross-org requests have no effect |
| Tenant dead-letter operations | ALLOW for own tenant | DENY | DENY | DENY | Null-organization/global jobs are hidden from tenant actors |
| Platform-global dead-letter operations | Platform owner only | DENY | DENY | DENY | Requires explicit platform capability |
| Store groups | ALLOW | DENY | DENY | DENY | `src/middleware.ts` and server permissions agree |
| Category settings route | ALLOW | ALLOW | DENY | DENY | `src/middleware.ts` and product mutation policy agree |

## Bazaar API key contract

| Check | Result |
| --- | --- |
| Key resolves exactly one organization and store | PASS |
| Product/order list is limited to the mapped store | PASS |
| `storeId` tampering returns no foreign rows | PASS |
| Same-org foreign-store, cross-org and absent order IDs are indistinguishable | PASS — `404 {"error":"NOT_FOUND"}` |
| Foreign product POST creates no order or stock movement | PASS |
| Revoked key stops immediately | PASS |
| Token/hash omitted from normal response bodies | PASS |

## Browser route evidence

The saved browser matrix covers Admin, Manager, Cashier and Staff at desktop `1440x1000` and mobile `390x844` / `414x896`. It validates positive routes and direct URL denial redirects with no captured console, runtime or HTTP 5xx errors. Evidence: [`evidence/b1/browser-security-smoke/summary.json`](./evidence/b1/browser-security-smoke/summary.json).


# Role Navigation Audit

## Scope

This slice is a conservative filtering pass, not a navigation redesign.

The previous app shell structure remains the baseline:

- groups: Core, Operations, Insights, Admin, Help;
- item order: Dashboard, POS, Products, Inventory, Orders, Suppliers, Stores, then the existing secondary groups;
- sidebar layout and command-palette CTA;
- existing labels and localization keys;
- command palette category order;
- dashboard layout.

## Actual Roles

The Prisma role enum supports:

- `ADMIN`
- `MANAGER`
- `STAFF`
- `CASHIER`

Additional access flags are separate from role:

- `isOrgOwner`
- `isPlatformOwner`

## Access Model

`src/lib/roleAccess.ts` centralizes UI and middleware route checks.

- `ADMIN`: full organization navigation, plus platform and diagnostics only when the explicit flags are present.
- `MANAGER`: operational navigation: dashboard, POS, sales, products, inventory, purchase orders, suppliers, stores, reports, and integrations.
- `STAFF` and `CASHIER`: POS, sales/order history, cash/shift-capable flows, help, and profile.
- `PLATFORM_OWNER`: can access `/platform` when `isPlatformOwner` is present; the previous sidebar placement is preserved.
- `ORG_OWNER`: can access diagnostics when `isOrgOwner` is present.

## Preserved UX

- No nav group was renamed.
- No nav group was reordered.
- No nav item was moved into a new group.
- The large sidebar command-palette CTA keeps the same placement, icon, visual style, and label source.
- Command palette action categories stay as Documents, Products, Other, Payments.
- Dashboard cards and layout are preserved; only invalid quick actions/attention links are hidden.

## Route Protection

Middleware still performs authentication protection for private prefixes, then applies the same route permission model used by the UI.

Denied route examples:

- cashier/staff -> `/products`, `/inventory`, `/reports`;
- manager -> `/settings/users`, `/billing`, `/admin/support`, `/admin/jobs`;
- non-platform owner -> `/platform`;
- non-org owner -> `/settings/diagnostics`.

Denied users redirect to the nearest role home:

- cashier/staff: `/pos`;
- admin/manager: `/dashboard`.

## Command Palette

The palette keeps the existing commands and grouping. It now filters:

- action commands by `permission`;
- global search result links by result type permission.

This prevents hidden navigation from reappearing through command search.

## Remaining Risks

- Some page-level and API-level mutations still use their existing tRPC/API guards. This slice does not redesign every procedure permission; it aligns app-shell visibility and middleware denial with the existing role model.
- Platform owners with non-admin organization roles can access `/platform` through middleware, but the sidebar item remains in its previous admin/platform-owner placement to avoid changing the visible nav IA.
- Cash/cash-shift links are mostly nested under POS in the current UI. This pass does not add new cash navigation entries.

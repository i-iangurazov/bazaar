# Route Protection Audit

## Middleware Finding

Before this pass, `middleware.ts` protected only:

- `/dashboard`
- `/inventory`
- `/purchase-orders`
- `/products`
- `/stores`
- `/reports`
- `/onboarding`
- `/help`
- `/settings`

## Private App Routes Found Under `src/app/(app)`

- `/admin/jobs`
- `/admin/metrics`
- `/admin/support`
- `/billing`
- `/cash`
- `/customers/new`
- `/dashboard`
- `/dev/scanner-test`
- `/finance/expense`
- `/finance/income`
- `/help`
- `/help/compliance`
- `/inventory`
- `/inventory/counts`
- `/onboarding`
- `/operations/integrations`
- `/orders`
- `/platform`
- `/pos`
- `/pos/*`
- `/products`
- `/purchase-orders`
- `/reports`
- `/sales/orders`
- `/settings/*`
- `/stores`
- `/suppliers`

## Public Routes That Must Stay Public

- `/`
- `/login`
- `/signup`
- `/invite`
- `/invite/[token]`
- `/verify/[token]`
- `/reset`
- `/reset/[token]`
- `/register-business/[token]`
- `/c/[slug]`
- static assets
- intentionally public API routes such as auth, public catalog assets, health/metrics if separately secret-gated.

## Required Fix

Expand middleware private prefixes to cover every private app route. Role and permission checks remain server-side in tRPC procedures and page-level logic, but unauthenticated users must not reach private app UI shells.

## Role Gate Notes

- `/platform` uses `platformOwnerProcedure` for data/mutations and should be visible only to platform owners.
- `/admin/support`, `/admin/jobs`, and `/admin/metrics` use `adminProcedure`; support also requires the support toolkit feature.
- `AppShell` currently hides platform nav unless `isPlatformOwner` is true.
- Middleware cannot safely enforce role-specific gates because it only has JWT-level auth, but route tests should prove unauthenticated blocking and server procedure tests should prove role blocking.

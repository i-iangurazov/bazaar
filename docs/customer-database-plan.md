# Customer Database Plan

## Current Implementation Findings

- There is no first-class `Customer` model. Customer data currently lives only on `CustomerOrder` as `customerName`, `customerEmail`, and `customerPhone`.
- `/customers/new` exists only as a placeholder quick-action page. There is no `/customers` customer database page.
- `/customers` is currently guarded by `viewSales` in `src/lib/roleAccess.ts`, which allows staff and cashiers. The new customer database must move to an admin/manager-only permission.
- Customer orders are created from multiple paths:
  - internal sales order flow in `src/server/services/salesOrders.ts`
  - POS sale flow in `src/server/services/pos.ts`
  - public catalogue checkout in `src/server/services/bazaarCatalog.ts`
  - bazaar API orders in `src/server/services/bazaarApi.ts`
- Store scoping helpers already exist in `src/server/services/storeAccess.ts`. New customer procedures should use those helpers, not only organization checks.
- The existing import page at `/settings/import` is product-only. It parses CSV/XLS/XLSX client-side, maps fields, previews rows, and submits product rows through `products.previewImportCsv` and `products.importCsv`.
- Product import server procedures are admin-only. Customer import should be admin/manager-only without weakening product import server access.

## Data Model Proposal

Add a store-scoped customer model:

- `Customer`
  - `id`
  - `organizationId`
  - `storeId`
  - `name`
  - `email`
  - `phone`
  - `address`
  - `source`: `MANUAL`, `IMPORT`, `ORDER`, `INTEGRATION`
  - `metadata`
  - `lastOrderAt`
  - `orderCount`
  - `deletedAt`
  - `emailMarketingUnsubscribedAt`
  - `createdAt`
  - `updatedAt`

Indexes:

- `organizationId, storeId`
- `storeId, email`
- `storeId, phone`
- `storeId, emailMarketingUnsubscribedAt`
- `createdAt`

Duplicate handling should be service-level, not a destructive unique migration. Email and phone are nullable and customers are store-scoped, so the create/update service should match first by normalized email in the same store, then by normalized phone in the same store.

Validation rules:

- `name` is required for manual/import rows.
- At least one of `email` or `phone` is required.
- Email is normalized to lowercase when present.
- Phone is trimmed and compacted using a conservative local normalizer unless a stronger phone utility is introduced.
- Address is optional.
- Existing customer source is preserved when orders update manual/import customers.

## Affected Routes and Files

- `prisma/schema.prisma`
- new Prisma migration under `prisma/migrations`
- `src/server/services/customers.ts`
- `src/server/trpc/routers/customers.ts`
- `src/server/trpc/routers/_app.ts`
- `src/lib/roleAccess.ts`
- `src/components/app-shell.tsx`
- `src/components/command-palette.tsx`
- `src/app/(app)/customers/page.tsx`
- `src/app/(app)/customers/new/page.tsx`
- `src/app/(app)/settings/import/page.tsx`
- `src/server/services/salesOrders.ts`
- `src/server/services/pos.ts`
- `src/server/services/bazaarCatalog.ts`
- `src/server/services/bazaarApi.ts`
- `messages/en.json`
- `messages/ru.json`
- `messages/kg.json`
- `tests/integration/*`
- `tests/unit/*`

## Risks

- `/settings/import` is a large product-import page. The customer import selector must not regress existing product import behavior.
- Staff/cashier roles currently have `viewSales`, so leaving `/customers` on `viewSales` would expose customer data.
- Orders can be updated after draft creation. Customer upsert should run on customer field updates as well as order creation.
- Public catalogue checkout currently requires email and phone, while bazaar API order fields are optional. Auto-create must no-op when both email and phone are missing.
- Duplicate merge logic must not merge across stores.

## Validation Plan

- Add DB-backed tests for manual customer create/list/update/delete and store isolation.
- Add DB-backed tests for customer auto-create from internal orders, public catalogue orders, and bazaar API orders.
- Add import tests for CSV and XLSX customer rows, invalid row skipping, same-store merge, and cross-store isolation.
- Add access tests for admin/manager access and staff/cashier denial.
- Run `pnpm prisma generate`, `pnpm typecheck`, `pnpm lint`, `pnpm i18n:check`, `CI=1 pnpm test`, `pnpm build`, and Prisma migration checks.

## Implemented In This Slice

- Added `Customer` with organization/store ownership, manual/import/order/integration sources, soft delete, metadata, last order timestamp, and order count.
- Added `/customers` as an admin/manager-only page with store selector, search, source filter, server pagination, manual add/edit, and soft delete.
- Added `customers` tRPC router and centralized customer service validation, normalization, same-store dedupe, and store-access checks.
- Added customer import to `/settings/import` with Products/Customers selector, CSV/XLS/XLSX parsing, Name/Email/Phone/Address mapping, preview, row errors, same-store merge, and import batch history.
- Auto-upsert now runs from manual sales order drafts/updates, POS drafts, public catalogue checkout, and bazaar API orders. If both email and phone are missing, no customer is created.
- Staff and cashiers are denied through navigation, route permissions, command palette filtering, and server procedures.
- Validation coverage now includes DB-backed customer CRUD/scope/import/order/email audience tests plus source tests for navigation/import wiring.

## Behavior Summary

- Customers are isolated by store. The same email or phone in two stores creates two customer records.
- Duplicate matching is same-store only: email is checked first, then phone.
- Manual and import flows require a name and at least one of email or phone.
- Order-created customers can fall back to email/phone for name if the order has no customer name.
- Existing manual/import customers keep their source when an order fills missing fields or updates order metrics.

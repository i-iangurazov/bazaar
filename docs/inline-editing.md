# Inline Editing

## Overview

Global inline editing is enabled via shared table cell component:

- `src/components/table/InlineEditableCell.tsx`
- `src/lib/inlineEdit/registry.ts`

Server-side validation and business rules remain authoritative. Client-side logic only parses user input and dispatches existing tRPC mutations.

## Feature flag

Runtime flag:

- `NEXT_PUBLIC_INLINE_EDITING=1` enables inline editing.
- `NEXT_PUBLIC_INLINE_EDITING=0` disables inline editing immediately without code changes.

Fallback default behavior in `src/lib/inlineEdit/featureFlag.ts`:

- Development/staging-like environments (`NODE_ENV !== "production"`): enabled by default.
- Production (`NODE_ENV === "production"`): disabled by default unless explicitly enabled.

## Interaction contract

Desktop:

- Double-click editable cell to enter edit mode.
- `Enter` commits.
- `Esc` cancels.
- `Blur` commits only when value changed and parser succeeds; otherwise closes without save.

Mobile/touch:

- Each editable cell shows a compact edit icon button.
- Tap icon to enter edit mode (no double-click dependency).

All platforms:

- One active editor per table at a time (`InlineEditTableProvider`).
- Save is optimistic in the UI, mutation runs in background, rollback on failure.
- Inline spinner shown while saving.
- Server errors are surfaced via localized toasts (`errors.*`).

## Permissions and RBAC

- Edit permissions are enforced in two layers:
  - UI: registry `permissionCheck` controls edit affordance/read-only rendering.
  - Server: tRPC procedures (`adminProcedure` / `managerProcedure`) enforce RBAC authoritatively.
- If server returns forbidden, the cell rolls back and displays localized permission error.
- Tenant isolation is preserved by existing org-scoped service logic and router checks.

## Supported tables/fields

Inline-enabled fields are documented in `docs/inline-edit-audit.md`.

Currently enabled:

- Products list: `name`, `category`, `salePrice`, `onHandQty` (when store is selected).
- Inventory list: `minStock`.
- Suppliers list: `name`, `email`, `phone`, `notes`.
- Stores list: `name`, `code`, `legalEntityType`, `inn`, `allowNegativeStock`, `trackExpiryLots`.
- Users list: `name`, `email`, `role`, `preferredLocale`, `isActive`.
- Units list: `labelRu`, `labelKg`.

## Cache consistency

Each inline mutation path applies:

1. Optimistic cache patch (`trpcUtils.*.setData`).
2. Mutation call.
3. Rollback on error.
4. Query invalidation on success.

SSE updates remain compatible but are not required for immediate UX feedback.

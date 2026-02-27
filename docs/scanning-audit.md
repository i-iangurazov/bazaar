# Scanning/Search Audit

## Scope map

| Area | File | Input(s) | Current handler(s) | Endpoint(s) | Enter/Blur behavior | Risks |
|---|---|---|---|---|---|---|
| Global app shell scan/search | `src/components/app-shell.tsx` | Header `Input` (`scanValue`) | `onChange` updates local state; `onKeyDown` Enter -> `handleScanSubmit`; `onFocus`/`onBlur` toggles dropdown | `products.lookupScan` (manual `refetch`), `products.searchQuick` (debounced 200ms) | Enter submits. Blur hides results after 150ms timeout. | Mixed live-search + submit logic in one component, duplicated normalization (`trim` only), no Tab-submit support, no shared scanner contract, potential focus loss/race with blur timeout.
| Command panel (Ctrl/Cmd+K) | `src/components/command-palette.tsx` | Palette search `Input` (`query`) | Keyboard handler handles arrows/enter/escape; Enter selects active item or falls back to barcode mutation | `search.global` (>=2 chars), `products.findByBarcode` mutation fallback | Enter selects or barcode lookup. No explicit blur dropdown timeout issue (modal content). | Scanner behavior not unified with app shell, no Tab-submit support, fallback only in command panel, separate normalization (`trim`), scanner suffix config not handled.
| Stock count scan input | `src/app/(app)/inventory/counts/[id]/page.tsx` | Scan `Input` (`scanValue`) | Enter directly calls `stockCounts.addOrUpdateLineByScan` with raw input | `stockCounts.addOrUpdateLineByScan` -> backend resolves barcode/SKU/variant | Enter only. Blur not special. | No Tab-submit support, no shared normalization utility, no multiple-match UI, input state isolated from other scan fields.
| POS sell scan/search | `src/app/(app)/pos/sell/page.tsx` | Product search `Input` (`lineSearch`) + qty input | Keystrokes trigger search list; add line by clicking result (`handleAddLine`) | `products.searchQuick`, `pos.sales.addLine` (+ draft create flow) | Enter is not a dedicated submit path for scanning; blur not used for results in this screen. | Scanner suffix Enter/Tab not first-class, no exact-match priority submit path, potential missed fast scans without explicit submit handling.
| PO line picker (new PO) | `src/app/(app)/purchase-orders/new/page.tsx` | Dialog product search `Input` (`lineSearch`) | Keystrokes update query; click result sets selected product | `products.searchQuick` | Blur hides results after 150ms timeout. | No scanner submit contract, no Tab-submit, duplicated dropdown logic, focus race due blur timeout.
| PO line picker (PO detail) | `src/app/(app)/purchase-orders/[id]/page.tsx` | Dialog product search `Input` (`lineSearch`) | Same as new PO dialog | `products.searchQuick` | Blur hides results after 150ms timeout. | Same as above.
| Sales order line picker (new order) | `src/app/(app)/sales/orders/new/page.tsx` | Draft line search `Input` (`lineSearch`) | Keystrokes query; click result adds draft line | `products.searchQuick`, `sales.orders.createDraft` | Blur hides list after 150ms timeout. | No scanner submit contract, no Tab-submit, duplicated search/select code.
| Sales order line picker (order detail) | `src/app/(app)/sales/orders/[id]/page.tsx` | Modal line search `Input` (`lineSearch`) | Keystrokes query; click result selects product | `products.searchQuick` | No dedicated submit path for scan; focus opens results. | Scanner Enter/Tab behavior not standardized, duplicate selection code.

## Backend audit map

| Endpoint | File | Current behavior | Risks |
|---|---|---|---|
| `products.lookupScan` | `src/server/trpc/routers/products.ts` + `src/server/services/scanLookup.ts` | Trim query; exact barcode -> exact pack barcode -> exact SKU -> fallback by product name contains; returns `{ exactMatch, items }` | Normalization is trim-only; spaces/non-printables not normalized; fallback excludes barcode/SKU contains in list mode.
| `products.findByBarcode` | `src/server/trpc/routers/products.ts` | Trim value; exact `ProductBarcode`; fallback `ProductPack`; org scoped | Normalization trim-only; no shared normalization helper; naming suggests barcode only but command panel uses as generic scanner fallback.
| `products.searchQuick` | `src/server/trpc/routers/products.ts` | OR contains on name/SKU/barcodes/packs; returns top 10 with `isBundle` + `barcodes` | No exact-first optimization path, broad contains query may be slower/noisy for scanner input.
| `stockCounts.addOrUpdateLineByScan` | `src/server/services/stockCounts.ts` | Trim input; exact barcode -> exact SKU -> variant SKU | Uses own normalization path, no shared scanner normalization.

## Current index status

From `prisma/schema.prisma`:
- `ProductBarcode`: `@@unique([organizationId, value])` plus `@@index([organizationId])` and `@@index([productId])`.
- `Product`: `@@unique([organizationId, sku])` plus additional org indexes.

This already provides indexed exact lookup paths for org+barcode and org+sku.

## Initial hardening targets

1. Centralize scanner normalization and submit key handling.
2. Standardize Enter submit + optional Tab submit for keyboard-wedge scanners.
3. Reuse one shared `ScanInput` component across scan/search contexts to remove duplicated key/blur bugs.
4. Keep normal manual typing workflows intact (no per-keystroke auto-submit).
5. Keep tenant scope and RBAC unchanged (all lookups remain org-scoped through current protected procedures).

## Implemented hardening summary

- Shared scanner utilities:
  - `src/lib/scanning/normalize.ts`
  - `src/lib/scanning/scanRouter.ts`
- Shared scanner input component:
  - `src/components/ScanInput.tsx`
- Contexts migrated to shared scanner input:
  - Global header (`src/components/app-shell.tsx`)
  - Command panel input (`src/components/command-palette.tsx`)
  - Stock count scan (`src/app/(app)/inventory/counts/[id]/page.tsx`)
  - POS sell scan/search (`src/app/(app)/pos/sell/page.tsx`)
  - Line pickers (`src/app/(app)/purchase-orders/new/page.tsx`, `src/app/(app)/purchase-orders/[id]/page.tsx`, `src/app/(app)/sales/orders/new/page.tsx`, `src/app/(app)/sales/orders/[id]/page.tsx`)
- Backend lookup/search hardening:
  - `products.findByBarcode` now uses shared normalization and exact barcode/pack/SKU resolution.
  - `products.searchQuick` now prioritizes exact barcode and exact SKU before fuzzy matches, still org-scoped, and returns compact UI fields (`id`, `name`, `sku`, `type`, `primaryImage`).
  - `lookupScan` service uses shared normalization and returns consistent typed items.
- Dev diagnostics route:
  - `src/app/(app)/dev/scanner-test/page.tsx`
  - `src/app/(app)/dev/scanner-test/scanner-test-client.tsx`
  - Enabled only when `NODE_ENV !== \"production\"`.

## QA checklist (real scanner)

1. Scan known barcode with leading zeros -> correct product/context action.
2. Scan unknown barcode -> not-found toast + create CTA (where permitted).
3. Scan exact SKU -> correct product/context action.
4. Rapidly scan 10 items -> focus stays stable, no dropped submits.
5. Tab-terminating scanner works when Tab-submit is enabled.
6. Validate in contexts:
- global header
- stock count
- POS sell
- command panel
- line picker dialogs (orders/PO)

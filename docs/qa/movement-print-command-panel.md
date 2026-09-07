# Movement printing and Command Panel audit — 7 September 2026

Scope: print presentation and command navigation. No database migrations or inventory, cost, valuation, quantity or total calculations were changed. The working tree was clean before this work, on `main`.

## Print findings and fixes

The dark frame was reproduced in Chromium with the actual shared print component, root-layout classes and compiled application CSS. In dark mode, `src/app/globals.css` sets `color-scheme: dark`. The previous print styles whitened `html`/`body` but retained that color scheme. With Background graphics enabled, Chromium painted the **page canvas outside the body** `#121212`, including the 12 mm A4 margins. PDF inspection found a full-page dark fill and `(18,18,18)` corner pixels. Light mode and Background graphics disabled did not produce that frame.

The gray table header was an explicit `#f3f4f6` background, preserved by `print-color-adjust: exact`. Print styles now select a light color scheme, white backgrounds and black text, remove shadows and exclude application chrome/portals outside the document. Normal screen dark mode is unchanged. Thin table borders and signature lines remain.

The toolbar is sticky on screen and was already hidden when printing. No separate duplicated sticky header or horizontal overlay was reproduced in the baseline PDFs. The corrected template explicitly makes table elements static, removes print overflow constraints, repeats the ordinary table header, and keeps rows and signature blocks together. PDF checks reject horizontal rules crossing text, missing/duplicated rows and content outside A4 margins. Checks include printing after scrolling and an extraneous fixed element outside the document.

SKU/barcode metadata is removed only from this print component. Product names, variants, units, quantities, displayed prices, totals, metadata and signatures remain. Cell padding is reduced from 2.2 mm vertically to 1 mm. An additional cause of tall rows was the global `td { @apply text-sm }` rule: its 14 px font / 20 px line height overrode the print table's inherited typography. Cells now explicitly inherit the print font and use a 1.2 line height. The 90-product receiving sample fell from **7 to 3 A4 pages**.

All supported movement print entry points use `canPrintMovementDocument` and the same `MovementPrintDocument`: receiving (`STOCK_RECEIVING`), legacy receipts (`RECEIVE`), transfers, write-offs and adjustments. Adjustment print access is now consistent in the journal, detail page and print endpoint, with an adjustment title/reference and store label. Other document families with different contracts, such as sales, returns and purchase orders, are not routed through this template. No second movement print template was found.

## Complete command mapping

Routes below omit optional supported store context. A = ADMIN, M = MANAGER, S = STAFF, C = CASHIER.

| Command | Previous destination | Canonical destination | Roles |
| --- | --- | --- | --- |
| Продажа | `/pos/sell` | `/pos/sell` | A M S C |
| Возврат продажи | `/pos/history` | `/pos/history` | A M S C |
| Оприходование | `/inventory?action=receive` | `/inventory/receiving` | A M |
| Списание | `/inventory?action=adjust` | `/inventory/write-offs` | A M |
| Инвентаризация | `/inventory/counts/new` → bare list | `/inventory/counts?create=1` → creation dialog | A M |
| Перемещение | `/inventory?action=transfer` | `/inventory/transfers` | A M |
| Товар | `/products/new?type=product` | `/products/new?type=product` | A M |
| Набор | `/products/new?type=bundle` | `/products/new?type=bundle` | A M |
| Клиент | `/customers?add=1` | `/customers?add=1` | A M |
| Поставщик | `/suppliers/new` → redirect | `/suppliers?create=1` | A M |
| Сотрудник | `/settings/users?create=1` | `/settings/users?create=1` | A |
| Магазин | `/stores/new` → redirect | `/stores?create=1` | A M |
| BAAM | `/baam` | `/baam` | A M |
| Касса | `/pos/shifts#cash-movement` | `/pos/shifts#cash-movement` | A M S C |
| Приход | `/pos/shifts?cashMovementType=PAY_IN#cash-movement` | Same | A M S C |
| Расход | `/pos/shifts?cashMovementType=PAY_OUT#cash-movement` | Same | A M S C |

Sales returns start in sale history because a sale must be selected first. Cash movements retain the existing active-register/shift prerequisites; navigation tests do not open shifts or record cash movements.

| Search result / other item | Previous destination | Canonical destination | Roles |
| --- | --- | --- | --- |
| Product, including barcode lookup | `/products/{id}` | Same, with encoded ID | A M C |
| Supplier | `/suppliers` | `/suppliers?q={supplier name}` | A M |
| Store | `/stores` | `/stores` (no generic store-detail route exists) | A M |
| Purchase order | `/purchase-orders/{id}` | Same, with encoded ID | A M |
| Recent search | `#` placeholder | Fills the search field; does not navigate | Current session's saved searches |

`appRoutes` and `appLinks` now supply the sidebar, command destinations, search results, cash-link helper and creation-route aliases. The panel no longer carries its own URLs. Its 16 actions preserve their labels, icons, grouping and order. Missing sessions have no navigable actions; role permissions are checked when displaying and selecting items, and again after asynchronous barcode lookup. Server authorization remains in place.

Only supported context is forwarded: `storeId` to product/bundle creation, customer creation, write-offs and counts; `fromStoreId` to transfers. Organization, warehouse and unrelated action parameters are dropped. Receiving does not accept arbitrary store context outside its specific draft-return flow, so none is forwarded. Count creation waits for an authorized store and consumes `create=1` so closing/reloading does not reopen the form. The legacy count alias redirects after hydration to avoid a reproducible App Router hook-count failure from its streamed server redirect. The count page waits for the canonical path and consumes the creation flag with native history synchronization. Existing supplier/store aliases remain compatible.

## Verification and reproduction

Local evidence is in `artifacts/movement-print-command/20260907/` (ignored, excluded from deployment). Unit checks cover print metadata preservation, all 16 canonical destinations against actual router files, all four roles, lookup destinations, context handling and existing navigation/icon behavior. The targeted local run passed **80 tests in 13 files**, plus TypeScript, ESLint and three-language translation checks.

The print matrix covers five movement types × two themes × two Background graphics settings, with 90 synthetic products, long names and variants. All **20 PDFs / 60 pages** passed text, geometry, color and pixel checks; theme/background variants render identically. First, middle and final PDF pages are available as PNGs for visual review. A short three-product document also stayed on one page in all four print combinations. Physical printers and other browser engines were not tested.

The browser navigation runner uses real local authentication and the disposable PostgreSQL/Redis environment. It exercises visible commands and creation dialogs for each role, checks URL/context handling and count-dialog refresh behavior. It blocks external traffic and operational writes; only authentication and tutorial preference synchronization are permitted. No operational form is submitted. The final run passed **43 browser checks** (41 role/action clicks plus alias and refresh checks), with no runtime errors or blocked operational writes. Search service integration assertions also verify the updated supplier destination against real test records.

```sh
# Pure unit checks must not reset a database.
SKIP_DB_TESTS=1 RUN_DB_TESTS=0 pnpm exec vitest run tests/unit/command-palette-routes.test.ts tests/unit/movement-print-document.test.tsx

# Full browser navigation: prepare the disposable environment as documented in docs/stabilization.md,
# keep `pnpm dev:stabilization` running on localhost:3108, then:
pnpm exec playwright install chromium
pnpm test:browser:print-navigation
python3 -m pip install PyMuPDF==1.26.5
python3 scripts/qa/verify-movement-pdfs.py artifacts/movement-print-command/latest

# Standalone CI print matrix; no application server, account or database is required.
pnpm exec tailwindcss -i src/app/globals.css -o /tmp/bazaar-print.css
QA_PRINT_ONLY=1 QA_PRINT_CSS=/tmp/bazaar-print.css pnpm test:browser:print-navigation
python3 scripts/qa/verify-movement-pdfs.py artifacts/movement-print-command/latest
```

`QA_BROWSER_CHANNEL=chrome` uses an installed Chrome browser. `QA_OUTPUT_DIR` selects the evidence directory. `QA_NAVIGATION_ONLY=1` runs only the authenticated navigation portion. CI runs the standalone PDF matrix and uploads its evidence as `movement-print-regression`; it is part of the existing required test job and deployment release gate.

## Changed files

- Print: `src/components/inventory/movement-print-document.tsx`, `src/lib/movementPrint.ts`, `src/app/inventory/movements/[id]/print/page.tsx`, `src/app/(app)/inventory/movements/page.tsx`, `src/app/(app)/inventory/movements/[id]/page.tsx`.
- Navigation: `src/lib/appRoutes.ts`, `src/lib/commandPaletteNavigation.ts`, `src/lib/posCashMovementRoute.ts`, `src/components/command-palette.tsx`, `src/components/app-shell.tsx`, `src/server/services/search/global.ts`, `src/app/(app)/inventory/counts/page.tsx`, and the `inventory/counts/new`, `suppliers/new`, `stores/new` route aliases.
- Regression coverage: `tests/helpers/movementPrintFixture.ts`, `tests/unit/movement-print-document.test.tsx`, `tests/unit/command-palette-routes.test.ts`, `tests/unit/command-palette-navigation-source.test.ts`, `tests/unit/product-movements-source.test.ts`, `tests/unit/mobile-shell-source.test.ts`, `tests/integration/search.test.ts`, `scripts/qa/print-and-command-panel.tsx`, `scripts/qa/verify-movement-pdfs.py`.
- Test tooling/evidence: `.github/workflows/ci.yml`, `.gitignore`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, this audit.

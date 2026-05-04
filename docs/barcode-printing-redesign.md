# Barcode and Price Tag Printing Redesign

## Current State

- Product list, product detail, and inventory selected-label primary print actions now use the saved store print profile and start printing immediately.
- The full print settings/editing experience lives under store hardware settings, with an additional settings entry at `/settings/printing`.
- The legacy advanced Products print modal is isolated behind a dev-only seed hook, `window.__seedLegacyProductsPrintModalQueue`, and is not opened by normal Products or Inventory UI actions.
- The legacy Inventory print modal is behind a dev-only guard and has no user-facing opener; normal inventory print uses saved-profile quick print.
- Store hardware settings persist printer mode, printer models, connector device, template, default copies, label dimensions, display toggles, margins, and roll calibration in `StorePrinterSettings`.
- The PDF route persists roll calibration only when printing the roll template with a selected store.

## Problems Fixed In The UX Slice

- Fast product-list printing is no longer mixed with setup.
- Product detail primary printing no longer bypasses saved print defaults.
- Product list/detail quick print no longer opens the full settings modal when a saved profile exists.
- Inventory quick print no longer opens the full settings modal when a saved profile exists.
- If a store has no saved print profile row, Products and Inventory show a first-time setup prompt instead of the full print settings form.
- Non-KGS store currency is used in label preview/PDF formatting; the preview no longer falls back to a KGS-looking sample when no store currency is available.

## Remaining Problems

- The legacy product print modal still exists for a dev-only stress/fallback hook and contains advanced settings UI; it should eventually be removed or converted into a true settings-only surface.
- The legacy inventory print modal still exists behind a dev-only guard for short-term rollback safety but has no user-facing opener.
- Existing stores with an older `StorePrinterSettings` row receive migrated label defaults and therefore count as having a saved profile. This is safe for fast printing, but it may not force a first-time setup prompt for stores that previously configured only receipt printing.

## Target Flow

1. One-time setup in a store hardware / print settings area:
   - label type;
   - paper size/mode;
   - label width/height;
   - margins/roll calibration;
   - barcode type;
   - show product name, price, SKU, store/company name;
   - default copies;
   - default template;
   - PDF/connector print mode.
2. Fast print from products list, product detail, and bulk selection:
   - uses saved defaults;
   - no full settings modal;
   - warns only on blocking data issues;
   - offers a secondary "Change print settings" action.
3. Preview/test print lives in settings, not in the fast path.

## Implemented Flow

- Product list bulk action `Print labels` calls the quick-print path.
- Product list row action `Print labels` calls the same quick-print path.
- Product detail primary `Print labels` calls the quick-print path.
- Inventory selected bulk action `Print selected` calls the same saved-profile quick-print decision path.
- Explicit settings actions route to `/stores/[id]/hardware` when a store is known, otherwise to `/settings/printing`.
- Missing saved profile opens a first-time setup prompt with a single primary action to configure printing.
- Saved default copies, template, dimensions, roll calibration, and display toggles are used when generating the PDF.
- Missing barcode remains blocked by the PDF route unless the legacy advanced form explicitly allows printing without barcodes.
- Quick print shows success/error toasts and includes a secondary "Change print settings" action after success.

## Validation Coverage

- `tests/unit/label-print-flow.test.ts` covers saved profile quick print, missing profile setup, explicit settings, loading state, saved copies, and safe fallback defaults.
- `tests/unit/print-flow-source.test.ts` verifies inventory and product primary print actions do not expose the legacy settings modal.
- `tests/unit/price-tags-pdf.test.ts` covers non-KGS currency formatting for label PDFs.

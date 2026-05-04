# Barcode and Price Tag Printing Redesign

## Current State

- Product list printing opens a large modal with selected count, store, copies, advanced roll dimensions, barcode confirmation, preview, queue, print, and download.
- Product detail quick print hardcodes the roll template and default dimensions.
- Store hardware settings already persist printer mode, printer models, connector device, and roll calibration offsets/gap in `StorePrinterSettings`.
- The PDF route persists roll calibration only when printing the roll template with a selected store.

## Problems

- Fast printing is mixed with setup, so users must repeatedly review settings.
- The product detail flow bypasses saved print defaults.
- The print settings schema does not cover label template, label type, show/hide fields, paper mode, default copies, or last printed timestamp.
- Warnings exist for missing barcode/price but are coupled to the print modal instead of a preflight-like fast flow.

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

## Implementation Approach

- Extend `StorePrinterSettings` only if needed for durable profile fields.
- Reuse existing `/api/price-tags/pdf` generation and `StorePrinterSettings` architecture.
- Keep connector/PDF behavior stable.
- Keep missing barcode and missing price protection on the server.
- Add tests around saved profile behavior and fast print request payloads.

## First Pass

The first implementation pass should add profile fields to `StorePrinterSettings`, expose them through the stores hardware tRPC router, use them in product list/detail print flows, and keep the existing advanced modal accessible as "Change print settings."

# Price Tags PDF

## Output
- Endpoint: `POST /api/price-tags/pdf`
- Content type: `application/pdf`
- Templates: `3x8` and `2x5` A4 label sheets.

## Layout Rules
- Blocks are fixed to prevent overlap:
1. Product name (max 2 lines with truncation)
2. Price line
3. Meta lines (SKU + optional store)
4. Barcode image area
5. Barcode value/fallback line
- Long text is truncated with ellipsis based on measured width.

## Barcode Behavior
- Barcode bars are rendered with `bwip-js` as real machine-readable bars.
- `EAN-13` is preferred when possible; otherwise `CODE-128`.
- Barcode value is printed below bars.
- If barcode is missing or rendering fails, localized fallback text is shown (`No barcode`), no garbage glyphs.

## Price Fallback
- If price is missing, localized fallback (`Price not set`) is rendered while layout stays stable.

## Fonts / Cyrillic
- PDF uses embedded Unicode font (`assets/fonts/NotoSans-Regular.ttf`, fallback to `ArialUnicode.ttf`) for Cyrillic-safe rendering.

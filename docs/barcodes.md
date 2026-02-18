# Barcodes

## Primary Barcode Selection
- Product can store multiple barcodes in `ProductBarcode`.
- For printing/scan-first flows the system picks:
1. First barcode that can be rendered as `EAN-13`.
2. Otherwise first non-empty barcode (rendered as `CODE-128`).

## Render Type Rules
- `EAN-13` is used when value is:
  - valid 13-digit EAN with correct check digit, or
  - 12 digits (check digit is calculated automatically for rendering).
- `CODE-128` is used for all other values (letters/mixed formats/internal codes).

## Barcode Generator
- Single: `products.generateBarcode`.
- Bulk: `products.bulkGenerateBarcodes`.
- Modes:
  - `EAN13`: internal 13-digit code with valid check digit.
  - `CODE128`: internal alphanumeric code (`BZ...`).
- Uniqueness is enforced per organization by DB unique constraint on `ProductBarcode(organizationId, value)`.
- Existing product barcodes are never overwritten by bulk generation; products with barcodes are skipped.

## Limitations
- Generated EANs are internal and **not GS1 registered**.
- Symbology metadata is not stored separately in DB; render type is derived from value at runtime.

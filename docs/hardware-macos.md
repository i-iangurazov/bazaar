# Hardware QA Checklist (macOS)

## Devices
- Barcode scanner: Zebra DS22 (USB keyboard wedge).
- Receipt printer: Xprinter XP-P501A (58mm, USB/Bluetooth, ESC/POS target).
- Label printer: Xprinter XP-365B (USB, 20-82mm rolls, 203dpi).

## 1. Zebra DS22 Pairing Check
1. Connect scanner by USB.
2. Open Notes on macOS.
3. Scan a known barcode.
4. Confirm text appears instantly and submits with Enter/Tab suffix.
5. Confirm leading zeros are preserved (example: `000123`).

## 2. XP-P501A Basic Check
1. Pair via Bluetooth (or connect USB).
2. Verify printer appears in macOS Printers.
3. Load 58mm receipt paper and run feed test.
4. From Bazaar, open POS receipt PDF and click Print.
5. In print dialog, confirm correct device and paper width/scale.

## 3. XP-365B Basic Check
1. Connect via USB and install driver if required.
2. Verify printer appears in macOS Printers.
3. Load label roll (20-82mm) and calibrate media in driver utility.
4. From Bazaar, open labels PDF and click Print.
5. Confirm no clipping/overlap and barcode scans correctly.

## 4. Bazaar End-to-End Flow
1. Scan item in POS sell screen.
2. Add to cart and complete sale.
3. Download and print receipt PDF.
4. Open products/inventory price-tag print flow.
5. Download and print labels PDF.

## 5. Scanner Test Page (Dev)
- Path: `/dev/scanner-test`.
- Access: ADMIN only, non-production only.
- Verify raw input, normalized value, and match result.

## 6. Expected Fail-Safes
- If connector print mode is selected without a paired device, Bazaar returns a clean localized error.
- If connector mode is enabled with pairing, endpoint remains stubbed until connector daemon rollout.

UPDATE "StorePrinterSettings"
SET
  "receiptPrintProvider" = 'DISABLED',
  "labelPrintProvider" = 'DISABLED',
  "receiptAutoPrintEnabled" = false,
  "receiptPrintMode" = 'PDF',
  "labelPrintMode" = 'PDF'
WHERE
  "receiptPrintProvider" = 'LOCAL_PRINT_AGENT'
  OR "labelPrintProvider" = 'LOCAL_PRINT_AGENT';

ALTER TABLE "StorePrinterSettings"
  ALTER COLUMN "receiptPrintProvider" SET DEFAULT 'DISABLED',
  ALTER COLUMN "labelPrintProvider" SET DEFAULT 'DISABLED';

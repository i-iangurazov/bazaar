ALTER TABLE "FiscalReceipt"
  ADD COLUMN IF NOT EXISTS "kkmFactoryNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "kkmRegistrationNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "fiscalModeStatus" "PosKkmStatus",
  ADD COLUMN IF NOT EXISTS "upfdOrFiscalMemory" TEXT,
  ADD COLUMN IF NOT EXISTS "qrPayload" TEXT,
  ADD COLUMN IF NOT EXISTS "fiscalizedAt" TIMESTAMP(3);

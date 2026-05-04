-- Backfill immutable display-currency snapshots from the current store setting.
-- Snapshot columns intentionally remain nullable so legacy/imported rows can still fall back safely.

UPDATE "PurchaseOrder" po
SET
  "currencyCode" = s."currencyCode",
  "currencyRateKgsPerUnit" = s."currencyRateKgsPerUnit"
FROM "Store" s
WHERE po."storeId" = s.id
  AND po."currencyCode" IS NULL;

UPDATE "CustomerOrder" co
SET
  "currencyCode" = s."currencyCode",
  "currencyRateKgsPerUnit" = s."currencyRateKgsPerUnit"
FROM "Store" s
WHERE co."storeId" = s.id
  AND co."currencyCode" IS NULL;

UPDATE "RegisterShift" rs
SET
  "currencyCode" = s."currencyCode",
  "currencyRateKgsPerUnit" = s."currencyRateKgsPerUnit"
FROM "Store" s
WHERE rs."storeId" = s.id
  AND rs."currencyCode" IS NULL;

UPDATE "SaleReturn" sr
SET
  "currencyCode" = COALESCE(co."currencyCode", s."currencyCode"),
  "currencyRateKgsPerUnit" = COALESCE(co."currencyRateKgsPerUnit", s."currencyRateKgsPerUnit")
FROM "CustomerOrder" co
JOIN "Store" s ON s.id = co."storeId"
WHERE sr."originalSaleId" = co.id
  AND s.id = sr."storeId"
  AND sr."currencyCode" IS NULL;

UPDATE "SalePayment" sp
SET
  "currencyCode" = COALESCE(co."currencyCode", rs."currencyCode", s."currencyCode"),
  "currencyRateKgsPerUnit" = COALESCE(
    co."currencyRateKgsPerUnit",
    rs."currencyRateKgsPerUnit",
    s."currencyRateKgsPerUnit"
  )
FROM "CustomerOrder" co, "RegisterShift" rs, "Store" s
WHERE sp."customerOrderId" = co.id
  AND rs.id = sp."shiftId"
  AND s.id = sp."storeId"
  AND sp."currencyCode" IS NULL;

UPDATE "CashDrawerMovement" cdm
SET
  "currencyCode" = COALESCE(rs."currencyCode", s."currencyCode"),
  "currencyRateKgsPerUnit" = COALESCE(rs."currencyRateKgsPerUnit", s."currencyRateKgsPerUnit")
FROM "RegisterShift" rs
JOIN "Store" s ON s.id = rs."storeId"
WHERE cdm."shiftId" = rs.id
  AND s.id = cdm."storeId"
  AND cdm."currencyCode" IS NULL;

UPDATE "FiscalReceipt" fr
SET
  "currencyCode" = COALESCE(co."currencyCode", s."currencyCode"),
  "currencyRateKgsPerUnit" = COALESCE(co."currencyRateKgsPerUnit", s."currencyRateKgsPerUnit")
FROM "CustomerOrder" co
JOIN "Store" s ON s.id = co."storeId"
WHERE fr."customerOrderId" = co.id
  AND s.id = fr."storeId"
  AND fr."currencyCode" IS NULL;

UPDATE "RefundRequest" rr
SET
  "currencyCode" = COALESCE(sr."currencyCode", co."currencyCode", s."currencyCode"),
  "currencyRateKgsPerUnit" = COALESCE(
    sr."currencyRateKgsPerUnit",
    co."currencyRateKgsPerUnit",
    s."currencyRateKgsPerUnit"
  )
FROM "SaleReturn" sr
JOIN "CustomerOrder" co ON co.id = sr."originalSaleId"
JOIN "Store" s ON s.id = sr."storeId"
WHERE rr."saleReturnId" = sr.id
  AND rr."originalSaleId" = co.id
  AND rr."storeId" = s.id
  AND rr."currencyCode" IS NULL;

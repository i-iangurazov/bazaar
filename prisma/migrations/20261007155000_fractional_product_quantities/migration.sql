-- Preserve existing quantities while allowing physical quantities to three decimals.
ALTER TABLE "Unit" ADD COLUMN "quantityPrecision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_quantityPrecision_check" CHECK ("quantityPrecision" IN (0, 3));
UPDATE "Unit" SET "quantityPrecision" = 3 WHERE LOWER("code") IN ('kg', 'g', 'l', 'm', 'кг', 'г', 'л', 'м', 'kilogram', 'gram', 'liter', 'litre', 'meter', 'metre') OR LOWER("labelRu") IN ('кг', 'г', 'л', 'м', 'килограмм', 'грамм', 'литр', 'метр');
ALTER TABLE "InventorySnapshot" ALTER COLUMN "onHand" TYPE DOUBLE PRECISION USING "onHand"::DOUBLE PRECISION;
ALTER TABLE "InventorySnapshot" ALTER COLUMN "onOrder" TYPE DOUBLE PRECISION USING "onOrder"::DOUBLE PRECISION;
ALTER TABLE "StockMovement" ALTER COLUMN "qtyDelta" TYPE DOUBLE PRECISION USING "qtyDelta"::DOUBLE PRECISION;
ALTER TABLE "PurchaseOrderLine" ALTER COLUMN "qtyOrdered" TYPE DOUBLE PRECISION USING "qtyOrdered"::DOUBLE PRECISION;
ALTER TABLE "PurchaseOrderLine" ALTER COLUMN "qtyReceived" TYPE DOUBLE PRECISION USING "qtyReceived"::DOUBLE PRECISION;
ALTER TABLE "CustomerOrderLine" ALTER COLUMN "qty" TYPE DOUBLE PRECISION USING "qty"::DOUBLE PRECISION;
ALTER TABLE "SaleReturnLine" ALTER COLUMN "qty" TYPE DOUBLE PRECISION USING "qty"::DOUBLE PRECISION;
ALTER TABLE "ReorderPolicy" ALTER COLUMN "minStock" TYPE DOUBLE PRECISION USING "minStock"::DOUBLE PRECISION;
ALTER TABLE "ReorderPolicy" ALTER COLUMN "minOrderQty" TYPE DOUBLE PRECISION USING "minOrderQty"::DOUBLE PRECISION;
ALTER TABLE "StockCountLine" ALTER COLUMN "expectedOnHand" TYPE DOUBLE PRECISION USING "expectedOnHand"::DOUBLE PRECISION;
ALTER TABLE "StockCountLine" ALTER COLUMN "countedQty" TYPE DOUBLE PRECISION USING "countedQty"::DOUBLE PRECISION;
ALTER TABLE "StockCountLine" ALTER COLUMN "deltaQty" TYPE DOUBLE PRECISION USING "deltaQty"::DOUBLE PRECISION;
ALTER TABLE "ProductCost" ALTER COLUMN "costBasisQty" TYPE DOUBLE PRECISION USING "costBasisQty"::DOUBLE PRECISION;
ALTER TABLE "ProductBundleComponent" ALTER COLUMN "qty" TYPE DOUBLE PRECISION USING "qty"::DOUBLE PRECISION;
ALTER TABLE "StockLot" ALTER COLUMN "onHandQty" TYPE DOUBLE PRECISION USING "onHandQty"::DOUBLE PRECISION;

-- Provide common measured units without replacing any organization-specific unit.
INSERT INTO "Unit" ("id", "organizationId", "code", "labelRu", "labelKg", "quantityPrecision", "createdAt", "updatedAt")
SELECT 'unit_' || md5(o.id || unit.code), o.id, unit.code, unit.code, unit.code, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization" o CROSS JOIN (VALUES ('кг', 'kg'), ('г', 'g'), ('л', 'l'), ('м', 'm')) AS unit(code, alias)
WHERE NOT EXISTS (SELECT 1 FROM "Unit" existing WHERE existing."organizationId" = o.id AND (LOWER(existing.code) IN (unit.code, unit.alias) OR LOWER(existing."labelRu") = unit.code));

-- New product cards must still default to pieces, including organizations without prior units.
INSERT INTO "Unit" ("id", "organizationId", "code", "labelRu", "labelKg", "quantityPrecision", "createdAt", "updatedAt")
SELECT 'unit_' || md5(o.id || 'шт'), o.id, 'шт', 'шт', 'даана', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization" o
WHERE NOT EXISTS (SELECT 1 FROM "Unit" existing WHERE existing."organizationId" = o.id AND (LOWER(existing.code) IN ('шт', 'шт.', 'each', 'pcs', 'piece', 'pc', 'штука') OR LOWER(existing."labelRu") IN ('шт', 'шт.', 'штука', 'штук')));

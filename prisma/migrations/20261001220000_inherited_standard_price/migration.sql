-- A row containing only extra price types must not override the inherited standard price.
ALTER TABLE "StorePrice" ALTER COLUMN "priceKgs" DROP NOT NULL;
-- Earlier drafts have no reliable provenance for manual edits. Preserve their quoted prices.
UPDATE "CustomerOrderLine" l SET "manualPrice" = true, "priceSource" = 'MANUAL'
FROM "CustomerOrder" o WHERE o.id = l."customerOrderId" AND o.status = 'DRAFT'
AND l."priceSource" = 'STANDARD';

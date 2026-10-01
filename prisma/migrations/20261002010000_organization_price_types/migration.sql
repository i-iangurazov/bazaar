BEGIN;

ALTER TABLE "Organization" ADD COLUMN "retailWholesaleEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Preserve an existing opt-in when moving the setting to the organization.
UPDATE "Organization" AS organization
SET "retailWholesaleEnabled" = true
WHERE EXISTS (
  SELECT 1 FROM "Store" AS store
  WHERE store."organizationId" = organization.id AND store."retailWholesaleEnabled"
);

-- Keep the old column readable during deployment and rollback. Price rows stay intact.
UPDATE "Store" AS store
SET "retailWholesaleEnabled" = organization."retailWholesaleEnabled"
FROM "Organization" AS organization
WHERE store."organizationId" = organization.id
  AND store."retailWholesaleEnabled" IS DISTINCT FROM organization."retailWholesaleEnabled";

CREATE FUNCTION bazaar_store_inherit_price_types() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT "retailWholesaleEnabled" INTO NEW."retailWholesaleEnabled"
  FROM "Organization" WHERE id = NEW."organizationId";
  RETURN NEW;
END;
$$;

CREATE TRIGGER bazaar_store_inherit_price_types
BEFORE INSERT OR UPDATE OF "retailWholesaleEnabled", "organizationId" ON "Store"
FOR EACH ROW EXECUTE FUNCTION bazaar_store_inherit_price_types();

CREATE FUNCTION bazaar_organization_sync_price_types() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Store" SET "retailWholesaleEnabled" = NEW."retailWholesaleEnabled"
  WHERE "organizationId" = NEW.id
    AND "retailWholesaleEnabled" IS DISTINCT FROM NEW."retailWholesaleEnabled";
  RETURN NEW;
END;
$$;

CREATE TRIGGER bazaar_organization_sync_price_types
AFTER UPDATE OF "retailWholesaleEnabled" ON "Organization"
FOR EACH ROW WHEN (OLD."retailWholesaleEnabled" IS DISTINCT FROM NEW."retailWholesaleEnabled")
EXECUTE FUNCTION bazaar_organization_sync_price_types();

COMMIT;

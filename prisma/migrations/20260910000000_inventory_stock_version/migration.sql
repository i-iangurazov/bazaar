ALTER TABLE "InventorySnapshot" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

-- Cover every writer, including imports, initial stock and maintenance tools.
-- A quantity changed and later restored must still invalidate an open editor.
CREATE FUNCTION inventory_snapshot_stock_version() RETURNS trigger AS $$
BEGIN
  IF NEW."onHand" IS DISTINCT FROM OLD."onHand" THEN
    NEW."version" := OLD."version" + 1;
  ELSE
    NEW."version" := OLD."version";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER inventory_snapshot_stock_version
BEFORE UPDATE ON "InventorySnapshot"
FOR EACH ROW EXECUTE FUNCTION inventory_snapshot_stock_version();

CREATE UNIQUE INDEX IF NOT EXISTS "RegisterShift_registerId_open_unique_idx"
  ON "RegisterShift" ("registerId")
  WHERE "status" = 'OPEN';

// Fixed disposable environment only. Verify that offline benchmarks left no DB changes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
const organizationId = "photo-search-browser-qa";
assert.match(await readFile(".local/product-photo-search/DISPOSABLE-TEST-ONLY", "utf8"), /^Disposable (?:internal product photo search|China image search) QA; no customer records\n$/);
const input = JSON.parse(await readFile(".local/elfbar-model-comparison/frozen-inputs.json", "utf8"));
assert.equal(input.calibration.storeId, "photo-search-browser-shop");
assert.equal(input.test.storeId, "photo-search-field-shop");
const db = new PrismaClient({ datasourceUrl: "postgresql://bazaar_test@127.0.0.1:55991/bazaar_hardening_agent4_platform" });
try {
  const [identity] = await db.$queryRaw`SELECT current_database() AS database,current_user AS username,inet_server_port() AS port`;
  assert.deepEqual(identity, { database: "bazaar_hardening_agent4_platform", username: "bazaar_test", port: 55991 });
  const snapshot = { products: await db.product.findMany({ where: { organizationId }, orderBy: { id: "asc" }, include: { images: { orderBy: { id: "asc" } }, storeProducts: { orderBy: { storeId: "asc" } } } }), features: await db.productPhotoFeature.findMany({ where: { organizationId }, orderBy: { id: "asc" } }) };
  assert.equal(createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"), input.catalogHash, "Catalog or feature cache changed");
  console.log(JSON.stringify({ catalogAndFeatureCacheUnchanged: true, databaseWrites: false }));
} finally { await db.$disconnect(); }

// Read-only export of two explicitly isolated shops. No provider or application writes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";

const root = resolve(".local/elfbar-model-comparison"), organizationId = "photo-search-browser-qa";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (bytes) => sharp(bytes, { pages: 1, limitInputPixels: 40_000_000 }).rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).flatten({ background: "white" }).jpeg({ quality: 90 }).toBuffer();
const fieldBytes = await readFile("scripts/qa/fixtures/elfbar-photo-field.json"), field = JSON.parse(fieldBytes);
const oldBytes = await readFile("scripts/qa/fixtures/elfbar-photo-search.json"), old = JSON.parse(oldBytes);
const baseline = JSON.parse(await readFile("docs/benchmarks/product-photo-misses-20261114/approved38-results.json"));
const hardIds = baseline.results.filter((row) => row.mode === "auto" && row.expectedId && !row.multiObject && !row.items.length).map((row) => row.query);
assert.equal(hardIds.length, 8); assert.equal(hash(fieldBytes), baseline.manifestSha256);
assert.match(await readFile(".local/product-photo-search/DISPOSABLE-TEST-ONLY", "utf8"), /^Disposable (?:internal product photo search|China image search) QA; no customer records\n$/);
const db = new PrismaClient({ datasourceUrl: "postgresql://bazaar_test@127.0.0.1:55991/bazaar_hardening_agent4_platform" });
await mkdir(`${root}/images`, { recursive: true });
async function cache(name, bytes) {
  const file = `${root}/images/${name}.jpg`; await writeFile(file, bytes);
  return { file: relative(root, file), sha256: hash(bytes) };
}
try {
  const [identity] = await db.$queryRaw`SELECT current_database() AS database,current_user AS username,inet_server_port() AS port`;
  assert.deepEqual(identity, { database: "bazaar_hardening_agent4_platform", username: "bazaar_test", port: 55991 });
  const snapshot = async () => ({ products: await db.product.findMany({ where: { organizationId }, orderBy: { id: "asc" }, include: { images: { orderBy: { id: "asc" } }, storeProducts: { orderBy: { storeId: "asc" } } } }), features: await db.productPhotoFeature.findMany({ where: { organizationId }, orderBy: { id: "asc" } }) });
  const before = hash(JSON.stringify(await snapshot()));
  async function scope(storeId, expectedPhotos) {
    assert.equal((await db.store.findUniqueOrThrow({ where: { id: storeId } })).organizationId, organizationId);
    const products = await db.product.findMany({ where: { organizationId, isDeleted: false, storeProducts: { some: { organizationId, storeId, isActive: true, isHidden: false } } }, orderBy: { id: "asc" }, include: { images: { orderBy: [{ position: "asc" }, { id: "asc" }] } } });
    const sources = [], seen = new Set();
    for (const product of products) for (const image of [...product.images, { url: product.photoUrl, updatedAt: product.updatedAt }]) {
      if (!image.url || seen.has(`${product.id}:${image.url}`)) continue;
      seen.add(`${product.id}:${image.url}`);
      assert.ok(image.url.startsWith(`/uploads/imported-products/${organizationId}/`) || image.url.startsWith("/uploads/product-photo-browser-"));
      const path = resolve("public", image.url.slice(1));
      assert.ok(!relative(resolve("public/uploads"), path).startsWith(".."));
      const sourceKey = hash(JSON.stringify([product.id, image.url, image.updatedAt.toISOString()]));
      const feature = await db.productPhotoFeature.findFirstOrThrow({ where: { organizationId, productId: product.id, sourceKey, modelVersion: "ppshitu-v2-pplcnetv2-v1-fp32-224" } });
      assert.equal(feature.productId, product.id); assert.equal(feature.status, "READY");
      const bytes = await readFile(path);
      sources.push({ productId: product.id, sku: product.sku, name: product.name, sourceKey, sourceSha256: hash(bytes), ppEmbedding: feature.embedding, ...await cache(`gallery-${storeId}-${sources.length}`, await canonical(bytes)) });
    }
    assert.equal(sources.length, expectedPhotos);
    return { storeId, products: products.map(({ id, sku, name }) => ({ id, sku, name })), sources };
  }
  const calibration = await scope("photo-search-browser-shop", 24), test = await scope("photo-search-field-shop", 38);
  const calibrationQueries = [];
  for (const query of old.queries) {
    const source = old.assets.find((asset) => asset.id === query.asset); assert.ok(source);
    const original = await readFile(resolve(".local/elfbar-photo-check", source.file)); assert.equal(hash(original), source.sha256);
    let pipeline = sharp(original);
    if (query.crop) { const { width, height } = await pipeline.metadata(); const [x, y, w, h] = query.crop; pipeline = pipeline.extract({ left: Math.round(x * width), top: Math.round(y * height), width: Math.round(w * width), height: Math.round(h * height) }); }
    const submitted = await pipeline.jpeg({ quality: 90 }).toBuffer();
    assert.equal(hash(await readFile(`.local/elfbar-photo-check/queries/${query.id}.jpg`)), hash(submitted));
    const expectedSku = query.expected ? old.gallery.find((row) => row.id === query.expected).sku : null;
    const target = calibration.products.find((product) => product.sku === expectedSku);
    assert.ok(!expectedSku || target);
    calibrationQueries.push({ id: query.id, expectedId: target?.id ?? null, expectedSku, kind: query.kind, ...await cache(`calibration-${query.id}`, await canonical(submitted)) });
  }
  const testQueries = [];
  for (const query of field.queries) {
    const bytes = await readFile(resolve(".local/elfbar-field-check", query.file)); assert.equal(hash(bytes), query.sha256);
    const submitted = await canonical(bytes);
    assert.equal(hash(submitted), baseline.results.find((row) => row.query === query.id).inputSha256);
    const target = test.products.find((product) => product.sku === query.expectedSku); assert.ok(!query.expectedSku || target);
    testQueries.push({ id: query.id, expectedId: target?.id ?? null, expectedSku: query.expectedSku ?? null, region: query.region, multiObject: Boolean(query.multiObject), hard: hardIds.includes(query.id), scene: query.scene, pose: query.pose, ...await cache(`test-${query.id}`, await canonical(submitted)) });
  }
  for (const [gallery, queries] of [[calibration.sources, calibrationQueries], [test.sources, testQueries]]) {
    const hashes = new Set(gallery.map((row) => row.sha256));
    assert.ok(!queries.some((row) => hashes.has(row.sha256)), "Query/gallery byte leakage");
  }
  assert.equal(hash(JSON.stringify(await snapshot())), before, "Catalog changed during export");
  const data = { schema: 1, at: new Date().toISOString(), databaseWrites: false, catalogHash: before,
    fieldManifestSha256: hash(fieldBytes), calibrationManifestSha256: hash(oldBytes), hardIds,
    calibration: { ...calibration, queries: calibrationQueries }, test: { ...test, queries: testQueries } };
  await writeFile(`${root}/inputs.json`, JSON.stringify(data, null, 2) + "\n");
  console.log(JSON.stringify({ calibrationGallery: calibration.sources.length, testGallery: test.sources.length, calibrationQueries: calibrationQueries.length, testQueries: testQueries.length, hardQueries: hardIds.length, databaseWrites: false, catalogUnchanged: true }));
} finally { await db.$disconnect(); }

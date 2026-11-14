// Read-only diagnostic input export from the fixed disposable local shop.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";

const root = resolve(".local/elfbar-misses");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fixtureBytes = await readFile("scripts/qa/fixtures/elfbar-photo-field.json");
const fixture = JSON.parse(fixtureBytes);
const oracleBytes = await readFile("scripts/qa/fixtures/elfbar-photo-oracle.json");
const oracles = JSON.parse(oracleBytes);
assert.equal(oracles.queryManifestSha256, hash(fixtureBytes));
const multiviewBytes = await readFile("scripts/qa/fixtures/elfbar-photo-multiview.json");
const multiview = JSON.parse(multiviewBytes);
const ffmpeg = process.argv.find((arg) => arg.startsWith("--ffmpeg="))?.slice(9);
assert.ok(ffmpeg && resolve(ffmpeg) === ffmpeg, "Supply --ffmpeg=/absolute/path/to/ffmpeg");
assert.match(await readFile(".local/product-photo-search/DISPOSABLE-TEST-ONLY", "utf8"), /^Disposable (?:internal product photo search|China image search) QA; no customer records\n$/);
const organizationId = "photo-search-browser-qa", storeId = "photo-search-field-shop";
const db = new PrismaClient({ datasourceUrl: "postgresql://bazaar_test@127.0.0.1:55991/bazaar_hardening_agent4_platform" });
try {
  const [identity] = await db.$queryRaw`SELECT current_database() AS database,current_user AS username,inet_server_port() AS port`;
  assert.deepEqual(identity, { database: "bazaar_hardening_agent4_platform", username: "bazaar_test", port: 55991 });
  assert.equal((await db.store.findUniqueOrThrow({ where: { id: storeId } })).organizationId, organizationId);
  const products = await db.product.findMany({ where: { organizationId, isDeleted: false, storeProducts: { some: { organizationId, storeId, isActive: true, isHidden: false } } }, orderBy: { id: "asc" }, include: { images: { orderBy: [{ position: "asc" }, { id: "asc" }] } } });
  const sources = [], seen = new Set();
  for (const product of products) {
    for (const image of [...product.images, { url: product.photoUrl, updatedAt: product.updatedAt }]) {
      if (!image.url || seen.has(`${product.id}:${image.url}`)) continue;
      seen.add(`${product.id}:${image.url}`);
      const sourceKey = hash(JSON.stringify([product.id, image.url, image.updatedAt.toISOString()]));
      sources.push({ productId: product.id, sku: product.sku, name: product.name, sourceKey, sourceUrl: image.url, group: products.indexOf(product) });
    }
  }
  assert.equal(sources.length, 36, "Diagnosis requires the frozen 36-photo gallery");
  const features = await db.productPhotoFeature.findMany({ where: { organizationId, modelVersion: "ppshitu-v2-pplcnetv2-v1-fp32-224", status: "READY", productId: { in: products.map((row) => row.id) }, sourceKey: { in: sources.map((row) => row.sourceKey) } } });
  assert.equal(features.length, sources.length);
  for (const source of sources) {
    const feature = features.find((row) => row.productId === source.productId && row.sourceKey === source.sourceKey);
    assert.ok(feature && feature.embedding.length === 512 && feature.embedding.every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...feature.embedding) - 1) < .01);
    source.embedding = feature.embedding;
    assert.ok(source.sourceUrl.startsWith(`/uploads/imported-products/${organizationId}/`) || source.sourceUrl.startsWith("/uploads/product-photo-browser-"));
    source.file = resolve("public", source.sourceUrl.slice(1));
    source.sha256 = hash(await readFile(source.file));
  }
  for (const source of multiview.sources) assert.equal(hash(await readFile(resolve(".local/elfbar-multiview", source.file))), source.sha256);
  await mkdir(`${root}/queries`, { recursive: true }); await mkdir(`${root}/high`, { recursive: true });
  const canonical = async (bytes) => sharp(bytes).rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).flatten({ background: "white" }).jpeg({ quality: 90 }).toBuffer();
  const queries = [];
  for (const query of fixture.queries) {
    const original = await readFile(resolve(".local/elfbar-field-check", query.file));
    assert.equal(hash(original), query.sha256);
    // Match the frozen QA request encoding followed by Node ingress canonicalization.
    const submitted = await canonical(original), jpeg = await canonical(submitted);
    const file = `${root}/queries/${query.id}.jpg`; await writeFile(file, jpeg);
    const oracle = oracles.queries.find((row) => row.id === query.id);
    const row = { ...query, file, sha256: hash(jpeg), inputSha256: hash(submitted), expectedGroup: products.findIndex((product) => product.sku === query.expectedSku), oracleRegion: oracle?.region };
    if (oracle) {
      const source = multiview.sources.find((source) => source.id === query.media); assert.ok(source);
      const frame = `${root}/high/${query.id}.png`;
      await promisify(execFile)(ffmpeg, ["-v", "error", "-ss", String(query.seconds), "-threads", "2", "-i", resolve(".local/elfbar-multiview", source.file), "-frames:v", "1", "-vf", "format=rgb24", "-compression_level", "6", "-y", frame], { timeout: 30000 });
      row.originalFrameFile = frame; row.originalFrameSha256 = hash(await readFile(frame));
      const high = await canonical(await canonical(await readFile(frame)));
      row.highFile = `${root}/high/${query.id}.jpg`; row.highSha256 = hash(high);
      await writeFile(row.highFile, high);
    }
    queries.push(row);
  }
  await writeFile(`${root}/input.json`, JSON.stringify({ schema: 1, storeId, queryManifestSha256: hash(fixtureBytes), oracleManifestSha256: hash(oracleBytes), galleryManifestSha256: hash(multiviewBytes), galleryHash: hash(JSON.stringify(sources)), sources, queries }, null, 2) + "\n");
  console.log(JSON.stringify({ galleryPhotos: sources.length, queries: queries.length, oracleQueries: oracles.queries.length, databaseWrites: false, inference: false }));
} finally { await db.$disconnect(); }

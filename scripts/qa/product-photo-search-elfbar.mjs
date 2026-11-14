// Private local fixtures and real application queries. No reset, paid API or production access.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";

const mode = process.argv[2];
const visionCheck = process.argv.includes("--vision");
assert.ok(["prepare", "seed", "evaluate"].includes(mode), "Use prepare, seed or evaluate");
const root = resolve(".local/elfbar-photo-check");
const fixture = JSON.parse(await readFile("scripts/qa/fixtures/elfbar-photo-search.json", "utf8"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const byAsset = new Map(fixture.assets.map((asset) => [asset.id, asset]));
const organizationId = "photo-search-browser-qa";
const storeId = "photo-search-browser-shop";
const database = "postgresql://bazaar_test@127.0.0.1:55991/bazaar_hardening_agent4_platform";
await mkdir(`${root}/sources`, { recursive: true });
await mkdir(`${root}/gallery`, { recursive: true });
await mkdir(`${root}/queries`, { recursive: true });

async function source(id, download = false) {
  const asset = byAsset.get(id);
  assert.ok(asset && /^sources\/[a-zA-Z0-9_.-]+$/.test(asset.file));
  const path = `${root}/${asset.file}`;
  let bytes;
  try { bytes = await readFile(path); } catch {
    assert.ok(download, `Missing ${asset.file}; run prepare first`);
    const url = new URL(asset.url);
    assert.equal(url.protocol, "https:");
    assert.ok(["belvaping.com", "d6lkeq1iq8oae.cloudfront.net"].includes(url.hostname));
    const response = await fetch(url, { redirect: "error", headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200);
    bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(digest(bytes), asset.sha256, `Source changed: ${asset.url}`);
    await writeFile(path, bytes);
  }
  assert.equal(digest(bytes), asset.sha256, `Invalid source cache: ${asset.file}`);
  assert.equal(bytes.length, asset.bytes);
  await sharp(bytes).raw().toBuffer(); // Reject truncated JPEGs before creating fixtures.
  return bytes;
}

async function image(row) {
  const bytes = await source(row.asset);
  let pipeline = sharp(bytes);
  if (row.crop) {
    const { width, height } = await pipeline.metadata();
    const [x, y, w, h] = row.crop;
    assert.ok([x, y, w, h].every(Number.isFinite) && x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1 && y + h <= 1);
    pipeline = pipeline.extract({ left: Math.round(x * width), top: Math.round(y * height), width: Math.round(w * width), height: Math.round(h * height) });
  }
  return pipeline.jpeg({ quality: 90 }).toBuffer();
}

if (mode === "prepare") {
  for (const asset of fixture.assets) await source(asset.id, true);
  // A query and gallery must never come from the same original photo, even if resized/cropped.
  const galleryHashes = new Set(fixture.gallery.map((row) => byAsset.get(row.asset).sha256));
  for (const row of fixture.queries) assert.ok(!galleryHashes.has(byAsset.get(row.asset).sha256));
  for (const row of fixture.gallery) await writeFile(`${root}/gallery/${row.id}.jpg`, await image(row));
  for (const row of fixture.queries) await writeFile(`${root}/queries/${row.id}.jpg`, await image(row));
  console.log(JSON.stringify({ verifiedSources: fixture.assets.length, gallery: fixture.gallery.length, queries: fixture.queries.length }));
  process.exit(0);
}

// Every database operation uses an explicitly isolated, owned QA database.
assert.match(await readFile(".local/product-photo-search/DISPOSABLE-TEST-ONLY", "utf8"), /^Disposable (?:internal product photo search|China image search) QA; no customer records\n$/);
const db = new PrismaClient({ datasourceUrl: database });
try {
  const [identity] = await db.$queryRaw`SELECT current_database() AS database,current_user AS username,inet_server_port() AS port`;
  assert.equal(identity.database, "bazaar_hardening_agent4_platform");
  assert.equal(identity.username, "bazaar_test");
  assert.equal(identity.port, 55991);
  const store = await db.store.findUniqueOrThrow({ where: { id: storeId } });
  assert.equal(store.organizationId, organizationId);
  const user = await db.user.findUniqueOrThrow({ where: { email: process.env.PRODUCT_PHOTO_QA_EMAIL } });
  assert.equal(user.organizationId, organizationId);
  assert.equal(user.role, "ADMIN");
  const base = new URL(process.env.PRODUCT_PHOTO_QA_BASE_URL);
  assert.equal(base.protocol, "http:");
  assert.ok(["localhost", "127.0.0.1", "192.168.68.109"].includes(base.hostname));
  assert.equal(base.port, "3158");
  assert.equal(base.pathname, "/");
  assert.ok(!base.username && !base.password && !base.search && !base.hash);
  assert.ok(process.env.PRODUCT_PHOTO_QA_PASSWORD);
  const cookies = new Map();
  async function request(path, init = {}) {
    assert.ok(path.startsWith("/") && !path.startsWith("//"));
    const response = await fetch(new URL(path, base), { ...init, headers: { ...init.headers, origin: base.origin,
      cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; ") }, redirect: "manual", signal: AbortSignal.timeout(30000) });
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(";")[0], equals = pair.indexOf("=");
      cookies.set(pair.slice(0, equals), pair.slice(equals + 1));
    }
    return response;
  }
  async function json(path, init = {}) {
    const response = await request(path, init);
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify({ path, status: response.status, message: body.message ?? body.error }));
    return body;
  }
  const csrf = await json("/api/auth/csrf");
  const login = await json("/api/auth/callback/credentials", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: csrf.csrfToken, email: user.email, password: process.env.PRODUCT_PHOTO_QA_PASSWORD, callbackUrl: base.origin + "/products", json: "true" }) });
  assert.ok(login.url && !login.url.includes("error="));
  const session = await json("/api/auth/session");
  assert.equal(session.user.id, user.id);
  assert.equal(session.user.organizationId, organizationId);
  const original = await db.product.findUniqueOrThrow({ where: { organizationId_sku: { organizationId, sku: "PHOTO-ELFBAR-TEST" } } });
  const products = new Map();
  const galleryEvidence = [];
  const unit = await db.unit.findUniqueOrThrow({ where: { organizationId_code: { organizationId, code: "each" } } });
  for (const row of fixture.gallery) {
    let product = await db.product.findUnique({ where: { organizationId_sku: { organizationId, sku: row.sku } } });
    if (!product && mode === "seed") {
      const bytes = await readFile(`${root}/gallery/${row.id}.jpg`);
      assert.equal(digest(bytes), digest(await image(row)));
      const form = new FormData();
      form.append("file", new File([bytes], `${row.id}.jpg`, { type: "image/jpeg" }));
      const upload = await json("/api/product-images/upload", { method: "POST", body: form });
      assert.ok(upload.url.startsWith(`/uploads/imported-products/${organizationId}/`));
      const hash = digest(Buffer.from(`elfbar-photo-fixture-v1:${row.id}`));
      const idempotencyKey = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      await json("/api/trpc/products.create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ json: {
        idempotencyKey, storeId, name: `ELFBAR GH23000 ${row.flavor} — тест`, sku: row.sku, baseUnitId: unit.id, basePriceKgs: null,
        description: `Локальный тест поиска по фотографии. Корпус: ${row.color}. Фото: Андрей Попко / BelVaping, 20.11.2024. ${fixture.sources[0].url}`,
        photoUrl: upload.url, images: [{ url: upload.url, position: 0 }],
      } }) });
      product = await db.product.findUniqueOrThrow({ where: { organizationId_sku: { organizationId, sku: row.sku } } });
    }
    assert.ok(product, "Run seed first");
    assert.equal(product.organizationId, organizationId);
    const expectedGallery = await image(row);
    const fileHash = createHash("sha1").update(expectedGallery).digest("hex");
    const expectedUrl = `/uploads/imported-products/${organizationId}/products/unassigned/${fileHash}.jpg`;
    assert.equal(product.photoUrl, expectedUrl, "Fixture photo changed; do not silently evaluate a different gallery");
    assert.equal(digest(await readFile(resolve("public", expectedUrl.slice(1)))), digest(expectedGallery));
    const images = await db.productImage.findMany({ where: { organizationId, productId: product.id } });
    assert.equal(images.length, 1);
    assert.equal(images[0].url, expectedUrl);
    galleryEvidence.push({ fixtureId: row.id, productId: product.id, sourceSha256: byAsset.get(row.asset).sha256, crop: row.crop, uploadedSha256: digest(expectedGallery), imageUrl: expectedUrl });
    const visibleStores = await db.storeProduct.findMany({ where: { productId: product.id } });
    assert.equal(visibleStores.length, 1);
    assert.equal(visibleStores[0].storeId, storeId);
    assert.equal(visibleStores[0].organizationId, organizationId);
    assert.ok(visibleStores[0].isActive && !visibleStores[0].isHidden);
    products.set(row.id, { id: product.id, flavor: row.flavor, sku: row.sku });
  }
  // Do not touch existing Miami Mint, prices, stock or any unrelated records.
  assert.deepEqual(await db.product.findUniqueOrThrow({ where: { id: original.id } }), original);
  const deadline = Date.now() + 120000;
  let prepared;
  do {
    prepared = await json("/api/products/photo-search/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId }) });
    if (!prepared.progress.pending) break;
    assert.ok(Date.now() < deadline, "Photo worker did not finish");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } while (true);
  assert.equal(prepared.progress.failed, 0);
  await writeFile(`${root}/products.json`, JSON.stringify({ storeId, originalId: original.id, products: Object.fromEntries(products), progress: prepared.progress }, null, 2) + "\n");
  if (mode === "seed") {
    console.log(JSON.stringify({ fixtures: products.size, originalPreserved: true, storeScopeVerified: true, progress: prepared.progress }));
  } else {
    const results = [];
    for (const row of fixture.queries) {
      const bytes = await readFile(`${root}/queries/${row.id}.jpg`);
      assert.equal(digest(bytes), digest(await image(row)));
      const form = new FormData();
      form.append("file", new File([bytes], `${row.id}.jpg`, { type: "image/jpeg" }));
      form.append("storeId", storeId);
      const start = performance.now();
      const body = await json("/api/products/photo-search", { method: "POST", body: form });
      const ms = performance.now() - start;
      assert.equal(body.storeId, storeId);
      assert.equal(body.partial, false);
      for (const item of body.items) {
        const scoped = await db.storeProduct.findUniqueOrThrow({ where: { storeId_productId: { storeId, productId: item.id } } });
        assert.equal(scoped.organizationId, organizationId);
        assert.ok(scoped.isActive && !scoped.isHidden);
      }
      const expectedId = row.expected ? products.get(row.expected).id : null;
      const rank = expectedId ? body.items.findIndex((item) => item.id === expectedId) + 1 : null;
      if (visionCheck) assert.ok(body.recognition && body.recognition.labelStatus !== "unavailable", "Detector/OCR runtime is not active");
      results.push({ query: row.id, kind: row.kind, expected: row.expected ?? row.flavor, expectedId, rank: rank || null, ms, items: body.items, ...(body.recognition ? { recognition: body.recognition } : {}) });
      console.log(JSON.stringify({ query: row.id, rank: rank || null, candidates: body.items.map((item) => item.name) }));
    }
    const emptyStoreId = "photo-search-browser-other";
    const emptyStore = await db.store.findUniqueOrThrow({ where: { id: emptyStoreId } });
    assert.equal(emptyStore.organizationId, organizationId);
    assert.equal(await db.storeProduct.count({ where: { storeId: emptyStoreId, isActive: true, isHidden: false } }), 0, "The scope control store must remain empty");
    const emptyQuery = new FormData();
    emptyQuery.append("file", new File([await readFile(`${root}/queries/ice-mint-standing.jpg`)], "ice-mint.jpg", { type: "image/jpeg" }));
    emptyQuery.append("storeId", emptyStoreId);
    const emptyResult = await json("/api/products/photo-search", { method: "POST", body: emptyQuery });
    assert.equal(emptyResult.storeId, emptyStoreId);
    assert.deepEqual(emptyResult.items, []);
    assert.equal(emptyResult.progress.total, 0);
    const summaries = ["independent-device-photo", "manufacturer-artwork", "absent-manufacturer-artwork"].map((kind) => {
      const rows = results.filter((row) => row.kind === kind);
      return { kind, queries: rows.length, top1: rows.filter((row) => row.rank === 1).length,
        top5: rows.filter((row) => row.rank && row.rank <= 5).length, queriesWithCandidates: rows.filter((row) => row.items.length).length,
        ...(visionCheck ? { queriesWithTextConfirmation: rows.filter((row) => row.recognition?.labelStatus === "matched").length } : {}) };
    });
    const evidence = { schema: 1, at: new Date().toISOString(), fixtureManifestSha256: digest(await readFile("scripts/qa/fixtures/elfbar-photo-search.json")),
      realApplicationApi: true, model: "ppshitu-v2-pplcnetv2-v1-fp32-224", threshold: 0.68, galleryProgress: prepared.progress,
      originalPreserved: true, storeScopeVerified: true, emptyStoreHasNoLeakedCandidates: true, gallery: galleryEvidence, summaries, limitations: fixture.protocol.limits, results };
    if (visionCheck) evidence.visionModelManifestSha256 = digest(await readFile("services/product-photo-search/vision-models.json"));
    await writeFile(`${root}/${visionCheck ? "results-vision" : "results"}.json`, JSON.stringify(evidence, null, 2) + "\n");
    console.log(JSON.stringify(summaries, null, 2));
  }
} finally { await db.$disconnect(); }

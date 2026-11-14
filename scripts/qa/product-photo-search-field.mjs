// Frozen real-camera queries in an explicitly isolated local shop. No resets/provider calls.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { execFileSync } from "node:child_process";

const root = resolve(".local/elfbar-field-check");
const manifestPath = "scripts/qa/fixtures/elfbar-photo-field.json";
const bytes = await readFile(manifestPath);
const fixture = JSON.parse(bytes);
const runLabel = process.argv.find((value) => value.startsWith("--run="))?.slice(6);
assert.ok(!runLabel || /^[a-z0-9-]{1,50}$/.test(runLabel), "Invalid run label");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const multiview = process.argv.includes("--multiview") ? JSON.parse(await readFile("scripts/qa/fixtures/elfbar-photo-multiview.json", "utf8")) : null;
const recoveryPath = process.argv.includes("--approved-views") ? "scripts/qa/fixtures/elfbar-photo-recovery-approved.json" : "scripts/qa/fixtures/elfbar-photo-recovery.json";
const recovery = process.argv.includes("--recovery-views") ? JSON.parse(await readFile(recoveryPath, "utf8")) : null;
assert.ok(!process.argv.includes("--approved-views") || recovery, "--approved-views requires --recovery-views");
if (recovery) {
  assert.ok(multiview, "--recovery-views requires --multiview");
  assert.equal(recovery.schema, 1);
  assert.equal(recovery.baselineGalleryManifestSha256, digest(await readFile("scripts/qa/fixtures/elfbar-photo-multiview.json")));
  assert.equal(recovery.baselineGalleryPhotos, multiview.expectedGalleryPhotos);
  assert.equal(recovery.expectedGalleryPhotos, multiview.expectedGalleryPhotos + recovery.assets.length);
  if (recovery.rejectedAssets) {
    const trialBytes = await readFile("scripts/qa/fixtures/elfbar-photo-recovery.json");
    assert.equal(digest(trialBytes), recovery.rejectedTrialManifestSha256);
    const trial = JSON.parse(trialBytes);
    for (const rejected of recovery.rejectedAssets) {
      assert.ok(trial.assets.some((asset) => asset.sku === rejected.sku && asset.uploadedSha256 === rejected.uploadedSha256));
      assert.ok(![...multiview.assets, ...fixture.gallery, ...recovery.assets].some((asset) => asset.uploadedSha256 === rejected.uploadedSha256));
    }
  }
  multiview.assets.push(...recovery.assets);
  multiview.expectedGalleryPhotos = recovery.expectedGalleryPhotos;
}
const expectedGalleryPhotos = multiview?.expectedGalleryPhotos ?? fixture.expectedGalleryPhotos;
const local = (file) => {
  assert.match(file, /^[a-zA-Z0-9_./-]+$/);
  const path = resolve(root, file);
  assert.ok(relative(root, path) && !relative(root, path).startsWith(".."));
  return path;
};
assert.equal(fixture.schema, 1);
assert.equal(fixture.preparedBeforeInference, true);
assert.equal(new Set(fixture.queries.map((row) => row.id)).size, fixture.queries.length);
for (const media of fixture.media) assert.equal(digest(await readFile(local(media.file))), media.sha256, `Changed media ${media.id}`);
for (const row of [...fixture.gallery, ...fixture.queries]) {
  assert.ok(fixture.media.some((media) => media.id === row.media));
  if (fixture.queries.includes(row)) assert.ok(["hand", "table"].includes(row.scene));
  assert.equal(digest(await readFile(local(row.file))), row.sha256, `Changed query ${row.id}`);
  await sharp(local(row.file), { failOn: "warning", limitInputPixels: 40_000_000 }).raw().toBuffer();
  if (row.region) {
    const { x, y, width, height } = row.region;
    assert.ok([x, y, width, height].every(Number.isFinite) && x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1 && y + height <= 1);
  }
}
const baseline = JSON.parse(await readFile("scripts/qa/fixtures/elfbar-photo-search.json", "utf8"));
assert.equal(digest(await readFile("scripts/qa/fixtures/elfbar-photo-search.json")), fixture.baselineManifestSha256);
assert.ok(!fixture.queries.some((query) => baseline.gallery.some((image) => baseline.assets.find((asset) => asset.id === image.asset).sha256 === query.sha256)));
assert.ok(!fixture.queries.some((query) => fixture.gallery.some((image) => image.sha256 === query.sha256 || (image.media === query.media && image.seconds === query.seconds))), "A query frame is also a gallery reference");
const photoOrigin = (url) => url.replace(/-\d+x\d+(?=\.[^.]+$)/, "");
const referencePhotos = baseline.gallery.map((row) => photoOrigin(baseline.assets.find((asset) => asset.id === row.asset).url));
assert.ok(!fixture.queries.some((query) => fixture.media.some((media) => media.id === query.media && media.kind === "photo" && referencePhotos.includes(photoOrigin(media.url)))), "A resized/cropped original gallery photograph is being reused as a query");
const extraRoot = resolve(".local/elfbar-multiview");
function extraLocal(file) {
  assert.match(file, /^[a-zA-Z0-9_./-]+$/);
  const path = resolve(extraRoot, file);
  assert.ok(relative(extraRoot, path) && !relative(extraRoot, path).startsWith(".."));
  return path;
}
if (multiview) {
  assert.equal(multiview.schema, 1);
  assert.equal(multiview.baselineQueryManifestSha256, digest(bytes));
  assert.equal(multiview.baselineGalleryPhotos, fixture.expectedGalleryPhotos);
  assert.equal(multiview.preserveOriginalImages, true);
  assert.equal(multiview.expectedGalleryPhotos, fixture.expectedGalleryPhotos + multiview.assets.length);
  assert.equal(new Set(multiview.assets.map((row) => row.id)).size, multiview.assets.length);
  for (const source of multiview.sources) assert.equal(digest(await readFile(extraLocal(source.file))), source.sha256);
  for (const asset of multiview.assets) {
    assert.ok(multiview.sources.some((source) => source.id === asset.media));
    assert.ok(fixture.gallery.some((row) => row.sku === asset.sku));
    assert.ok(!fixture.queries.some((query) => query.media === asset.media && query.seconds === asset.seconds), "A query timestamp was added to the gallery");
    const frame = await readFile(extraLocal(asset.frameFile));
    assert.equal(digest(frame), asset.frameSha256);
    const { width, height } = await sharp(frame).metadata(), [x, y, w, h] = asset.crop;
    assert.ok([x, y, w, h].every(Number.isFinite) && x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1 && y + h <= 1);
    const crop = await sharp(frame).extract({ left: Math.round(x * width), top: Math.round(y * height), width: Math.round(w * width), height: Math.round(h * height) }).jpeg({ quality: 90 }).toBuffer();
    assert.equal(digest(crop), asset.uploadedSha256);
    assert.equal(digest(await readFile(extraLocal(asset.file))), asset.uploadedSha256);
    const metadata = await sharp(crop).metadata();
    assert.equal(metadata.width, asset.width); assert.equal(metadata.height, asset.height);
    assert.ok(!fixture.queries.some((query) => query.sha256 === asset.frameSha256 || query.sha256 === asset.uploadedSha256));
  }
}
if (process.argv[2] === "verify") {
  console.log(JSON.stringify({ manifestSha256: digest(bytes), media: fixture.media.length, queries: fixture.queries.length, inference: false }));
  process.exit(0);
}
const mode = process.argv[2];
assert.ok(["seed", "augment", "evaluate"].includes(mode), "Use verify, seed, augment or evaluate");
assert.ok(mode !== "augment" || multiview, "augment requires --multiview");
assert.ok(mode !== "seed" || !multiview, "Seed the baseline first; use augment for additional views");
assert.match(await readFile(".local/product-photo-search/DISPOSABLE-TEST-ONLY", "utf8"), /^Disposable (?:internal product photo search|China image search) QA; no customer records\n$/);
const db = new PrismaClient({ datasourceUrl: "postgresql://bazaar_test@127.0.0.1:55991/bazaar_hardening_agent4_platform" });
const organizationId = "photo-search-browser-qa", storeId = "photo-search-field-shop", originalStoreId = "photo-search-browser-shop";
try {
  const [identity] = await db.$queryRaw`SELECT current_database() AS database,current_user AS username,inet_server_port() AS port`;
  assert.deepEqual(identity, { database: "bazaar_hardening_agent4_platform", username: "bazaar_test", port: 55991 });
  const base = new URL(process.env.PRODUCT_PHOTO_QA_BASE_URL);
  assert.ok(base.protocol === "http:" && ["localhost", "127.0.0.1", "192.168.68.109"].includes(base.hostname) && base.port === "3158" && base.pathname === "/" && !base.username && !base.password && !base.search && !base.hash);
  const user = await db.user.findUniqueOrThrow({ where: { email: process.env.PRODUCT_PHOTO_QA_EMAIL } });
  assert.equal(user.organizationId, organizationId); assert.equal(user.role, "ADMIN");
  assert.ok(process.env.PRODUCT_PHOTO_QA_PASSWORD);
  const cookies = new Map();
  async function request(path, init = {}) {
    assert.ok(path.startsWith("/") && !path.startsWith("//"));
    const response = await fetch(new URL(path, base), { ...init, headers: { ...init.headers, origin: base.origin, cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") }, redirect: "manual", signal: AbortSignal.timeout(30000) });
    for (const value of response.headers.getSetCookie()) { const pair = value.split(";")[0], index = pair.indexOf("="); cookies.set(pair.slice(0, index), pair.slice(index + 1)); }
    return response;
  }
  async function json(path, init) { const response = await request(path, init); assert.equal(response.status, 200, `Unexpected HTTP ${response.status}`); return response.json(); }
  const csrf = await json("/api/auth/csrf");
  const login = await json("/api/auth/callback/credentials", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken: csrf.csrfToken, email: user.email, password: process.env.PRODUCT_PHOTO_QA_PASSWORD, callbackUrl: base.origin + "/products", json: "true" }) });
  assert.ok(login.url && !login.url.includes("error="));
  assert.equal((await json("/api/auth/session")).user.id, user.id);
  const original = async () => {
    const members = await db.storeProduct.findMany({ where: { organizationId, storeId: originalStoreId }, orderBy: { productId: "asc" } });
    const ids = members.map((row) => row.productId);
    return { members, products: await db.product.findMany({ where: { organizationId, id: { in: ids } }, orderBy: { id: "asc" }, include: { images: { orderBy: { id: "asc" } } } }), features: await db.productPhotoFeature.findMany({ where: { organizationId, productId: { in: ids } }, orderBy: { id: "asc" } }) };
  };
  if (mode === "seed") {
    const before = await original(), hash = digest(JSON.stringify(before));
    let previousSeed;
    try { previousSeed = JSON.parse(await readFile(`${root}/seed.json`, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (previousSeed) assert.equal(hash, previousSeed.originalShopHash, "The original shop changed since the first fixture seed");
    const store = await db.store.findUnique({ where: { id: storeId } }) ?? await db.store.create({ data: { id: storeId, organizationId, name: "ELFBAR — реальные ракурсы (тест)", code: "PHOTO-FIELD" } });
    assert.equal(store.organizationId, organizationId); assert.equal(store.code, "PHOTO-FIELD");
    await db.storeProduct.createMany({ data: before.members.filter((row) => row.isActive && !row.isHidden).map((row) => ({ organizationId, storeId, productId: row.productId })), skipDuplicates: true });
    const unit = await db.unit.findUniqueOrThrow({ where: { organizationId_code: { organizationId, code: "each" } } });
    for (const row of fixture.gallery) {
      let product = await db.product.findUnique({ where: { organizationId_sku: { organizationId, sku: row.sku } } });
      const { width, height } = await sharp(local(row.file)).metadata();
      const [x, y, w, h] = row.crop;
      const image = await sharp(local(row.file)).extract({ left: Math.round(x * width), top: Math.round(y * height), width: Math.round(w * width), height: Math.round(h * height) }).jpeg({ quality: 90 }).toBuffer();
      assert.equal(digest(image), row.uploadedSha256);
      if (!product) {
        const form = new FormData(); form.set("file", new File([image], `${row.id}.jpg`, { type: "image/jpeg" }));
        const upload = await json("/api/product-images/upload", { method: "POST", body: form });
        assert.ok(upload.url.startsWith(`/uploads/imported-products/${organizationId}/`));
        const hash = digest(Buffer.from(`elfbar-field-fixture-v1:${row.sku}`));
        const idempotencyKey = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
        const source = fixture.media.find((media) => media.id === row.media);
        await json("/api/trpc/products.create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ json: { idempotencyKey, storeId, name: `ELFBAR GH23000 ${row.flavor} — реальные ракурсы (тест)`, sku: row.sku, baseUnitId: unit.id, basePriceKgs: null, description: `Локальное испытание поиска. Фото из реального видео: ${source.author}, ${source.url}, ${row.seconds} с.`, photoUrl: upload.url, images: [{ url: upload.url, position: 0 }] } }) });
        product = await db.product.findUniqueOrThrow({ where: { organizationId_sku: { organizationId, sku: row.sku } } });
      }
      assert.equal(digest(await readFile(resolve("public", product.photoUrl.slice(1)))), row.uploadedSha256);
      assert.equal(product.name, `ELFBAR GH23000 ${row.flavor} — реальные ракурсы (тест)`);
      const memberships = await db.storeProduct.findMany({ where: { productId: product.id } });
      assert.equal(memberships.length, 1); assert.equal(memberships[0].storeId, storeId);
    }
    let progress;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      progress = (await json("/api/products/photo-search/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId }) })).progress;
      if (!progress.pending) break;
      await pause(2000);
    }
    assert.equal(progress.ready, fixture.expectedGalleryPhotos); assert.equal(progress.pending, 0); assert.equal(progress.failed, 0);
    assert.equal(digest(JSON.stringify(await original())), hash, "The original manual shop changed");
    await writeFile(`${root}/seed.json`, JSON.stringify({ originalShopHash: hash, originalShopUnchanged: true, storeId, progress }, null, 2) + "\n");
    console.log(JSON.stringify({ seeded: fixture.gallery.length, storeId, originalShopUnchanged: true, progress }));
    process.exitCode = 0;
  } else if (mode === "augment") {
    const seed = JSON.parse(await readFile(`${root}/seed.json`, "utf8"));
    assert.equal(digest(JSON.stringify(await original())), seed.originalShopHash);
    assert.equal((await db.store.findUniqueOrThrow({ where: { id: storeId } })).organizationId, organizationId);
    let changed = 0;
    for (const row of fixture.gallery) {
      const product = await db.product.findUniqueOrThrow({ where: { organizationId_sku: { organizationId, sku: row.sku } }, include: { images: { orderBy: { position: "asc" } } } });
      const memberships = await db.storeProduct.findMany({ where: { productId: product.id } });
      assert.equal(memberships.length, 1); assert.equal(memberships[0].storeId, storeId); assert.equal(memberships[0].organizationId, organizationId);
      const existing = new Map();
      for (const image of product.images) {
        assert.ok(image.url.startsWith(`/uploads/imported-products/${organizationId}/`));
        existing.set(digest(await readFile(resolve("public", image.url.slice(1)))), image);
      }
      assert.ok(existing.has(row.uploadedSha256), "Original reference must be preserved");
      const assets = multiview.assets.filter((asset) => asset.sku === row.sku);
      assert.equal(assets.length, 3 + (recovery?.assets.filter((asset) => asset.sku === row.sku).length ?? 0)); assert.equal(assets[0].pose, "front");
      const desired = [];
      for (const asset of assets) {
        let image = existing.get(asset.uploadedSha256);
        if (!image) {
          const form = new FormData(); form.set("file", new File([await readFile(extraLocal(asset.file))], `${asset.id}.jpg`, { type: "image/jpeg" }));
          const upload = await json("/api/product-images/upload", { method: "POST", body: form });
          assert.ok(upload.url.startsWith(`/uploads/imported-products/${organizationId}/`));
          assert.equal(digest(await readFile(resolve("public", upload.url.slice(1)))), asset.uploadedSha256);
          image = { url: upload.url };
        }
        desired.push({ ...(image.id ? { id: image.id } : {}), url: image.url, position: desired.length });
      }
      const rejectedHashes = new Set((recovery?.rejectedAssets ?? []).filter((asset) => asset.sku === row.sku).map((asset) => asset.uploadedSha256));
      const rejectedIds = new Set([...existing].filter(([hash]) => rejectedHashes.has(hash)).map(([, image]) => image.id));
      for (const image of product.images) if (!rejectedIds.has(image.id) && !desired.some((entry) => entry.url === image.url)) desired.push({ id: image.id, url: image.url, position: desired.length });
      if (JSON.stringify(desired.map((image) => image.url)) !== JSON.stringify(product.images.map((image) => image.url))) {
        await json("/api/trpc/products.update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ json: { productId: product.id, sku: product.sku, name: product.name, baseUnitId: product.baseUnitId, expectedUpdatedAt: product.updatedAt.toISOString(), imagesOnly: true, images: desired } }) });
        changed += 1;
      }
      const after = await db.product.findUniqueOrThrow({ where: { id: product.id }, include: { images: { orderBy: { position: "asc" } } } });
      const business = ({ images, photoUrl, updatedAt, ...rest }) => rest;
      assert.deepEqual(business(after), business(product), "Image update changed product business fields");
      assert.deepEqual(after.images.map((image) => image.url), desired.map((image) => image.url));
    }
    let progress;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      progress = (await json("/api/products/photo-search/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId }) })).progress;
      if (!progress.pending) break;
      await pause(2000);
    }
    assert.equal(progress.ready, expectedGalleryPhotos); assert.equal(progress.pending, 0); assert.equal(progress.failed, 0);
    assert.equal(digest(JSON.stringify(await original())), seed.originalShopHash, "The original manual shop changed");
    await writeFile(`${extraRoot}/augmentation.json`, JSON.stringify({ changed, progress, originalShopUnchanged: true, manifestSha256: digest(await readFile("scripts/qa/fixtures/elfbar-photo-multiview.json")), recoveryManifestSha256: recovery ? digest(await readFile(recoveryPath)) : null }, null, 2) + "\n");
    console.log(JSON.stringify({ changed, progress, originalShopUnchanged: true }));
  } else {
  assert.equal((await db.store.findUniqueOrThrow({ where: { id: storeId } })).organizationId, organizationId);
  const snapshot = async () => ({
    products: await db.product.findMany({ where: { organizationId }, orderBy: { id: "asc" }, include: { images: { orderBy: { id: "asc" } }, storeProducts: { orderBy: { storeId: "asc" } } } }),
    features: await db.productPhotoFeature.findMany({ where: { organizationId }, orderBy: { id: "asc" } }),
  });
  const before = await snapshot();
  const galleryHash = digest(JSON.stringify(before));
  const prior = JSON.parse(await readFile("docs/benchmarks/product-photo-vision-20261114/elfbar-results.json", "utf8"));
  for (const gallery of prior.gallery) {
    const product = before.products.find((product) => product.id === gallery.productId);
    assert.ok(product); assert.equal(product.photoUrl, gallery.imageUrl);
    assert.equal(digest(await readFile(resolve("public", gallery.imageUrl.slice(1)))), gallery.uploadedSha256);
  }
  const status = await json(`/api/products/photo-search?storeId=${storeId}`);
  assert.equal(status.configured, true);
  assert.deepEqual(status.progress, { ...prior.galleryProgress, total: expectedGalleryPhotos, ready: expectedGalleryPhotos }, "The comparison gallery changed");
  const expectedId = (sku) => sku ? before.products.find((product) => product.sku === sku)?.id : null;
  for (const row of fixture.queries) if (row.expectedSku) assert.ok(expectedId(row.expectedSku));
  const results = [];
  for (const row of fixture.gallery) {
    const product = before.products.find((product) => product.sku === row.sku); assert.ok(product);
    assert.equal(product.name, `ELFBAR GH23000 ${row.flavor} — реальные ракурсы (тест)`);
    // The original source remains in the gallery after a better primary photo is added.
    if (multiview) {
      const hashes = await Promise.all(product.images.map((image) => readFile(resolve("public", image.url.slice(1))).then(digest)));
      assert.ok(hashes.includes(row.uploadedSha256));
      const assets = multiview.assets.filter((asset) => asset.sku === row.sku);
      for (const asset of assets) assert.ok(hashes.includes(asset.uploadedSha256), `Missing view ${asset.id}`);
      for (const rejected of (recovery?.rejectedAssets ?? []).filter((asset) => asset.sku === row.sku)) assert.ok(!hashes.includes(rejected.uploadedSha256), `Rejected trial view remains: ${rejected.id}`);
      assert.equal(digest(await readFile(resolve("public", product.photoUrl.slice(1)))), assets[0].uploadedSha256);
    } else assert.equal(digest(await readFile(resolve("public", product.photoUrl.slice(1)))), row.uploadedSha256);
  }
  const seed = JSON.parse(await readFile(`${root}/seed.json`, "utf8"));
  assert.equal(digest(JSON.stringify(await original())), seed.originalShopHash);
  await mkdir(root, { recursive: true });
  for (const row of fixture.queries) {
    const image = await sharp(local(row.file), { failOn: "warning" }).rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).flatten({ background: "white" }).jpeg({ quality: 90 }).toBuffer();
    for (const mode of row.region ? ["auto", "manual"] : ["auto"]) {
      const form = new FormData(); form.set("file", new File([image], `${row.id}.jpg`, { type: "image/jpeg" })); form.set("storeId", storeId);
      if (mode === "manual") form.set("region", JSON.stringify(row.region));
      let response;
      const start = performance.now();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        response = await request("/api/products/photo-search", { method: "POST", body: form });
        if (response.status !== 429 || attempt) break;
        const seconds = Number(response.headers.get("retry-after")); await response.body?.cancel();
        assert.ok(Number.isFinite(seconds) && seconds > 0 && seconds <= 60);
        console.log(JSON.stringify({ rateLimitWaitSeconds: seconds })); await pause(seconds * 1000);
      }
      assert.equal(response.status, 200, `Query ${row.id}/${mode}: HTTP ${response.status}`);
      const body = await response.json(), ms = performance.now() - start;
      assert.equal(body.storeId, storeId); assert.equal(body.partial, false); assert.ok(body.recognition && body.recognition.labelStatus !== "unavailable");
      assert.ok(body.items.length <= 8);
      for (const item of body.items) {
        const scoped = await db.storeProduct.findUniqueOrThrow({ where: { storeId_productId: { storeId, productId: item.id } } });
        assert.equal(scoped.organizationId, organizationId); assert.ok(scoped.isActive && !scoped.isHidden);
      }
      const target = expectedId(row.expectedSku), rank = target ? body.items.findIndex((item) => item.id === target) + 1 : null;
      const outcome = target ? !body.items.length ? "empty" : rank === 1 ? "correct-first" : rank > 1 ? "correct-lower" : "wrong-only" : body.items.length ? "absent-with-candidates" : "absent-empty";
      results.push({ query: row.id, media: row.media, mode, scene: row.scene, light: row.light, pose: row.pose, design: row.design, multiObject: Boolean(row.multiObject), backgroundBoxes: Boolean(row.backgroundBoxes), labelVisible: row.labelVisible, expectedSku: row.expectedSku, expectedId: target, outcome, rank: rank || null, ms, inputSha256: digest(image), items: body.items, recognition: body.recognition });
      console.log(JSON.stringify({ query: row.id, mode, outcome, rank: rank || null, read: body.recognition.text, first: body.items[0]?.name ?? null }));
      await pause(5250); // Stay below the real per-user 12/minute limiter, without changing Redis.
    }
    await writeFile(`${root}/partial-results${runLabel ? `-${runLabel}` : ""}.json`, JSON.stringify({ manifestSha256: digest(bytes), results }, null, 2) + "\n");
  }
  const after = await snapshot(); assert.equal(digest(JSON.stringify(after)), galleryHash, "The catalog or feature gallery was modified");
  assert.equal(digest(JSON.stringify(await original())), seed.originalShopHash);
  const emptyStore = "photo-search-browser-other";
  assert.equal((await db.store.findUniqueOrThrow({ where: { id: emptyStore } })).organizationId, organizationId);
  assert.equal(await db.storeProduct.count({ where: { storeId: emptyStore, isActive: true, isHidden: false } }), 0);
  const form = new FormData(); form.set("file", new File([await sharp(local(fixture.queries[0].file)).jpeg().toBuffer()], "scope.jpg", { type: "image/jpeg" })); form.set("storeId", emptyStore);
  const control = await json("/api/products/photo-search", { method: "POST", body: form }); assert.deepEqual(control.items, []);
  const engineSources = await Promise.all(["engine.py", "vision.py", "server.py", "pipeline.py", "retrieval.py"].map(async (file) => [file, digest(await readFile(`services/product-photo-search/${file}`))]));
  const evidence = { schema: 1, at: new Date().toISOString(), applicationCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), baselineApplicationCommit: fixture.applicationCommit, engineSources: Object.fromEntries(engineSources), runLabel, multiviewManifestSha256: multiview ? digest(await readFile("scripts/qa/fixtures/elfbar-photo-multiview.json")) : null, recoveryManifestSha256: recovery ? digest(await readFile(recoveryPath)) : null, manifestSha256: digest(bytes), realApplicationApi: true, model: prior.model, threshold: prior.threshold, visionModelManifestSha256: digest(await readFile("services/product-photo-search/vision-models.json")), storeId, galleryHash, galleryProgress: status.progress, galleryUnchanged: true, originalShopUnchanged: true, emptyStoreHasNoLeakedCandidates: true, sourceMedia: fixture.media.length, uniqueQueries: fixture.queries.length, results };
  await writeFile(`${root}/results${runLabel ? `-${runLabel}` : ""}.json`, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ completed: true, uniqueQueries: fixture.queries.length, requests: results.length, galleryUnchanged: true }));
  }
} finally { await db.$disconnect(); }

// Reversible QA image-only updates through the existing upload/product APIs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
const recovery = process.argv.includes("--recovery-v2");
const root = resolve(recovery ? ".local/elfbar-recovery-v2" : ".local/elfbar-pp-improve"), organizationId = "photo-search-browser-qa", storeId = "photo-search-field-shop";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const protocolBytes = await readFile(recovery ? "scripts/qa/fixtures/elfbar-recovery-v2.json" : "scripts/qa/fixtures/elfbar-miami-references.json");
const protocol = JSON.parse(protocolBytes);
const fixture = recovery ? { assets: [protocol.reference], removeReferences: [], expectedGalleryPhotos: 39, expectedOriginalShopPhotos: 27 } : protocol;
if (recovery) {
  const experiment = JSON.parse(await readFile(`${root}/reference-experiment.json`));
  assert.equal(experiment.protocolSha256, hash(protocolBytes));
  assert.equal(experiment.newHoldoutUsedAsReference, false); assert.equal(experiment.thresholdRetuned, false);
  for (const row of experiment.summary.filter((row) => row.variant === "miamiRear39")) {
    assert.equal(row.absentWithCandidates, protocol.acceptance.oldAbsentWithCandidates);
    assert.equal(row.wrongFirst, protocol.acceptance.knownWrongFirst);
    if (row.split === "field") assert.ok(row.correctFirst >= protocol.acceptance.singleFieldCorrectMinimum);
    if (row.split === "external") assert.ok(row.correctFirst >= protocol.acceptance.miamiKnownCorrectMinimum);
  }
  assert.equal(experiment.summary.filter((row) => row.variant === "miamiRear39").length, 3);
}
assert.match(await readFile(".local/product-photo-search/DISPOSABLE-TEST-ONLY", "utf8"), /^Disposable (?:internal product photo search|China image search) QA; no customer records\n$/);
const base = new URL(process.env.PRODUCT_PHOTO_QA_BASE_URL);
assert.equal(base.href, "http://192.168.68.109:3158/");
assert.equal(process.env.PRODUCT_PHOTO_QA_EMAIL, "photo-search-admin@example.invalid");
assert.ok(process.env.PRODUCT_PHOTO_QA_PASSWORD);
const db = new PrismaClient({ datasourceUrl: "postgresql://bazaar_test@127.0.0.1:55991/bazaar_hardening_agent4_platform" });
const cookies = new Map();
async function json(path, init = {}) {
  const response = await fetch(new URL(path, base), { ...init, redirect: "error", signal: AbortSignal.timeout(30000), headers: { ...init.headers, origin: base.origin, cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } });
  for (const value of response.headers.getSetCookie()) { const pair = value.split(";")[0], i = pair.indexOf("="); cookies.set(pair.slice(0, i), pair.slice(i + 1)); }
  assert.equal(response.status, 200, `Local QA API ${path}: ${response.status}`); return response.json();
}
try {
  const [identity] = await db.$queryRaw`SELECT current_database() AS database,current_user AS username,inet_server_port() AS port`;
  assert.deepEqual(identity, { database: "bazaar_hardening_agent4_platform", username: "bazaar_test", port: 55991 });
  const user = await db.user.findUniqueOrThrow({ where: { email: process.env.PRODUCT_PHOTO_QA_EMAIL } });
  assert.equal(user.organizationId, organizationId); assert.equal(user.role, "ADMIN");
  for (const id of [storeId, "photo-search-browser-shop"]) assert.equal((await db.store.findUniqueOrThrow({ where: { id } })).organizationId, organizationId);
  const snapshot = async () => db.product.findMany({ where: { organizationId }, orderBy: { id: "asc" }, include: { images: { orderBy: [{ position: "asc" }, { id: "asc" }] }, storeProducts: { orderBy: { storeId: "asc" } } } });
  const before = await snapshot();
  try { await access(`${root}/catalog-before.json`); } catch { await writeFile(`${root}/catalog-before.json`, JSON.stringify(before, null, 2)+"\n"); }
  const csrf = await json("/api/auth/csrf");
  const login = await json("/api/auth/callback/credentials", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken: csrf.csrfToken, email: user.email, password: process.env.PRODUCT_PHOTO_QA_PASSWORD, callbackUrl: base.origin + "/products", json: "true" }) });
  assert.ok(login.url && !login.url.includes("error="));
  const session = await json("/api/auth/session"); assert.equal(session.user.organizationId, organizationId); assert.equal(session.user.id, user.id);
  let changed = 0;
  for (const sku of ["PHOTO-ELFBAR-TEST", "QA-ELFBAR-FIELD-STRAWBERRY-BANANA"]) {
    const product = before.find((p) => p.sku === sku); assert.ok(product);
    const desired = [], existingHashes = new Map();
    for (const image of product.images) {
      assert.ok(image.url.startsWith(`/uploads/imported-products/${organizationId}/`) || image.url.startsWith("/uploads/product-photo-browser-"));
      const digest = hash(await readFile(resolve("public", image.url.slice(1)))); existingHashes.set(digest, image);
      const removal = fixture.removeReferences.find((entry) => entry.sku === sku && entry.sourceSha256 === digest);
      if (removal) {
        assert.notEqual(product.photoUrl, image.url); assert.equal(await db.productVariant.count({ where: { imageId: image.id } }), 0);
        continue; // Only these two registered QA crops; original files stay on disk.
      }
      desired.push({ id: image.id, url: image.url, position: desired.length });
    }
    for (const asset of fixture.assets.filter((entry) => entry.sku === sku)) {
      const bytes = await readFile(`${root}/${asset.file}`); assert.equal(hash(bytes), asset.sha256);
      let image = existingHashes.get(asset.sha256);
      if (!image) {
        const form = new FormData(); form.set("file", new File([bytes], `${asset.id}.jpg`, { type: "image/jpeg" }));
        const upload = await json("/api/product-images/upload", { method: "POST", body: form });
        assert.ok(upload.url.startsWith(`/uploads/imported-products/${organizationId}/`));
        assert.equal(hash(await readFile(resolve("public", upload.url.slice(1)))), asset.sha256);
        image = { url: upload.url };
      }
      if (!desired.some((item) => item.url === image.url)) desired.push({ ...(image.id ? { id: image.id } : {}), url: image.url, position: desired.length });
    }
    if (JSON.stringify(desired.map((i) => i.url)) !== JSON.stringify(product.images.map((i) => i.url))) {
      await json("/api/trpc/products.update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ json: { productId: product.id, sku: product.sku, name: product.name, baseUnitId: product.baseUnitId, expectedUpdatedAt: product.updatedAt.toISOString(), imagesOnly: true, images: desired } }) }); changed++;
    }
  }
  const after = await snapshot();
  const business = ({ images, photoUrl, updatedAt, ...rest }) => rest;
  assert.deepEqual(after.map(business), before.map(business));
  for (const product of after) assert.equal(product.photoUrl, before.find((p) => p.id === product.id).photoUrl, "Primary image must remain unchanged");
  for (const product of after) if (!["PHOTO-ELFBAR-TEST", "QA-ELFBAR-FIELD-STRAWBERRY-BANANA"].includes(product.sku)) assert.deepEqual(product, before.find((p) => p.id === product.id));
  const progress = {};
  for (const [id, total] of [[storeId, fixture.expectedGalleryPhotos], ["photo-search-browser-shop", fixture.expectedOriginalShopPhotos]]) {
    for (let attempt = 0; attempt < 60; attempt++) {
      progress[id] = (await json("/api/products/photo-search/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId: id }) })).progress;
      if (!progress[id].pending) break; await pause(2000);
    }
    assert.equal(progress[id].total, total); assert.equal(progress[id].ready, total); assert.equal(progress[id].failed, 0);
  }
  await writeFile(`${root}/augmentation.json`, JSON.stringify({ changed, progress, businessFieldsUnchanged: true, unrelatedProductsUnchanged: true, primaryPhotosPreserved: true, removedFilesPreserved: true }, null, 2)+"\n");
  console.log(JSON.stringify({ changed, progress }));
} finally { await db.$disconnect(); }

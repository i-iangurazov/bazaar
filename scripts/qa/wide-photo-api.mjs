// Fixed disposable shop; real uploads, worker preparation and authenticated search.
import assert from "node:assert/strict";
import { readFile, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";

const root = resolve(".local/product-photo-wide"), org = "photo-search-browser-qa", storeId = "photo-search-wide-20261115";
const mode = process.argv[2]; assert.ok(["seed", "evaluate"].includes(mode));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const raw = await readFile(`${root}/inputs.json`), inputs = JSON.parse(raw);
const policy = JSON.parse(await readFile("scripts/qa/fixtures/product-photo-wide-policy.json"));
assert.equal(inputs.policySha256, hash(await readFile("scripts/qa/fixtures/product-photo-wide-policy.json")));
assert.match(await readFile(".local/product-photo-search/DISPOSABLE-TEST-ONLY", "utf8"), /^Disposable (?:internal product photo search|China image search) QA; no customer records\n$/);
const base = new URL(process.env.PRODUCT_PHOTO_QA_BASE_URL); assert.equal(base.href, "http://192.168.68.109:3158/");
assert.equal(process.env.PRODUCT_PHOTO_QA_EMAIL, "photo-search-admin@example.invalid"); assert.ok(process.env.PRODUCT_PHOTO_QA_PASSWORD);
const db = new PrismaClient({ datasourceUrl: "postgresql://bazaar_test@127.0.0.1:55991/bazaar_hardening_agent4_platform" });
const cookies = new Map();
async function request(path, init = {}) {
  const response = await fetch(new URL(path, base), { ...init, redirect: "manual", signal: AbortSignal.timeout(30000), headers: { ...init.headers, origin: base.origin, cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join("; ") } });
  for (const value of response.headers.getSetCookie()) { const pair = value.split(";")[0], at = pair.indexOf("="); cookies.set(pair.slice(0,at), pair.slice(at+1)); }
  return response;
}
async function json(path, init = {}) {
  let r = await request(path, init);
  if (r.status === 429) { const seconds = Number(r.headers.get("retry-after")); assert.ok(seconds > 0 && seconds <= 60); await r.body?.cancel(); await pause(seconds*1000); r = await request(path, init); }
  assert.equal(r.status, 200, `QA API ${path}: ${r.status}`); return r.json();
}
const productId = (id) => `photo-wide-${id}`;
const snapshot = async (excludeWide = false) => ({
  organization: await db.organization.findUniqueOrThrow({ where: { id: org } }),
  users: await db.user.findMany({ where: { organizationId: org }, orderBy: { id: "asc" } }),
  stores: await db.store.findMany({ where: { organizationId: org, ...(excludeWide ? { id: { not: storeId } } : {}) }, orderBy: { id: "asc" } }),
  products: await db.product.findMany({ where: { organizationId: org, ...(excludeWide ? { NOT: { id: { startsWith: "photo-wide-" } } } : {}) }, orderBy: { id: "asc" }, include: { images: { orderBy: { id: "asc" } }, storeProducts: { orderBy: { storeId: "asc" } } } }),
});
try {
  const [identity] = await db.$queryRaw`SELECT current_database() AS database,current_user AS username,inet_server_port() AS port`;
  assert.deepEqual(identity, { database: "bazaar_hardening_agent4_platform", username: "bazaar_test", port: 55991 });
  const user = await db.user.findUniqueOrThrow({ where: { email: process.env.PRODUCT_PHOTO_QA_EMAIL } });
  assert.equal(user.organizationId, org); assert.equal(user.role, "ADMIN");
  const csrf = await json("/api/auth/csrf");
  const login = await json("/api/auth/callback/credentials", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken: csrf.csrfToken, email: user.email, password: process.env.PRODUCT_PHOTO_QA_PASSWORD, json: "true", callbackUrl: base.origin+"/products" }) });
  assert.ok(login.url && !login.url.includes("error="));
  const session = await json("/api/auth/session"); assert.equal(session.user.id, user.id); assert.equal(session.user.organizationId, org);
  const gallery = inputs.entries.filter((r) => r.role === "gallery"), known = inputs.products.filter((p) => p.known);
  // Local image storage is content addressed; the application deduplicates URLs per product.
  const gallerySources = new Set(gallery.map((r) => `${r.productId}:${r.sha256}`)).size;
  if (mode === "seed") {
    const before = JSON.stringify(await snapshot(true));
    try { await access(`${root}/manual-before.json`); } catch { await writeFile(`${root}/manual-before.json`, before+"\n"); }
    const unit = await db.unit.findUniqueOrThrow({ where: { organizationId_code: { organizationId: org, code: "each" } } });
    const store = await db.store.upsert({ where: { id: storeId }, update: {}, create: { id: storeId, organizationId: org, name: "Открытый ассортимент — фото (тест)", code: storeId, currencyCode: "KGS" } });
    assert.equal(store.organizationId, org);
    for (const product of known) {
      const id = productId(product.id);
      const record = await db.product.upsert({ where: { id }, update: {}, create: { id, organizationId: org, name: product.name, sku: "QA-WIDE-"+product.id, unit: "each", baseUnitId: unit.id } });
      assert.equal(record.organizationId, org); assert.equal(record.name, product.name);
      await db.storeProduct.upsert({ where: { storeId_productId: { storeId, productId: id } }, update: {}, create: { organizationId: org, storeId, productId: id, isActive: true } });
      for (const [position, photo] of gallery.filter((r) => r.productId === product.id).entries()) {
        const imageId = "photo-wide-image-"+photo.id;
        let image = await db.productImage.findUnique({ where: { id: imageId } });
        if (!image) {
          const bytes = await readFile(`${root}/${photo.file}`); assert.equal(hash(bytes), photo.sha256);
          const form = new FormData(); form.set("productId", id); form.set("file", new File([bytes], photo.id+".jpg", { type: "image/jpeg" }));
          const upload = await json("/api/product-images/upload", { method: "POST", body: form });
          assert.ok(upload.url.startsWith(`/uploads/imported-products/${org}/`));
          assert.equal(hash(await readFile(resolve("public", upload.url.slice(1)))), photo.sha256);
          image = await db.productImage.create({ data: { id: imageId, organizationId: org, productId: id, url: upload.url, position } });
        }
        assert.equal(image.productId, id); assert.equal(image.organizationId, org);
        if (!position && !record.photoUrl) await db.product.update({ where: { id }, data: { photoUrl: image.url } });
      }
    }
    let progress;
    for (let n = 0; n < 180; n++) {
      progress = (await json("/api/products/photo-search/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId }) })).progress;
      if (!progress.pending) break; await pause(2000);
    }
    assert.equal(progress.total, gallerySources); assert.equal(progress.ready, gallerySources); assert.equal(progress.failed, 0);
    assert.equal(JSON.stringify(await snapshot(true)), before, "Existing organization, users, products and stores must remain unchanged");
    assert.equal(JSON.stringify(await snapshot(true)), (await readFile(`${root}/manual-before.json`, "utf8")).trim(), "Original records must also survive interrupted setup");
    await writeFile(`${root}/seed.json`, JSON.stringify({ storeId, knownProducts: known.length, galleryPhotos: gallery.length, uniqueGallerySources: gallerySources, progress, oldRecordsUnchanged: true, realUploadApi: true, fixtureRowsOnly: true }, null, 2)+"\n");
    console.log(JSON.stringify({ storeId, products: known.length, progress }));
  } else {
    assert.equal((await db.store.findUniqueOrThrow({ where: { id: storeId } })).organizationId, org);
    const before = hash(JSON.stringify(await snapshot()));
    const featuresBefore = hash(JSON.stringify(await db.productPhotoFeature.findMany({ where: { organizationId: org }, orderBy: { id: "asc" } })));
    const status = await json(`/api/products/photo-search?storeId=${storeId}`); assert.equal(status.progress.ready, gallerySources);
    const key = (s) => hash(Buffer.from(policy.seed+":"+s));
    const selected = [];
    for (const category of Object.keys(policy.sources.sop.categoryImageCounts)) for (const isKnown of [true,false]) {
      const products = inputs.products.filter((p) => p.dataset === "sop" && p.category === category && p.known === isKnown).sort((a,b) => key(a.id).localeCompare(key(b.id)));
      selected.push(inputs.entries.find((r) => r.role === "query" && r.productId === products[0].id));
    }
    for (const family of ["Fruit", "Packages", "Vegetables"]) for (const isKnown of [true,false]) {
      const products = inputs.products.filter((p) => p.dataset === "grocery" && p.family === family && p.known === isKnown).sort((a,b) => key(a.id).localeCompare(key(b.id))).slice(0,4);
      selected.push(...products.map((p) => inputs.entries.find((r) => r.role === "query" && r.productId === p.id)));
    }
    assert.equal(selected.length, 48); assert.ok(selected.every(Boolean));
    await writeFile(`${root}/api-selection.json`, JSON.stringify(selected.map((r) => r.id), null, 2)+"\n");
    const allowed = new Set(known.map((p) => productId(p.id))), results = [];
    for (const query of selected) {
      const bytes = await readFile(`${root}/${query.file}`); assert.equal(hash(bytes), query.sha256);
      const form = new FormData(); form.set("storeId", storeId); form.set("file", new File([bytes], query.id+".jpg", { type: "image/jpeg" }));
      const start = performance.now(), body = await json("/api/products/photo-search", { method: "POST", body: form });
      assert.equal(body.storeId, storeId); assert.equal(body.partial, false);
      assert.ok(body.items.every((item) => allowed.has(item.id)));
      results.push({ query: query.id, dataset: query.dataset, known: query.known, expectedId: query.known ? productId(query.productId) : null, ms: performance.now()-start, response: body });
      await writeFile(`${root}/api-partial.json`, JSON.stringify({ results }, null, 2)+"\n");
      console.log(JSON.stringify({ query: query.id, first: body.items[0]?.sku ?? null })); await pause(5250);
    }
    const form = new FormData(); form.set("storeId", "photo-search-browser-other"); form.set("file", new File([await readFile(`${root}/${selected[0].file}`)], "empty.jpg", { type: "image/jpeg" }));
    assert.deepEqual((await json("/api/products/photo-search", { method: "POST", body: form })).items, []);
    assert.equal(hash(JSON.stringify(await snapshot())), before);
    assert.equal(hash(JSON.stringify(await db.productPhotoFeature.findMany({ where: { organizationId: org }, orderBy: { id: "asc" } }))), featuresBefore);
    await writeFile(`${root}/api.json`, JSON.stringify({ schema: 1, inputSha256: hash(raw), realApplicationApi: true, allHttp200: true, catalogAndFeatureCacheUnchanged: true, emptyStoreHasNoLeak: true, storeId, results }, null, 2)+"\n");
  }
} finally { await db.$disconnect(); }

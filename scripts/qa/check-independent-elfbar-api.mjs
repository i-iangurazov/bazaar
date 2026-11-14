// Actual unchanged app baseline (PP + existing OCR), only in the fixed disposable shop.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";

const improved = process.argv.includes("--miami-improvement");
const cohort = process.argv.find((arg) => arg.startsWith("--cohort="))?.slice(9) ?? "independent";
assert.ok(["independent", "field", "legacy"].includes(cohort));
assert.ok(improved || cohort === "independent");
const photoRoot = resolve(".local/elfbar-independent");
const root = improved ? resolve(".local/elfbar-pp-improve") : photoRoot;
const storeId = cohort === "legacy" ? "photo-search-browser-shop" : "photo-search-field-shop", organizationId = "photo-search-browser-qa";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const inputsBytes = await readFile(`${photoRoot}/frozen-inputs.json`), inputs = JSON.parse(inputsBytes);
const protocol = JSON.parse(await readFile("scripts/qa/fixtures/elfbar-independent-evaluation.json"));
assert.equal(hash(inputsBytes), protocol.frozenInputSha256);
assert.match(await readFile(".local/product-photo-search/DISPOSABLE-TEST-ONLY", "utf8"), /^Disposable (?:internal product photo search|China image search) QA; no customer records\n$/);
const base = new URL(process.env.PRODUCT_PHOTO_QA_BASE_URL);
assert.equal(base.origin, "http://192.168.68.109:3158");
assert.equal(base.pathname, "/"); assert.ok(!base.username && !base.password && !base.search && !base.hash);
assert.equal(process.env.PRODUCT_PHOTO_QA_EMAIL, "photo-search-admin@example.invalid");
assert.ok(process.env.PRODUCT_PHOTO_QA_PASSWORD);
const db = new PrismaClient({ datasourceUrl: "postgresql://bazaar_test@127.0.0.1:55991/bazaar_hardening_agent4_platform" });
const cookies = new Map();
async function request(path, init = {}) {
  assert.ok(path.startsWith("/") && !path.startsWith("//"));
  const response = await fetch(new URL(path, base), { ...init, headers: { ...init.headers, origin: base.origin,
    cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; ") }, redirect: "manual", signal: AbortSignal.timeout(30000) });
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";")[0], equals = pair.indexOf("="); cookies.set(pair.slice(0, equals), pair.slice(equals + 1));
  }
  return response;
}
async function json(path, init = {}) {
  let response = await request(path, init);
  if (response.status === 429) {
    const seconds = Number(response.headers.get("retry-after"));
    assert.ok(Number.isFinite(seconds) && seconds > 0 && seconds <= 60);
    await response.body?.cancel(); await pause(seconds * 1000); response = await request(path, init);
  }
  assert.equal(response.status, 200, `Unexpected local API status ${response.status}`);
  return response.json();
}
try {
  const [identity] = await db.$queryRaw`SELECT current_database() AS database,current_user AS username,inet_server_port() AS port`;
  assert.deepEqual(identity, { database: "bazaar_hardening_agent4_platform", username: "bazaar_test", port: 55991 });
  const user = await db.user.findUniqueOrThrow({ where: { email: process.env.PRODUCT_PHOTO_QA_EMAIL } });
  assert.equal(user.organizationId, organizationId); assert.equal(user.role, "ADMIN");
  assert.equal((await db.store.findUniqueOrThrow({ where: { id: storeId } })).organizationId, organizationId);
  const snapshot = async () => ({ products: await db.product.findMany({ where: { organizationId }, orderBy: { id: "asc" }, include: { images: { orderBy: { id: "asc" } }, storeProducts: { orderBy: { storeId: "asc" } } } }), features: await db.productPhotoFeature.findMany({ where: { organizationId }, orderBy: { id: "asc" } }) });
  const before = hash(JSON.stringify(await snapshot()));
  if (!improved) assert.equal(before, inputs.catalogHash);
  else {
    const proof = JSON.parse(await readFile(`${root}/augmentation.json`));
    assert.equal(proof.businessFieldsUnchanged, true); assert.equal(proof.unrelatedProductsUnchanged, true);
  }
  const csrf = await json("/api/auth/csrf");
  const login = await json("/api/auth/callback/credentials", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: csrf.csrfToken, email: user.email, password: process.env.PRODUCT_PHOTO_QA_PASSWORD, callbackUrl: base.origin + "/products", json: "true" }) });
  assert.ok(login.url && !login.url.includes("error="));
  const session = await json("/api/auth/session"); assert.equal(session.user.id, user.id); assert.equal(session.user.organizationId, organizationId);
  const status = await json(`/api/products/photo-search?storeId=${storeId}`);
  const total = cohort === "legacy" ? 26 : 38;
  assert.equal(status.configured, true); assert.equal(status.progress.total, total); assert.equal(status.progress.ready, total);
  const current = await db.product.findMany({ where: { organizationId, isDeleted: false, storeProducts: { some: { organizationId, storeId, isActive: true, isHidden: false } } }, select: { id: true } });
  const allowed = new Set(current.map((p) => p.id)), results = [];
  let queries = inputs.queries;
  const prior = cohort !== "independent" ? JSON.parse(await readFile(".local/elfbar-model-comparison/frozen-inputs.json")) : null;
  const field = cohort === "field" ? JSON.parse(await readFile("scripts/qa/fixtures/elfbar-photo-field.json")) : null;
  if (prior) queries = prior[cohort === "field" ? "test" : "calibration"].queries;
  for (const query of queries) {
    let bytes;
    if (cohort === "independent") {
      const file = resolve(photoRoot, query.originalFile); assert.ok(!relative(photoRoot, file).startsWith(".."));
      bytes = await readFile(file); assert.equal(hash(bytes), query.originalSha256);
    } else if (cohort === "field") {
      const original = field.queries.find((row) => row.id === query.id); assert.ok(original);
      const raw = await readFile(resolve(".local/elfbar-field-check", original.file)); assert.equal(hash(raw), original.sha256);
      bytes = await sharp(raw).rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).flatten({ background: "white" }).jpeg({ quality: 90 }).toBuffer();
    } else {
      bytes = await readFile(`.local/elfbar-photo-check/queries/${query.id}.jpg`);
    }
    for (const mode of cohort === "field" && query.region ? ["auto", "manual"] : ["auto"]) {
    const form = new FormData(); form.set("storeId", storeId); form.set("file", new File([bytes], `${query.id}.jpg`, { type: "image/jpeg" }));
    if (mode === "manual") form.set("region", JSON.stringify(query.region));
    const start = performance.now(), body = await json("/api/products/photo-search", { method: "POST", body: form });
    assert.equal(body.storeId, storeId); assert.equal(body.partial, false);
    assert.ok(body.recognition && body.items.length <= 8);
    for (const item of body.items) {
      assert.ok(allowed.has(item.id));
      const scoped = await db.storeProduct.findUniqueOrThrow({ where: { storeId_productId: { storeId, productId: item.id } } });
      assert.equal(scoped.organizationId, organizationId); assert.ok(scoped.isActive && !scoped.isHidden);
    }
    results.push({ query: query.id, mode, multiObject: Boolean(query.multiObject), expectedId: query.expectedId, expectedFlavor: query.expectedFlavor,
      canonicalInputSha256: query.sha256, ms: performance.now()-start, items: body.items, recognition: body.recognition });
    console.log(JSON.stringify({ query: query.id, first: body.items[0]?.sku ?? null, labelStatus: body.recognition.labelStatus }));
    await writeFile(`${root}/api-${cohort}-partial.json`, JSON.stringify({ results }, null, 2)+"\n");
    await pause(5250);
    }
  }
  const emptyStore = "photo-search-browser-other";
  assert.equal((await db.store.findUniqueOrThrow({ where: { id: emptyStore } })).organizationId, organizationId);
  assert.equal(await db.storeProduct.count({ where: { storeId: emptyStore, isActive: true, isHidden: false } }), 0);
  const controlForm = new FormData(); controlForm.set("storeId", emptyStore);
  controlForm.set("file", new File([await readFile(resolve(photoRoot, inputs.queries[0].originalFile))], "scope.jpg", { type: "image/jpeg" }));
  const control = await json("/api/products/photo-search", { method: "POST", body: controlForm }); assert.deepEqual(control.items, []);
  assert.equal(hash(JSON.stringify(await snapshot())), before);
  const known = results.filter((r) => r.expectedId), absent = results.filter((r) => !r.expectedId);
  const summary = { known: known.length, knownCorrectFirst: known.filter((r) => r.items[0]?.id === r.expectedId).length,
    knownWrongFirst: known.filter((r) => r.items.length && r.items[0]?.id !== r.expectedId).length,
    absent: absent.length, absentWithCandidates: absent.filter((r) => r.items.length).length };
  const evidence = { schema: 1, applicationChanged: improved, cohort, realApplicationApi: true, model: improved ? "PP-ShiTu + PP-OCRv6 medium; improved reference gallery" : "Current PP-ShiTu + existing OCR",
    storeId, frozenInputSha256: hash(inputsBytes), galleryUnchanged: true, emptyStoreHasNoLeakedCandidates: true,
    catalogWrites: false, authenticationAndRateLimitStateMayChange: true, results, summary };
  await writeFile(`${root}/${improved ? `api-${cohort}` : "api-results"}.json`, JSON.stringify(evidence, null, 2)+"\n");
  console.log(JSON.stringify(summary));
} finally { await db.$disconnect(); }

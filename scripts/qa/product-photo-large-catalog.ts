/** Opt-in smoke: real Bazaar API, PostgreSQL, Redis and a local compact model. */
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { encode } from "next-auth/jwt";
import { GET, POST } from "@/app/api/products/photo-search/route";
import { POST as prepare } from "@/app/api/products/photo-search/prepare/route";
import { prisma } from "@/server/db/prisma";
import { getRedisPublisher } from "@/server/redis";
import { productPhotoSearchModel } from "@/lib/productPhotoSearch";
import { loadPhotoSearchScope } from "@/server/services/productPhotoSearchScope";
import { processNextProductPhoto } from "@/server/services/productPhotoSearchWorker";
import { assertSafeTestDatabaseReset } from "../../tests/helpers/testDatabaseSafety";
import { resetDatabase, seedBase } from "../../tests/helpers/db";

const photos = 63_499;
const products = 5_934;
const revision = new Date("2026-11-22T12:00:00.000Z");
const base = "http://localhost:56173";
const api = base + "/api/products/photo-search";

const { databaseUrl } = assertSafeTestDatabaseReset();
const db = new URL(databaseUrl);
assert.equal(db.origin, "null"); // A PostgreSQL URL, never an HTTP target.
assert.equal(db.hostname, "127.0.0.1");
assert.equal(db.port, "56171");
assert.equal(db.pathname, "/bazaar_hardening_ci");
assert.equal(process.env.DATABASE_URL, databaseUrl);
assert.equal(process.env.REDIS_URL, "redis://127.0.0.1:56172");
assert.equal(process.env.NEXTAUTH_URL, base);
assert.equal(process.env.PRODUCT_PHOTO_SEARCH_STREAMING, "1");
const engine = new URL(process.env.PRODUCT_PHOTO_SEARCH_URL!);
assert(["56174", "56175"].includes(engine.port) && engine.hostname === "127.0.0.1" && engine.protocol === "http:");
assert.match(resolve(process.argv[2] ?? ""), /^\/private\/tmp\/bazaar-photo-scale\.[A-Za-z0-9]+$|^\/tmp\/bazaar-photo-scale\.[A-Za-z0-9]+$/);
await readFile(resolve(process.argv[2], "DISPOSABLE-TEST-ONLY"));
const [target] = await prisma.$queryRaw<{ name: string; port: number; username: string }[]>`
  SELECT current_database() AS name, inet_server_port() AS port, current_user AS username
`;
assert.deepEqual(target, { name: "bazaar_hardening_ci", port: 56171, username: "bazaar_test" });

await mkdir("public/uploads", { recursive: true });
const uploadDir = await mkdtemp("public/uploads/photo-scale-");
try {
  await resetDatabase();
  const f = await seedBase();
  const org = f.org.id;
  const store = f.store.id;
  const product = f.product.id;
  const file = "/uploads/" + basename(uploadDir) + "/reference.jpg";
  const publicPhotos = ".local/photo-search-benchmark/images/103";
  await copyFile(publicPhotos + "/103_r0.jpg", resolve(uploadDir, "reference.jpg"));
  await prisma.product.update({ where: { id: product }, data: { basePriceKgs: 129, name: "Футбольный мяч" } });
  // Fixtures only. Populate the real database at the observed store's size.
  await prisma.$executeRaw`
    INSERT INTO "Product" (id, "organizationId", sku, name, unit, "baseUnitId", "updatedAt")
    SELECT 'photo-qa-p-' || i, ${org}, 'PHOTO-QA-' || i, 'Synthetic product ' || i,
           ${f.product.unit}, ${f.product.baseUnitId}, ${revision}
    FROM generate_series(1, ${products - 1}::int) AS i
  `;
  await prisma.$executeRaw`
    INSERT INTO "StoreProduct" (id, "organizationId", "storeId", "productId", "updatedAt")
    SELECT 'photo-qa-sp-' || i, ${org}, ${store}, 'photo-qa-p-' || i, ${revision}
    FROM generate_series(1, ${products - 1}::int) AS i
  `;
  await prisma.$executeRaw`
    INSERT INTO "ProductImage" (id, "organizationId", "productId", url, position, "updatedAt")
    SELECT 'photo-qa-img-' || i, ${org},
           CASE WHEN i = ${photos} THEN ${product} ELSE 'photo-qa-p-' || ((i - 1) % ${products - 1}::int + 1) END,
           CASE WHEN i = ${photos} THEN ${file} ELSE '/uploads/photo-qa-decoy-' || i || '.jpg' END,
           i, ${revision}
    FROM generate_series(1, ${photos}::int) AS i
  `;
  const cookie = async (user = f.adminUser) => "next-auth.session-token=" + await encode({
    secret: process.env.NEXTAUTH_SECRET!, token: { sub: user.id, sessionVersion: user.sessionVersion, role: user.role, organizationId: org },
  });
  const session = await cookie();
  const auth = { cookie: session, origin: base };
  const t0 = performance.now();
  const prepared = await prepare(new Request(api + "/prepare", {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ storeId: store }),
  }));
  assert.equal(prepared.status, 200);
  assert.equal((await prepared.json()).progress.pending, photos);
  const prepareMs = Math.round(performance.now() - t0);
  // Process the last reference through the real worker. Temporarily defer the
  // synthetic photos that model existing, precomputed entries in the gallery.
  await prisma.productPhotoFeature.updateMany({
    where: { organizationId: org, productId: { not: product } }, data: { retryAfter: new Date(Date.now() + 120_000) },
  });
  assert.equal(await processNextProductPhoto(), org);
  const reference = await prisma.productPhotoFeature.findFirstOrThrow({ where: { organizationId: org, productId: product } });
  assert.equal(reference.status, "READY");
  assert.equal(reference.modelVersion, productPhotoSearchModel);
  const negative = "{" + reference.embedding.map((value) => -value).join(",") + "}";
  await prisma.$executeRaw`
    UPDATE "ProductPhotoFeature" SET status = 'READY', embedding = ${negative}::real[]
    WHERE "organizationId" = ${org} AND "productId" <> ${product}
  `;
  const scope = await loadPhotoSearchScope({ ...f.adminUser, organizationId: org }, store);
  assert.equal(scope.sources.length, photos);
  assert.equal(scope.products.length, products);
  assert.equal(scope.sources.at(-1)?.productId, product);
  const status = await GET(new Request(api + "?storeId=" + store, { headers: auth }));
  assert.equal(status.status, 200);
  assert.deepEqual((await status.json()).progress, { total: photos, ready: photos, pending: 0, failed: 0, withoutPhoto: 0 });

  const other = await prisma.store.create({ data: { organizationId: org, name: "Other scope", code: "PHOTO-OTHER" } });
  const makeQuery = async (storeId: string, headers: Record<string, string>) => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(await readFile(publicPhotos + "/103_r30.jpg"))], "held-out.jpg", { type: "image/jpeg" }));
    form.set("storeId", storeId);
    return POST(new Request(api, { method: "POST", headers, body: form }));
  };
  const start = performance.now();
  const response = await makeQuery(store, auth);
  const body = await response.json();
  const searchMs = Math.round(performance.now() - start);
  assert.equal(response.status, 200, JSON.stringify(body).slice(0, 400));
  assert.equal(body.items[0]?.id, product);
  assert.equal(body.items[0]?.priceKgs, 129);
  assert.equal(body.items.length, 1);
  assert.equal(body.partial, false);
  const denied = await makeQuery(other.id, { cookie: await cookie(f.cashierUser), origin: base });
  assert.equal(denied.status, 403);
  assert.equal((await makeQuery(store, {})).status, 401);
  console.log(JSON.stringify({ photos, products, prepareMs, searchMs, lastPhotoFound: true,
    realWorkerIndexedReference: true, unauthorized401: true, unassignedStore403: true,
    originalGallerySynthetic: true, pending: 0, partial: false }));
} finally {
  await rm(uploadDir, { recursive: true, force: true });
  getRedisPublisher()?.disconnect();
  await prisma.$disconnect();
}

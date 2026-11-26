import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encode } from "next-auth/jwt";
import sharp from "sharp";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { GET, POST } from "@/app/api/products/photo-search/route";
import { POST as PREPARE } from "@/app/api/products/photo-search/prepare/route";
import { prisma } from "@/server/db/prisma";
import { getRedisPublisher } from "@/server/redis";
import { productPhotoSearchModel as modelVersion } from "@/lib/productPhotoSearch";
import { productPhotoIndexRevision } from "@/server/services/productPhotoIndexRevision";
import { presentPreparedPhotoCandidates } from "@/server/services/productPhotoSearch";
import { photoSourceKey, preparePhotoSearch, loadPhotoSearchScope } from "@/server/services/productPhotoSearchScope";
import { processNextProductPhoto } from "@/server/services/productPhotoSearchWorker";
import { createContractTerms } from "@/server/billing/contractTerms";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const suite = shouldRunDbTests ? describe : describe.skip;
const base = "http://localhost:3158";
const endpoint = `${base}/api/products/photo-search`;
const vector = [1, ...Array<number>(511).fill(0)];
const uploadPath = "public/uploads/product-photo-integration-only.jpg";
let f: Awaited<ReturnType<typeof seedBase>>;
let image: Buffer;
let transport: ReturnType<typeof vi.fn>;
const cookie = async (user = f.adminUser, claims: Record<string, unknown> = {}) => `next-auth.session-token=${await encode({ secret: process.env.NEXTAUTH_SECRET!, token: {
  sub: user.id, sessionVersion: user.sessionVersion, role: user.role, organizationId: user.organizationId ?? undefined, ...claims,
} })}`;
const prepare = async (auth: string, storeId = f.store.id, retryFailed = false) => PREPARE(new Request(`${endpoint}/prepare`, {
  method: "POST", headers: { cookie: auth, origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ storeId, retryFailed }),
}));
const query = async (auth: string, options: { storeId?: string; partial?: boolean; buffer?: Buffer; origin?: string; region?: unknown; autoRegion?: string } = {}) => {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(options.buffer ?? image)], "photo.jpg", { type: "image/jpeg" }));
  form.set("storeId", options.storeId ?? f.store.id);
  form.set("allowPartial", options.partial ? "1" : "0");
  if (options.region !== undefined) form.set("region", typeof options.region === "string" ? options.region : JSON.stringify(options.region));
  if (options.autoRegion !== undefined) form.set("autoRegion", options.autoRegion);
  return POST(new Request(endpoint, { method: "POST", headers: { cookie: auth, origin: options.origin ?? base }, body: form }));
};
async function ready() {
  await prisma.product.update({ where: { id: f.product.id }, data: { photoUrl: "/uploads/product-photo-integration-only.jpg", basePriceKgs: 123 } });
  await preparePhotoSearch({ ...f.adminUser, organizationId: f.org.id }, f.store.id, false);
  await prisma.productPhotoFeature.updateMany({ data: { status: "READY", embedding: vector } });
}
async function clearRates() {
  const redis = getRedisPublisher()!;
  const keys = await redis.keys("*product-photo:*");
  const prefix = redis.options.keyPrefix ?? "";
  if (keys.length) await redis.del(...keys.map((key) => key.startsWith(prefix) ? key.slice(prefix.length) : key));
}
suite("internal photo search: isolated PostgreSQL, Redis and authentication", () => {
  beforeEach(async () => {
    await resetDatabase(); f = await seedBase(); await clearRates();
    vi.stubEnv("PRODUCT_PHOTO_SEARCH_URL", "http://127.0.0.1:3160");
    vi.stubEnv("PRODUCT_PHOTO_SEARCH_TOKEN", "synthetic-private-engine-key-at-least-32-chars");
    image = await sharp({ create: { width: 80, height: 60, channels: 3, background: "red" } })
      .withMetadata({ exif: { IFD0: { Artist: "private-query-metadata" } } }).jpeg().toBuffer();
    transport = vi.fn(async (url: URL | string) => Response.json(String(url).endsWith("/health")
      ? { modelVersion, dimension: 512, ready: true }
      : String(url).endsWith("/embed") ? { modelVersion, embedding: vector }
      : { modelVersion, matches: [{ index: 0, score: 0.93 }] }));
    vi.stubGlobal("fetch", transport);
  });
  afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); await rm(uploadPath, { force: true }); });

  it("is free for all roles and plans, including modern starter and expired read access", async () => {
    await ready();
    await prisma.subscriptionContract.create({ data: { organizationId: f.org.id, catalogVersion: "2026-11", termsSnapshot: createContractTerms("2026-11") } });
    for (const plan of ["STARTER", "BUSINESS", "ENTERPRISE"] as const) {
      await prisma.organization.update({ where: { id: f.org.id }, data: { plan, currentPeriodEndsAt: new Date(0), subscriptionStatus: "CANCELED" } });
      for (const user of [f.adminUser, f.managerUser, f.staffUser, f.cashierUser]) {
        const response = await query(await cookie(user)); expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ storeId: f.store.id, items: [{ id: f.product.id, priceKgs: 123, onHand: 0 }], partial: false });
      }
    }
    expect(await prisma.productImage.count()).toBe(0);
    expect(await prisma.product.count()).toBe(1);
    expect(await prisma.subscriptionUsageReservation.count()).toBe(0);
  });
  it("uses the prepared store index and rejects a catalog change during inference", async () => {
    await ready();
    vi.stubEnv("PRODUCT_PHOTO_SEARCH_STREAMING", "1");
    vi.stubEnv("PRODUCT_PHOTO_SEARCH_PACKED", "1");
    const feature = await prisma.productPhotoFeature.findFirstOrThrow({ where: { organizationId: f.org.id } });
    const revision = await productPhotoIndexRevision(prisma, f.org.id, f.store.id);
    if (!revision) throw new Error("Expected the isolated catalog revision");
    const index = { revision, count: 1, withoutPhoto: 0 };
    const analysis = { regionSource: "full", region: null, ocrStatus: "ready", lines: [] } as const;
    transport.mockImplementation(async (url, options) => {
      expect(String(url)).toBe("http://127.0.0.1:3160/snapshot-search");
      const body = JSON.parse(options.body);
      expect(body).toMatchObject({ organizationId: f.org.id, storeId: f.store.id });
      expect(body.vectorsBase64).toBeUndefined();
      return Response.json({ modelVersion, snapshot: index, analysis, matches: [{ index: 0, score: 0.93, sourceKey: feature.sourceKey }] });
    });

    const auth = await cookie(f.cashierUser);
    const before = await query(auth);
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({ items: [{ id: f.product.id, priceKgs: 123 }], partial: false });
    await prisma.storeProduct.update({
      where: { storeId_productId: { storeId: f.store.id, productId: f.product.id } }, data: { isHidden: true },
    });
    await expect(presentPreparedPhotoCandidates({ ...f.cashierUser, organizationId: f.org.id }, f.store.id,
      { index, analysis: { ...analysis, lines: [] }, sourceKeys: [feature.sourceKey] })).rejects.toThrow("photoSearchPreparing");
  });
  it("revalidates identities and grants and rejects foreign and unassigned stores before inference", async () => {
    await ready();
    const foreign = await prisma.organization.create({ data: { name: "Foreign" } });
    const store = await prisma.store.create({ data: { organizationId: foreign.id, name: "Foreign", code: "F" } });
    const sameOrgStore = await prisma.store.create({ data: { organizationId: f.org.id, name: "Unassigned", code: "U" } });
    expect((await query("")).status).toBe(401);
    expect((await query(await cookie(), { storeId: store.id })).status).toBe(403);
    expect((await prepare(await cookie(f.staffUser), sameOrgStore.id)).status).toBe(403);
    const forged = await query(await cookie(f.staffUser, { role: "ADMIN", organizationId: foreign.id }));
    expect(forged.status).toBe(200); // DB identity wins over forged claims; still own store.
    expect(JSON.stringify(await forged.json())).not.toContain(foreign.id);
    const token = await cookie(f.staffUser);
    await prisma.userStoreAccess.deleteMany({ where: { userId: f.staffUser.id } });
    expect((await query(token)).status).toBe(403);
    await prisma.user.update({ where: { id: f.staffUser.id }, data: { isActive: false } });
    expect((await query(token)).status).toBe(401);
    await prisma.user.update({ where: { id: f.adminUser.id }, data: { sessionVersion: { increment: 1 } } });
    expect((await query(await cookie())).status).toBe(401);
  });
  it("checks regions before inference and preserves a manual choice through the private protocol", async () => {
    await ready();
    for (const region of ["not-json", [], { x: -1, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 2, height: 1 }, { x: 0, y: 0, width: 0, height: 1 }])
      expect((await query(await cookie(), { region })).status).toBe(400);
    expect((await query(await cookie(), { autoRegion: "anything" })).status).toBe(400);
    expect(transport).not.toHaveBeenCalled();
    const region = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
    transport.mockImplementation(async (_url, init) => {
      expect(JSON.parse(init.body).region).toEqual(region);
      return Response.json({ modelVersion, matches: [{ index: 0, score: 0.9 }], analysis: { regionSource: "manual", region, ocrStatus: "unavailable", lines: [] } });
    });
    expect(await (await query(await cookie(), { region })).json()).toMatchObject({ recognition: { regionSource: "manual", region } });
  });
  it("reranks close visual candidates using names and marks a separate exact text result when visual matching misses", async () => {
    await ready();
    await prisma.product.update({ where: { id: f.product.id }, data: { name: "ELFBAR GH23000 Pineapple Plums Lime Mint" } });
    await preparePhotoSearch({ ...f.adminUser, organizationId: f.org.id }, f.store.id, false);
    await prisma.productPhotoFeature.updateMany({ data: { status: "READY", embedding: vector } });
    const peach = await prisma.product.create({ data: { organizationId: f.org.id, name: "ELFBAR GH23000 Peach Mango Watermelon", sku: "PEACH-TEST", unit: "each", baseUnitId: f.baseUnit.id, photoUrl: "/uploads/product-photo-integration-only.jpg" } });
    await prisma.storeProduct.create({ data: { organizationId: f.org.id, storeId: f.store.id, productId: peach.id } });
    const otherVector = [0, 1, ...Array<number>(510).fill(0)];
    await prisma.productPhotoFeature.create({ data: { organizationId: f.org.id, productId: peach.id, sourceKey: photoSourceKey(peach.id, peach.photoUrl!, peach.updatedAt), sourceUrl: peach.photoUrl!, modelVersion, status: "READY", embedding: otherVector } });
    const analysis = { regionSource: "full", region: null, ocrStatus: "ready", lines: ["ELFBAR", "GH23000", "PEACH MANGO", "WATERMELON"].map((text, index) => ({ text, confidence: 0.99, box: { x: 0.2, y: 0.1 + index * 0.05, width: 0.6, height: 0.04 } })) };
    transport.mockImplementation(async (_url, init) => {
      const matrix = Buffer.from(JSON.parse(init.body).vectorsBase64, "base64");
      const wrong = matrix.readFloatLE(0) === 1 ? 0 : 1;
      return Response.json({ modelVersion, matches: [{ index: wrong, score: 0.95 }, { index: 1 - wrong, score: 0.8 }], analysis });
    });
    const both = await (await query(await cookie())).json();
    expect(both.items.map((item: { id: string }) => item.id)).toEqual([peach.id, f.product.id]);
    expect(both.items[0]).toMatchObject({ labelMatched: true, matchSource: "photo-text" });
    transport.mockResolvedValue(Response.json({ modelVersion, matches: [], analysis }));
    const textOnly = await (await query(await cookie())).json();
    expect(textOnly.items).toHaveLength(1); expect(textOnly.items[0]).toMatchObject({ id: peach.id, matchSource: "text", labelMatched: true });
    // An exact label alone, without separate context, cannot introduce a new result.
    transport.mockResolvedValue(Response.json({ modelVersion, matches: [], analysis: { ...analysis, lines: analysis.lines.slice(2) } }));
    expect(await (await query(await cookie())).json()).toMatchObject({ items: [] });
    // No inference response can retrieve a hidden product, including via OCR.
    await prisma.storeProduct.update({ where: { storeId_productId: { storeId: f.store.id, productId: peach.id } }, data: { isHidden: true } });
    transport.mockResolvedValue(Response.json({ modelVersion, matches: [], analysis }));
    expect(await (await query(await cookie())).json()).toMatchObject({ items: [] });
  });
  it("keeps the eight-result limit when an exact text result supplements eight visual neighbors", async () => {
    await prisma.product.update({ where: { id: f.product.id }, data: { name: "ELFBAR GH23000 Ice Mint" } });
    await ready();
    for (let index = 0; index < 8; index += 1) {
      const product = await prisma.product.create({ data: { organizationId: f.org.id, name: `Visual neighbor ${index}`, sku: `VISUAL-${index}`, unit: "each", baseUnitId: f.baseUnit.id, photoUrl: "/uploads/product-photo-integration-only.jpg" } });
      await prisma.storeProduct.create({ data: { organizationId: f.org.id, storeId: f.store.id, productId: product.id } });
      await prisma.productPhotoFeature.create({ data: { organizationId: f.org.id, productId: product.id, sourceKey: photoSourceKey(product.id, product.photoUrl!, product.updatedAt), sourceUrl: product.photoUrl!, modelVersion, status: "READY", embedding: [0, 1, ...Array<number>(510).fill(0)] } });
    }
    transport.mockImplementation(async (_url, init) => {
      const matrix = Buffer.from(JSON.parse(init.body).vectorsBase64, "base64");
      const matches = Array.from({ length: 9 }, (_, index) => index).filter((index) => matrix.readFloatLE(index * 512 * 4) === 0).map((index) => ({ index, score: 0.9 }));
      return Response.json({ modelVersion, matches, analysis: { regionSource: "full", region: null, ocrStatus: "ready", lines: ["ELFBAR", "GH23000", "ICE MINT"].map((text, index) => ({ text, confidence: 0.99, box: { x: 0.2, y: 0.1 + index * 0.05, width: 0.6, height: 0.04 } })) } });
    });
    const result = await (await query(await cookie())).json();
    expect(result.items).toHaveLength(8);
    expect(result.items[0]).toMatchObject({ id: f.product.id, matchSource: "text", labelMatched: true });
  });
  it.each(["0", "1"])("scopes embeddings and deduplicates photos (streaming %s)", async (streaming) => {
    vi.stubEnv("PRODUCT_PHOTO_SEARCH_STREAMING", streaming);
    const analysis = { regionSource: "full", region: null, ocrStatus: "ready", lines: [] };
    await ready();
    const p = await prisma.product.findUniqueOrThrow({ where: { id: f.product.id } });
    const gallery = await prisma.productImage.create({ data: { productId: p.id, organizationId: f.org.id, url: p.photoUrl! } });
    await preparePhotoSearch({ ...f.adminUser, organizationId: f.org.id }, f.store.id, false);
    await prisma.productPhotoFeature.updateMany({ where: { sourceKey: photoSourceKey(p.id, gallery.url, gallery.updatedAt) }, data: { status: "READY", embedding: vector } });
    expect((await loadPhotoSearchScope({ ...f.adminUser, organizationId: f.org.id }, f.store.id)).sources).toHaveLength(1);
    const otherStore = await prisma.store.create({ data: { organizationId: f.org.id, name: "Other", code: "O" } });
    for (const [name, hidden, archived, storeId] of [["Hidden", true, false, f.store.id], ["Archived", false, true, f.store.id], ["Other store", false, false, otherStore.id]] as const) {
      const product = await prisma.product.create({ data: { organizationId: f.org.id, name, sku: name, unit: "each", baseUnitId: f.baseUnit.id, isDeleted: archived, photoUrl: "https://example.invalid/other.jpg" } });
      await prisma.storeProduct.create({ data: { organizationId: f.org.id, productId: product.id, storeId, isHidden: hidden } });
      await prisma.productPhotoFeature.create({ data: { organizationId: f.org.id, productId: product.id, sourceKey: photoSourceKey(product.id, product.photoUrl!, product.updatedAt), sourceUrl: product.photoUrl!, modelVersion, status: "READY", embedding: vector } });
    }
    if (streaming === "1") {
      transport.mockImplementationOnce(async (url, init) => {
        expect(String(url)).toMatch(/\/search-stream$/);
        const bytes = Buffer.from(await new Response(init.body).arrayBuffer());
        const headerSize = bytes.readUInt32LE();
        const sent = JSON.parse(bytes.subarray(4, 4 + headerSize).toString());
        expect(sent.count).toBe(1);
        const records = bytes.subarray(4 + headerSize);
        expect(records).toHaveLength(4 + 512 * 4);
        expect(records.readUInt32LE()).toBe(0);
        expect(records.readFloatLE(4)).toBe(1);
        expect((await sharp(Buffer.from(sent.imageBase64, "base64")).metadata()).exif).toBeUndefined();
        return Response.json({ modelVersion, matches: [{ index: 0, score: 0.93 }], analysis });
      });
    }
    const response = await query(await cookie()); expect(response.status).toBe(200);
    if (streaming === "0") {
      const sent = JSON.parse(transport.mock.calls.find((call) => String(call[0]).endsWith("/search"))![1].body);
      expect(sent.groups).toEqual([0]); expect(Buffer.from(sent.vectorsBase64, "base64")).toHaveLength(512*4);
      expect((await sharp(Buffer.from(sent.imageBase64, "base64")).metadata()).exif).toBeUndefined();
    }
    expect(await response.json()).toMatchObject({ items: [{ id: p.id }] });
  });
  it("rejects cross-organization feature rows at the database boundary", async () => {
    const foreign = await prisma.organization.create({ data: { name: "Other" } });
    await expect(prisma.productPhotoFeature.create({ data: { organizationId: foreign.id, productId: f.product.id, sourceKey: "x".repeat(64), sourceUrl: "x", modelVersion } })).rejects.toMatchObject({ code: "P2003" });
  });
  it("rechecks current assortment, session, and store permissions after a slow search", async () => {
    await ready();
    transport.mockImplementation(async () => {
      await prisma.storeProduct.updateMany({ where: { productId: f.product.id }, data: { isHidden: true } });
      return Response.json({ modelVersion, matches: [{ index: 0, score: 1 }] });
    });
    expect(await (await query(await cookie())).json()).toMatchObject({ items: [] });
    await prisma.storeProduct.updateMany({ data: { isHidden: false, isActive: true } });
    expect((await loadPhotoSearchScope({ ...f.adminUser, organizationId: f.org.id }, f.store.id)).progress.ready).toBe(1);
    transport.mockImplementation(async () => {
      await prisma.userStoreAccess.deleteMany({ where: { userId: f.staffUser.id } });
      return Response.json({ modelVersion, matches: [{ index: 0, score: 1 }] });
    });
    expect((await query(await cookie(f.staffUser))).status).toBe(403);
  });
  it("keeps stale photos out and reports preparation when no photo is ready", async () => {
    await ready();
    await prisma.product.update({ where: { id: f.product.id }, data: { photoUrl: "/uploads/replacement.jpg" } });
    expect((await query(await cookie())).status).toBe(409);
    expect(transport).not.toHaveBeenCalled();
    const partial = await query(await cookie(), { partial: true });
    expect(partial.status).toBe(409);
    expect(await partial.json()).toMatchObject({ message: "photoSearchPreparing" });
    expect(transport).not.toHaveBeenCalled();
    const [a,b] = await Promise.all([preparePhotoSearch({ ...f.adminUser, organizationId: f.org.id }, f.store.id, false), preparePhotoSearch({ ...f.adminUser, organizationId: f.org.id }, f.store.id, false)]);
    expect(a.total).toBe(1); expect(b.total).toBe(1); expect(await prisma.productPhotoFeature.count()).toBe(2);
  });
  it("preserves zero and missing prices, store currency, and store-only stock", async () => {
    await ready();
    await prisma.store.update({ where: { id: f.store.id }, data: { currencyCode: "USD", currencyRateKgsPerUnit: 87, enableSku: false } });
    await prisma.storePrice.create({ data: { organizationId: f.org.id, productId: f.product.id, storeId: f.store.id, variantKey: "BASE", priceKgs: 0 } });
    expect(await (await query(await cookie())).json()).toMatchObject({ currencyCode: "USD", currencyRateKgsPerUnit: 87, items: [{ priceKgs: 0, sku: null, onHand: 0 }] });
    await prisma.storePrice.deleteMany();
    await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: null } });
    await preparePhotoSearch({ ...f.adminUser, organizationId: f.org.id }, f.store.id, false); await prisma.productPhotoFeature.updateMany({ data: { status: "READY", embedding: vector } });
    const json = await (await query(await cookie())).json(); expect(json.items[0].priceKgs).toBeNull(); expect(JSON.stringify(json)).not.toContain("cost");
  });
  it("uses current retail discounts and only the selected store's physical stock", async () => {
    await ready();
    await prisma.organization.update({ where: { id: f.org.id }, data: { retailWholesaleEnabled: true } });
    await prisma.storePrice.create({ data: { organizationId: f.org.id, productId: f.product.id, storeId: f.store.id, variantKey: "BASE", priceKgs: 123,
      discountType: "PERCENTAGE", discountPercentage: 25, discountStartsAt: new Date(Date.now()-60000), discountEndsAt: new Date(Date.now()+60000) } });
    await prisma.storePriceTypes.create({ data: { organizationId: f.org.id, productId: f.product.id, storeId: f.store.id, variantKey: "BASE", retailPriceKgs: 200 } });
    const second = await prisma.store.create({ data: { organizationId: f.org.id, name: "Second", code: "SECOND" } });
    await prisma.inventorySnapshot.createMany({ data: [{ storeId: f.store.id, productId: f.product.id, onHand: 2.5 }, { storeId: second.id, productId: f.product.id, onHand: 900 }] });
    expect(await (await query(await cookie())).json()).toMatchObject({ items: [{ priceKgs: 150, onHand: 2.5 }] });
    await prisma.storePrice.updateMany({ data: { discountStartsAt: new Date(Date.now()+60000), discountEndsAt: new Date(Date.now()+120000) } });
    expect(await (await query(await cookie())).json()).toMatchObject({ items: [{ priceKgs: 200, onHand: 2.5 }] });
    await prisma.storePrice.updateMany({ data: { discountStartsAt: new Date(0), discountEndsAt: new Date(1) } });
    expect(await (await query(await cookie())).json()).toMatchObject({ items: [{ priceKgs: 200 }] });
  });
  it("keeps impersonation within the target's grants and drops a revoked session after inference", async () => {
    await ready();
    const session = await prisma.impersonationSession.create({ data: { organizationId: f.org.id, createdById: f.adminUser.id, targetUserId: f.staffUser.id, expiresAt: new Date(Date.now()+60000) } });
    const impersonated = (await cookie()) + "; impersonation_session=" + session.id;
    expect((await query(impersonated)).status).toBe(200);
    await prisma.userStoreAccess.deleteMany({ where: { userId: f.staffUser.id } });
    expect((await query(impersonated)).status).toBe(403);
    transport.mockImplementation(async () => {
      await prisma.user.update({ where: { id: f.adminUser.id }, data: { sessionVersion: { increment: 1 } } });
      return Response.json({ modelVersion, matches: [{ index: 0, score: 1 }] });
    });
    expect((await query(await cookie())).status).toBe(401);
  });
  it("rejects cross-site, corrupt and oversized photos and bounds body streaming", async () => {
    await ready(); const auth = await cookie();
    expect((await query(auth, { origin: "https://evil.invalid" })).status).toBe(403);
    expect((await query(auth, { buffer: Buffer.from("<svg>bad</svg>") })).status).toBe(400);
    expect((await query(auth, { buffer: Buffer.alloc(0) })).status).toBe(400);
    expect((await query(auth, { buffer: Buffer.alloc(3*1024*1024+1) })).status).toBe(413);
    expect((await POST(new Request(endpoint, { method: "POST", headers: { cookie: auth, "content-type": "multipart/form-data; boundary=x" }, body: Buffer.alloc(4*1024*1024) }))).status).toBe(413);
    expect(transport).not.toHaveBeenCalled();
  });
  it("fails honestly when unconfigured, busy, offline or returning malformed/wrong-model results", async () => {
    await ready(); const auth = await cookie();
    vi.stubEnv("PRODUCT_PHOTO_SEARCH_TOKEN", "");
    expect(await (await GET(new Request(`${endpoint}?storeId=${f.store.id}`, { headers: { cookie: auth } }))).json()).toMatchObject({ configured: false });
    expect((await query(auth)).status).toBe(503);
    vi.stubEnv("PRODUCT_PHOTO_SEARCH_TOKEN", "synthetic-private-engine-key-at-least-32-chars");
    for (const value of [Response.json({ error: "private key details" }, { status: 429 }), Response.json({ modelVersion: "wrong", matches: [] }), Response.json({ modelVersion, matches: [{ index: 999, score: 1 }] })]) {
      transport.mockResolvedValueOnce(value); const response = await query(auth); expect([429,503]).toContain(response.status); expect(JSON.stringify(await response.json())).not.toContain("private key");
    }
    transport.mockRejectedValueOnce(new Error("secret transport error")); expect((await query(auth)).status).toBe(503);
  });
  it("limits request bursts equally on all tariffs using atomic Redis counters", async () => {
    await ready(); const auth = await cookie();
    for (let i=0; i<12; i++) expect((await query(auth)).status).toBe(200);
    const blocked = await query(auth); expect(blocked.status).toBe(429); expect(blocked.headers.get("retry-after")).toBe("60");
    expect((await query(await cookie(f.managerUser))).status).toBe(200);
  });
  it("worker claims once, strips metadata, publishes idempotently and discards changed sources", async () => {
    await mkdir("public/uploads", { recursive: true }); await writeFile(uploadPath, image);
    await prisma.product.update({ where: { id: f.product.id }, data: { photoUrl: "/uploads/product-photo-integration-only.jpg" } });
    expect((await prepare(await cookie())).status).toBe(200);
    await Promise.all([processNextProductPhoto(), processNextProductPhoto()]);
    expect(await prisma.productPhotoFeature.findFirst()).toMatchObject({ status: "READY", attempts: 1, embedding: vector });
    expect(transport.mock.calls.filter((call) => String(call[0]).endsWith("/embed"))).toHaveLength(1);
    expect(await processNextProductPhoto()).toBeNull();
    await prisma.productPhotoFeature.updateMany({ data: { status: "PENDING", attempts: 0 } });
    transport.mockImplementation(async () => {
      await prisma.product.update({ where: { id: f.product.id }, data: { photoUrl: null } });
      return Response.json({ modelVersion, embedding: vector });
    });
    await processNextProductPhoto(); expect(await prisma.productPhotoFeature.count()).toBe(0);
    expect(await prisma.productImage.count()).toBe(0);
  });
  it("worker recovers expired leases and bounds retries; explicit retry never mutates a ready feature", async () => {
    await mkdir("public/uploads", { recursive: true }); await writeFile(uploadPath, image); await ready();
    await prisma.productPhotoFeature.updateMany({ data: { status: "PROCESSING", attempts: 1, leaseToken: "dead-worker", leaseExpiresAt: new Date(0) } });
    await processNextProductPhoto(); expect(await prisma.productPhotoFeature.findFirst()).toMatchObject({ status: "READY", attempts: 2, leaseToken: null });
    await prisma.productPhotoFeature.updateMany({ data: { status: "PENDING", attempts: 2, retryAfter: new Date(0) } });
    transport.mockRejectedValue(new Error("offline")); await processNextProductPhoto();
    expect(await prisma.productPhotoFeature.findFirst()).toMatchObject({ status: "FAILED", attempts: 3 });
    expect((await query(await cookie())).status).toBe(503);
    await prisma.productPhotoFeature.updateMany({ data: { updatedAt: new Date(Date.now()-6000) } });
    await preparePhotoSearch({ ...f.adminUser, organizationId: f.org.id }, f.store.id, true); expect(await prisma.productPhotoFeature.findFirst()).toMatchObject({ status: "PENDING", attempts: 0 });
  });
});

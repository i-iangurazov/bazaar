import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({ auth: vi.fn(), fetch: vi.fn() }));
vi.mock("@/server/auth/token", () => ({ getServerAuthToken: boundary.auth }));
vi.mock("@/server/services/productImageFetch", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/services/productImageFetch")>(),
  fetchPublicProductImage: boundary.fetch,
}));

import { GET } from "@/app/api/product-images/source/route";
import { prisma } from "@/server/db/prisma";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const base = "https://syntheticimages.public.blob.vercel-storage.com";
const file = `${"a".repeat(40)}.png`;
const get = (path: string) => GET(new Request(`https://isolated-preview.invalid/api/product-images/source?url=${encodeURIComponent(path)}`));

describeDb("public Blob product image source authorization", () => {
  let f: Awaited<ReturnType<typeof seedBase>>;
  beforeEach(async () => {
    await resetDatabase(); vi.clearAllMocks();
    vi.stubEnv("IMAGE_STORAGE_PROVIDER", "vercel-blob");
    vi.stubEnv("BLOB_IMAGE_STORE_ID", "store_syntheticImages");
    vi.stubEnv("R2_PUBLIC_BASE_URL", "");
    f = await seedBase({ plan: "BUSINESS" });
    boundary.auth.mockResolvedValue({ sub: f.adminUser.id, organizationId: f.org.id, role: "ADMIN" });
    boundary.fetch.mockResolvedValue({ buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), contentType: "image/png" });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("reads an actual owned product image and pending unassigned upload through the bounded image helper", async () => {
    for (const productId of [f.product.id, "unassigned"]) {
      const response = await get(`${base}/retails/${f.org.id}/products/${productId}/${file}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    }
    expect(boundary.fetch).toHaveBeenCalledTimes(2);
  });

  it("denies a foreign product disguised under this organization's path, missing products, other origins and exports before fetching", async () => {
    const foreign = await prisma.organization.create({ data: { name: "Synthetic foreign image owner" } });
    const unit = await prisma.unit.create({ data: { organizationId: foreign.id, code: "each", labelRu: "шт.", labelKg: "даана" } });
    const product = await prisma.product.create({ data: { organizationId: foreign.id, name: "Foreign synthetic image", sku: "FOREIGN-IMAGE", unit: "each", baseUnitId: unit.id } });
    for (const source of [
      `${base}/retails/${f.org.id}/products/${product.id}/${file}`,
      `${base}/retails/${foreign.id}/products/${product.id}/${file}`,
      `${base}/retails/${f.org.id}/products/missing-product/${file}`,
      `https://foreign.public.blob.vercel-storage.com/retails/${f.org.id}/products/${f.product.id}/${file}`,
      `https://syntheticexports.private.blob.vercel-storage.com/exports/${f.org.id}/job/${file}`,
    ]) expect((await get(source)).status).toBe(403);
    expect(boundary.fetch).not.toHaveBeenCalled();
  });

  it("preserves actual manager store access for Blob product reads", async () => {
    await prisma.userStoreAccess.deleteMany({ where: { userId: f.managerUser.id } });
    await prisma.userStoreAccess.create({ data: { organizationId: f.org.id, userId: f.managerUser.id, storeId: f.store.id } });
    boundary.auth.mockResolvedValue({ sub: f.managerUser.id, organizationId: f.org.id, role: "MANAGER" });
    expect((await get(`${base}/retails/${f.org.id}/products/${f.product.id}/${file}`)).status).toBe(200);
    const hiddenStore = await prisma.store.create({ data: { organizationId: f.org.id, name: "Synthetic hidden store", code: "HIDDEN-IMG" } });
    const hidden = await prisma.product.create({ data: { organizationId: f.org.id, name: "Synthetic hidden image", sku: "HIDDEN-IMAGE", unit: f.product.unit, baseUnitId: f.product.baseUnitId } });
    await prisma.storeProduct.create({ data: { organizationId: f.org.id, storeId: hiddenStore.id, productId: hidden.id, isActive: true } });
    expect((await get(`${base}/retails/${f.org.id}/products/${hidden.id}/${file}`)).status).toBe(403);
    expect(boundary.fetch).toHaveBeenCalledOnce();
  });

  it("denies anonymous and staff identities without any storage request", async () => {
    boundary.auth.mockResolvedValue(null);
    expect((await get(`${base}/retails/${f.org.id}/products/${f.product.id}/${file}`)).status).toBe(401);
    boundary.auth.mockResolvedValue({ sub: f.staffUser.id, organizationId: f.org.id, role: "STAFF" });
    expect((await get(`${base}/retails/${f.org.id}/products/${f.product.id}/${file}`)).status).toBe(403);
    expect(boundary.fetch).not.toHaveBeenCalled();
  });
});

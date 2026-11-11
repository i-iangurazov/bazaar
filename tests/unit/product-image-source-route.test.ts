import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockProductImageHttpResponse } from "../helpers/product-image-http";

const { mockGetServerAuthToken, lookupMock, requestMock, productCount, storeAccess } = vi.hoisted(() => ({
  mockGetServerAuthToken: vi.fn(), lookupMock: vi.fn(), requestMock: vi.fn(), productCount: vi.fn(), storeAccess: vi.fn(),
}));
vi.mock("@/server/auth/token", () => ({ getServerAuthToken: mockGetServerAuthToken }));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));
vi.mock("node:http", () => ({ request: requestMock }));
vi.mock("node:https", () => ({ request: requestMock }));
vi.mock("@/server/db/prisma", () => ({ prisma: { product: { count: productCount }, userStoreAccess: { findMany: storeAccess } } }));

import { GET } from "@/app/api/product-images/source/route";

describe("product image source route", () => {
  const uploadPath = `/uploads/imported-products/image-source-test-${randomUUID()}`;
  const uploadDirectory = join(process.cwd(), "public", uploadPath);
  const requestImage = (url: string) => GET(new Request(`http://localhost/api/product-images/source?url=${encodeURIComponent(url)}`));

  beforeAll(async () => {
    await mkdir(uploadDirectory, { recursive: true });
    await writeFile(join(uploadDirectory, "photo.jpg"), new Uint8Array([1, 2, 3]));
    await writeFile(join(uploadDirectory, "extensionless"), new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
  });
  afterAll(async () => { await rm(uploadDirectory, { recursive: true, force: true }); });
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerAuthToken.mockResolvedValue({ organizationId: "org-1", role: "ADMIN" });
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    requestMock.mockImplementation((_url, _options, callback) => mockProductImageHttpResponse(callback));
    vi.stubEnv("R2_PUBLIC_BASE_URL", "https://images.example.com/assets");
    vi.stubEnv("IMAGE_STORAGE_PROVIDER", "local");
    productCount.mockResolvedValue(1);
    storeAccess.mockResolvedValue([{ store: { id: "assigned-store" } }]);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("reads actual local managed uploads and infers MIME from extension without loopback HTTP", async () => {
    const response = await requestImage(`${uploadPath}/photo.jpg`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect((await response.arrayBuffer()).byteLength).toBe(3);
    expect(requestMock).not.toHaveBeenCalled();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("infers extensionless local upload MIME from bytes", async () => {
    const response = await requestImage(`${uploadPath}/extensionless`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
  });

  it("allows managers to read a configured object-storage image", async () => {
    mockGetServerAuthToken.mockResolvedValue({ organizationId: "org-1", role: "MANAGER" });
    const response = await requestImage("https://images.example.com/assets/retails/photo.jpg");
    expect(response.status).toBe(200);
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(String(requestMock.mock.calls[0][0])).toBe("https://images.example.com/assets/retails/photo.jpg");
  });

  it("resolves legacy retails paths against the configured storage subdirectory", async () => {
    const response = await requestImage("/retails/photo.jpg");
    expect(response.status).toBe(200);
    expect(String(requestMock.mock.calls[0][0])).toBe("https://images.example.com/assets/retails/photo.jpg");
  });

  it.each([
    "https://example.com/photo.jpg",
    "http://127.0.0.1/uploads/imported-products/probe.jpg",
    "http://169.254.169.254/uploads/product-images/probe.jpg",
    "https://evil.example/uploads/imported-products/probe.jpg",
    "https://images.example.com.evil.example/assets/photo.jpg",
    "https://user:secret@images.example.com/assets/photo.jpg",
    "https://images.example.com:444/assets/photo.jpg",
  ])("rejects non-managed or unsafe destinations: %s", async (url) => {
    const response = await requestImage(url);
    expect(response.status).toBe(403);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("does not trust a request Host over configured production application origins", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    vi.stubEnv("NEXTAUTH_URL", "https://app.example.com");
    const source = "https://evil.example/uploads/imported-products/photo.jpg";
    const response = await GET(new Request(`https://evil.example/api/product-images/source?url=${encodeURIComponent(source)}`));
    expect(response.status).toBe(403);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("rejects an object-storage redirect to private metadata before a second request", async () => {
    requestMock.mockImplementation((_url, _options, callback) => mockProductImageHttpResponse(callback, {
      status: 302, headers: { location: "http://169.254.169.254/uploads/product-images/secret.jpg" },
    }));
    expect((await requestImage("https://images.example.com/assets/photo.jpg")).status).toBe(502);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("keeps valid redirects within configured storage working", async () => {
    requestMock.mockImplementationOnce((_url, _options, callback) => mockProductImageHttpResponse(callback, {
      status: 302, headers: { location: "/assets/renamed.jpg" },
    }));
    expect((await requestImage("https://images.example.com/assets/photo.jpg")).status).toBe(200);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it("preserves HEIC MIME and rejects SVG payloads", async () => {
    requestMock.mockImplementationOnce((_url, _options, callback) => mockProductImageHttpResponse(callback, {
      headers: { "content-type": "image/heic-sequence" },
    }));
    expect((await requestImage("https://images.example.com/assets/photo.heic")).headers.get("content-type")).toBe("image/heic");
    requestMock.mockImplementationOnce((_url, _options, callback) => mockProductImageHttpResponse(callback, {
      headers: { "content-type": "image/svg+xml" },
    }));
    expect((await requestImage("https://images.example.com/assets/photo.svg")).status).toBe(400);
  });

  it.each([null, { organizationId: "org-1", role: "CASHIER" }])("preserves authorization: %j", async (token) => {
    mockGetServerAuthToken.mockResolvedValue(token);
    expect([401, 403]).toContain((await requestImage(`${uploadPath}/photo.jpg`)).status);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("reads the configured public Blob image for an accessible organization product", async () => {
    vi.stubEnv("IMAGE_STORAGE_PROVIDER", "vercel-blob");
    vi.stubEnv("BLOB_IMAGE_STORE_ID", "store_testImages");
    const source = `https://testimages.public.blob.vercel-storage.com/retails/org-1/products/prod-1/${"a".repeat(40)}.png`;
    const response = await requestImage(source);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(productCount).toHaveBeenCalledWith({ where: { id: { in: ["prod-1"] }, organizationId: "org-1", isDeleted: false } });
    expect(requestMock).toHaveBeenCalledOnce();
  });

  it.each([
    `https://testimages.public.blob.vercel-storage.com/retails/foreign-org/products/prod-1/${"a".repeat(40)}.png`,
    `https://testexports.private.blob.vercel-storage.com/exports/org-1/job/${"a".repeat(40)}.png`,
    `https://foreign.public.blob.vercel-storage.com/retails/org-1/products/prod-1/${"a".repeat(40)}.png`,
    `https://testimages.public.blob.vercel-storage.com/retails/org-1/products/prod-1/${"a".repeat(40)}.svg`,
    `https://testimages.public.blob.vercel-storage.com/retails/org-1/products/prod-1/${"a".repeat(40)}.png?other=1`,
  ])("rejects a Blob URL outside the public organization image contract before any request: %s", async (source) => {
    vi.stubEnv("IMAGE_STORAGE_PROVIDER", "vercel-blob");
    vi.stubEnv("BLOB_IMAGE_STORE_ID", "store_testImages");
    expect((await requestImage(source)).status).toBe(403);
    expect(requestMock).not.toHaveBeenCalled();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("does not follow a Blob redirect into another product's path", async () => {
    vi.stubEnv("IMAGE_STORAGE_PROVIDER", "vercel-blob");
    vi.stubEnv("BLOB_IMAGE_STORE_ID", "store_testImages");
    requestMock.mockImplementationOnce((_url, _options, callback) => mockProductImageHttpResponse(callback, {
      status: 302, headers: { location: `/retails/org-1/products/other-product/${"b".repeat(40)}.png` },
    }));
    expect((await requestImage(`https://testimages.public.blob.vercel-storage.com/retails/org-1/products/prod-1/${"a".repeat(40)}.png`)).status).toBe(502);
    expect(requestMock).toHaveBeenCalledOnce();
  });

  it("preserves Blob MIME and response byte limits", async () => {
    vi.stubEnv("IMAGE_STORAGE_PROVIDER", "vercel-blob");
    vi.stubEnv("BLOB_IMAGE_STORE_ID", "store_testImages");
    vi.stubEnv("PRODUCT_IMAGE_MAX_BYTES", "3");
    requestMock.mockImplementation((_url, _options, callback) => mockProductImageHttpResponse(callback, {
      body: new Uint8Array([1, 2, 3, 4]), headers: { "content-type": "image/png" },
    }));
    expect((await requestImage(`https://testimages.public.blob.vercel-storage.com/retails/org-1/products/prod-1/${"a".repeat(40)}.png`)).status).toBe(502);
  });
});

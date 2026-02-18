import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerAuthToken, mockRecordFirstEvent, mockUploadProductImageBuffer, prisma } = vi.hoisted(() => ({
  mockGetServerAuthToken: vi.fn(),
  mockRecordFirstEvent: vi.fn(),
  mockUploadProductImageBuffer: vi.fn(),
  prisma: {
    store: { findUnique: vi.fn() },
    product: { findMany: vi.fn() },
    storePrice: { findMany: vi.fn() },
  },
}));

vi.mock("@/server/auth/token", () => ({
  getServerAuthToken: () => mockGetServerAuthToken(),
}));
vi.mock("@/server/db/prisma", () => ({ prisma }));
vi.mock("@/server/services/productEvents", () => ({
  recordFirstEvent: (...args: unknown[]) => mockRecordFirstEvent(...args),
}));
vi.mock("@/server/services/productImageStorage", () => ({
  uploadProductImageBuffer: (...args: unknown[]) =>
    (globalThis as { __uploadMock?: (...args: unknown[]) => unknown }).__uploadMock?.(...args),
}));
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: () => ({ value: "ru" }),
  }),
}));

const uploadMockGlobal = globalThis as typeof globalThis & {
  __uploadMock?: (...args: unknown[]) => unknown;
};
uploadMockGlobal.__uploadMock = mockUploadProductImageBuffer;

import { POST as priceTagsPost } from "../../src/app/api/price-tags/pdf/route";

describe("price tags pdf route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerAuthToken.mockResolvedValue({ organizationId: "org-1", sub: "user-1" });
    prisma.store.findUnique.mockResolvedValue({ id: "store-1", organizationId: "org-1", name: "Тест" });
    prisma.product.findMany.mockResolvedValue([
      {
        id: "prod-1",
        name: "Молоко 3.2%",
        sku: "SKU-1",
        basePriceKgs: 12,
        barcodes: [{ value: "1234567890" }],
      },
    ]);
    prisma.storePrice.findMany.mockResolvedValue([]);
  });

  it("returns PDF content", async () => {
    const request = new Request("http://localhost/api/price-tags/pdf", {
      method: "POST",
      body: JSON.stringify({
        template: "3x8",
        items: [{ productId: "prod-1", quantity: 1 }],
        storeId: "store-1",
      }),
    });

    const response = await priceTagsPost(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    const pdf = Buffer.from(await response.arrayBuffer());
    expect(pdf.length).toBeGreaterThan(500);
  });

  it("rejects requests with per-item quantity above cap", async () => {
    const request = new Request("http://localhost/api/price-tags/pdf", {
      method: "POST",
      body: JSON.stringify({
        template: "3x8",
        items: [{ productId: "prod-1", quantity: 101 }],
      }),
    });

    const response = await priceTagsPost(request);

    expect(response.status).toBe(400);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(prisma.storePrice.findMany).not.toHaveBeenCalled();
  });

  it("rejects requests when total labels exceed cap", async () => {
    const request = new Request("http://localhost/api/price-tags/pdf", {
      method: "POST",
      body: JSON.stringify({
        template: "2x5",
        items: [
          { productId: "prod-1", quantity: 100 },
          { productId: "prod-2", quantity: 100 },
          { productId: "prod-3", quantity: 100 },
          { productId: "prod-4", quantity: 100 },
          { productId: "prod-5", quantity: 100 },
          { productId: "prod-6", quantity: 1 },
        ],
      }),
    });

    const response = await priceTagsPost(request);

    expect(response.status).toBe(400);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(prisma.storePrice.findMany).not.toHaveBeenCalled();
  });
});

describe("product image upload route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerAuthToken.mockResolvedValue({ organizationId: "org-1", role: "ADMIN" });
    mockUploadProductImageBuffer.mockResolvedValue({ url: "/uploads/imported-products/org-1/test.jpg" });
  });

  it("rejects multipart requests that exceed max content length", async () => {
    const { POST } = await import("../../src/app/api/product-images/upload/route");
    const request = new Request("http://localhost/api/product-images/upload", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=boundary",
        "content-length": String(6 * 1024 * 1024),
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ message: "imageTooLarge" });
    expect(mockUploadProductImageBuffer).not.toHaveBeenCalled();
  });

  it("rejects files that exceed max image bytes", async () => {
    const { POST } = await import("../../src/app/api/product-images/upload/route");
    const oversizedBytes = new Uint8Array(5 * 1024 * 1024 + 1);
    const formData = new FormData();
    formData.append("file", new File([oversizedBytes], "oversized.png", { type: "image/png" }));

    const response = await POST(
      new Request("http://localhost/api/product-images/upload", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ message: "imageTooLarge" });
    expect(mockUploadProductImageBuffer).not.toHaveBeenCalled();
  });
});

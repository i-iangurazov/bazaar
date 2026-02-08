import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerAuthToken, mockRecordFirstEvent, prisma } = vi.hoisted(() => ({
  mockGetServerAuthToken: vi.fn(),
  mockRecordFirstEvent: vi.fn(),
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
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: () => ({ value: "ru" }),
  }),
}));

import { POST } from "../../src/app/api/price-tags/pdf/route";

describe("price tags pdf route", () => {
  beforeEach(() => {
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

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    const pdf = Buffer.from(await response.arrayBuffer());
    expect(pdf.length).toBeGreaterThan(500);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerAuthToken, prisma } = vi.hoisted(() => ({
  mockGetServerAuthToken: vi.fn(),
  prisma: {
    purchaseOrder: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/server/auth/token", () => ({
  getServerAuthToken: () => mockGetServerAuthToken(),
}));
vi.mock("@/server/db/prisma", () => ({ prisma }));
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: () => ({ value: "ru" }),
  }),
}));

import { GET as purchaseOrderPdfGet } from "../../src/app/api/purchase-orders/[id]/pdf/route";

describe("purchase order pdf route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerAuthToken.mockResolvedValue({ organizationId: "org-1" });
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: "po-1",
      status: "DRAFT",
      createdAt: new Date("2026-02-20T10:00:00.000Z"),
      supplier: {
        name: "Поставщик",
        email: null,
        phone: null,
      },
      store: {
        name: "Магазин",
        legalName: null,
        legalEntityType: null,
        inn: null,
        address: null,
        phone: null,
      },
      lines: [
        {
          qtyOrdered: 2,
          unitCost: 10,
          product: {
            name: "Молоко 3.2%",
            unit: "шт",
          },
          variant: null,
        },
      ],
    });
  });

  it("returns application/pdf", async () => {
    const response = await purchaseOrderPdfGet(new Request("http://localhost"), {
      params: { id: "po-1" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    const pdf = Buffer.from(await response.arrayBuffer());
    expect(pdf.length).toBeGreaterThan(500);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { formatStoreMoneyMock, mockGetServerAuthToken, prisma } = vi.hoisted(() => ({
  formatStoreMoneyMock: vi.fn(
    (amount: number, _locale?: string, _currencySource?: unknown) => `money:${amount}`,
  ),
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
vi.mock("@/lib/currencyDisplay", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/currencyDisplay")>();
  return {
    ...actual,
    formatStoreMoney: formatStoreMoneyMock,
  };
});
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
      currencyCode: "USD",
      currencyRateKgsPerUnit: "89.5",
      status: "DRAFT",
      createdAt: new Date("2026-02-20T10:00:00.000Z"),
      supplier: {
        name: "Поставщик",
        email: null,
        phone: null,
      },
      store: {
        name: "Магазин",
        currencyCode: "KGS",
        currencyRateKgsPerUnit: "1",
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

  it("formats totals with the purchase-order currency snapshot", async () => {
    await purchaseOrderPdfGet(new Request("http://localhost"), {
      params: { id: "po-1" },
    });

    expect(formatStoreMoneyMock).toHaveBeenCalled();
    expect(
      formatStoreMoneyMock.mock.calls.some(([, , currencySource]) => {
        const source = currencySource as { currencyCode?: string; currencyRateKgsPerUnit?: string };
        return source.currencyCode === "USD" && source.currencyRateKgsPerUnit === "89.5";
      }),
    ).toBe(true);
  });
});

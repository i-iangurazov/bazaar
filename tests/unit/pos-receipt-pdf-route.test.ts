import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerAuthToken, prisma } = vi.hoisted(() => ({
  mockGetServerAuthToken: vi.fn(),
  prisma: {
    customerOrder: {
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

import { GET as posReceiptPdfGet } from "../../src/app/api/pos/receipts/[id]/pdf/route";

const saleFixture = {
  id: "sale-1",
  storeId: "store-1",
  number: "S-000001",
  kkmStatus: "SENT",
  kkmReceiptId: "provider-1",
  kkmRawJson: {
    qr: "https://example.test/qr",
  },
  createdAt: new Date("2026-02-20T10:00:00.000Z"),
  completedAt: new Date("2026-02-20T10:05:00.000Z"),
  subtotalKgs: 24,
  totalKgs: 24,
  store: {
    id: "store-1",
    name: "Тестовый магазин",
    legalName: "Тестовый магазин ОсОО",
    inn: "12345678901234",
    address: "Бишкек",
    phone: "+996700000000",
  },
  register: {
    id: "reg-1",
    name: "Основная",
    code: "R1",
  },
  shift: {
    id: "shift-1",
  },
  createdBy: {
    id: "user-1",
    name: "Кассир",
  },
  lines: [
    {
      id: "line-1",
      productId: "prod-1",
      qty: 2,
      unitPriceKgs: 12,
      lineTotalKgs: 24,
      product: {
        id: "prod-1",
        name: "Молоко 3.2%",
        sku: "SKU-1",
      },
    },
  ],
  payments: [
    {
      id: "payment-1",
      method: "CASH",
      amountKgs: 24,
    },
  ],
  fiscalReceipts: [
    {
      providerReceiptId: "provider-1",
      fiscalNumber: "100500",
      kkmFactoryNumber: "KKM-1",
      kkmRegistrationNumber: "REG-1",
      fiscalModeStatus: "SENT",
      upfdOrFiscalMemory: "UPFD-1",
      qrPayload: "https://example.test/qr",
      qr: null,
      fiscalizedAt: new Date("2026-02-20T10:06:00.000Z"),
      sentAt: new Date("2026-02-20T10:06:00.000Z"),
      lastError: null,
    },
  ],
};

describe("pos receipt pdf route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerAuthToken.mockResolvedValue({ organizationId: "org-1" });
    prisma.customerOrder.findFirst.mockResolvedValue(saleFixture);
  });

  it("returns application/pdf", async () => {
    const response = await posReceiptPdfGet(new Request("http://localhost"), {
      params: { id: "sale-1" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    const pdf = Buffer.from(await response.arrayBuffer());
    expect(pdf.length).toBeGreaterThan(500);
  });

  it("uses 58mm width and content-based page height", async () => {
    const response = await posReceiptPdfGet(new Request("http://localhost"), {
      params: { id: "sale-1" },
    });

    const pdf = Buffer.from(await response.arrayBuffer()).toString("latin1");
    const mediaBoxMatch = pdf.match(/\/MediaBox\s*\[\s*0\s+0\s+([0-9.]+)\s+([0-9.]+)\s*\]/);
    expect(mediaBoxMatch).toBeTruthy();

    const widthPoints = Number(mediaBoxMatch?.[1] ?? "0");
    const heightPoints = Number(mediaBoxMatch?.[2] ?? "0");

    expect(widthPoints).toBeGreaterThan(160);
    expect(widthPoints).toBeLessThan(170);
    expect(heightPoints).toBeGreaterThan(120);
    expect(heightPoints).toBeLessThan(900);
  });

  it("returns conflict when fiscal receipt is requested but unavailable", async () => {
    prisma.customerOrder.findFirst.mockResolvedValue({
      ...saleFixture,
      kkmStatus: "FAILED",
      fiscalReceipts: [],
    });

    const response = await posReceiptPdfGet(new Request("http://localhost?kind=fiscal"), {
      params: { id: "sale-1" },
    });

    expect(response.status).toBe(409);
  });
});

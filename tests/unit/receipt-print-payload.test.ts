import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: {
    customerOrder: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/server/db/prisma", () => ({ prisma }));

import { AppError } from "@/server/services/errors";
import { buildReceiptPrintPayload } from "@/server/services/receiptPrintPayload";

describe("receipt print payload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes legal name, INN and address from store data", async () => {
    prisma.customerOrder.findFirst.mockResolvedValue({
      id: "sale-1",
      storeId: "store-1",
      number: "S-000001",
      kkmStatus: "NOT_SENT",
      kkmReceiptId: null,
      kkmRawJson: null,
      createdAt: new Date("2026-02-28T10:00:00.000Z"),
      completedAt: new Date("2026-02-28T10:01:00.000Z"),
      subtotalKgs: 240,
      totalKgs: 240,
      store: {
        id: "store-1",
        name: "Airport Store",
        legalName: "Airport Store LLC",
        inn: "12345678901234",
        address: "Bishkek, Chuy 1",
        phone: "+996700000000",
      },
      register: {
        id: "reg-1",
        name: "Front",
        code: "F1",
      },
      shift: { id: "shift-1" },
      createdBy: { id: "user-1", name: "Cashier" },
      lines: [
        {
          id: "line-1",
          productId: "prod-1",
          qty: 1,
          unitPriceKgs: 240,
          lineTotalKgs: 240,
          product: { id: "prod-1", name: "Сүт", sku: "SKU-1" },
        },
      ],
      payments: [{ id: "p1", method: "CASH", amountKgs: 240 }],
      fiscalReceipts: [],
    });

    const payload = await buildReceiptPrintPayload({
      organizationId: "org-1",
      saleId: "sale-1",
      locale: "ru-RU",
      variant: "PRECHECK",
      paymentMethodLabels: {
        CASH: "Наличные",
        CARD: "Карта",
        TRANSFER: "Перевод",
        OTHER: "Другое",
      },
    });

    expect(payload.legalName).toBe("Airport Store LLC");
    expect(payload.inn).toBe("12345678901234");
    expect(payload.address).toBe("Bishkek, Chuy 1");
    expect(payload.variant).toBe("PRECHECK");
    expect(payload.storeName).toBe("Airport Store");
    expect(payload.cashierName).toBe("Cashier");
    expect(payload.number).toBe("S-000001");
    expect(payload.items).toEqual([
      {
        productId: "prod-1",
        name: "Сүт",
        sku: "SKU-1",
        qty: 1,
        unitPriceKgs: 240,
        lineTotalKgs: 240,
      },
    ]);
    expect(payload.totals.payments).toEqual([
      {
        method: "CASH",
        methodLabel: "Наличные",
        amountKgs: 240,
      },
    ]);
  });

  it("blocks fiscal print when sale is not fiscalized", async () => {
    prisma.customerOrder.findFirst.mockResolvedValue({
      id: "sale-1",
      storeId: "store-1",
      number: "S-000001",
      kkmStatus: "FAILED",
      kkmReceiptId: null,
      kkmRawJson: null,
      createdAt: new Date("2026-02-28T10:00:00.000Z"),
      completedAt: new Date("2026-02-28T10:01:00.000Z"),
      subtotalKgs: 100,
      totalKgs: 100,
      store: {
        id: "store-1",
        name: "Store",
        legalName: null,
        inn: null,
        address: null,
        phone: null,
      },
      register: null,
      shift: null,
      createdBy: null,
      lines: [],
      payments: [],
      fiscalReceipts: [],
    });

    await expect(
      buildReceiptPrintPayload({
        organizationId: "org-1",
        saleId: "sale-1",
        locale: "ru-RU",
        variant: "FISCAL",
        paymentMethodLabels: {
          CASH: "Cash",
          CARD: "Card",
          TRANSFER: "Transfer",
          OTHER: "Other",
        },
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("uses the saved sale currency snapshot instead of the current store currency", async () => {
    prisma.customerOrder.findFirst.mockResolvedValue({
      id: "sale-usd",
      storeId: "store-1",
      number: "S-USD",
      kkmStatus: "NOT_SENT",
      kkmReceiptId: null,
      kkmRawJson: null,
      currencyCode: "USD",
      currencyRateKgsPerUnit: "89.5",
      createdAt: new Date("2026-02-28T10:00:00.000Z"),
      completedAt: new Date("2026-02-28T10:01:00.000Z"),
      subtotalKgs: 895,
      totalKgs: 895,
      store: {
        id: "store-1",
        name: "Store",
        currencyCode: "KGS",
        currencyRateKgsPerUnit: "1",
        legalName: null,
        inn: null,
        address: null,
        phone: null,
      },
      register: null,
      shift: null,
      createdBy: null,
      lines: [],
      payments: [{ id: "p1", method: "CARD", amountKgs: 895 }],
      fiscalReceipts: [],
    });

    const payload = await buildReceiptPrintPayload({
      organizationId: "org-1",
      saleId: "sale-usd",
      locale: "en-US",
      variant: "PRECHECK",
      paymentMethodLabels: {
        CASH: "Cash",
        CARD: "Card",
        TRANSFER: "Transfer",
        OTHER: "Other",
      },
    });

    expect(payload.currencyCode).toBe("USD");
    expect(payload.currencyRateKgsPerUnit).toBe(89.5);
  });

  it("falls back to the fiscal receipt snapshot before current store currency", async () => {
    prisma.customerOrder.findFirst.mockResolvedValue({
      id: "sale-legacy",
      storeId: "store-1",
      number: "S-FISCAL-USD",
      kkmStatus: "SENT",
      kkmReceiptId: "provider-1",
      kkmRawJson: null,
      currencyCode: null,
      currencyRateKgsPerUnit: null,
      createdAt: new Date("2026-02-28T10:00:00.000Z"),
      completedAt: new Date("2026-02-28T10:01:00.000Z"),
      subtotalKgs: 895,
      totalKgs: 895,
      store: {
        id: "store-1",
        name: "Store",
        currencyCode: "KGS",
        currencyRateKgsPerUnit: "1",
        legalName: null,
        inn: null,
        address: null,
        phone: null,
      },
      register: null,
      shift: null,
      createdBy: null,
      lines: [],
      payments: [{ id: "p1", method: "CARD", amountKgs: 895 }],
      fiscalReceipts: [
        {
          currencyCode: "USD",
          currencyRateKgsPerUnit: "89.5",
          providerReceiptId: "provider-1",
          fiscalNumber: "100500",
          kkmFactoryNumber: null,
          kkmRegistrationNumber: null,
          fiscalModeStatus: "SENT",
          upfdOrFiscalMemory: null,
          qrPayload: null,
          qr: null,
          fiscalizedAt: new Date("2026-02-28T10:02:00.000Z"),
          sentAt: new Date("2026-02-28T10:02:00.000Z"),
          lastError: null,
        },
      ],
    });

    const payload = await buildReceiptPrintPayload({
      organizationId: "org-1",
      saleId: "sale-legacy",
      locale: "en-US",
      variant: "PRECHECK",
      paymentMethodLabels: {
        CASH: "Cash",
        CARD: "Card",
        TRANSFER: "Transfer",
        OTHER: "Other",
      },
    });

    expect(payload.currencyCode).toBe("USD");
    expect(payload.currencyRateKgsPerUnit).toBe(89.5);
  });
});

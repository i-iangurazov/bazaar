import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  prisma,
  buildPosReceiptPdfMock,
  buildPriceTagsPdfMock,
} = vi.hoisted(() => ({
  prisma: {
    storePrinterSettings: {
      findUnique: vi.fn(),
    },
    kkmConnectorDevice: {
      findFirst: vi.fn(),
    },
  },
  buildPosReceiptPdfMock: vi.fn(),
  buildPriceTagsPdfMock: vi.fn(),
}));

vi.mock("@/server/db/prisma", () => ({ prisma }));
vi.mock("@/server/services/posReceiptPdf", () => ({
  buildPosReceiptPdf: (...args: unknown[]) => buildPosReceiptPdfMock(...args),
}));
vi.mock("@/server/services/priceTagsPdf", () => ({
  buildPriceTagsPdf: (...args: unknown[]) => buildPriceTagsPdfMock(...args),
}));

import { printLabels, printReceipt } from "@/server/printing/adapter";

describe("printing adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildPosReceiptPdfMock.mockResolvedValue(Buffer.from("pdf-receipt"));
    buildPriceTagsPdfMock.mockResolvedValue(Buffer.from("pdf-labels"));
  });

  it("prints receipt via PDF mode by default", async () => {
    prisma.storePrinterSettings.findUnique.mockResolvedValue(null);

    const result = await printReceipt({
      organizationId: "org-1",
      job: {
        saleId: "sale-1",
        storeId: "store-1",
        locale: "ru-RU",
        variant: "PRECHECK",
        number: "S-000001",
        createdAt: new Date(),
        storeName: "Store",
        legalName: "Store LLC",
        inn: "123",
        address: "Address",
        phone: "+996",
        shiftLabel: "shift-1",
        items: [],
        totals: { subtotalKgs: 0, totalKgs: 0, payments: [] },
        fiscal: {
          modeStatus: "NOT_SENT",
          providerReceiptId: null,
          fiscalNumber: null,
          kkmFactoryNumber: null,
          kkmRegistrationNumber: null,
          upfdOrFiscalMemory: null,
          qrPayload: null,
          fiscalizedAt: null,
          lastError: null,
        },
      },
      labels: {
        title: "title",
        precheckTitle: "precheck",
        precheckHint: "hint",
        fiscalBlockTitle: "fiscal",
        fiscalStatus: "status",
        fiscalStatusSent: "sent",
        fiscalStatusNotSent: "not sent",
        fiscalStatusFailed: "failed",
        fiscalRetryHint: "retry",
        fiscalizedAt: "fiscalizedAt",
        kkmFactoryNumber: "factory",
        kkmRegistrationNumber: "registration",
        fiscalNumber: "fiscalNumber",
        upfdOrFiscalMemory: "upfd",
        qrPayload: "qr",
        saleNumber: "sale",
        createdAt: "date",
        register: "register",
        cashier: "cashier",
        shift: "shift",
        inn: "inn",
        address: "address",
        phone: "phone",
        qty: "qty",
        subtotal: "subtotal",
        total: "total",
        payments: "payments",
      },
    });

    expect(result.mode).toBe("PDF");
    expect(result.pdf.toString()).toBe("pdf-receipt");
    expect(buildPosReceiptPdfMock).toHaveBeenCalledTimes(1);
  });

  it("returns clean not-paired error in connector mode", async () => {
    prisma.storePrinterSettings.findUnique.mockResolvedValue({
      receiptPrintMode: "CONNECTOR",
      labelPrintMode: "PDF",
      connectorDeviceId: null,
    });

    await expect(
      printReceipt({
        organizationId: "org-1",
        job: {
          saleId: "sale-1",
          storeId: "store-1",
          locale: "ru-RU",
          variant: "PRECHECK",
          number: "S-000001",
          createdAt: new Date(),
          storeName: "Store",
          legalName: "Store LLC",
          inn: "123",
          address: "Address",
          phone: "+996",
          shiftLabel: "shift-1",
          items: [],
          totals: { subtotalKgs: 0, totalKgs: 0, payments: [] },
          fiscal: {
            modeStatus: "NOT_SENT",
            providerReceiptId: null,
            fiscalNumber: null,
            kkmFactoryNumber: null,
            kkmRegistrationNumber: null,
            upfdOrFiscalMemory: null,
            qrPayload: null,
            fiscalizedAt: null,
            lastError: null,
          },
        },
        labels: {
          title: "title",
          precheckTitle: "precheck",
          precheckHint: "hint",
          fiscalBlockTitle: "fiscal",
          fiscalStatus: "status",
          fiscalStatusSent: "sent",
          fiscalStatusNotSent: "not sent",
          fiscalStatusFailed: "failed",
          fiscalRetryHint: "retry",
          fiscalizedAt: "fiscalizedAt",
          kkmFactoryNumber: "factory",
          kkmRegistrationNumber: "registration",
          fiscalNumber: "fiscalNumber",
          upfdOrFiscalMemory: "upfd",
          qrPayload: "qr",
          saleNumber: "sale",
          createdAt: "date",
          register: "register",
          cashier: "cashier",
          shift: "shift",
          inn: "inn",
          address: "address",
          phone: "phone",
          qty: "qty",
          subtotal: "subtotal",
          total: "total",
          payments: "payments",
        },
      }),
    ).rejects.toMatchObject({ message: "printerConnectorNotPaired" });
  });

  it("prints labels via PDF mode", async () => {
    prisma.storePrinterSettings.findUnique.mockResolvedValue(null);

    const result = await printLabels({
      organizationId: "org-1",
      job: {
        storeId: "store-1",
        productIds: ["prod-1"],
        template: "3x8",
        quantities: { "prod-1": 1 },
        locale: "ru-RU",
        labels: [
          {
            name: "Product",
            sku: "SKU-1",
            barcode: "1234567890123",
            price: 10,
          },
        ],
        storeName: "Store",
        noPriceLabel: "No price",
        noBarcodeLabel: "No barcode",
        skuLabel: "SKU",
      },
    });

    expect(result.mode).toBe("PDF");
    expect(result.pdf.toString()).toBe("pdf-labels");
    expect(buildPriceTagsPdfMock).toHaveBeenCalledTimes(1);
  });
});

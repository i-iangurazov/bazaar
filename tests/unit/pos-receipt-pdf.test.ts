import { describe, expect, it } from "vitest";

import {
  __buildReceiptMetaLinesForTests,
  __formatReceiptCurrencyForTests,
  buildPosReceiptPdf,
  defaultReceiptTemplateSettings,
  type PosReceiptPdfLabels,
} from "@/server/services/posReceiptPdf";
import type { ReceiptPrintJob } from "@/server/printing/types";

const labels: PosReceiptPdfLabels = {
  title: "RECEIPT",
  precheckTitle: "PRECHECK",
  precheckHint: "Non-fiscal",
  fiscalBlockTitle: "Fiscal block",
  fiscalStatus: "Fiscal status",
  fiscalStatusSent: "Sent",
  fiscalStatusNotSent: "Not sent",
  fiscalStatusFailed: "Failed",
  fiscalRetryHint: "Retry with manager",
  fiscalizedAt: "Fiscalized at",
  kkmFactoryNumber: "Factory no",
  kkmRegistrationNumber: "Registration no",
  fiscalNumber: "Fiscal no",
  upfdOrFiscalMemory: "UPFD/FN",
  qrPayload: "QR payload",
  saleNumber: "Sale no",
  createdAt: "Date",
  register: "Register",
  cashier: "Cashier",
  shift: "Shift",
  inn: "INN",
  address: "Address",
  phone: "Phone",
  qty: "Qty",
  barcode: "Barcode",
  subtotal: "Subtotal",
  discount: "Discount",
  total: "Total",
  payments: "Payments",
  change: "Change",
  footer: "Footer",
};

const baseJob: Omit<ReceiptPrintJob, "variant" | "fiscal"> = {
  saleId: "sale-1",
  storeId: "store-1",
  locale: "ru-RU",
  number: "S-000001",
  createdAt: new Date("2026-02-28T10:10:00.000Z"),
  storeName: "Store",
  currencyCode: "KGS",
  currencyRateKgsPerUnit: "1",
  legalName: "Store LLC",
  inn: "12345678901234",
  address: "Bishkek",
  phone: "+996700000000",
  registerName: "Front (F1)",
  cashierName: "Cashier",
  shiftLabel: "shift-1",
  items: [
    {
      productId: "prod-1",
      name: "Товар",
      sku: "SKU-1",
      qty: 2,
      unitPriceKgs: 12.5,
      lineTotalKgs: 25,
    },
  ],
  totals: {
    subtotalKgs: 25,
    totalKgs: 25,
    payments: [{ method: "CASH", methodLabel: "Наличные", amountKgs: 25 }],
  },
};

describe("pos receipt pdf", () => {
  const job: ReceiptPrintJob = {
    ...baseJob,
    variant: "PRECHECK",
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
  };

  const pageCount = (pdf: Buffer) =>
    (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;

  const pageHeight = (pdf: Buffer) => {
    const match = pdf.toString("latin1").match(/\/MediaBox\s*\[0 0 [\d.]+ ([\d.]+)\]/);
    expect(match).not.toBeNull();
    return Number(match![1]);
  };

  it("keeps discounted receipts, change and a multiline footer on one continuous page", async () => {
    const pdf = await buildPosReceiptPdf({
      job: {
        ...job,
        totals: {
          subtotalKgs: 25,
          totalKgs: 20,
          payments: [{ method: "CASH", methodLabel: "Наличные", amountKgs: 50 }],
        },
      },
      labels,
      settings: {
        receiptMarginTopMm: 0,
        receiptMarginBottomMm: 10,
        receiptFooterText: "Спасибо за покупку!\nДо новых встреч!\nПроверьте сдачу.",
      },
    });

    expect(pageCount(pdf)).toBe(1);
  });

  it("includes the configured bottom margin in the paper length", async () => {
    const build = (receiptMarginBottomMm: number) => buildPosReceiptPdf({
      job: { ...job, items: Array.from({ length: 5 }, () => job.items[0]) },
      labels,
      settings: { receiptMarginTopMm: 0, receiptMarginBottomMm },
    });
    const [smallMargin, largeMargin] = await Promise.all([build(2), build(12)]);

    expect(pageCount(smallMargin)).toBe(1);
    expect(pageCount(largeMargin)).toBe(1);
    expect(pageHeight(largeMargin) - pageHeight(smallMargin)).toBeCloseTo(10 * 72 / 25.4, 3);
  });

  it("formats receipt totals with the selected store currency", () => {
    const formatted = __formatReceiptCurrencyForTests(895, {
      ...baseJob,
      currencyCode: "USD",
      currencyRateKgsPerUnit: "89.5",
      locale: "en-US",
      variant: "PRECHECK",
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
    });

    expect(formatted).toContain("$10.00");
    expect(formatted).not.toContain("KGS");
  });

  it("omits INN and shift from payment receipt meta lines", () => {
    const meta = __buildReceiptMetaLinesForTests({
      job: {
        ...baseJob,
        variant: "PRECHECK",
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
      labels,
      settings: defaultReceiptTemplateSettings,
    });

    expect(meta.businessLines).toEqual(["Address: Bishkek", "Phone: +996700000000"]);
    expect(meta.saleLines[0]).toBe("Sale no: S-000001");
    expect(meta.saleLines[1]?.startsWith("Date: ")).toBe(true);
    expect(meta.saleLines[2]).toBe("Register: Front (F1)");
    expect(meta.saleLines[3]).toBe("Cashier: Cashier");
    expect([...meta.businessLines, ...meta.saleLines].join(" ")).not.toContain("INN");
    expect([...meta.businessLines, ...meta.saleLines].join(" ")).not.toContain("Shift");
  });

  it("renders operational receipt without fiscal decorations", async () => {
    const pdf = await buildPosReceiptPdf({
      job: {
        ...baseJob,
        variant: "PRECHECK",
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
      labels,
    });

    const raw = pdf.toString("latin1");
    expect(pdf.length).toBeGreaterThan(500);
    expect(raw).not.toContain("/Subtype /Image");
  });

  it("does not embed fiscal QR/image block even for fiscal variant", async () => {
    const pdf = await buildPosReceiptPdf({
      job: {
        ...baseJob,
        variant: "FISCAL",
        fiscal: {
          modeStatus: "SENT",
          providerReceiptId: "provider-1",
          fiscalNumber: "100500",
          kkmFactoryNumber: "XP-365B-42",
          kkmRegistrationNumber: "REG-42",
          upfdOrFiscalMemory: "UPFD-777",
          qrPayload: "https://example.test/qr?id=1",
          fiscalizedAt: new Date("2026-02-28T10:11:00.000Z"),
          lastError: null,
        },
      },
      labels,
    });

    const raw = pdf.toString("latin1");
    expect(pdf.length).toBeGreaterThan(500);
    expect(raw).not.toContain("/Subtype /Image");
  });
});

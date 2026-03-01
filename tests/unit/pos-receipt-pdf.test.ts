import { describe, expect, it } from "vitest";

import { buildPosReceiptPdf, type PosReceiptPdfLabels } from "@/server/services/posReceiptPdf";
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
  subtotal: "Subtotal",
  total: "Total",
  payments: "Payments",
};

const baseJob: Omit<ReceiptPrintJob, "variant" | "fiscal"> = {
  saleId: "sale-1",
  storeId: "store-1",
  locale: "ru-RU",
  number: "S-000001",
  createdAt: new Date("2026-02-28T10:10:00.000Z"),
  storeName: "Store",
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

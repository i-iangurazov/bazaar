import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildSalesCorrectionPdf,
  buildSalesDocumentPdf,
  correctionPdfDifferenceLabel,
  correctionPdfDifferenceText,
  type SalesCorrectionPdfLabels,
  type SalesCorrectionPdfPayload,
  type SalesDocumentPdfLabels,
} from "@/server/services/salesDocumentPdf";
import { correctionDifferenceLabelKind } from "@/lib/salesOrderCorrectionDisplay";
import type { SalesDocumentPayload } from "@/server/services/salesDocuments";

const messages = (locale: string) =>
  JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as {
    salesDocuments: {
      pdf: SalesDocumentPdfLabels;
      correctionPdf: SalesCorrectionPdfLabels;
    };
  };
const labels = messages("ru").salesDocuments.pdf;
const correctionLabels = messages("ru").salesDocuments.correctionPdf;
const pages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;

const oneLine: SalesDocumentPayload = {
  id: "sale-1",
  organizationId: "org-1",
  storeId: "store-1",
  number: "SO-QA-1",
  status: "COMPLETED",
  isPosSale: false,
  createdAt: new Date("2026-11-17T04:30:00Z"),
  currencyCode: "KGS",
  currencyRateKgsPerUnit: 1,
  seller: {
    name: "ИП Продавец",
    storeName: "Бишкек · Центр",
    inn: "12345678901234",
    address: "Бишкек",
    phone: "+996555000111",
  },
  customer: {
    name: "Покупатель",
    phone: null,
    email: null,
    address: null,
  },
  items: [
    {
      id: "line-1",
      name: "Чай",
      variantName: null,
      sku: "TEA-1",
      unit: "шт",
      qty: 1,
      unitPriceKgs: 1234.56,
      lineTotalKgs: 1234.56,
    },
  ],
  subtotalKgs: 1234.56,
  discountKgs: 0,
  totalKgs: 1234.56,
};

const lines = (count: number, long: boolean): SalesDocumentPayload => {
  const items = Array.from({ length: count }, (_, index) => ({
    id: `line-${index + 1}`,
    name: long
      ? `Товар №${index + 1} · өтө узун аталышы менен сүрөттөлгөн продукт, подарочный набор для дома и семьи`
      : `Товар ${index + 1} короткое название`,
    variantName: long && index % 3 === 0 ? "Вариант · XL" : null,
    sku: `SKU-${String(index + 1).padStart(4, "0")}`,
    unit: "шт",
    qty: 1,
    unitPriceKgs: 12345.67 + index * 100,
    lineTotalKgs: 12345.67 + index * 100,
  }));
  const subtotalKgs = Number(items.reduce((sum, item) => sum + item.lineTotalKgs, 0).toFixed(2));
  return {
    ...oneLine,
    number: `SO-QA-${count}-${long ? "LONG" : "SHORT"}`,
    items,
    subtotalKgs,
    discountKgs: 1000,
    totalKgs: Number((subtotalKgs - 1000).toFixed(2)),
  };
};

const exchange: SalesCorrectionPdfPayload = {
  correctionNumber: "CR-1",
  createdAt: new Date("2026-11-17T05:00:00Z"),
  reason: "Обмен товара",
  notes: null,
  originalNumber: "SO-QA-1",
  originalCreatedAt: new Date("2026-11-16T04:00:00Z"),
  storeName: "Бишкек · Центр",
  customerName: "Покупатель",
  sellerName: "ИП Продавец",
  sellerInn: "12345678901234",
  returnedKgs: 350,
  addedKgs: 300,
  offsetKgs: 300,
  refundKgs: 50,
  chargeKgs: 0,
  refundRequestStatus: null,
  returnedItems: [
    {
      name: "Чай",
      sku: "TEA-1",
      qty: 2,
      unitPriceKgs: 150,
      lineTotalKgs: 300,
    },
    {
      name: "Подарочная упаковка",
      sku: "GIFT-1",
      qty: 1,
      unitPriceKgs: 50,
      lineTotalKgs: 50,
    },
  ],
  addedItems: [
    {
      name: "Кофе",
      sku: "COFFEE-1",
      qty: 1,
      unitPriceKgs: 300,
      lineTotalKgs: 300,
    },
  ],
  currencyCode: "KGS",
  currencyRateKgsPerUnit: 1,
};

describe("sales document pagination", () => {
  it("keeps a true one-line invoice on one page with room for totals and signatures", async () => {
    const pdf = await buildSalesDocumentPdf({
      job: oneLine,
      kind: "invoice",
      locale: "ru",
      labels,
    });
    expect(pages(pdf)).toBe(1);
  });

  it("keeps all 43 rows with totals and signatures on the final page instead of a signature-only page", async () => {
    const pdf = await buildSalesDocumentPdf({
      job: lines(43, false),
      kind: "invoice",
      locale: "ru",
      labels,
    });
    expect(pages(pdf)).toBe(3);
  });

  it("flows 43 long wrapped rows without creating an empty trailing page", async () => {
    const pdf = await buildSalesDocumentPdf({
      job: lines(43, true),
      kind: "invoice",
      locale: "ru",
      labels,
    });
    expect(pages(pdf)).toBe(5);
  });

  it("renders an exchange correction act as one page with the exchange settlement line", async () => {
    const pdf = await buildSalesCorrectionPdf({
      job: exchange,
      locale: "ru",
      labels: correctionLabels,
    });
    expect(pages(pdf)).toBe(1);
    expect(correctionDifferenceLabelKind(exchange)).toBe("refundPaid");
    expect(
      correctionPdfDifferenceText({
        ...exchange,
        labels: correctionLabels,
        moneyText: (value) => `${value.toFixed(2)}`,
      }),
    ).toBe("Денежная разница: Выплачено — 50.00");
    expect(correctionLabels.offsetSettled).toBe("Погашено обменом");
  });

  it("labels the refund line by the manual refund request state", () => {
    expect(correctionPdfDifferenceLabel("refundPending", correctionLabels)).toBe(
      correctionLabels.toRefundPending,
    );
    expect(correctionPdfDifferenceLabel("refundPaid", correctionLabels)).toBe(
      correctionLabels.toRefundPaid,
    );
    expect(correctionPdfDifferenceLabel("refundCanceled", correctionLabels)).toBe(
      correctionLabels.refundCanceled,
    );
    expect(correctionLabels.toRefundPending).toBe("Ожидает выплаты");
    expect(correctionLabels.toRefundPaid).toBe("Выплачено");
    expect(correctionLabels.refundCanceled).toBe("Возврат отменён");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildSalesDocumentPdf, type SalesDocumentPdfLabels } from "@/server/services/salesDocumentPdf";
import type { SalesDocumentPayload } from "@/server/services/salesDocuments";

const labels = (locale: string) => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).salesDocuments.pdf as SalesDocumentPdfLabels;
const job: SalesDocumentPayload = {
  id: "sale-1", organizationId: "org-1", storeId: "store-1", number: "SO-20261115-001", status: "COMPLETED", isPosSale: false,
  createdAt: new Date("2026-11-15T20:30:00Z"), currencyCode: "USD", currencyRateKgsPerUnit: 90,
  seller: { name: "ИП Продавец", storeName: "Дүкөн", inn: "12345678901234", address: "Бишкек", phone: "+996555000111" },
  customer: { name: "Покупатель с очень длинным наименованием", phone: null, email: null, address: null },
  items: [{ id: "line-1", name: "Кабель", variantName: "Чёрный", sku: "SKU-001", unit: "кг", qty: 0.125, unitPriceKgs: 912.5, lineTotalKgs: 114.06 }],
  subtotalKgs: 114.06, discountKgs: 0, totalKgs: 114.06,
};
const pages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
const dimensions = (pdf: Buffer) => Array.from(pdf.toString("latin1").matchAll(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/g), (match) => [Number(match[1]), Number(match[2])]);

describe("sales documents PDF layout", () => {
  it.each(["ru", "kg", "en"])("renders A4 and a compact80mm PDF with the shared font in %s", async (locale) => {
    for (const kind of ["invoice", "goods_receipt"] as const) {
      const pdf = await buildSalesDocumentPdf({ job, kind, locale, labels: labels(locale) });
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pdf.length).toBeGreaterThan(1000);
      expect(pages(pdf)).toBe(1);
      expect(dimensions(pdf)[0]![0]).toBeCloseTo(kind === "invoice" ? 595.28 : 80 * 72 / 25.4, 2);
      expect(dimensions(pdf)[0]![1]).toBeLessThanOrEqual(842);
      expect(pdf.toString("latin1")).toContain("/FontFile2");
    }
  });

  it("paginates150 sale lines with long Cyrillic names and unbroken SKUs in both formats", async () => {
    const longJob = { ...job, status: "DRAFT" as const, items: Array.from({ length: 150 }, (_, index) => ({ ...job.items[0]!, id: `line-${index}`, name: `${index + 1}. ${"Өрүк түстүү өтө узун товар аталышы и длинное название ".repeat(4)}`, sku: `SKU${"1234567890".repeat(14)}` })) };
    for (const kind of ["invoice", "goods_receipt"] as const) {
      const pdf = await buildSalesDocumentPdf({ job: longJob, kind, locale: "ru", labels: labels("ru") });
      expect(pages(pdf)).toBeGreaterThan(3);
      expect(dimensions(pdf).every(([width, height]) => width! > 200 && height! <= 842)).toBe(true);
    }
  });

  it("wraps a single exceptionally long name over pages instead of drawing beyond a page", async () => {
    const pdf = await buildSalesDocumentPdf({ job: { ...job, items: [{ ...job.items[0]!, name: "ДлинноеНазваниеБезПробелов".repeat(200) }] }, kind: "invoice", locale: "ru", labels: labels("ru") });
    expect(pages(pdf)).toBeGreaterThan(1);
    expect(dimensions(pdf).every(([, height]) => height! <= 842)).toBe(true);
  });
});

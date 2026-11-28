import { readFileSync } from "node:fs";
import PDFDocument from "pdfkit";
import { describe, expect, it, vi } from "vitest";

import { buildSalesDocumentPdf, type SalesDocumentPdfLabels } from "@/server/services/salesDocumentPdf";
import type { SalesDocumentPayload } from "@/server/services/salesDocuments";

const labels = (locale: string): SalesDocumentPdfLabels => {
  const { salesDocuments } = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
  return { ...salesDocuments.pdf, estimate: salesDocuments.estimate };
};
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
  it.each(["ru", "kg", "en"])("prints all 30 estimate rows without handover signatures in %s", async (locale) => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const translated = labels(locale);
    const items = Array.from({ length: 30 }, (_, index) => ({
      ...job.items[0]!,
      id: `estimate-line-${index + 1}`,
      name: `Item ${index + 1}`,
    }));
    const subtotalKgs = Math.round(items.reduce((sum, item) => sum + item.lineTotalKgs, 0) * 100) / 100;
    try {
      const pdf = await buildSalesDocumentPdf({
        job: { ...job, status: "DRAFT", items, subtotalKgs, totalKgs: subtotalKgs },
        kind: "estimate",
        locale,
        labels: translated,
      });
      const printed = text.mock.calls.map(([value]) => String(value));
      expect(pages(pdf)).toBeGreaterThan(1);
      expect(printed).toEqual(expect.arrayContaining([
        translated.estimate, translated.estimateNote, translated.price, translated.amount,
        ...items.map((item) => item.name),
      ]));
      expect(printed).not.toContain(translated.issuedBy);
      expect(printed).not.toContain(translated.receivedBy);
    } finally {
      text.mockRestore();
    }
  });

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

  it.each(["invoice", "invoice_without_prices"] as const)("wraps a single exceptionally long %s name across A4 pages", async (kind) => {
    const pdf = await buildSalesDocumentPdf({ job: { ...job, items: [{ ...job.items[0]!, name: "ДлинноеНазваниеБезПробелов".repeat(200) }] }, kind, locale: "ru", labels: labels("ru") });
    expect(pages(pdf)).toBeGreaterThan(1);
    expect(dimensions(pdf).every(([, height]) => height! <= 842)).toBe(true);
  });

  it.each(["ru", "kg", "en"])("fits 18 short delivery rows on one A4 page in %s", async (locale) => {
    const pdf = await buildSalesDocumentPdf({
      job: {
        ...job,
        items: Array.from({ length: 18 }, (_, index) => ({
          ...job.items[0]!,
          id: `line-${index}`,
          name: `Кабель ${index + 1} · өтө бышык`,
        })),
      },
      kind: "invoice_without_prices",
      locale,
      labels: labels(locale),
    });
    expect(pages(pdf)).toBe(1);
    expect(dimensions(pdf)[0]![0]).toBeCloseTo(595.28, 2);
    expect(dimensions(pdf)[0]![1]).toBeCloseTo(841.89, 2);
    expect(pdf.toString("latin1")).toContain("/FontFile2");
  });

  it("prints item, variant, unit and quantity without price fields or private party details", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const ru = labels("ru");
    try {
      const pdf = await buildSalesDocumentPdf({
        job: {
          ...job,
          discountKgs: 15,
          totalKgs: 99.06,
          seller: { ...job.seller, name: "Private seller name" },
          customer: { name: "Private customer name", phone: "+996555000222", address: "Private street", email: "qa@example.com" },
        },
        kind: "invoice_without_prices",
        locale: "ru",
        labels: ru,
      });
      const printed = text.mock.calls.map(([value]) => String(value));
      expect(printed).toEqual(expect.arrayContaining([
        ru.invoiceWithoutPrices, ru.product, ru.unit, ru.quantity, "Кабель · Чёрный", "кг", "0,125",
      ]));
      for (const value of [ru.price, ru.amount, ru.subtotal, ru.discount, ru.total, ru.seller, ru.customer]) {
        expect(printed).not.toContain(value);
      }
      expect(printed.join("\n")).not.toMatch(/Private|qa@example\.com|\+996|12345678901234|SKU-001|USD|KGS/);
      expect(printed.join("\n")).not.toMatch(/912[,.]5|114[,.]06|99[,.]06/);
      expect(pdf.toString("latin1")).not.toContain("Private seller name");
    } finally {
      text.mockRestore();
    }
  });

  it("repeats delivery headers and keeps every long row and the last-page signatures", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const ru = labels("ru");
    const items = Array.from({ length: 50 }, (_, index) => ({
      ...job.items[0]!,
      id: `line-${index}`,
      name: `Позиция ${index + 1} · ${"Длинное описание товара, которое переносится на следующую строку. ".repeat(3)}`,
    }));
    try {
      const pdf = await buildSalesDocumentPdf({
        job: { ...job, status: "DRAFT", items },
        kind: "invoice_without_prices",
        locale: "ru",
        labels: ru,
      });
      const printed = text.mock.calls.map(([value]) => String(value));
      const pageCount = pages(pdf);
      expect(pageCount).toBeGreaterThan(1);
      expect(printed.filter((line) => line === ru.product)).toHaveLength(pageCount);
      expect(printed.filter((line) => line === ru.issuedBy)).toHaveLength(1);
      expect(printed.filter((line) => line === ru.receivedBy)).toHaveLength(1);
      expect(printed.filter((line) => line.startsWith("Позиция "))).toHaveLength(items.length);
      expect(printed).toContain(`${ru.page} ${pageCount}/${pageCount}`);
    } finally {
      text.mockRestore();
    }
  });
});

import { describe, expect, it, vi } from "vitest";
import PDFDocument from "pdfkit";

import { ROLL_PRICE_TAG_TEMPLATE } from "@/lib/priceTags";
import { resolveLabelTextStyles } from "@/lib/labelTextStyles";
import { mmToPoints } from "@/server/services/priceTagsLayout";
import {
  buildPriceTagsPdf,
  formatPriceTagCurrency,
} from "../../src/server/services/priceTagsPdf";

const readMediaBox = (pdf: Buffer) => {
  const raw = pdf.toString("latin1");
  const match = raw.match(/\/MediaBox\s*\[\s*0\s+0\s+([0-9.]+)\s+([0-9.]+)\s*\]/);
  if (!match) {
    throw new Error("MEDIABOX_NOT_FOUND");
  }
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
};

describe("price tags pdf", () => {
  it("reserves the actual Cyrillic font line height before drawing the barcode", async () => {
    const positions: Array<{ y: number; height: number }> = [];
    const originalText = PDFDocument.prototype.text;
    const text = vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: PDFKit.PDFDocument, ...args: Parameters<typeof originalText>) {
      positions.push({ y: Number(args[2]), height: this.currentLineHeight(false) });
      return originalText.apply(this, args);
    });
    const image = vi.spyOn(PDFDocument.prototype, "image");
    try {
      const styles = resolveLabelTextStyles(null, 8);
      styles.name.overflow = "wrap";
      await buildPriceTagsPdf({
        labels: [{ name: "Шпатель зубчатый 250 мм для профессиональной укладки плитки", sku: "", barcode: "5901234123457", price: null }],
        template: ROLL_PRICE_TAG_TEMPLATE, locale: "ru", storeName: null,
        noPriceLabel: "", noBarcodeLabel: "", skuLabel: "SKU", labelTextStyles: styles,
        showBarcodeText: false,
      });
      expect(positions).toHaveLength(2);
      expect(Number(image.mock.calls[0]![2])).toBeGreaterThanOrEqual(positions[1]!.y + positions[1]!.height);
    } finally { text.mockRestore(); image.mockRestore(); }
  });

  it.each(["name", "barcode", "barcodeText", "price"] as const)("applies the independent gap after %s in physical millimetres", async (field) => {
    const drawText = vi.spyOn(PDFDocument.prototype, "text");
    const drawImage = vi.spyOn(PDFDocument.prototype, "image");
    try {
      const next = { name: null, barcode: "0001234567895", barcodeText: "100", price: "SKU: SAMPLE" }[field];
      const positions: number[] = [];
      for (const gap of [0, 2]) {
        drawText.mockClear(); drawImage.mockClear();
        const styles = resolveLabelTextStyles(null, 8);
        styles.spacing[field] = gap;
        await buildPriceTagsPdf({
          labels: [{ name: "Название", sku: "SAMPLE", barcode: "0001234567895", price: 100 }],
          template: ROLL_PRICE_TAG_TEMPLATE, locale: "ru", storeName: null,
          noPriceLabel: "Без цены", noBarcodeLabel: "", skuLabel: "SKU",
          rollCalibration: { widthMm: 58, heightMm: 60, gapMm: 3.5, xOffsetMm: 0, yOffsetMm: 0 },
          labelTextStyles: styles,
        });
        positions.push(Number(next ? drawText.mock.calls.find(call => call[0] === next)?.[2] : drawImage.mock.calls[0]?.[2]));
      }
      expect(positions[1]! - positions[0]!).toBeCloseTo(mmToPoints(2), 5);
    } finally { drawText.mockRestore(); drawImage.mockRestore(); }
  });

  it.each([0, 1000, 12345.67])("keeps %s and its independently sized currency on one baseline", async (price) => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    try {
      const styles = resolveLabelTextStyles(null, 8);
      styles.price.fontSize = 18;
      styles.currency.fontSize = 7;
      await buildPriceTagsPdf({
        labels: [{ name: "Товар", sku: "", barcode: "", price }],
        template: ROLL_PRICE_TAG_TEMPLATE, locale: "ru", storeName: null,
        noPriceLabel: "Без цены", noBarcodeLabel: "", skuLabel: "SKU",
        showSku: false, showStoreName: false, labelTextStyles: styles,
      });
      const amount = text.mock.calls.find((call) => call[0] === new Intl.NumberFormat("ru", { maximumFractionDigits: 2 }).format(price));
      const currency = text.mock.calls.find((call) => call[0] === "KGS");
      expect(amount).toBeDefined();
      expect(currency).toBeDefined();
      expect(currency![2]).toBe(amount![2]);
      expect(Number(currency![1])).toBeGreaterThan(Number(amount![1]));
      expect(amount![3]).toMatchObject({ baseline: "alphabetic", lineBreak: false });
      expect(currency![3]).toMatchObject({ baseline: "alphabetic", lineBreak: false });
    } finally { text.mockRestore(); }
  });

  it("rejects a monetary row when its configured minimum size cannot fit", async () => {
    const styles = resolveLabelTextStyles(null, 8);
    styles.price.fontSize = 48;
    styles.price.minFontSize = 48;
    styles.price.overflow = "wrap";
    styles.currency.overflow = "wrap";
    await expect(buildPriceTagsPdf({
      labels: [{ name: "", sku: "", barcode: "", price: 123456789 }],
      template: ROLL_PRICE_TAG_TEMPLATE, locale: "ru", storeName: null,
      noPriceLabel: "Без цены", noBarcodeLabel: "", skuLabel: "SKU",
      rollCalibration: { widthMm: 40, heightMm: 30, gapMm: 3.5, xOffsetMm: 0, yOffsetMm: 0 },
      labelTextStyles: styles,
    })).rejects.toMatchObject({ message: "labelLayoutOverflow" });
  });

  it("fits a complete large monetary value without wrapping or truncating its currency", async () => {
    const styles = resolveLabelTextStyles(null, 8);
    styles.price.fontSize = 48;
    const warnings: string[] = [];
    const text = vi.spyOn(PDFDocument.prototype, "text");
    try {
      const pdf = await buildPriceTagsPdf({
        labels: [{ name: "", sku: "", barcode: "", price: 123456789 }],
        template: ROLL_PRICE_TAG_TEMPLATE, locale: "ru", storeName: null,
        noPriceLabel: "Без цены", noBarcodeLabel: "", skuLabel: "SKU",
        rollCalibration: { widthMm: 40, heightMm: 30, gapMm: 3.5, xOffsetMm: 0, yOffsetMm: 0 },
        labelTextStyles: styles, layoutWarnings: warnings,
      });
      expect(warnings).toEqual([]);
      const amount = text.mock.calls.slice().reverse().find(call => call[0] === "123 456 789");
      const currency = text.mock.calls.slice().reverse().find(call => call[0] === "KGS");
      expect(amount).toBeDefined();
      expect(currency![2]).toBe(amount![2]);
      expect(readMediaBox(pdf).height).toBeCloseTo(mmToPoints(30), 1);
    } finally { text.mockRestore(); }
  });

  it("automatically fits a dense saved profile on a 58x30 label without changing settings", async () => {
    const styles = resolveLabelTextStyles(null, 14);
    styles.name.overflow = "wrap";
    styles.spacing.name = 2;
    styles.spacing.barcode = 2;
    styles.spacing.price = 2;
    const original = structuredClone(styles);
    const warnings: string[] = [];
    const pdf = await buildPriceTagsPdf({
      labels: [{ name: "Шпатель зубчатый 250 мм для профессиональной укладки плитки", sku: "SKU-007772", barcode: "5901234123457", price: 400 }],
      template: ROLL_PRICE_TAG_TEMPLATE, locale: "ru", storeName: "Курулуш Гранд",
      noPriceLabel: "Без цены", noBarcodeLabel: "Нет штрихкода", skuLabel: "SKU",
      rollCalibration: { widthMm: 58, heightMm: 30, gapMm: 3.5, xOffsetMm: 0, yOffsetMm: 0 },
      barcodeHeightMm: 12, labelTextStyles: styles, layoutWarnings: warnings,
    });
    expect(warnings).toEqual([]);
    expect(styles).toEqual(original);
    expect(readMediaBox(pdf).height).toBeCloseTo(mmToPoints(30), 1);
    expect(pdf.length).toBeGreaterThan(500);
  });

  it("formats label prices with non-KGS store currency", () => {
    const formatted = formatPriceTagCurrency(895, "en-US", "USD", "89.5");

    expect(formatted).toContain("$10.00");
    expect(formatted).not.toContain("KGS");
  });

  it("renders Cyrillic labels without throwing", async () => {
    const labelText = "Молоко 3.2%";
    const pdf = await buildPriceTagsPdf({
      labels: [
        {
          name: labelText,
          sku: "SKU-001",
          barcode: "123456789",
          price: 42,
        },
      ],
      template: "3x8",
      locale: "ru-RU",
      storeName: "Магазин Центр",
      noPriceLabel: "Нет цены",
      noBarcodeLabel: "Нет штрихкода",
      skuLabel: "Артикул",
    });

    expect(pdf.length).toBeGreaterThan(500);
  });

  it("renders EAN-13 barcodes without throwing", async () => {
    const pdf = await buildPriceTagsPdf({
      labels: [
        {
          name: "Тест",
          sku: "SKU-002",
          barcode: "5901234123457",
          price: 12,
        },
      ],
      template: "3x8",
      locale: "ru-RU",
      storeName: null,
      noPriceLabel: "Нет цены",
      noBarcodeLabel: "Нет штрихкода",
      skuLabel: "Артикул",
    });

    expect(pdf.length).toBeGreaterThan(500);
  });

  it("renders fallback text when barcode is missing", async () => {
    const pdf = await buildPriceTagsPdf({
      labels: [
        {
          name: "Без штрихкода",
          sku: "SKU-003",
          barcode: "",
          price: null,
        },
      ],
      template: "3x8",
      locale: "ru-RU",
      storeName: null,
      noPriceLabel: "Нет цены",
      noBarcodeLabel: "Нет штрихкода",
      skuLabel: "Артикул",
    });

    expect(pdf.length).toBeGreaterThan(500);
  });

  it("creates 58x40mm pages for XP-365B roll template", async () => {
    const pdf = await buildPriceTagsPdf({
      labels: [
        {
          name: "Ролл",
          sku: "ROLL-1",
          barcode: "5901234123457",
          price: 99,
        },
      ],
      template: ROLL_PRICE_TAG_TEMPLATE,
      locale: "ru-RU",
      storeName: null,
      noPriceLabel: "Цена не задана",
      noBarcodeLabel: "Нет штрихкода",
      skuLabel: "SKU",
      rollCalibration: {
        gapMm: 3.5,
        xOffsetMm: 0,
        yOffsetMm: 0,
      },
    });

    const mediaBox = readMediaBox(pdf);
    expect(mediaBox.width).toBeCloseTo(mmToPoints(58), 1);
    expect(mediaBox.height).toBeCloseTo(mmToPoints(40), 1);
    expect(pdf.length).toBeGreaterThan(500);
  });

  it("applies custom roll width/height from calibration", async () => {
    const pdf = await buildPriceTagsPdf({
      labels: [
        {
          name: "Ролл custom",
          sku: "ROLL-CUSTOM",
          barcode: "5901234123457",
          price: 99,
        },
      ],
      template: ROLL_PRICE_TAG_TEMPLATE,
      locale: "ru-RU",
      storeName: null,
      noPriceLabel: "Цена не задана",
      noBarcodeLabel: "Нет штрихкода",
      skuLabel: "SKU",
      rollCalibration: {
        gapMm: 3.5,
        xOffsetMm: 0,
        yOffsetMm: 0,
        widthMm: 60,
        heightMm: 50,
      },
    });

    const mediaBox = readMediaBox(pdf);
    expect(mediaBox.width).toBeCloseTo(mmToPoints(60), 1);
    expect(mediaBox.height).toBeCloseTo(mmToPoints(50), 1);
    expect(pdf.length).toBeGreaterThan(500);
  });

  it("handles invalid EAN-13 values by falling back to Code128", async () => {
    const pdf = await buildPriceTagsPdf({
      labels: [
        {
          name: "Неверный EAN",
          sku: "ROLL-2",
          barcode: "5901234123458",
          price: 80,
        },
      ],
      template: ROLL_PRICE_TAG_TEMPLATE,
      locale: "ru-RU",
      storeName: null,
      noPriceLabel: "Цена не задана",
      noBarcodeLabel: "Нет штрихкода",
      skuLabel: "SKU",
      rollCalibration: {
        gapMm: 3.5,
        xOffsetMm: 0,
        yOffsetMm: 0,
      },
    });

    expect(pdf.length).toBeGreaterThan(500);
  });
});

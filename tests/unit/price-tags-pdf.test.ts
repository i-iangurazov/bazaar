import { describe, expect, it } from "vitest";

import { ROLL_PRICE_TAG_TEMPLATE } from "@/lib/priceTags";
import { mmToPoints } from "@/server/services/priceTagsLayout";
import { buildPriceTagsPdf } from "../../src/server/services/priceTagsPdf";

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

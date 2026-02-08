import { describe, expect, it } from "vitest";

import { buildPriceTagsPdf } from "../../src/server/services/priceTagsPdf";

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
      skuLabel: "Артикул",
    });

    expect(pdf.length).toBeGreaterThan(500);
  });
});

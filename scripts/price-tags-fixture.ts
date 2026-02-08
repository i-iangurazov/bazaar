import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildPriceTagsPdf } from "../src/server/services/priceTagsPdf";

const run = async () => {
  const pdf = await buildPriceTagsPdf({
    labels: [
      {
        name: "Очень длинное название продукта с кириллицей и дополнительными словами",
        sku: "SKU-VERY-LONG-001",
        barcode: "5901234123457",
        price: null,
      },
      {
        name: "Молоко 3.2%",
        sku: "SKU-002",
        barcode: "123456789012",
        price: 42,
      },
      {
        name: "Хлеб",
        sku: "SKU-003-EXTRA-LONG",
        barcode: "ABC-123-XYZ",
        price: 15,
      },
    ],
    template: "3x8",
    locale: "ru-RU",
    storeName: "Магазин Центр",
    noPriceLabel: "Цена не задана",
    skuLabel: "Артикул",
  });

  const outputDir = join(process.cwd(), "tmp");
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, "price-tags-fixture.pdf");
  await writeFile(outputPath, pdf);
  // eslint-disable-next-line no-console
  console.log(`Saved ${outputPath}`);
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});

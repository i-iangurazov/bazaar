import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import {
  buildBakaiStoreExportRows,
  detectBakaiTemplateSchema,
  normalizeBakaiNumericValue,
  renderBakaiStoreWorkbookFromTemplate,
} from "@/server/services/bakaiStore";

const createTemplateBuffer = () => {
  const workbook = XLSX.utils.book_new();
  const exportSheet = XLSX.utils.aoa_to_sheet([
    ["SKU", "Name", "Price", "Скидка (%)", "Сумма скидки", "pp1", "pp2"],
    ["sample-sku", "Sample row", 10, "", "", 1, 2],
  ]);
  const metaSheet = XLSX.utils.aoa_to_sheet([["meta"]]);
  XLSX.utils.book_append_sheet(workbook, exportSheet, "Products");
  XLSX.utils.book_append_sheet(workbook, metaSheet, "Meta");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
};

describe("bakai store workbook renderer", () => {
  it("normalizes price-like values before validation", () => {
    expect(normalizeBakaiNumericValue("1 234,50")).toBe(1234.5);
    expect(normalizeBakaiNumericValue("1200")).toBe(1200);
    expect(normalizeBakaiNumericValue("")).toBeNull();
    expect(Number.isNaN(normalizeBakaiNumericValue("1,2,3") ?? Number.NaN)).toBe(true);
  });

  it("renders rows into the uploaded template and preserves header order", async () => {
    const templateBuffer = createTemplateBuffer();
    const templateSchema = detectBakaiTemplateSchema(XLSX.read(templateBuffer, { type: "buffer" }));
    const rows = buildBakaiStoreExportRows({
      stockColumnKeys: ["pp1", "pp2"],
      products: [
        {
          productId: "product-2",
          sku: "SKU-2",
          name: "Product 2",
          price: 200,
          discountAmount: 15,
          stockByColumn: { pp1: 3, pp2: 0 },
        },
        {
          productId: "product-1",
          sku: "SKU-1",
          name: "Product 1",
          price: 100,
          discountPercent: 10,
          stockByColumn: { pp1: 7, pp2: 2 },
        },
      ],
    });

    const rendered = await renderBakaiStoreWorkbookFromTemplate({
      templateBuffer,
      templateSchema,
      rows,
    });

    const workbook = XLSX.read(rendered, { type: "buffer", raw: true });
    expect(workbook.SheetNames).toEqual(["Products", "Meta"]);

    const sheet = workbook.Sheets.Products;
    if (!sheet) {
      throw new Error("products sheet missing");
    }

    const values = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      blankrows: false,
      raw: true,
    });

    expect(values[0]).toEqual(["SKU", "Name", "Price", "Скидка (%)", "Сумма скидки", "pp1", "pp2"]);
    expect(values[1]).toEqual(["SKU-1", "Product 1", 100, 10, undefined, 7, 2]);
    expect(values[2]).toEqual(["SKU-2", "Product 2", 200, undefined, 15, 3, 0]);

    expect(sheet.C2?.t).toBe("n");
    expect(sheet.D2?.t).toBe("n");
    expect(sheet.E2).toBeUndefined();
    expect(sheet.E3?.t).toBe("n");
    expect(sheet.F2?.t).toBe("n");
    expect(sheet.G2?.t).toBe("n");
  });
});

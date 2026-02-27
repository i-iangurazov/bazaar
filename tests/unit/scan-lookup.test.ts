import { describe, expect, it, vi } from "vitest";

import { lookupScanProducts } from "@/server/services/scanLookup";

describe("lookupScanProducts", () => {
  it("prefers exact barcode matches", async () => {
    const client = {
      productBarcode: {
        findFirst: vi.fn().mockResolvedValue({
          product: { id: "prod-1", sku: "SKU-1", name: "Milk" },
        }),
      },
      productPack: { findFirst: vi.fn().mockResolvedValue(null) },
      product: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const result = await lookupScanProducts(client, "org-1", " 123 ");

    expect(result.exactMatch).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.matchType).toBe("barcode");
    expect(client.productBarcode.findFirst).toHaveBeenCalled();
    expect(client.product.findFirst).not.toHaveBeenCalled();
  });

  it("falls back to exact SKU match", async () => {
    const client = {
      productBarcode: { findFirst: vi.fn().mockResolvedValue(null) },
      productPack: { findFirst: vi.fn().mockResolvedValue(null) },
      product: {
        findFirst: vi.fn().mockResolvedValue({ id: "prod-2", sku: "SKU-2", name: "Bread" }),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const result = await lookupScanProducts(client, "org-1", " SKU-2 ");

    expect(result.exactMatch).toBe(true);
    expect(result.items[0]).toMatchObject({ id: "prod-2", matchType: "sku" });
    expect(client.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sku: { equals: "SKU-2", mode: "insensitive" } }),
      }),
    );
  });

  it("returns name matches when no exact match", async () => {
    const client = {
      productBarcode: { findFirst: vi.fn().mockResolvedValue(null) },
      productPack: { findFirst: vi.fn().mockResolvedValue(null) },
      product: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "prod-3",
            sku: "SKU-3",
            name: "Cheese",
            isBundle: false,
            images: [],
            barcodes: [],
          },
        ]),
      },
    };

    const result = await lookupScanProducts(client, "org-1", "che");

    expect(result.exactMatch).toBe(false);
    expect(result.items[0]).toMatchObject({ id: "prod-3", matchType: "name" });
    expect(client.product.findMany).toHaveBeenCalled();
  });
});

import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  chunkBakaiStoreItems,
  mapBazaarProductToBakaiProduct,
  normalizeBakaiApiError,
  pruneOptionalBakaiFields,
  validateBakaiImages,
} from "@/server/services/bakaiStore";

describe("bakai store api helpers", () => {
  it("omits optional nullish fields from payload objects", () => {
    expect(
      pruneOptionalBakaiFields({
        name: "Product",
        discount_amount: undefined,
        brand_name: null,
        images: ["https://cdn.example.com/1.jpg"],
        attributes: [],
        nested: {
          optional: null,
          present: "yes",
        },
      }),
    ).toEqual({
      name: "Product",
      images: ["https://cdn.example.com/1.jpg"],
      nested: {
        present: "yes",
      },
    });
  });

  it("validates image count and allowed file extensions", () => {
    expect(
      validateBakaiImages([
        "https://cdn.example.com/1.jpg",
        "https://cdn.example.com/2.png",
        "https://cdn.example.com/3.webp",
      ]),
    ).toEqual({
      normalized: [
        "https://cdn.example.com/1.jpg",
        "https://cdn.example.com/2.png",
        "https://cdn.example.com/3.webp",
      ],
      issues: [],
    });

    expect(
      validateBakaiImages([
        "https://cdn.example.com/1.jpg",
        "https://cdn.example.com/2.gif",
      ]).issues,
    ).toEqual(expect.arrayContaining(["NOT_ENOUGH_IMAGES", "INVALID_IMAGE_URL"]));
  });

  it("maps a Bazaar product into the Bakai payload and omits absent optional fields", () => {
    const mapped = mapBazaarProductToBakaiProduct({
      selection: {
        productId: "product-1",
        discountPercent: null,
        discountAmount: null,
        lastExportedAt: null,
        product: {
          id: "product-1",
          sku: "SKU-1",
          name: "Valid Bakai Name",
          category: "Sneakers",
          description:
            "Это достаточно длинное описание товара для проверки API-валидации Bakai.",
          basePriceKgs: new Prisma.Decimal("129.99"),
          photoUrl: null,
          supplier: { name: "Brand X" },
          images: [
            { url: "https://cdn.example.com/1.jpg", position: 0 },
            { url: "https://cdn.example.com/2.png", position: 1 },
            { url: "https://cdn.example.com/3.webp", position: 2 },
          ],
        },
      },
      mappedBranches: [{ storeId: "store-1", branchId: "101" }],
      snapshotByStore: new Map([["store-1", 5]]),
      templatesByCategory: new Map([
        [
          "Sneakers",
          [
            {
              category: "Sneakers",
              attributeKey: "color",
              label: "Цвет",
            },
          ],
        ],
      ]),
      valuesByProduct: new Map([["product-1", new Map([["color", ["black"]]])]]),
    });

    expect(mapped.issues).toEqual([]);
    expect(mapped.payload).toEqual({
      name: "Valid Bakai Name",
      sku: "SKU-1",
      price: 129.99,
      category_name: "Sneakers",
      description:
        "Это достаточно длинное описание товара для проверки API-валидации Bakai.",
      images: [
        "https://cdn.example.com/1.jpg",
        "https://cdn.example.com/2.png",
        "https://cdn.example.com/3.webp",
      ],
      branch_id: 101,
      quantity: 5,
      attributes: [{ name: "Цвет", value: "black" }],
      brand_name: "Brand X",
      is_active: true,
    });
    expect(mapped.payload).not.toHaveProperty("discount_amount");
  });

  it("reports API payload issues for invalid branch, stock, name, description, and specs", () => {
    const mapped = mapBazaarProductToBakaiProduct({
      selection: {
        productId: "product-2",
        discountPercent: null,
        discountAmount: null,
        lastExportedAt: null,
        product: {
          id: "product-2",
          sku: "SKU-2",
          name: "Short",
          category: "Sneakers",
          description: "Слишком коротко",
          basePriceKgs: new Prisma.Decimal("50"),
          photoUrl: null,
          supplier: null,
          images: [{ url: "https://cdn.example.com/1.gif", position: 0 }],
        },
      },
      mappedBranches: [{ storeId: "store-1", branchId: "branch-a" }],
      snapshotByStore: new Map([["store-1", -2]]),
      templatesByCategory: new Map(),
      valuesByProduct: new Map(),
    });

    expect(mapped.payload).toBeNull();
    expect(mapped.issues).toEqual(
      expect.arrayContaining([
        "INVALID_NAME_LENGTH",
        "DESCRIPTION_TOO_SHORT",
        "NOT_ENOUGH_IMAGES",
        "INVALID_IMAGE_URL",
        "MISSING_SPECS",
        "INVALID_BRANCH_ID",
        "INVALID_QUANTITY",
      ]),
    );
  });

  it("chunks payload items at the configured batch size", () => {
    const chunks = chunkBakaiStoreItems(
      Array.from({ length: 1001 }, (_, index) => index + 1),
      1000,
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(1000);
    expect(chunks[1]).toEqual([1001]);
  });

  it("normalizes API errors and redacts the token from snapshots", () => {
    const token = "secret-token";
    const error = new Error(`Authorization: Bearer ${token} failed`);
    const normalized = normalizeBakaiApiError({
      status: 429,
      body: {
        detail: `Authorization: Bearer ${token}`,
      },
      error,
      token,
    });

    expect(normalized.code).toBe("RATE_LIMITED");
    expect(normalized.retryable).toBe(true);
    expect(JSON.stringify(normalized.body)).not.toContain(token);
    expect(normalized.message).not.toContain(token);
  });
});

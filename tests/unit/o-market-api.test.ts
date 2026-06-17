import { Prisma, OMarketJobType } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  createOrUpdateOMarketProducts,
  getOMarketImportStatus,
  updateOMarketStockPrice,
} from "@/server/services/oMarketApiClient";
import {
  chunkOMarketItems,
  mapBazaarProductToOMarketProduct,
  normalizeOMarketApiError,
  validateOMarketImages,
} from "@/server/services/oMarket";

describe("o-market api helpers", () => {
  it("constructs create/update requests with the documented X-Access-Token header", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ result: { task_id: 42 }, status: "success" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const response = await createOrUpdateOMarketProducts({
      token: "secret-token",
      baseUrl: "https://api-market.o.kg/",
      payload: { products: [{ sku: "SKU-1", price: 100, quantity: 2 }] },
      fetchImpl,
    });

    expect(response.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api-market.o.kg/api/mia/v1/product/import/create-or-update/",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Access-Token": "secret-token",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ products: [{ sku: "SKU-1", price: 100, quantity: 2 }] }),
      }),
    );
  });

  it("uses the documented stock and price update endpoint", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ result: { task_id: 7 }, status: "success" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    await updateOMarketStockPrice({
      token: "token",
      payload: { products: [{ sku: "SKU-1", price: 250, quantity: 5 }] },
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api-market.o.kg/api/mia/v1/product/import",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("fetches import status by task id", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([{ sku: "SKU-1", status: "success", error_data: [] }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    await getOMarketImportStatus({ token: "token", taskId: 42, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api-market.o.kg/api/mia/v1/product/import/info/42",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("validates O! Market image URL requirements without silently dropping all images", () => {
    expect(
      validateOMarketImages(["https://cdn.example.com/1.jpg", "data:image/png;base64,abc"]),
    ).toEqual({
      normalized: ["https://cdn.example.com/1.jpg"],
      issues: ["INVALID_IMAGE_URL"],
    });

    expect(validateOMarketImages(["data:image/png;base64,abc"]).issues).toEqual(
      expect.arrayContaining(["INVALID_IMAGE_URL", "MISSING_IMAGE"]),
    );
  });

  it("maps a Bazaar product into the documented O! Market product payload", () => {
    const mapped = mapBazaarProductToOMarketProduct({
      jobType: OMarketJobType.PRODUCT_EXPORT,
      locationId: 1,
      categoryMapping: {
        oMarketCategoryId: 15,
        attributesJson: [{ attribute_id: 1208, value_id: 8132 }],
      },
      snapshotOnHand: 4,
      hasLocalSpecs: true,
      selection: {
        productId: "product-1",
        discountType: "PERCENTAGE",
        discountValue: new Prisma.Decimal("10"),
        product: {
          id: "product-1",
          sku: " phone-1 ",
          name: "Phone 1",
          category: "Phones",
          description: "A public O! Market description",
          basePriceKgs: new Prisma.Decimal("1200"),
          storePrices: [{ priceKgs: new Prisma.Decimal("1100") }],
          photoUrl: "https://cdn.example.com/main.jpg",
          images: [{ url: "https://cdn.example.com/extra.png", position: 1 }],
        },
      },
    });

    expect(mapped.issues).toEqual([]);
    expect(mapped.payload).toEqual({
      sku: "PHONE-1",
      title: "Phone 1",
      description: "A public O! Market description",
      category_id: 15,
      price: 1100,
      quantity: 4,
      discount_type: "PERCENTAGE",
      discount_value: 10,
      images: [
        {
          type: "url",
          image: "https://cdn.example.com/main.jpg",
          is_primary_image: true,
        },
        {
          type: "url",
          image: "https://cdn.example.com/extra.png",
        },
      ],
      currency: "som",
      location_id: 1,
      is_delivery_enabled: true,
      attributes: [{ attribute_id: 1208, value_id: 8132 }],
    });
  });

  it("reports category, spec, image, price, and stock mapping issues", () => {
    const mapped = mapBazaarProductToOMarketProduct({
      jobType: OMarketJobType.PRODUCT_EXPORT,
      locationId: null,
      categoryMapping: null,
      snapshotOnHand: null,
      hasLocalSpecs: true,
      selection: {
        productId: "product-2",
        discountType: null,
        discountValue: null,
        product: {
          id: "product-2",
          sku: "",
          name: "",
          category: "Phones",
          description: "",
          basePriceKgs: null,
          storePrices: [],
          photoUrl: null,
          images: [],
        },
      },
    });

    expect(mapped.payload).toBeNull();
    expect(mapped.issues).toEqual(
      expect.arrayContaining([
        "MISSING_SKU",
        "MISSING_TITLE",
        "MISSING_DESCRIPTION",
        "MISSING_PRICE",
        "MISSING_STOCK",
        "MISSING_CATEGORY_MAPPING",
        "MISSING_IMAGE",
        "MISSING_SPECS",
      ]),
    );
  });

  it("redacts access tokens from normalized API errors", () => {
    const token = "secret-token";
    const normalized = normalizeOMarketApiError({
      status: 403,
      body: { detail: `X-Access-Token: ${token}` },
      error: new Error(`X-Access-Token: ${token} rejected`),
      token,
    });

    expect(normalized.code).toBe("API_AUTH_FAILED");
    expect(JSON.stringify(normalized.body)).not.toContain(token);
    expect(normalized.message).not.toContain(token);
  });

  it("chunks payload items at the documented O! Market page limit boundary", () => {
    const chunks = chunkOMarketItems(
      Array.from({ length: 1001 }, (_, index) => index + 1),
      1000,
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(1000);
    expect(chunks[1]).toEqual([1001]);
  });
});

import { describe, expect, it } from "vitest";

import { buildMMarketPayload } from "@/server/services/mMarket";

describe("m-market payload builder", () => {
  it("returns stable JSON shape and omits optional null fields", () => {
    const payload = buildMMarketPayload([
      {
        sku: "SKU-B",
        name: "Product B",
        price: 20,
        category: "Category",
        description:
          "Это достаточно длинное описание для выполнения минимального ограничения в 50 символов.",
        images: ["https://cdn.example.com/b1.jpg", "https://cdn.example.com/b2.jpg", "https://cdn.example.com/b3.jpg"],
        stock: [{ quantity: 3, branch_id: "branch-2" }],
        specs: { color: "black" },
        discount: null,
        similar_products_sku: null,
      },
      {
        sku: "SKU-A",
        name: "Product A",
        price: 10,
        category: "Category",
        description:
          "Это достаточно длинное описание для выполнения минимального ограничения в 50 символов.",
        images: ["https://cdn.example.com/a1.jpg", "https://cdn.example.com/a2.jpg", "https://cdn.example.com/a3.jpg"],
        stock: [{ quantity: 2, branch_id: "branch-1" }],
        specs: { size: "M" },
        discount: 1.5,
        similar_products_sku: ["SKU-B", ""],
      },
    ]);

    expect(payload).toEqual({
      products: [
        {
          sku: "SKU-A",
          name: "Product A",
          price: 10,
          category: "Category",
          description:
            "Это достаточно длинное описание для выполнения минимального ограничения в 50 символов.",
          images: [
            "https://cdn.example.com/a1.jpg",
            "https://cdn.example.com/a2.jpg",
            "https://cdn.example.com/a3.jpg",
          ],
          stock: [{ quantity: 2, branch_id: "branch-1" }],
          specs: { size: "M" },
          discount: 1.5,
          similar_products_sku: ["SKU-B"],
        },
        {
          sku: "SKU-B",
          name: "Product B",
          price: 20,
          category: "Category",
          description:
            "Это достаточно длинное описание для выполнения минимального ограничения в 50 символов.",
          images: [
            "https://cdn.example.com/b1.jpg",
            "https://cdn.example.com/b2.jpg",
            "https://cdn.example.com/b3.jpg",
          ],
          stock: [{ quantity: 3, branch_id: "branch-2" }],
          specs: { color: "black" },
        },
      ],
    });
  });
});

import { describe, expect, it } from "vitest";

import {
  __resolveMMarketExportFailureReasonForTests,
  buildMMarketPayload,
} from "@/server/services/mMarket";

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

  it("formats abort errors as explicit timeout messages", () => {
    const error = new Error("This operation was aborted");
    error.name = "AbortError";

    expect(__resolveMMarketExportFailureReasonForTests(error)).toBe(
      "MMarket request timed out after 90s",
    );
  });

  it("formats fetch failures using the network cause details", () => {
    const cause = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    const error = new TypeError("fetch failed") as TypeError & { cause?: unknown };
    error.cause = cause;

    expect(__resolveMMarketExportFailureReasonForTests(error)).toBe(
      "MMarket request failed: ECONNRESET socket hang up",
    );
  });

  it("does not classify prisma connectivity errors as mmarket network failures", () => {
    const error = Object.assign(
      new Error(
        "Invalid `prisma.mMarketBranchMapping.findMany()` invocation:\n\n\nCan't reach database server at `db.example:5432`",
      ),
      {
        code: "P1001",
        name: "PrismaClientKnownRequestError",
      },
    );

    expect(__resolveMMarketExportFailureReasonForTests(error)).toBe(
      "Invalid `prisma.mMarketBranchMapping.findMany()` invocation:\n\n\nCan't reach database server at `db.example:5432`",
    );
  });
});

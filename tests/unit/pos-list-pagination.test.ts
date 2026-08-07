import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("POS bounded list navigation", () => {
  it("pages the product catalog without coupling its query key to cart state", () => {
    const source = readFileSync("src/app/(app)/pos/sell/page.tsx", "utf8");
    const catalogQuery = source.match(
      /const catalogProductsQuery = trpc\.products\.list\.useQuery\(([\s\S]*?)\n  \);/,
    )?.[1];

    expect(catalogQuery).toContain("page: catalogPage");
    expect(catalogQuery).toContain("pageSize: catalogPageSize");
    expect(catalogQuery).not.toMatch(/saleId|optimisticSaleLines|cartQty/);
    expect(source).toContain('data-testid="pos-catalog-pagination"');
  });

  it("pages sales and returns while applying payment filters on the server", () => {
    const source = readFileSync("src/app/(app)/pos/history/page.tsx", "utf8");
    expect(source).toContain("page: salesPage");
    expect(source).toContain("page: returnsPage");
    expect(source).toContain(
      'paymentMethod: paymentMethodFilter === "ALL" ? undefined : paymentMethodFilter',
    );
    expect(source).toContain("renderSalesPagination");
    expect(source).toContain("renderReturnsPagination");
  });

  it("pages shift history and reports the server total", () => {
    const source = readFileSync("src/app/(app)/pos/shifts/page.tsx", "utf8");
    expect(source).toContain("page: historyPage");
    expect(source).toContain("const historyTotal = historyQuery.data?.total ?? 0");
    expect(source).toContain("historyTotalPages > 1");
  });
});

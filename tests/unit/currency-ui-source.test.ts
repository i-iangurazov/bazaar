import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("currency UI clarity", () => {
  it("warns users when all-store reports use base accounting currency", async () => {
    const analyticsSource = await readSource("src/app/(app)/reports/analytics/page.tsx");
    const salesMetricsSource = await readSource("src/app/(app)/sales/orders/metrics/page.tsx");

    expect(analyticsSource).toContain('storeId === "all"');
    expect(analyticsSource).toContain('t("baseCurrencyNotice")');
    expect(salesMetricsSource).toContain('storeId === "all"');
    expect(salesMetricsSource).toContain('t("metricsBaseCurrencyNotice")');
  });

  it("keeps purchase-order unit cost copy tied to the selected store currency", async () => {
    const newOrderSource = await readSource("src/app/(app)/purchase-orders/new/page.tsx");
    const detailSource = await readSource("src/app/(app)/purchase-orders/[id]/page.tsx");

    expect(newOrderSource).toContain("currency: selectedStore?.currencyCode");
    expect(detailSource).toContain("currency: po?.store.currencyCode");
  });

  it("passes store currency context to store-scoped product search snippets", async () => {
    const newPurchaseOrderSource = await readSource("src/app/(app)/purchase-orders/new/page.tsx");
    const purchaseOrderDetailSource = await readSource("src/app/(app)/purchase-orders/[id]/page.tsx");
    const salesOrderDetailSource = await readSource("src/app/(app)/sales/orders/[id]/page.tsx");
    const productDetailSource = await readSource("src/app/(app)/products/[id]/page.tsx");

    expect(newPurchaseOrderSource).toContain("currencySource={selectedStore}");
    expect(purchaseOrderDetailSource).toContain("currencySource={poCurrencySource}");
    expect(salesOrderDetailSource).toContain("currencySource={orderCurrencySource}");
    expect(productDetailSource).toContain("currencySource={selectedPricingStore}");
  });
});

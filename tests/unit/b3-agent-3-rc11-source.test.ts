import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("RC-11 commerce freshness contract", () => {
  it("keeps correctness-critical product and public catalog reads fail-fresh", async () => {
    const [apiService, catalogService] = await Promise.all([
      readSource("src/server/services/bazaarApi.ts"),
      readSource("src/server/services/bazaarCatalog.ts"),
    ]);

    expect(apiService).not.toContain("bazaar-api:products:v1:");
    expect(apiService).not.toContain("BAZAAR_API_PRODUCTS_CACHE_TTL_SECONDS");
    expect(apiService).toContain("bazaar-api:auth:v1:");
    expect(catalogService).not.toContain("const cacheGet");
    expect(catalogService).not.toContain("const cacheSet");
    expect(catalogService).toContain("quotedUnitPriceKgs");
    expect(catalogService).toContain('throw new AppError("catalogPriceChanged"');
  });

  it("preserves the cart and rotates identity before refreshing a changed quote", async () => {
    const [route, page, enMessages, ruMessages] = await Promise.all([
      readSource("src/app/api/public/catalog/[slug]/checkout/route.ts"),
      readSource("src/components/catalog/public-catalog-page.tsx"),
      readSource("messages/en.json"),
      readSource("messages/ru.json"),
    ]);

    expect(route).toContain("quotedUnitPriceKgs: z.number().finite().nonnegative()");
    expect(route).toContain('message === "catalogPriceChanged"');
    expect(page).toContain('if (key === "catalogPriceChanged")');
    expect(page).toContain("checkoutAttemptRef.current = null");
    expect(page).toContain('{ method: "GET", cache: "no-store" }');
    expect(page).toContain('setSubmitError(t("checkoutPriceChanged"))');
    expect(page).not.toContain("setCart({});\n          checkoutAttemptRef.current = null");
    expect(enMessages).toContain('"catalogPriceChanged"');
    expect(ruMessages).toContain('"catalogPriceChanged"');
  });
});

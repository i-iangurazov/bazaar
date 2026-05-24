import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("store category preferences source", () => {
  it("stores category visibility per store without changing product assignments", async () => {
    const schema = await readSource("prisma/schema.prisma");
    const service = await readSource("src/server/services/productCategories.ts");

    expect(schema).toContain("model StoreCategoryPreference");
    expect(schema).toContain("@@unique([storeId, normalizedName])");
    expect(schema).toContain("categoryPreferences         StoreCategoryPreference[]");
    expect(service).toContain("listStoreProductCategoriesFromDb");
    expect(service).toContain("storeProducts:");
    expect(service).toContain("updateStoreProductCategoryPreference");
    expect(service).not.toContain("data: { category: null");
  });

  it("enforces store access and owner/admin mutation scope", async () => {
    const router = await readSource("src/server/trpc/routers/productCategories.ts");

    expect(router).toContain("listForStore");
    expect(router).toContain("setStoreVisibility: adminOrOrgOwnerProcedure");
    expect(router).toContain("assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId)");
  });

  it("filters product-form suggestions while preserving hidden assigned categories", async () => {
    const source = await readSource("src/components/product-form.tsx");

    expect(source).toContain("trpc.productCategories.listForStore.useQuery");
    expect(source).toContain("categoryStoreId");
    expect(source).toContain("categoryHiddenBadge");
    expect(source).toContain("categoryShowHidden");
    expect(source).toContain("categoryMetaByKey");
    expect(source).not.toContain("legacyCategoryOptionsQuery");
    expect(source).not.toContain("trpc.productCategories.list.useQuery");
  });

  it("adds a category management route", async () => {
    const page = await readSource("src/app/(app)/settings/categories/page.tsx");

    expect(page).toContain('useTranslations("categorySettings")');
    expect(page).toContain("productCategories.listForStore.useQuery");
    expect(page).toContain("productCategories.setStoreVisibility.useMutation");
    expect(page).toContain("isVisibleInForms: false");
    expect(page).toContain("isArchived: true");
  });
});

import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("import store selection source", () => {
  it("keeps product imports targeted to an explicit store", async () => {
    const pageSource = await readSource("src/app/(app)/settings/import/page.tsx");
    const schemaSource = await readSource("src/server/trpc/routers/products.schemas.ts");
    const routerSource = await readSource("src/server/trpc/routers/products.ts");

    expect(pageSource).toContain("targetStoreId");
    expect(pageSource).toContain("storeId: targetStoreId");
    expect(pageSource).toContain("!targetStoreId");
    expect(pageSource).not.toContain('value={targetStoreId || "none"}');
    expect(schemaSource).toContain("storeId: z.string().min(1)");
    expect(routerSource).toContain("assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId)");
  });

  it("keeps customer import as a mapped CSV/XLSX, store-scoped flow", async () => {
    const pageSource = await readSource("src/app/(app)/settings/import/page.tsx");
    const customerRouterSource = await readSource("src/server/trpc/routers/customers.ts");
    const customerServiceSource = await readSource("src/server/services/customers.ts");

    expect(pageSource).toContain('type ImportType = "products" | "customers"');
    expect(pageSource).toContain("CustomerImportPanel");
    expect(pageSource).toContain('accept=".csv,text/csv,.xlsx,.xls"');
    expect(pageSource).toContain('"phoneFallback"');
    expect(pageSource).toContain('"address1"');
    expect(pageSource).toContain('"createdAt"');
    expect(pageSource).toContain("storeId: targetStoreId");
    expect(customerRouterSource).toContain("managerProcedure");
    expect(customerRouterSource).toContain("previewImport");
    expect(customerRouterSource).toContain("importRows");
    expect(customerServiceSource).toContain(
      "assertUserCanAccessStore(prisma, input.user, input.storeId)",
    );
    expect(customerServiceSource).toContain("customerDuplicateInFile");
    expect(customerServiceSource).toContain("loadCustomerLookup");
    expect(customerServiceSource).toContain("findMatchingCustomerInLookup");
    expect(pageSource).toContain("previewStartedAt");
    expect(pageSource).toContain("customerImport.previewInProgress");
    expect(pageSource).toContain("customerImport.importInProgress");
    expect(pageSource).toContain("importableCustomerRows");
    expect(pageSource).toContain("customerImport.partialImportHint");
  });
});

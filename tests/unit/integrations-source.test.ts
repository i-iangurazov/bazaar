import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("integration source structure", () => {
  it("keeps bazaar API separate from Bazaar Catalogue UI", async () => {
    const integrationsPage = await readSource("src/app/(app)/operations/integrations/page.tsx");
    const catalogPage = await readSource(
      "src/app/(app)/operations/integrations/bazaar-catalog/page.tsx",
    );
    const apiPage = await readSource("src/app/(app)/operations/integrations/bazaar-api/page.tsx");

    expect(integrationsPage).toContain("/operations/integrations/bazaar-api?storeId=");
    expect(integrationsPage).toContain("trpc.bazaarApi.apiKeys");
    expect(apiPage).toContain("trpc.bazaarApi.createApiKey");
    expect(apiPage).toContain("trpc.bazaarApi.revokeApiKey");
    expect(catalogPage).not.toContain("createApiKey");
    expect(catalogPage).not.toContain("revokeApiKey");
  });

  it("keeps email marketing and image studio store-safe in source", async () => {
    const integrationsPage = await readSource("src/app/(app)/operations/integrations/page.tsx");
    const emailPage = await readSource(
      "src/app/(app)/operations/integrations/email-marketing/page.tsx",
    );
    const emailRouter = await readSource("src/server/trpc/routers/emailMarketing.ts");
    const imageStudioPage = await readSource(
      "src/app/(app)/operations/integrations/product-image-studio/page.tsx",
    );

    expect(integrationsPage).toContain("/operations/integrations/email-marketing");
    expect(integrationsPage).toContain("trpc.emailMarketing.overview");
    expect(emailPage).toContain("{ storeId, source }");
    expect(emailPage).toContain("trpc.emailMarketing.logoGallery");
    expect(emailPage).toContain("/api/email-marketing/logo");
    expect(emailPage).toContain("logoStoreId");
    expect(emailPage).toContain("trpc.emailMarketing.send");
    expect(emailPage).toContain("reachableCustomers");
    expect(emailRouter).toContain("managerProcedure");
    expect(emailRouter).toContain("storeId");
    expect(emailRouter).toContain("source: sourceSchema");
    expect(emailRouter).toContain("logoGallery: managerProcedure");
    expect(emailRouter).toContain("logoStoreId");
    expect(imageStudioPage).toContain("<TableContainer>");
    expect(imageStudioPage).toContain('className="min-w-[860px]"');
  });
});

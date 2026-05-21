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
    expect(apiPage).toContain("{apiBaseUrl}/customers");
    expect(catalogPage).not.toContain("createApiKey");
    expect(catalogPage).not.toContain("revokeApiKey");
  });

  it("keeps email marketing and image studio store-safe in source", async () => {
    const integrationsPage = await readSource("src/app/(app)/operations/integrations/page.tsx");
    const emailPage = await readSource(
      "src/app/(app)/operations/integrations/email-marketing/page.tsx",
    );
    const emailRouter = await readSource("src/server/trpc/routers/emailMarketing.ts");
    const emailService = await readSource("src/server/services/emailMarketing.ts");
    const imageStudioPage = await readSource(
      "src/app/(app)/operations/integrations/product-image-studio/page.tsx",
    );

    expect(integrationsPage).toContain("/operations/integrations/email-marketing");
    expect(integrationsPage).toContain("trpc.emailMarketing.overview");
    expect(emailPage).toContain("{ storeId, source }");
    expect(emailPage).toContain("trpc.emailMarketing.customers.useQuery");
    expect(emailPage).toContain("trpc.emailMarketing.products.useQuery");
    expect(emailPage).toContain("trpc.emailMarketing.preview.useMutation");
    expect(emailPage).toContain("trpc.emailMarketing.sendTest.useMutation");
    expect(emailPage).toContain("trpc.emailMarketing.history.useQuery");
    expect(emailPage).toContain("logoStoreId");
    expect(emailPage).toContain("applyBannerImageToBlocks");
    expect(emailPage).toContain("const effectiveBlocks = useMemo");
    expect(emailPage).toContain("bannerImageUrl: bannerImageUrl || null");
    expect(emailPage).toContain("blocks: effectiveBlocks");
    expect(emailPage).toContain('includeSelectableIds: audienceMode === "manual"');
    expect(emailPage).toContain("selectAllFilteredCustomers");
    expect(emailPage).toContain("Выбрать всех валидных получателей в текущем фильтре");
    expect(emailPage).toContain('<div className="space-y-6">');
    expect(emailPage).not.toContain('aria-label="Шаги email-кампании"');
    expect(emailPage).not.toContain("xl:grid-cols-[minmax(0,0.94fr)_minmax(520px,1.06fr)]");
    expect(emailPage).not.toContain("xl:sticky xl:top-6 xl:self-start");
    expect(emailPage).toContain(
      "rounded-md border border-border bg-background px-3 py-2 shadow-sm",
    );
    expect(emailPage).toContain("Email / телефон");
    expect(emailPage).toContain("grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto]");
    expect(emailPage).toContain("<DesktopPreviewIcon");
    expect(emailPage).toContain("<MobilePreviewIcon");
    expect(emailPage).toContain("<ChevronLeftIcon");
    expect(emailPage).toContain("<ChevronRightIcon");
    expect(emailPage).toContain("trpc.emailMarketing.send");
    expect(emailPage).toContain("selectedCustomerIds");
    expect(emailRouter).toContain("managerProcedure");
    expect(emailRouter).toContain("storeId");
    expect(emailRouter).toContain("source: sourceSchema");
    expect(emailRouter).toContain("includeSelectableIds: z.boolean().optional()");
    expect(emailRouter).toContain("logoGallery: managerProcedure");
    expect(emailRouter).toContain("logoStoreId");
    expect(emailService).toContain("includeSelectableIds?: boolean");
    expect(emailService).toContain("selectableIds");
    expect(emailService).toContain("selectableLimitReached");
    expect(emailService).toContain("fallbackStore");
    expect(emailService).toContain("collectNonPublicEmailImageUrls");
    expect(emailService).toContain("emailCampaignImagePublicUrlRequired");
    expect(imageStudioPage).toContain("<TableContainer>");
    expect(imageStudioPage).toContain('className="min-w-[860px]"');
  });
});

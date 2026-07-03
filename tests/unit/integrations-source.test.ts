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
    const emailWorkspace = await readSource(
      "src/app/(app)/operations/integrations/email-marketing/workspace.tsx",
    );
    const emailRouter = await readSource("src/server/trpc/routers/emailMarketing.ts");
    const emailDeliveryService = await readSource("src/server/services/email.ts");
    const emailService = await readSource("src/server/services/emailMarketing.ts");
    const imageStudioPage = await readSource(
      "src/app/(app)/operations/integrations/product-image-studio/page.tsx",
    );

    expect(integrationsPage).toContain("/operations/integrations/email-marketing");
    expect(integrationsPage).toContain("trpc.emailMarketing.overview");
    expect(emailPage).toContain("EmailMarketingWorkspace");
    expect(emailWorkspace).toContain("{ storeId, source }");
    expect(emailWorkspace).toContain("trpc.emailMarketing.customers.useQuery");
    expect(emailWorkspace).toContain("trpc.emailMarketing.products.useQuery");
    expect(emailWorkspace).toContain("productSearch");
    expect(emailWorkspace).toContain("search: productSearch.trim() || null");
    expect(emailWorkspace).toContain("includeIds: selectedProductIdsForQuery");
    expect(emailWorkspace).toContain("Название, SKU или штрихкод");
    expect(emailWorkspace).toContain("trpc.emailMarketing.preview.useMutation");
    expect(emailWorkspace).toContain("trpc.emailMarketing.sendTest.useMutation");
    expect(emailWorkspace).toContain("trpc.emailMarketing.history.useQuery");
    expect(emailWorkspace).toContain("trpc.emailMarketing.senders.useQuery");
    expect(emailWorkspace).toContain("trpc.emailMarketing.automations.useQuery");
    expect(emailWorkspace).toContain("trpc.emailMarketing.sendCampaign.useMutation");
    expect(emailWorkspace).toContain("trpc.emailMarketing.createSender.useMutation");
    expect(emailWorkspace).toContain("trpc.emailMarketing.updateAutomation.useMutation");
    expect(emailWorkspace).toContain("DndContext");
    expect(emailWorkspace).toContain("SortableContext");
    expect(emailWorkspace).toContain("logoStoreId");
    expect(emailWorkspace).toContain("bannerImageUrl: bannerImageUrl || null");
    expect(emailWorkspace).toContain("const LogoFileInput");
    expect(emailWorkspace).toContain("applyDefaultBannerToCanvas");
    expect(emailWorkspace).toContain("onLogoUploadClick={() => logoInputRef.current?.click()}");
    expect(emailWorkspace).toContain("Нужна прямая ссылка на файл изображения");
    expect(emailWorkspace).toContain("Показывать описание");
    expect(emailWorkspace).toContain("Расположение");
    expect(emailWorkspace).toContain("AlignmentControl");
    expect(emailWorkspace).toContain("Строка заказа");
    expect(emailWorkspace).toContain("{{orderPreviousStatus}}");
    expect(emailWorkspace).toContain("Bazaar KG");
    expect(emailWorkspace).not.toContain("Bazaar demo");
    expect(emailWorkspace).toContain("(min-width: 1280px) and (pointer: fine)");
    expect(emailWorkspace).toContain("Редактор писем доступен только на компьютере");
    expect(emailWorkspace).toContain("disabled={!builderAvailable}");
    expect(emailRouter).toContain("showDescription: z.boolean().optional()");
    expect(emailRouter).toContain('z.enum(["left", "center", "right"])');
    expect(emailRouter).toContain("summaryText: z.string().max(500).optional().nullable()");
    expect(emailRouter).toContain("fontFamily: z.nativeEnum(EmailCampaignFontFamily).optional()");
    expect(emailWorkspace).toContain('includeSelectableIds: audienceMode === "manual"');
    expect(emailWorkspace).not.toContain('aria-label="Шаги email-кампании"');
    expect(emailWorkspace).toContain("<DesktopPreviewIcon");
    expect(emailWorkspace).toContain("<MobilePreviewIcon");
    expect(emailWorkspace).toContain("<ChevronLeftIcon");
    expect(emailWorkspace).toContain("<ChevronRightIcon");
    expect(emailWorkspace).toContain("selectedCustomerIds");
    expect(emailRouter).toContain("managerProcedure");
    expect(emailRouter).toContain("storeId");
    expect(emailRouter).toContain("source: sourceSchema");
    expect(emailRouter).toContain("includeSelectableIds: z.boolean().optional()");
    expect(emailRouter).toContain("includeIds: z.array(z.string().min(1)).max(500).optional()");
    expect(emailRouter).toContain("logoGallery: managerProcedure");
    expect(emailRouter).toContain("senders: managerProcedure");
    expect(emailRouter).toContain("sendCampaign: managerProcedure");
    expect(emailRouter).toContain('max: 20, prefix: "email-marketing-send-saved"');
    expect(emailRouter).toContain("automations: managerProcedure");
    expect(emailRouter).toContain("logoStoreId");
    expect(emailService).toContain("includeSelectableIds?: boolean");
    expect(emailService).toContain("selectableIds");
    expect(emailService).toContain("selectableLimitReached");
    expect(emailService).toContain("fallbackStore");
    expect(emailService).toContain("collectNonPublicEmailImageUrls");
    expect(emailService).toContain("emailCampaignImagePublicUrlRequired");
    expect(emailService).toContain("emailCampaignImageStorageLocal");
    expect(emailService).toContain("IMAGE_STORAGE_PROVIDER сейчас local");
    expect(emailService).toContain("EmailSenderDomain");
    expect(emailService).toContain("sendSavedEmailCampaignToAudience");
    expect(emailService).toContain('status: config.ready ? "VERIFIED" : "NOT_CONFIGURED"');
    expect(emailDeliveryService).toContain("ready: hasProvider");
    expect(emailService).toContain("processEmailAutomationTrigger");
    expect(imageStudioPage).toContain('<TableContainer className="bazaar-admin-table-shell">');
    expect(imageStudioPage).toContain('className="min-w-[860px]"');
    expect(imageStudioPage).toContain("activeJobFromList");
    expect(imageStudioPage).toContain("previewIsWorking");
    expect(imageStudioPage).toContain("generatedPreviewUrl");
    expect(imageStudioPage).toContain("animate-pulse");
  });

  it("exposes O! Market integration with store scope, masked tokens, and per-product statuses", async () => {
    const integrationsPage = await readSource("src/app/(app)/operations/integrations/page.tsx");
    const oMarketPage = await readSource(
      "src/app/(app)/operations/integrations/o-market/page.tsx",
    );
    const oMarketRouter = await readSource("src/server/trpc/routers/oMarket.ts");
    const oMarketService = await readSource("src/server/services/oMarket.ts");
    const oMarketClient = await readSource("src/server/services/oMarketApiClient.ts");

    expect(integrationsPage).toContain("trpc.oMarket.overview");
    expect(integrationsPage).toContain("/operations/integrations/o-market");
    expect(oMarketPage).toContain('useTranslations("integrations.oMarketPage")');
    expect(oMarketPage).toContain('title={t("title")}');
    expect(oMarketPage).toContain("<PasswordInput");
    expect(oMarketPage).toContain("visible={showToken}");
    expect(oMarketPage).toContain("void revealSavedToken()");
    expect(oMarketPage).toContain("revealToken");
    expect(oMarketPage).toContain("productExport.storeScopeNote");
    expect(oMarketPage).toContain("productResults");
    expect(oMarketPage).toContain("failed");
    expect(oMarketPage).toContain("skipped");
    expect(oMarketPage).not.toContain("[object Object]");
    expect(oMarketRouter).toContain("managerProcedure");
    expect(oMarketRouter).toContain("storeId: z.string().min(1)");
    expect(oMarketService).toContain("buildStoreProductWhere(storeContext.storeId)");
    expect(oMarketService).toContain("storeId: storeContext.storeId");
    expect(oMarketService).toContain("O_MARKET_MOCK_API");
    expect(oMarketService).toContain("MISSING_IMAGE");
    expect(oMarketService).toContain("MISSING_SPECS");
    expect(oMarketService).toContain("API_AUTH_FAILED");
    expect(oMarketService).toContain("X-Access-Token: [REDACTED]");
    expect(oMarketClient).toContain('"X-Access-Token": input.token');
    expect(oMarketClient).toContain("/api/mia/v1/product/import/create-or-update/");
    expect(oMarketClient).toContain("/api/mia/v1/product/import/full-sync/");
    expect(oMarketClient).toContain("/api/mia/v1/product/import/info/");
  });
});

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
    expect(emailWorkspace).toContain("Строка заказа");
    expect(emailWorkspace).toContain("{{orderPreviousStatus}}");
    expect(emailWorkspace).toContain("Bazaar KG");
    expect(emailWorkspace).not.toContain("Bazaar demo");
    expect(emailWorkspace).toContain("(min-width: 1280px) and (pointer: fine)");
    expect(emailWorkspace).toContain("Редактор писем доступен только на компьютере");
    expect(emailWorkspace).toContain("disabled={!builderAvailable}");
    expect(emailRouter).toContain("showDescription: z.boolean().optional()");
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
    expect(imageStudioPage).toContain("<TableContainer>");
    expect(imageStudioPage).toContain('className="min-w-[860px]"');
  });
});

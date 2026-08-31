import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerAuthToken: vi.fn(),
  assertUserCanAccessStore: vi.fn(),
  uploadProductImageBuffer: vi.fn(),
  createBazaarCatalogLogoImage: vi.fn(),
  upsertEmailMarketingStoreLogo: vi.fn(),
  saveBakaiStoreTemplateWorkbook: vi.fn(),
  assertCommercePermission: vi.fn(),
}));

vi.mock("@/server/auth/token", () => ({ getServerAuthToken: mocks.getServerAuthToken }));
vi.mock("@/server/db/prisma", () => ({ prisma: {} }));
vi.mock("@/server/services/storeAccess", () => ({
  assertUserCanAccessStore: mocks.assertUserCanAccessStore,
}));
vi.mock("@/server/services/productImageStorage", () => ({
  uploadProductImageBuffer: mocks.uploadProductImageBuffer,
}));
vi.mock("@/server/services/bazaarCatalog", () => ({
  createBazaarCatalogLogoImage: mocks.createBazaarCatalogLogoImage,
}));
vi.mock("@/server/services/emailMarketing", () => ({
  upsertEmailMarketingStoreLogo: mocks.upsertEmailMarketingStoreLogo,
}));
vi.mock("@/server/services/bakaiStore", () => ({
  saveBakaiStoreTemplateWorkbook: mocks.saveBakaiStoreTemplateWorkbook,
}));
vi.mock("@/server/services/commerceAccess", () => ({
  assertCommercePermission: mocks.assertCommercePermission,
}));

import { POST as uploadBakaiTemplate } from "@/app/api/bakai-store/template/route";
import { POST as uploadCatalogLogo } from "@/app/api/bazaar-catalog/logo/route";
import { POST as uploadEmailLogo } from "@/app/api/email-marketing/logo/route";

const authenticatedToken = {
  sub: "qa-user",
  organizationId: "qa-org",
  role: "ADMIN",
  isOrgOwner: false,
  isPlatformOwner: false,
};

const uploadRequest = (path: string, file: File, includeStore = false) => {
  const formData = new FormData();
  formData.set("file", file);
  if (includeStore) formData.set("storeId", "qa-store");
  return new Request(`http://localhost${path}`, { method: "POST", body: formData });
};

describe("BZR-REQ-0055 guarded upload HTTP routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerAuthToken.mockResolvedValue(authenticatedToken);
    mocks.assertUserCanAccessStore.mockResolvedValue(undefined);
    mocks.uploadProductImageBuffer.mockResolvedValue({
      url: "/uploads/imported-products/qa-org/logo.png",
    });
    mocks.createBazaarCatalogLogoImage.mockResolvedValue({
      id: "catalog-logo",
      url: "/uploads/imported-products/qa-org/logo.png",
    });
    mocks.upsertEmailMarketingStoreLogo.mockResolvedValue({
      id: "email-logo",
      storeId: "qa-store",
      imageUrl: "/uploads/imported-products/qa-org/logo.png",
    });
    mocks.saveBakaiStoreTemplateWorkbook.mockResolvedValue({ id: "bakai-template" });
  });

  it.each([
    ["catalog", uploadCatalogLogo, "/api/bazaar-catalog/logo"],
    ["email", uploadEmailLogo, "/api/email-marketing/logo"],
  ] as const)(
    "%s logo rejects invalid type and oversize, then accepts a valid image",
    async (_name, handler, path) => {
      const invalid = await handler(
        uploadRequest(path, new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" }), true),
      );
      expect(invalid.status).toBe(400);
      await expect(invalid.json()).resolves.toMatchObject({ message: "imageInvalidType" });

      const oversized = await handler(
        uploadRequest(
          path,
          new File([new Uint8Array(5 * 1024 * 1024 + 1)], "logo.png", {
            type: "image/png",
          }),
          true,
        ),
      );
      expect(oversized.status).toBe(413);
      await expect(oversized.json()).resolves.toMatchObject({ message: "imageTooLarge" });

      const valid = await handler(
        uploadRequest(
          path,
          new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "logo.png", {
            type: "image/png",
          }),
          true,
        ),
      );
      expect(valid.status).toBe(200);
      expect(mocks.uploadProductImageBuffer).toHaveBeenCalledTimes(1);
    },
  );

  it("Bakai template rejects invalid type and oversize, then accepts a valid workbook", async () => {
    const invalid = await uploadBakaiTemplate(
      uploadRequest(
        "/api/bakai-store/template",
        new File(["no"], "template.exe", { type: "application/octet-stream" }),
      ),
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      message: "bakaiStoreTemplateInvalidType",
    });

    const oversized = await uploadBakaiTemplate(
      uploadRequest(
        "/api/bakai-store/template",
        new File([new Uint8Array(10 * 1024 * 1024 + 1)], "template.xlsx", {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      ),
    );
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toMatchObject({
      message: "bakaiStoreTemplateTooLarge",
    });

    const valid = await uploadBakaiTemplate(
      uploadRequest(
        "/api/bakai-store/template",
        new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "template.xlsx", {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      ),
    );
    expect(valid.status).toBe(200);
    expect(mocks.saveBakaiStoreTemplateWorkbook).toHaveBeenCalledTimes(1);
  });
});

import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFile(path, "utf8");
const fileInputCount = (source: string) =>
  Array.from(source.matchAll(/<(?:input|Input)[\s\S]*?type="file"[\s\S]*?\/>/g)).length;

describe("BZR-REQ-0055 complete upload-control inventory", () => {
  it("accounts for every rendered file-input definition and binds it to type and size validation", async () => {
    const [product, imports, studio, catalog, bakai, email] = await Promise.all([
      readSource("src/components/product-form.tsx"),
      readSource("src/app/(app)/settings/import/page.tsx"),
      readSource("src/app/(app)/operations/integrations/product-image-studio/page.tsx"),
      readSource("src/app/(app)/operations/integrations/bazaar-catalog/page.tsx"),
      readSource("src/app/(app)/operations/integrations/bakai-store/page.tsx"),
      readSource("src/app/(app)/operations/integrations/email-marketing/workspace.tsx"),
    ]);

    expect(
      [product, imports, studio, catalog, bakai, email].reduce(
        (count, source) => count + fileInputCount(source),
        0,
      ),
      "the audited source inventory must remain synchronized when a file input is added",
    ).toBe(8);

    expect(fileInputCount(product)).toBe(2);
    expect(product.match(/accept=\{productImageAccept\}/g)).toHaveLength(2);
    expect(product.match(/onChange=\{handleImageInputChange\}/g)).toHaveLength(2);
    expect(product).toContain("prepareProductImageFileForUpload");
    expect(product).toContain("maxInputImageBytes");

    expect(fileInputCount(imports)).toBe(2);
    expect(imports.match(/accept=\{spreadsheetUploadAccept\}/g)).toHaveLength(2);
    expect(imports.match(/validateSpreadsheetUploadFile\(file\)/g)).toHaveLength(2);
    expect(imports.match(/validation\.extension === "xlsx"/g)).toHaveLength(2);

    expect(fileInputCount(studio)).toBe(1);
    expect(studio).toContain("accept={studioAcceptedFileTypes}");
    expect(studio).toContain("prepareManagedProductImageForUpload");
    expect(studio).toContain("studioMaxInputImageBytes");

    expect(fileInputCount(catalog)).toBe(1);
    expect(catalog).toContain('accept="image/*"');
    expect(catalog).toContain('fetch("/api/bazaar-catalog/logo"');

    expect(fileInputCount(bakai)).toBe(1);
    expect(bakai).toContain('accept=".xlsx,.xls,.xlsm"');
    expect(bakai).toContain('fetch("/api/bakai-store/template"');

    expect(fileInputCount(email)).toBe(1);
    expect(email).toContain('accept="image/*"');
    expect(email).toContain('fetch("/api/email-marketing/logo"');
  });

  it("keeps every HTTP upload endpoint guarded for invalid type and oversize requests", async () => {
    const [product, studio, catalog, email, bakai] = await Promise.all([
      readSource("src/app/api/product-images/upload/route.ts"),
      readSource("src/app/api/product-image-studio/upload/route.ts"),
      readSource("src/app/api/bazaar-catalog/logo/route.ts"),
      readSource("src/app/api/email-marketing/logo/route.ts"),
      readSource("src/app/api/bakai-store/template/route.ts"),
    ]);

    for (const source of [product, studio, catalog, email]) {
      expect(source).toContain("file.size >");
      expect(source).toContain("imageTooLarge");
      expect(source).toMatch(/imageInvalidType|unsupportedFileType/);
      expect(source).toContain("status: 413");
      expect(source).toContain("status: 400");
    }
    expect(bakai).toContain("file.size > MAX_TEMPLATE_BYTES");
    expect(bakai).toContain("bakaiStoreTemplateTooLarge");
    expect(bakai).toContain("bakaiStoreTemplateInvalidType");
    expect(bakai).toContain("status: 413");
    expect(bakai).toContain("status: 400");
  });
});

import { readFile, unlink } from "node:fs/promises";
import { resolve, sep } from "node:path";

import { PrismaClient } from "@prisma/client";
import type { Locator, Page } from "@playwright/test";

import { seedAuthenticatedAdvancedProductFixtures } from "../../../scripts/playwright-authenticated-advanced-product-fixture";
import { authenticatedAdvancedProductFixture } from "./advanced-product-contract";
import { assertAuthenticatedE2EDatabaseUrl } from "./contract";
import {
  assertCleanAdvancedProductAudit,
  attachAdvancedProductAuditOnFailure,
  expect,
  expectAdvancedProductHttpError,
  mutationRequestCount,
  test,
  type AdvancedProductAudit,
  type AdvancedProductMutationProcedure,
} from "./advanced-product-test-fixtures";

const fixture = authenticatedAdvancedProductFixture;
const datasourceUrl = assertAuthenticatedE2EDatabaseUrl(process.env.E2E_AUTH_DATABASE_URL);
const prisma = new PrismaClient({ datasourceUrl });
const localImageUrlPrefix = `/uploads/imported-products/${fixture.organizationId}/products/${fixture.image.id}/`;

test.describe.configure({ mode: "serial" });

const pathname = (page: Page) => new URL(page.url()).pathname;

const assertPathname = async (page: Page, expected: string) => {
  await expect.poll(() => pathname(page)).toBe(expected);
};

const gotoDirect = async (page: Page, path: string) => {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response, `direct navigation to ${path} must return a document`).not.toBeNull();
  expect(response!.status()).toBeLessThan(500);
};

const rapidClick = async (locator: Locator) => {
  await expect(locator).toBeVisible();
  await expect(locator).toBeEnabled();
  await locator.evaluate((node) => {
    const button = node as HTMLButtonElement;
    button.click();
    button.click();
  });
};

const assertSingleMutation = async (
  audit: AdvancedProductAudit,
  procedure: AdvancedProductMutationProcedure,
  previousCount = 0,
) => {
  await expect.poll(() => mutationRequestCount(audit, procedure)).toBe(previousCount + 1);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  expect(
    mutationRequestCount(audit, procedure),
    `${procedure} must issue exactly one mutation`,
  ).toBe(previousCount + 1);
};

const bundleComponentQtyInput = (page: Page, formId: string) => {
  const form = page.locator(`form#${formId}`);
  const componentName = form.getByText(fixture.component.name, { exact: true });
  return componentName
    .locator("xpath=ancestor::div[.//input[@type='number']][1]")
    .locator("input[type='number']")
    .first();
};

const localImageFilePath = (urlValue: string) => {
  const pathnameValue = new URL(urlValue, "https://local.invalid").pathname;
  if (!pathnameValue.startsWith(localImageUrlPrefix) || pathnameValue.includes("..")) {
    throw new Error(`Refusing to clean image outside the QA product path: ${pathnameValue}`);
  }
  const publicRoot = resolve(process.cwd(), "public");
  const filePath = resolve(publicRoot, `.${pathnameValue}`);
  const expectedDirectory = resolve(
    publicRoot,
    "uploads",
    "imported-products",
    fixture.organizationId,
    "products",
    fixture.image.id,
  );
  if (!filePath.startsWith(`${expectedDirectory}${sep}`)) {
    throw new Error(`Refusing to clean image outside ${expectedDirectory}.`);
  }
  return filePath;
};

const cleanupOwnedLocalImages = async () => {
  const images = await prisma.productImage.findMany({
    where: { productId: fixture.image.id, url: { startsWith: localImageUrlPrefix } },
    select: { url: true },
  });
  const product = await prisma.product.findUnique({
    where: { id: fixture.image.id },
    select: { photoUrl: true },
  });
  const urls = new Set([
    ...images.map((image) => image.url),
    ...(product?.photoUrl?.startsWith(localImageUrlPrefix) ? [product.photoUrl] : []),
  ]);
  await Promise.all(
    [...urls].map(async (urlValue) => {
      await unlink(localImageFilePath(urlValue)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }),
  );
};

const expectDecodedImage = async (image: Locator) => {
  await expect
    .poll(() =>
      image.evaluate((node) => {
        const element = node as HTMLImageElement;
        return element.complete && element.naturalWidth > 0 && element.naturalHeight > 0;
      }),
    )
    .toBe(true);
};

test.afterEach(async ({ advancedProductAudit }, testInfo) => {
  await attachAdvancedProductAuditOnFailure(testInfo, advancedProductAudit);
});

test.afterAll(async () => {
  await cleanupOwnedLocalImages();
  await seedAuthenticatedAdvancedProductFixtures(prisma);
  await prisma.$disconnect();
});

test("@advanced-products bundle create, view, edit and single assembly reconcile exactly", async ({
  page,
  advancedProductAudit,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoDirect(
    page,
    `/products/new?type=bundle&storeId=${encodeURIComponent(fixture.storeId)}`,
  );
  await expect(page.getByRole("heading", { level: 1, name: "New bundle" })).toBeVisible();
  await page.getByLabel("SKU").fill(fixture.browserBundle.sku);
  await page.getByLabel("Name").fill(fixture.browserBundle.name);
  await page.getByLabel("Sale price").fill("250");
  await page.getByPlaceholder("Enter bundle search").fill(fixture.component.sku);
  const componentResult = page.getByRole("button").filter({ hasText: fixture.component.name });
  await expect(componentResult).toHaveCount(1);
  await componentResult.click();
  const createQty = bundleComponentQtyInput(page, "product-create-form");
  await expect(createQty).toHaveValue("1");
  await createQty.fill(String(fixture.browserBundle.createComponentQty));
  await rapidClick(page.getByRole("button", { name: "Products save" }).first());
  await assertSingleMutation(advancedProductAudit, "products.create");
  await assertPathname(page, "/products");

  const createdBundles = await prisma.product.findMany({
    where: { organizationId: fixture.organizationId, sku: fixture.browserBundle.sku },
    select: {
      id: true,
      name: true,
      isBundle: true,
      bundleComponents: {
        select: { componentProductId: true, componentVariantId: true, qty: true },
      },
    },
  });
  expect(createdBundles).toEqual([
    {
      id: expect.any(String),
      name: fixture.browserBundle.name,
      isBundle: true,
      bundleComponents: [
        {
          componentProductId: fixture.component.id,
          componentVariantId: null,
          qty: fixture.browserBundle.createComponentQty,
        },
      ],
    },
  ]);
  const bundleId = createdBundles[0]!.id;

  await gotoDirect(page, `/products/${bundleId}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(fixture.browserBundle.name);
  const componentTableRow = page.getByRole("row").filter({ hasText: fixture.component.name });
  await expect(componentTableRow).toHaveCount(1);
  await expect(componentTableRow).toContainText(String(fixture.browserBundle.createComponentQty));

  const editQty = bundleComponentQtyInput(page, "product-edit-form");
  await editQty.fill(String(fixture.browserBundle.editedComponentQty));
  await rapidClick(page.getByRole("button", { name: "Products save" }).first());
  await assertSingleMutation(advancedProductAudit, "products.update");
  await assertPathname(page, "/products");
  await expect(
    prisma.productBundleComponent.findFirst({
      where: { bundleProductId: bundleId, componentProductId: fixture.component.id },
      select: { qty: true },
    }),
  ).resolves.toEqual({ qty: fixture.browserBundle.editedComponentQty });

  await gotoDirect(page, `/products/${bundleId}`);
  const unsavedQty = bundleComponentQtyInput(page, "product-edit-form");
  await expect(unsavedQty).toHaveValue(String(fixture.browserBundle.editedComponentQty));
  await unsavedQty.fill(String(fixture.browserBundle.editedComponentQty + 1));
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await assertPathname(page, "/products");
  expect(mutationRequestCount(advancedProductAudit, "products.update")).toBe(1);
  await expect(
    prisma.productBundleComponent.findFirst({
      where: { bundleProductId: bundleId, componentProductId: fixture.component.id },
      select: { qty: true },
    }),
  ).resolves.toEqual({ qty: fixture.browserBundle.editedComponentQty });

  await gotoDirect(page, `/products/${bundleId}`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(bundleComponentQtyInput(page, "product-edit-form")).toHaveValue(
    String(fixture.browserBundle.editedComponentQty),
  );
  await page.getByRole("button", { name: "Bundle assemble", exact: true }).click();
  const assembleDialog = page.getByRole("dialog", { name: "Bundle assemble" });
  await assembleDialog.getByLabel("Bundle qty").fill(String(fixture.browserBundle.assembleQty));
  await rapidClick(
    assembleDialog.getByRole("button", { name: "Bundle assemble confirm", exact: true }),
  );
  await assertSingleMutation(advancedProductAudit, "bundles.assemble");
  await expect(page.getByText("Bundle assembled", { exact: true })).toBeVisible();

  const expectedComponentDelta =
    -fixture.browserBundle.editedComponentQty * fixture.browserBundle.assembleQty;
  const [componentSnapshot, bundleSnapshot, componentCost, bundleCost, movements, audits] =
    await Promise.all([
      prisma.inventorySnapshot.findUnique({
        where: {
          storeId_productId_variantKey: {
            storeId: fixture.storeId,
            productId: fixture.component.id,
            variantKey: fixture.variantKey,
          },
        },
        select: { onHand: true },
      }),
      prisma.inventorySnapshot.findUnique({
        where: {
          storeId_productId_variantKey: {
            storeId: fixture.storeId,
            productId: bundleId,
            variantKey: fixture.variantKey,
          },
        },
        select: { onHand: true },
      }),
      prisma.productCost.findUnique({
        where: {
          organizationId_productId_variantKey: {
            organizationId: fixture.organizationId,
            productId: fixture.component.id,
            variantKey: fixture.variantKey,
          },
        },
        select: { avgCostKgs: true, costBasisQty: true, costBasisValueKgs: true },
      }),
      prisma.productCost.findUnique({
        where: {
          organizationId_productId_variantKey: {
            organizationId: fixture.organizationId,
            productId: bundleId,
            variantKey: fixture.variantKey,
          },
        },
        select: { avgCostKgs: true, costBasisQty: true, costBasisValueKgs: true },
      }),
      prisma.stockMovement.findMany({
        where: {
          referenceType: "BUNDLE_ASSEMBLY",
          note: `bundleAssemble:${fixture.browserBundle.sku}`,
        },
        select: {
          productId: true,
          type: true,
          qtyDelta: true,
          unitCostKgs: true,
          inventoryValueDeltaKgs: true,
          referenceId: true,
        },
        orderBy: { qtyDelta: "asc" },
      }),
      prisma.auditLog.count({
        where: { entity: "Product", entityId: bundleId, action: "BUNDLE_ASSEMBLE" },
      }),
    ]);
  const transferredValue = Math.abs(expectedComponentDelta) * fixture.component.unitCostKgs;
  expect(componentSnapshot).toEqual({ onHand: fixture.component.onHand + expectedComponentDelta });
  expect(bundleSnapshot).toEqual({ onHand: fixture.browserBundle.assembleQty });
  expect(componentCost).not.toBeNull();
  expect(Number(componentCost!.avgCostKgs)).toBe(fixture.component.unitCostKgs);
  expect(componentCost!.costBasisQty).toBe(fixture.component.onHand + expectedComponentDelta);
  expect(Number(componentCost!.costBasisValueKgs)).toBe(
    (fixture.component.onHand + expectedComponentDelta) * fixture.component.unitCostKgs,
  );
  expect(bundleCost).not.toBeNull();
  expect(Number(bundleCost!.avgCostKgs)).toBe(transferredValue / fixture.browserBundle.assembleQty);
  expect(bundleCost!.costBasisQty).toBe(fixture.browserBundle.assembleQty);
  expect(Number(bundleCost!.costBasisValueKgs)).toBe(transferredValue);
  expect(movements).toHaveLength(2);
  expect(new Set(movements.map((movement) => movement.referenceId)).size).toBe(1);
  expect(
    movements.map((movement) => ({
      productId: movement.productId,
      type: movement.type,
      qtyDelta: movement.qtyDelta,
      unitCostKgs: Number(movement.unitCostKgs),
      inventoryValueDeltaKgs: Number(movement.inventoryValueDeltaKgs),
    })),
  ).toEqual([
    {
      productId: fixture.component.id,
      type: "ADJUSTMENT",
      qtyDelta: expectedComponentDelta,
      unitCostKgs: fixture.component.unitCostKgs,
      inventoryValueDeltaKgs: -transferredValue,
    },
    {
      productId: bundleId,
      type: "RECEIVE",
      qtyDelta: fixture.browserBundle.assembleQty,
      unitCostKgs: transferredValue / fixture.browserBundle.assembleQty,
      inventoryValueDeltaKgs: transferredValue,
    },
  ]);
  expect(audits).toBe(1);
  assertCleanAdvancedProductAudit(advancedProductAudit);
});

test("@advanced-products product image validation is local, durable and reversible", async ({
  page,
  advancedProductAudit,
}) => {
  if (process.env.IMAGE_STORAGE_PROVIDER !== "local") {
    throw new Error(
      "Advanced-product image acceptance requires IMAGE_STORAGE_PROVIDER=local to prohibit provider traffic.",
    );
  }
  const servedLocalImagePaths: string[] = [];
  await page.route(
    (url) => url.pathname.startsWith(localImageUrlPrefix),
    async (route) => {
      const url = new URL(route.request().url());
      try {
        const body = await readFile(localImageFilePath(url.pathname));
        servedLocalImagePaths.push(url.pathname);
        await route.fulfill({ status: 200, contentType: "image/png", body });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        // `next start` snapshots public files at boot. Fall through when this
        // post-boot local-provider request is not backed by the QA-owned file.
        await route.fallback();
      }
    },
  );
  await gotoDirect(page, `/products/${fixture.image.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(fixture.image.name);
  const fileInput = page.locator("form#product-edit-form input[type='file']");
  await expect(fileInput).toHaveCount(1);

  const initialProduct = await prisma.product.findUniqueOrThrow({
    where: { id: fixture.image.id },
    select: { photoUrl: true, updatedAt: true, images: { select: { id: true } } },
  });
  expect(initialProduct).toMatchObject({ photoUrl: null, images: [] });

  await fileInput.setInputFiles({
    name: "qa-bazaar-invalid.gif",
    mimeType: "image/gif",
    buffer: Buffer.from("GIF89a", "ascii"),
  });
  await expect(
    page
      .locator("form#product-edit-form")
      .getByText("Unsupported image format. Upload JPG, PNG, or WebP.", { exact: true }),
  ).toBeVisible();

  await fileInput.setInputFiles({
    name: "qa-bazaar-oversize.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(32 * 1024 * 1024 + 1),
  });
  await expect(
    page
      .locator("form#product-edit-form")
      .getByText("Image is too large. Upload a file up to 32 MB.", { exact: true }),
  ).toBeVisible();
  expect(advancedProductAudit.allowedUploadRequests).toEqual([]);
  expect(mutationRequestCount(advancedProductAudit, "products.update")).toBe(0);
  await expect(
    prisma.product.findUniqueOrThrow({
      where: { id: fixture.image.id },
      select: { photoUrl: true, updatedAt: true, images: { select: { id: true } } },
    }),
  ).resolves.toEqual(initialProduct);

  const pngBuffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await fileInput.setInputFiles({
    name: "qa-bazaar-local.png",
    mimeType: "image/png",
    buffer: pngBuffer,
  });
  const imagePreview = page.locator("form#product-edit-form img[alt='Image alt 1']").first();
  await expect(imagePreview).toBeVisible();
  await expect(imagePreview).toHaveAttribute("src", new RegExp(localImageUrlPrefix));
  await expectDecodedImage(imagePreview);
  expect(advancedProductAudit.allowedUploadRequests).toHaveLength(2);
  expect(advancedProductAudit.allowedUploadRequests[0]).toMatch(
    /POST https:\/\/127\.0\.0\.1:\d+\/api\/product-images\/upload-url$/,
  );
  expect(advancedProductAudit.allowedUploadRequests[1]).toMatch(
    /POST https:\/\/127\.0\.0\.1:\d+\/api\/product-images\/upload$/,
  );
  await rapidClick(page.getByRole("button", { name: "Products save" }).first());
  await assertSingleMutation(advancedProductAudit, "products.update");
  await assertPathname(page, "/products");

  const savedProduct = await prisma.product.findUniqueOrThrow({
    where: { id: fixture.image.id },
    select: {
      photoUrl: true,
      images: { select: { url: true, position: true }, orderBy: { position: "asc" } },
    },
  });
  expect(savedProduct.images).toEqual([
    { url: expect.stringMatching(localImageUrlPrefix), position: 0 },
  ]);
  expect(savedProduct.photoUrl).toBe(savedProduct.images[0]!.url);
  const imageBytes = await readFile(localImageFilePath(savedProduct.photoUrl!));
  expect(imageBytes.equals(pngBuffer)).toBe(true);

  await gotoDirect(page, `/products/${fixture.image.id}`);
  const persistedPreview = page.locator("form#product-edit-form img[alt='Image alt 1']").first();
  await expect(persistedPreview).toBeVisible();
  await expect(persistedPreview).toHaveAttribute("src", savedProduct.photoUrl!);
  await expectDecodedImage(persistedPreview);
  await persistedPreview
    .locator("xpath=ancestor::div[1]")
    .getByRole("button", { name: "Image remove" })
    .click();
  await rapidClick(page.getByRole("button", { name: "Products save" }).first());
  await assertSingleMutation(advancedProductAudit, "products.update", 1);
  await assertPathname(page, "/products");
  await expect(
    prisma.product.findUniqueOrThrow({
      where: { id: fixture.image.id },
      select: { photoUrl: true, images: { select: { id: true } } },
    }),
  ).resolves.toEqual({ photoUrl: null, images: [] });
  expect(servedLocalImagePaths.length).toBeGreaterThan(0);
  expect(new Set(servedLocalImagePaths)).toEqual(new Set([savedProduct.photoUrl!]));
  await unlink(localImageFilePath(savedProduct.photoUrl!));
  assertCleanAdvancedProductAudit(advancedProductAudit);
});

test("@advanced-products BZR-REQ-0055 product and customer upload controls reject type/size and parse valid files without writes", async ({
  page,
  advancedProductAudit,
}) => {
  const [productCountBefore, batchCountBefore, auditCountBefore] = await Promise.all([
    prisma.product.count({
      where: { organizationId: fixture.organizationId, sku: fixture.invalidImport.sku },
    }),
    prisma.importBatch.count({ where: { organizationId: fixture.organizationId } }),
    prisma.auditLog.count({ where: { organizationId: fixture.organizationId } }),
  ]);
  expect(productCountBefore).toBe(0);

  await gotoDirect(page, "/settings/import");
  await expect(page.getByRole("heading", { level: 1, name: "Imports" })).toBeVisible();
  let importInput = page.locator("input[type='file']");
  await expect(importInput).toHaveCount(1);
  await importInput.setInputFiles({
    name: "qa-bazaar-invalid.exe",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("not a spreadsheet", "utf8"),
  });
  await expect(page.getByText("File parse error", { exact: true })).toBeVisible();
  await importInput.setInputFiles({
    name: "qa-bazaar-oversize.csv",
    mimeType: "text/csv",
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
  });
  await expect(page.getByText("Import too large", { exact: true })).toBeVisible();
  expect(mutationRequestCount(advancedProductAudit, "products.previewImportCsv")).toBe(0);
  expect(mutationRequestCount(advancedProductAudit, "customers.previewImport")).toBe(0);

  const csv = [
    "SKU,Name,Unit,Base price",
    `${fixture.invalidImport.sku},QA-BAZAAR Invalid Import Product,pc,not-a-number`,
  ].join("\n");
  await importInput.setInputFiles({
    name: fixture.invalidImport.fileName,
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  });

  await expect(page.getByText("Validation summary 0 1", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Row 1: Field base price must be a number greater than or equal to 0.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply import", exact: true })).toBeDisabled();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download errors", exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const report = await readFile(downloadPath!, "utf8");
  expect(report).toContain("Row 1: Field base price must be a number greater than or equal to 0.");

  expect(mutationRequestCount(advancedProductAudit, "products.previewImportCsv")).toBe(0);
  await expect(
    Promise.all([
      prisma.product.count({
        where: { organizationId: fixture.organizationId, sku: fixture.invalidImport.sku },
      }),
      prisma.importBatch.count({ where: { organizationId: fixture.organizationId } }),
      prisma.auditLog.count({ where: { organizationId: fixture.organizationId } }),
    ]),
  ).resolves.toEqual([0, batchCountBefore, auditCountBefore]);

  const importTypeCard = page
    .getByRole("heading", { name: "Import type", exact: true })
    .locator("xpath=ancestor::*[contains(@class,'bazaar-admin-surface')]");
  await importTypeCard.getByRole("combobox").click();
  await page.getByRole("option", { name: "Customers", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Customer file", exact: true })).toBeVisible();
  importInput = page.locator("input[type='file']");
  await expect(importInput).toHaveCount(1);
  await importInput.setInputFiles({
    name: "qa-bazaar-invalid.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not accepted by extension", "utf8"),
  });
  await expect(page.getByText("File parse error", { exact: true })).toBeVisible();
  await importInput.setInputFiles({
    name: "qa-bazaar-customers-oversize.csv",
    mimeType: "text/csv",
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
  });
  await expect(page.getByText("Import too large", { exact: true })).toBeVisible();
  expect(mutationRequestCount(advancedProductAudit, "customers.previewImport")).toBe(0);

  const customerEmail = "qa-bazaar-upload-parse-only@auth-e2e.test";
  await importInput.setInputFiles({
    name: "qa-bazaar-customers-valid.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      `name,email,phone,address\nQA-BAZAAR Upload Parse Only,${customerEmail},,Bishkek`,
      "utf8",
    ),
  });
  await expect(page.getByText("qa-bazaar-customers-valid.csv", { exact: true })).toBeVisible();
  await expect(
    page.getByText("QA-BAZAAR Upload Parse Only", { exact: true }).first(),
  ).toBeVisible();
  await expect
    .poll(() => mutationRequestCount(advancedProductAudit, "customers.previewImport"))
    .toBe(1);
  await expect(
    prisma.customer.count({
      where: { organizationId: fixture.organizationId, email: customerEmail },
    }),
  ).resolves.toBe(0);
  await expect(
    prisma.auditLog.count({ where: { organizationId: fixture.organizationId } }),
  ).resolves.toBe(auditCountBefore);
  assertCleanAdvancedProductAudit(advancedProductAudit);
});

test("@advanced-products a stale editor cannot overwrite a newer product revision", async ({
  page,
  context,
  advancedProductAudit,
}) => {
  const auditCountBefore = await prisma.auditLog.count({
    where: {
      organizationId: fixture.organizationId,
      entity: "Product",
      entityId: fixture.staleEdit.id,
      action: "PRODUCT_UPDATE",
    },
  });
  const stalePage = await context.newPage();
  await Promise.all([
    gotoDirect(page, `/products/${fixture.staleEdit.id}`),
    gotoDirect(stalePage, `/products/${fixture.staleEdit.id}`),
  ]);
  await expect(page.getByLabel("Name")).toHaveValue(fixture.staleEdit.name);
  await expect(stalePage.getByLabel("Name")).toHaveValue(fixture.staleEdit.name);

  await page.getByLabel("Name").fill(fixture.staleEdit.winnerName);
  await rapidClick(page.getByRole("button", { name: "Products save" }).first());
  await assertSingleMutation(advancedProductAudit, "products.update");
  await assertPathname(page, "/products");

  await stalePage.getByLabel("Name").fill(fixture.staleEdit.loserName);
  await expectAdvancedProductHttpError({
    page: stalePage,
    audit: advancedProductAudit,
    procedure: "products.update",
    status: 409,
    action: async () => {
      await stalePage.getByRole("button", { name: "Products save" }).first().click();
      await expect
        .poll(() => mutationRequestCount(advancedProductAudit, "products.update"))
        .toBe(2);
      await expect(
        stalePage
          .getByRole("main")
          .getByText("This product was changed in another tab. Reload the page and try again.", {
            exact: true,
          }),
      ).toBeVisible();
    },
  });
  await assertPathname(stalePage, `/products/${fixture.staleEdit.id}`);

  await expect(
    prisma.product.findUniqueOrThrow({
      where: { id: fixture.staleEdit.id },
      select: { name: true },
    }),
  ).resolves.toEqual({ name: fixture.staleEdit.winnerName });
  expect(
    await prisma.auditLog.count({
      where: {
        organizationId: fixture.organizationId,
        entity: "Product",
        entityId: fixture.staleEdit.id,
        action: "PRODUCT_UPDATE",
      },
    }),
  ).toBe(auditCountBefore + 1);

  await stalePage.reload({ waitUntil: "domcontentloaded" });
  await expect(stalePage.getByLabel("Name")).toHaveValue(fixture.staleEdit.winnerName);
  await stalePage.getByRole("link", { name: "Back", exact: true }).click();
  await assertPathname(stalePage, "/products");
  await stalePage.close();
  assertCleanAdvancedProductAudit(advancedProductAudit);
});

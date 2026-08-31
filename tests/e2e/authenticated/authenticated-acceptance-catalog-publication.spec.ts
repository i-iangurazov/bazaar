import { BazaarCatalogStatus, PrismaClient } from "@prisma/client";
import type { Locator, Page } from "@playwright/test";
import superjson from "superjson";

import { seedAuthenticatedCatalogPublicationFixtures } from "../../../scripts/playwright-authenticated-catalog-publication-fixture";
import { authenticatedCatalogPublicationFixture } from "./catalog-publication-contract";
import {
  assertCleanCatalogPublicationAudit,
  attachCatalogPublicationAuditOnFailure,
  catalogPublicationMutationCount,
  expect,
  test,
  type CatalogPublicationAudit,
} from "./catalog-publication-test-fixtures";
import { assertAuthenticatedE2EDatabaseUrl } from "./contract";

const fixture = authenticatedCatalogPublicationFixture;
const datasourceUrl = assertAuthenticatedE2EDatabaseUrl(process.env.E2E_AUTH_DATABASE_URL);
const prisma = new PrismaClient({ datasourceUrl });

test.describe.configure({ mode: "serial" });

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

const assertOneAdditionalMutation = async (
  audit: CatalogPublicationAudit,
  previousCount: number,
) => {
  await expect.poll(() => catalogPublicationMutationCount(audit)).toBe(previousCount + 1);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(catalogPublicationMutationCount(audit)).toBe(previousCount + 1);
};

const invokeCatalogUpsert = async (
  page: Page,
  input: {
    storeId: string;
    title: string;
    accentColor: string;
    status: BazaarCatalogStatus;
  },
) => {
  const body = JSON.stringify({ 0: superjson.serialize(input) });
  return page.evaluate(
    async ({ requestBody }) => {
      const response = await fetch("/api/trpc/bazaarCatalog.upsert?batch=1", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-request-id": "catalog-publication-foreign-scope-denial",
        },
        body: requestBody,
      });
      return { status: response.status, text: await response.text() };
    },
    { requestBody: body },
  );
};

test.afterEach(async ({ catalogPublicationAudit }, testInfo) => {
  await attachCatalogPublicationAuditOnFailure(testInfo, catalogPublicationAudit);
});

test.afterAll(async () => {
  try {
    await seedAuthenticatedCatalogPublicationFixtures(prisma);
  } finally {
    await prisma.$disconnect();
  }
});

test("@catalog-publication publishes one owned catalog, exposes only its product, then unpublishes", async ({
  page,
  catalogPublicationAudit,
}) => {
  const [foreignBefore, foreignAuditCountBefore, primaryAuditIdsBefore] = await Promise.all([
    prisma.bazaarCatalog.findUniqueOrThrow({
      where: { id: fixture.foreign.id },
      select: {
        id: true,
        organizationId: true,
        storeId: true,
        slug: true,
        title: true,
        status: true,
        publishedAt: true,
        updatedAt: true,
        updatedById: true,
      },
    }),
    prisma.auditLog.count({
      where: {
        organizationId: fixture.foreign.organizationId,
        entity: "BazaarCatalog",
        entityId: fixture.foreign.id,
      },
    }),
    prisma.auditLog.findMany({
      where: {
        organizationId: fixture.primary.organizationId,
        entity: "BazaarCatalog",
        entityId: fixture.primary.id,
      },
      select: { id: true },
    }),
  ]);
  expect(foreignBefore).toMatchObject({
    organizationId: fixture.foreign.organizationId,
    storeId: fixture.foreign.storeId,
    status: BazaarCatalogStatus.DRAFT,
    title: fixture.foreign.title,
    publishedAt: null,
  });

  await gotoDirect(
    page,
    `/operations/integrations/bazaar-catalog?storeId=${encodeURIComponent(fixture.primary.storeId)}`,
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Bazaar catalog settings" }),
  ).toBeVisible();

  const consoleErrorCountBeforeDeniedRequest = catalogPublicationAudit.consoleErrors.length;
  const denied = await invokeCatalogUpsert(page, {
    storeId: fixture.foreign.storeId,
    title: fixture.foreign.attemptedTitle,
    accentColor: fixture.foreign.accentColor,
    status: BazaarCatalogStatus.PUBLISHED,
  });
  expect([403, 404]).toContain(denied.status);
  await expect
    .poll(() => catalogPublicationAudit.consoleErrors.slice(consoleErrorCountBeforeDeniedRequest))
    .toHaveLength(1);
  const intentionalDenialConsoleError =
    catalogPublicationAudit.consoleErrors[consoleErrorCountBeforeDeniedRequest]!;
  expect(intentionalDenialConsoleError).toMatch(
    new RegExp(`failed to load resource.*status of ${denied.status}`, "i"),
  );
  for (const forbiddenValue of [
    fixture.foreign.organizationId,
    fixture.foreign.storeId,
    fixture.foreign.product.id,
    fixture.foreign.product.name,
  ]) {
    expect(denied.text).not.toContain(forbiddenValue);
  }
  await expect(
    Promise.all([
      prisma.bazaarCatalog.findUniqueOrThrow({
        where: { id: fixture.foreign.id },
        select: {
          id: true,
          organizationId: true,
          storeId: true,
          slug: true,
          title: true,
          status: true,
          publishedAt: true,
          updatedAt: true,
          updatedById: true,
        },
      }),
      prisma.auditLog.count({
        where: {
          organizationId: fixture.foreign.organizationId,
          entity: "BazaarCatalog",
          entityId: fixture.foreign.id,
        },
      }),
    ]),
  ).resolves.toEqual([foreignBefore, foreignAuditCountBefore]);

  const mutationCountAfterDeniedForeignWrite =
    catalogPublicationMutationCount(catalogPublicationAudit);
  expect(mutationCountAfterDeniedForeignWrite).toBe(1);

  const titleInput = page.getByLabel("Title label");
  const publishSwitch = page.getByRole("switch", { name: "Publish label" });
  await expect(titleInput).toHaveValue(fixture.primary.title);
  await expect(publishSwitch).not.toBeChecked();
  await titleInput.fill(fixture.primary.publishedTitle);
  await publishSwitch.click();
  await rapidClick(page.getByRole("button", { name: "Save", exact: true }));
  await assertOneAdditionalMutation(catalogPublicationAudit, mutationCountAfterDeniedForeignWrite);
  await expect(page.getByText("Bazaar catalog settings saved.", { exact: true })).toBeVisible();

  await expect
    .poll(async () =>
      prisma.bazaarCatalog.findUniqueOrThrow({
        where: { id: fixture.primary.id },
        select: { status: true, title: true, publishedAt: true },
      }),
    )
    .toEqual({
      status: BazaarCatalogStatus.PUBLISHED,
      title: fixture.primary.publishedTitle,
      publishedAt: expect.any(Date),
    });

  const primaryAuditIds = new Set(primaryAuditIdsBefore.map((entry) => entry.id));
  const publicationAudits = await prisma.auditLog.findMany({
    where: {
      organizationId: fixture.primary.organizationId,
      entity: "BazaarCatalog",
      entityId: fixture.primary.id,
    },
    orderBy: { createdAt: "asc" },
  });
  const newPublicationAudits = publicationAudits.filter((entry) => !primaryAuditIds.has(entry.id));
  expect(newPublicationAudits).toHaveLength(1);
  expect(newPublicationAudits[0]).toMatchObject({
    actorId: fixture.primary.updatedById,
    action: "BAZAAR_CATALOG_SETTINGS_UPDATED",
    before: expect.objectContaining({
      storeId: fixture.primary.storeId,
      status: BazaarCatalogStatus.DRAFT,
    }),
    after: expect.objectContaining({
      storeId: fixture.primary.storeId,
      status: BazaarCatalogStatus.PUBLISHED,
      title: fixture.primary.publishedTitle,
    }),
  });

  await gotoDirect(page, fixture.primary.publicUrlPath);
  await expect(
    page.getByRole("heading", { level: 1, name: fixture.primary.publishedTitle }),
  ).toBeVisible();
  await expect(page.getByText(fixture.primary.product.name, { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(fixture.foreign.product.name);
  const publicHtml = await page.content();
  for (const forbiddenValue of [
    fixture.foreign.organizationId,
    fixture.foreign.storeId,
    fixture.foreign.product.id,
    fixture.foreign.product.name,
  ]) {
    expect(publicHtml).not.toContain(forbiddenValue);
  }

  const publicApiResponse = await page.request.get(
    `/api/public/catalog/${encodeURIComponent(fixture.primary.slug)}?search=${encodeURIComponent(fixture.primary.product.name)}&page=1&pageSize=24`,
    { failOnStatusCode: false },
  );
  expect(publicApiResponse.status()).toBe(200);
  const publicApiText = await publicApiResponse.text();
  expect(publicApiText).toContain(fixture.primary.product.id);
  expect(publicApiText).toContain(fixture.primary.product.name);
  for (const forbiddenValue of [
    fixture.foreign.organizationId,
    fixture.foreign.storeId,
    fixture.foreign.product.id,
    fixture.foreign.product.name,
  ]) {
    expect(publicApiText).not.toContain(forbiddenValue);
  }

  await gotoDirect(
    page,
    `/operations/integrations/bazaar-catalog?storeId=${encodeURIComponent(fixture.primary.storeId)}`,
  );
  await expect(publishSwitch).toBeChecked();
  await publishSwitch.click();
  const mutationCountBeforeUnpublish = catalogPublicationMutationCount(catalogPublicationAudit);
  await rapidClick(page.getByRole("button", { name: "Save", exact: true }));
  await assertOneAdditionalMutation(catalogPublicationAudit, mutationCountBeforeUnpublish);
  await expect
    .poll(async () =>
      prisma.bazaarCatalog.findUniqueOrThrow({
        where: { id: fixture.primary.id },
        select: { status: true, publishedAt: true },
      }),
    )
    .toEqual({ status: BazaarCatalogStatus.DRAFT, publishedAt: null });

  const finalAudits = await prisma.auditLog.findMany({
    where: {
      organizationId: fixture.primary.organizationId,
      entity: "BazaarCatalog",
      entityId: fixture.primary.id,
    },
    orderBy: { createdAt: "asc" },
  });
  const newFinalAudits = finalAudits.filter((entry) => !primaryAuditIds.has(entry.id));
  expect(newFinalAudits).toHaveLength(2);
  expect(newFinalAudits[1]).toMatchObject({
    actorId: fixture.primary.updatedById,
    action: "BAZAAR_CATALOG_SETTINGS_UPDATED",
    before: expect.objectContaining({ status: BazaarCatalogStatus.PUBLISHED }),
    after: expect.objectContaining({ status: BazaarCatalogStatus.DRAFT }),
  });

  const unpublishedResponse = await page.request.get(fixture.primary.publicUrlPath, {
    failOnStatusCode: false,
  });
  expect(unpublishedResponse.status()).toBe(404);
  assertCleanCatalogPublicationAudit(catalogPublicationAudit, {
    expectedConsoleErrors: [intentionalDenialConsoleError],
  });
});

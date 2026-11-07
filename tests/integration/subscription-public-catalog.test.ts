import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { createCatalogCheckoutOrder, getPublicBazaarCatalog } from "@/server/services/bazaarCatalog";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

(shouldRunDbTests ? describe : describe.skip)("public catalog subscription availability", () => {
  beforeEach(resetDatabase);
  const fixture = async () => {
    const f = await seedBase({ plan: "BUSINESS" });
    await prisma.organization.update({ where: { id: f.org.id }, data: {
      currentPeriodEndsAt: new Date(Date.now() + 30 * 86400000),
    } });
    await prisma.subscriptionContract.create({ data: { organizationId: f.org.id, catalogVersion: "2026-11" } });
    const catalog = await prisma.bazaarCatalog.create({ data: { organizationId: f.org.id,
      storeId: f.store.id, slug: "synthetic-catalog", publicUrlPath: "/catalog/synthetic-catalog", title: "Test catalog", status: "PUBLISHED" } });
    return { ...f, catalog };
  };
  it("serves an active entitled catalog and hides it after grace without altering catalog or products", async () => {
    const f = await fixture();
    expect(await getPublicBazaarCatalog(f.catalog.slug)).not.toBeNull();
    await prisma.organization.update({ where: { id: f.org.id }, data: {
      currentPeriodEndsAt: new Date(Date.now() - 8 * 86400000),
    } });
    expect(await getPublicBazaarCatalog(f.catalog.slug)).toBeNull();
    await expect(createCatalogCheckoutOrder({ slug: f.catalog.slug, customerName: "Test", customerEmail: "client@example.invalid",
      customerPhone: "+996700123456", lines: [{ productId: f.product.id, qty: 1, quotedUnitPriceKgs: 0 }] }))
      .rejects.toThrow("catalogNotFound");
    expect(await prisma.customerOrder.count()).toBe(0);
    expect((await prisma.bazaarCatalog.findUniqueOrThrow({ where: { id: f.catalog.id } })).status).toBe("PUBLISHED");
    expect(await prisma.product.count()).toBe(1);
  });
  it("does not apply new catalog expiry rules to frozen legacy grants", async () => {
    const f = await seedBase();
    await prisma.subscriptionContract.create({ data: { organizationId: f.org.id } });
    const catalog = await prisma.bazaarCatalog.create({ data: { organizationId: f.org.id,
      storeId: f.store.id, slug: "legacy-catalog", publicUrlPath: "/catalog/legacy-catalog", title: "Legacy", status: "PUBLISHED" } });
    expect(await getPublicBazaarCatalog(catalog.slug)).not.toBeNull();
  });
});

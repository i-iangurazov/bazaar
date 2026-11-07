import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { createContractTerms } from "@/server/billing/contractTerms";
import {
  getSubscriptionUsage,
  reserveSubscriptionUsage,
  settleSubscriptionUsage,
} from "@/server/billing/subscriptionUsage";
import { bulkAutofillMMarketSpecs, updateMMarketProductSelection } from "@/server/services/mMarket";
import { suggestProductSpecsFromImages } from "@/server/services/productSpecSuggestions";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

vi.mock("@/server/services/productSpecSuggestions", () => ({
  suggestProductSpecsFromImages: vi.fn(),
}));

const prepare = async (input?: { products?: number; rulesOnly?: boolean }) => {
  const f = await seedBase({ plan: "ENTERPRISE" });
  await prisma.user.updateMany({
    where: { organizationId: f.org.id, id: { not: f.adminUser.id } },
    data: { isActive: false },
  });
  await prisma.organization.update({
    where: { id: f.org.id },
    data: { currentPeriodEndsAt: new Date(Date.now() + 30 * 86400000) },
  });
  await prisma.subscriptionContract.create({
    data: {
      organizationId: f.org.id,
      catalogVersion: "2026-11",
      termsSnapshot: createContractTerms("2026-11"),
    },
  });
  await prisma.mMarketIntegration.create({ data: { orgId: f.org.id } });
  await prisma.mMarketBranchMapping.create({
    data: { orgId: f.org.id, storeId: f.store.id, mmarketBranchId: "synthetic-branch" },
  });
  const fields = input?.rulesOnly
    ? [
        { key: "manufacturer", label: "Производитель" },
        { key: "model", label: "Модель" },
      ]
    : [
        { key: "color", label: "Цвет" },
        { key: "type", label: "Тип" },
      ];
  for (const [index, field] of fields.entries()) {
    await prisma.attributeDefinition.create({
      data: {
        organizationId: f.org.id,
        key: field.key,
        labelRu: field.label,
        labelKg: field.label,
        type: "TEXT",
        required: true,
      },
    });
    await prisma.categoryAttributeTemplate.create({
      data: {
        organizationId: f.org.id,
        category: "Test Category",
        attributeKey: field.key,
        order: index,
      },
    });
  }
  const products = [f.product];
  for (let index = 1; index < (input?.products ?? 1); index++) {
    const product = await prisma.product.create({
      data: {
        organizationId: f.org.id,
        supplierId: f.supplier.id,
        sku: `AI-TEST-${index}`,
        name: `Test item ${index}`,
        unit: f.baseUnit.code,
        baseUnitId: f.baseUnit.id,
      },
    });
    await prisma.storeProduct.create({
      data: { organizationId: f.org.id, storeId: f.store.id, productId: product.id },
    });
    products.push(product);
  }
  for (const product of products) {
    await prisma.product.update({
      where: { id: product.id },
      data: {
        category: "Test Category",
        photoUrl: input?.rulesOnly ? null : "https://example.invalid/synthetic.jpg",
      },
    });
    await prisma.inventorySnapshot.create({
      data: {
        storeId: f.store.id,
        productId: product.id,
        variantKey: "BASE",
        onHand: 1,
        onOrder: 0,
        allowNegativeStock: false,
      },
    });
  }
  await updateMMarketProductSelection({
    organizationId: f.org.id,
    storeId: f.store.id,
    actorId: f.adminUser.id,
    requestId: randomUUID(),
    productIds: products.map((product) => product.id),
    included: true,
  });
  return { ...f, products };
};

const autofill = (f: Awaited<ReturnType<typeof prepare>>) =>
  bulkAutofillMMarketSpecs({
    organizationId: f.org.id,
    storeId: f.store.id,
    actorId: f.adminUser.id,
    requestId: randomUUID(),
    productIds: f.products.map((product) => product.id),
  });

(shouldRunDbTests ? describe : describe.skip)("MMarket per-card AI subscription quota", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.mocked(suggestProductSpecsFromImages).mockReset();
  });

  it("charges one AI operation for one saved card even when it fills two fields", async () => {
    const f = await prepare();
    vi.mocked(suggestProductSpecsFromImages).mockResolvedValue({
      suggestions: { type: "Тестовый тип", color: "Синий" },
    });
    const result = await autofill(f);
    expect(result).toMatchObject({ targetedCount: 1, updatedCount: 1, filledValueCount: 2 });
    expect(suggestProductSpecsFromImages).toHaveBeenCalledTimes(1);
    expect(await prisma.variantAttributeValue.count()).toBe(2);
    expect(
      (await getSubscriptionUsage(f.org.id)).find((row) => row.resource === "ai"),
    ).toMatchObject({ used: 1, reserved: 0 });
  });

  it("atomically rejects a bulk selection that exceeds remaining AI quota before provider work", async () => {
    const f = await prepare({ products: 2 });
    const lease = await reserveSubscriptionUsage({
      organizationId: f.org.id,
      resource: "ai",
      operationKey: randomUUID(),
      units: 499,
    });
    await settleSubscriptionUsage(lease, true);
    await expect(autofill(f)).rejects.toThrow("billingUsageLimitReached");
    expect(suggestProductSpecsFromImages).not.toHaveBeenCalled();
    expect(await prisma.variantAttributeValue.count()).toBe(0);
    expect(
      (await getSubscriptionUsage(f.org.id)).find((row) => row.resource === "ai"),
    ).toMatchObject({ used: 499, reserved: 0 });
  });

  it("releases the client allowance when AI fails to supply a saved result", async () => {
    const f = await prepare();
    vi.mocked(suggestProductSpecsFromImages).mockRejectedValue(new Error("aiRequestFailed"));
    await autofill(f);
    expect(suggestProductSpecsFromImages).toHaveBeenCalledTimes(1);
    expect(
      (await getSubscriptionUsage(f.org.id)).find((row) => row.resource === "ai"),
    ).toMatchObject({ used: 0, reserved: 0 });
    expect(await prisma.subscriptionUsageReservation.count({ where: { state: "RESERVED" } })).toBe(
      0,
    );
  });

  it("does not charge or call AI for deterministic manufacturer/model preparation", async () => {
    const f = await prepare({ rulesOnly: true });
    const result = await autofill(f);
    expect(result).toMatchObject({ targetedCount: 1, updatedCount: 1, filledValueCount: 2 });
    expect(suggestProductSpecsFromImages).not.toHaveBeenCalled();
    expect(await prisma.subscriptionUsageReservation.count()).toBe(0);
  });
});

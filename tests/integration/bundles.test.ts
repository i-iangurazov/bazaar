import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { createProduct } from "@/server/services/products";
import { adjustStock } from "@/server/services/inventory";
import { addBundleComponent, assembleBundle } from "@/server/services/bundles";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("bundles", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("assembles bundles idempotently", async () => {
    const { org, store, adminUser, baseUnit } = await seedBase({ plan: "BUSINESS" });

    const component = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-bundle-component",
      sku: "COMP-1",
      name: "Component",
      baseUnitId: baseUnit.id,
    });

    const bundle = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-bundle-product",
      sku: "BUNDLE-1",
      name: "Bundle",
      baseUnitId: baseUnit.id,
    });

    await addBundleComponent({
      bundleProductId: bundle.id,
      componentProductId: component.id,
      qty: 1,
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-bundle-add",
    });

    await adjustStock({
      storeId: store.id,
      productId: component.id,
      qtyDelta: 5,
      reason: "Seed component",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-bundle-seed",
      idempotencyKey: "idem-bundle-seed",
    });

    await assembleBundle({
      storeId: store.id,
      bundleProductId: bundle.id,
      qty: 2,
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-bundle-assemble-1",
      idempotencyKey: "idem-bundle-assemble",
    });

    await assembleBundle({
      storeId: store.id,
      bundleProductId: bundle.id,
      qty: 2,
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-bundle-assemble-2",
      idempotencyKey: "idem-bundle-assemble",
    });

    const componentSnapshot = await prisma.inventorySnapshot.findUnique({
      where: {
        storeId_productId_variantKey: {
          storeId: store.id,
          productId: component.id,
          variantKey: "BASE",
        },
      },
    });
    const bundleSnapshot = await prisma.inventorySnapshot.findUnique({
      where: {
        storeId_productId_variantKey: {
          storeId: store.id,
          productId: bundle.id,
          variantKey: "BASE",
        },
      },
    });

    expect(componentSnapshot?.onHand).toBe(3);
    expect(bundleSnapshot?.onHand).toBe(2);

    const movements = await prisma.stockMovement.findMany({
      where: {
        storeId: store.id,
        referenceType: "BUNDLE_ASSEMBLY",
      },
    });

    expect(movements).toHaveLength(2);
  });
});

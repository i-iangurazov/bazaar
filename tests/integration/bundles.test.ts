import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { createProduct } from "@/server/services/products";
import { postStockReceiving } from "@/server/services/inventory";
import { addBundleComponent, assembleBundle } from "@/server/services/bundles";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("bundles", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("assembles bundles idempotently", async () => {
    const { org, store, adminUser, baseUnit } = await seedBase();

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

    await postStockReceiving({
      storeId: store.id,
      referenceNumber: "BUNDLE-SEED",
      lines: [{ productId: component.id, quantity: 5, unitCost: 10 }],
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

  it("transfers precise component value into bundle inventory without creating value", async () => {
    const { org, store, adminUser, baseUnit } = await seedBase();

    const componentA = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-bundle-value-component-a",
      sku: "COMP-VALUE-A",
      name: "Valued Component A",
      baseUnitId: baseUnit.id,
    });
    const componentB = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-bundle-value-component-b",
      sku: "COMP-VALUE-B",
      name: "Valued Component B",
      baseUnitId: baseUnit.id,
    });
    const bundle = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-bundle-value-product",
      sku: "BUNDLE-VALUE",
      name: "Valued Bundle",
      baseUnitId: baseUnit.id,
    });

    await addBundleComponent({
      bundleProductId: bundle.id,
      componentProductId: componentA.id,
      qty: 1,
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-bundle-value-add-a",
    });
    await addBundleComponent({
      bundleProductId: bundle.id,
      componentProductId: componentB.id,
      qty: 1,
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-bundle-value-add-b",
    });

    await postStockReceiving({
      storeId: store.id,
      referenceNumber: "BUNDLE-VALUE-A-1",
      lines: [{ productId: componentA.id, quantity: 3, unitCost: 10.01 }],
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-bundle-value-receive-a-1",
      idempotencyKey: "idem-bundle-value-receive-a-1",
    });
    await postStockReceiving({
      storeId: store.id,
      referenceNumber: "BUNDLE-VALUE-A-2",
      lines: [{ productId: componentA.id, quantity: 2, unitCost: 10.03 }],
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-bundle-value-receive-a-2",
      idempotencyKey: "idem-bundle-value-receive-a-2",
    });
    await postStockReceiving({
      storeId: store.id,
      referenceNumber: "BUNDLE-VALUE-B-1",
      lines: [{ productId: componentB.id, quantity: 3, unitCost: 7.77 }],
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-bundle-value-receive-b-1",
      idempotencyKey: "idem-bundle-value-receive-b-1",
    });

    await assembleBundle({
      storeId: store.id,
      bundleProductId: bundle.id,
      qty: 2,
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-bundle-value-assemble",
      idempotencyKey: "idem-bundle-value-assemble",
    });

    const [costs, movements, snapshots] = await Promise.all([
      prisma.productCost.findMany({
        where: { productId: { in: [componentA.id, componentB.id, bundle.id] } },
      }),
      prisma.stockMovement.findMany({
        where: { storeId: store.id, referenceType: "BUNDLE_ASSEMBLY" },
        orderBy: { createdAt: "asc" },
      }),
      prisma.inventorySnapshot.findMany({
        where: { storeId: store.id, productId: { in: [componentA.id, componentB.id, bundle.id] } },
      }),
    ]);

    const costFor = (productId: string) => {
      const cost = costs.find((candidate) => candidate.productId === productId);
      expect(cost).toBeDefined();
      return {
        quantity: cost?.costBasisQty,
        valueKgs: Number(cost?.costBasisValueKgs),
        averageKgs: Number(cost?.avgCostKgs),
      };
    };
    expect(costFor(componentA.id)).toEqual({
      quantity: 3,
      valueKgs: 30.054,
      averageKgs: 10.02,
    });
    expect(costFor(componentB.id)).toEqual({
      quantity: 1,
      valueKgs: 7.77,
      averageKgs: 7.77,
    });
    expect(costFor(bundle.id)).toEqual({
      quantity: 2,
      valueKgs: 35.576,
      averageKgs: 17.79,
    });

    const movementFor = (productId: string) => {
      const movement = movements.find((candidate) => candidate.productId === productId);
      expect(movement).toBeDefined();
      return {
        type: movement?.type,
        qtyDelta: movement?.qtyDelta,
        unitCostKgs: Number(movement?.unitCostKgs),
        lineTotalKgs: Number(movement?.lineTotalKgs),
        inventoryValueDeltaKgs: Number(movement?.inventoryValueDeltaKgs),
      };
    };
    expect(movementFor(componentA.id)).toEqual({
      type: "ADJUSTMENT",
      qtyDelta: -2,
      unitCostKgs: 10.02,
      lineTotalKgs: -20.04,
      inventoryValueDeltaKgs: -20.036,
    });
    expect(movementFor(componentB.id)).toEqual({
      type: "ADJUSTMENT",
      qtyDelta: -2,
      unitCostKgs: 7.77,
      lineTotalKgs: -15.54,
      inventoryValueDeltaKgs: -15.54,
    });
    expect(movementFor(bundle.id)).toEqual({
      type: "RECEIVE",
      qtyDelta: 2,
      unitCostKgs: 17.79,
      lineTotalKgs: 35.58,
      inventoryValueDeltaKgs: 35.576,
    });
    expect(
      movements.reduce((sum, movement) => sum + Number(movement.inventoryValueDeltaKgs), 0),
    ).toBeCloseTo(0, 6);
    expect(movements.some((movement) => movement.type === "SALE")).toBe(false);

    const onHandFor = (productId: string) =>
      snapshots.find((snapshot) => snapshot.productId === productId)?.onHand;
    expect({
      componentA: onHandFor(componentA.id),
      componentB: onHandFor(componentB.id),
      bundle: onHandFor(bundle.id),
    }).toEqual({ componentA: 3, componentB: 1, bundle: 2 });
  });
});

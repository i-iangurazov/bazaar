import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import {
  adjustStock,
  archiveStockMovementDocument,
  editStockMovementDocument,
  postStockReceiving,
  postStockWriteOff,
} from "@/server/services/inventory";
import { setProductCostBasis } from "@/server/services/productCost";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const costKey = (organizationId: string, productId: string, variantKey = "BASE") => ({
  organizationId_productId_variantKey: { organizationId, productId, variantKey },
});

const readAccountingState = async (input: {
  organizationId: string;
  productId: string;
  storeIds: string[];
  actorId: string;
}) => {
  const [cost, snapshots, movementCount, auditCount, idempotencyCount] = await Promise.all([
    prisma.productCost.findUnique({
      where: costKey(input.organizationId, input.productId),
    }),
    Promise.all(
      input.storeIds.map((storeId) =>
        prisma.inventorySnapshot.findUnique({
          where: {
            storeId_productId_variantKey: {
              storeId,
              productId: input.productId,
              variantKey: "BASE",
            },
          },
        }),
      ),
    ),
    prisma.stockMovement.count({ where: { productId: input.productId } }),
    prisma.auditLog.count({ where: { organizationId: input.organizationId } }),
    prisma.idempotencyKey.count({ where: { userId: input.actorId } }),
  ]);

  return {
    cost:
      cost === null
        ? null
        : {
            quantity: cost.costBasisQty,
            valueKgs: Number(cost.costBasisValueKgs),
            avgCostKgs: Number(cost.avgCostKgs),
          },
    onHand: snapshots.map((snapshot) => snapshot?.onHand ?? null),
    movementCount,
    auditCount,
    idempotencyCount,
  };
};

describeDb("D-010 and D-011 conservative accounting policies", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects valued store depletion below zero and rolls back the organization basis", async () => {
    const { org, store, product, adminUser } = await seedBase({
      plan: "BUSINESS",
      allowNegativeStock: true,
    });
    const otherStore = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Valued stock reserve",
        code: "VALUED-RESERVE",
        allowNegativeStock: true,
      },
    });
    await prisma.storeProduct.create({
      data: {
        organizationId: org.id,
        storeId: otherStore.id,
        productId: product.id,
        isActive: true,
      },
    });

    await postStockReceiving({
      storeId: store.id,
      lines: [{ productId: product.id, quantity: 1, unitCost: 10 }],
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "d010-receive-local",
      idempotencyKey: "d010-receive-local",
    });
    await postStockReceiving({
      storeId: otherStore.id,
      lines: [{ productId: product.id, quantity: 4, unitCost: 10 }],
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "d010-receive-reserve",
      idempotencyKey: "d010-receive-reserve",
    });

    const stateInput = {
      organizationId: org.id,
      productId: product.id,
      storeIds: [store.id, otherStore.id],
      actorId: adminUser.id,
    };
    const before = await readAccountingState(stateInput);
    await expect(
      adjustStock({
        storeId: store.id,
        productId: product.id,
        qtyDelta: -2,
        reason: "Should not value negative stock",
        actorId: adminUser.id,
        organizationId: org.id,
        requestId: "d010-valued-depletion",
        idempotencyKey: "d010-valued-depletion",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "valuedNegativeStockDepletionBlocked",
    });

    const after = await readAccountingState(stateInput);
    expect(before).toEqual({
      cost: { quantity: 5, valueKgs: 50, avgCostKgs: 10 },
      onHand: [1, 4],
      movementCount: 2,
      auditCount: 2,
      idempotencyCount: 2,
    });
    expect(after).toEqual(before);
    await expect(
      prisma.idempotencyKey.count({ where: { key: "d010-valued-depletion" } }),
    ).resolves.toBe(0);
  });

  it("rejects a manual valuation while an unvalued store position is negative", async () => {
    const { org, store, product, adminUser } = await seedBase({
      plan: "BUSINESS",
      allowNegativeStock: true,
    });
    await adjustStock({
      storeId: store.id,
      productId: product.id,
      qtyDelta: -3,
      reason: "Explicit unvalued negative fixture",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "d010-unvalued-negative",
      idempotencyKey: "d010-unvalued-negative",
    });

    const stateInput = {
      organizationId: org.id,
      productId: product.id,
      storeIds: [store.id],
      actorId: adminUser.id,
    };
    const before = await readAccountingState(stateInput);
    await expect(
      prisma.$transaction((tx) =>
        setProductCostBasis(tx, {
          organizationId: org.id,
          productId: product.id,
          quantity: 0,
          unitCost: 10,
        }),
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "valuedNegativeStockRecoveryBlocked",
    });

    const [after, movement] = await Promise.all([
      readAccountingState(stateInput),
      prisma.stockMovement.findFirstOrThrow({ where: { productId: product.id } }),
    ]);
    expect(before).toEqual({
      cost: null,
      onHand: [-3],
      movementCount: 1,
      auditCount: 1,
      idempotencyCount: 1,
    });
    expect(after).toEqual(before);
    expect({
      unitCostKgs: movement.unitCostKgs,
      inventoryValueDeltaKgs: movement.inventoryValueDeltaKgs,
    }).toEqual({ unitCostKgs: null, inventoryValueDeltaKgs: null });
  });

  it("locks receipt edit and archive after downstream consumption with no side effects", async () => {
    const { org, store, product, adminUser } = await seedBase({ plan: "BUSINESS" });
    const receiving = await postStockReceiving({
      storeId: store.id,
      lines: [{ productId: product.id, quantity: 5, unitCost: 10 }],
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "d011-receive",
      idempotencyKey: "d011-receive",
    });
    await postStockWriteOff({
      storeId: store.id,
      reason: "Порча",
      lines: [{ productId: product.id, qty: 1 }],
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "d011-write-off",
      idempotencyKey: "d011-write-off",
    });

    const stateInput = {
      organizationId: org.id,
      productId: product.id,
      storeIds: [store.id],
      actorId: adminUser.id,
    };
    const before = await readAccountingState(stateInput);
    await expect(
      editStockMovementDocument({
        documentType: "STOCK_RECEIVING",
        referenceType: "STOCK_RECEIVING",
        referenceId: receiving.receivingId,
        lines: [{ productId: product.id, quantity: 6, unitCostKgs: 11 }],
        actorId: adminUser.id,
        organizationId: org.id,
        requestId: "d011-edit-after-write-off",
        idempotencyKey: "d011-edit-after-write-off",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "stockReceivingEditLockedAfterDownstreamMovement",
    });
    await expect(
      archiveStockMovementDocument({
        documentType: "STOCK_RECEIVING",
        referenceType: "STOCK_RECEIVING",
        referenceId: receiving.receivingId,
        actorId: adminUser.id,
        organizationId: org.id,
        requestId: "d011-archive-after-write-off",
        idempotencyKey: "d011-archive-after-write-off",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "stockReceivingEditLockedAfterDownstreamMovement",
    });

    const after = await readAccountingState(stateInput);
    expect(before).toEqual({
      cost: { quantity: 4, valueKgs: 40, avgCostKgs: 10 },
      onHand: [4],
      movementCount: 2,
      auditCount: 2,
      idempotencyCount: 2,
    });
    expect(after).toEqual(before);
    await expect(
      prisma.idempotencyKey.count({
        where: { key: { in: ["d011-edit-after-write-off", "d011-archive-after-write-off"] } },
      }),
    ).resolves.toBe(0);
  });

  it("records a later manual revaluation and locks the earlier receipt", async () => {
    const { org, store, product, adminUser } = await seedBase({ plan: "BUSINESS" });
    const receiving = await postStockReceiving({
      storeId: store.id,
      lines: [{ productId: product.id, quantity: 5, unitCost: 10 }],
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "d011-receive-before-revaluation",
      idempotencyKey: "d011-receive-before-revaluation",
    });
    await prisma.$transaction((tx) =>
      setProductCostBasis(tx, {
        organizationId: org.id,
        productId: product.id,
        quantity: 5,
        unitCost: 12,
      }),
    );

    const stateInput = {
      organizationId: org.id,
      productId: product.id,
      storeIds: [store.id],
      actorId: adminUser.id,
    };
    const before = await readAccountingState(stateInput);
    await expect(
      editStockMovementDocument({
        documentType: "STOCK_RECEIVING",
        referenceType: "STOCK_RECEIVING",
        referenceId: receiving.receivingId,
        lines: [{ productId: product.id, quantity: 6, unitCostKgs: 11 }],
        actorId: adminUser.id,
        organizationId: org.id,
        requestId: "d011-edit-after-revaluation",
        idempotencyKey: "d011-edit-after-revaluation",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "stockReceivingEditLockedAfterDownstreamMovement",
    });

    const [after, marker] = await Promise.all([
      readAccountingState(stateInput),
      prisma.stockMovement.findFirstOrThrow({
        where: {
          productId: product.id,
          referenceType: "PRODUCT_COST_REVALUATION",
        },
      }),
    ]);
    expect(before).toEqual({
      cost: { quantity: 5, valueKgs: 60, avgCostKgs: 12 },
      onHand: [5],
      movementCount: 2,
      auditCount: 1,
      idempotencyCount: 1,
    });
    expect(after).toEqual(before);
    expect({
      qtyDelta: marker.qtyDelta,
      unitCostKgs: Number(marker.unitCostKgs),
      inventoryValueDeltaKgs: marker.inventoryValueDeltaKgs,
    }).toEqual({ qtyDelta: 0, unitCostKgs: 12, inventoryValueDeltaKgs: null });
    await expect(
      prisma.idempotencyKey.count({ where: { key: "d011-edit-after-revaluation" } }),
    ).resolves.toBe(0);
  });

  it("keeps the receipt lock scoped to the exact variant stream", async () => {
    const { org, store, product, adminUser } = await seedBase({ plan: "BUSINESS" });
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, name: "Blue", sku: "D011-BLUE", attributes: {} },
    });
    const receiving = await postStockReceiving({
      storeId: store.id,
      lines: [{ productId: product.id, variantId: variant.id, quantity: 2, unitCost: 3 }],
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "d011-variant-receive",
      idempotencyKey: "d011-variant-receive",
    });
    await postStockReceiving({
      storeId: store.id,
      lines: [{ productId: product.id, quantity: 1, unitCost: 7 }],
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "d011-base-receive",
      idempotencyKey: "d011-base-receive",
    });

    await expect(
      editStockMovementDocument({
        documentType: "STOCK_RECEIVING",
        referenceType: "STOCK_RECEIVING",
        referenceId: receiving.receivingId,
        lines: [{ productId: product.id, variantId: variant.id, quantity: 1, unitCostKgs: 4 }],
        actorId: adminUser.id,
        organizationId: org.id,
        requestId: "d011-variant-edit",
        idempotencyKey: "d011-variant-edit",
      }),
    ).resolves.toMatchObject({ lineCount: 1, totalQuantity: 1, totalAmountKgs: 4 });

    const [variantCost, baseCost, variantSnapshot, baseSnapshot] = await Promise.all([
      prisma.productCost.findUniqueOrThrow({
        where: costKey(org.id, product.id, variant.id),
      }),
      prisma.productCost.findUniqueOrThrow({ where: costKey(org.id, product.id) }),
      prisma.inventorySnapshot.findUniqueOrThrow({
        where: {
          storeId_productId_variantKey: {
            storeId: store.id,
            productId: product.id,
            variantKey: variant.id,
          },
        },
      }),
      prisma.inventorySnapshot.findUniqueOrThrow({
        where: {
          storeId_productId_variantKey: {
            storeId: store.id,
            productId: product.id,
            variantKey: "BASE",
          },
        },
      }),
    ]);
    expect({
      variant: {
        quantity: variantCost.costBasisQty,
        valueKgs: Number(variantCost.costBasisValueKgs),
      },
      base: {
        quantity: baseCost.costBasisQty,
        valueKgs: Number(baseCost.costBasisValueKgs),
      },
      onHand: [variantSnapshot.onHand, baseSnapshot.onHand],
    }).toEqual({
      variant: { quantity: 1, valueKgs: 4 },
      base: { quantity: 1, valueKgs: 7 },
      onHand: [1, 1],
    });
  });
});

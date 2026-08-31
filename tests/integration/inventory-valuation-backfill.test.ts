import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import {
  readInventoryValuationSnapshot,
  runInventoryValuationBackfill,
} from "@/server/services/inventoryValuationBackfill";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("bounded inventory valuation backfill", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("dry-runs, resumes after interruption, records review rows, and reruns idempotently", async () => {
    const { org, store, supplier, product, baseUnit } = await seedBase();
    const ambiguousProduct = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        sku: "BACKFILL-REVIEW",
        name: "Backfill Review Product",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
      },
    });
    await prisma.storeProduct.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: ambiguousProduct.id,
        isActive: true,
      },
    });
    await prisma.inventorySnapshot.createMany({
      data: [
        { storeId: store.id, productId: product.id, variantKey: "BASE", onHand: 8 },
        {
          storeId: store.id,
          productId: ambiguousProduct.id,
          variantKey: "BASE",
          onHand: 2,
        },
      ],
    });
    await prisma.productCost.createMany({
      data: [
        {
          organizationId: org.id,
          productId: product.id,
          variantKey: "BASE",
          avgCostKgs: 10,
          costBasisQty: 10,
        },
        {
          organizationId: org.id,
          productId: ambiguousProduct.id,
          variantKey: "BASE",
          avgCostKgs: 0,
          costBasisQty: 2,
        },
      ],
    });
    await prisma.stockMovement.createMany({
      data: [
        {
          id: "backfill-001-receive",
          storeId: store.id,
          productId: product.id,
          type: "RECEIVE",
          qtyDelta: 10,
          unitCostKgs: 10,
          lineTotalKgs: 100,
          referenceType: "STOCK_RECEIVING",
          referenceId: "backfill-receipt-1",
        },
        {
          id: "backfill-002-writeoff",
          storeId: store.id,
          productId: product.id,
          type: "WRITE_OFF",
          qtyDelta: -2,
          unitCostKgs: 10,
          lineTotalKgs: 20,
          referenceType: "WRITE_OFF",
          referenceId: "backfill-writeoff-1",
        },
        {
          id: "backfill-003-review",
          storeId: store.id,
          productId: ambiguousProduct.id,
          type: "ADJUSTMENT",
          qtyDelta: 2,
          note: "legacy adjustment without reliable accounting evidence",
        },
      ],
    });

    const before = await readInventoryValuationSnapshot(prisma, org.id);
    expect(before).toEqual({
      unclassifiedMovements: 3,
      reviewMovements: 0,
      unreconciledCostScopes: 2,
      reviewCostScopes: 0,
    });

    const dryRun = await runInventoryValuationBackfill(prisma, {
      runId: "release-dry-run",
      organizationId: org.id,
      batchSize: 3,
      dryRun: true,
      maxBatches: 1,
    });
    expect(dryRun).toMatchObject({
      mode: "DRY_RUN",
      scannedRows: 3,
      wouldUpdateRows: 2,
      wouldReviewRows: 1,
      changedRows: 0,
    });
    await expect(
      prisma.inventoryValuationBackfillRun.findUnique({ where: { id: "release-dry-run" } }),
    ).resolves.toBeNull();
    await expect(readInventoryValuationSnapshot(prisma, org.id)).resolves.toEqual(before);

    await expect(
      runInventoryValuationBackfill(prisma, {
        runId: "release-apply-without-drain",
        organizationId: org.id,
        batchSize: 1,
        dryRun: false,
        writerDrainEvidence: "isolated test has no running application writers",
      }),
    ).rejects.toThrow("BACKFILL_WRITER_DRAIN_CONFIRMATION_REQUIRED");

    const interrupted = await runInventoryValuationBackfill(prisma, {
      runId: "release-resumable",
      organizationId: org.id,
      batchSize: 1,
      dryRun: false,
      maxBatches: 1,
      writerDrainConfirmed: true,
      writerDrainEvidence: "isolated test has no running application writers",
    });
    expect(interrupted).toMatchObject({
      status: "RUNNING",
      phase: "MOVEMENTS",
      movement: { scanned: 1, updated: 1, review: 0 },
    });
    const interruptedRun = await prisma.inventoryValuationBackfillRun.findUniqueOrThrow({
      where: { id: "release-resumable" },
    });
    expect(
      Math.abs((interruptedRun.highWaterRecordedAt?.getTime() ?? 0) - Date.now()),
    ).toBeLessThan(60_000);

    const completed = await runInventoryValuationBackfill(prisma, {
      runId: "release-resumable",
      organizationId: org.id,
      batchSize: 1,
      dryRun: false,
      maxBatches: 20,
      writerDrainConfirmed: true,
      writerDrainEvidence: "isolated test has no running application writers",
    });
    expect(completed).toMatchObject({
      phase: "COMPLETE",
      movement: { scanned: 3, updated: 2, review: 1 },
      scopes: { scanned: 2, updated: 1, review: 1 },
    });

    const valuedCost = await prisma.productCost.findUniqueOrThrow({
      where: {
        organizationId_productId_variantKey: {
          organizationId: org.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });
    expect({
      preciseAverage: valuedCost.preciseAvgCostKgs?.toNumber(),
      preciseQuantity: valuedCost.preciseCostBasisQty,
      preciseValue: valuedCost.costBasisValueKgs?.toNumber(),
      status: valuedCost.valuationStatus,
    }).toEqual({
      preciseAverage: 10,
      preciseQuantity: 8,
      preciseValue: 80,
      status: "PRECISE",
    });
    await expect(
      prisma.stockMovement.findUniqueOrThrow({ where: { id: "backfill-003-review" } }),
    ).resolves.toMatchObject({
      inventoryValueDeltaKgs: null,
      inventoryValueStatus: "REVIEW_REQUIRED",
      inventoryValueReason: "UNSUPPORTED_MOVEMENT_EVIDENCE",
    });
    await expect(
      prisma.inventoryValuationBackfillIssue.count({
        where: { runId: "release-resumable" },
      }),
    ).resolves.toBe(2);

    const completedRunBeforeReplay = await prisma.inventoryValuationBackfillRun.findUniqueOrThrow({
      where: { id: "release-resumable" },
    });
    const replay = await runInventoryValuationBackfill(prisma, {
      runId: "release-resumable",
      organizationId: org.id,
      batchSize: 1,
      dryRun: false,
      writerDrainConfirmed: true,
      writerDrainEvidence: "isolated test has no running application writers",
    });
    const completedRunAfterReplay = await prisma.inventoryValuationBackfillRun.findUniqueOrThrow({
      where: { id: "release-resumable" },
    });
    expect(replay).toMatchObject({ phase: "COMPLETE" });
    expect(completedRunAfterReplay.batchCount).toBe(completedRunBeforeReplay.batchCount);
    expect(completedRunAfterReplay.updatedRows).toBe(completedRunBeforeReplay.updatedRows);

    const secondRun = await runInventoryValuationBackfill(prisma, {
      runId: "release-second-run",
      organizationId: org.id,
      batchSize: 2,
      dryRun: false,
      maxBatches: 20,
      writerDrainConfirmed: true,
      writerDrainEvidence: "isolated test has no running application writers",
    });
    expect(secondRun).toMatchObject({
      phase: "COMPLETE",
      movement: { scanned: 0, updated: 0, review: 0 },
      scopes: { updated: 0 },
    });
    const valuedCostAfterSecondRun = await prisma.productCost.findUniqueOrThrow({
      where: { id: valuedCost.id },
    });
    expect(valuedCostAfterSecondRun.costBasisValueKgs?.toNumber()).toBe(80);
    expect(valuedCostAfterSecondRun.preciseCostBasisQty).toBe(8);
  });

  it("fully reconciles a deterministic legacy receipt scope and makes a second run a zero-change replay", async () => {
    const { org, store, product } = await seedBase();
    await prisma.inventorySnapshot.create({
      data: { storeId: store.id, productId: product.id, variantKey: "BASE", onHand: 3 },
    });
    await prisma.productCost.create({
      data: {
        organizationId: org.id,
        productId: product.id,
        variantKey: "BASE",
        avgCostKgs: 10,
        costBasisQty: 3,
      },
    });
    await prisma.stockMovement.create({
      data: {
        id: "backfill-clean-receive",
        storeId: store.id,
        productId: product.id,
        type: "RECEIVE",
        qtyDelta: 3,
        unitCostKgs: 10,
        lineTotalKgs: 30,
        referenceType: "STOCK_RECEIVING",
        referenceId: "backfill-clean-receipt",
      },
    });

    const completed = await runInventoryValuationBackfill(prisma, {
      runId: "release-clean-reconciliation",
      organizationId: org.id,
      batchSize: 1,
      dryRun: false,
      maxBatches: 20,
      writerDrainConfirmed: true,
      writerDrainEvidence: "isolated deterministic fixture has no running writers",
    });
    expect(completed).toMatchObject({
      status: "COMPLETED",
      phase: "COMPLETE",
      movement: { scanned: 1, updated: 1, review: 0 },
      scopes: { scanned: 1, updated: 1, review: 0 },
      after: {
        unclassifiedMovements: 0,
        reviewMovements: 0,
        unreconciledCostScopes: 0,
        reviewCostScopes: 0,
      },
    });
    await expect(
      prisma.productCost.findUniqueOrThrow({
        where: {
          organizationId_productId_variantKey: {
            organizationId: org.id,
            productId: product.id,
            variantKey: "BASE",
          },
        },
      }),
    ).resolves.toMatchObject({
      preciseCostBasisQty: 3,
      valuationStatus: "PRECISE",
    });

    const secondRun = await runInventoryValuationBackfill(prisma, {
      runId: "release-clean-reconciliation-replay",
      organizationId: org.id,
      batchSize: 1,
      dryRun: false,
      maxBatches: 20,
      writerDrainConfirmed: true,
      writerDrainEvidence: "isolated deterministic fixture has no running writers",
    });
    expect(secondRun).toMatchObject({
      status: "COMPLETED",
      phase: "COMPLETE",
      movement: { scanned: 0, updated: 0, review: 0 },
      scopes: { updated: 0, review: 0 },
      after: {
        unclassifiedMovements: 0,
        reviewMovements: 0,
        unreconciledCostScopes: 0,
        reviewCostScopes: 0,
      },
    });
  });

  it("requires an exact same-organization transfer pair before valuing either side", async () => {
    const { org, store, product } = await seedBase();
    const destination = await prisma.store.create({
      data: { organizationId: org.id, name: "Transfer Destination", code: "DST" },
    });
    await prisma.inventorySnapshot.createMany({
      data: [
        { storeId: store.id, productId: product.id, variantKey: "BASE", onHand: 0 },
        { storeId: destination.id, productId: product.id, variantKey: "BASE", onHand: 0 },
      ],
    });
    await prisma.productCost.create({
      data: {
        organizationId: org.id,
        productId: product.id,
        variantKey: "BASE",
        avgCostKgs: 9,
        costBasisQty: 0,
      },
    });
    await prisma.stockMovement.createMany({
      data: [
        {
          id: "transfer-pair-out",
          storeId: store.id,
          productId: product.id,
          type: "TRANSFER_OUT",
          qtyDelta: -2,
          linePosition: 0,
          lineTotalKgs: 18,
          inventoryValueDeltaKgs: -18,
          referenceType: "TRANSFER",
          referenceId: "transfer-pair",
        },
        {
          id: "transfer-pair-in",
          storeId: destination.id,
          productId: product.id,
          type: "TRANSFER_IN",
          qtyDelta: 2,
          linePosition: 0,
          lineTotalKgs: 18,
          referenceType: "TRANSFER",
          referenceId: "transfer-pair",
        },
        {
          id: "transfer-orphan-in",
          storeId: destination.id,
          productId: product.id,
          type: "TRANSFER_IN",
          qtyDelta: 1,
          linePosition: 1,
          lineTotalKgs: 9,
          referenceType: "TRANSFER",
          referenceId: "transfer-orphan",
        },
      ],
    });

    const result = await runInventoryValuationBackfill(prisma, {
      runId: "release-transfer-pairing",
      organizationId: org.id,
      batchSize: 1,
      maxBatches: 20,
      dryRun: false,
      writerDrainConfirmed: true,
      writerDrainEvidence: "isolated test has no running application writers",
    });
    expect(result).toMatchObject({
      phase: "COMPLETE",
      movement: { scanned: 3, updated: 2, review: 1 },
      status: "COMPLETED_WITH_REVIEW",
    });
    const rows = await prisma.stockMovement.findMany({
      where: { id: { in: ["transfer-pair-out", "transfer-pair-in", "transfer-orphan-in"] } },
      orderBy: { id: "asc" },
    });
    expect(
      Object.fromEntries(
        rows.map((row) => [
          row.id,
          {
            value: row.inventoryValueDeltaKgs?.toFixed(6) ?? null,
            status: row.inventoryValueStatus,
          },
        ]),
      ),
    ).toEqual({
      "transfer-orphan-in": { value: null, status: "REVIEW_REQUIRED" },
      "transfer-pair-in": { value: "18.000000", status: "LEGACY_EVIDENCE" },
      "transfer-pair-out": { value: "-18.000000", status: "LEGACY_EVIDENCE" },
    });
  });

  it("fails closed when an unvalued old-writer row appears beyond the captured high-water", async () => {
    const { org, store, product } = await seedBase();
    await prisma.inventorySnapshot.create({
      data: { storeId: store.id, productId: product.id, variantKey: "BASE", onHand: 1 },
    });
    await prisma.productCost.create({
      data: {
        organizationId: org.id,
        productId: product.id,
        variantKey: "BASE",
        avgCostKgs: 10,
        costBasisQty: 1,
      },
    });
    await prisma.stockMovement.create({
      data: {
        id: "high-water-initial",
        storeId: store.id,
        productId: product.id,
        type: "RECEIVE",
        qtyDelta: 1,
        unitCostKgs: 10,
        lineTotalKgs: 10,
        referenceType: "STOCK_RECEIVING",
      },
    });
    await runInventoryValuationBackfill(prisma, {
      runId: "release-high-water",
      organizationId: org.id,
      batchSize: 1,
      maxBatches: 1,
      dryRun: false,
      writerDrainConfirmed: true,
      writerDrainEvidence: "isolated test has no running application writers",
    });
    const run = await prisma.inventoryValuationBackfillRun.findUniqueOrThrow({
      where: { id: "release-high-water" },
    });
    await prisma.stockMovement.create({
      data: {
        id: "high-water-rogue-old-writer",
        storeId: store.id,
        productId: product.id,
        type: "ADJUSTMENT",
        qtyDelta: 0,
        ledgerRecordedAt: new Date(run.highWaterRecordedAt!.getTime() + 1_000),
      },
    });

    const completed = await runInventoryValuationBackfill(prisma, {
      runId: "release-high-water",
      organizationId: org.id,
      batchSize: 1,
      maxBatches: 20,
      dryRun: false,
      writerDrainConfirmed: true,
      writerDrainEvidence: "isolated test has no running application writers",
    });
    expect(completed).toMatchObject({
      phase: "COMPLETE",
      status: "COMPLETED_WITH_REVIEW",
      after: { unclassifiedMovements: 1 },
    });
    await expect(
      prisma.stockMovement.findUniqueOrThrow({ where: { id: "high-water-rogue-old-writer" } }),
    ).resolves.toMatchObject({ inventoryValueStatus: null, inventoryValueDeltaKgs: null });
  });
});

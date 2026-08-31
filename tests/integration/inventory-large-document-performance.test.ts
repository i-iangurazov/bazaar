import { beforeEach, describe, expect, it } from "vitest";
import { StockMovementType } from "@prisma/client";

import { prisma } from "@/server/db/prisma";

import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("large inventory document journals", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns the first page without repeatedly aggregating 5,000 documents", async () => {
    const { org, store, product, adminUser } = await seedBase({ plan: "BUSINESS" });
    const baseTime = Date.UTC(2026, 7, 1, 0, 0, 0);

    await prisma.stockMovement.createMany({
      data: Array.from({ length: 5_000 }, (_, index) => ({
        storeId: store.id,
        productId: product.id,
        type: StockMovementType.RECEIVE,
        qtyDelta: 1,
        linePosition: 0,
        unitCostKgs: 10,
        lineTotalKgs: 10,
        inventoryValueDeltaKgs: 10,
        referenceType: "STOCK_RECEIVING",
        referenceId: `large-receiving-${String(index).padStart(5, "0")}`,
        note: `Large receiving ${index}`,
        createdAt: new Date(baseTime + index * 1_000),
        createdById: adminUser.id,
      })),
    });

    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });
    const startedAt = performance.now();
    const result = await caller.inventory.productMovements({ page: 1, pageSize: 25 });
    const durationMs = Math.round(performance.now() - startedAt);
    const allStartedAt = performance.now();
    const allResult = await caller.inventory.productMovements({
      archiveMode: "ALL",
      page: 1,
      pageSize: 25,
    });
    const allDurationMs = Math.round(performance.now() - allStartedAt);
    const typeStartedAt = performance.now();
    const typeResult = await caller.inventory.productMovements({
      type: "STOCK_RECEIVING",
      page: 1,
      pageSize: 25,
    });
    const typeDurationMs = Math.round(performance.now() - typeStartedAt);
    const concurrentStartedAt = performance.now();
    const concurrentPages = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        caller.inventory.productMovements({ page: index + 1, pageSize: 25 }),
      ),
    );
    const concurrentDurationMs = Math.round(performance.now() - concurrentStartedAt);

    console.info(
      `[INVENTORY-LARGE-DOCUMENTS] ${JSON.stringify({
        documents: 5_000,
        returned: result.items.length,
        total: result.total,
        durationMs,
        allDurationMs,
        typeDurationMs,
        concurrentDurationMs,
      })}`,
    );
    expect(result.total).toBe(5_000);
    expect(result.items).toHaveLength(25);
    expect(result.items[0]?.documentId).toBe("large-receiving-04999");
    expect(allResult.total).toBe(5_000);
    expect(typeResult.total).toBe(5_000);
    expect(concurrentPages.every((item) => item.total === 5_000)).toBe(true);
    expect(concurrentPages.every((item) => item.items.length === 25)).toBe(true);
    expect(durationMs).toBeLessThan(2_500);
    expect(allDurationMs).toBeLessThan(2_500);
    expect(typeDurationMs).toBeLessThan(2_500);
    expect(concurrentDurationMs).toBeLessThan(2_500);
  }, 120_000);
});

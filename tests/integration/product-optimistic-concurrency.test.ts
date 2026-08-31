import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { updateProduct } from "@/server/services/products";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("product optimistic concurrency", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("allows one writer for a loaded revision and rolls the stale writer back", async () => {
    const { org, product, adminUser, baseUnit } = await seedBase();
    const loadedRevision = new Date("2025-01-01T00:00:00.000Z");
    await prisma.product.update({
      where: { id: product.id },
      data: { updatedAt: loadedRevision },
    });

    const update = (name: string, requestId: string) =>
      updateProduct({
        productId: product.id,
        expectedUpdatedAt: loadedRevision,
        organizationId: org.id,
        actorId: adminUser.id,
        requestId,
        sku: product.sku,
        name,
        baseUnitId: baseUnit.id,
        barcodes: [],
      });

    const results = await Promise.allSettled([
      update("Concurrent Winner A", "product-concurrency-a"),
      update("Concurrent Winner B", "product-concurrency-b"),
    ]);
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof update>>> =>
        result.status === "fulfilled",
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ message: "productStaleUpdate", status: 409 });

    const persisted = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(["Concurrent Winner A", "Concurrent Winner B"]).toContain(persisted.name);
    expect(persisted.name).toBe(fulfilled[0]?.value.name);
    expect(persisted.updatedAt.getTime()).not.toBe(loadedRevision.getTime());
    expect(
      await prisma.auditLog.count({
        where: { entity: "Product", entityId: product.id, action: "PRODUCT_UPDATE" },
      }),
    ).toBe(1);
  });
});

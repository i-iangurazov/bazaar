import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import {
  getShrinkageReport,
  getSlowMoversReport,
  getStockoutsReport,
} from "@/server/services/reports";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

(shouldRunDbTests ? describe : describe.skip)("legacy report UTC range binding", () => {
  beforeEach(resetDatabase);
  it.each(["UTC", "Asia/Bishkek", "Asia/Shanghai"])(
    "preserves both Bishkek day edges with database TimeZone %s",
    async (databaseTimeZone) => {
      const f = await seedBase({ plan: "BUSINESS" });
      const from = new Date("2026-07-21T18:00:00.000Z");
      const to = new Date("2026-07-22T17:59:59.999Z");
      const before = new Date(from.getTime() - 1),
        after = new Date(to.getTime() + 1);
      const inside = new Date("2026-07-21T19:30:00.000Z");
      const createProduct = async (sku: string, onHand: number) => {
        const product = await prisma.product.create({
          data: {
            organizationId: f.org.id,
            sku,
            name: sku,
            unit: f.baseUnit.code,
            baseUnitId: f.baseUnit.id,
          },
        });
        await prisma.inventorySnapshot.create({
          data: { storeId: f.store.id, productId: product.id, onHand },
        });
        return product;
      };
      const out = await createProduct("TZ-OUT", 1);
      const idle = await createProduct("TZ-IDLE", 6);
      const active = await createProduct("TZ-ACTIVE", 1);
      await prisma.inventorySnapshot.create({
        data: { storeId: f.store.id, productId: f.product.id, onHand: 95 },
      });
      for (const createdAt of [before, from, inside, to, after]) {
        await prisma.stockMovement.create({
          data: {
            storeId: f.store.id,
            productId: f.product.id,
            createdAt,
            type: "WRITE_OFF",
            referenceType: "WRITE_OFF",
            qtyDelta: -1,
            createdById: f.adminUser.id,
          },
        });
      }
      for (const [productId, movements] of [
        [
          out.id,
          [
            [before, 2],
            [from, -2],
            [inside, 1],
            [to, -1],
            [after, 1],
          ],
        ],
        [
          idle.id,
          [
            [before, 5],
            [after, 1],
          ],
        ],
        [active.id, [[from, 1]]],
      ] as Array<[string, Array<[Date, number]>]>) {
        for (const [createdAt, qtyDelta] of movements)
          await prisma.stockMovement.create({
            data: {
              storeId: f.store.id,
              productId,
              createdAt,
              type: "ADJUSTMENT",
              referenceType: "TIMEZONE_FIXTURE",
              qtyDelta,
            },
          });
      }
      const previous = process.env.TZ;
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('TimeZone', ${databaseTimeZone}, true)`;
          for (const runtimeTimeZone of ["UTC", "Asia/Bishkek", "Asia/Shanghai"]) {
            process.env.TZ = runtimeTimeZone;
            const input = { organizationId: f.org.id, storeId: f.store.id, from, to, pageSize: 10 };
            const shrinkage = await getShrinkageReport(input, tx);
            expect(shrinkage.items).toHaveLength(1);
            expect(shrinkage.items[0]).toMatchObject({
              productId: f.product.id,
              totalQty: 3,
              movementCount: 3,
            });
            const stockouts = await getStockoutsReport(input, tx);
            expect(stockouts.items).toHaveLength(1);
            expect(stockouts.items[0]).toMatchObject({ productId: out.id, count: 2, onHand: 1 });
            expect(stockouts.items[0].lastAt?.toISOString()).toBe(to.toISOString());
            const slow = await getSlowMoversReport(input, tx);
            expect(slow.items).toHaveLength(1);
            expect(slow.items[0]).toMatchObject({ productId: idle.id, onHand: 6 });
            expect(slow.items[0].lastMovementAt?.toISOString()).toBe(before.toISOString());
            for (const report of [getShrinkageReport, getStockoutsReport, getSlowMoversReport]) {
              expect(await report({ ...input, page: 2 }, tx)).toMatchObject({
                items: [],
                total: 1,
                page: 2,
              });
            }
          }
        });
      } finally {
        if (previous === undefined) delete process.env.TZ;
        else process.env.TZ = previous;
      }
    },
  );
});

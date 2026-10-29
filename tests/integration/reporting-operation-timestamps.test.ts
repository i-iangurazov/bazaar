import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { formatDateTime } from "@/lib/i18nFormat";
import { getOperationsReport } from "@/server/services/reporting/operations";
import { resetDatabase, shouldRunDbTests } from "../helpers/db";
import { seedReportingFixture } from "../helpers/reportingFixture";

(shouldRunDbTests ? describe : describe.skip)("operational report timestamp transport", () => {
  beforeEach(resetDatabase);

  it.each(["UTC", "Asia/Bishkek", "Asia/Shanghai"])(
    "retains the source instant and business date with database TimeZone %s",
    async (databaseTimeZone) => {
      const f = await seedReportingFixture(prisma);
      // The UTC instant is on the previous date; the merchant sees 26 Oct, 05:30.
      const instant = new Date("2026-10-25T23:30:10.456Z");
      await prisma.cashDrawerMovement.create({ data: {
        organizationId: f.org.id, storeId: f.store.id, shiftId: f.shift.id,
        type: "PAY_IN", amountKgs: 5, reason: "Timestamp fixture", createdAt: instant,
      } });
      await prisma.salePayment.create({ data: {
        organizationId: f.org.id, storeId: f.store.id, shiftId: f.shift.id,
        customerOrderId: f.sale.id, method: "CASH", amountKgs: 5, createdAt: instant,
      } });
      await prisma.stockMovement.create({ data: {
        storeId: f.store.id, productId: f.tea.id, type: "RECEIVE", qtyDelta: 3,
        unitCostKgs: 2, lineTotalKgs: 6, referenceType: "STOCK_RECEIVING", createdAt: instant,
      } });
      await prisma.inventorySnapshot.create({ data: {
        storeId: f.store.id, productId: f.tea.id, onHand: 3, updatedAt: instant,
      } });
      const input = { ...f.input, dateFrom: "2026-10-26", dateTo: "2026-10-26" };
      const now = new Date("2026-10-26T06:00:00Z");
      const originalRuntimeTimeZone = process.env.TZ;
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE '${databaseTimeZone}'`);
          for (const runtimeTimeZone of ["UTC", "Asia/Bishkek", "Asia/Shanghai"]) {
            process.env.TZ = runtimeTimeZone;
            for (const view of ["cash", "payments", "movements", "receipts", "suppliers", "stock"] as const) {
              const report = await getOperationsReport(tx, { ...input, view }, { now });
              const exported = await getOperationsReport(tx, { ...input, view }, { now, exportAll: true });
              expect(report.items).toHaveLength(1);
              expect(exported.items).toHaveLength(1);
              for (const row of [report.items[0], exported.items[0]]) {
                expect(formatDateTime(row.date!, "ru"), `${view} / ${runtimeTimeZone}`).toBe(
                  formatDateTime(instant, "ru"),
                );
                expect(new Date(row.date!).toISOString()).toBe(instant.toISOString());
              }
              expect(exported.summary).toEqual(report.summary);
            }
          }
        });
      } finally {
        if (originalRuntimeTimeZone === undefined) delete process.env.TZ;
        else process.env.TZ = originalRuntimeTimeZone;
      }
    },
  );
});

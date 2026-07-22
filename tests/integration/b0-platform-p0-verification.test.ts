import { ExportType, Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db/prisma";
import { runJob } from "@/server/jobs";
import { resolveExportJobDownload } from "@/server/services/exports";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const callerFor = (user: {
  id: string;
  email: string;
  role: "ADMIN" | "MANAGER" | "STAFF" | "CASHIER";
  organizationId: string | null;
  isOrgOwner?: boolean;
}) => {
  if (!user.organizationId) {
    throw new Error("seeded user is missing organizationId");
  }
  return createTestCaller({
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    isOrgOwner: user.isOrgOwner,
  });
};

describeDb("B0 Agent 4 P0 runtime verification", () => {
  beforeEach(async () => {
    vi.useRealTimers();
    await resetDatabase();
  });

  it("A4-001: lower-privilege callers can invoke dashboard and analytics procedures", async () => {
    const { store, staffUser, cashierUser } = await seedBase({ plan: "BUSINESS" });
    const staffCaller = callerFor(staffUser);
    const cashierCaller = callerFor(cashierUser);

    await expect(
      cashierCaller.dashboard.summary({
        storeId: store.id,
        includeRecentActivity: false,
        includeRecentMovements: false,
      }),
    ).resolves.toMatchObject({ business: expect.any(Object) });
    await expect(
      staffCaller.analytics.salesTrend({ rangeDays: 30, granularity: "day" }),
    ).resolves.toMatchObject({ series: expect.any(Array) });
  });

  it("A4-002: cashier billing response contains upgrade messages and review notes", async () => {
    const { org, adminUser, cashierUser } = await seedBase({ plan: "BUSINESS" });
    await prisma.planUpgradeRequest.create({
      data: {
        organizationId: org.id,
        requestedById: adminUser.id,
        currentPlan: "BUSINESS",
        requestedPlan: "ENTERPRISE",
        status: "REJECTED",
        message: "Private commercial context",
        reviewNote: "Private platform review note",
        reviewedAt: new Date(),
        reviewedById: adminUser.id,
      },
    });

    const result = await callerFor(cashierUser).billing.get();

    expect(result?.upgradeRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "Private commercial context",
          reviewNote: "Private platform review note",
        }),
      ]),
    );
  });

  it("A4-003: cashier can list and read export job metadata", async () => {
    const { org, store, adminUser, cashierUser } = await seedBase({ plan: "BUSINESS" });
    const exportJob = await callerFor(adminUser).exports.create({
      storeId: store.id,
      type: ExportType.RECEIPTS_REGISTRY,
      format: "csv",
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      periodEnd: new Date("2026-07-21T23:59:59.999Z"),
    });
    await runJob("export-job", { jobId: exportJob.id });
    const cashierCaller = callerFor(cashierUser);

    await expect(cashierCaller.exports.list()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: exportJob.id })]),
    );
    await expect(cashierCaller.exports.get({ jobId: exportJob.id })).resolves.toMatchObject({
      id: exportJob.id,
      status: "DONE",
      downloadAvailable: true,
    });
    const download = await resolveExportJobDownload({
      organizationId: org.id,
      jobId: exportJob.id,
      user: {
        id: cashierUser.id,
        organizationId: org.id,
        role: cashierUser.role,
        isOrgOwner: false,
        isPlatformOwner: false,
      },
    });
    const chunks: Buffer[] = [];
    for await (const chunk of download.stream) {
      chunks.push(Buffer.from(chunk));
    }
    const exportedReceipts = Buffer.concat(chunks).toString("utf8");
    expect(download.fileName).toMatch(/^receipts-registry-.*\.csv$/);
    expect(exportedReceipts).toContain("Номер чека");
  });

  it("A4-004: global search returns a store result to a cashier without store-list permission", async () => {
    const { store, cashierUser } = await seedBase({ plan: "BUSINESS" });
    await prisma.store.update({
      where: { id: store.id },
      data: { code: "SECRET-STORE-77", name: "Restricted Store Metadata" },
    });

    const result = await callerFor(cashierUser).search.global({ q: "SECRET-STORE-77" });

    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: store.id,
          type: "store",
          label: "Restricted Store Metadata",
        }),
      ]),
    );
  });

  it("A4-006: manager can close an unassigned store in the same organization", async () => {
    const { org, managerUser } = await seedBase({ plan: "BUSINESS" });
    const unassignedStore = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Unassigned Store",
        code: "UNASSIGNED",
      },
    });
    const periodStart = new Date("2026-06-01T00:00:00.000Z");
    const periodEnd = new Date("2026-06-30T23:59:59.999Z");

    const result = await callerFor(managerUser).periodClose.close({
      storeId: unassignedStore.id,
      periodStart,
      periodEnd,
    });

    expect(result.storeId).toBe(unassignedStore.id);
    await expect(
      prisma.periodClose.findUnique({
        where: {
          organizationId_storeId_periodStart_periodEnd: {
            organizationId: org.id,
            storeId: unassignedStore.id,
            periodStart,
            periodEnd,
          },
        },
      }),
    ).resolves.toMatchObject({ closedById: managerUser.id });
  });

  it("A4-007: period-close KGS totals contain quantities instead of movement money", async () => {
    const { store, product, managerUser } = await seedBase({ plan: "BUSINESS" });
    const periodStart = new Date("2026-06-01T00:00:00.000Z");
    const periodEnd = new Date("2026-06-30T23:59:59.999Z");
    await prisma.stockMovement.createMany({
      data: [
        {
          storeId: store.id,
          productId: product.id,
          type: "SALE",
          qtyDelta: -2,
          unitCostKgs: new Prisma.Decimal(300),
          lineTotalKgs: new Prisma.Decimal(600),
          createdAt: new Date("2026-06-10T08:00:00.000Z"),
        },
        {
          storeId: store.id,
          productId: product.id,
          type: "RECEIVE",
          qtyDelta: 5,
          unitCostKgs: new Prisma.Decimal(200),
          lineTotalKgs: new Prisma.Decimal(1000),
          createdAt: new Date("2026-06-11T08:00:00.000Z"),
        },
      ],
    });

    const result = await callerFor(managerUser).periodClose.close({
      storeId: store.id,
      periodStart,
      periodEnd,
    });

    expect(result.totals).toMatchObject({
      salesTotalKgs: 2,
      purchasesTotalKgs: 5,
    });
    expect(result.totals).not.toMatchObject({
      salesTotalKgs: 600,
      purchasesTotalKgs: 1000,
    });
  });

  it("A4-008: dashboard excludes a current Bishkek business-day sale before UTC midnight", async () => {
    const previousTimeZone = process.env.TZ;
    process.env.TZ = "UTC";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T06:00:00.000Z"));

    try {
      const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
      await prisma.customerOrder.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          number: "BISHKEK-DAY-001",
          status: "COMPLETED",
          source: "MANUAL",
          subtotalKgs: new Prisma.Decimal(900),
          totalKgs: new Prisma.Decimal(900),
          completedAt: new Date("2026-07-21T19:30:00.000Z"),
          createdById: adminUser.id,
        },
      });

      const result = await callerFor(adminUser).dashboard.summary({
        storeId: store.id,
        includeRecentActivity: false,
        includeRecentMovements: false,
      });

      expect(result.business.todaySalesKgs).toBe(0);
    } finally {
      vi.useRealTimers();
      process.env.TZ = previousTimeZone;
    }
  });

  it("A4-009: organization admin can see and resolve a global dead-letter job", async () => {
    const { adminUser } = await seedBase({ plan: "BUSINESS" });
    const globalJob = await prisma.deadLetterJob.create({
      data: {
        organizationId: null,
        jobName: "global-provider-job",
        payload: { secretReference: "provider-account-7" },
        attempts: 3,
        lastError: "Provider rejected global credential",
      },
    });
    const adminCaller = callerFor(adminUser);

    await expect(adminCaller.adminJobs.list()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: globalJob.id })]),
    );
    await expect(adminCaller.adminJobs.resolve({ jobId: globalJob.id })).resolves.toMatchObject({
      id: globalJob.id,
      resolvedById: adminUser.id,
    });
  });
});

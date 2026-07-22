import { ExportType, Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db/prisma";
import { registerJobForTests, runJob } from "@/server/jobs";
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
  isPlatformOwner?: boolean;
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
    isPlatformOwner: user.isPlatformOwner,
  });
};

describeDb("B0 Agent 4 P0 runtime verification", () => {
  beforeEach(async () => {
    vi.useRealTimers();
    await resetDatabase();
  });

  it("A4-001: dashboard and analytics enforce the server-side report role", async () => {
    const { store, managerUser, staffUser, cashierUser } = await seedBase({ plan: "BUSINESS" });
    const managerCaller = callerFor(managerUser);
    const staffCaller = callerFor(staffUser);
    const cashierCaller = callerFor(cashierUser);

    await expect(
      managerCaller.dashboard.summary({
        storeId: store.id,
        includeRecentActivity: false,
        includeRecentMovements: false,
      }),
    ).resolves.toMatchObject({ business: expect.any(Object) });
    await expect(
      managerCaller.analytics.salesTrend({ rangeDays: 30, granularity: "day" }),
    ).resolves.toMatchObject({ series: expect.any(Array) });
    await expect(
      cashierCaller.dashboard.summary({
        storeId: store.id,
        includeRecentActivity: false,
        includeRecentMovements: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      staffCaller.analytics.salesTrend({ rangeDays: 30, granularity: "day" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("A4-002: only an admin can read billing and private upgrade notes", async () => {
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

    const result = await callerFor(adminUser).billing.get();

    expect(result?.upgradeRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "Private commercial context",
          reviewNote: "Private platform review note",
        }),
      ]),
    );
    await expect(callerFor(cashierUser).billing.get()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(callerFor(cashierUser).billing.features()).resolves.toMatchObject({
      plan: "BUSINESS",
      features: expect.any(Array),
      featureFlags: expect.any(Object),
    });
    const limitedSummary = await callerFor(cashierUser).billing.features();
    expect(limitedSummary).not.toHaveProperty("upgradeRequests");
    expect(JSON.stringify(limitedSummary)).not.toContain("Private commercial context");
    expect(JSON.stringify(limitedSummary)).not.toContain("Private platform review note");
  });

  it("A4-003: export metadata and download require report permission", async () => {
    const { org, store, adminUser, managerUser, cashierUser } = await seedBase({
      plan: "BUSINESS",
    });
    const exportJob = await callerFor(adminUser).exports.create({
      storeId: store.id,
      type: ExportType.RECEIPTS_REGISTRY,
      format: "csv",
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      periodEnd: new Date("2026-07-21T23:59:59.999Z"),
    });
    await runJob("export-job", { jobId: exportJob.id });
    const managerCaller = callerFor(managerUser);
    const cashierCaller = callerFor(cashierUser);

    await expect(managerCaller.exports.list()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: exportJob.id })]),
    );
    await expect(managerCaller.exports.get({ jobId: exportJob.id })).resolves.toMatchObject({
      id: exportJob.id,
      status: "DONE",
      downloadAvailable: true,
    });
    const download = await resolveExportJobDownload({
      organizationId: org.id,
      jobId: exportJob.id,
      user: {
        id: managerUser.id,
        organizationId: org.id,
        role: managerUser.role,
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
    await expect(cashierCaller.exports.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(cashierCaller.exports.get({ jobId: exportJob.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      resolveExportJobDownload({
        organizationId: org.id,
        jobId: exportJob.id,
        user: {
          id: cashierUser.id,
          organizationId: org.id,
          role: cashierUser.role,
          isOrgOwner: false,
          isPlatformOwner: false,
        },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("A4-004: global search filters result types by server-side permission", async () => {
    const { store, managerUser, cashierUser } = await seedBase({ plan: "BUSINESS" });
    await prisma.store.update({
      where: { id: store.id },
      data: { code: "SECRET-STORE-77", name: "Restricted Store Metadata" },
    });

    const managerResult = await callerFor(managerUser).search.global({ q: "SECRET-STORE-77" });
    const cashierResult = await callerFor(cashierUser).search.global({ q: "SECRET-STORE-77" });

    expect(managerResult.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: store.id,
          type: "store",
          label: "Restricted Store Metadata",
        }),
      ]),
    );
    expect(cashierResult.results).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: store.id, type: "store" })]),
    );
  });

  it("A4-006: period close rejects same-org unassigned and cross-org stores without writes", async () => {
    const { org, store, managerUser } = await seedBase({ plan: "BUSINESS" });
    const unassignedStore = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Unassigned Store",
        code: "UNASSIGNED",
      },
    });
    const periodStart = new Date("2026-06-01T00:00:00.000Z");
    const periodEnd = new Date("2026-06-30T23:59:59.999Z");

    const caller = callerFor(managerUser);
    const result = await caller.periodClose.close({
      storeId: store.id,
      periodStart,
      periodEnd,
    });
    const unassignedClose = await prisma.periodClose.create({
      data: {
        organizationId: org.id,
        storeId: unassignedStore.id,
        periodStart,
        periodEnd,
        closedById: managerUser.id,
      },
    });

    expect(result.storeId).toBe(store.id);
    await expect(caller.periodClose.list({ storeId: store.id })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: result.id, storeId: store.id })]),
    );
    await expect(caller.periodClose.list()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: unassignedClose.id })]),
    );
    await expect(caller.periodClose.list({ storeId: unassignedStore.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller.periodClose.close({
        storeId: unassignedStore.id,
        periodStart,
        periodEnd,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const otherOrg = await prisma.organization.create({ data: { name: "Other Org" } });
    const otherStore = await prisma.store.create({
      data: { organizationId: otherOrg.id, name: "Other Store", code: "OTHER" },
    });
    await expect(
      caller.periodClose.close({ storeId: otherStore.id, periodStart, periodEnd }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      prisma.periodClose.count({
        where: { storeId: { in: [unassignedStore.id, otherStore.id] } },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.periodClose.findMany({
        where: { storeId: { in: [unassignedStore.id, otherStore.id] } },
        select: { id: true },
      }),
    ).resolves.toEqual([{ id: unassignedClose.id }]);
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
      if (previousTimeZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimeZone;
      }
    }
  });

  it("A4-009: tenant admins cannot list or mutate global/cross-org dead-letter jobs", async () => {
    const { org, adminUser } = await seedBase({ plan: "BUSINESS" });
    const tenantJob = await prisma.deadLetterJob.create({
      data: {
        organizationId: org.id,
        jobName: "tenant-job",
        payload: { safeReference: "tenant-7" },
        attempts: 1,
        lastError: "Tenant failure",
      },
    });
    const globalJob = await prisma.deadLetterJob.create({
      data: {
        organizationId: null,
        jobName: "global-provider-job",
        payload: { secretReference: "provider-account-7" },
        attempts: 3,
        lastError: "Provider rejected global credential",
      },
    });
    const globalResolveJob = await prisma.deadLetterJob.create({
      data: {
        organizationId: null,
        jobName: "global-resolve-job",
        payload: { secretReference: "provider-account-8" },
        attempts: 1,
        lastError: "Global operation needs review",
      },
    });
    const otherOrg = await prisma.organization.create({ data: { name: "Other Job Org" } });
    const otherJob = await prisma.deadLetterJob.create({
      data: {
        organizationId: otherOrg.id,
        jobName: "other-job",
        payload: { secretReference: "other-provider" },
        attempts: 2,
        lastError: "Other failure",
      },
    });
    const adminCaller = callerFor(adminUser);
    const platformCaller = callerFor({ ...adminUser, isPlatformOwner: true });
    let providerCalls = 0;
    registerJobForTests("global-provider-job", async () => {
      providerCalls += 1;
      return { job: "global-provider-job", status: "ok" };
    });

    const listed = await adminCaller.adminJobs.list();
    expect(listed).toEqual(expect.arrayContaining([expect.objectContaining({ id: tenantJob.id })]));
    expect(listed[0]).not.toHaveProperty("payload");
    expect(listed).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: globalJob.id }),
        expect.objectContaining({ id: otherJob.id }),
      ]),
    );
    await expect(adminCaller.adminJobs.resolve({ jobId: globalJob.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(adminCaller.adminJobs.retry({ jobId: globalJob.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(adminCaller.adminJobs.resolve({ jobId: otherJob.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(adminCaller.adminJobs.retry({ jobId: otherJob.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(adminCaller.adminJobs.list({ scope: "GLOBAL" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(providerCalls).toBe(0);
    await expect(
      prisma.auditLog.count({
        where: { action: { in: ["JOB_RETRY", "JOB_RETRY_FAILED", "JOB_RESOLVE"] } },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.deadLetterJob.findMany({ where: { id: { in: [globalJob.id, otherJob.id] } } }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: globalJob.id, resolvedAt: null, resolvedById: null }),
        expect.objectContaining({ id: otherJob.id, resolvedAt: null, resolvedById: null }),
      ]),
    );

    await expect(adminCaller.adminJobs.resolve({ jobId: tenantJob.id })).resolves.toMatchObject({
      id: tenantJob.id,
      resolvedById: adminUser.id,
    });
    const globalJobs = await platformCaller.adminJobs.list({ scope: "GLOBAL" });
    expect(globalJobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: globalJob.id }),
        expect.objectContaining({ id: globalResolveJob.id }),
      ]),
    );
    expect(globalJobs.every((job) => !("payload" in job))).toBe(true);
    await expect(
      platformCaller.adminJobs.retry({ jobId: globalJob.id, scope: "GLOBAL" }),
    ).resolves.toMatchObject({ status: "resolved" });
    await expect(
      platformCaller.adminJobs.resolve({ jobId: globalResolveJob.id, scope: "GLOBAL" }),
    ).resolves.toMatchObject({ id: globalResolveJob.id, resolvedById: adminUser.id });
    expect(providerCalls).toBe(1);
  });
});

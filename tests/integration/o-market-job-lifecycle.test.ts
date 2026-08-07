import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OMarketExportJobStatus,
  OMarketJobType,
  OMarketLastSyncStatus,
} from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import {
  requestOMarketExport,
  runOMarketExportJob,
  updateOMarketProductSelection,
  updateOMarketSettings,
  updateOMarketStoreMappings,
} from "@/server/services/oMarket";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("O! Market durable job lifecycle", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.stubEnv("O_MARKET_MOCK_API", "1");
    vi.stubEnv("O_MARKET_TOKEN_ENCRYPTION_KEY", "o-market-job-test-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("records a ready-only export as completed with errors and keeps its report", async () => {
    const { org, store, product, adminUser, supplier, baseUnit } = await seedBase();
    await prisma.product.update({
      where: { id: product.id },
      data: { sku: "O-READY-1", basePriceKgs: 1_200 },
    });
    await prisma.inventorySnapshot.create({
      data: {
        storeId: store.id,
        productId: product.id,
        variantKey: "BASE",
        onHand: 4,
        onOrder: 0,
        allowNegativeStock: false,
      },
    });
    const brokenProduct = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        sku: "O-BROKEN-1",
        name: "Missing price",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
      },
    });
    await prisma.storeProduct.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: brokenProduct.id,
        isActive: true,
      },
    });
    await prisma.inventorySnapshot.create({
      data: {
        storeId: store.id,
        productId: brokenProduct.id,
        variantKey: "BASE",
        onHand: 2,
        onOrder: 0,
        allowNegativeStock: false,
      },
    });
    await updateOMarketSettings({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "o-settings",
      apiToken: "mock-token",
    });
    await updateOMarketStoreMappings({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "o-store-mapping",
      mappings: [{ storeId: store.id, locationId: "101" }],
    });
    await updateOMarketProductSelection({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "o-selection",
      productIds: [product.id, brokenProduct.id],
      included: true,
    });

    const requested = await requestOMarketExport({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "o-ready-only",
      jobType: OMarketJobType.STOCK_PRICE_SYNC,
      mode: "READY_ONLY",
    });
    const result = await runOMarketExportJob({ jobId: requested.job.id });
    const [job, integration] = await Promise.all([
      prisma.oMarketExportJob.findUniqueOrThrow({ where: { id: requested.job.id } }),
      prisma.oMarketIntegration.findUniqueOrThrow({ where: { orgId: org.id } }),
    ]);

    expect(result.status).toBe("ok");
    expect(job.status).toBe(OMarketExportJobStatus.COMPLETED_WITH_ERRORS);
    expect(job.succeededCount).toBe(1);
    expect(job.failedCount).toBe(0);
    expect(job.skippedCount).toBe(1);
    expect(job.errorReportJson).not.toBeNull();
    expect(integration.lastSyncStatus).toBe(OMarketLastSyncStatus.COMPLETED_WITH_ERRORS);
  });

  it("times out stale queued work before any provider call", async () => {
    const { org, store, adminUser } = await seedBase();
    const stale = await prisma.oMarketExportJob.create({
      data: {
        orgId: org.id,
        storeId: store.id,
        jobType: OMarketJobType.PRODUCT_EXPORT,
        status: OMarketExportJobStatus.QUEUED,
        requestedById: adminUser.id,
        requestIdempotencyKey: "o-stale-queued",
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await runOMarketExportJob({ jobId: stale.id });
    const refreshed = await prisma.oMarketExportJob.findUniqueOrThrow({
      where: { id: stale.id },
    });

    expect(result).toMatchObject({ status: "skipped", details: { reason: "empty" } });
    expect(refreshed.status).toBe(OMarketExportJobStatus.TIMED_OUT);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

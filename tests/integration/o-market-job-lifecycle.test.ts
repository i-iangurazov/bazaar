import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OMarketExportJobStatus, OMarketJobType, OMarketLastSyncStatus } from "@prisma/client";

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

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const waitFor = async (predicate: () => boolean) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition not reached");
};

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

  it.each([
    [
      "success",
      new Response(JSON.stringify({ result: { task_id: 42 }, status: "success" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ],
    ["failure", new Response("provider failed", { status: 503 })],
  ])(
    "fences a stale O! Market worker after timeout on held provider %s",
    async (_outcome, providerResponse) => {
      vi.stubEnv("O_MARKET_MOCK_API", "0");
      const { org, store, product, adminUser } = await seedBase();
      await prisma.product.update({
        where: { id: product.id },
        data: { sku: "O-FENCE-1", basePriceKgs: 1_200 },
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
      await updateOMarketSettings({
        organizationId: org.id,
        actorId: adminUser.id,
        requestId: `o-fence-settings-${_outcome}`,
        apiToken: "mock-token",
      });
      await updateOMarketStoreMappings({
        organizationId: org.id,
        actorId: adminUser.id,
        requestId: `o-fence-mapping-${_outcome}`,
        mappings: [{ storeId: store.id, locationId: "101" }],
      });
      await updateOMarketProductSelection({
        organizationId: org.id,
        storeId: store.id,
        actorId: adminUser.id,
        requestId: `o-fence-selection-${_outcome}`,
        productIds: [product.id],
        included: true,
      });
      const heldProvider = deferred<Response>();
      const fetchMock = vi
        .fn()
        .mockImplementationOnce(() => heldProvider.promise)
        .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const requested = await requestOMarketExport({
        organizationId: org.id,
        storeId: store.id,
        actorId: adminUser.id,
        requestId: `o-fence-${_outcome}`,
        jobType: OMarketJobType.STOCK_PRICE_SYNC,
      });
      const baselineAudits = await prisma.auditLog.count({
        where: {
          entity: "OMarketExportJob",
          entityId: requested.job.id,
          action: { in: ["O_MARKET_EXPORT_FINISHED", "O_MARKET_EXPORT_FAILED"] },
        },
      });

      const oldWorker = runOMarketExportJob({ jobId: requested.job.id });
      await waitFor(() => fetchMock.mock.calls.length === 1);
      await prisma.oMarketExportJob.update({
        where: { id: requested.job.id },
        data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
      });
      const recovery = await runOMarketExportJob({ jobId: requested.job.id });
      heldProvider.resolve(providerResponse);
      const staleResult = await oldWorker;
      const [job, includedProduct, syncState, terminalAudits] = await Promise.all([
        prisma.oMarketExportJob.findUniqueOrThrow({ where: { id: requested.job.id } }),
        prisma.oMarketIncludedProduct.findFirstOrThrow({
          where: { orgId: org.id, storeId: store.id, productId: product.id },
        }),
        prisma.oMarketProductSyncState.findUnique({
          where: {
            orgId_storeId_productId: { orgId: org.id, storeId: store.id, productId: product.id },
          },
        }),
        prisma.auditLog.count({
          where: {
            entity: "OMarketExportJob",
            entityId: requested.job.id,
            action: { in: ["O_MARKET_EXPORT_FINISHED", "O_MARKET_EXPORT_FAILED"] },
          },
        }),
      ]);

      expect(recovery.status).toBe("skipped");
      expect(staleResult).toMatchObject({ status: "skipped", details: { reason: "leaseLost" } });
      expect(job.status).toBe(OMarketExportJobStatus.TIMED_OUT);
      expect(job.leaseToken).toBeNull();
      expect(includedProduct.lastExportedAt).toBeNull();
      expect(syncState).toBeNull();
      expect(terminalAudits).toBe(baselineAudits);
    },
  );
});

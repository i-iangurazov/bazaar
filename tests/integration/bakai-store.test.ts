import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AttributeType,
  BakaiStoreConnectionMode,
  BakaiStoreExportJobStatus,
  BakaiStoreJobType,
  BakaiStoreLastSyncStatus,
} from "@prisma/client";
import * as XLSX from "xlsx";

import { prisma } from "@/server/db/prisma";
import { runJob } from "@/server/jobs";
import {
  getBakaiStoreSettings,
  getBakaiStoreExportJob,
  listBakaiStoreExportJobs,
  requestBakaiStoreApiSync,
  requestBakaiStoreExport,
  runBakaiStoreApiPreflight,
  runBakaiStorePreflight,
  saveBakaiStoreTemplateWorkbook,
  testBakaiStoreConnection,
  updateBakaiStoreBranchMappings,
  updateBakaiStoreSettings,
  updateBakaiStoreMappings,
  updateBakaiStoreProductSelection,
} from "@/server/services/bakaiStore";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const createTemplateBuffer = () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["SKU", "Name", "Price", "Скидка (%)", "Сумма скидки", "pp1"],
    ["sample-sku", "Sample", 10, "", "", 1],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Products");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
};

const prepareReadyBakaiData = async (options?: { allowNegativeStock?: boolean }) => {
  const { org, store, product, adminUser, supplier, baseUnit } = await seedBase({
    allowNegativeStock: options?.allowNegativeStock ?? false,
  });

  const updatedProduct = await prisma.product.update({
    where: { id: product.id },
    data: {
      sku: "BAKAI-1",
      name: "Ready Bakai Product",
      basePriceKgs: 1200,
      photoUrl: "https://cdn.example.com/images/bakai-ready.jpg",
    },
  });

  await prisma.inventorySnapshot.create({
    data: {
      storeId: store.id,
      productId: product.id,
      variantKey: "BASE",
      onHand: 5,
      onOrder: 0,
      allowNegativeStock: store.allowNegativeStock,
    },
  });

  await saveBakaiStoreTemplateWorkbook({
    organizationId: org.id,
    actorId: adminUser.id,
    requestId: "bakai-template",
    upload: {
      fileName: "bakai-template.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: createTemplateBuffer(),
    },
  });

  await updateBakaiStoreMappings({
    organizationId: org.id,
    actorId: adminUser.id,
    requestId: "bakai-mapping",
    mappings: [{ columnKey: "pp1", storeId: store.id }],
  });

  await updateBakaiStoreProductSelection({
    organizationId: org.id,
    actorId: adminUser.id,
    requestId: "bakai-selection",
    productIds: [product.id],
    included: true,
  });

  return {
    org,
    store,
    product: updatedProduct,
    adminUser,
    supplier,
    baseUnit,
  };
};

const prepareReadyBakaiApiData = async () => {
  const base = await prepareReadyBakaiData();
  const product = await prisma.product.update({
    where: { id: base.product.id },
    data: {
      category: "Смартфоны",
      description:
        "Это достаточно длинное описание товара для прохождения обязательной проверки Bakai API.",
      photoUrl: "https://cdn.example.com/images/bakai-main.jpg",
    },
  });

  await prisma.productImage.createMany({
    data: [
      {
        organizationId: base.org.id,
        productId: product.id,
        url: "https://cdn.example.com/images/bakai-extra-1.png",
        position: 1,
      },
      {
        organizationId: base.org.id,
        productId: product.id,
        url: "https://cdn.example.com/images/bakai-extra-2.webp",
        position: 2,
      },
    ],
  });

  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      attributes: {},
    },
  });

  await prisma.attributeDefinition.create({
    data: {
      organizationId: base.org.id,
      key: "color",
      labelRu: "Цвет",
      labelKg: "Түс",
      type: AttributeType.TEXT,
    },
  });

  await prisma.categoryAttributeTemplate.create({
    data: {
      organizationId: base.org.id,
      category: "Смартфоны",
      attributeKey: "color",
      order: 0,
    },
  });

  await prisma.variantAttributeValue.create({
    data: {
      organizationId: base.org.id,
      productId: product.id,
      variantId: variant.id,
      key: "color",
      value: "black",
    },
  });

  return {
    ...base,
    product,
  };
};

describeDb("bakai store integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("blocks products when both discount columns are populated", async () => {
    const { org, product } = await prepareReadyBakaiData();

    await prisma.bakaiStoreIncludedProduct.update({
      where: {
        orgId_productId: {
          orgId: org.id,
          productId: product.id,
        },
      },
      data: {
        discountPercent: 10,
        discountAmount: 100,
      },
    });

    const preflight = await runBakaiStorePreflight(org.id);
    const failure = preflight.failedProducts.find((row) => row.productId === product.id);

    expect(preflight.canExport).toBe(false);
    expect(failure?.issues).toContain("DISCOUNT_CONFLICT");
  });

  it("flags invalid negative stock values", async () => {
    const { org, store, product } = await prepareReadyBakaiData({ allowNegativeStock: true });

    await prisma.inventorySnapshot.update({
      where: {
        storeId_productId_variantKey: {
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
      data: {
        onHand: -2,
      },
    });

    const preflight = await runBakaiStorePreflight(org.id);
    const failure = preflight.failedProducts.find((row) => row.productId === product.id);

    expect(preflight.canExport).toBe(false);
    expect(failure?.issues).toContain("INVALID_STOCK_VALUE");
  });

  it("detects duplicate SKUs case-insensitively", async () => {
    const { org, store, adminUser, supplier, baseUnit } = await prepareReadyBakaiData();

    const duplicateProduct = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        sku: "bakai-1",
        name: "Second Bakai Product",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
        basePriceKgs: 1500,
        photoUrl: "https://cdn.example.com/images/bakai-duplicate.jpg",
      },
    });

    await prisma.inventorySnapshot.create({
      data: {
        storeId: store.id,
        productId: duplicateProduct.id,
        variantKey: "BASE",
        onHand: 4,
        onOrder: 0,
        allowNegativeStock: store.allowNegativeStock,
      },
    });

    await updateBakaiStoreProductSelection({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "bakai-duplicate-selection",
      productIds: [duplicateProduct.id],
      included: true,
    });

    const preflight = await runBakaiStorePreflight(org.id);

    expect(preflight.blockers.byCode.DUPLICATE_SKU).toBe(1);
    expect(preflight.failedProducts.some((row) => row.productId === duplicateProduct.id)).toBe(
      true,
    );
  });

  it("exports only ready products in ready-only mode and persists the job artifact", async () => {
    const { org, store, adminUser, supplier, baseUnit, product } = await prepareReadyBakaiData();

    const brokenProduct = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        sku: "BROKEN-1",
        name: "Broken Bakai Product",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
        photoUrl: "https://cdn.example.com/images/bakai-broken.jpg",
      },
    });

    await prisma.inventorySnapshot.create({
      data: {
        storeId: store.id,
        productId: brokenProduct.id,
        variantKey: "BASE",
        onHand: 3,
        onOrder: 0,
        allowNegativeStock: store.allowNegativeStock,
      },
    });

    await updateBakaiStoreProductSelection({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "bakai-ready-only-selection",
      productIds: [brokenProduct.id],
      included: true,
    });

    const preflight = await runBakaiStorePreflight(org.id);
    expect(preflight.canExport).toBe(false);
    expect(preflight.summary.productsReady).toBe(1);
    expect(preflight.summary.productsFailed).toBe(1);

    const requested = await requestBakaiStoreExport({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "bakai-ready-only-export",
      mode: "READY_ONLY",
    });

    expect(requested.job.status).toBe(BakaiStoreExportJobStatus.QUEUED);

    const result = await runJob("bakai-store-export", {
      jobId: requested.job.id,
      organizationId: org.id,
      mode: "READY_ONLY",
    });
    const job = await getBakaiStoreExportJob(org.id, requested.job.id);
    const jobs = await listBakaiStoreExportJobs(org.id);

    expect(result.status).toBe("ok");
    expect(job?.status).toBe(BakaiStoreExportJobStatus.DONE);
    expect(job?.storagePath).toBeTruthy();
    expect(job?.fileName?.endsWith(".xlsx")).toBe(true);
    expect(jobs[0]?.id).toBe(requested.job.id);

    const workbook = XLSX.read(
      await prisma.$transaction(async () => {
        if (!job?.storagePath) {
          throw new Error("missing storagePath");
        }
        const { readFile } = await import("node:fs/promises");
        return readFile(job.storagePath);
      }),
      { type: "buffer" },
    );
    const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
    const values = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      blankrows: false,
      raw: true,
    });

    expect(values[1]?.[0]).toBe(product.sku);
    expect(values.some((row) => row[0] === "BROKEN-1")).toBe(false);
  });

  it("configures API mode, checks connection, syncs ready products, and records job history", async () => {
    const { org, store, adminUser, product } = await prepareReadyBakaiApiData();
    const previousEndpoint = process.env.BAKAI_STORE_IMPORT_ENDPOINT;
    const previousTokenKey = process.env.BAKAI_STORE_TOKEN_ENCRYPTION_KEY;
    process.env.BAKAI_STORE_IMPORT_ENDPOINT = "https://bakai.test/api/products/import";
    process.env.BAKAI_STORE_TOKEN_ENCRYPTION_KEY = "bakai-test-secret";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const settingsResult = await updateBakaiStoreSettings({
        organizationId: org.id,
        actorId: adminUser.id,
        requestId: "bakai-api-settings",
        connectionMode: BakaiStoreConnectionMode.API,
        apiToken: "bakai-token",
      });

      await updateBakaiStoreBranchMappings({
        organizationId: org.id,
        actorId: adminUser.id,
        requestId: "bakai-api-branches",
        mappings: [{ storeId: store.id, branchId: "101" }],
      });

      const connection = await testBakaiStoreConnection({
        organizationId: org.id,
        actorId: adminUser.id,
        requestId: "bakai-api-test-connection",
      });
      const preflight = await runBakaiStoreApiPreflight(org.id);
      const requested = await requestBakaiStoreApiSync({
        organizationId: org.id,
        actorId: adminUser.id,
        requestId: "bakai-api-sync",
      });
      const result = await runJob("bakai-store-api-sync", {
        jobId: requested.job.id,
        organizationId: org.id,
      });
      const job = await getBakaiStoreExportJob(org.id, requested.job.id);
      const jobs = await listBakaiStoreExportJobs(org.id);
      const syncState = await prisma.bakaiStoreProductSyncState.findUnique({
        where: {
          orgId_productId: {
            orgId: org.id,
            productId: product.id,
          },
        },
      });
      const settings = await getBakaiStoreSettings(org.id);

      expect(settingsResult.connectionMode).toBe(BakaiStoreConnectionMode.API);
      expect(settingsResult.hasApiToken).toBe(true);
      expect(connection.ok).toBe(true);
      expect(connection.endpoint).toBe(process.env.BAKAI_STORE_IMPORT_ENDPOINT);
      expect(preflight.mode).toBe("API");
      expect(preflight.canExport).toBe(true);
      expect(preflight.summary.productsReady).toBe(1);
      expect(requested.job.jobType).toBe(BakaiStoreJobType.API_SYNC);
      expect(result.status).toBe("ok");
      expect(job?.status).toBe(BakaiStoreExportJobStatus.DONE);
      expect(job?.attemptedCount).toBe(1);
      expect(job?.succeededCount).toBe(1);
      expect(job?.failedCount).toBe(0);
      expect(jobs[0]?.id).toBe(requested.job.id);
      expect(syncState?.lastSyncStatus).toBe(BakaiStoreLastSyncStatus.SUCCESS);
      expect(settings.integration.hasApiToken).toBe(true);
      expect("apiToken" in settings.integration).toBe(false);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1]?.[0]).toBe("https://bakai.test/api/products/import");
      expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer bakai-token",
          CityId: "1",
        }),
      });

      const requestBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body ?? "{}")) as {
        products?: Array<Record<string, unknown>>;
      };
      expect(requestBody.products).toHaveLength(1);
      expect(requestBody.products?.[0]?.sku).toBe(product.sku);
      expect(requestBody.products?.[0]?.branch_id).toBe(101);
      expect(requestBody.products?.[0]?.quantity).toBe(5);
      expect(requestBody.products?.[0]).not.toHaveProperty("discount_amount");
      expect(requestBody.products?.[0]).not.toHaveProperty("stock");
      expect(requestBody.products?.[0]).not.toHaveProperty("specs");
      expect(JSON.stringify(job?.responseJson ?? {})).not.toContain("bakai-token");
    } finally {
      vi.unstubAllGlobals();
      if (previousEndpoint === undefined) {
        delete process.env.BAKAI_STORE_IMPORT_ENDPOINT;
      } else {
        process.env.BAKAI_STORE_IMPORT_ENDPOINT = previousEndpoint;
      }
      if (previousTokenKey === undefined) {
        delete process.env.BAKAI_STORE_TOKEN_ENCRYPTION_KEY;
      } else {
        process.env.BAKAI_STORE_TOKEN_ENCRYPTION_KEY = previousTokenKey;
      }
    }
  });

  it("warns about full-upload risk in API mode when only part of the included assortment is ready", async () => {
    const { org, store, adminUser, supplier, baseUnit } = await prepareReadyBakaiApiData();
    const previousEndpoint = process.env.BAKAI_STORE_IMPORT_ENDPOINT;
    const previousTokenKey = process.env.BAKAI_STORE_TOKEN_ENCRYPTION_KEY;
    process.env.BAKAI_STORE_IMPORT_ENDPOINT = "https://bakai.test/api/products/import";
    process.env.BAKAI_STORE_TOKEN_ENCRYPTION_KEY = "bakai-test-secret";

    try {
      await updateBakaiStoreSettings({
        organizationId: org.id,
        actorId: adminUser.id,
        requestId: "bakai-api-warning-settings",
        connectionMode: BakaiStoreConnectionMode.API,
        apiToken: "bakai-token",
      });

      await updateBakaiStoreBranchMappings({
        organizationId: org.id,
        actorId: adminUser.id,
        requestId: "bakai-api-warning-branches",
        mappings: [{ storeId: store.id, branchId: "101" }],
      });

      const brokenProduct = await prisma.product.create({
        data: {
          organizationId: org.id,
          supplierId: supplier.id,
          sku: "BROKEN-API-1",
          name: "Broken API Product",
          unit: baseUnit.code,
          baseUnitId: baseUnit.id,
          category: "Смартфоны",
          description: "Коротко",
          photoUrl: "https://cdn.example.com/images/broken-api.jpg",
        },
      });

      await prisma.inventorySnapshot.create({
        data: {
          storeId: store.id,
          productId: brokenProduct.id,
          variantKey: "BASE",
          onHand: 2,
          onOrder: 0,
          allowNegativeStock: store.allowNegativeStock,
        },
      });

      await updateBakaiStoreProductSelection({
        organizationId: org.id,
        actorId: adminUser.id,
        requestId: "bakai-api-warning-selection",
        productIds: [brokenProduct.id],
        included: true,
      });

      const preflight = await runBakaiStoreApiPreflight(org.id);

      expect(preflight.mode).toBe("API");
      expect(preflight.summary.productsReady).toBe(1);
      expect(preflight.summary.productsFailed).toBe(1);
      expect(preflight.warnings.global).toContain("FULL_UPLOAD_RISK_WARNING");
      expect(preflight.actionability.canRunAll).toBe(false);
      expect(preflight.actionability.canRunReadyOnly).toBe(false);
    } finally {
      if (previousEndpoint === undefined) {
        delete process.env.BAKAI_STORE_IMPORT_ENDPOINT;
      } else {
        process.env.BAKAI_STORE_IMPORT_ENDPOINT = previousEndpoint;
      }
      if (previousTokenKey === undefined) {
        delete process.env.BAKAI_STORE_TOKEN_ENCRYPTION_KEY;
      } else {
        process.env.BAKAI_STORE_TOKEN_ENCRYPTION_KEY = previousTokenKey;
      }
    }
  });
});

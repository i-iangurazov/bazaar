import { beforeEach, describe, expect, it } from "vitest";
import { BakaiStoreExportJobStatus } from "@prisma/client";
import * as XLSX from "xlsx";

import { prisma } from "@/server/db/prisma";
import { runJob } from "@/server/jobs";
import {
  getBakaiStoreExportJob,
  listBakaiStoreExportJobs,
  requestBakaiStoreExport,
  runBakaiStorePreflight,
  saveBakaiStoreTemplateWorkbook,
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

  await prisma.product.update({
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

  return { org, store, product, adminUser, supplier, baseUnit };
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
});

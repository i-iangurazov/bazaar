import { promises as fs } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { ExportType } from "@prisma/client";
import * as XLSX from "xlsx";

import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";
import { runJob } from "../../src/server/jobs";
import { prisma } from "../../src/server/db/prisma";
import { resolveExportJobDownload } from "../../src/server/services/exports";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("exports", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("generates every export type with BOM and stable headers", async () => {
    const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const periodStart = new Date("2025-01-01T00:00:00Z");
    const periodEnd = new Date("2025-01-31T23:59:59Z");
    await prisma.periodClose.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        periodStart,
        periodEnd,
        closedById: adminUser.id,
        totals: { movementCount: 0, skuCount: 0, salesTotalKgs: 0, purchasesTotalKgs: 0 },
      },
    });

    const headers: Record<ExportType, string> = {
      INVENTORY_MOVEMENTS_LEDGER:
        "orgId,storeCode,storeName,movementId,movementType,occurredAt,sku,variantSku,productName,variantName,barcode,qtyDelta,unit,unitCostKgs,totalCostKgs,effectivePriceKgs,reason,docType,docNumber,userEmail,requestId",
      INVENTORY_BALANCES_AT_DATE:
        "orgId,storeCode,sku,variantSku,productName,onHand,unit,avgCostKgs,inventoryValueKgs",
      PURCHASES_RECEIPTS:
        "orgId,storeCode,supplierName,supplierInn,poNumber,receivedAt,sku,qty,unit,unitCostKgs,lineTotalKgs",
      PRICE_LIST:
        "orgId,storeCode,sku,productName,basePriceKgs,storeOverridePriceKgs,effectivePriceKgs,avgCostKgs,marginPct,markupPct",
      SALES_SUMMARY: "date,store,totalQty,movementCount",
      STOCK_MOVEMENTS: "date,store,sku,product,variant,movementType,qtyDelta,reference,actor",
      PURCHASES:
        "poId,status,createdAt,receivedAt,store,supplier,sku,product,variant,qtyOrdered,qtyReceived,unitCostKgs,lineTotalKgs",
      INVENTORY_ON_HAND:
        "store,sku,product,variant,onHand,onOrder,minStock,reorderPoint,effectivePriceKgs",
      PERIOD_CLOSE_REPORT:
        "store,periodStart,periodEnd,closedAt,movementCount,skuCount,salesTotalKgs,purchasesTotalKgs",
      RECEIPTS_FOR_KKM: "receiptId,date,store,sku,product,variant,qty",
      RECEIPTS_REGISTRY:
        "orgId,storeCode,storeName,receiptNumber,createdAt,completedAt,status,registerCode,registerName,cashierEmail,currencyCode,currencyRateKgsPerUnit,totalKgs,cashKgs,cardKgs,transferKgs,otherKgs,kkmStatus,fiscalStatus,fiscalMode,fiscalNumber,providerReceiptId,fiscalError",
      SHIFT_X_REPORT:
        "orgId,storeCode,reportType,shiftId,status,currencyCode,currencyRateKgsPerUnit,registerCode,registerName,openedAt,openedBy,closedAt,closedBy,salesCount,salesTotalKgs,cashSalesKgs,nonCashSalesKgs,cardSalesKgs,transferSalesKgs,otherSalesKgs,returnsCount,returnsTotalKgs,cashRefundsKgs,nonCashRefundsKgs,cardRefundsKgs,transferRefundsKgs,otherRefundsKgs,nonCashNetKgs,openingCashKgs,cashPayInKgs,cashPayOutKgs,expectedCashKgs,overWithdrawalKgs,countedCashKgs,discrepancyKgs",
      SHIFT_Z_REPORT:
        "orgId,storeCode,reportType,shiftId,status,currencyCode,currencyRateKgsPerUnit,registerCode,registerName,openedAt,openedBy,closedAt,closedBy,salesCount,salesTotalKgs,cashSalesKgs,nonCashSalesKgs,cardSalesKgs,transferSalesKgs,otherSalesKgs,returnsCount,returnsTotalKgs,cashRefundsKgs,nonCashRefundsKgs,cardRefundsKgs,transferRefundsKgs,otherRefundsKgs,nonCashNetKgs,openingCashKgs,cashPayInKgs,cashPayOutKgs,expectedCashKgs,overWithdrawalKgs,countedCashKgs,discrepancyKgs",
      SALES_BY_DAY: "orgId,storeCode,day,ordersCount,revenueKgs",
      SALES_BY_ITEM: "orgId,storeCode,sku,productName,variantSku,variantName,qty,revenueKgs",
      RETURNS_BY_DAY: "orgId,storeCode,day,returnsCount,returnsTotalKgs",
      RETURNS_BY_ITEM:
        "orgId,storeCode,sku,productName,variantSku,variantName,qty,returnsTotalKgs",
      CASH_DRAWER_MOVEMENTS:
        "orgId,storeCode,createdAt,shiftId,registerCode,registerName,type,currencyCode,currencyRateKgsPerUnit,amountKgs,reason,createdBy",
      MARKING_SALES_REGISTRY:
        "orgId,storeCode,capturedAt,receiptNumber,receiptCreatedAt,sku,productName,qty,markingCode,capturedBy",
      ETTN_REFERENCES:
        "orgId,storeCode,createdAt,documentType,documentId,ettnNumber,ettnDate,notes,createdBy",
      ESF_REFERENCES:
        "orgId,storeCode,createdAt,documentType,documentId,esfNumber,esfDate,counterpartyName,createdBy",
    };

    expect(Object.keys(headers).sort()).toEqual(Object.values(ExportType).sort());

    for (const type of Object.values(ExportType)) {
      const created = await caller.exports.create({
        storeId: store.id,
        type,
        format: "csv",
        periodStart,
        periodEnd,
      });

      await runJob("export-job", { jobId: created.id });
      const job = await caller.exports.get({ jobId: created.id });

      expect(job).not.toBeNull();
      if (!job) {
        throw new Error("export job missing");
      }

      expect(job.status).toBe("DONE");
      expect(job.storagePath).toBeTruthy();
      expect(job.downloadAvailable).toBe(true);
      expect(job.downloadUrl).toBe(`/api/exports/${job.id}`);
      expect(job.downloadUnavailableReason).toBeNull();

      const csv = await fs.readFile(job.storagePath ?? "", "utf8");
      expect(job.mimeType).toBe("text/csv;charset=utf-8");
      expect(job.fileName?.endsWith(".csv")).toBe(true);
      expect(csv.startsWith("\ufeff")).toBe(true);
      const header = csv.replace(/^\ufeff/, "").split(/\r?\n/)[0]?.trim();
      expect(header).toBe(headers[type]);
    }
  }, 60_000);

  it("generates XLSX exports with stable headers", async () => {
    const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const created = await caller.exports.create({
      storeId: store.id,
      type: ExportType.PRICE_LIST,
      format: "xlsx",
      periodStart: new Date("2025-01-01T00:00:00Z"),
      periodEnd: new Date("2025-01-31T23:59:59Z"),
    });

    await runJob("export-job", { jobId: created.id });
    const job = await caller.exports.get({ jobId: created.id });

    expect(job).not.toBeNull();
    if (!job) {
      throw new Error("export job missing");
    }
    expect(job.status).toBe("DONE");
    expect(job.downloadAvailable).toBe(true);
    expect(job.downloadUrl).toBe(`/api/exports/${job.id}`);
    expect(job.downloadUnavailableReason).toBeNull();
    const xlsx = await fs.readFile(job.storagePath ?? "");
    expect(job.mimeType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(job.fileName?.endsWith(".xlsx")).toBe(true);
    const workbook = XLSX.read(xlsx, { type: "buffer" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
    const values = XLSX.utils.sheet_to_json<string[]>(firstSheet, {
      header: 1,
      blankrows: false,
    });
    const header = (values[0] ?? []).map(String).join(",");
    expect(header).toBe(
      "orgId,storeCode,sku,productName,basePriceKgs,storeOverridePriceKgs,effectivePriceKgs,avgCostKgs,marginPct,markupPct",
    );
  });

  it("enforces RBAC on export generation", async () => {
    const { org, store, staffUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: staffUser.id,
      email: staffUser.email,
      role: staffUser.role,
      organizationId: org.id,
    });

    await expect(
      caller.exports.create({
        storeId: store.id,
        type: ExportType.INVENTORY_MOVEMENTS_LEDGER,
        periodStart: new Date("2025-01-01T00:00:00Z"),
        periodEnd: new Date("2025-01-31T23:59:59Z"),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("marks completed exports unavailable when the generated file is missing", async () => {
    const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const created = await caller.exports.create({
      storeId: store.id,
      type: ExportType.PRICE_LIST,
      format: "csv",
      periodStart: new Date("2025-01-01T00:00:00Z"),
      periodEnd: new Date("2025-01-31T23:59:59Z"),
    });

    await runJob("export-job", { jobId: created.id });
    const completed = await caller.exports.get({ jobId: created.id });
    expect(completed?.storagePath).toBeTruthy();
    if (!completed?.storagePath) {
      throw new Error("export storage path missing");
    }
    await fs.unlink(completed.storagePath);

    const missing = await caller.exports.get({ jobId: created.id });
    expect(missing?.status).toBe("DONE");
    expect(missing?.downloadAvailable).toBe(false);
    expect(missing?.downloadUrl).toBeNull();
    expect(missing?.downloadUnavailableReason).toBe("exportFileMissing");
  });

  it("regenerates a missing completed export when the download route is opened", async () => {
    const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const created = await caller.exports.create({
      storeId: store.id,
      type: ExportType.PRICE_LIST,
      format: "csv",
      periodStart: new Date("2025-01-01T00:00:00Z"),
      periodEnd: new Date("2025-01-31T23:59:59Z"),
    });

    await runJob("export-job", { jobId: created.id });
    const completed = await caller.exports.get({ jobId: created.id });
    expect(completed?.storagePath).toBeTruthy();
    if (!completed?.storagePath) {
      throw new Error("export storage path missing");
    }
    await fs.unlink(completed.storagePath);

    const download = await resolveExportJobDownload({
      organizationId: org.id,
      jobId: created.id,
      user: {
        id: adminUser.id,
        organizationId: org.id,
        role: adminUser.role,
        isOrgOwner: true,
        isPlatformOwner: false,
      },
    });

    const chunks: Buffer[] = [];
    for await (const chunk of download.stream) {
      chunks.push(Buffer.from(chunk));
    }
    const csv = Buffer.concat(chunks).toString("utf8");

    expect(download.fileName).toBe(`price_list-${created.id}.csv`);
    expect(download.fileSize).toBe(Buffer.byteLength(csv));
    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(csv).toContain("orgId,storeCode,sku,productName");

    const refreshed = await caller.exports.get({ jobId: created.id });
    expect(refreshed?.downloadAvailable).toBe(true);
    expect(refreshed?.downloadUrl).toBe(`/api/exports/${created.id}`);
    expect(refreshed?.downloadUnavailableReason).toBeNull();
  });
});

import { promises as fs } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { ExportType } from "@prisma/client";
import * as XLSX from "xlsx";

import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";
import { runJob } from "../../src/server/jobs";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("exports", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("generates export CSVs with BOM and stable headers", async () => {
    const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const cases: Array<{ type: ExportType; format: "csv" | "xlsx"; header: string }> = [
      {
        type: ExportType.INVENTORY_MOVEMENTS_LEDGER,
        format: "csv",
        header:
          "orgId,storeCode,storeName,movementId,movementType,occurredAt,sku,variantSku,productName,variantName,barcode,qtyDelta,unit,unitCostKgs,totalCostKgs,effectivePriceKgs,reason,docType,docNumber,userEmail,requestId",
      },
      {
        type: ExportType.INVENTORY_BALANCES_AT_DATE,
        format: "xlsx",
        header:
          "orgId,storeCode,sku,variantSku,productName,onHand,unit,avgCostKgs,inventoryValueKgs",
      },
      {
        type: ExportType.PURCHASES_RECEIPTS,
        format: "csv",
        header:
          "orgId,storeCode,supplierName,supplierInn,poNumber,receivedAt,sku,qty,unit,unitCostKgs,lineTotalKgs",
      },
      {
        type: ExportType.PRICE_LIST,
        format: "xlsx",
        header:
          "orgId,storeCode,sku,productName,basePriceKgs,storeOverridePriceKgs,effectivePriceKgs,avgCostKgs,marginPct,markupPct",
      },
    ];

    for (const testCase of cases) {
      const created = await caller.exports.create({
        storeId: store.id,
        type: testCase.type,
        format: testCase.format,
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
      expect(job.storagePath).toBeTruthy();

      if (testCase.format === "csv") {
        const csv = await fs.readFile(job.storagePath ?? "", "utf8");
        expect(job.mimeType).toBe("text/csv;charset=utf-8");
        expect(job.fileName?.endsWith(".csv")).toBe(true);
        expect(csv.startsWith("\ufeff")).toBe(true);
        const header = csv.replace(/^\ufeff/, "").split(/\r?\n/)[0]?.trim();
        expect(header).toBe(testCase.header);
      } else {
        const xlsx = await fs.readFile(job.storagePath ?? "");
        expect(job.mimeType).toBe(
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        expect(job.fileName?.endsWith(".xlsx")).toBe(true);
        const workbook = XLSX.read(xlsx, { type: "buffer" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
        const values = XLSX.utils.sheet_to_json<string[]>(firstSheet, {
          header: 1,
          blankrows: false,
        });
        const header = (values[0] ?? []).map(String).join(",");
        expect(header).toBe(testCase.header);
      }
    }
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
});

import { promises as fs } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { ExportType } from "@prisma/client";

import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("exports", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("generates receipts CSV with stable headers", async () => {
    const { org, store, adminUser } = await seedBase();
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const job = await caller.exports.create({
      storeId: store.id,
      type: ExportType.RECEIPTS_FOR_KKM,
      periodStart: new Date("2025-01-01T00:00:00Z"),
      periodEnd: new Date("2025-01-31T23:59:59Z"),
    });

    expect(job.status).toBe("DONE");
    expect(job.storagePath).toBeTruthy();

    const csv = await fs.readFile(job.storagePath ?? "", "utf8");
    const header = csv.split("\n")[0]?.trim();

    expect(header).toBe("receiptId,date,store,sku,product,variant,qty");
  });
});

import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("bazaar api stock source structure", () => {
  it("keeps API order stock deduction and cancellation restoration wired", async () => {
    const bazaarApiService = await readSource("src/server/services/bazaarApi.ts");
    const salesOrdersService = await readSource("src/server/services/salesOrders.ts");

    expect(bazaarApiService).toContain("applyBazaarApiOrderStockDeduction");
    expect(bazaarApiService).toContain("pg_advisory_xact_lock");
    expect(bazaarApiService).toContain("bazaarApiExternalIdNote");
    expect(bazaarApiService).toContain("bazaarApiStockImpactingStatuses");
    expect(bazaarApiService).toContain("StockMovementType.SALE");
    expect(bazaarApiService).toContain('referenceType: "CustomerOrder"');
    expect(bazaarApiService).toContain("allowNegativeStock: true");
    expect(bazaarApiService).toContain("if (!result.replayed)");

    expect(salesOrdersService).toContain("restoreCustomerOrderStockOnCancel");
    expect(salesOrdersService).toContain("StockMovementType.RETURN");
    expect(salesOrdersService).toContain("qtyDelta: Math.abs(movement.qtyDelta)");
    expect(salesOrdersService).toContain("SELECT id FROM \"CustomerOrder\"");
  });
});

import { describe, expect, it } from "vitest";

import { getKkmAdapter } from "@/server/kkm/registry";
import { AppError } from "@/server/services/errors";

describe("kkm registry", () => {
  it("returns stub adapter for missing providers", async () => {
    const adapter = getKkmAdapter();
    const health = await adapter.health();
    expect(health.ok).toBe(false);

    await expect(
      adapter.fiscalizeReceipt({
        storeId: "store",
        lines: [{ sku: "SKU-1", name: "Item", qty: 1 }],
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

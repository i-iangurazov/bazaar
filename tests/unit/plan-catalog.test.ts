import { describe, expect, it } from "vitest";

import { getPlanLimits } from "@/server/billing/planCatalog";

describe("plan catalog limits", () => {
  it("uses production store and product limits for each tier", () => {
    expect(getPlanLimits("STARTER")).toMatchObject({ maxStores: 1, maxProducts: 1000 });
    expect(getPlanLimits("BUSINESS")).toMatchObject({ maxStores: 5, maxProducts: 5000 });
    expect(getPlanLimits("ENTERPRISE")).toMatchObject({ maxStores: 15, maxProducts: 20000 });
  });
});

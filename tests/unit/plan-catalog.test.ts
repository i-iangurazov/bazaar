import { describe, expect, it } from "vitest";

import { getPlanLimits } from "@/server/billing/planCatalog";

describe("plan catalog limits", () => {
  it("uses production product limits for paid tiers", () => {
    expect(getPlanLimits("STARTER").maxProducts).toBe(1000);
    expect(getPlanLimits("BUSINESS").maxProducts).toBe(5000);
    expect(getPlanLimits("ENTERPRISE").maxProducts).toBe(20000);
  });
});

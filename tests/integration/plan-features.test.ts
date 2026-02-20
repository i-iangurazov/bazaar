import { beforeEach, describe, expect, it } from "vitest";

import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("plan feature gates", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns FORBIDDEN with key for locked exports, analytics and reports on starter", async () => {
    const { org, adminUser } = await seedBase({ plan: "STARTER" });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    await expect(caller.exports.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "featureLockedExports",
    });

    await expect(
      caller.analytics.salesTrend({
        rangeDays: 30,
        granularity: "day",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "featureLockedAnalytics",
    });

    await expect(
      caller.reports.stockouts({
        days: 30,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "featureLockedAnalytics",
    });
  });

  it("business plan allows imports, exports, analytics and reports", async () => {
    const { org, adminUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const imports = await caller.imports.list();
    const exports = await caller.exports.list();
    const analytics = await caller.analytics.salesTrend({
      rangeDays: 30,
      granularity: "day",
    });
    const reports = await caller.reports.stockouts({
      days: 30,
    });

    expect(Array.isArray(imports)).toBe(true);
    expect(Array.isArray(exports)).toBe(true);
    expect(Array.isArray(analytics.series)).toBe(true);
    expect(Array.isArray(reports)).toBe(true);
  });
});

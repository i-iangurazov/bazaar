import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("period close", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("prevents duplicate period close", async () => {
    const { org, store, managerUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });

    const start = new Date("2025-01-01T00:00:00Z");
    const end = new Date("2025-01-31T23:59:59Z");

    await caller.periodClose.close({ storeId: store.id, periodStart: start, periodEnd: end });

    await expect(
      caller.periodClose.close({ storeId: store.id, periodStart: start, periodEnd: end }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("normalizes concurrent duplicate closes and commits one audit", async () => {
    const { org, store, managerUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });
    const periodStart = new Date("2025-02-01T00:00:00Z");
    const periodEnd = new Date("2025-02-28T23:59:59Z");

    const attempts = await Promise.allSettled([
      caller.periodClose.close({ storeId: store.id, periodStart, periodEnd }),
      caller.periodClose.close({ storeId: store.id, periodStart, periodEnd }),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    expect(attempts.find((attempt) => attempt.status === "rejected")).toMatchObject({
      reason: { code: "CONFLICT", message: "periodAlreadyClosed" },
    });
    await expect(
      prisma.periodClose.count({ where: { organizationId: org.id, storeId: store.id } }),
    ).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({
        where: { organizationId: org.id, action: "PERIOD_CLOSED", entity: "PeriodClose" },
      }),
    ).resolves.toBe(1);
  });
});

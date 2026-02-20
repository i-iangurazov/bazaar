import { beforeEach, describe, expect, it } from "vitest";

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
});

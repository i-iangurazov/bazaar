import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("support toolkit", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("allows admins to export support bundle and update flags", async () => {
    const { org, adminUser, store } = await seedBase({ plan: "ENTERPRISE" });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const bundle = await caller.adminSupport.exportBundle();

    expect(bundle.organization?.id).toBe(org.id);

    const flag = await caller.adminSupport.upsertStoreFlag({
      storeId: store.id,
      key: "pilot_feature",
      enabled: true,
    });

    expect(flag.key).toBe("pilot_feature");
    expect(flag.enabled).toBe(true);
  });

  it("redacts sensitive audit data from support bundle exports", async () => {
    const { org, adminUser } = await seedBase({ plan: "ENTERPRISE" });
    await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        actorId: adminUser.id,
        action: "SECRET_TEST",
        entity: "Integration",
        entityId: "integration-1",
        before: { apiKey: "plain-api-key", nested: { token: "plain-token" } },
        after: { password: "plain-password", visible: "safe-value" },
        requestId: "support-redaction-test",
      },
    });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const bundle = await caller.adminSupport.exportBundle();
    const serialized = JSON.stringify(bundle);

    expect(serialized).toContain("[REDACTED]");
    expect(serialized).toContain("safe-value");
    expect(serialized).not.toContain("plain-api-key");
    expect(serialized).not.toContain("plain-token");
    expect(serialized).not.toContain("plain-password");
  });

  it("blocks non-admins from support actions", async () => {
    const { org, managerUser } = await seedBase();
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });

    await expect(caller.adminSupport.exportBundle()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns feature lock key for admin on plan without support toolkit", async () => {
    const { org, adminUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    await expect(caller.adminSupport.exportBundle()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "featureLockedSupportToolkit",
    });
  });
});

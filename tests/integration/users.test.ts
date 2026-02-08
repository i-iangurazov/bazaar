import { beforeEach, describe, expect, it } from "vitest";

import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("users management", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("allows admins to create users", async () => {
    const { org, adminUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const created = await caller.users.create({
      email: "new.user@test.local",
      name: "New User",
      role: "STAFF",
      password: "Password123",
      preferredLocale: "ru",
    });

    expect(created).toMatchObject({
      email: "new.user@test.local",
      role: "STAFF",
      preferredLocale: "ru",
    });
  });

  it("blocks non-admins from creating users", async () => {
    const { org, managerUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });

    await expect(
      caller.users.create({
        email: "blocked.user@test.local",
        name: "Blocked User",
        role: "STAFF",
        password: "Password123",
        preferredLocale: "ru",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows admins to update users", async () => {
    const { org, adminUser, staffUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const updated = await caller.users.update({
      userId: staffUser.id,
      email: "updated.user@test.local",
      name: "Updated User",
      role: "MANAGER",
      preferredLocale: "kg",
    });

    expect(updated).toMatchObject({
      email: "updated.user@test.local",
      name: "Updated User",
      role: "MANAGER",
      preferredLocale: "kg",
    });
  });

  it("blocks non-admins from updating users", async () => {
    const { org, managerUser, staffUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });

    await expect(
      caller.users.update({
        userId: staffUser.id,
        email: "blocked.update@test.local",
        name: "Blocked Update",
        role: "STAFF",
        preferredLocale: "ru",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

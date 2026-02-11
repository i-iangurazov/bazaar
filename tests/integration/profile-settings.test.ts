import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("profile settings", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("blocks staff from updating business profile", async () => {
    const { org, store, staffUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: staffUser.id,
      email: staffUser.email,
      role: staffUser.role,
      organizationId: org.id,
      isOrgOwner: false,
    });

    await expect(
      caller.orgSettings.updateBusinessProfile({
        organizationName: "Blocked Org",
        storeId: store.id,
        legalEntityType: "IP",
        legalName: "Blocked Legal",
        inn: "1234567890",
        address: "Blocked Address",
        phone: "+996555000000",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows admins to update business profile and writes audit log", async () => {
    const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const result = await caller.orgSettings.updateBusinessProfile({
      organizationName: "Updated Org Name",
      storeId: store.id,
      legalEntityType: "OSOO",
      legalName: "Updated Legal",
      inn: "1234567890",
      address: "Updated Address",
      phone: "+996555111222",
    });

    expect(result.organization.name).toBe("Updated Org Name");
    expect(result.selectedStore.legalName).toBe("Updated Legal");

    const audit = await prisma.auditLog.findFirst({
      where: {
        organizationId: org.id,
        action: "BUSINESS_PROFILE_UPDATE",
        entity: "Organization",
        entityId: org.id,
      },
    });

    expect(audit).toBeTruthy();
  });

  it("persists theme and locale preferences for current user", async () => {
    const { org, adminUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    await caller.userSettings.updateMyPreferences({
      preferredLocale: "kg",
      themePreference: "DARK",
    });

    const profile = await caller.userSettings.getMyProfile();
    expect(profile.preferredLocale).toBe("kg");
    expect(profile.themePreference).toBe("DARK");
  });
});

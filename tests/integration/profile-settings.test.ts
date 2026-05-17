import { beforeEach, describe, expect, it } from "vitest";
import { Role } from "@prisma/client";

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

  it("keeps product customization settings scoped to the selected store and organization", async () => {
    const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
    const secondStore = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Second Store",
        code: "SND",
        enableSku: true,
        enableBarcode: true,
        enableSimilarProductCheck: true,
      },
    });
    const otherOrg = await prisma.organization.create({
      data: { name: "Other Org", plan: "BUSINESS" },
    });
    const otherStore = await prisma.store.create({
      data: {
        organizationId: otherOrg.id,
        name: "Other Store",
        code: "OTH",
        enableSku: true,
        enableBarcode: true,
        enableSimilarProductCheck: true,
      },
    });
    const otherAdmin = await prisma.user.create({
      data: {
        organizationId: otherOrg.id,
        email: "other-admin@test.local",
        name: "Other Admin",
        passwordHash: "hash",
        role: Role.ADMIN,
        isOrgOwner: true,
        emailVerifiedAt: new Date(),
      },
    });

    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });
    const otherCaller = createTestCaller({
      id: otherAdmin.id,
      email: otherAdmin.email,
      role: otherAdmin.role,
      organizationId: otherOrg.id,
      isOrgOwner: true,
    });

    await caller.stores.updateProductSettings({
      storeId: store.id,
      enableSku: false,
      enableBarcode: false,
      enableSimilarProductCheck: false,
    });

    const firstStoreProfile = await caller.orgSettings.getBusinessProfile({ storeId: store.id });
    const secondStoreProfile = await caller.orgSettings.getBusinessProfile({
      storeId: secondStore.id,
    });
    const otherStoreProfile = await otherCaller.orgSettings.getBusinessProfile({
      storeId: otherStore.id,
    });

    expect(firstStoreProfile.selectedStore?.enableSku).toBe(false);
    expect(firstStoreProfile.selectedStore?.enableBarcode).toBe(false);
    expect(firstStoreProfile.selectedStore?.enableSimilarProductCheck).toBe(false);
    expect(secondStoreProfile.selectedStore?.enableSku).toBe(true);
    expect(secondStoreProfile.selectedStore?.enableBarcode).toBe(true);
    expect(secondStoreProfile.selectedStore?.enableSimilarProductCheck).toBe(true);
    expect(otherStoreProfile.selectedStore?.enableSku).toBe(true);
    expect(otherStoreProfile.selectedStore?.enableBarcode).toBe(true);
    expect(otherStoreProfile.selectedStore?.enableSimilarProductCheck).toBe(true);

    await expect(otherCaller.orgSettings.getBusinessProfile({ storeId: store.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      otherCaller.stores.updateProductSettings({
        storeId: store.id,
        enableSku: true,
        enableBarcode: true,
        enableSimilarProductCheck: true,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

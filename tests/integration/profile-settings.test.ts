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
        retailWholesaleEnabled: true,
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

  it("saves price types through the profile API for all stores and keeps prices on disable", async () => {
    const { org, store, adminUser, product } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({ ...adminUser, organizationId: org.id });
    const secondStore = await prisma.store.create({
      data: { organizationId: org.id, name: "Second Store", code: "SECOND" },
    });
    const otherOrg = await prisma.organization.create({ data: { name: "Other Org" } });
    const otherStore = await prisma.store.create({
      data: { organizationId: otherOrg.id, name: "Other Store", code: "OTHER" },
    });
    await prisma.storeProduct.create({
      data: { organizationId: org.id, storeId: secondStore.id, productId: product.id, isActive: true, isDirect: true },
    });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 1000 } });
    for (const storeId of [store.id, secondStore.id]) {
      await caller.storePrices.upsert({ storeId, productId: product.id, retailPriceKgs: 0, wholesalePriceKgs: 800 });
      expect((await caller.posTools.options({ storeId })).priceTypesEnabled).toBe(false);
    }

    const enabled = await caller.orgSettings.updateBusinessProfile({
      organizationName: org.name, storeId: store.id, retailWholesaleEnabled: true,
    });
    expect(enabled.organization.retailWholesaleEnabled).toBe(true);
    const pricing = await caller.products.storePricing({ productId: product.id });
    expect(pricing.stores).toHaveLength(2);
    expect(pricing.stores.every((row) => row.retailWholesaleEnabled)).toBe(true);
    for (const storeId of [store.id, secondStore.id]) {
      expect((await caller.orgSettings.getBusinessProfile({ storeId })).organization.retailWholesaleEnabled).toBe(true);
      expect((await caller.posTools.options({ storeId })).priceTypesEnabled).toBe(true);
      const prices = await caller.products.list({ storeId, priceMode: "WHOLESALE" });
      expect(prices.items.find((item) => item.id === product.id)?.effectivePriceKgs).toBe(800);
      const retail = await caller.products.list({ storeId, priceMode: "RETAIL" });
      expect(retail.items.find((item) => item.id === product.id)?.effectivePriceKgs).toBe(0);
    }
    // The legacy column follows the organization, including stores created later.
    const laterStore = await prisma.store.create({
      data: { organizationId: org.id, name: "Later Store", code: "LATER" },
    });
    expect(laterStore.retailWholesaleEnabled).toBe(true);
    const oldWriter = await prisma.store.update({ where: { id: secondStore.id }, data: { retailWholesaleEnabled: false } });
    expect(oldWriter.retailWholesaleEnabled).toBe(true);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: otherOrg.id } })).retailWholesaleEnabled).toBe(false);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: otherStore.id } })).retailWholesaleEnabled).toBe(false);
    await expect(caller.orgSettings.updateBusinessProfile({
      organizationName: org.name, storeId: otherStore.id, retailWholesaleEnabled: false,
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await caller.orgSettings.getBusinessProfile()).organization.retailWholesaleEnabled).toBe(true);

    // An older client that omits the optional field must not disable the setting.
    await caller.orgSettings.updateBusinessProfile({ organizationName: org.name, storeId: secondStore.id });
    expect((await caller.orgSettings.getBusinessProfile()).organization.retailWholesaleEnabled).toBe(true);
    await caller.orgSettings.updateBusinessProfile({
      organizationName: org.name, storeId: secondStore.id, retailWholesaleEnabled: false,
    });
    for (const storeId of [store.id, secondStore.id, laterStore.id]) {
      expect((await caller.posTools.options({ storeId })).priceTypesEnabled).toBe(false);
      expect((await prisma.store.findUniqueOrThrow({ where: { id: storeId } })).retailWholesaleEnabled).toBe(false);
    }
    const disabled = await caller.products.list({ storeId: secondStore.id, priceMode: "WHOLESALE" });
    expect(disabled.items.find((item) => item.id === product.id)?.effectivePriceKgs).toBe(1000);
    const savedPrices = await prisma.storePriceTypes.findMany({ where: { organizationId: org.id } });
    expect(savedPrices).toHaveLength(2);
    for (const prices of savedPrices) {
      expect(prices.retailPriceKgs?.toNumber()).toBe(0);
      expect(prices.wholesalePriceKgs?.toNumber()).toBe(800);
    }
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: org.id, action: "BUSINESS_PROFILE_UPDATE" }, orderBy: { createdAt: "desc" },
    });
    expect(audit.after).toMatchObject({ organization: { retailWholesaleEnabled: false } });
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

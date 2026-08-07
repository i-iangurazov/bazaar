import { MobilePlatform } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import {
  decryptMobilePushToken,
  disableMobileDevice,
  hashMobilePushToken,
  listMobilePushTargets,
  registerMobileDevice,
} from "@/server/services/mobileDevices";
import { sendMobilePushToUsers } from "@/server/services/mobilePush";

import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("native mobile device registrations", () => {
  beforeEach(async () => {
    process.env.NEXTAUTH_SECRET = "mobile-device-tests-secret";
    process.env.MOBILE_PUSH_MODE = "mock";
    await resetDatabase();
  });

  it("encrypts tokens, replays one installation, and never returns a token", async () => {
    const { org, adminUser } = await seedBase();
    const input = {
      userId: adminUser.id,
      organizationId: org.id,
      installationId: "installation-admin-0001",
      platform: MobilePlatform.IOS,
      token: "apns-token-secret-0001",
      appVersion: "1.0.0",
      buildNumber: "1",
      deviceName: "iPhone",
      osVersion: "18.5",
    };
    const first = await registerMobileDevice(prisma, input);
    const replay = await registerMobileDevice(prisma, { ...input, appVersion: "1.0.1" });
    expect(replay.id).toBe(first.id);
    expect(JSON.stringify(first)).not.toContain(input.token);

    const row = await prisma.mobileDevice.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.tokenEncrypted).not.toContain(input.token);
    expect(row.tokenHash).toBe(hashMobilePushToken(input.token));
    expect(decryptMobilePushToken(row.tokenEncrypted)).toBe(input.token);
    expect(row.appVersion).toBe("1.0.1");
    expect(await prisma.mobileDevice.count()).toBe(1);
  });

  it("moves a shared installation to the current user without cross-user pushes", async () => {
    const { org, adminUser, cashierUser } = await seedBase();
    await registerMobileDevice(prisma, {
      userId: adminUser.id,
      organizationId: org.id,
      installationId: "shared-installation-0001",
      platform: MobilePlatform.ANDROID,
      token: "fcm-token-admin-0001",
      appVersion: "1.0.0",
      buildNumber: "1",
    });
    await registerMobileDevice(prisma, {
      userId: cashierUser.id,
      organizationId: org.id,
      installationId: "shared-installation-0001",
      platform: MobilePlatform.ANDROID,
      token: "fcm-token-cashier-0002",
      appVersion: "1.0.0",
      buildNumber: "1",
    });

    const rows = await prisma.mobileDevice.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.userId === adminUser.id)?.enabled).toBe(false);
    expect(rows.find((row) => row.userId === cashierUser.id)?.enabled).toBe(true);
    await expect(
      listMobilePushTargets(prisma, { organizationId: org.id, userIds: [adminUser.id] }),
    ).resolves.toEqual([]);
    const cashierTargets = await listMobilePushTargets(prisma, {
      organizationId: org.id,
      userIds: [cashierUser.id],
    });
    expect(cashierTargets).toMatchObject([
      { userId: cashierUser.id, token: "fcm-token-cashier-0002" },
    ]);
  });

  it("scopes disable and push delivery by organization and user", async () => {
    const first = await seedBase();
    const secondOrg = await prisma.organization.create({ data: { name: "Other org" } });
    const secondUser = await prisma.user.create({
      data: {
        organizationId: secondOrg.id,
        email: "other-mobile@test.local",
        name: "Other user",
        passwordHash: "hash",
        role: "ADMIN",
      },
    });
    await registerMobileDevice(prisma, {
      userId: first.adminUser.id,
      organizationId: first.org.id,
      installationId: "installation-scope-0001",
      platform: MobilePlatform.IOS,
      token: "apns-scope-token-0001",
      appVersion: "1.0.0",
      buildNumber: "1",
    });
    await disableMobileDevice(prisma, {
      userId: secondUser.id,
      organizationId: secondOrg.id,
      installationId: "installation-scope-0001",
    });
    expect(await prisma.mobileDevice.count({ where: { enabled: true } })).toBe(1);

    const sent = await sendMobilePushToUsers(prisma, {
      organizationId: first.org.id,
      userIds: [first.adminUser.id, secondUser.id],
      payload: {
        title: "New order",
        body: "SO-1",
        path: "/sales/orders/order-1",
        category: "ORDER",
      },
    });
    expect(sent).toEqual({ status: "mocked", targeted: 1, sent: 1 });
  });

  it("rejects a stale or forged user/organization principal without storing a token", async () => {
    const first = await seedBase();
    const other = await prisma.organization.create({ data: { name: "Foreign org" } });

    await expect(
      registerMobileDevice(prisma, {
        userId: first.adminUser.id,
        organizationId: other.id,
        installationId: "forged-installation-0001",
        platform: MobilePlatform.ANDROID,
        token: "forged-fcm-token-0001",
        appVersion: "1.0.0",
        buildNumber: "1",
      }),
    ).rejects.toThrow("mobileDevicePrincipalNotFound");
    expect(await prisma.mobileDevice.count()).toBe(0);
  });

  it("does not let an untrusted installation id disable another organization", async () => {
    const first = await seedBase();
    const secondOrg = await prisma.organization.create({ data: { name: "Second mobile org" } });
    const secondUser = await prisma.user.create({
      data: {
        organizationId: secondOrg.id,
        email: "second-mobile@test.local",
        name: "Second mobile user",
        passwordHash: "hash",
        role: "ADMIN",
      },
    });
    await registerMobileDevice(prisma, {
      userId: first.adminUser.id,
      organizationId: first.org.id,
      installationId: "shared-looking-installation-0001",
      platform: MobilePlatform.ANDROID,
      token: "first-organization-token-0001",
      appVersion: "1.0.0",
      buildNumber: "1",
    });
    await registerMobileDevice(prisma, {
      userId: secondUser.id,
      organizationId: secondOrg.id,
      installationId: "shared-looking-installation-0001",
      platform: MobilePlatform.ANDROID,
      token: "different-second-org-token-0002",
      appVersion: "1.0.0",
      buildNumber: "1",
    });

    const firstDevice = await prisma.mobileDevice.findFirstOrThrow({
      where: { organizationId: first.org.id },
    });
    const secondDevice = await prisma.mobileDevice.findFirstOrThrow({
      where: { organizationId: secondOrg.id },
    });
    expect(firstDevice.enabled).toBe(true);
    expect(secondDevice.enabled).toBe(true);
  });
});

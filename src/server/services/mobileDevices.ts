import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { MobilePlatform, type Prisma, type PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

const toBase64Url = (value: Buffer) => value.toString("base64url");
const fromBase64Url = (value: string) => Buffer.from(value, "base64url");

const tokenCipherKey = () => {
  const secret =
    process.env.MOBILE_PUSH_TOKEN_ENCRYPTION_SECRET?.trim() ||
    process.env.MARKET_TOKEN_ENCRYPTION_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    (process.env.NODE_ENV === "test" ? "bazaar-mobile-test-secret" : "");
  if (!secret) throw new Error("mobilePushEncryptionUnavailable");
  return createHash("sha256").update(secret).digest();
};

export const hashMobilePushToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export const encryptMobilePushToken = (token: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenCipherKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${toBase64Url(iv)}.${toBase64Url(tag)}.${toBase64Url(encrypted)}`;
};

export const decryptMobilePushToken = (value: string) => {
  const [version, ivPart, tagPart, encryptedPart] = value.split(".");
  if (version !== "v1" || !ivPart || !tagPart || !encryptedPart) {
    throw new Error("mobilePushTokenInvalid");
  }
  const decipher = createDecipheriv("aes-256-gcm", tokenCipherKey(), fromBase64Url(ivPart));
  decipher.setAuthTag(fromBase64Url(tagPart));
  return Buffer.concat([decipher.update(fromBase64Url(encryptedPart)), decipher.final()]).toString(
    "utf8",
  );
};

const bounded = (value: string | null | undefined, max: number) => {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, max) : null;
};

export const registerMobileDevice = async (
  db: PrismaClient,
  input: {
    userId: string;
    organizationId: string;
    installationId: string;
    platform: MobilePlatform;
    token: string;
    appVersion: string;
    buildNumber: string;
    deviceName?: string | null;
    osVersion?: string | null;
  },
) => {
  const token = input.token.trim();
  if (!token || token.length > 4096) throw new Error("mobilePushTokenInvalid");
  const tokenHash = hashMobilePushToken(token);
  const now = new Date();

  return db.$transaction(async (tx) => {
    const principal = await tx.user.findFirst({
      where: {
        id: input.userId,
        organizationId: input.organizationId,
        isActive: true,
      },
      select: { id: true },
    });
    if (!principal) throw new Error("mobileDevicePrincipalNotFound");

    // A physical installation or provider token can belong to only the currently
    // authenticated account. Disable stale registrations before the new upsert.
    await tx.mobileDevice.updateMany({
      where: {
        enabled: true,
        OR: [
          { tokenHash },
          { installationId: input.installationId, organizationId: input.organizationId },
        ],
        NOT: { userId: input.userId },
      },
      data: { enabled: false },
    });

    const device = await tx.mobileDevice.upsert({
      where: {
        userId_installationId: {
          userId: input.userId,
          installationId: input.installationId,
        },
      },
      create: {
        userId: input.userId,
        organizationId: input.organizationId,
        installationId: input.installationId,
        platform: input.platform,
        tokenEncrypted: encryptMobilePushToken(token),
        tokenHash,
        appVersion: input.appVersion,
        buildNumber: input.buildNumber,
        deviceName: bounded(input.deviceName, 120),
        osVersion: bounded(input.osVersion, 80),
        enabled: true,
        lastSeenAt: now,
      },
      update: {
        organizationId: input.organizationId,
        platform: input.platform,
        tokenEncrypted: encryptMobilePushToken(token),
        tokenHash,
        appVersion: input.appVersion,
        buildNumber: input.buildNumber,
        deviceName: bounded(input.deviceName, 120),
        osVersion: bounded(input.osVersion, 80),
        enabled: true,
        lastSeenAt: now,
      },
      select: { id: true, platform: true, enabled: true, lastSeenAt: true },
    });
    return device;
  });
};

export const disableMobileDevice = async (
  db: DbClient,
  input: { userId: string; organizationId: string; installationId: string },
) =>
  db.mobileDevice.updateMany({
    where: {
      userId: input.userId,
      organizationId: input.organizationId,
      installationId: input.installationId,
      enabled: true,
    },
    data: { enabled: false, lastSeenAt: new Date() },
  });

export const getMobileDeviceStatus = async (
  db: DbClient,
  input: { userId: string; organizationId: string; installationId: string },
) =>
  db.mobileDevice.findFirst({
    where: input,
    select: { platform: true, enabled: true, appVersion: true, lastSeenAt: true },
  });

export const listMobilePushTargets = async (
  db: DbClient,
  input: { organizationId: string; userIds: string[] },
) => {
  if (!input.userIds.length) return [];
  const rows = await db.mobileDevice.findMany({
    where: {
      organizationId: input.organizationId,
      userId: { in: input.userIds },
      enabled: true,
    },
    select: {
      id: true,
      userId: true,
      platform: true,
      tokenEncrypted: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    platform: row.platform,
    token: decryptMobilePushToken(row.tokenEncrypted),
  }));
};

export { MobilePlatform };

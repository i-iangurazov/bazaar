import { createHash } from "node:crypto";

import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";

import { authenticatedAuthLifecycleFixture } from "../tests/e2e/authenticated/auth-lifecycle-contract";
import {
  authenticatedE2EAccounts,
  authenticatedE2ESeedPrefix,
} from "../tests/e2e/authenticated/contract";

const tokenHash = (raw: string) => createHash("sha256").update(raw).digest("hex");

const cleanupPriorOpenSignupLifecycle = async (prisma: PrismaClient) => {
  const fixture = authenticatedAuthLifecycleFixture.signup;
  const priorUser = await prisma.user.findUnique({
    where: { email: fixture.email },
    select: {
      id: true,
      email: true,
      name: true,
      organizationId: true,
      organization: {
        select: {
          id: true,
          name: true,
          users: { select: { id: true } },
          stores: { select: { id: true, name: true, code: true } },
        },
      },
    },
  });
  if (!priorUser) return;

  if (
    priorUser.email !== fixture.email ||
    priorUser.name !== fixture.name ||
    (priorUser.organization &&
      (priorUser.organization.name !== fixture.organizationName ||
        priorUser.organization.users.some((user) => user.id !== priorUser.id) ||
        priorUser.organization.stores.length !== 1 ||
        priorUser.organization.stores[0]?.name !== fixture.storeName ||
        priorUser.organization.stores[0]?.code !== fixture.normalizedStoreCode))
  ) {
    throw new Error(`Refusing to clean non-QA open-signup lifecycle user ${priorUser.id}.`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.authToken.deleteMany({ where: { userId: priorUser.id } });
    await tx.userStoreAccess.deleteMany({ where: { userId: priorUser.id } });
    if (priorUser.organizationId) {
      await tx.auditLog.deleteMany({ where: { organizationId: priorUser.organizationId } });
      await tx.user.update({
        where: { id: priorUser.id },
        data: { organizationId: null, isOrgOwner: false },
      });
      await tx.store.deleteMany({ where: { organizationId: priorUser.organizationId } });
      await tx.organization.delete({ where: { id: priorUser.organizationId } });
    }
    await tx.user.delete({ where: { id: priorUser.id } });
  });
};

const assertAuthLifecycleOwnership = async (prisma: PrismaClient) => {
  const fixture = authenticatedAuthLifecycleFixture;
  const expectedUsers = [fixture.reset, fixture.verify, fixture.invite];
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { id: { in: expectedUsers.map((user) => user.userId) } },
        { email: { in: expectedUsers.map((user) => user.email) } },
      ],
    },
    select: { id: true, email: true, name: true, organizationId: true },
  });
  for (const user of users) {
    const expected = expectedUsers.find(
      (candidate) => candidate.userId === user.id || candidate.email === user.email,
    );
    if (
      !expected ||
      user.id !== expected.userId ||
      user.email !== expected.email ||
      !user.name.startsWith(authenticatedE2ESeedPrefix) ||
      (user.organizationId !== null && user.organizationId !== fixture.organizationId)
    ) {
      throw new Error(`Refusing to overwrite non-QA auth lifecycle user ${user.id}.`);
    }
  }

  const hashes = [
    tokenHash(fixture.reset.rawToken),
    tokenHash(fixture.verify.rawToken),
    tokenHash(fixture.invite.rawToken),
  ];
  const [authTokens, invites, creator] = await Promise.all([
    prisma.authToken.findMany({
      where: {
        OR: [
          { id: { in: [fixture.reset.tokenId, fixture.verify.tokenId] } },
          { tokenHash: { in: hashes.slice(0, 2) } },
        ],
      },
      select: { id: true, email: true, tokenHash: true, userId: true },
    }),
    prisma.inviteToken.findMany({
      where: {
        OR: [{ id: fixture.invite.inviteId }, { tokenHash: hashes[2] }],
      },
      select: { id: true, email: true, tokenHash: true, organizationId: true },
    }),
    prisma.user.findUnique({
      where: { email: authenticatedE2EAccounts.admin.email },
      select: { id: true, organizationId: true, name: true },
    }),
  ]);
  const expectedAuthTokens = new Map([
    [
      fixture.reset.tokenId,
      { email: fixture.reset.email, hash: hashes[0], userId: fixture.reset.userId },
    ],
    [
      fixture.verify.tokenId,
      { email: fixture.verify.email, hash: hashes[1], userId: fixture.verify.userId },
    ],
  ]);
  for (const token of authTokens) {
    const expected = expectedAuthTokens.get(token.id);
    if (
      !expected ||
      token.email !== expected.email ||
      token.tokenHash !== expected.hash ||
      token.userId !== expected.userId
    ) {
      throw new Error(`Refusing to overwrite non-QA auth token ${token.id}.`);
    }
  }
  for (const invite of invites) {
    if (
      invite.id !== fixture.invite.inviteId ||
      invite.email !== fixture.invite.email ||
      invite.tokenHash !== hashes[2] ||
      invite.organizationId !== fixture.organizationId
    ) {
      throw new Error(`Refusing to overwrite non-QA invite ${invite.id}.`);
    }
  }
  if (
    !creator ||
    creator.organizationId !== fixture.organizationId ||
    !creator.name.startsWith(authenticatedE2ESeedPrefix)
  ) {
    throw new Error("Auth lifecycle fixture requires the primary QA administrator.");
  }
  return creator.id;
};

export const seedAuthenticatedAuthLifecycleFixtures = async (prisma: PrismaClient) => {
  await cleanupPriorOpenSignupLifecycle(prisma);
  const creatorId = await assertAuthLifecycleOwnership(prisma);
  const fixture = authenticatedAuthLifecycleFixture;
  const [resetPasswordHash, verifyPasswordHash, invitePasswordHash] = await Promise.all([
    bcrypt.hash(fixture.reset.initialPassword, 10),
    bcrypt.hash(fixture.verify.password, 10),
    bcrypt.hash(fixture.invite.password, 10),
  ]);
  const expiresAt = new Date("2099-12-31T23:59:59.000Z");

  await prisma.$transaction(async (tx) => {
    await tx.authToken.deleteMany({
      where: {
        email: { in: [fixture.reset.email, fixture.verify.email, fixture.invite.email] },
      },
    });
    await tx.userStoreAccess.deleteMany({ where: { userId: fixture.invite.userId } });
    await tx.auditLog.deleteMany({
      where: {
        OR: [
          { entity: "InviteToken", entityId: fixture.invite.inviteId },
          { entity: "User", entityId: { in: [fixture.reset.userId, fixture.verify.userId] } },
        ],
      },
    });

    await tx.user.upsert({
      where: { id: fixture.reset.userId },
      create: {
        id: fixture.reset.userId,
        organizationId: fixture.organizationId,
        email: fixture.reset.email,
        name: fixture.reset.name,
        passwordHash: resetPasswordHash,
        role: "STAFF",
        preferredLocale: "en",
        emailVerifiedAt: new Date("2026-08-31T00:00:00.000Z"),
      },
      update: {
        organizationId: fixture.organizationId,
        email: fixture.reset.email,
        name: fixture.reset.name,
        passwordHash: resetPasswordHash,
        role: "STAFF",
        preferredLocale: "en",
        emailVerifiedAt: new Date("2026-08-31T00:00:00.000Z"),
        isActive: true,
      },
    });
    await tx.user.upsert({
      where: { id: fixture.verify.userId },
      create: {
        id: fixture.verify.userId,
        organizationId: fixture.organizationId,
        email: fixture.verify.email,
        name: fixture.verify.name,
        passwordHash: verifyPasswordHash,
        role: "STAFF",
        preferredLocale: "en",
        emailVerifiedAt: null,
      },
      update: {
        organizationId: fixture.organizationId,
        email: fixture.verify.email,
        name: fixture.verify.name,
        passwordHash: verifyPasswordHash,
        role: "STAFF",
        preferredLocale: "en",
        emailVerifiedAt: null,
        isActive: true,
      },
    });
    await tx.user.upsert({
      where: { id: fixture.invite.userId },
      create: {
        id: fixture.invite.userId,
        organizationId: null,
        email: fixture.invite.email,
        name: fixture.invite.seededName,
        passwordHash: invitePasswordHash,
        role: fixture.invite.role,
        preferredLocale: "en",
        emailVerifiedAt: null,
      },
      update: {
        organizationId: null,
        email: fixture.invite.email,
        name: fixture.invite.seededName,
        passwordHash: invitePasswordHash,
        role: fixture.invite.role,
        preferredLocale: "en",
        emailVerifiedAt: null,
        isActive: true,
      },
    });

    await tx.authToken.createMany({
      data: [
        {
          id: fixture.reset.tokenId,
          userId: fixture.reset.userId,
          email: fixture.reset.email,
          type: "PASSWORD_RESET",
          tokenHash: tokenHash(fixture.reset.rawToken),
          expiresAt,
          usedAt: null,
        },
        {
          id: fixture.verify.tokenId,
          userId: fixture.verify.userId,
          email: fixture.verify.email,
          type: "EMAIL_VERIFY",
          tokenHash: tokenHash(fixture.verify.rawToken),
          expiresAt,
          usedAt: null,
        },
      ],
    });
    await tx.inviteToken.upsert({
      where: { id: fixture.invite.inviteId },
      create: {
        id: fixture.invite.inviteId,
        organizationId: fixture.organizationId,
        email: fixture.invite.email,
        role: fixture.invite.role,
        storeIds: [fixture.storeId],
        tokenHash: tokenHash(fixture.invite.rawToken),
        expiresAt,
        createdById: creatorId,
        acceptedAt: null,
      },
      update: {
        organizationId: fixture.organizationId,
        email: fixture.invite.email,
        role: fixture.invite.role,
        storeIds: [fixture.storeId],
        tokenHash: tokenHash(fixture.invite.rawToken),
        expiresAt,
        createdById: creatorId,
        acceptedAt: null,
      },
    });
  });
};

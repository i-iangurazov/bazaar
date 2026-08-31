import { createHash } from "node:crypto";

import bcrypt from "bcryptjs";
import type { Prisma, PrismaClient } from "@prisma/client";

import { authenticatedEmployeeInvitationFixture } from "../tests/e2e/authenticated/employee-invitation-contract";
import { authenticatedE2ESeedPrefix } from "../tests/e2e/authenticated/contract";

const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");

const jsonEmail = (value: Prisma.JsonValue | null) => {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const email = (value as Prisma.JsonObject).email;
  return typeof email === "string" ? email : null;
};

const assertEmployeeInvitationBaseOwnership = async (prisma: PrismaClient) => {
  const fixture = authenticatedEmployeeInvitationFixture;
  const [organization, stores, creator] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: fixture.organizationId },
      select: { id: true, name: true },
    }),
    prisma.store.findMany({
      where: { id: { in: [fixture.assignedStoreId, fixture.deniedStoreId] } },
      select: { id: true, organizationId: true, name: true },
    }),
    prisma.user.findUnique({
      where: { email: fixture.creatorEmail },
      select: { id: true, organizationId: true, name: true },
    }),
  ]);

  if (!organization || !organization.name.startsWith(authenticatedE2ESeedPrefix)) {
    throw new Error("Employee-invitation fixtures require the primary QA organization.");
  }
  if (
    stores.length !== 2 ||
    stores.some(
      (store) =>
        store.organizationId !== fixture.organizationId ||
        !store.name.startsWith(authenticatedE2ESeedPrefix),
    )
  ) {
    throw new Error("Employee-invitation fixtures require both owned QA stores.");
  }
  if (
    !creator ||
    creator.id !== fixture.creatorId ||
    creator.organizationId !== fixture.organizationId ||
    !creator.name.startsWith(authenticatedE2ESeedPrefix)
  ) {
    throw new Error("Employee-invitation fixtures require the primary QA administrator.");
  }
  return creator.id;
};

const loadOwnedEmployeeInvitationRecords = async (prisma: PrismaClient) => {
  const fixture = authenticatedEmployeeInvitationFixture;
  const invited = fixture.invitedUser;
  const expired = fixture.expiredInvite;
  const expiredTokenHash = tokenHash(expired.rawToken);
  const [users, invites, authTokens] = await Promise.all([
    prisma.user.findMany({
      where: { OR: [{ id: invited.id }, { email: invited.email }] },
      select: {
        id: true,
        email: true,
        name: true,
        organizationId: true,
        role: true,
      },
    }),
    prisma.inviteToken.findMany({
      where: {
        OR: [
          { id: expired.id },
          { email: { in: [invited.email, expired.email] } },
          { tokenHash: expiredTokenHash },
        ],
      },
      select: {
        id: true,
        organizationId: true,
        email: true,
        role: true,
        storeIds: true,
        tokenHash: true,
        createdById: true,
      },
    }),
    prisma.authToken.findMany({
      where: { OR: [{ userId: invited.id }, { email: invited.email }] },
      select: { id: true, userId: true, email: true },
    }),
  ]);

  for (const user of users) {
    if (
      user.id !== invited.id ||
      user.email !== invited.email ||
      user.name !== invited.name ||
      (user.organizationId !== null && user.organizationId !== fixture.organizationId) ||
      (user.role !== invited.initialRole && user.role !== invited.assignedRole)
    ) {
      throw new Error(`Refusing employee-invitation user ownership collision ${user.id}.`);
    }
  }

  for (const invite of invites) {
    const isExpiredFixture = invite.email === expired.email || invite.id === expired.id;
    const expectedRole = isExpiredFixture ? expired.role : invited.assignedRole;
    if (
      (invite.email !== invited.email && invite.email !== expired.email) ||
      invite.organizationId !== fixture.organizationId ||
      invite.createdById !== fixture.creatorId ||
      invite.role !== expectedRole ||
      invite.storeIds.length !== 1 ||
      invite.storeIds[0] !== fixture.assignedStoreId ||
      !/^[a-f0-9]{64}$/.test(invite.tokenHash)
    ) {
      throw new Error(`Refusing employee-invitation token ownership collision ${invite.id}.`);
    }
    if (
      isExpiredFixture &&
      (invite.id !== expired.id ||
        invite.email !== expired.email ||
        invite.tokenHash !== expiredTokenHash)
    ) {
      throw new Error(`Refusing expired employee-invitation token collision ${invite.id}.`);
    }
  }

  for (const authToken of authTokens) {
    if (authToken.userId !== invited.id || authToken.email !== invited.email) {
      throw new Error(`Refusing employee-invitation auth-token collision ${authToken.id}.`);
    }
  }

  return { users, invites, authTokens };
};

export const cleanupAuthenticatedEmployeeInvitationFixtures = async (prisma: PrismaClient) => {
  const fixture = authenticatedEmployeeInvitationFixture;
  const { users, invites } = await loadOwnedEmployeeInvitationRecords(prisma);
  const inviteIds = invites.map((invite) => invite.id);
  const possibleAudits = inviteIds.length
    ? await prisma.auditLog.findMany({
        where: {
          entity: "InviteToken",
          entityId: { in: inviteIds },
        },
        select: {
          id: true,
          organizationId: true,
          actorId: true,
          action: true,
          entityId: true,
          after: true,
        },
      })
    : [];
  const qaEmails = new Set<string>([fixture.invitedUser.email, fixture.expiredInvite.email]);
  for (const audit of possibleAudits) {
    if (
      audit.organizationId !== fixture.organizationId ||
      audit.actorId !== fixture.creatorId ||
      (audit.action !== "INVITE_CREATE" && audit.action !== "INVITE_ACCEPT") ||
      !qaEmails.has(jsonEmail(audit.after) ?? "")
    ) {
      throw new Error(`Refusing employee-invitation audit collision ${audit.id}.`);
    }
  }

  await prisma.$transaction(async (tx) => {
    if (possibleAudits.length) {
      await tx.auditLog.deleteMany({
        where: { id: { in: possibleAudits.map((audit) => audit.id) } },
      });
    }
    await tx.authToken.deleteMany({
      where: { OR: [{ userId: fixture.invitedUser.id }, { email: fixture.invitedUser.email }] },
    });
    await tx.userStoreAccess.deleteMany({ where: { userId: fixture.invitedUser.id } });
    if (inviteIds.length) {
      await tx.inviteToken.deleteMany({ where: { id: { in: inviteIds } } });
    }
    if (users.length) {
      await tx.user.deleteMany({ where: { id: fixture.invitedUser.id } });
    }
  });

  const residue = await Promise.all([
    prisma.user.count({
      where: { OR: [{ id: fixture.invitedUser.id }, { email: fixture.invitedUser.email }] },
    }),
    prisma.inviteToken.count({
      where: {
        OR: [
          { id: fixture.expiredInvite.id },
          { email: { in: [fixture.invitedUser.email, fixture.expiredInvite.email] } },
          { tokenHash: tokenHash(fixture.expiredInvite.rawToken) },
        ],
      },
    }),
    prisma.authToken.count({
      where: {
        OR: [{ userId: fixture.invitedUser.id }, { email: fixture.invitedUser.email }],
      },
    }),
    prisma.userStoreAccess.count({ where: { userId: fixture.invitedUser.id } }),
    possibleAudits.length
      ? prisma.auditLog.count({ where: { id: { in: possibleAudits.map((audit) => audit.id) } } })
      : Promise.resolve(0),
  ]);
  if (residue.some((count) => count !== 0)) {
    throw new Error("Employee-invitation cleanup left QA-owned database residue.");
  }
};

export const prepareAuthenticatedEmployeeInvitationFixtures = async (prisma: PrismaClient) => {
  const fixture = authenticatedEmployeeInvitationFixture;
  const creatorId = await assertEmployeeInvitationBaseOwnership(prisma);
  await cleanupAuthenticatedEmployeeInvitationFixtures(prisma);
  const passwordHash = await bcrypt.hash(fixture.invitedUser.password, 10);

  await prisma.$transaction(async (tx) => {
    await tx.user.create({
      data: {
        id: fixture.invitedUser.id,
        organizationId: null,
        email: fixture.invitedUser.email,
        name: fixture.invitedUser.name,
        passwordHash,
        role: fixture.invitedUser.initialRole,
        preferredLocale: fixture.invitedUser.preferredLocale,
        isActive: true,
        emailVerifiedAt: new Date("2026-08-31T00:00:00.000Z"),
      },
    });
    await tx.inviteToken.create({
      data: {
        id: fixture.expiredInvite.id,
        organizationId: fixture.organizationId,
        email: fixture.expiredInvite.email,
        role: fixture.expiredInvite.role,
        storeIds: [fixture.assignedStoreId],
        tokenHash: tokenHash(fixture.expiredInvite.rawToken),
        expiresAt: fixture.expiredInvite.expiresAt,
        createdById: creatorId,
        acceptedAt: null,
      },
    });
  });
};

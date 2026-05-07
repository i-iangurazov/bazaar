import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";
import { assertWithinLimits } from "@/server/services/planLimits";
import { isEmailVerificationRequired } from "@/server/config/auth";

const INVITE_TTL_DAYS = 7;

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

const createRawToken = () => randomBytes(24).toString("hex");

type InviteRole = "ADMIN" | "MANAGER" | "STAFF" | "CASHIER";

const roleUsesStoreAssignments = (role: InviteRole) => role !== "ADMIN";

const resolveInviteStoreIds = async (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    role: InviteRole;
    storeIds?: string[];
  },
) => {
  if (!roleUsesStoreAssignments(input.role)) {
    return [];
  }

  const storeIds = Array.from(new Set(input.storeIds?.filter(Boolean) ?? []));
  if (!storeIds.length) {
    return [];
  }

  const stores = await tx.store.findMany({
    where: { organizationId: input.organizationId, id: { in: storeIds } },
    select: { id: true },
  });
  if (stores.length !== storeIds.length) {
    throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
  }

  return storeIds;
};

export const createInvite = async (input: {
  organizationId: string;
  createdById: string;
  requestId: string;
  email: string;
  role: InviteRole;
  storeIds?: string[];
}) => {
  await assertWithinLimits({ organizationId: input.organizationId, kind: "users" });
  return prisma.$transaction(async (tx) => {
    const existingUser = await tx.user.findUnique({ where: { email: input.email } });
    if (existingUser) {
      throw new AppError("emailInUse", "CONFLICT", 409);
    }

    const rawToken = createRawToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const storeIds = await resolveInviteStoreIds(tx, {
      organizationId: input.organizationId,
      role: input.role,
      storeIds: input.storeIds,
    });

    const invite = await tx.inviteToken.create({
      data: {
        organizationId: input.organizationId,
        email: input.email,
        role: input.role,
        storeIds,
        tokenHash,
        createdById: input.createdById,
        expiresAt,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.createdById,
      action: "INVITE_CREATE",
      entity: "InviteToken",
      entityId: invite.id,
      after: toJson({ email: invite.email, role: invite.role, storeIds, expiresAt }),
      requestId: input.requestId,
    });

    return { invite, token: rawToken };
  });
};

export const getInviteByToken = async (token: string) => {
  const tokenHash = hashToken(token);
  const invite = await prisma.inviteToken.findUnique({
    where: { tokenHash },
    include: {
      organization: { select: { id: true, name: true } },
    },
  });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    throw new AppError("inviteInvalid", "NOT_FOUND", 404);
  }
  return invite;
};

export const acceptInvite = async (input: {
  token: string;
  name: string;
  password: string;
  preferredLocale: string;
  requestId: string;
}) =>
  prisma.$transaction(async (tx) => {
    const tokenHash = hashToken(input.token);
    const invite = await tx.inviteToken.findUnique({
      where: { tokenHash },
      include: { organization: true },
    });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      throw new AppError("inviteInvalid", "NOT_FOUND", 404);
    }

    const existingUser = await tx.user.findUnique({ where: { email: invite.email } });
    if (existingUser) {
      throw new AppError("emailInUse", "CONFLICT", 409);
    }

    await assertWithinLimits({ organizationId: invite.organizationId, kind: "users" });

    const passwordHash = await bcrypt.hash(input.password, 10);
    const emailVerifiedAt = isEmailVerificationRequired() ? null : new Date();
    const user = await tx.user.create({
      data: {
        organizationId: invite.organizationId,
        email: invite.email,
        name: input.name,
        role: invite.role,
        passwordHash,
        preferredLocale: input.preferredLocale,
        emailVerifiedAt,
      },
    });
    if (roleUsesStoreAssignments(invite.role) && invite.storeIds.length) {
      const storeIds = await resolveInviteStoreIds(tx, {
        organizationId: invite.organizationId,
        role: invite.role,
        storeIds: invite.storeIds,
      });
      await tx.userStoreAccess.createMany({
        data: storeIds.map((storeId) => ({
          organizationId: invite.organizationId,
          userId: user.id,
          storeId,
        })),
        skipDuplicates: true,
      });
    }

    const updatedInvite = await tx.inviteToken.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });

    await writeAuditLog(tx, {
      organizationId: invite.organizationId,
      actorId: invite.createdById,
      action: "INVITE_ACCEPT",
      entity: "InviteToken",
      entityId: updatedInvite.id,
      before: toJson(invite),
      after: toJson(updatedInvite),
      requestId: input.requestId,
    });

    const { passwordHash: _passwordHash, ...safeUser } = user;
    void _passwordHash;

    return safeUser;
  });

import bcrypt from "bcryptjs";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";
import { assertWithinLimits } from "@/server/services/planLimits";

const sanitizeUserAudit = <T extends { passwordHash?: string }>(user: T | null) => {
  if (!user) {
    return null;
  }
  const { passwordHash: _passwordHash, ...safeUser } = user;
  void _passwordHash;
  return safeUser;
};

export type CreateUserInput = {
  organizationId: string;
  actorId: string;
  requestId: string;
  email: string;
  name: string;
  role: "ADMIN" | "MANAGER" | "STAFF";
  password: string;
  preferredLocale: string;
};

export const createUser = async (input: CreateUserInput) =>
  prisma.$transaction(async (tx) => {
    await assertWithinLimits({ organizationId: input.organizationId, kind: "users" });
    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = await tx.user.create({
      data: {
        organizationId: input.organizationId,
        email: input.email,
        name: input.name,
        role: input.role,
        passwordHash,
        preferredLocale: input.preferredLocale,
        emailVerifiedAt: new Date(),
      },
    });

    const { passwordHash: _passwordHash, ...safeUser } = user;
    void _passwordHash;

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "USER_CREATE",
      entity: "User",
      entityId: user.id,
      before: null,
      after: toJson(safeUser),
      requestId: input.requestId,
    });

    return safeUser;
  });

export type UpdatePreferredLocaleInput = {
  userId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
  locale: string;
};

export const updatePreferredLocale = async (input: UpdatePreferredLocaleInput) =>
  prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: input.userId } });
    if (!before || before.organizationId !== input.organizationId) {
      throw new AppError("userNotFound", "NOT_FOUND", 404);
    }

    const updated = await tx.user.update({
      where: { id: input.userId },
      data: { preferredLocale: input.locale },
    });

    const { passwordHash: _passwordHash, ...safeUser } = updated;
    void _passwordHash;

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "USER_LOCALE_UPDATE",
      entity: "User",
      entityId: updated.id,
      before: toJson(sanitizeUserAudit(before)),
      after: toJson(safeUser),
      requestId: input.requestId,
    });

    return safeUser;
  });

export type UpdateUserInput = {
  userId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
  email: string;
  name: string;
  role: "ADMIN" | "MANAGER" | "STAFF";
  preferredLocale: string;
};

export const updateUser = async (input: UpdateUserInput) =>
  prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: input.userId } });
    if (!before || before.organizationId !== input.organizationId) {
      throw new AppError("userNotFound", "NOT_FOUND", 404);
    }

    if (before.id === input.actorId && before.role === "ADMIN" && input.role !== "ADMIN") {
      throw new AppError("cannotDemoteSelf", "BAD_REQUEST", 400);
    }

    const updated = await tx.user.update({
      where: { id: input.userId },
      data: {
        email: input.email,
        name: input.name,
        role: input.role,
        preferredLocale: input.preferredLocale,
      },
    });

    const { passwordHash: _passwordHash, ...safeUser } = updated;
    void _passwordHash;

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "USER_UPDATE",
      entity: "User",
      entityId: updated.id,
      before: toJson(sanitizeUserAudit(before)),
      after: toJson(safeUser),
      requestId: input.requestId,
    });

    return safeUser;
  });

export type SetUserActiveInput = {
  userId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
  isActive: boolean;
};

export const setUserActive = async (input: SetUserActiveInput) =>
  prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: input.userId } });
    if (!before || before.organizationId !== input.organizationId) {
      throw new AppError("userNotFound", "NOT_FOUND", 404);
    }

    if (before.id === input.actorId && !input.isActive) {
      throw new AppError("cannotDeactivateSelf", "BAD_REQUEST", 400);
    }

    const updated = await tx.user.update({
      where: { id: input.userId },
      data: { isActive: input.isActive },
    });

    const { passwordHash: _passwordHash, ...safeUser } = updated;
    void _passwordHash;

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "USER_STATUS_UPDATE",
      entity: "User",
      entityId: updated.id,
      before: toJson(sanitizeUserAudit(before)),
      after: toJson(safeUser),
      requestId: input.requestId,
    });

    return safeUser;
  });

export type ResetUserPasswordInput = {
  userId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
  password: string;
};

export const resetUserPassword = async (input: ResetUserPasswordInput) =>
  prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: input.userId } });
    if (!before || before.organizationId !== input.organizationId) {
      throw new AppError("userNotFound", "NOT_FOUND", 404);
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    const updated = await tx.user.update({
      where: { id: input.userId },
      data: { passwordHash },
    });

    const { passwordHash: _passwordHash, ...safeUser } = updated;
    void _passwordHash;

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "USER_PASSWORD_RESET",
      entity: "User",
      entityId: updated.id,
      before: toJson(sanitizeUserAudit(before)),
      after: toJson(safeUser),
      requestId: input.requestId,
    });

    return safeUser;
  });

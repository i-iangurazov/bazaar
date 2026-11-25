import { Prisma, type ThemePreference } from "@prisma/client";
import bcrypt from "bcryptjs";

import { normalizeLoginPhone } from "@/lib/loginPhone";
import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";

type UserSettingsScope = {
  userId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
};

type UpdateMyProfileInput = UserSettingsScope & {
  name: string;
  phone?: string | null;
  jobTitle?: string | null;
};

type UpdateMyPreferencesInput = UserSettingsScope & {
  preferredLocale?: string;
  themePreference?: ThemePreference;
};

const normalizeOptional = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const sanitizeUser = <T extends { passwordHash?: string }>(user: T) => {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  void _passwordHash;
  return safeUser;
};

export const getMyProfile = async (input: Pick<UserSettingsScope, "userId" | "organizationId">) => {
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user || user.deletedAt || user.organizationId !== input.organizationId) {
    throw new AppError("userNotFound", "NOT_FOUND", 404);
  }
  return sanitizeUser(user);
};

const ownedUser = ({ userId, organizationId }: Pick<UserSettingsScope, "userId" | "organizationId">) => ({
  id: userId,
  organizationId,
  isActive: true,
  deletedAt: null,
});

export const getMyLoginPhone = async (input: Pick<UserSettingsScope, "userId" | "organizationId">) => {
  const user = await prisma.user.findFirst({
    where: ownedUser(input),
    select: { id: true, loginPhone: { select: { phone: true } } },
  });
  if (!user) throw new AppError("userNotFound", "NOT_FOUND", 404);
  return { userId: user.id, phone: user.loginPhone?.phone ?? null };
};

export const updateMyLoginPhone = async (input: UserSettingsScope & { phone: string | null; password: string }) => {
  const phone = normalizeLoginPhone(input.phone);
  if (input.phone !== null && !phone) throw new AppError("loginPhoneInvalid", "BAD_REQUEST", 400);

  const where = ownedUser(input);
  const observed = await prisma.user.findFirst({ where, select: { passwordHash: true, sessionVersion: true } });
  if (!observed) throw new AppError("userNotFound", "NOT_FOUND", 404);
  if (!await bcrypt.compare(input.password, observed.passwordHash)) {
    throw new AppError("accountPasswordIncorrect", "BAD_REQUEST", 400);
  }

  try {
    return await prisma.$transaction(async (tx) => {
      // Match the organization-first lock order of staff-account writers.
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${input.organizationId} FOR NO KEY UPDATE`;
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.userId} FOR UPDATE`;
      const user = await tx.user.findFirst({
        where,
        select: { passwordHash: true, sessionVersion: true, loginPhone: { select: { phone: true } } },
      });
      if (!user) throw new AppError("userNotFound", "NOT_FOUND", 404);
      if (user.passwordHash !== observed.passwordHash || user.sessionVersion !== observed.sessionVersion) {
        throw new AppError("accountPasswordIncorrect", "BAD_REQUEST", 400);
      }

      const previous = user.loginPhone?.phone ?? null;
      if (previous !== phone) {
        if (phone) {
          await tx.userLoginPhone.upsert({
            where: { userId: input.userId },
            create: { userId: input.userId, phone },
            update: { phone },
          });
        } else {
          await tx.userLoginPhone.delete({ where: { userId: input.userId } });
        }
        await writeAuditLog(tx, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: "USER_LOGIN_PHONE_UPDATE",
          entity: "User",
          entityId: input.userId,
          before: { enabled: Boolean(previous) },
          after: { enabled: Boolean(phone) },
          requestId: input.requestId,
        });
      }
      return { userId: input.userId, phone };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" &&
      Array.isArray(error.meta?.target) && error.meta.target.includes("phone")) {
      throw new AppError("loginPhoneInUse", "CONFLICT", 409);
    }
    throw error;
  }
};

export const updateMyProfile = async (input: UpdateMyProfileInput) =>
  prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: input.userId } });
    if (!before || before.deletedAt || before.organizationId !== input.organizationId) {
      throw new AppError("userNotFound", "NOT_FOUND", 404);
    }

    const updated = await tx.user.update({
      where: { id: input.userId },
      data: {
        name: input.name,
        phone: normalizeOptional(input.phone),
        jobTitle: normalizeOptional(input.jobTitle),
      },
    });

    const after = sanitizeUser(updated);

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "USER_PROFILE_UPDATE",
      entity: "User",
      entityId: updated.id,
      before: toJson(sanitizeUser(before)),
      after: toJson(after),
      requestId: input.requestId,
    });

    return after;
  });

export const updateMyPreferences = async (input: UpdateMyPreferencesInput) =>
  prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: input.userId } });
    if (!before || before.deletedAt || before.organizationId !== input.organizationId) {
      throw new AppError("userNotFound", "NOT_FOUND", 404);
    }

    const data: { preferredLocale?: string; themePreference?: ThemePreference } = {};
    if (input.preferredLocale) {
      data.preferredLocale = input.preferredLocale;
    }
    if (input.themePreference) {
      data.themePreference = input.themePreference;
    }

    const updated = await tx.user.update({
      where: { id: input.userId },
      data,
    });

    const after = sanitizeUser(updated);

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "USER_PREFERENCES_UPDATE",
      entity: "User",
      entityId: updated.id,
      before: toJson(sanitizeUser(before)),
      after: toJson(after),
      requestId: input.requestId,
    });

    return after;
  });

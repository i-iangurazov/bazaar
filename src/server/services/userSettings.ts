import type { ThemePreference } from "@prisma/client";

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
  if (!user || user.organizationId !== input.organizationId) {
    throw new AppError("userNotFound", "NOT_FOUND", 404);
  }
  return sanitizeUser(user);
};

export const updateMyProfile = async (input: UpdateMyProfileInput) =>
  prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: input.userId } });
    if (!before || before.organizationId !== input.organizationId) {
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
    if (!before || before.organizationId !== input.organizationId) {
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

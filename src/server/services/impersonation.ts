import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";

const DEFAULT_TTL_MINUTES = 30;

export const createImpersonationSession = async (input: {
  organizationId: string;
  createdById: string;
  targetUserId: string;
  requestId: string;
  ttlMinutes?: number;
}) =>
  prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id: input.targetUserId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        organizationId: true,
        isActive: true,
        deletedAt: true,
      },
    });

    if (!target || target.deletedAt || target.organizationId !== input.organizationId) {
      throw new AppError("userNotFound", "NOT_FOUND", 404);
    }

    if (!target.isActive) {
      throw new AppError("userInactive", "CONFLICT", 409);
    }

    const ttlMinutes = Math.max(5, Math.min(input.ttlMinutes ?? DEFAULT_TTL_MINUTES, 240));
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    const session = await tx.impersonationSession.create({
      data: {
        organizationId: input.organizationId,
        createdById: input.createdById,
        targetUserId: input.targetUserId,
        expiresAt,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.createdById,
      action: "IMPERSONATION_START",
      entity: "ImpersonationSession",
      entityId: session.id,
      after: toJson({ sessionId: session.id, targetUserId: target.id, expiresAt }),
      requestId: input.requestId,
    });

    return { session, target };
  });

export const revokeImpersonationSession = async (input: {
  organizationId: string;
  actorId: string;
  sessionId: string;
  requestId: string;
}) =>
  prisma.$transaction(async (tx) => {
    const session = await tx.impersonationSession.findUnique({ where: { id: input.sessionId } });
    if (!session || session.organizationId !== input.organizationId) {
      throw new AppError("impersonationNotFound", "NOT_FOUND", 404);
    }

    if (session.revokedAt) {
      return session;
    }

    const updated = await tx.impersonationSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "IMPERSONATION_END",
      entity: "ImpersonationSession",
      entityId: session.id,
      before: toJson(session),
      after: toJson(updated),
      requestId: input.requestId,
    });

    return updated;
  });

export const getActiveImpersonationSession = async (input: {
  sessionId: string;
  createdById: string;
}) => {
  const session = await prisma.impersonationSession.findUnique({
    where: { id: input.sessionId },
    include: {
      targetUser: {
        select: { id: true, email: true, name: true, role: true, organizationId: true, isActive: true, deletedAt: true },
      },
    },
  });

  if (!session || session.createdById !== input.createdById) {
    return null;
  }

  if (session.revokedAt || session.expiresAt <= new Date() || !session.targetUser.isActive || session.targetUser.deletedAt) {
    return null;
  }

  return session;
};

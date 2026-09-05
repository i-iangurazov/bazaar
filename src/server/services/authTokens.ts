import { createHash, randomBytes } from "node:crypto";
import type { AuthToken, Prisma } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { toJson } from "@/server/services/json";
import { writeAuditLog } from "@/server/services/audit";

export type AuthTokenPurpose = "EMAIL_VERIFY" | "PASSWORD_RESET" | "REGISTRATION";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const createRawToken = () => randomBytes(32).toString("hex");

const buildExpiresAt = (minutes: number) => new Date(Date.now() + minutes * 60 * 1000);

export const createAuthToken = async (
  input: {
    userId: string | null;
    email: string;
    purpose: AuthTokenPurpose;
    expiresInMinutes: number;
    organizationId?: string | null;
    actorId?: string | null;
    requestId?: string;
  },
  db: Prisma.TransactionClient = prisma,
) => {
  const raw = createRawToken();
  const tokenHash = hashToken(raw);
  const expiresAt = buildExpiresAt(input.expiresInMinutes);

  const token = await db.authToken.create({
    data: {
      userId: input.userId ?? null,
      email: input.email,
      type: input.purpose,
      tokenHash,
      expiresAt,
    },
  });

  if (input.organizationId && input.requestId) {
    await writeAuditLog(db, {
      organizationId: input.organizationId,
      actorId: input.actorId ?? null,
      action: "AUTH_TOKEN_CREATE",
      entity: "AuthToken",
      entityId: token.id,
      after: toJson({ id: token.id, type: token.type, email: token.email, expiresAt }),
      requestId: input.requestId,
    });
  }

  return { raw, token };
};

export const consumeAuthToken = async (
  input: { purpose: AuthTokenPurpose; token: string },
  transaction?: Prisma.TransactionClient,
): Promise<AuthToken> => {
  if (!transaction) {
    return prisma.$transaction((tx) => consumeAuthToken(input, tx));
  }
  const tokenHash = hashToken(input.token);
  const record = await transaction.authToken.findUnique({ where: { tokenHash } });
  if (!record || record.type !== input.purpose) {
    throw new AppError("tokenInvalid", "NOT_FOUND", 404);
  }
  if (!record.userId) {
    throw new AppError("tokenInvalid", "NOT_FOUND", 404);
  }
  // Serialize all token actions for one identity before claiming the token.
  // This also makes invalidating sibling reset links safe under concurrency.
  await transaction.$queryRaw`SELECT id FROM "User" WHERE id = ${record.userId} FOR UPDATE`;
  const user = await transaction.user.findUnique({ where: { id: record.userId } });
  if (!user || user.email !== record.email) {
    throw new AppError("tokenInvalid", "NOT_FOUND", 404);
  }
  if (!user.isActive) {
    throw new AppError("userInactive", "FORBIDDEN", 403);
  }
  const usedAt = new Date();
  if (record.usedAt || record.expiresAt <= usedAt) {
    throw new AppError("tokenExpired", "CONFLICT", 409);
  }
  const claimed = await transaction.authToken.updateMany({
    where: { id: record.id, usedAt: null, expiresAt: { gt: usedAt } },
    data: { usedAt },
  });
  if (claimed.count !== 1) {
    throw new AppError("tokenExpired", "CONFLICT", 409);
  }
  return { ...record, usedAt };
};

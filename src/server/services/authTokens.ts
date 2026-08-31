import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { toJson } from "@/server/services/json";
import { writeAuditLog } from "@/server/services/audit";

export type AuthTokenPurpose = "EMAIL_VERIFY" | "PASSWORD_RESET" | "REGISTRATION";
export type AuthTokenStatus = "valid" | "invalid" | "expired";
type AuthTokenDatabase = Prisma.TransactionClient | typeof prisma;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const createRawToken = () => randomBytes(32).toString("hex");

const buildExpiresAt = (minutes: number) => new Date(Date.now() + minutes * 60 * 1000);

/**
 * Checks whether an opaque auth link is still actionable without consuming it.
 * Mutations must still call consumeAuthToken; this function is only the
 * pre-render guard that keeps unusable public forms off the page.
 */
export const getAuthTokenStatus = async (input: {
  purpose: AuthTokenPurpose;
  token: string;
  requireUser?: boolean;
  now?: Date;
}): Promise<AuthTokenStatus> => {
  const rawToken = input.token.trim();
  if (rawToken.length < 10) {
    return "invalid";
  }

  const record = await prisma.authToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: {
      type: true,
      userId: true,
      user: { select: { id: true } },
      usedAt: true,
      expiresAt: true,
    },
  });

  if (
    !record ||
    record.type !== input.purpose ||
    (input.requireUser && (!record.userId || !record.user))
  ) {
    return "invalid";
  }
  if (record.usedAt || record.expiresAt < (input.now ?? new Date())) {
    return "expired";
  }
  return "valid";
};

export const createAuthToken = async (input: {
  userId: string | null;
  email: string;
  purpose: AuthTokenPurpose;
  expiresInMinutes: number;
  organizationId?: string | null;
  actorId?: string | null;
  requestId?: string;
}) => {
  const raw = createRawToken();
  const tokenHash = hashToken(raw);
  const expiresAt = buildExpiresAt(input.expiresInMinutes);

  const token = await prisma.authToken.create({
    data: {
      userId: input.userId ?? null,
      email: input.email,
      type: input.purpose,
      tokenHash,
      expiresAt,
    },
  });

  if (input.organizationId && input.requestId) {
    await writeAuditLog(prisma, {
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
  database: AuthTokenDatabase = prisma,
) => {
  const rawToken = input.token.trim();
  if (rawToken.length < 10) {
    throw new AppError("tokenInvalid", "NOT_FOUND", 404);
  }

  const tokenHash = hashToken(rawToken);
  const consumedAt = new Date();
  const claimed = await database.authToken.updateMany({
    where: {
      tokenHash,
      type: input.purpose,
      usedAt: null,
      expiresAt: { gte: consumedAt },
    },
    data: { usedAt: consumedAt },
  });

  if (claimed.count === 1) {
    const claimedRecord = await database.authToken.findUnique({ where: { tokenHash } });
    if (claimedRecord) return claimedRecord;
  }

  const record = await database.authToken.findUnique({ where: { tokenHash } });
  if (!record || record.type !== input.purpose) {
    throw new AppError("tokenInvalid", "NOT_FOUND", 404);
  }
  if (record.usedAt || record.expiresAt < consumedAt) {
    throw new AppError("tokenExpired", "CONFLICT", 409);
  }

  // A matching token that was not claimed changed concurrently. Fail closed;
  // callers may surface the same recovery guidance as an already-used token.
  throw new AppError("tokenExpired", "CONFLICT", 409);
};

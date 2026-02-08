import { createHash, randomBytes } from "node:crypto";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { toJson } from "@/server/services/json";
import { writeAuditLog } from "@/server/services/audit";

export type AuthTokenPurpose = "EMAIL_VERIFY" | "PASSWORD_RESET" | "REGISTRATION";

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

const createRawToken = () => randomBytes(32).toString("hex");

const buildExpiresAt = (minutes: number) => new Date(Date.now() + minutes * 60 * 1000);

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

export const consumeAuthToken = async (input: { purpose: AuthTokenPurpose; token: string }) => {
  const tokenHash = hashToken(input.token);
  const record = await prisma.authToken.findUnique({ where: { tokenHash } });
  if (!record || record.type !== input.purpose) {
    throw new AppError("tokenInvalid", "NOT_FOUND", 404);
  }
  if (record.usedAt || record.expiresAt < new Date()) {
    throw new AppError("tokenExpired", "CONFLICT", 409);
  }

  const updated = await prisma.authToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });

  return updated;
};

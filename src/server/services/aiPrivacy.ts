import { AsyncLocalStorage } from "node:async_hooks";
import { AI_PRIVACY_CONSENT_VERSION, hasCurrentAiConsent } from "@/lib/aiPrivacy";
import { prisma } from "@/server/db/prisma";
import { AppError } from "./errors";
import { writeAuditLog } from "./audit";

type Identity = { userId: string; organizationId: string; impersonating?: boolean };
const identities = new AsyncLocalStorage<Identity>();

// Each request/job carries its initiating person. A missing identity is never
// treated as permission to send data to an external AI provider.
export const withAiPrivacyIdentity = <T>(identity: Identity, run: () => T): T =>
  identities.run(identity, run);

export const assertAiConsent = async (identity: Identity | undefined = identities.getStore()) => {
  if (!identity || identity.impersonating || identities.getStore()?.impersonating)
    throw new AppError("aiConsentRequired", "FORBIDDEN", 403);
  const user = await prisma.user.findUnique({ where: { id: identity.userId } });
  if (!user || user.organizationId !== identity.organizationId || !hasCurrentAiConsent(user))
    throw new AppError("aiConsentRequired", "FORBIDDEN", 403);
  return { userId: user.id, organizationId: identity.organizationId };
};

export const getAiConsent = async (identity: Identity) => {
  const user = await prisma.user.findUnique({ where: { id: identity.userId } });
  if (!user || user.deletedAt || !user.isActive || user.organizationId !== identity.organizationId)
    throw new AppError("userNotFound", "NOT_FOUND", 404);
  return {
    version: AI_PRIVACY_CONSENT_VERSION,
    granted: hasCurrentAiConsent(user),
    grantedAt: user.aiConsentGrantedAt,
    revokedAt: user.aiConsentRevokedAt,
  };
};

export const updateAiConsent = async (input: Identity & {
  granted: boolean; version: string; requestId: string;
}) => {
  if (input.impersonating) throw new AppError("forbidden", "FORBIDDEN", 403);
  if (input.version !== AI_PRIVACY_CONSENT_VERSION)
    throw new AppError("accountConsentChanged", "CONFLICT", 409);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user || user.deletedAt || !user.isActive || user.organizationId !== input.organizationId)
      throw new AppError("userNotFound", "NOT_FOUND", 404);
    const now = new Date();
    await tx.user.update({
      where: { id: user.id },
      data: input.granted
        ? { aiConsentVersion: input.version, aiConsentGrantedAt: now, aiConsentRevokedAt: null }
        : { aiConsentRevokedAt: now },
    });
    await writeAuditLog(tx, {
      organizationId: input.organizationId, actorId: user.id,
      action: input.granted ? "AI_PRIVACY_CONSENT_GRANT" : "AI_PRIVACY_CONSENT_REVOKE",
      entity: "AiPrivacyConsent", entityId: user.id, requestId: input.requestId,
      after: { version: input.version, granted: input.granted },
    });
  });
  return getAiConsent(input);
};

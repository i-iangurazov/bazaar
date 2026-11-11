import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { isPlatformOwnerEmail } from "@/server/auth/platformOwner";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";

export type AppleSupportOperator = { id: string; requestId: string; caseId: string };
export async function assertAppleSupportOperator(actorId: string, db: Prisma.TransactionClient = prisma) {
  if (db !== prisma) await db.$queryRaw`SELECT id FROM "User" WHERE id=${actorId} FOR UPDATE`;
  const actor = await db.user.findUnique({ where: { id: actorId }, select: { id: true, email: true, isActive: true, deletedAt: true, organizationId: true } });
  if (!actor || !actor.organizationId || !actor.isActive || actor.deletedAt || !isPlatformOwnerEmail(actor.email))
    throw new AppError("forbidden", "FORBIDDEN", 403);
}
/** Caller holds customer Org first, then the fresh operator User through commit. */
export async function auditAppleSupportEvidence(db: Prisma.TransactionClient, operator: AppleSupportOperator,
  organizationId: string, digest: string, evidenceType: "TRANSACTION" | "RENEWAL") {
  await assertAppleSupportOperator(operator.id, db);
  await writeAuditLog(db, { organizationId, actorId: operator.id, action: "APPLE_SUPPORT_EVIDENCE_APPLY", entity: "ApplePurchaseIntent",
    entityId: operator.caseId, after: { caseId: operator.caseId, evidenceType, evidenceDigest: digest }, requestId: operator.requestId });
}

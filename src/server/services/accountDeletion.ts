import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { AppError } from "./errors";
import { writeAuditLog } from "./audit";
import { BAAM_PRIVATE_MEDIA_PREFIX } from "./baamPrivateMedia";

type AccountScope = { userId: string; organizationId: string; requestId: string };

const availableColleagues = (organizationId: string, userId: string) => ({
  organizationId, id: { not: userId }, isActive: true, deletedAt: null,
});

export const getAccountDeletionPreview = async (input: Omit<AccountScope, "requestId">) => {
  const user = await prisma.user.findFirst({
    where: { id: input.userId, organizationId: input.organizationId, isActive: true, deletedAt: null },
    select: { isOrgOwner: true },
  });
  if (!user) throw new AppError("userNotFound", "NOT_FOUND", 404);
  const colleagues = user.isOrgOwner ? await prisma.user.findMany({
    where: availableColleagues(input.organizationId, input.userId),
    select: { id: true, name: true, role: true, isOrgOwner: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  }) : [];
  return {
    requiresSuccessor: user.isOrgOwner && colleagues.length > 0 && !colleagues.some((u) => u.isOrgOwner),
    successors: colleagues.map(({ id, name, role }) => ({ id, name, role })),
    soleOwner: user.isOrgOwner && colleagues.length === 0,
  };
};

export const deleteOwnAccount = async (input: AccountScope & {
  password: string; confirmation: "DELETE"; successorUserId?: string;
}) => {
  // Verify before taking the organization lock; verify the same hash again in
  // the transaction to reject a password reset/deactivation racing this request.
  const observed = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!observed || observed.organizationId !== input.organizationId || observed.deletedAt || !observed.isActive)
    throw new AppError("userNotFound", "NOT_FOUND", 404);
  if (input.confirmation !== "DELETE" || !await bcrypt.compare(input.password, observed.passwordHash))
    throw new AppError("accountPasswordIncorrect", "BAD_REQUEST", 400);
  const deletedAt = new Date();
  const unusableHash = await bcrypt.hash(randomBytes(48).toString("base64url"), 10);

  return prisma.$transaction(async (tx) => {
    // Serialize organization writers without blocking the audit FK's KEY SHARE
    // lock while a concurrent consent/profile update already holds its user.
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${input.organizationId} FOR NO KEY UPDATE`;
    await tx.$queryRaw`SELECT id FROM "User" WHERE "organizationId" = ${input.organizationId} ORDER BY id FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user || user.organizationId !== input.organizationId || user.deletedAt || !user.isActive)
      throw new AppError("userNotFound", "NOT_FOUND", 404);
    if (user.passwordHash !== observed.passwordHash)
      throw new AppError("accountPasswordIncorrect", "BAD_REQUEST", 400);
    await tx.$queryRaw`SELECT id FROM "BaamConversation" WHERE "userId" = ${user.id} ORDER BY id FOR UPDATE`;

    if (user.isOrgOwner) {
      const colleagues = await tx.user.findMany({
        where: availableColleagues(input.organizationId, user.id),
        select: { id: true, isOrgOwner: true },
      });
      if (colleagues.length && !colleagues.some((u) => u.isOrgOwner)) {
        const successor = colleagues.find((u) => u.id === input.successorUserId);
        if (!successor) throw new AppError("accountSuccessorRequired", "BAD_REQUEST", 400);
        await tx.user.update({
          where: { id: successor.id }, data: { isOrgOwner: true, role: "ADMIN", sessionVersion: { increment: 1 } },
        });
        await tx.userStoreAccess.deleteMany({ where: { userId: successor.id } });
        await writeAuditLog(tx, {
          organizationId: input.organizationId, actorId: user.id,
          action: "ORGANIZATION_OWNER_TRANSFER", entity: "User", entityId: successor.id,
          after: { previousOwnerId: user.id, nextOwnerId: successor.id, role: "ADMIN" },
          requestId: input.requestId,
        });
      }
    } else if (input.successorUserId) {
      throw new AppError("forbidden", "FORBIDDEN", 403);
    }

    const attachments = await tx.baamAttachment.findMany({
      where: { conversation: { userId: user.id }, NOT: { url: { startsWith: BAAM_PRIVATE_MEDIA_PREFIX } } }, select: { url: true },
    });
    // Conversation execution receipts remain as business idempotency evidence;
    // private text, audio, attachments and editable drafts are erased.
    await tx.baamMessage.deleteMany({ where: { conversation: { userId: user.id } } });
    await tx.baamTranscription.deleteMany({ where: { conversation: { userId: user.id } } });
    await tx.baamAttachment.deleteMany({ where: { conversation: { userId: user.id } } });
    await tx.baamTurn.updateMany({
      where: { conversation: { userId: user.id } },
      data: { pageContext: Prisma.DbNull, cancelRequested: true },
    });
    await tx.baamWorkflow.updateMany({
      where: { conversation: { userId: user.id } },
      data: { parameters: {}, presentation: {}, result: Prisma.DbNull, pendingRequestId: null },
    });
    await tx.baamWorkflowRequest.updateMany({
      where: { workflow: { conversation: { userId: user.id } } },
      data: { parameters: {}, result: Prisma.DbNull },
    });
    await tx.baamAction.updateMany({
      where: { conversation: { userId: user.id } },
      data: { input: {}, summary: {}, result: Prisma.DbNull },
    });
    await tx.baamConversation.updateMany({
      where: { userId: user.id },
      data: { title: "", deletedAt, activeTurnId: null, activeWorkflowId: null },
    });
    for (const url of new Set(attachments.map((a) => a.url))) {
      await tx.accountErasureAsset.upsert({
        where: { url }, create: { organizationId: input.organizationId, url }, update: {},
      });
    }

    // Remove person-specific recovery, push and access data. Financial
    // IdempotencyKey/OperationRequest, invoices and accounting rows are retained.
    const tokens = await tx.authToken.findMany({
      where: { OR: [{ userId: user.id }, { email: user.email }] }, select: { id: true },
    });
    const invites = await tx.inviteToken.findMany({ where: { email: user.email }, select: { id: true } });
    await tx.authToken.deleteMany({ where: { OR: [{ userId: user.id }, { email: user.email }] } });
    await tx.userLoginPhone.deleteMany({ where: { userId: user.id } });
    await tx.inviteToken.deleteMany({ where: { OR: [{ email: user.email }, { createdById: user.id, acceptedAt: null }] } });
    await tx.accessRequest.deleteMany({ where: { email: user.email } });
    await tx.mobileDevice.deleteMany({ where: { userId: user.id } });
    await tx.userStoreAccess.deleteMany({ where: { userId: user.id } });
    await tx.userGuideState.deleteMany({ where: { userId: user.id } });
    await tx.impersonationSession.updateMany({
      where: { OR: [{ targetUserId: user.id }, { createdById: user.id }], revokedAt: null },
      data: { revokedAt: deletedAt },
    });
    await tx.subscriptionReminder.updateMany({
      where: { ownerId: user.id },
      data: { recipientEmail: "deleted@deleted.invalid", subject: "", text: "", html: "", status: "CANCELED", leaseToken: null, leaseExpiresAt: null },
    });
    await tx.subscriptionPaymentNotification.updateMany({
      where: { ownerId: user.id },
      data: { recipientEmail: "deleted@deleted.invalid", subject: "", text: "", html: "", status: "CANCELED", deliveryStatus: "CANCELLED", leaseToken: null, leaseExpiresAt: null },
    });
    // Profile/recovery audit snapshots have no accounting retention purpose.
    // Retain only the audit envelope (who/when/action), without the old identity.
    await tx.auditLog.updateMany({
      where: { OR: [
        { entity: "User", entityId: user.id },
        { entity: "AuthToken", entityId: { in: tokens.map((t) => t.id) } },
        { entity: "InviteToken", entityId: { in: invites.map((t) => t.id) } },
      ] },
      data: { before: Prisma.DbNull, after: { erased: true } },
    });
    await tx.user.update({
      where: { id: user.id },
      data: {
        email: `deleted+${randomUUID()}@deleted.invalid`, name: "Deleted account",
        passwordHash: unusableHash, phone: null, jobTitle: null, signupAttribution: Prisma.DbNull,
        emailVerifiedAt: null, isActive: false, isOrgOwner: false, canTransferStock: false,
        aiConsentVersion: null, aiConsentGrantedAt: null, aiConsentRevokedAt: deletedAt,
        deletedAt, sessionVersion: { increment: 1 },
      },
    });
    await writeAuditLog(tx, {
      organizationId: input.organizationId, actorId: user.id,
      action: "ACCOUNT_DELETED", entity: "User", entityId: user.id,
      after: { deletedAt: deletedAt.toISOString(), retained: "business_records_and_operation_receipts" },
      requestId: input.requestId,
    });
    return { deleted: true as const };
  }, { timeout: 30_000 });
};

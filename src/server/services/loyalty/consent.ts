import { prisma } from "@/server/db/prisma";
import { getSessionMember } from "./memberAuth";
import { lockLoyaltyOrder, loyaltyCartFingerprint } from "./apply";
import { AppError } from "@/server/services/errors";

export async function approveLoyaltyConsent(rawSession: string, id: string) {
  const context = await getSessionMember(rawSession);
  if (!context) throw new AppError("loyaltyUnauthorized", "UNAUTHORIZED", 401);
  const approved = await prisma.$transaction(async (tx) => {
    const consent = await tx.loyaltyRedemptionConsent.findFirst({ where: { id: id, organizationId: context.member.organizationId, memberId: context.member.id, consumedAt: null, expiresAt: { gt: new Date() } } });
    if (!consent) return false;
    await lockLoyaltyOrder(tx, consent.customerOrderId);
    const order = await tx.customerOrder.findUnique({ where: { id: consent.customerOrderId } });
    if (!order || order.status !== "DRAFT" || consent.cartFingerprint !== await loyaltyCartFingerprint(tx, order.id)) return false;
    const result = await tx.loyaltyRedemptionConsent.updateMany({ where: { id: consent.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { approvedAt: new Date() } });
    return result.count === 1;
  });
  return approved;
}

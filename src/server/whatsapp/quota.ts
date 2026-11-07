import { WHATSAPP_INCLUDED_MESSAGES, whatsappPeriod } from "@/lib/whatsapp-ai";
import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import {
  getOrganizationPlan,
  hasActivePaidOrApprovedSubscription,
} from "@/server/services/planLimits";
import { whatsappOrganizationLock, type WhatsAppDb } from "./access";

export async function whatsappQuota(
  organizationId: string,
  now = new Date(),
  db: WhatsAppDb = prisma,
) {
  const period = whatsappPeriod(now);
  const [month, lots, org] = await Promise.all([
    db.whatsAppMonth.findUnique({
      where: { organizationId_period: { organizationId, period: period.key } },
    }),
    db.whatsAppCreditLot.findMany({
      where: { organizationId, revoked: false, expiresAt: { gt: now } },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
    }),
    getOrganizationPlan(organizationId, db),
  ]);
  const entitled = org.plan !== "STARTER" || org.lifetimeAccess;
  const included = entitled ? WHATSAPP_INCLUDED_MESSAGES : 0;
  const includedUsed = month?.includedUsed ?? 0,
    reserved = month?.includedReserved ?? 0;
  const paidRemaining = lots.reduce(
    (sum, lot) => sum + Math.max(0, lot.total - lot.used - lot.reserved),
    0,
  );
  const paidReserved = lots.reduce((sum, lot) => sum + lot.reserved, 0);
  return {
    period: period.key,
    renewsAt: period.endsAt,
    included,
    includedUsed,
    reserved,
    paidRemaining,
    paidReserved,
    remaining: Math.max(0, included - includedUsed - reserved) + paidRemaining,
    active: entitled && hasActivePaidOrApprovedSubscription(org, now),
    inbound: month?.inboundCount ?? 0,
    delivered: month?.deliveredCount ?? 0,
    inputTokens: month?.aiInputTokens ?? 0,
    outputTokens: month?.aiOutputTokens ?? 0,
    estimatedSpendUsd: Number(month?.estimatedSpendMicros ?? 0) / 1000000,
  };
}

export async function reserveWhatsAppUnit(
  organizationId: string,
  messageId: string,
  now = new Date(),
) {
  return whatsappOrganizationLock(organizationId, async (tx) => {
    const existing = await tx.whatsAppCreditUse.findUnique({ where: { messageId } });
    if (existing) {
      if (existing.organizationId !== organizationId || existing.state !== "RESERVED")
        throw new AppError("whatsappQuotaConflict", "CONFLICT", 409);
      return existing;
    }
    const message = await tx.whatsAppMessage.findFirst({
      where: { id: messageId, organizationId, direction: "OUTBOUND", state: "PREPARED" },
    });
    if (!message) throw new AppError("recordNotFound", "NOT_FOUND", 404);
    const quota = await whatsappQuota(organizationId, now, tx);
    if (!quota.active) throw new AppError("whatsappPlanRequired", "FORBIDDEN", 403);
    const month = await tx.whatsAppMonth.upsert({
      where: { organizationId_period: { organizationId, period: quota.period } },
      create: { organizationId, period: quota.period },
      update: {},
    });
    let lotId: string | null = null;
    if (month.includedUsed + month.includedReserved < quota.included) {
      await tx.whatsAppMonth.update({
        where: { id: month.id },
        data: { includedReserved: { increment: 1 } },
      });
    } else {
      const lots = await tx.whatsAppCreditLot.findMany({
        where: { organizationId, revoked: false, expiresAt: { gt: now } },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      });
      const lot = lots.find((item) => item.used + item.reserved < item.total);
      if (!lot) throw new AppError("whatsappQuotaExhausted", "CONFLICT", 409);
      lotId = lot.id;
      await tx.whatsAppCreditLot.update({
        where: { id: lot.id },
        data: { reserved: { increment: 1 } },
      });
    }
    return tx.whatsAppCreditUse.create({
      data: { organizationId, messageId, monthId: month.id, lotId },
    });
  });
}

/** Delivery, not a redirect/accepted send/AI opinion, completes a customer unit. */
export async function settleWhatsAppUnit(
  organizationId: string,
  messageId: string,
  delivered: boolean,
) {
  return whatsappOrganizationLock(organizationId, async (tx) => {
    const usage = await tx.whatsAppCreditUse.findFirst({ where: { messageId, organizationId } });
    if (!usage || usage.state === "USED" || (!delivered && usage.state !== "RESERVED")) return;
    const hadReservation = usage.state === "RESERVED";
    await tx.whatsAppCreditUse.update({
      where: { id: usage.id },
      data: { state: delivered ? "USED" : "RELEASED" },
    });
    if (usage.lotId)
      await tx.whatsAppCreditLot.update({
        where: { id: usage.lotId },
        data: {
          ...(hadReservation ? { reserved: { decrement: 1 } } : {}),
          ...(delivered ? { used: { increment: 1 } } : {}),
        },
      });
    else
      await tx.whatsAppMonth.update({
        where: { id: usage.monthId },
        data: {
          ...(hadReservation ? { includedReserved: { decrement: 1 } } : {}),
          ...(delivered ? { includedUsed: { increment: 1 } } : {}),
        },
      });
    if (delivered)
      await tx.whatsAppMonth.update({
        where: { id: usage.monthId },
        data: {
          deliveredCount: { increment: 1 },
          estimatedSpendMicros: { increment: BigInt(7700) },
        },
      });
  });
}

export async function recordWhatsAppEstimate(
  organizationId: string,
  micros: number,
  usage?: { input: number; output: number },
  inbound = false,
) {
  if (!Number.isSafeInteger(micros) || micros < 0) throw new Error("Invalid WhatsApp expense");
  const period = whatsappPeriod().key;
  const change = {
    estimatedSpendMicros: { increment: BigInt(micros) },
    ...(inbound ? { inboundCount: { increment: 1 } } : {}),
    ...(usage
      ? { aiInputTokens: { increment: usage.input }, aiOutputTokens: { increment: usage.output } }
      : {}),
  };
  await prisma.whatsAppMonth.upsert({
    where: { organizationId_period: { organizationId, period } },
    create: {
      organizationId,
      period,
      estimatedSpendMicros: BigInt(micros),
      inboundCount: inbound ? 1 : 0,
      aiInputTokens: usage?.input ?? 0,
      aiOutputTokens: usage?.output ?? 0,
    },
    update: change,
  });
}

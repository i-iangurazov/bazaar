import type { Prisma, SubscriptionEarlyAccess } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { readPurchaseSnapshot } from "@/server/billing/purchaseSnapshot";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";

export const EARLY_ACCESS_AUTHORIZATION_ACTION = "PLATFORM_BILLING_EARLY_ACTIVATION";

export type ActivateEarlyAccessInput = {
  organizationId: string;
  invoiceId: string;
  periodId: string;
  actorId: string;
  authorizationAuditId: string;
  requestId: string;
};

const sameSnapshot = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

/**
 * Creates a reviewed early-access grant for an already-paid future period.
 * It derives all entitlements from the immutable paid snapshot; it never creates
 * an invoice, payment, credit, period or trial.
 */
export const activateSubscriptionEarlyAccess = async (
  input: ActivateEarlyAccessInput,
): Promise<SubscriptionEarlyAccess> =>
  prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${input.organizationId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "SubscriptionInvoice" WHERE id = ${input.invoiceId} AND "organizationId" = ${input.organizationId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "SubscriptionPeriod" WHERE id = ${input.periodId} AND "organizationId" = ${input.organizationId} FOR UPDATE`;

      const [organization, invoice, period, contract, authorization, existing] = await Promise.all([
        tx.organization.findUnique({ where: { id: input.organizationId } }),
        tx.subscriptionInvoice.findFirst({
          where: { id: input.invoiceId, organizationId: input.organizationId },
          include: {
            events: { select: { state: true, source: true } },
            manualRefunds: { select: { id: true } },
          },
        }),
        tx.subscriptionPeriod.findFirst({
          where: { id: input.periodId, organizationId: input.organizationId },
        }),
        tx.subscriptionContract.findUnique({ where: { organizationId: input.organizationId } }),
        tx.auditLog.findFirst({
          where: {
            id: input.authorizationAuditId,
            organizationId: input.organizationId,
            action: EARLY_ACCESS_AUTHORIZATION_ACTION,
          },
        }),
        tx.subscriptionEarlyAccess.findUnique({
          where: {
            organizationId_periodId: {
              organizationId: input.organizationId,
              periodId: input.periodId,
            },
          },
        }),
      ]);

      if (!organization) throw new AppError("orgNotFound", "NOT_FOUND", 404);
      if (organization.subscriptionBillingMode !== "SELF_SERVE") {
        throw new AppError("earlyAccessRequiresSelfServe", "CONFLICT", 409);
      }
      if (organization.subscriptionStatus !== "ACTIVE") {
        throw new AppError("earlyAccessOrganizationInactive", "CONFLICT", 409);
      }
      if (contract?.lifetimeAccess) {
        throw new AppError("earlyAccessLifetimeNotAllowed", "CONFLICT", 409);
      }
      if (!authorization) {
        throw new AppError("earlyAccessAuthorizationMissing", "CONFLICT", 409);
      }
      if (!invoice || invoice.status !== "PAID" || !invoice.paidAt || invoice.isTest ||
        !invoice.providerPaymentId || invoice.manualRefunds.length ||
        !invoice.events.some((event) => event.state === "PAID" &&
          (event.source === "CALLBACK" || event.source === "RECONCILIATION"))) {
        throw new AppError("earlyAccessPaymentNotConfirmed", "CONFLICT", 409);
      }
      if (!invoice.purchaseSnapshot) {
        throw new AppError("earlyAccessPurchaseSnapshotMissing", "CONFLICT", 409);
      }
      const snapshot = readPurchaseSnapshot(invoice.purchaseSnapshot);
      if (!snapshot || snapshot.organizationId !== input.organizationId) {
        throw new AppError("earlyAccessSnapshotTenantMismatch", "CONFLICT", 409);
      }
      if (!period || period.invoiceId !== invoice.id || period.revokedAt ||
        period.dependencyRevokedAt || period.plan !== snapshot.plan ||
        period.startsAt <= new Date() || period.endsAt <= period.startsAt ||
        !sameSnapshot(period.purchaseSnapshot, invoice.purchaseSnapshot)) {
        throw new AppError("earlyAccessPeriodMismatch", "CONFLICT", 409);
      }
      const authorizationAfter = authorization.after as
        | { paidPeriodId?: unknown }
        | null;
      if (authorizationAfter?.paidPeriodId !== period.id) {
        throw new AppError("earlyAccessAuthorizationPeriodMismatch", "CONFLICT", 409);
      }
      const activePeriod = await tx.subscriptionPeriod.findFirst({
        where: {
          organizationId: input.organizationId,
          startsAt: { lte: new Date() },
          endsAt: { gt: new Date() },
          revokedAt: null,
          dependencyRevokedAt: null,
        },
        select: { id: true },
      });
      if (activePeriod) throw new AppError("earlyAccessAlreadyActive", "CONFLICT", 409);

      if (existing) {
        if (existing.invoiceId !== invoice.id || !sameSnapshot(existing.purchaseSnapshot, invoice.purchaseSnapshot)) {
          throw new AppError("earlyAccessAlreadyInconsistent", "CONFLICT", 409);
        }
        return existing;
      }

      // Use the database clock so the SQL validation and the service agree on
      // the exact activation instant.
      const startsAt = (await tx.$queryRaw<Array<{ now: Date }>>`SELECT CURRENT_TIMESTAMP AS now`)[0]!.now;
      if (startsAt >= period.startsAt) {
        throw new AppError("earlyAccessPeriodAlreadyStarted", "CONFLICT", 409);
      }
      const grant = await tx.subscriptionEarlyAccess.create({
        data: {
          organizationId: input.organizationId,
          invoiceId: invoice.id,
          periodId: period.id,
          startsAt,
          endsAt: period.startsAt,
          purchaseSnapshot: invoice.purchaseSnapshot as Prisma.InputJsonValue,
        },
      });
      await writeAuditLog(tx, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: "PLATFORM_BILLING_EARLY_ACCESS_GRANT",
        entity: "SubscriptionEarlyAccess",
        entityId: grant.id,
        before: {
          organizationId: input.organizationId,
          invoiceId: invoice.id,
          periodId: period.id,
          effectiveExtras: null,
        },
        after: {
          organizationId: input.organizationId,
          invoiceId: invoice.id,
          periodId: period.id,
          startsAt: startsAt.toISOString(),
          endsAt: period.startsAt.toISOString(),
          purchasePlan: snapshot.plan,
          purchaseExtras: snapshot.extras,
        },
        requestId: input.requestId,
      });
      return grant;
    },
    { timeout: 30_000 },
  );

export const findActiveSubscriptionEarlyAccess = async (
  organizationId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
  now = new Date(),
) =>
  db.subscriptionEarlyAccess.findFirst({
    where: {
      organizationId,
      startsAt: { lte: now },
      endsAt: { gt: now },
    },
    orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
  });

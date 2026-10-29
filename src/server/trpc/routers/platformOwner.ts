import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { OrganizationSubscriptionStatus, PlanUpgradeRequestStatus } from "@prisma/client";

import { platformOwnerProcedure, router } from "@/server/trpc/trpc";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";
import { getPlanMonthlyPrice, toPlanTier } from "@/server/services/planLimits";
import {
  listPendingPlanUpgradeRequests,
  reviewPlanUpgradeRequest,
} from "@/server/services/billing";
import { getSubscriptionPaymentConfig } from "@/server/billing/paymentConfig";
import {
  checkSubscriptionInvoice,
  listSubscriptionPaymentReviews,
  resolveSubscriptionPaymentReview,
} from "@/server/billing/subscriptionPayments";
import { toTRPCError } from "@/server/trpc/errors";

export const platformOwnerRouter = router({
  summary: platformOwnerProcedure.query(async ({ ctx }) => {
    const organizations = await ctx.prisma.organization.findMany({
      select: {
        id: true,
        plan: true,
        subscriptionStatus: true,
        createdAt: true,
      },
    });

    const activeByTier = {
      STARTER: 0,
      BUSINESS: 0,
      ENTERPRISE: 0,
    };
    let estimatedMrrKgs = 0;

    for (const organization of organizations) {
      const tier = toPlanTier(organization.plan);
      if (organization.subscriptionStatus === OrganizationSubscriptionStatus.ACTIVE) {
        activeByTier[tier] += 1;
        estimatedMrrKgs += getPlanMonthlyPrice(organization.plan);
      }
    }

    const paidCount = organizations.filter(
      (organization) => organization.subscriptionStatus === OrganizationSubscriptionStatus.ACTIVE,
    ).length;
    const pendingUpgradeRequests = await ctx.prisma.planUpgradeRequest.count({
      where: { status: PlanUpgradeRequestStatus.PENDING },
    });

    return {
      organizationsTotal: organizations.length,
      organizationsPaid: paidCount,
      organizationsPastDue: organizations.filter(
        (organization) =>
          organization.subscriptionStatus === OrganizationSubscriptionStatus.PAST_DUE,
      ).length,
      organizationsCanceled: organizations.filter(
        (organization) =>
          organization.subscriptionStatus === OrganizationSubscriptionStatus.CANCELED,
      ).length,
      pendingUpgradeRequests,
      paymentsAvailable: getSubscriptionPaymentConfig().ready,
      activeByTier,
      estimatedMrrKgs,
    };
  }),

  listUpgradeRequests: platformOwnerProcedure.query(async () => listPendingPlanUpgradeRequests()),

  paymentReviews: platformOwnerProcedure.query(() => listSubscriptionPaymentReviews()),
  recheckPayment: platformOwnerProcedure
    .input(z.object({ organizationId: z.string().min(1), invoiceId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        return await checkSubscriptionInvoice(input.organizationId, input.invoiceId);
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  resolvePaymentReview: platformOwnerProcedure
    .input(
      z.object({
        invoiceId: z.string().min(1),
        note: z.string().trim().min(10).max(500),
        confirmed: z.literal(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.impersonator) throw new TRPCError({ code: "FORBIDDEN", message: "forbidden" });
      try {
        return await resolveSubscriptionPaymentReview({
          ...input,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  reviewUpgradeRequest: platformOwnerProcedure
    .input(
      z.object({
        requestId: z.string().min(1),
        status: z.enum(["APPROVED", "REJECTED"]),
        reviewNote: z.string().max(500).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      reviewPlanUpgradeRequest({
        requestId: input.requestId,
        status: input.status,
        reviewNote: input.reviewNote ?? null,
        reviewedById: ctx.user.id,
        requestAuditId: ctx.requestId,
      }),
    ),

  listOrganizations: platformOwnerProcedure.query(async ({ ctx }) => {
    return ctx.prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        plan: true,
        subscriptionStatus: true,
        trialEndsAt: true,
        currentPeriodEndsAt: true,
        subscriptionBillingMode: true,
        stores: {
          select: {
            id: true,
            name: true,
            code: true,
          },
          orderBy: { name: "asc" },
          take: 3,
        },
        _count: {
          select: {
            stores: true,
            users: true,
            products: true,
          },
        },
      },
    });
  }),

  updateOrganizationBilling: platformOwnerProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        plan: z.enum(["STARTER", "BUSINESS", "ENTERPRISE"]),
        subscriptionStatus: z.enum(["ACTIVE", "PAST_DUE", "CANCELED"]),
        trialDays: z.number().int().min(0).max(365).optional(),
        currentPeriodDays: z.number().int().min(1).max(365).optional(),
        subscriptionBillingMode: z.enum(["MANUAL", "SELF_SERVE"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${input.organizationId} FOR UPDATE`;
        const before = await tx.organization.findUnique({
          where: { id: input.organizationId },
        });
        if (!before) {
          throw new TRPCError({ code: "NOT_FOUND", message: "orgNotFound" });
        }
        if (
          input.subscriptionBillingMode === "SELF_SERVE" &&
          before.subscriptionBillingMode !== "SELF_SERVE" &&
          !getSubscriptionPaymentConfig().ready
        )
          throw new TRPCError({ code: "CONFLICT", message: "billingPaymentsUnavailable" });

        const now = new Date();
        const dates = {
          ...(input.trialDays !== undefined
            ? {
                trialEndsAt:
                  input.trialDays > 0 ? new Date(now.getTime() + input.trialDays * 86400000) : null,
              }
            : {}),
          ...(input.currentPeriodDays !== undefined
            ? { currentPeriodEndsAt: new Date(now.getTime() + input.currentPeriodDays * 86400000) }
            : {}),
        };

        const updated = await tx.organization.update({
          where: { id: input.organizationId },
          data: {
            plan: input.plan,
            subscriptionStatus: input.subscriptionStatus,
            ...dates,
            ...(input.subscriptionBillingMode
              ? { subscriptionBillingMode: input.subscriptionBillingMode }
              : {}),
          },
        });

        await writeAuditLog(tx, {
          organizationId: updated.id,
          actorId: ctx.user.id,
          action: "PLATFORM_BILLING_PLAN_UPDATE",
          entity: "Organization",
          entityId: updated.id,
          before: toJson(before),
          after: toJson(updated),
          requestId: ctx.requestId,
        });

        return updated;
      });
    }),
});

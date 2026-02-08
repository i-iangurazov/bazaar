import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { OrganizationSubscriptionStatus } from "@prisma/client";

import { platformOwnerProcedure, router } from "@/server/trpc/trpc";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";
import { getPlanMonthlyPrice, toPlanTier } from "@/server/services/planLimits";

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

    return {
      organizationsTotal: organizations.length,
      organizationsPaid: paidCount,
      organizationsPastDue: organizations.filter(
        (organization) => organization.subscriptionStatus === OrganizationSubscriptionStatus.PAST_DUE,
      ).length,
      organizationsCanceled: organizations.filter(
        (organization) => organization.subscriptionStatus === OrganizationSubscriptionStatus.CANCELED,
      ).length,
      activeByTier,
      estimatedMrrKgs,
    };
  }),

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
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.prisma.organization.findUnique({
        where: { id: input.organizationId },
      });
      if (!before) {
        throw new TRPCError({ code: "NOT_FOUND", message: "orgNotFound" });
      }

      const now = new Date();
      const trialEndsAt =
        input.trialDays && input.trialDays > 0
          ? new Date(now.getTime() + input.trialDays * 24 * 60 * 60 * 1000)
          : null;
      const currentPeriodEndsAt = new Date(
        now.getTime() + (input.currentPeriodDays ?? 30) * 24 * 60 * 60 * 1000,
      );

      const updated = await ctx.prisma.organization.update({
        where: { id: input.organizationId },
        data: {
          plan: input.plan,
          subscriptionStatus: input.subscriptionStatus,
          trialEndsAt,
          currentPeriodEndsAt,
        },
      });

      await writeAuditLog(ctx.prisma, {
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
    }),
});

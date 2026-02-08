import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { adminProcedure, protectedProcedure, router } from "@/server/trpc/trpc";
import { getBillingSummary } from "@/server/services/billing";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";

export const billingRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    return getBillingSummary({ organizationId: ctx.user.organizationId });
  }),

  setPlanDev: adminProcedure
    .input(
      z.object({
        plan: z.enum(["STARTER", "BUSINESS", "ENTERPRISE"]),
        subscriptionStatus: z.enum(["ACTIVE", "PAST_DUE", "CANCELED"]),
        trialDays: z.number().int().min(0).max(365).optional(),
        currentPeriodDays: z.number().int().min(1).max(365).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (process.env.NODE_ENV === "production") {
        throw new TRPCError({ code: "FORBIDDEN", message: "forbidden" });
      }

      const before = await ctx.prisma.organization.findUnique({
        where: { id: ctx.user.organizationId },
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
        where: { id: ctx.user.organizationId },
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
        action: "BILLING_PLAN_UPDATE",
        entity: "Organization",
        entityId: updated.id,
        before: toJson(before),
        after: toJson(updated),
        requestId: ctx.requestId,
      });

      return getBillingSummary({ organizationId: updated.id });
    }),
});

import { z } from "zod";

import { adminProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import {
  getLoyaltyProgram,
  loyaltyRulesText,
  toLoyaltyRules,
  upsertLoyaltyProgram,
} from "@/server/services/loyalty/program";

const settingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    memberDiscountPercent: z.number().min(0).max(100).optional(),
    earnPercent: z.number().min(0).max(100).optional(),
    maxSpendPercent: z.number().min(0).max(100).optional(),
    pointValueKgs: z.number().positive().max(10_000).optional(),
    minRedeemPoints: z.number().int().min(0).max(1_000_000).optional(),
    reservationTtlMinutes: z.number().int().min(1).max(24 * 60).optional(),
    excludePromoItems: z.boolean().optional(),
    combinePromoDiscount: z.boolean().optional(),
    storeIds: z.array(z.string().min(1)).max(500).optional(),
  })
  .strict();

export const loyaltyRouter = router({
  /** Owner-facing programme settings. Never creates or enables anything implicitly. */
  settings: adminProcedure.query(async ({ ctx }) => {
    try {
      const [program, stores] = await Promise.all([
        getLoyaltyProgram(ctx.prisma, ctx.user.organizationId),
        ctx.prisma.loyaltyProgramStore.findMany({
          where: { organizationId: ctx.user.organizationId },
          select: { storeId: true },
        }),
      ]);
      return {
        program: program
          ? { ...program, rules: toLoyaltyRules(program) }
          : null,
        storeIds: stores.map((store) => store.storeId),
      };
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
  updateSettings: adminProcedure.input(settingsSchema).mutation(async ({ ctx, input }) => {
    try {
      if (input.storeIds?.length) {
        const allowed = await ctx.prisma.store.findMany({
          where: { organizationId: ctx.user.organizationId, id: { in: input.storeIds } },
          select: { id: true },
        });
        if (allowed.length !== new Set(input.storeIds).size) {
          throw new Error("storeAccessDenied");
        }
      }
      const program = await upsertLoyaltyProgram(ctx.prisma, ctx.user.organizationId, input);
      return { ...program, rules: toLoyaltyRules(program) };
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
  /** Read-only rule explanation for the settings screen and the customer card. */
  rules: adminProcedure.query(async ({ ctx }) => {
    const program = await getLoyaltyProgram(ctx.prisma, ctx.user.organizationId);
    return program
      ? { enabled: program.enabled, text: program.rulesText ?? loyaltyRulesText(toLoyaltyRules(program)) }
      : { enabled: false, text: null };
  }),
});

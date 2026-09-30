import { z } from "zod";

import { adminProcedure, cashierProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import {
  getLoyaltyProgram,
  loyaltyRulesText,
  toLoyaltyRules,
  upsertLoyaltyProgram,
} from "@/server/services/loyalty/program";
import {
  applyLoyaltyToOrder,
  quoteLoyaltyForOrder,
  releaseLoyaltyForOrder,
} from "@/server/services/loyalty/apply";
import { phoneContactKey, verifyCardToken } from "@/server/services/loyalty/memberAuth";

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
          select: { id: true, storeId: true },
        }),
      ]);
      return {
        program: program
          ? { ...program, rules: toLoyaltyRules(program) }
          : null,
        storeIds: stores.map((store) => store.storeId),
        links: stores.map((store) => ({ storeId: store.storeId, slug: store.id })),
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

  /** Register: resolve a scanned customer QR to a member and their balance. */
  posStatus: cashierProcedure.query(async ({ ctx }) => {
    const program = await getLoyaltyProgram(ctx.prisma, ctx.user.organizationId);
    return { enabled: Boolean(program?.enabled) };
  }),
  posResolveCard: cashierProcedure
    .input(z.object({ token: z.string().min(1).max(200) }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        const card = await verifyCardToken(input.token, ctx.user.organizationId);
        return {
          memberId: card.member.id,
          displayName:
            card.member.displayName ?? card.member.email ?? card.member.phoneNormalized ?? null,
          balancePoints: card.account.balancePoints,
          availablePoints: card.availablePoints,
          rules: {
            memberDiscountPercent: Number(card.program.memberDiscountPercent),
            earnPercent: Number(card.program.earnPercent),
            maxSpendPercent: Number(card.program.maxSpendPercent),
            pointValueKgs: Number(card.program.pointValueKgs),
            minRedeemPoints: card.program.minRedeemPoints,
          },
        };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  /** Register: find a member by phone for earning (redemption still needs the card). */
  posFindMember: cashierProcedure
    .input(z.object({ phone: z.string().trim().min(4).max(40) }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        const program = await getLoyaltyProgram(ctx.prisma, ctx.user.organizationId);
        if (!program?.enabled) throw new Error("loyaltyDisabled");
        const member = await ctx.prisma.loyaltyMember.findFirst({
          where: {
            organizationId: ctx.user.organizationId,
            programId: program.id,
            contactKey: phoneContactKey(input.phone),
            status: "ACTIVE",
          },
          select: { id: true, displayName: true, email: true, phoneNormalized: true },
        });
        return member
          ? {
              memberId: member.id,
              displayName: member.displayName ?? member.email ?? member.phoneNormalized ?? null,
            }
          : null;
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  /** Register: the single server quote for the current receipt. */
  posQuote: cashierProcedure
    .input(
      z
        .object({
          saleId: z.string().min(1),
          memberId: z.string().min(1),
          points: z.number().int().min(0).max(1_000_000).optional(),
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.prisma.$transaction(async (tx) => {
          const sale = await tx.customerOrder.findFirst({
            where: { id: input.saleId, organizationId: ctx.user.organizationId, isPosSale: true },
            select: { storeId: true },
          });
          if (!sale) throw new Error("posSaleNotFound");
          const quote = await quoteLoyaltyForOrder(tx, {
            organizationId: ctx.user.organizationId,
            storeId: sale.storeId,
            customerOrderId: input.saleId,
            memberId: input.memberId,
            requestedPoints: input.points,
          });
          return {
            memberId: quote.memberId,
            balancePoints: quote.availablePoints,
            memberDiscountKgs: quote.memberDiscountKgs,
            eligibleKgs: quote.eligibleKgs,
            maxRedeemPoints: quote.maxRedeemPoints,
            redeemPoints: quote.redeemPoints,
            redeemValueKgs: quote.redeemValueKgs,
            payableKgs: quote.payableKgs,
            earnPoints: quote.earnPoints,
          };
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  /** Register: apply the member discount and reserve the chosen points on the draft. */
  posApply: cashierProcedure
    .input(
      z
        .object({
          saleId: z.string().min(1),
          memberId: z.string().min(1),
          points: z.number().int().min(0).max(1_000_000),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.prisma.$transaction(async (tx) => {
          const sale = await tx.customerOrder.findFirst({
            where: { id: input.saleId, organizationId: ctx.user.organizationId, isPosSale: true },
            select: { storeId: true },
          });
          if (!sale) throw new Error("posSaleNotFound");
          const applied = await applyLoyaltyToOrder(tx, {
            organizationId: ctx.user.organizationId,
            storeId: sale.storeId,
            customerOrderId: input.saleId,
            memberId: input.memberId,
            requestedPoints: input.points,
            actorId: ctx.user.id,
          });
          return {
            totalKgs: applied.totalKgs,
            discountKgs: applied.discountKgs,
            pointsSpent: applied.quote.redeemPoints,
            earnPoints: applied.quote.earnPoints,
            memberDiscountKgs: applied.quote.memberDiscountKgs,
          };
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  /** Register: drop the applied loyalty from a draft and free its reservation. */
  posRelease: cashierProcedure
    .input(z.object({ saleId: z.string().min(1) }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.prisma.$transaction((tx) =>
          releaseLoyaltyForOrder(tx, { customerOrderId: input.saleId }),
        );
        return { ok: true };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});

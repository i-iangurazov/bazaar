import { getLoyaltyOrderSummary } from "@/server/services/loyalty/orderSummary";
import { assertLoyaltyEnabled } from "@/server/services/loyalty/program";
import { getLoyaltyHistory } from "@/server/services/loyalty/history";
import { availablePoints } from "@/server/services/loyalty/ledger";
import type { Prisma } from "@prisma/client";
import { lockPosSaleDraftForEdit } from "@/server/services/pos";
import { assertUserCanAccessStore, resolveAccessibleStoreIds } from "@/server/services/storeAccess";
import { AppError } from "@/server/services/errors";
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
  loyaltyCartFingerprint,
  quoteLoyaltyForOrder,
  releaseLoyaltyForOrder,
} from "@/server/services/loyalty/apply";
import { emailContactKey, phoneContactKey, verifyCardToken } from "@/server/services/loyalty/memberAuth";

const settingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    memberDiscountPercent: z.number().min(0).max(100).optional(),
    earnPercent: z.number().min(0).max(100).optional(),
    maxSpendPercent: z.number().min(0).max(100).optional(),
    pointValueKgs: z.number().min(0.01).max(10_000).multipleOf(0.01).optional(),
    minRedeemPoints: z.number().int().min(0).max(1_000_000).optional(),
    reservationTtlMinutes: z.number().int().min(1).max(24 * 60).optional(),
    excludePromoItems: z.boolean().optional(),
    combinePromoDiscount: z.boolean().optional(),
    storeIds: z.array(z.string().min(1)).max(500).optional(),
  })
  .strict();

export const loyaltyRouter = router({
  customerHistory: cashierProcedure.input(z.object({ customerId: z.string() })).query(async ({ ctx, input }) => {
    try {
      const customer = await ctx.prisma.customer.findFirst({ where: { id: input.customerId, organizationId: ctx.user.organizationId, deletedAt: null } });
      if (!customer) throw new AppError("customerNotFound", "NOT_FOUND", 404);
      await assertUserCanAccessStore(ctx.prisma, ctx.user, customer.storeId);
      const member = await ctx.prisma.loyaltyMember.findFirst({ where: { organizationId: ctx.user.organizationId, OR: [{ customerId: customer.id }, ...(customer.email ? [{ contactKey: `email:${customer.email.trim().toLowerCase()}` }] : [])] } });
      if (!member) return null;
      const account = await ctx.prisma.loyaltyAccount.findUnique({ where: { memberId: member.id } });
      if (!account) return null;
      const stores = await resolveAccessibleStoreIds(ctx.prisma, ctx.user);
      return { balancePoints: account.balancePoints, availablePoints: await availablePoints(ctx.prisma, account.id), history: await getLoyaltyHistory(ctx.user.organizationId, account.id, stores) };
    } catch (error) { throw toTRPCError(error); }
  }),
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
  posStatus: cashierProcedure.input(z.object({ storeId: z.string().optional() }).optional()).query(async ({ ctx, input }) => {
    try {
      if (!input?.storeId) return { enabled: false, signupId: null };
      await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
      const program = await getLoyaltyProgram(ctx.prisma, ctx.user.organizationId);
      const store = program ? await ctx.prisma.loyaltyProgramStore.findFirst({ where: { programId: program.id, storeId: input.storeId } }) : null;
      const enabled = Boolean(program?.enabled && store);
      return { enabled, signupId: enabled ? store!.id : null };
    } catch (error) { throw toTRPCError(error); }
  }),
  /** Exact contact lookup within a participating store. Spending still requires customer consent. */
  posLookupMember: cashierProcedure
    .input(z.object({ storeId: z.string().min(1), contact: z.string().trim().min(4).max(254) }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
        const program = await assertLoyaltyEnabled(ctx.prisma, ctx.user.organizationId, input.storeId);
        const isEmail = input.contact.includes("@");
        const digits = input.contact.replace(/[^0-9]/g, "");
        if (isEmail ? !z.string().email().safeParse(input.contact).success : !/^[+()\d\s.-]+$/.test(input.contact) || digits.length < 7) return [];
        const members = await ctx.prisma.loyaltyMember.findMany({
          where: {
            organizationId: ctx.user.organizationId, programId: program.id, status: "ACTIVE",
            OR: isEmail
              ? [{ contactKey: emailContactKey(input.contact) }, { email: input.contact.toLowerCase() }]
              : [{ contactKey: phoneContactKey(input.contact) }, { phoneNormalized: digits }, { phoneNormalized: `+${digits}` }],
          },
          select: { id: true, displayName: true, email: true, phoneNormalized: true },
          take: 5,
        });
        return members.map(member => ({ memberId: member.id, displayName: member.displayName ?? member.email ?? member.phoneNormalized, email: member.email, phone: member.phoneNormalized }));
      } catch (error) { throw toTRPCError(error); }
    }),
  posResolveCard: cashierProcedure
    .input(z.object({ token: z.string().min(1).max(200) }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        const card = await verifyCardToken(input.token, ctx.user.organizationId);
        return {
          memberId: card.member.id,
          email: card.member.email,
          phone: card.member.phoneNormalized,
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
          const sale = await lockPosSaleDraftForEdit(tx, {
            saleId: input.saleId, organizationId: ctx.user.organizationId, actorId: ctx.user.id, user: ctx.user,
          });
          const quote = await quoteLoyaltyForOrder(tx, {
            organizationId: ctx.user.organizationId,
            storeId: sale.storeId,
            customerOrderId: input.saleId,
            memberId: input.memberId,
            requestedPoints: input.points,
          });
          return {
            originalKgs: quote.lines.reduce((sum, line) => sum + line.baseKgs - line.promoDiscountKgs, 0),
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
          consentId: z.string().optional(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.prisma.$transaction(async (tx) => {
          const sale = await lockPosSaleDraftForEdit(tx, {
            saleId: input.saleId, organizationId: ctx.user.organizationId, actorId: ctx.user.id, user: ctx.user,
          });
          if (input.points > 0) {
            const consent = input.consentId ? await tx.loyaltyRedemptionConsent.findFirst({ where: { id: input.consentId, organizationId: ctx.user.organizationId, customerOrderId: input.saleId, memberId: input.memberId, actorId: ctx.user.id, points: input.points } }) : null;
            if (!consent?.approvedAt) throw new AppError("loyaltyConsentRequired", "CONFLICT", 409);
            if (consent.consumedAt) {
              const existing = await tx.loyaltyOrderApplication.findUnique({ where: { customerOrderId: input.saleId } });
              if ((existing?.rulesSnapshot as { consentId?: string })?.consentId !== consent.id || existing?.status !== "APPLIED" || existing.memberId !== input.memberId || existing.pointsSpent !== input.points) throw new AppError("loyaltyConsentRequired", "CONFLICT", 409);
            } else {
              const quote = await quoteLoyaltyForOrder(tx, { organizationId: ctx.user.organizationId, storeId: sale.storeId, customerOrderId: sale.id, memberId: input.memberId, requestedPoints: input.points });
              if (consent.expiresAt <= new Date() || consent.cartFingerprint !== await loyaltyCartFingerprint(tx, sale.id) || !consent.payableKgs.eq(quote.payableKgs)) throw new AppError("loyaltyConsentRequired", "CONFLICT", 409);
              await tx.loyaltyRedemptionConsent.update({ where: { id: consent.id }, data: { consumedAt: new Date() } });
            }
          }
          const applied = await applyLoyaltyToOrder(tx, {
            organizationId: ctx.user.organizationId,
            storeId: sale.storeId,
            customerOrderId: input.saleId,
            memberId: input.memberId,
            requestedPoints: input.points,
            actorId: ctx.user.id,
          });
          if (input.points > 0 && input.consentId) await tx.loyaltyOrderApplication.update({ where: { id: applied.application.id }, data: { rulesSnapshot: { ...(applied.application.rulesSnapshot as Prisma.JsonObject), consentId: input.consentId } as Prisma.InputJsonValue } });
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
  posRequestConsent: cashierProcedure.input(z.object({ saleId: z.string(), memberId: z.string(), points: z.number().int().positive().max(1_000_000) }).strict()).mutation(async ({ ctx, input }) => {
    try {
      return await ctx.prisma.$transaction(async (tx) => {
        const sale = await lockPosSaleDraftForEdit(tx, { saleId: input.saleId, organizationId: ctx.user.organizationId, actorId: ctx.user.id, user: ctx.user });
        const quote = await quoteLoyaltyForOrder(tx, { organizationId: ctx.user.organizationId, storeId: sale.storeId, customerOrderId: sale.id, memberId: input.memberId, requestedPoints: input.points });
        if (quote.redeemPoints !== input.points) throw new AppError("loyaltyInsufficientPoints", "CONFLICT", 409);
        const fingerprint = await loyaltyCartFingerprint(tx, sale.id);
        const existing = await tx.loyaltyRedemptionConsent.findFirst({ where: { customerOrderId: sale.id, actorId: ctx.user.id, memberId: input.memberId, points: input.points, cartFingerprint: fingerprint, consumedAt: null, expiresAt: { gt: new Date() } } });
        if (existing) return { id: existing.id };
        await tx.loyaltyRedemptionConsent.updateMany({ where: { customerOrderId: sale.id, consumedAt: null }, data: { expiresAt: new Date() } });
        const consent = await tx.loyaltyRedemptionConsent.create({ data: { organizationId: ctx.user.organizationId, customerOrderId: sale.id, actorId: ctx.user.id, memberId: input.memberId, points: input.points, payableKgs: quote.payableKgs, cartFingerprint: fingerprint, expiresAt: new Date(Date.now() + 180_000) } });
        return { id: consent.id };
      });
    } catch (error) { throw toTRPCError(error); }
  }),
  posConsentStatus: cashierProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const consent = await ctx.prisma.loyaltyRedemptionConsent.findFirst({ where: { id: input.id, organizationId: ctx.user.organizationId, actorId: ctx.user.id } });
    return { approved: Boolean(consent?.approvedAt && consent.expiresAt > new Date()), expired: !consent || consent.expiresAt <= new Date() };
  }),

  /** Register: drop the applied loyalty from a draft and free its reservation. */
  posRelease: cashierProcedure
    .input(z.object({ saleId: z.string().min(1) }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.prisma.$transaction(async (tx) => {
          await lockPosSaleDraftForEdit(tx, { saleId: input.saleId, organizationId: ctx.user.organizationId, actorId: ctx.user.id, user: ctx.user });
          await releaseLoyaltyForOrder(tx, { customerOrderId: input.saleId });
        });
        return { ok: true };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  /** Order/customer view: the bonus history attached to one order. */
  orderSummary: cashierProcedure
    .input(z.object({ customerOrderId: z.string().min(1) }).strict())
    .query(async ({ ctx, input }) => {
      try {
        const order = await ctx.prisma.customerOrder.findFirst({ where: { id: input.customerOrderId, organizationId: ctx.user.organizationId }, select: { storeId: true } });
        if (!order) throw new AppError("posSaleNotFound", "NOT_FOUND", 404);
        await assertUserCanAccessStore(ctx.prisma, ctx.user, order.storeId);
        return await getLoyaltyOrderSummary(ctx.prisma, ctx.user.organizationId, input.customerOrderId);
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});

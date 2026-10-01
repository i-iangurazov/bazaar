import { Prisma, type PrismaClient } from "@prisma/client";

import { AppError } from "@/server/services/errors";
import type { LoyaltyRules } from "@/server/services/loyalty/calc";

type LoyaltyClient = Pick<PrismaClient | Prisma.TransactionClient, "loyaltyProgram" | "loyaltyProgramStore">;

/** First-version defaults. The programme stays disabled until an owner enables it. */
export const DEFAULT_LOYALTY_RULES = {
  memberDiscountPercent: 5,
  earnPercent: 5,
  maxSpendPercent: 50,
  pointValueKgs: 1,
  minRedeemPoints: 0,
  reservationTtlMinutes: 30,
  excludePromoItems: true,
  combinePromoDiscount: false,
} as const;

export const loyaltyRulesText = (rules: LoyaltyRules) =>
  [
    `Постоянная скидка участника: ${rules.memberDiscountPercent}%.`,
    `Начисление за покупку: ${rules.earnPercent}% от суммы, реально оплаченной деньгами за подходящие товары после всех скидок и списания баллов.`,
    `1 балл = ${rules.pointValueKgs} сом.`,
    `Максимум списания: до ${rules.maxSpendPercent}% стоимости подходящих товаров после постоянной скидки, в пределах доступного баланса.`,
    "При чеке 1000 сом постоянная скидка 5% даёт 950 сом; баллами можно закрыть до 475 сом, деньгами — 475 сом. Общая выгода может достигать 52,5% исходной суммы.",
    "Доставка и услуги, не участвующие в программе, исключаются из базы скидки, списания и начисления.",
    "Постоянная скидка не суммируется с акционной: применяется больший вариант.",
  ].join(" ");

export const toLoyaltyRules = (program: {
  memberDiscountPercent: Prisma.Decimal | number;
  earnPercent: Prisma.Decimal | number;
  maxSpendPercent: Prisma.Decimal | number;
  pointValueKgs: Prisma.Decimal | number;
  minRedeemPoints: number;
  excludePromoItems: boolean;
  combinePromoDiscount: boolean;
}): LoyaltyRules => ({
  memberDiscountPercent: Number(program.memberDiscountPercent),
  earnPercent: Number(program.earnPercent),
  maxSpendPercent: Number(program.maxSpendPercent),
  pointValueKgs: Number(program.pointValueKgs),
  minRedeemPoints: program.minRedeemPoints,
  excludePromoItems: program.excludePromoItems,
  combinePromoDiscount: program.combinePromoDiscount,
});

export const getLoyaltyProgram = (client: LoyaltyClient, organizationId: string) =>
  client.loyaltyProgram.findUnique({ where: { organizationId } });

export const isStoreParticipating = async (
  client: LoyaltyClient,
  programId: string,
  storeId: string,
) =>
  Boolean(
    await client.loyaltyProgramStore.findUnique({
      where: { programId_storeId: { programId, storeId } },
      select: { id: true },
    }),
  );

/** Throws unless the programme is enabled (and, when given, the store participates). */
export const assertLoyaltyEnabled = async (
  client: LoyaltyClient,
  organizationId: string,
  storeId?: string,
) => {
  const program = await getLoyaltyProgram(client, organizationId);
  if (!program?.enabled) {
    throw new AppError("loyaltyDisabled", "FORBIDDEN", 403);
  }
  if (storeId && !(await isStoreParticipating(client, program.id, storeId))) {
    throw new AppError("loyaltyStoreNotParticipating", "FORBIDDEN", 403);
  }
  return program;
};

export type LoyaltySettingsInput = {
  enabled?: boolean;
  memberDiscountPercent?: number;
  earnPercent?: number;
  maxSpendPercent?: number;
  pointValueKgs?: number;
  minRedeemPoints?: number;
  reservationTtlMinutes?: number;
  excludePromoItems?: boolean;
  combinePromoDiscount?: boolean;
  storeIds?: string[];
};

/** Owner-facing settings write. Creating the row never enables the programme. */
export const upsertLoyaltyProgram = async (
  client: PrismaClient,
  organizationId: string,
  input: LoyaltySettingsInput,
) =>
  client.$transaction(async (tx) => {
    if (input.pointValueKgs !== undefined && (!Number.isFinite(input.pointValueKgs) || input.pointValueKgs < 0.01 || new Prisma.Decimal(input.pointValueKgs).decimalPlaces() > 2)) throw new AppError("loyaltyInvalidPointValue", "BAD_REQUEST", 400);
    const defaults = DEFAULT_LOYALTY_RULES;
    const program = await tx.loyaltyProgram.upsert({
      where: { organizationId },
      create: {
        organizationId,
        // Never enabled implicitly: only an explicit admin activation turns it on.
        enabled: input.enabled ?? false,
        memberDiscountPercent: input.memberDiscountPercent ?? defaults.memberDiscountPercent,
        earnPercent: input.earnPercent ?? defaults.earnPercent,
        maxSpendPercent: input.maxSpendPercent ?? defaults.maxSpendPercent,
        pointValueKgs: input.pointValueKgs ?? defaults.pointValueKgs,
        minRedeemPoints: input.minRedeemPoints ?? defaults.minRedeemPoints,
        reservationTtlMinutes: input.reservationTtlMinutes ?? defaults.reservationTtlMinutes,
        excludePromoItems: input.excludePromoItems ?? defaults.excludePromoItems,
        combinePromoDiscount: input.combinePromoDiscount ?? defaults.combinePromoDiscount,
        rulesText: loyaltyRulesText({
          memberDiscountPercent: input.memberDiscountPercent ?? defaults.memberDiscountPercent,
          earnPercent: input.earnPercent ?? defaults.earnPercent,
          maxSpendPercent: input.maxSpendPercent ?? defaults.maxSpendPercent,
          pointValueKgs: input.pointValueKgs ?? defaults.pointValueKgs,
          minRedeemPoints: input.minRedeemPoints ?? defaults.minRedeemPoints,
          excludePromoItems: input.excludePromoItems ?? defaults.excludePromoItems,
          combinePromoDiscount: input.combinePromoDiscount ?? defaults.combinePromoDiscount,
        }),
      },
      update: {
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(input.memberDiscountPercent === undefined
          ? {}
          : { memberDiscountPercent: input.memberDiscountPercent }),
        ...(input.earnPercent === undefined ? {} : { earnPercent: input.earnPercent }),
        ...(input.maxSpendPercent === undefined ? {} : { maxSpendPercent: input.maxSpendPercent }),
        ...(input.pointValueKgs === undefined ? {} : { pointValueKgs: input.pointValueKgs }),
        ...(input.minRedeemPoints === undefined ? {} : { minRedeemPoints: input.minRedeemPoints }),
        ...(input.reservationTtlMinutes === undefined
          ? {}
          : { reservationTtlMinutes: input.reservationTtlMinutes }),
        ...(input.excludePromoItems === undefined
          ? {}
          : { excludePromoItems: input.excludePromoItems }),
        ...(input.combinePromoDiscount === undefined
          ? {}
          : { combinePromoDiscount: input.combinePromoDiscount }),
      },
    });
    if (input.storeIds) {
      const storeIds = [...new Set(input.storeIds.filter(Boolean))];
      await tx.loyaltyProgramStore.deleteMany({
        where: { programId: program.id, storeId: { notIn: storeIds } },
      });
      if (storeIds.length) {
        await tx.loyaltyProgramStore.createMany({
          data: storeIds.map((storeId) => ({
            organizationId,
            programId: program.id,
            storeId,
          })),
          skipDuplicates: true,
        });
      }
    }
    return tx.loyaltyProgram.update({
      where: { id: program.id },
      data: { rulesText: loyaltyRulesText(toLoyaltyRules(program)) },
    });
  });

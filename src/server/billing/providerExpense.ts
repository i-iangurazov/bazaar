import { AppError } from "@/server/services/errors";
import { prisma } from "@/server/db/prisma";
import { OPENAI_TEXT_PILOT_BUDGET } from "./openAiTextPilot";
import { reserveSubscriptionUsage, startSubscriptionUsage, settleSubscriptionExpense,
  type UsageLease } from "./subscriptionUsage";

export type ProviderExpense = {
  lease: UsageLease;
  reserved: number;
  pilot?: { lease: UsageLease; reservedCents: number };
};

// Internal conservative budget at 100 KGS/USD and peak token prices. These are
// expenditure controls, not the customer's price, an FX quote or vendor invoice.
export function aiExpenseMinor(inputTokens: number, outputTokens: number, model = "deepseek-flash") {
  const pro = /pro/i.test(model);
  const input = Math.max(0, Math.ceil(inputTokens));
  const output = Math.max(0, Math.ceil(outputTokens));
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output))
    throw new AppError("validationError", "BAD_REQUEST", 400);
  return Number((BigInt(input) * BigInt(pro ? 13200 : 3000) +
    BigInt(output) * BigInt(pro ? 39600 : 12000) + 999999n) / 1000000n);
}

export function imageExpenseMinor(usage: unknown, highQuality: boolean, model: string) {
  const row = usage && typeof usage === "object" ? usage as Record<string, unknown> : {};
  const input = row.input_tokens;
  const output = row.output_tokens;
  const current = model.includes("2.5");
  if (typeof input !== "number" || typeof output !== "number" ||
    !Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0)
    return highQuality ? 7500 : 2500;
  return Number((BigInt(input) * BigInt(current ? 80000 : 100000) +
    BigInt(output) * BigInt(current ? 300000 : 400000) + 999999n) / 1000000n);
}

export async function reserveProviderExpense(input: {
  organizationId: string; kind: "text" | "image"; operationKey: string; estimatedMinor: number;
  pilot?: { estimatedCents: number; dailyLimitCents: number };
}): Promise<ProviderExpense> {
  const reserved = Math.max(1, Math.ceil(input.estimatedMinor));
  try {
    const reservation = { organizationId: input.organizationId,
      resource: input.kind === "image" ? "imageVendorBudgetMinor" : "aiVendorBudgetMinor",
      operationKey: input.operationKey, units: reserved } as const;
    const pilot = input.pilot;
    if (pilot) {
      if (input.kind !== "text") throw new AppError("billingAiProviderUnavailable", "CONFLICT", 409);
      const reservedCents = Math.max(1, Math.ceil(pilot.estimatedCents));
      return await prisma.$transaction(async (tx) => {
        const now = new Date();
        const pilotLease = await reserveSubscriptionUsage({
          ...reservation,
          resource: OPENAI_TEXT_PILOT_BUDGET,
          units: reservedCents,
          limitCents: pilot.dailyLimitCents,
        }, now, tx);
        const lease = await reserveSubscriptionUsage(reservation, now, tx);
        await startSubscriptionUsage(lease, tx);
        await startSubscriptionUsage(pilotLease, tx);
        return { lease, reserved, pilot: { lease: pilotLease, reservedCents } };
      });
    }
    const lease = await reserveSubscriptionUsage(reservation);
    await startSubscriptionUsage(lease);
    return { lease, reserved };
  } catch (error) {
    if (error instanceof AppError && error.message === "billingUsageLimitReached")
      throw new AppError("billingAiProviderBudgetReached", "CONFLICT", 409);
    throw error;
  }
}

export async function settleProviderExpense(expense: ProviderExpense | null, actualMinor?: number, actualPilotCents?: number) {
  if (!expense) return;
  const pilot = expense.pilot;
  if (!pilot) return settleSubscriptionExpense(expense.lease, actualMinor ?? expense.reserved);
  return prisma.$transaction(async (tx) => {
    await settleSubscriptionExpense(expense.lease, actualMinor ?? expense.reserved, tx);
    await settleSubscriptionExpense(pilot.lease, actualPilotCents ?? (actualMinor === 0 ? 0 : pilot.reservedCents), tx);
  });
}

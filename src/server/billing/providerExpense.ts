import { AppError } from "@/server/services/errors";
import { reserveSubscriptionUsage, startSubscriptionUsage, settleSubscriptionExpense,
  type UsageLease } from "./subscriptionUsage";

export type ProviderExpense = { lease: UsageLease; reserved: number };

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
}): Promise<ProviderExpense> {
  const reserved = Math.max(1, Math.ceil(input.estimatedMinor));
  try {
    const lease = await reserveSubscriptionUsage({ organizationId: input.organizationId,
      resource: input.kind === "image" ? "imageVendorBudgetMinor" : "aiVendorBudgetMinor",
      operationKey: input.operationKey, units: reserved });
    await startSubscriptionUsage(lease);
    return { lease, reserved };
  } catch (error) {
    if (error instanceof AppError && error.message === "billingUsageLimitReached")
      throw new AppError("billingAiProviderBudgetReached", "CONFLICT", 409);
    throw error;
  }
}

export const settleProviderExpense = (expense: ProviderExpense | null, actualMinor?: number) =>
  expense ? settleSubscriptionExpense(expense.lease, actualMinor ?? expense.reserved) : Promise.resolve();

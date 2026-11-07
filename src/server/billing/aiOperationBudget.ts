import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { AppError } from "@/server/services/errors";

type Budget = { id: string; kind: "text" | "image"; organizationId: string; calls: number; input: number; output: number;
  pendingInput: number; pendingOutput: number; maxCalls: number; maxInput: number; maxOutput: number };
const budgets = new AsyncLocalStorage<Budget>();

export async function withAiOperationBudget<T>(input: {
  organizationId: string; operationKey?: string; units?: number; enabled?: boolean;
  kind?: "text" | "image";
}, run: () => Promise<T>): Promise<T> {
  const parent = budgets.getStore();
  if (parent?.organizationId === input.organizationId) return run();
  const org = input.enabled === undefined
    ? await (await import("@/server/services/planLimits")).getOrganizationPlan(input.organizationId) : null;
  const enabled = input.enabled ?? (org?.billingCatalogVersion === "2026-11" && !org.lifetimeAccess);
  if (!enabled) return run();
  const units = input.units ?? 1;
  if (!Number.isSafeInteger(units) || units < 1 || units > 500)
    throw new AppError("validationError", "BAD_REQUEST", 400);
  return budgets.run({ id: randomUUID(), kind: input.kind ?? "text", organizationId: input.organizationId, calls: 0, input: 0, output: 0,
    pendingInput: 0, pendingOutput: 0, maxCalls: 8 * units, maxInput: 48000 * units,
    maxOutput: 6000 * units }, run);
}

// Conservative text estimate plus a fixed allowance for each bounded image.
// Actual provider usage replaces the estimate after the response. Neither the
// estimate nor model-generated values are used for authoritative business sums.
const estimateInput = (value: unknown): number => {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + estimateInput(item), 0);
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    if (row.type === "input_image") return 8192;
    return Object.entries(row).reduce((sum, [key, item]) =>
      sum + Math.ceil(Buffer.byteLength(key, "utf8") / 2) + estimateInput(item), 0);
  }
  return typeof value === "string" ? Math.ceil(Buffer.byteLength(value, "utf8") / 2) : 1;
};

export function reserveAiCallBudget(body: Record<string, unknown>) {
  const budget = budgets.getStore();
  if (!budget) return { body, active: false, organizationId: null, kind: "text" as const, expenseKey: "", inputTokens: 0, outputTokens: 0,
    finish: (_usage?: unknown) => undefined };
  const input = estimateInput(body);
  const remainingOutput = budget.maxOutput - budget.output - budget.pendingOutput;
  const requested = typeof body.max_output_tokens === "number" ? Math.floor(body.max_output_tokens) : 2000;
  const output = Math.min(requested, remainingOutput);
  if (budget.calls >= budget.maxCalls || budget.input + budget.pendingInput + input > budget.maxInput || output < 128)
    throw new AppError("billingAiRequestTooLarge", "BAD_REQUEST", 413);
  budget.calls++;
  budget.pendingInput += input;
  budget.pendingOutput += output;
  let finished = false;
  return { body: { ...body, max_output_tokens: output }, active: true, organizationId: budget.organizationId,
    kind: budget.kind,
    expenseKey: `ai-provider:${budget.id}:${budget.calls}`, inputTokens: input, outputTokens: output,
    finish: (usage?: unknown) => {
    if (finished) return;
    finished = true;
    const fields = usage && typeof usage === "object" ? usage as Record<string, unknown> : {};
    const tokens = (value: unknown, fallback: number) => typeof value === "number" &&
      Number.isSafeInteger(value) && value >= 0 ? value : fallback;
    budget.pendingInput -= input;
    budget.pendingOutput -= output;
    budget.input += tokens(fields.input_tokens ?? fields.prompt_tokens, input);
    budget.output += tokens(fields.output_tokens ?? fields.completion_tokens, output);
  } };
}

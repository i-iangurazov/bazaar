import { assertExternalProviderCallAllowed } from "@/server/config/runtime";
import { reserveAiCallBudget } from "@/server/billing/aiOperationBudget";
import type * as ProviderExpenseModule from "@/server/billing/providerExpense";
import { AppError } from "./errors";
import { assertAiConsent } from "./aiPrivacy";

export type TextAiConfig = {
  provider: "deepseek" | "openai";
  apiKey: string;
  model: string;
  url: string;
};

// Credentials and destinations are selected together. A DeepSeek key must never
// be sent to OpenAI, including when old OPENAI_MODEL settings remain installed.
export function resolveTextAiConfig(
  purpose: "baam" | "vision" = "baam",
  openAiModel = process.env.OPENAI_MODEL?.trim() || "gpt-5-mini",
): TextAiConfig | null {
  const selected = process.env.AI_PROVIDER?.trim().toLowerCase() || "auto";
  if (!["auto", "deepseek", "openai"].includes(selected)) return null;
  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (selected === "deepseek" || (selected === "auto" && deepseekKey)) {
    if (!deepseekKey) return null;
    return {
      provider: "deepseek",
      apiKey: deepseekKey,
      model:
        (purpose === "vision"
          ? process.env.DEEPSEEK_VISION_MODEL
          : process.env.DEEPSEEK_BAAM_MODEL
        )?.trim() ||
        process.env.DEEPSEEK_MODEL?.trim() ||
        "deepseek-flash",
      url: "https://api.deepseek.com/responses",
    };
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  return apiKey
    ? { provider: "openai", apiKey, model: openAiModel, url: "https://api.openai.com/v1/responses" }
    : null;
}

export function aiResponseBody(
  config: TextAiConfig,
  body: Record<string, unknown>,
  options?: { reasoningEffort?: "none" | "low" },
) {
  return {
    ...body,
    model: config.model,
    store: false,
    ...(config.provider === "deepseek"
      ? { reasoning: { effort: options?.reasoningEffort ?? "none" } }
      : {}),
  };
}

export async function fetchAiResponse(
  config: TextAiConfig,
  body: Record<string, unknown>,
  signal: AbortSignal,
  options?: { reasoningEffort?: "none" | "low" },
) {
  // Read consent again for each attempt, including a queued job's retry.
  await assertAiConsent();
  assertExternalProviderCallAllowed(config.provider);
  const budget = reserveAiCallBudget(aiResponseBody(config, body, options));
  let expenseModule: typeof ProviderExpenseModule | null = null;
  let expense: ProviderExpenseModule.ProviderExpense | null = null;
  let outboundStarted = false;
  try {
    if (budget.active && config.provider !== "deepseek")
      throw new AppError("billingAiProviderUnavailable", "CONFLICT", 409);
    expenseModule = budget.active ? await import("@/server/billing/providerExpense") : null;
    expense = expenseModule && budget.organizationId ? await expenseModule.reserveProviderExpense({
      organizationId: budget.organizationId, kind: budget.kind, operationKey: budget.expenseKey,
      estimatedMinor: expenseModule.aiExpenseMinor(budget.inputTokens, budget.outputTokens, config.model),
    }) : null;
    const requestBody = JSON.stringify(budget.body);
    // Budget reservations can wait on other transactions. Permission must still
    // be current after that wait, immediately before a new outbound request.
    await assertAiConsent();
    assertExternalProviderCallAllowed(config.provider);
    signal.throwIfAborted();
    outboundStarted = true;
    const response = await fetch(config.url, {
      method: "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: requestBody,
      signal,
    });
    if (budget.active) {
      const result = await response.clone().json().catch(() => null) as {
        usage?: { input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number }
      } | null;
      budget.finish(result?.usage);
      const input = result?.usage?.input_tokens ?? result?.usage?.prompt_tokens;
      const output = result?.usage?.output_tokens ?? result?.usage?.completion_tokens;
      const known = Number.isSafeInteger(input) && Number.isSafeInteger(output) && input! >= 0 && output! >= 0;
      await expenseModule!.settleProviderExpense(expense, known
        ? expenseModule!.aiExpenseMinor(input!, output!, config.model)
        : response.status >= 400 && response.status < 500 && response.status !== 408 ? 0 : undefined);
    }
    return response;
  } catch (error) {
    // Only a request that was never dispatched can release its estimate. An
    // uncertain transport outcome still occupies the declared request ceiling.
    budget.finish(outboundStarted ? undefined : { input_tokens: 0, output_tokens: 0 });
    if (outboundStarted) await expenseModule?.settleProviderExpense(expense);
    else await expenseModule?.settleProviderExpense(expense, 0);
    throw error;
  }
}

// Never render reasoning, refusals or tool arguments as an assistant answer.
export function aiOutputText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const value = body as {
    status?: string;
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  };
  if (value.status && value.status !== "completed") return "";
  return (value.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text ?? "")
    .join("")
    .trim();
}

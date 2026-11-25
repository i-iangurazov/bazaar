import { assertExternalProviderCallAllowed } from "@/server/config/runtime";
import { getTextAiOperationOrganizationId, reserveAiCallBudget } from "@/server/billing/aiOperationBudget";
import {
  isOpenAiTextPilotRequest,
  OPENAI_TEXT_PILOT_MODEL,
  openAiTextPilotUsdMicros,
  readOpenAiTextPilot,
} from "@/server/billing/openAiTextPilot";
import type * as ProviderExpenseModule from "@/server/billing/providerExpense";
import { AppError } from "./errors";
import { assertAiConsent } from "./aiPrivacy";
import {
  beginAiProviderAttempt,
  getAiProviderFeature,
  isDefiniteAiProviderRejection,
  readAiProviderResponse,
  readAiProviderTokenUsage,
  type AiProviderFeature,
} from "./aiProviderTelemetry";

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
  regularConfig: TextAiConfig,
  body: Record<string, unknown>,
  signal: AbortSignal,
  options?: { reasoningEffort?: "none" | "low"; feature?: AiProviderFeature },
) {
  // Read consent again for each attempt, including a queued job's retry.
  const identity = await assertAiConsent();
  const organizationId = getTextAiOperationOrganizationId();
  const feature = getAiProviderFeature() ?? options?.feature;
  const pilot = organizationId && identity?.organizationId === organizationId &&
    regularConfig.provider === "deepseek" && isOpenAiTextPilotRequest(body)
    ? readOpenAiTextPilot({ organizationId, feature })
    : null;
  const config: TextAiConfig = pilot ? {
    provider: "openai",
    apiKey: pilot.apiKey,
    model: OPENAI_TEXT_PILOT_MODEL,
    url: "https://api.openai.com/v1/responses",
  } : regularConfig;
  assertExternalProviderCallAllowed(config.provider);
  const request = { ...aiResponseBody(config, body, options), ...(pilot ? {
    service_tier: "default", reasoning: { effort: options?.reasoningEffort ?? "none" },
  } : {}) };
  const budget = reserveAiCallBudget(request);
  let expenseModule: typeof ProviderExpenseModule | null = null;
  let expense: ProviderExpenseModule.ProviderExpense | null = null;
  let outboundStarted = false;
  let completeAttempt: ReturnType<typeof beginAiProviderAttempt> | undefined;
  try {
    if (budget.active && config.provider !== "deepseek" && !pilot)
      throw new AppError("billingAiProviderUnavailable", "CONFLICT", 409);
    const requestBody = JSON.stringify(budget.body);
    // Upper-bound uncached text cost before dispatch. The request size and an
    // allowance for provider framing are deliberately conservative. Confirmed
    // project limits remain the independent provider-side enforcement.
    const estimatedPilotUsdMicros = pilot ? openAiTextPilotUsdMicros(
      Buffer.byteLength(requestBody, "utf8") + 4096,
      budget.outputTokens,
    ) : undefined;
    expenseModule = budget.active ? await import("@/server/billing/providerExpense") : null;
    expense = expenseModule && budget.organizationId ? await expenseModule.reserveProviderExpense({
      organizationId: budget.organizationId, kind: budget.kind, operationKey: budget.expenseKey,
      // Keep Bazaar's existing conservative accounting convention of 100 KGS/USD.
      estimatedMinor: estimatedPilotUsdMicros === undefined
        ? expenseModule.aiExpenseMinor(budget.inputTokens, budget.outputTokens, config.model)
        : Math.ceil(estimatedPilotUsdMicros / 100),
      ...(pilot && estimatedPilotUsdMicros !== undefined ? { pilot: {
        estimatedCents: Math.ceil(estimatedPilotUsdMicros / 10000),
        dailyLimitCents: pilot.dailyLimit,
      } } : {}),
    }) : null;
    // Budget reservations can wait on other transactions. Permission must still
    // be current after that wait, immediately before a new outbound request.
    await assertAiConsent();
    assertExternalProviderCallAllowed(config.provider);
    signal.throwIfAborted();
    if (pilot && pilot.expiry <= Date.now()) throw new AppError("billingAiProviderUnavailable", "CONFLICT", 409);
    completeAttempt = beginAiProviderAttempt({ provider: config.provider, model: config.model, feature, pilot: Boolean(pilot) });
    outboundStarted = true;
    const response = await fetch(config.url, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        ...(pilot ? { "OpenAI-Project": pilot.projectId } : {}),
      },
      body: requestBody,
      signal,
    });
    const result = await readAiProviderResponse(response);
    const { inputTokens, outputTokens } = readAiProviderTokenUsage(result.usage);
    const known = inputTokens !== undefined && outputTokens !== undefined;
    const rejected = isDefiniteAiProviderRejection(response.status);
    const knownPilotPrice = (result.service_tier === undefined || result.service_tier === "default") &&
      (result.model === undefined || result.model === OPENAI_TEXT_PILOT_MODEL || result.model === "gpt-5.4-mini");
    const actualPilotUsdMicros = pilot && knownPilotPrice && known
      ? openAiTextPilotUsdMicros(inputTokens, outputTokens) : undefined;
    const actualMinor = rejected ? 0 : pilot
      ? actualPilotUsdMicros === undefined ? undefined : Math.ceil(actualPilotUsdMicros / 100)
      : known ? expenseModule?.aiExpenseMinor(inputTokens, outputTokens, config.model) : undefined;
    completeAttempt({ response, body: result, estimatedCostUsdMicros: actualPilotUsdMicros,
      internalEstimatedCostKgsMinor: actualMinor });
    completeAttempt = undefined;
    if (budget.active && expenseModule) {
      budget.finish(rejected ? { input_tokens: 0, output_tokens: 0 } : result.usage);
      if (pilot) {
        await expenseModule.settleProviderExpense(expense, actualMinor,
          rejected ? 0 : actualPilotUsdMicros === undefined ? undefined : Math.ceil(actualPilotUsdMicros / 10000));
      } else {
        await expenseModule.settleProviderExpense(expense, actualMinor);
      }
    }
    return response;
  } catch (error) {
    completeAttempt?.();
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

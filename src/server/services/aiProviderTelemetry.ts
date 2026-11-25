import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { getLogger } from "@/server/logging";

export type AiProviderFeature =
  | "baam_text"
  | "baam_voice"
  | "baam_analytics"
  | "baam_workflow"
  | "marketplace_catalog"
  | "catalog_category"
  | "catalog_description"
  | "catalog_specs"
  | "studio_analysis"
  | "studio_image";

const features = new AsyncLocalStorage<{ feature: AiProviderFeature; operationId: string }>();

export const getAiProviderFeature = () => features.getStore()?.feature;

export const withAiProviderFeature = <T>(feature: AiProviderFeature, run: () => T): T =>
  features.run(features.getStore() ?? { feature, operationId: randomUUID() }, run);

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

const label = (value: unknown) =>
  typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,120}$/.test(value) ? value : undefined;

export function readAiProviderTokenUsage(usage: unknown) {
  const fields = object(usage);
  return {
    inputTokens: count(fields.input_tokens ?? fields.prompt_tokens),
    outputTokens: count(fields.output_tokens ?? fields.completion_tokens),
    cachedInputTokens: count(object(fields.input_tokens_details ?? fields.prompt_tokens_details).cached_tokens),
  };
}

export const isDefiniteAiProviderRejection = (status: number) =>
  status >= 400 && status < 500 && status !== 408;

export function beginAiProviderAttempt(input: {
  provider: "deepseek" | "openai";
  model: string;
  feature?: AiProviderFeature;
  pilot?: boolean;
  attempt?: number;
}) {
  const started = performance.now();
  const feature = input.feature ?? getAiProviderFeature() ?? "unattributed_text";
  // Never use a request header, principal, customer record or payload as the log identifier.
  const logger = getLogger(features.getStore()?.operationId ?? randomUUID());
  return (result: {
    response?: Response;
    body?: unknown;
    audioSeconds?: number;
    outcome?: "invalid_output";
    estimatedCostUsdMicros?: number;
    internalEstimatedCostKgsMinor?: number;
  } = {}) => {
    const response = result.response;
    const body = object(result.body);
    const outcome = result.outcome ?? (
      response?.ok ? (body.status === "incomplete" || body.status === "failed" ? "incomplete" : "succeeded")
        : response && isDefiniteAiProviderRejection(response.status) ? "rejected" : "uncertain"
    );
    logger.info({
      event: "ai_provider_attempt",
      feature,
      provider: input.provider,
      model: label(input.model),
      reportedModel: label(body.model),
      pilot: input.pilot ?? false,
      attempt: input.attempt,
      outcome,
      providerStatus: response?.status,
      providerRequestId: label(response?.headers?.get?.("x-request-id")),
      latencyMs: Math.round(performance.now() - started),
      ...readAiProviderTokenUsage(body.usage),
      audioSeconds: result.audioSeconds,
      estimatedCostUsdMicros: result.estimatedCostUsdMicros,
      internalEstimatedCostKgsMinor: result.internalEstimatedCostKgsMinor,
    }, "AI provider attempt completed");
  };
}

// Read accounting data from a small JSON response without consuming the caller's body.
export async function readAiProviderResponse(response: Response): Promise<Record<string, unknown>> {
  const maximumBytes = 512 * 1024;
  try {
    if (!response.ok || Number(response.headers.get("content-length")) > maximumBytes) return {};
    const reader = response.clone().body?.getReader();
    if (!reader) return {};
    const decoder = new TextDecoder();
    let body = "";
    let bytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) return object(JSON.parse(body + decoder.decode()) as unknown);
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        // A tee's cancel waits for its other branch. That branch is read after we return.
        void reader.cancel().catch(() => undefined);
        return {};
      }
      body += decoder.decode(value, { stream: true });
    }
  } catch {
    return {};
  }
}

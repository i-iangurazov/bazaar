import { assertExternalProviderCallAllowed } from "@/server/config/runtime";

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

export function aiResponseBody(config: TextAiConfig, body: Record<string, unknown>) {
  return {
    ...body,
    model: config.model,
    store: false,
    ...(config.provider === "deepseek" ? { reasoning: { effort: "none" } } : {}),
  };
}

export function fetchAiResponse(
  config: TextAiConfig,
  body: Record<string, unknown>,
  signal: AbortSignal,
) {
  assertExternalProviderCallAllowed(config.provider);
  return fetch(config.url, {
    method: "POST",
    redirect: "error",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(aiResponseBody(config, body)),
    signal,
  });
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

import type { AiProviderFeature } from "@/server/services/aiProviderTelemetry";

// Standard text pricing, verified November 25, 2026.
// https://developers.openai.com/api/docs/models/gpt-5.4-mini
export const OPENAI_TEXT_PILOT_MODEL = "gpt-5.4-mini-2026-03-17";
export const OPENAI_TEXT_PILOT_BUDGET = "openAiTextPilotBudgetCentsDaily";

export const openAiTextPilotUsdMicros = (inputTokens: number, outputTokens: number) =>
  Math.ceil((inputTokens * 75 + outputTokens * 450) / 100);

export function readOpenAiTextPilot(input: {
  organizationId: string;
  feature: AiProviderFeature | undefined;
}) {
  const env = process.env;
  if (
    env.OPENAI_TEXT_PILOT_ENABLED !== "1" ||
    (env.AI_PROVIDER?.trim().toLowerCase() || "auto") !== "auto" ||
    input.organizationId !== env.OPENAI_TEXT_PILOT_ORGANIZATION_ID?.trim() ||
    (input.feature !== "baam_text" && input.feature !== "marketplace_catalog") ||
    input.feature !== env.OPENAI_TEXT_PILOT_FEATURE?.trim()
  ) return null;
  const expiry = Date.parse(env.OPENAI_TEXT_PILOT_EXPIRES_AT ?? "");
  const dailyLimit = Number(env.OPENAI_TEXT_PILOT_DAILY_LIMIT_USD_CENTS);
  const apiKey = env.OPENAI_TEXT_PILOT_API_KEY?.trim();
  const projectId = env.OPENAI_TEXT_PILOT_PROJECT_ID?.trim();
  if (
    !Number.isFinite(expiry) || expiry <= Date.now() ||
    !Number.isSafeInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 1_000_000 ||
    !apiKey?.startsWith("sk-proj-") || apiKey === env.OPENAI_API_KEY?.trim() ||
    !projectId || !/^proj_[A-Za-z0-9_-]{1,100}$/.test(projectId)
  ) return null;
  return { expiry, dailyLimit, apiKey, projectId };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

function isTextMessage(value: unknown) {
  if (!isRecord(value) || (value.type !== undefined && value.type !== "message")) return false;
  const content = value.content;
  return typeof content === "string" || (Array.isArray(content) && content.every((part) =>
    isRecord(part) && part.type === "input_text" && typeof part.text === "string"));
}

export function isOpenAiTextPilotRequest(body: Record<string, unknown>) {
  // Local function schemas only contribute tokens. Provider-managed tools,
  // files, images, audio and implicit stored history have separate costs.
  if (Object.keys(body).some((key) => ![
    "model", "store", "max_output_tokens", "reasoning", "parallel_tool_calls", "tool_choice",
    "tools", "instructions", "input", "text", "service_tier",
  ].includes(key))) return false;
  if (body.tools !== undefined && (
    !Array.isArray(body.tools) || !body.tools.every((tool) => isRecord(tool) && tool.type === "function")
  )) return false;
  return typeof body.input === "string" || (Array.isArray(body.input) && body.input.every(isTextMessage));
}

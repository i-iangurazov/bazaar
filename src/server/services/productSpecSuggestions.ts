import { resolveTextAiConfig, fetchAiResponse } from "./aiProvider";
import { withAiProviderFeature } from "./aiProviderTelemetry";
import { prepareProductAiImages, type ProductAiImagePreparer } from "./productAiImages";
import { AppError } from "@/server/services/errors";

const DEFAULT_OPENAI_MODEL = "gpt-5-mini";
const MAX_OUTPUT_TOKENS = 180;
const OPENAI_MAX_ATTEMPTS = 6;
const OPENAI_MAX_RETRY_DELAY_MS = 30_000;
const isTestRuntime = process.env.NODE_ENV === "test";

const parsePositiveIntEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
};

const OPENAI_REQUEST_TIMEOUT_MS = parsePositiveIntEnv(
  process.env.PRODUCT_SPEC_AI_TIMEOUT_MS ?? process.env.OPENAI_REQUEST_TIMEOUT_MS,
  30_000,
);

type ProductSpecSuggestionLogger = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

type OpenAiResponseBody = {
  status?: string | null;
  incomplete_details?: {
    reason?: string | null;
  } | null;
  output_text?: string;
  output?: Array<{
    type?: string;
    status?: string;
    content?: Array<{
      type?: string;
      text?: string | { value?: string | null } | null;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

type ProductSpecSuggestionKind =
  | "type"
  | "color"
  | "material"
  | "compatibility"
  | "design"
  | "features"
  | "purpose";

type RequestedSpecSuggestion = {
  kind: ProductSpecSuggestionKind;
  labelRu: string;
  options?: string[];
};

export type KeyedProductSpecSuggestion = RequestedSpecSuggestion & { key: string };

const invalidSuggestionPatterns = [
  /не (?:видно|понятно|ясно|определ)/i,
  /не удалось/i,
  /не могу/i,
  /unknown/i,
  /n\/a/i,
  /неизвест/i,
];

const resolveOpenAiModel = () =>
  process.env.PRODUCT_SPEC_AI_MODEL?.trim() ||
  process.env.OPENAI_MODEL?.trim() ||
  DEFAULT_OPENAI_MODEL;

const sleep = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

const parseRetryAfterMs = (value: string | null) => {
  if (!value) {
    return null;
  }

  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return null;
};

const isQuotaLikeProviderMessage = (value: string) =>
  /quota|billing|insufficient_quota|exceeded your current quota/i.test(value);

const isAbortLikeError = (error: unknown) =>
  error instanceof Error &&
  (error.name === "AbortError" || /aborted|abort/i.test(error.message));

const extractResponseText = (responseBody: OpenAiResponseBody | null) => {
  if (typeof responseBody?.output_text === "string" && responseBody.output_text.trim()) {
    return responseBody.output_text.trim();
  }

  const parts: string[] = [];
  for (const item of responseBody?.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string" && content.text.trim()) {
        parts.push(content.text.trim());
        continue;
      }
      if (
        content.text &&
        typeof content.text === "object" &&
        typeof content.text.value === "string" &&
        content.text.value.trim()
      ) {
        parts.push(content.text.value.trim());
      }
    }
  }

  return parts.join("\n").trim();
};

const callOpenAiResponses = async (input: {
  apiKey: string;
  model: string;
  body: string;
  logger?: ProductSpecSuggestionLogger;
  loadedImageCount: number;
  sourceImageBytes: number;
  payloadImageBytes: number;
}) => {
  let lastResponse: Response | null = null;
  let lastResponseBody: OpenAiResponseBody | null = null;

  for (let attempt = 1; attempt <= OPENAI_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENAI_REQUEST_TIMEOUT_MS);
    timeout.unref?.();

    let response: Response;
    let responseBody: OpenAiResponseBody | null = null;
    try {
      const config = resolveTextAiConfig("vision", resolveOpenAiModel());
      if (!config) throw new AppError("aiSpecsNotConfigured", "BAD_REQUEST", 400);
      response = await withAiProviderFeature("catalog_specs", () =>
        fetchAiResponse(config, JSON.parse(input.body), controller.signal),
      );
      responseBody = (await response.json().catch(() => null)) as OpenAiResponseBody | null;
    } catch (error) {
      if (isAbortLikeError(error)) {
        input.logger?.warn(
          {
            provider: resolveTextAiConfig("vision", resolveOpenAiModel())?.provider ?? "unconfigured",
            phase: "spec-suggestion-timeout",
            attempt,
            timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
            loadedImageCount: input.loadedImageCount,
            sourceImageBytes: input.sourceImageBytes,
            payloadImageBytes: input.payloadImageBytes,
            model: input.model,
          },
          "product spec suggestion provider request timed out",
        );
        throw new AppError("aiSpecsTimedOut", "INTERNAL_SERVER_ERROR", 504);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    lastResponse = response;
    lastResponseBody = responseBody;
    if (response.ok) {
      return { response, responseBody, attempts: attempt };
    }

    const providerError = responseBody?.error?.message?.trim() ?? "";
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
    const quotaLike = isQuotaLikeProviderMessage(providerError);
    const canRetry = response.status === 429 && attempt < OPENAI_MAX_ATTEMPTS && !quotaLike;
    if (!canRetry) {
      return { response, responseBody, attempts: attempt };
    }

    const retryDelayMs = isTestRuntime
      ? 1
      : Math.max(
          1_000,
          Math.min(retryAfterMs ?? 1_500 * 2 ** (attempt - 1), OPENAI_MAX_RETRY_DELAY_MS),
        );
    input.logger?.warn(
      {
        provider: resolveTextAiConfig("vision", resolveOpenAiModel())?.provider ?? "unconfigured",
        phase: "spec-suggestion-retry",
        attempt,
        nextAttempt: attempt + 1,
        status: response.status,
        retryDelayMs,
        retryAfterHeader,
        providerError: providerError || null,
        loadedImageCount: input.loadedImageCount,
        sourceImageBytes: input.sourceImageBytes,
        payloadImageBytes: input.payloadImageBytes,
        model: input.model,
      },
      "retrying product spec suggestion request after rate limit",
    );
    await sleep(retryDelayMs);
  }

  if (!lastResponse) {
    throw new AppError("aiSpecsGenerationFailed", "INTERNAL_SERVER_ERROR", 502);
  }

  return {
    response: lastResponse,
    responseBody: lastResponseBody,
    attempts: OPENAI_MAX_ATTEMPTS,
  };
};

const cleanSuggestionValue = (value: string) =>
  value
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s"'«“”„]+/, "")
    .replace(/[\s"'»“”„]+$/, "")
    .replace(/[.]+$/g, "")
    .trim();

const normalizeComparable = (value: string) =>
  value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s-]+/gu, "")
    .trim();

export const matchProductSpecOption = (value: string, options: string[] = []) => {
  const cleanedValue = cleanSuggestionValue(value);
  if (!cleanedValue || !options.length) return cleanedValue || null;

  const normalizedValue = normalizeComparable(cleanedValue);
  if (!normalizedValue) return null;
  const exactMatch = options.find((option) => normalizeComparable(option) === normalizedValue);
  if (exactMatch) return exactMatch;

  const looseMatches = options.filter((option) => {
    const normalizedOption = normalizeComparable(option);
    return normalizedOption &&
      (normalizedOption.includes(normalizedValue) || normalizedValue.includes(normalizedOption));
  });
  return looseMatches.length === 1 ? looseMatches[0] ?? null : null;
};

export const validateProductSpecSuggestion = (value: unknown, options?: string[]) => {
  if (typeof value !== "string") return null;
  const cleaned = cleanSuggestionValue(value);
  if (!cleaned || cleaned.length > 120 || invalidSuggestionPatterns.some((pattern) => pattern.test(cleaned))) {
    return null;
  }
  return matchProductSpecOption(cleaned, options);
};

const findMulticolorOption = (options: string[]) =>
  options.find((option) => {
    const normalized = normalizeComparable(option);
    return (
      normalized.includes("разноцвет") ||
      normalized.includes("многоцвет") ||
      normalized.includes("multicolor") ||
      normalized.includes("multi color") ||
      normalized.includes("multi-color")
    );
  }) ?? null;

const extractJsonObject = (value: string) => {
  const trimmed = value.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [trimmed];
  if (fencedMatch?.[1]) {
    candidates.unshift(fencedMatch[1].trim());
  }

  const startIndex = trimmed.indexOf("{");
  const endIndex = trimmed.lastIndexOf("}");
  if (startIndex >= 0 && endIndex > startIndex) {
    candidates.unshift(trimmed.slice(startIndex, endIndex + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Try next candidate.
    }
  }

  return null;
};

export const productSpecImageInstructions = [
  "Используй только то, что уверенно видно на самом товаре, прозрачной упаковке или ясно читается на упаковке как описание товара.",
  "Не придумывай бренд, производителя, модель, состав, материал, размер и другие внешние данные.",
  "Если значение нельзя определить надежно, верни null.",
  "Для поля type возвращай краткий тип продаваемого товара в форме короткого названия.",
  "Для поля color возвращай основной цвет самого товара. Игнорируй фон, реквизит, тени и случайные акценты.",
  "Для material возвращай материал только если он явно виден или надежно указан на упаковке.",
  "Для compatibility не придумывай точную модель. Если точная модель не подтверждена, используй общий класс устройства, например: смартфон.",
  "Для design возвращай краткое описание видимого дизайна, принта или стиля.",
  "Для features возвращай 1-2 краткие особенности, которые видны или надежно следуют из категории товара.",
  "Для purpose возвращай практическое назначение товара.",
  "Если сам товар не виден, а видна только коробка, тип можно определить по надписям и оформлению коробки, но цвет возвращай только если цвет варианта товара действительно подтверждается изображением; иначе null.",
  "Если у товара явно несколько основных цветов, используй разноцветный вариант только когда это действительно лучший ответ.",
].join(" ");

const buildSystemPrompt = () =>
  [
    "Ты заполняешь характеристики товара для маркетплейса по изображениям.",
    "Определи характеристики продаваемого товара, а не просто опиши фотографию.",
    "Верни строго один JSON-объект без markdown, пояснений и лишнего текста.",
    productSpecImageInstructions,
  ].join(" ");

const buildUserPrompt = (requestedSpecs: RequestedSpecSuggestion[]) => {
  const requestedFields = requestedSpecs.map((spec) => spec.kind);
  const lines = [
    `Разрешенные поля ответа: ${requestedFields.join(", ")}.`,
    "Верни JSON только с запрошенными полями.",
  ];

  for (const spec of requestedSpecs) {
    if (spec.kind === "type") {
      lines.push(
        `Для поля "${spec.kind}" определи тип продаваемого товара для характеристики "${spec.labelRu}".`,
      );
      if (spec.options?.length) {
        lines.push(
          `Выбери одно наиболее подходящее значение строго из списка: ${spec.options.join(", ")}.`,
        );
      } else {
        lines.push('Верни короткое значение без пояснений, например: "Настольная игра".');
      }
      continue;
    }

    if (spec.kind === "color") {
      const multicolorOption = spec.options?.length ? findMulticolorOption(spec.options) : null;
      lines.push(
        `Для поля "${spec.kind}" определи основной цвет товара для характеристики "${spec.labelRu}".`,
      );
      lines.push(
        "Ориентируйся на цвет самого товара или явно показанного варианта товара, а не на декоративный фон или случайный цвет упаковки.",
      );
      if (multicolorOption) {
        lines.push(
          `Если отчетливо видны несколько основных цветов товара, используй значение "${multicolorOption}".`,
        );
      }
      if (spec.options?.length) {
        lines.push(
          `Выбери одно наиболее подходящее значение строго из списка: ${spec.options.join(", ")}.`,
        );
      } else {
        lines.push('Верни короткое значение без пояснений, например: "Черный".');
      }
      continue;
    }

    const examples: Record<ProductSpecSuggestionKind, string> = {
      type: "Чехол",
      color: "Черный",
      material: "Поликарбонат",
      compatibility: "Смартфон",
      design: "Игровой принт",
      features: "Вырез под камеру",
      purpose: "Защита корпуса смартфона",
    };
    lines.push(
      `Для поля "${spec.kind}" заполни характеристику "${spec.labelRu}" только если значение надежно подтверждается товаром, категорией или видимыми данными.`,
    );
    if (spec.options?.length) {
      lines.push(
        `Выбери одно наиболее подходящее значение строго из списка: ${spec.options.join(", ")}.`,
      );
    } else {
      lines.push(`Верни короткое значение без пояснений, например: "${examples[spec.kind]}".`);
    }
  }

  const exampleFields = requestedSpecs.reduce<Record<string, string | null>>((accumulator, spec) => {
    accumulator[spec.kind] =
      spec.kind === "type"
        ? spec.options?.[0] ?? "Настольная игра"
        : spec.kind === "color"
          ? spec.options?.[0] ?? "Черный"
          : spec.options?.[0] ?? null;
    return accumulator;
  }, {});
  lines.push(`Пример ответа: ${JSON.stringify(exampleFields)}`);

  return lines.join("\n");
};

export const suggestProductSpecsFromImages = async (input: {
  imageUrls: string[];
  prepareImage?: ProductAiImagePreparer;
  requestedSpecs: RequestedSpecSuggestion[];
  logger?: ProductSpecSuggestionLogger;
}) => {
  const config = resolveTextAiConfig("vision", resolveOpenAiModel());
  if (!config) {
    throw new AppError("aiSpecsNotConfigured", "BAD_REQUEST", 400);
  }

  const normalizedRequestedSpecs = input.requestedSpecs.filter(
    (spec, index, list) => list.findIndex((candidate) => candidate.kind === spec.kind) === index,
  );
  if (!normalizedRequestedSpecs.length) {
    return { suggestions: {} as Partial<Record<ProductSpecSuggestionKind, string>> };
  }

  const startedAt = Date.now();
  const {
    imageDataUrls,
    sourceImageBytes,
    payloadImageBytes,
    imageLoadDurationMs,
  } = await prepareProductAiImages(input.imageUrls, input.prepareImage);
  const loadedImageCount = imageDataUrls.length;

  if (!imageDataUrls.length) {
    throw new AppError("aiSpecNoUsableImages", "BAD_REQUEST", 400);
  }

  const { apiKey, model } = config;
  const requestBody = JSON.stringify({
    model,
    reasoning: {
      effort: "minimal",
    },
    max_output_tokens: MAX_OUTPUT_TOKENS,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: buildSystemPrompt() }],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: buildUserPrompt(normalizedRequestedSpecs) },
          ...imageDataUrls.map((imageUrl) => ({
            type: "input_image" as const,
            image_url: imageUrl,
          })),
        ],
      },
    ],
  });

  const providerStartedAt = Date.now();
  const { response, responseBody, attempts } = await callOpenAiResponses({
    apiKey,
    model,
    body: requestBody,
    logger: input.logger,
    loadedImageCount,
    sourceImageBytes,
    payloadImageBytes,
  });
  const providerDurationMs = Date.now() - providerStartedAt;
  const providerError = responseBody?.error?.message?.trim() ?? null;
  const retryAfterHeader = response.headers.get("retry-after");

  input.logger?.info(
    {
      provider: resolveTextAiConfig("vision", resolveOpenAiModel())?.provider ?? "unconfigured",
      phase: "spec-suggestion-complete",
      model,
      requestedKinds: normalizedRequestedSpecs.map((spec) => spec.kind),
      loadedImageCount,
      sourceImageBytes,
      payloadImageBytes,
      imageLoadDurationMs,
      providerDurationMs,
      totalDurationMs: Date.now() - startedAt,
      status: response.status,
      attempts,
      providerError,
      retryAfterHeader,
    },
    "product spec suggestion timing",
  );

  if (!response.ok) {
    if (response.status === 429) {
      throw new AppError("rateLimited", "TOO_MANY_REQUESTS", 429);
    }
    if (response.status === 401 || response.status === 403) {
      throw new AppError("aiSpecsNotConfigured", "BAD_REQUEST", response.status);
    }
    const providerMessage = providerError?.toLowerCase() ?? "";
    if (providerMessage.includes("model")) {
      throw new AppError("aiSpecsNotConfigured", "BAD_REQUEST", response.status);
    }
    throw new AppError("aiSpecsGenerationFailed", "INTERNAL_SERVER_ERROR", response.status);
  }

  if (responseBody?.status === "incomplete") {
    input.logger?.warn(
      {
        provider: resolveTextAiConfig("vision", resolveOpenAiModel())?.provider ?? "unconfigured",
        phase: "spec-suggestion-incomplete",
        model,
        loadedImageCount,
        sourceImageBytes,
        payloadImageBytes,
        incompleteReason: responseBody.incomplete_details?.reason ?? null,
        attempts,
      },
      "product spec suggestion provider returned incomplete response",
    );
    throw new AppError("aiSpecsGenerationFailed", "INTERNAL_SERVER_ERROR", 502);
  }

  const rawText = extractResponseText(responseBody);
  const parsed = extractJsonObject(rawText);
  if (!parsed) {
    throw new AppError("aiSpecsGenerationFailed", "INTERNAL_SERVER_ERROR", 502);
  }

  const suggestions: Partial<Record<ProductSpecSuggestionKind, string>> = {};
  for (const spec of normalizedRequestedSpecs) {
    const matchingValue = validateProductSpecSuggestion(parsed[spec.kind], spec.options);
    if (matchingValue) suggestions[spec.kind] = matchingValue;
  }

  return {
    suggestions,
  };
};

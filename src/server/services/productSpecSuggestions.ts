import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

import sharp from "sharp";

import { AppError } from "@/server/services/errors";
import {
  downloadRemoteImage,
  normalizeProductImageUrl,
} from "@/server/services/productImageStorage";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";
const MAX_INPUT_IMAGES = 3;
const MAX_OUTPUT_TOKENS = 180;
const AI_IMAGE_MAX_DIMENSION = 1024;
const AI_IMAGE_TARGET_BYTES = 350_000;
const OPENAI_MAX_ATTEMPTS = 6;
const OPENAI_MAX_RETRY_DELAY_MS = 30_000;
const MANAGED_UPLOAD_PREFIX = "/uploads/imported-products/";
const publicRootDir = resolve(process.cwd(), "public");
const isTestRuntime = process.env.NODE_ENV === "test";

type DownloadedImage = {
  buffer: Buffer;
  contentType: string;
};

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

type RequestedSpecSuggestion = {
  kind: "type" | "color";
  labelRu: string;
  options?: string[];
};

const imageMimeByExtension: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".svg": "image/svg+xml",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

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

const resolveManagedLocalImagePath = (sourceUrl: string) => {
  try {
    const parsed = new URL(sourceUrl, "https://local.invalid");
    if (!parsed.pathname.startsWith(MANAGED_UPLOAD_PREFIX)) {
      return null;
    }
    const candidatePath = resolve(publicRootDir, parsed.pathname.slice(1));
    const rootPrefix = publicRootDir.endsWith(sep) ? publicRootDir : `${publicRootDir}${sep}`;
    if (candidatePath !== publicRootDir && !candidatePath.startsWith(rootPrefix)) {
      return null;
    }
    return candidatePath;
  } catch {
    return null;
  }
};

const readManagedLocalImage = async (sourceUrl: string): Promise<DownloadedImage | null> => {
  const filePath = resolveManagedLocalImagePath(sourceUrl);
  if (!filePath) {
    return null;
  }

  const contentType = imageMimeByExtension[extname(filePath).toLowerCase()];
  if (!contentType) {
    return null;
  }

  try {
    const buffer = await readFile(filePath);
    if (!buffer.length) {
      return null;
    }
    return {
      buffer,
      contentType,
    };
  } catch {
    return null;
  }
};

const loadImageForPrompt = async (rawUrl: string) => {
  const normalizedUrl = normalizeProductImageUrl(rawUrl);
  if (!normalizedUrl) {
    return null;
  }

  if (normalizedUrl.startsWith(MANAGED_UPLOAD_PREFIX)) {
    return readManagedLocalImage(normalizedUrl);
  }

  if (normalizedUrl.startsWith("data:image/")) {
    return null;
  }

  return downloadRemoteImage(normalizedUrl);
};

const optimizeImageForModel = async (image: DownloadedImage): Promise<DownloadedImage> => {
  const sourceBytes = image.buffer.byteLength;
  if (sourceBytes <= AI_IMAGE_TARGET_BYTES / 2 && image.contentType === "image/jpeg") {
    return image;
  }

  const candidates: Array<{ maxDimension: number; quality: number }> = [
    { maxDimension: AI_IMAGE_MAX_DIMENSION, quality: 72 },
    { maxDimension: AI_IMAGE_MAX_DIMENSION, quality: 60 },
    { maxDimension: 896, quality: 56 },
    { maxDimension: 768, quality: 50 },
    { maxDimension: 640, quality: 44 },
  ];

  let bestBuffer: Buffer | null = null;
  for (const candidate of candidates) {
    try {
      const nextBuffer = await sharp(image.buffer, { pages: 1 })
        .rotate()
        .resize({
          width: candidate.maxDimension,
          height: candidate.maxDimension,
          fit: "inside",
          withoutEnlargement: true,
        })
        .flatten({ background: "#ffffff" })
        .jpeg({
          quality: candidate.quality,
          mozjpeg: true,
        })
        .toBuffer();

      if (!bestBuffer || nextBuffer.byteLength < bestBuffer.byteLength) {
        bestBuffer = nextBuffer;
      }
      if (nextBuffer.byteLength <= AI_IMAGE_TARGET_BYTES) {
        bestBuffer = nextBuffer;
        break;
      }
    } catch {
      return image;
    }
  }

  if (!bestBuffer || bestBuffer.byteLength >= sourceBytes) {
    return image;
  }

  return {
    buffer: bestBuffer,
    contentType: "image/jpeg",
  };
};

const toDataUrl = (image: DownloadedImage) =>
  `data:${image.contentType};base64,${image.buffer.toString("base64")}`;

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
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: input.body,
    });
    lastResponse = response;

    const responseBody = (await response.json().catch(() => null)) as OpenAiResponseBody | null;
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
        provider: "openai",
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
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s-]+/gu, "")
    .trim();

const matchOption = (value: string, options: string[]) => {
  if (!options.length) {
    return value;
  }

  const normalizedValue = normalizeComparable(value);
  const exactMatch = options.find((option) => normalizeComparable(option) === normalizedValue);
  if (exactMatch) {
    return exactMatch;
  }

  const looseMatch = options.find((option) => {
    const normalizedOption = normalizeComparable(option);
    return normalizedOption.includes(normalizedValue) || normalizedValue.includes(normalizedOption);
  });

  return looseMatch ?? value;
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

const buildSystemPrompt = () =>
  [
    "Ты заполняешь характеристики товара для маркетплейса по изображениям.",
    "Определи характеристики продаваемого товара, а не просто опиши фотографию.",
    "Верни строго один JSON-объект без markdown, пояснений и лишнего текста.",
    "Используй только то, что уверенно видно на самом товаре, прозрачной упаковке или ясно читается на упаковке как описание товара.",
    "Не придумывай бренд, производителя, модель, состав, материал, размер и другие внешние данные.",
    "Если значение нельзя определить надежно, верни null.",
    "Для поля type возвращай краткий тип продаваемого товара в форме короткого названия.",
    "Для поля color возвращай основной цвет самого товара. Игнорируй фон, реквизит, тени и случайные акценты.",
    "Если сам товар не виден, а видна только коробка, тип можно определить по надписям и оформлению коробки, но цвет возвращай только если цвет варианта товара действительно подтверждается изображением; иначе null.",
    "Если у товара явно несколько основных цветов, используй разноцветный вариант только когда это действительно лучший ответ.",
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
  }

  const exampleFields = requestedSpecs.reduce<Record<string, string | null>>((accumulator, spec) => {
    accumulator[spec.kind] =
      spec.kind === "type"
        ? spec.options?.[0] ?? "Настольная игра"
        : spec.options?.[0] ?? "Черный";
    return accumulator;
  }, {});
  lines.push(`Пример ответа: ${JSON.stringify(exampleFields)}`);

  return lines.join("\n");
};

export const suggestProductSpecsFromImages = async (input: {
  imageUrls: string[];
  requestedSpecs: RequestedSpecSuggestion[];
  logger?: ProductSpecSuggestionLogger;
}) => {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  if (!apiKey) {
    throw new AppError("aiSpecsNotConfigured", "BAD_REQUEST", 400);
  }

  const normalizedRequestedSpecs = input.requestedSpecs.filter(
    (spec, index, list) => list.findIndex((candidate) => candidate.kind === spec.kind) === index,
  );
  if (!normalizedRequestedSpecs.length) {
    return { suggestions: {} as Partial<Record<"type" | "color", string>> };
  }

  const normalizedImageUrls = Array.from(
    new Set(input.imageUrls.map((value) => value.trim()).filter((value) => value.length > 0)),
  ).slice(0, MAX_INPUT_IMAGES);
  if (!normalizedImageUrls.length) {
    throw new AppError("aiSpecNoUsableImages", "BAD_REQUEST", 400);
  }

  const startedAt = Date.now();
  const imageLoadStartedAt = Date.now();
  const loadedImages = await Promise.all(
    normalizedImageUrls.map((imageUrl) => loadImageForPrompt(imageUrl)),
  );
  const imageLoadDurationMs = Date.now() - imageLoadStartedAt;
  const usableImages = loadedImages.filter((image): image is DownloadedImage => Boolean(image));
  const sourceImageBytes = usableImages.reduce((sum, image) => sum + image.buffer.byteLength, 0);
  const optimizedImages = await Promise.all(
    usableImages.map((image) => optimizeImageForModel(image)),
  );
  const payloadImageBytes = optimizedImages.reduce(
    (sum, image) => sum + image.buffer.byteLength,
    0,
  );
  const imageDataUrls = optimizedImages.map(toDataUrl);
  const loadedImageCount = imageDataUrls.length;

  if (!imageDataUrls.length) {
    throw new AppError("aiSpecNoUsableImages", "BAD_REQUEST", 400);
  }

  const model = resolveOpenAiModel();
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
      provider: "openai",
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
        provider: "openai",
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

  const suggestions: Partial<Record<"type" | "color", string>> = {};
  for (const spec of normalizedRequestedSpecs) {
    const rawValue = parsed[spec.kind];
    if (typeof rawValue !== "string") {
      continue;
    }
    const cleanedValue = cleanSuggestionValue(rawValue);
    if (
      !cleanedValue ||
      cleanedValue.length > 80 ||
      invalidSuggestionPatterns.some((pattern) => pattern.test(cleanedValue))
    ) {
      continue;
    }
    suggestions[spec.kind] = matchOption(cleanedValue, spec.options ?? []);
  }

  return {
    suggestions,
  };
};

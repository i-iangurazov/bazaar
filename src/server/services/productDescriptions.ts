import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

import sharp from "sharp";

import {
  downloadRemoteImage,
  normalizeProductImageUrl,
} from "@/server/services/productImageStorage";
import { AppError } from "@/server/services/errors";
import {
  defaultLocale,
  normalizeLocale as normalizeAppLocale,
  type Locale,
} from "@/lib/locales";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";
const MAX_INPUT_IMAGES = 3;
const MAX_OUTPUT_TOKENS = 220;
const MIN_DESCRIPTION_LENGTH = 150;
const MAX_DESCRIPTION_ATTEMPTS = 2;
const AI_IMAGE_MAX_DIMENSION = 1024;
const AI_IMAGE_TARGET_BYTES = 350_000;
const OPENAI_MAX_ATTEMPTS = 3;
const MANAGED_UPLOAD_PREFIX = "/uploads/imported-products/";
const publicRootDir = resolve(process.cwd(), "public");

type ProductDescriptionLocale = Locale;

type GenerateProductDescriptionInput = {
  name?: string | null;
  category?: string | null;
  isBundle?: boolean;
  locale?: string | null;
  imageUrls: string[];
  logger?: ProductDescriptionLogger;
};

type DownloadedImage = {
  buffer: Buffer;
  contentType: string;
};

type ProductDescriptionLogger = {
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

const normalizeLocale = (value?: string | null): ProductDescriptionLocale =>
  normalizeAppLocale(value) ?? defaultLocale;

const resolveOpenAiModel = () =>
  process.env.PRODUCT_DESCRIPTION_AI_MODEL?.trim() ||
  process.env.OPENAI_MODEL?.trim() ||
  DEFAULT_OPENAI_MODEL;

const resolveProviderConfig = (): {
  apiKey: string;
  model: string;
} | null => {
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  return openAiApiKey
    ? {
        apiKey: openAiApiKey,
        model: resolveOpenAiModel(),
      }
    : null;
};

const slowPhaseThresholdMs = 2_000;
const isTestRuntime = process.env.NODE_ENV === "test";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const cleanGeneratedDescription = (value: string) =>
  value
    .replace(/\s+/g, " ")
    .replace(/^[\s"'«“”„]+/, "")
    .replace(/[\s"'»“”„]+$/, "")
    .trim();

const metaDescriptionPatterns = [
  /на изображении/i,
  /товар показан/i,
  /описание строится/i,
  /текст не добавляет/i,
  /опираясь только/i,
  /в кадре/i,
  /сүрөттө көрүн/i,
  /кадрда .* берилген/i,
  /текст сүрөттөн/i,
  /сыпаттама .* таянат/i,
];

const literalCaptionPatterns = [
  /на коробке/i,
  /на упаковке/i,
  /на лицевой стороне/i,
  /название .* написано/i,
  /название .* указано/i,
  /упаковка имеет/i,
  /изображен[аоы]? /i,
  /изображены/i,
];

const isGenericMetaDescription = (value: string) =>
  metaDescriptionPatterns.some((pattern) => pattern.test(value));

const isLiteralCaptionDescription = (value: string) =>
  literalCaptionPatterns.reduce((count, pattern) => count + (pattern.test(value) ? 1 : 0), 0) >= 2;

const isAcceptableDescription = (value: string) =>
  value.length >= MIN_DESCRIPTION_LENGTH &&
  !isGenericMetaDescription(value) &&
  !isLiteralCaptionDescription(value);

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

const toDataUrl = (image: DownloadedImage) =>
  `data:${image.contentType};base64,${image.buffer.toString("base64")}`;

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

const callOpenAiResponses = async (input: {
  apiKey: string;
  model: string;
  body: string;
  logger?: ProductDescriptionLogger;
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
      : Math.max(500, Math.min(retryAfterMs ?? 1000 * attempt, 10_000));
    input.logger?.warn(
      {
        phase: "openai-retry",
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
      "retrying product description provider request after rate limit",
    );
    await sleep(retryDelayMs);
  }

  if (!lastResponse) {
    throw new AppError("aiDescriptionGenerationFailed", "INTERNAL_SERVER_ERROR", 502);
  }

  return {
    response: lastResponse,
    responseBody: lastResponseBody,
    attempts: OPENAI_MAX_ATTEMPTS,
  };
};

const buildSystemPrompt = (locale: ProductDescriptionLocale) => {
  if (locale === "en") {
    return [
      "You write accurate, concise product descriptions for product cards.",
      "Write only in English.",
      "Describe only what is clearly visible in the images.",
      "Describe the product for a shopper, not the photo, package, or image-review process.",
      "If the packaging or visible text makes the product type or purpose clear, mention it naturally.",
      "Do not invent composition, sizes, materials, flavor, volume, specifications, or certifications if they are not obvious.",
      "Return plain text only, with no markdown or lists.",
      "Write a natural marketplace description in 2-4 sentences.",
      `The response must be at least ${MIN_DESCRIPTION_LENGTH} characters.`,
    ].join(" ");
  }

  if (locale === "kg") {
    return [
      "Сен товар карточкалары үчүн так жана кыска сүрөттөмө жазасың.",
      "Текстти кыргыз тилинде жаз.",
      "Сүрөттөрдө так көрүнгөн нерселерди гана сүрөттө.",
      "Сүрөттү же кутуну сүрөттөп жаткандай эмес, сатылып жаткан товарды кардар үчүн сүрөттө.",
      "Эгер таңгактагы жазуу жана көрүнүш боюнча товардын түрү же колдонуу максаты түшүнүктүү болсо, аны табигый түрдө айт.",
      "Курамы, өлчөмү, материалы, даамы, көлөмү же сертификаттары так көрүнбөсө, ойлоп таппа.",
      "Жооп бир гана жөнөкөй текст болсун, markdown же тизме колдонбо.",
      "2-4 сүйлөмдөн турган, маркетплейс карточкасына ылайык табигый сүрөттөмө бер.",
      `Жооптун узундугу сөзсүз кеминде ${MIN_DESCRIPTION_LENGTH} белги болсун.`,
    ].join(" ");
  }

  return [
    "Ты пишешь точные и краткие описания для карточек товаров.",
    "Пиши только на русском языке.",
    "Описывай только то, что явно видно на изображениях.",
    "Описывай сам товар для покупателя, а не фотографию, коробку или процесс просмотра изображения.",
    "Если по оформлению и надписям очевиден тип товара или его назначение, назови это естественным языком.",
    "Не выдумывай состав, размеры, материалы, вкус, объем, характеристики или сертификаты, если это не очевидно.",
    "Верни только обычный текст без markdown и списков.",
    "Сформируй естественное описание для маркетплейса на 2-4 предложения.",
    `Длина ответа должна быть не меньше ${MIN_DESCRIPTION_LENGTH} символов.`,
  ].join(" ");
};

const buildUserPrompt = (input: { locale: ProductDescriptionLocale }) => {
  const lines = [
    input.locale === "en"
      ? "Create a product description using only the images."
      : input.locale === "kg"
        ? "Сүрөттөргө гана таянып товар үчүн сүрөттөмө түз."
        : "Сгенерируй описание товара, опираясь только на изображения.",
    input.locale === "en"
      ? `Include visible text, brand, color, shape, packaging, or purpose only when it is directly visible. Do not use the product name, category, or any other metadata outside the image. Return one description with at least ${MIN_DESCRIPTION_LENGTH} characters.`
      : input.locale === "kg"
        ? `Сүрөттөн түз көрүнгөн жазуу, бренд, түс, форма, таңгак же колдонуу мааниси бар болсо гана кош. Сырттан берилген аталыш, категория же башка метадайындарды колдонбо. Так бир сүрөттөмө кайтар жана аны ${MIN_DESCRIPTION_LENGTH} белгиден кыска кылба.`
        : `Если на изображении видны надписи, бренд, цвет, форма, упаковка или назначение, укажи это. Не используй название, категорию или другие метаданные вне самой картинки. Верни одно описание длиной не меньше ${MIN_DESCRIPTION_LENGTH} символов.`,
  ].filter(Boolean);

  return lines.join("\n");
};

const buildRetryPrompt = (input: {
  locale: ProductDescriptionLocale;
  previousDescription: string;
}) => {
  if (input.locale === "en") {
    return [
      `The previous answer is not suitable: "${input.previousDescription}".`,
      "Do not repeat it or describe the generation process.",
      "Write a new natural product-card description in plain language.",
      "Use only what is actually visible in the photo: shape, color, packaging, visible text, illustrations, appearance, and an obvious use case.",
      "Describe the product itself, not the image or what is printed on a box as an object of observation.",
      "Do not write phrases like \"visible in the image\", \"the product is shown\", \"this text\", \"the description is based on\", \"the box shows\", or \"the name says\".",
      "Do not use the product name, category, or external metadata.",
      "If the visible text and design make the product type and use clear, state that naturally and directly.",
      `Make the final text ${MIN_DESCRIPTION_LENGTH}-${MIN_DESCRIPTION_LENGTH + 120} characters long.`,
    ].join(" ");
  }

  if (input.locale === "kg") {
    return [
      `Мурунку жооп жараксыз болду: "${input.previousDescription}".`,
      `Аны колдонбо жана кайталаба. Жаңы сүрөттөмө жаз.`,
      "Сыпаттама товар карточкасы үчүн кадимки, табигый текст болушу керек.",
      "Товарды кардар сатып ала турган нерсе катары сүрөттө; кутунун үстүндөгү сүрөттү механикалык түрдө санаба.",
      "Жөн гана сүрөттө көрүнгөн нерселерди айт: түс, форма, таңгак, көрүнгөн жазуу, иллюстрация, сырткы көрүнүш жана ачык көрүнгөн колдонуу багыты.",
      "«Сүрөттө көрүнөт», «кадрда», «бул текст» сыяктуу мета сүйлөмдөрдү жазба.",
      "«кутуда сүрөттөлгөн», «аталышы жазылган» деген сыяктуу түз байкоону товар жөнүндө табигый сыпаттамага айлант.",
      "Аталышты, категорияны же сырттан берилген маалыматты колдонбо.",
      `Жооптун узундугу ${MIN_DESCRIPTION_LENGTH}-${MIN_DESCRIPTION_LENGTH + 120} белги аралыгында болсун.`,
    ].join(" ");
  }

  return [
    `Предыдущий ответ не подходит: "${input.previousDescription}".`,
    "Не повторяй его и не пересказывай процесс генерации.",
    "Напиши новое естественное описание для карточки товара обычным языком.",
    "Опирайся только на то, что реально видно на фото: форму, цвет, упаковку, заметные надписи, иллюстрации, внешний вид и очевидный сценарий использования.",
    "Описывай сам товар, а не то, что нарисовано на коробке как объект наблюдения.",
    "Не пиши фразы вроде «на изображении видно», «товар показан», «этот текст», «описание строится», «на коробке изображены», «название написано».",
    "Не используй название, категорию и любые внешние метаданные.",
    "Если по надписям и оформлению понятен тип товара, назови его и кратко передай, для чего он подходит.",
    `Сделай итоговый текст длиной ${MIN_DESCRIPTION_LENGTH}-${MIN_DESCRIPTION_LENGTH + 120} символов.`,
  ].join(" ");
};

const buildFactsPrompt = (locale: ProductDescriptionLocale) => {
  if (locale === "en") {
    return [
      "Give 6-8 short visual facts about the product photo.",
      "Return only facts, separated with ||.",
      "Mention only directly visible traits such as color, shape, packaging, visible text, illustrations, and appearance.",
      "Do not add generic phrases, meta explanations, or external information.",
    ].join(" ");
  }

  if (locale === "kg") {
    return [
      "Сүрөт боюнча 6-8 кыска визуалдык факт бер.",
      "Факттарды гана кайтар, алардын ортосуна || белгисин кой.",
      "Түс, форма, таңгак, көрүнгөн жазуу, иллюстрация, сырткы көрүнүш сыяктуу түз көрүнгөн белгилерди гана айт.",
      "Жалпы фразаларды, мета түшүндүрмөлөрдү жана сырттан берилген маалыматты кошпо.",
    ].join(" ");
  }

  return [
    "Дай 6-8 коротких визуальных фактов по фото товара.",
    "Верни только факты, разделяя их через ||.",
    "Указывай только прямо видимые признаки: цвет, форма, упаковка, заметные надписи, иллюстрации, внешний вид.",
    "Не пиши общие фразы, мета-объяснения и не добавляй внешние данные.",
  ].join(" ");
};

const buildFinalFromFactsPrompt = (input: {
  locale: ProductDescriptionLocale;
  facts: string[];
}) => {
  const factsBlock = input.facts.join(" || ");

  if (input.locale === "en") {
    return [
      `Use only these visual facts: ${factsBlock}.`,
      "Based on them, write one connected, natural description for a product card.",
      "Describe the product for a shopper instead of listing what is visible on the box or packaging.",
      `Make the text ${MIN_DESCRIPTION_LENGTH}-${MIN_DESCRIPTION_LENGTH + 120} characters long.`,
      "Do not turn the answer into a mechanical list or describe the image-analysis process.",
      "If the facts clearly indicate the product type and use case, say it naturally and directly.",
      "If any fact contains broken or unnatural packaging text, do not use it.",
      "Do not add external data or meta phrases.",
    ].join(" ");
  }

  if (input.locale === "kg") {
    return [
      `Мына ушул визуалдык факттарды гана колдон: ${factsBlock}.`,
      "Ушул факттардан товар карточкасы үчүн табигый, байланышкан бир сүрөттөмө жаз.",
      "Товарды кардар үчүн сүрөттө, кутуда эмне тартылганын кургак санап бербе.",
      `Текст ${MIN_DESCRIPTION_LENGTH}-${MIN_DESCRIPTION_LENGTH + 120} белги узундукта болсун.`,
      "Факттарды кургак тизме кылып кайталаба, бирок алардын баарын табигый түрдө колдон.",
      "Мета сүйлөмдөрдү жазба жана сүрөттүн өзү тууралуу түшүндүрмө бербе.",
      "Эгер факттардан товардын түрү же колдонуу багыты түшүнүктүү болсо, аны жандуу, бирок так формада айт.",
      "Эгер факттардын арасында үзүлгөн же табигый эмес текст бөлүгү болсо, аны колдонбо.",
    ].join(" ");
  }

  return [
    `Используй только эти визуальные факты: ${factsBlock}.`,
    "На их основе напиши одно связное, естественное описание для карточки товара.",
    "Опиши сам товар для покупателя, а не перечисляй, что видно на коробке или упаковке.",
    `Сделай текст длиной ${MIN_DESCRIPTION_LENGTH}-${MIN_DESCRIPTION_LENGTH + 120} символов.`,
    "Не превращай ответ в механический список и не пересказывай процесс анализа изображения.",
    "Если по фактам очевиден тип товара и его сценарий использования, назови это естественно и по делу.",
    "Если среди фактов есть оборванные или неестественные фрагменты текста с упаковки, не используй их.",
    "Не добавляй внешние данные и не пиши мета-фразы.",
  ].join(" ");
};

const normalizeFact = (value: string) =>
  value
    .replace(/^[\s\-*•\d.)]+/, "")
    .replace(/[.!?;:,]+$/g, "")
    .trim();

const looksTruncatedFact = (value: string) =>
  /\b(?:в|во|на|с|со|к|ко|о|об|и|или|для|по|из|от|у)$/i.test(value);

const parseVisualFacts = (value: string) => {
  const candidates = value
    .split(/\|\||\n+/)
    .flatMap((part) => part.split(/;/))
    .map(normalizeFact)
    .filter((part) => part.length >= 4)
    .filter((part) => !looksTruncatedFact(part))
    .filter((part) => !isGenericMetaDescription(part));

  const uniqueFacts: string[] = [];
  const seen = new Set<string>();
  for (const fact of candidates) {
    const normalized = fact.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    uniqueFacts.push(fact);
  }
  return uniqueFacts.slice(0, 8);
};

const joinFacts = (facts: string[]) => facts.join(", ");

const buildDescriptionFromFacts = (input: {
  locale: ProductDescriptionLocale;
  facts: string[];
  seedDescription?: string;
}) => {
  const normalizedSeed = cleanGeneratedDescription(input.seedDescription ?? "");
  const seed =
    normalizedSeed && !isGenericMetaDescription(normalizedSeed)
      ? normalizedSeed.replace(/[.!?]+$/g, "")
      : "";
  const facts = [...input.facts, ...(seed && seed.length >= 12 ? [seed] : [])]
    .map(normalizeFact)
    .filter((value) => value.length >= 4);

  const firstGroup = facts.slice(0, 3);
  const secondGroup = facts.slice(3, 6);
  const fallbackGroup = facts.slice(0, 2);

  if (input.locale === "en") {
    const firstSentence = firstGroup.length
      ? `The product's appearance highlights ${joinFacts(firstGroup)}.`
      : "The product has visible packaging, shape, and clean visual accents.";
    const secondSentence = secondGroup.length
      ? `Additional visible details include ${joinFacts(secondGroup)}, giving the item a clear and complete product-card presence.`
      : "The visible details make the item easy to understand as a neatly presented catalogue product.";
    const thirdSentence = fallbackGroup.length
      ? `This combination helps shoppers recognize the item quickly in the catalogue: ${joinFacts(fallbackGroup)} support the overall visual impression.`
      : "The combination of visible details makes the product clear enough for a concise catalogue description.";
    const closingSentence =
      "The description is based only on clearly distinguishable visual product traits and keeps a natural marketplace style.";

    let description = [firstSentence, secondSentence, thirdSentence, closingSentence].join(" ");
    if (description.length < MIN_DESCRIPTION_LENGTH) {
      description = `${description} The result gives the product card useful text without adding unsupported assumptions.`;
    }
    return description;
  }

  if (input.locale === "kg") {
    const firstSentence = firstGroup.length
      ? `Товардын көрүнүшүндө ${joinFacts(firstGroup)} сыяктуу деталдар айырмаланып турат.`
      : "Товардын көрүнүшү таңгак, форма жана визуалдык жасалгасы менен айырмаланат.";
    const secondSentence = secondGroup.length
      ? `Ошондой эле ${joinFacts(secondGroup)} сыяктуу белгилер байкалат, ошондуктан товар карточкасы үчүн образы түшүнүктүү кабыл алынат.`
      : "Сүрөттөн көрүнгөн белгилер товарды визуалдык жактан түшүнүүгө жана карточкада так берүүгө жетиштүү көрүнөт.";
    const thirdSentence = fallbackGroup.length
      ? `Бул визуалдык айкалыш товарды каталогда тез таанууга жардам берет: ${joinFacts(fallbackGroup)} жалпы сырткы образды толуктайт.`
      : "Көрүнгөн деталдардын айкалышы товарды каталогда тез таанууга жардам берип, сырткы образын так жеткирет.";
    const closingSentence =
      "Сыпаттама сүрөттөн түз көрүнгөн белгилерге гана таянып түзүлдү жана маркетплейс карточкасына ылайык табигый форматта берилди.";

    let description = [firstSentence, secondSentence, thirdSentence, closingSentence].join(" ");
    if (description.length < MIN_DESCRIPTION_LENGTH) {
      description = `${description} Визуалдык берилиши тыкан көрүнүп, карточкада товарды ишенимдүү кабыл алууга шарт түзөт.`;
    }
    return description;
  }

  const firstSentence = firstGroup.length
    ? `Во внешнем виде товара выделяются ${joinFacts(firstGroup)}.`
    : "Во внешнем виде товара заметны упаковка, форма и аккуратные визуальные акценты.";
  const secondSentence = secondGroup.length
    ? `Дополнительно считываются ${joinFacts(secondGroup)}, поэтому образ товара выглядит цельно и понятно для карточки.`
    : "Видимые детали помогают воспринимать товар как аккуратно оформленную позицию для карточки каталога.";
  const thirdSentence = fallbackGroup.length
    ? `Такое сочетание элементов помогает быстрее представить товар в каталоге: ${joinFacts(fallbackGroup)} поддерживают общий визуальный образ.`
    : "Сочетание заметных элементов делает внешний вид товара понятным и достаточно выразительным для карточки.";
  const closingSentence =
    "Описание собрано по реально различимым визуальным признакам товара и сохраняет естественный, пригодный для маркетплейса стиль.";

  let description = [firstSentence, secondSentence, thirdSentence, closingSentence].join(" ");
  if (description.length < MIN_DESCRIPTION_LENGTH) {
    description = `${description} В итоге карточка получает содержательный текст, который передает внешний вид товара без лишних домыслов.`;
  }
  return description;
};

export const generateProductDescriptionFromImages = async (
  input: GenerateProductDescriptionInput,
) => {
  const startedAt = Date.now();
  const logger = input.logger;
  const providerConfig = resolveProviderConfig();
  if (!providerConfig) {
    throw new AppError("aiDescriptionNotConfigured", "BAD_REQUEST", 400);
  }

  const normalizedImageUrls = Array.from(
    new Set(input.imageUrls.map((value) => value.trim()).filter((value) => value.length > 0)),
  ).slice(0, MAX_INPUT_IMAGES);
  if (!normalizedImageUrls.length) {
    throw new AppError("aiDescriptionImageRequired", "BAD_REQUEST", 400);
  }

  const locale = normalizeLocale(input.locale);
  const imageLoadStartedAt = Date.now();
  const imageLoadMetrics: Array<{
    url: string;
    durationMs: number;
    ok: boolean;
    bytes: number;
  }> = [];
  const loadedImages = await Promise.all(
    normalizedImageUrls.map(async (imageUrl) => {
      const imageStartedAt = Date.now();
      const image = await loadImageForPrompt(imageUrl);
      imageLoadMetrics.push({
        url: imageUrl,
        durationMs: Date.now() - imageStartedAt,
        ok: Boolean(image),
        bytes: image?.buffer.byteLength ?? 0,
      });
      return image;
    }),
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
  const imageDataUrls = optimizedImages
    .filter((image): image is DownloadedImage => Boolean(image))
    .map(toDataUrl);
  const loadedImageCount = imageDataUrls.length;
  if (!imageDataUrls.length) {
    logger?.warn(
      {
        phase: "image-load",
        durationMs: imageLoadDurationMs,
        imageCount: normalizedImageUrls.length,
        loadedImageCount,
        sourceImageBytes,
        payloadImageBytes,
        imageLoadMetrics,
      },
      "product description generation skipped: no usable images",
    );
    throw new AppError("aiDescriptionNoUsableImages", "BAD_REQUEST", 400);
  }

  const { apiKey, model } = providerConfig;
  const provider = "openai";
  const buildProviderRequestBody = (promptText: string) =>
    JSON.stringify({
      model,
      reasoning: {
        effort: "minimal",
      },
      max_output_tokens: MAX_OUTPUT_TOKENS,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: buildSystemPrompt(locale) }],
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: promptText },
            ...imageDataUrls.map((imageUrl) => ({
              type: "input_image" as const,
              image_url: imageUrl,
            })),
          ],
        },
      ],
    });

  const runProviderRequest = async (
    inputPrompt: string,
    phase: "complete" | "rewrite-retry" | "fact-extract" | "fact-compose" = "complete",
  ) => {
    const requestBody = buildProviderRequestBody(inputPrompt);

    const providerStartedAt = Date.now();
    const { response, responseBody, attempts } = await callOpenAiResponses({
      apiKey,
      model,
      body: requestBody,
      logger,
      loadedImageCount,
      sourceImageBytes,
      payloadImageBytes,
    });
    const providerDurationMs = Date.now() - providerStartedAt;
    const parseDurationMs = 0;
    const providerError = (responseBody as OpenAiResponseBody | null)?.error?.message?.trim() ?? null;
    const retryAfterHeader = response.headers.get("retry-after");

    logger?.info(
      {
        provider,
        phase,
        model,
        imageCount: normalizedImageUrls.length,
        loadedImageCount,
        sourceImageBytes,
        payloadImageBytes,
        imageLoadDurationMs,
        providerDurationMs,
        parseDurationMs,
        totalDurationMs: Date.now() - startedAt,
        status: response.status,
        attempts,
        providerError,
        retryAfterHeader,
      },
      phase === "complete"
        ? "product description generation timing"
        : phase === "rewrite-retry"
          ? "product description regeneration timing"
          : phase === "fact-extract"
            ? "product description fact extraction timing"
            : "product description fact composition timing",
    );

    if (imageLoadDurationMs >= slowPhaseThresholdMs) {
      logger?.warn(
        {
          phase: "image-load",
          durationMs: imageLoadDurationMs,
          imageLoadMetrics,
          loadedImageCount,
          sourceImageBytes,
          payloadImageBytes,
        },
        "slow product description image loading",
      );
    }
    if (providerDurationMs >= slowPhaseThresholdMs) {
      logger?.warn(
        {
          provider,
          phase:
            phase === "complete"
              ? "provider-request"
              : phase === "rewrite-retry"
                ? "provider-request-retry"
                : phase === "fact-extract"
                  ? "provider-request-facts"
                  : "provider-request-fact-compose",
          durationMs: providerDurationMs,
          model,
          loadedImageCount,
          sourceImageBytes,
          payloadImageBytes,
          status: response.status,
          attempts,
          providerError,
          retryAfterHeader,
        },
        phase === "complete"
          ? "slow product description provider request"
          : phase === "rewrite-retry"
            ? "slow product description provider retry request"
            : phase === "fact-extract"
              ? "slow product description fact extraction request"
              : "slow product description fact composition request",
      );
    }
    if (parseDurationMs >= slowPhaseThresholdMs) {
      logger?.warn(
        {
          phase: "response-parse",
          durationMs: parseDurationMs,
          status: response.status,
        },
        "slow product description response parsing",
      );
    }

    if (!response.ok) {
      if (response.status === 429) {
        logger?.warn(
          {
            provider,
            phase:
              phase === "complete"
                ? "provider-response"
                : phase === "rewrite-retry"
                  ? "provider-response-retry"
                  : phase === "fact-extract"
                    ? "provider-response-facts"
                    : "provider-response-fact-compose",
            status: response.status,
            attempts,
            providerError,
            retryAfterHeader,
            model,
            loadedImageCount,
            sourceImageBytes,
            payloadImageBytes,
          },
          "product description provider returned rate limit",
        );
        throw new AppError("rateLimited", "TOO_MANY_REQUESTS", 429);
      }
      if (response.status === 401 || response.status === 403) {
        throw new AppError("aiDescriptionNotConfigured", "BAD_REQUEST", response.status);
      }
      const providerMessage = providerError?.toLowerCase() ?? "";
      if (providerMessage.includes("model")) {
        throw new AppError("aiDescriptionNotConfigured", "BAD_REQUEST", response.status);
      }
      throw new AppError("aiDescriptionGenerationFailed", "INTERNAL_SERVER_ERROR", response.status);
    }

    if (responseBody?.status === "incomplete") {
      logger?.warn(
        {
          provider,
          phase: `${phase}-incomplete`,
          model,
          loadedImageCount,
          sourceImageBytes,
          payloadImageBytes,
          incompleteReason: responseBody.incomplete_details?.reason ?? null,
          attempts,
        },
        "product description provider returned incomplete response",
      );
      throw new AppError("aiDescriptionGenerationFailed", "INTERNAL_SERVER_ERROR", 502);
    }

    const description = cleanGeneratedDescription(
      extractResponseText(responseBody as OpenAiResponseBody | null),
    );
    if (!description) {
      throw new AppError("aiDescriptionGenerationFailed", "INTERNAL_SERVER_ERROR", 502);
    }

    return description;
  };

  try {
    let description = await runProviderRequest(buildUserPrompt({ locale }), "complete");

    for (let attempt = 2; attempt <= MAX_DESCRIPTION_ATTEMPTS; attempt += 1) {
      if (isAcceptableDescription(description)) {
        break;
      }
      logger?.warn(
        {
          provider,
          phase: "description-quality",
          attempt: attempt - 1,
          model,
          descriptionLength: description.length,
          minLength: MIN_DESCRIPTION_LENGTH,
          generic: isGenericMetaDescription(description),
        },
        "generated product description needs rewrite",
      );
      description = await runProviderRequest(
        buildRetryPrompt({ locale, previousDescription: description }),
        "rewrite-retry",
      );
    }

    if (!isAcceptableDescription(description)) {
      logger?.warn(
        {
          provider,
          phase: "description-quality-final",
          model,
          descriptionLength: description.length,
          minLength: MIN_DESCRIPTION_LENGTH,
          generic: isGenericMetaDescription(description),
        },
        "generated product description remained invalid",
      );
      const factText = await runProviderRequest(buildFactsPrompt(locale), "fact-extract");
      const facts = parseVisualFacts(factText);
      const composedDescription =
        facts.length > 0
          ? await runProviderRequest(buildFinalFromFactsPrompt({ locale, facts }), "fact-compose")
          : "";
      const fallbackDescription = isAcceptableDescription(composedDescription)
        ? composedDescription
        : buildDescriptionFromFacts({
            locale,
            facts,
            seedDescription: composedDescription || description,
          });
      logger?.warn(
        {
          provider,
          phase: "description-fallback",
          model,
          factCount: facts.length,
          composedLength: composedDescription.length,
          fallbackLength: fallbackDescription.length,
        },
        "using fact-based fallback for product description",
      );
      description = fallbackDescription;
    }

    return {
      description,
    };
  } catch (error) {
    logger?.error(
      {
        provider,
        model,
        imageCount: normalizedImageUrls.length,
        loadedImageCount,
        sourceImageBytes,
        payloadImageBytes,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? { message: error.message, name: error.name } : error,
      },
      "product description generation failed",
    );
    throw error;
  }
};

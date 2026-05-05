import { randomUUID } from "node:crypto";
import type { AttributeType, Prisma } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";
import {
  resolveUniqueGeneratedBarcode,
  type BarcodeGenerationMode,
} from "@/server/services/barcodes";
import { recordFirstEvent } from "@/server/services/productEvents";
import { assertWithinLimits } from "@/server/services/planLimits";
import {
  ensureProductCategory,
  listProductCategoriesFromDb,
  normalizeProductCategoryNames,
  normalizeProductCategoryName,
  resolvePrimaryProductCategory,
} from "@/server/services/productCategories";
import {
  isManagedProductImageUrl,
  normalizeProductImageUrl,
  resolveProductImageUrl,
  type ResolveProductImageUrlResult,
} from "@/server/services/productImageStorage";
import { generateProductDescriptionFromImages } from "@/server/services/productDescriptions";
import { normalizeScanValue } from "@/lib/scanning/normalize";
import { assignProductToStore } from "@/server/services/storeAccess";

export type CreateProductInput = {
  organizationId: string;
  actorId: string;
  requestId: string;
  sku?: string | null;
  name: string;
  storeId?: string | null;
  category?: string | null;
  categories?: string[] | null;
  baseUnitId: string;
  basePriceKgs?: number | null;
  purchasePriceKgs?: number | null;
  avgCostKgs?: number | null;
  description?: string | null;
  photoUrl?: string | null;
  images?: {
    id?: string;
    url: string;
    position?: number;
  }[];
  supplierId?: string;
  barcodes?: string[];
  packs?: {
    id?: string;
    packName: string;
    packBarcode?: string | null;
    multiplierToBase: number;
    allowInPurchasing?: boolean | null;
    allowInReceiving?: boolean | null;
  }[];
  variants?: {
    id?: string;
    name?: string | null;
    sku?: string | null;
    attributes?: Record<string, unknown>;
  }[];
  isBundle?: boolean;
  bundleComponents?: {
    componentProductId: string;
    componentVariantId?: string | null;
    qty: number;
  }[];
};

const GENERATED_SKU_PREFIX = "SKU-";
const GENERATED_SKU_PAD_LENGTH = 6;
const GENERATED_SKU_MAX_PROBES = 10_000;
const GENERATED_SKU_MAX_RETRIES = 5;
const MIN_PRODUCT_BARCODE_LENGTH = 4;
const CATEGORY_ARRANGEMENT_OPENAI_URL = "https://api.openai.com/v1/responses";
const CATEGORY_ARRANGEMENT_MODEL =
  process.env.PRODUCT_CATEGORY_AI_MODEL?.trim() ||
  process.env.OPENAI_MODEL?.trim() ||
  "gpt-4.1-mini";
const CATEGORY_ARRANGEMENT_BATCH_SIZE = 25;
const CATEGORY_ARRANGEMENT_OPENAI_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.PRODUCT_CATEGORY_AI_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed >= 5_000 ? parsed : 18_000;
})();
const CATEGORY_ARRANGEMENT_MIN_AI_CONFIDENCE = 0.65;
const CATEGORY_ARRANGEMENT_IMAGE_BATCH_SIZE = 8;
const CATEGORY_ARRANGEMENT_MAX_IMAGE_DATA_URL_LENGTH = 900_000;
const MEN_CATEGORY_NAME = "Мужчины";
const WOMEN_CATEGORY_NAME = "Женщины";

type CategoryArrangementGender = "MEN" | "WOMEN";

type CategoryArrangementProduct = {
  id: string;
  name: string;
  sku?: string | null;
  category: string | null;
  categories: string[];
  description: string | null;
  photoUrl?: string | null;
  images?: Array<{ url: string }>;
  variants?: Array<{
    name: string | null;
    sku: string | null;
    attributes: Prisma.JsonValue;
  }>;
};

type CategoryArrangementDecision = {
  gender: CategoryArrangementGender;
  confidence: number;
  reason: string;
  inferredCategory?: string | null;
};

type CategoryArrangementContext = {
  availableCategories: string[];
};

const resolveNormalizedProductCategories = (input: {
  category?: string | null;
  categories?: Array<string | null | undefined> | null;
}) => {
  if (input.categories !== undefined) {
    return normalizeProductCategoryNames([
      normalizeProductCategoryName(input.category),
      ...(input.categories ?? []),
    ]);
  }
  return normalizeProductCategoryNames([input.category]);
};

const areProductCategoryListsEqual = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const normalizeSearchText = (value: string) =>
  value.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

const includesAnyPattern = (text: string, patterns: RegExp[]) =>
  patterns.some((pattern) => pattern.test(text));

const menCategoryPatterns = [
  /\bmen\b/i,
  /\bman\b/i,
  /\bmale\b/i,
  /муж/i,
  /мальчик/i,
  /парн/i,
  /эркек/i,
  /ул бала/i,
];

const womenCategoryPatterns = [
  /\bwomen\b/i,
  /\bwoman\b/i,
  /\bfemale\b/i,
  /жен/i,
  /девоч/i,
  /девуш/i,
  /дам/i,
  /аял/i,
  /кыз/i,
];

const womenClothingPatterns = [
  /плать/i,
  /юбк/i,
  /сарафан/i,
  /блуз/i,
  /топ\b/i,
  /боди\b/i,
  /бра\b/i,
  /лиф/i,
  /корсет/i,
  /туника/i,
  /колгот/i,
];

const adultClothingPatterns = [
  /одежд/i,
  /брюк/i,
  /джинс/i,
  /штан/i,
  /костюм/i,
  /пиджак/i,
  /рубаш/i,
  /футбол/i,
  /свитер/i,
  /джемпер/i,
  /куртк/i,
  /пальто/i,
  /толстов/i,
  /худи/i,
  /майк/i,
  /кофт/i,
  /clothes?/i,
  /apparel/i,
  /pants?/i,
  /jeans?/i,
  /suits?/i,
  /jackets?/i,
  /shirts?/i,
  /hoodies?/i,
];

const footwearPatterns = [
  /обув/i,
  /кроссов/i,
  /кед/i,
  /ботин/i,
  /сапог/i,
  /туфл/i,
  /босонож/i,
  /shoes?/i,
  /sneakers?/i,
  /boots?/i,
];

const categoryInferenceRules: Array<{ category: string; patterns: RegExp[] }> = [
  { category: "Платья", patterns: [/плать/i, /сарафан/i, /\bdress(?:es)?\b/i] },
  { category: "Юбки", patterns: [/юбк/i, /\bskirts?\b/i] },
  { category: "Блузки", patterns: [/блуз/i, /\bblouses?\b/i] },
  { category: "Топы", patterns: [/\bтоп\b/i, /\btops?\b/i] },
  { category: "Футболки", patterns: [/футбол/i, /майк/i, /\bt-?shirts?\b/i, /\btees?\b/i] },
  { category: "Рубашки", patterns: [/рубаш/i, /\bshirts?\b/i] },
  { category: "Джинсы", patterns: [/джинс/i, /\bjeans?\b/i] },
  { category: "Брюки", patterns: [/брюк/i, /штан/i, /\bpants?\b/i, /\btrousers?\b/i] },
  { category: "Костюмы", patterns: [/костюм/i, /\bsuits?\b/i] },
  {
    category: "Худи и толстовки",
    patterns: [/худи/i, /толстов/i, /\bhoodies?\b/i, /\bsweatshirts?\b/i],
  },
  { category: "Свитеры", patterns: [/свитер/i, /джемпер/i, /\bsweaters?\b/i, /\bjumpers?\b/i] },
  { category: "Куртки", patterns: [/куртк/i, /\bjackets?\b/i] },
  { category: "Пальто", patterns: [/пальто/i, /\bcoats?\b/i] },
  { category: "Обувь", patterns: footwearPatterns },
  {
    category: "Нижнее белье",
    patterns: [/бель/i, /\bбра\b/i, /лиф/i, /трус/i, /\bunderwear\b/i, /\blingerie\b/i],
  },
  { category: "Сумки", patterns: [/сумк/i, /\bbags?\b/i, /\bhandbags?\b/i] },
  {
    category: "Аксессуары",
    patterns: [
      /аксессуар/i,
      /ремень/i,
      /шарф/i,
      /шапк/i,
      /перчат/i,
      /\bbelt\b/i,
      /\bscarves?\b/i,
      /\bgloves?\b/i,
    ],
  },
  { category: "Спортивная одежда", patterns: [/спорт/i, /\bsportswear\b/i, /\btraining\b/i] },
];

const genderCategoryNameSet = new Set(
  [
    MEN_CATEGORY_NAME,
    WOMEN_CATEGORY_NAME,
    "men",
    "women",
    "мужской",
    "мужская",
    "мужские",
    "женский",
    "женская",
    "женские",
  ].map((value) => normalizeSearchText(value)),
);

const categoryNameForGender = (gender: CategoryArrangementGender) =>
  gender === "MEN" ? MEN_CATEGORY_NAME : WOMEN_CATEGORY_NAME;

const isGenderCategoryName = (category: string) =>
  genderCategoryNameSet.has(normalizeSearchText(category));

const categoryMatchKey = (value?: string | null) =>
  normalizeSearchText(value ?? "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();

const resolveExactExistingArrangementCategory = (
  candidate: string | null | undefined,
  availableCategories: string[],
) => {
  const normalizedCandidate = normalizeProductCategoryName(candidate);
  if (!normalizedCandidate) {
    return null;
  }
  const candidateKey = categoryMatchKey(normalizedCandidate);
  if (!candidateKey) {
    return null;
  }
  return (
    availableCategories.find((category) => categoryMatchKey(category) === candidateKey) ?? null
  );
};

const resolveExistingArrangementCategory = (
  candidate: string | null | undefined,
  availableCategories: string[],
) => {
  const normalizedCandidate = normalizeProductCategoryName(candidate);
  if (!normalizedCandidate) {
    return null;
  }
  const candidateKey = categoryMatchKey(normalizedCandidate);
  if (!candidateKey) {
    return null;
  }
  const exactMatch = resolveExactExistingArrangementCategory(
    normalizedCandidate,
    availableCategories,
  );
  if (exactMatch) {
    return exactMatch;
  }
  const candidateText = normalizeSearchText(normalizedCandidate);
  for (const rule of categoryInferenceRules) {
    const ruleKey = categoryMatchKey(rule.category);
    if (ruleKey === candidateKey || includesAnyPattern(candidateText, rule.patterns)) {
      const existingMatch = resolveRuleMatchedExistingCategory(rule, availableCategories);
      if (existingMatch) {
        return existingMatch;
      }
    }
  }
  return null;
};

const resolveRuleMatchedExistingCategory = (
  rule: { category: string; patterns: RegExp[] },
  availableCategories: string[],
) =>
  resolveExactExistingArrangementCategory(rule.category, availableCategories) ??
  availableCategories.find((category) =>
    includesAnyPattern(normalizeSearchText(category), rule.patterns),
  ) ??
  null;

const stringifyArrangementValue = (value: unknown, depth = 0): string[] => {
  if (value === null || value === undefined || depth > 3) {
    return [];
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => stringifyArrangementValue(item, depth + 1));
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => [
      key,
      ...stringifyArrangementValue(item, depth + 1),
    ]);
  }
  return [];
};

const variantEvidenceForCategoryArrangement = (product: CategoryArrangementProduct) =>
  (product.variants ?? []).flatMap((variant) => [
    variant.name,
    variant.sku,
    ...stringifyArrangementValue(variant.attributes),
  ]);

const categoryArrangementText = (product: CategoryArrangementProduct) =>
  normalizeSearchText(
    [
      product.name,
      product.sku,
      product.category,
      ...product.categories,
      product.description,
      ...variantEvidenceForCategoryArrangement(product),
    ]
      .filter(Boolean)
      .join(" "),
  );

const inferProductCategoryLocally = (
  product: CategoryArrangementProduct,
  context: CategoryArrangementContext,
) => {
  const text = categoryArrangementText(product);
  for (const rule of categoryInferenceRules) {
    if (includesAnyPattern(text, rule.patterns)) {
      return resolveRuleMatchedExistingCategory(rule, context.availableCategories);
    }
  }
  return null;
};

const extractLikelyAdultSizes = (text: string) => {
  const matches = Array.from(text.matchAll(/(?:^|[^\d])([3-6][0-9])(?:[^\d]|$)/g))
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value >= 34 && value <= 64);
  return Array.from(new Set(matches));
};

const classifyProductGenderBySizeSignals = (text: string): CategoryArrangementDecision | null => {
  const sizes = extractLikelyAdultSizes(text);
  if (!sizes.length) {
    return null;
  }

  const hasFootwearSignal = includesAnyPattern(text, footwearPatterns);
  const hasClothingSignal =
    hasFootwearSignal ||
    includesAnyPattern(text, adultClothingPatterns) ||
    includesAnyPattern(text, womenClothingPatterns);
  if (!hasClothingSignal) {
    return null;
  }

  const min = Math.min(...sizes);
  const max = Math.max(...sizes);
  if (hasFootwearSignal) {
    if (max <= 39) {
      return {
        gender: "WOMEN",
        confidence: 0.72,
        reason: "footwear_size_range",
        inferredCategory: "Обувь",
      };
    }
    if (min >= 41) {
      return {
        gender: "MEN",
        confidence: 0.72,
        reason: "footwear_size_range",
        inferredCategory: "Обувь",
      };
    }
    return null;
  }

  if (max <= 46) {
    return { gender: "WOMEN", confidence: 0.7, reason: "apparel_size_range" };
  }
  if (min >= 48) {
    return { gender: "MEN", confidence: 0.7, reason: "apparel_size_range" };
  }
  return null;
};

const classifyProductGenderLocally = (
  product: CategoryArrangementProduct,
  context: CategoryArrangementContext,
): CategoryArrangementDecision | null => {
  const text = categoryArrangementText(product);
  const inferredCategory = inferProductCategoryLocally(product, context);
  const menMatched = includesAnyPattern(text, menCategoryPatterns);
  const womenMatched = includesAnyPattern(text, womenCategoryPatterns);

  if (menMatched && !womenMatched) {
    return { gender: "MEN", confidence: 0.9, reason: "gender_keyword", inferredCategory };
  }
  if (womenMatched && !menMatched) {
    return { gender: "WOMEN", confidence: 0.9, reason: "gender_keyword", inferredCategory };
  }
  if (!menMatched && !womenMatched && includesAnyPattern(text, womenClothingPatterns)) {
    return {
      gender: "WOMEN",
      confidence: 0.82,
      reason: "women_clothing_keyword",
      inferredCategory,
    };
  }
  if (!menMatched && !womenMatched) {
    const sizeDecision = classifyProductGenderBySizeSignals(text);
    return sizeDecision
      ? {
          ...sizeDecision,
          inferredCategory:
            resolveExistingArrangementCategory(
              sizeDecision.inferredCategory,
              context.availableCategories,
            ) ?? inferredCategory,
        }
      : null;
  }
  return null;
};

const extractOpenAiText = (body: unknown) => {
  if (!body || typeof body !== "object") {
    return "";
  }
  const record = body as {
    output_text?: unknown;
    output?: Array<{
      content?: Array<{
        text?: unknown;
      }>;
    }>;
  };
  if (typeof record.output_text === "string") {
    return record.output_text;
  }
  return (
    record.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => {
        if (typeof content.text === "string") {
          return content.text;
        }
        if (
          content.text &&
          typeof content.text === "object" &&
          "value" in content.text &&
          typeof content.text.value === "string"
        ) {
          return content.text.value;
        }
        return "";
      })
      .join("\n") ?? ""
  );
};

const parseAiCategoryArrangementJson = (text: string, context: CategoryArrangementContext) => {
  const trimmed = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const record = item as {
      id?: unknown;
      gender?: unknown;
      confidence?: unknown;
      reason?: unknown;
      category?: unknown;
    };
    const gender = record.gender === "MEN" || record.gender === "WOMEN" ? record.gender : null;
    const confidence =
      typeof record.confidence === "number" && Number.isFinite(record.confidence)
        ? record.confidence
        : 0;
    if (
      typeof record.id !== "string" ||
      !gender ||
      confidence < CATEGORY_ARRANGEMENT_MIN_AI_CONFIDENCE
    ) {
      return [];
    }
    return [
      [
        record.id,
        {
          gender,
          confidence,
          reason: typeof record.reason === "string" ? record.reason : "ai",
          inferredCategory:
            typeof record.category === "string"
              ? resolveExistingArrangementCategory(record.category, context.availableCategories)
              : null,
        },
      ] as const,
    ];
  });
};

const resolveCategoryArrangementImageUrl = (value?: string | null) => {
  const normalized = normalizeProductImageUrl(value);
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("data:image/")) {
    return normalized.length <= CATEGORY_ARRANGEMENT_MAX_IMAGE_DATA_URL_LENGTH ? normalized : null;
  }
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? normalized : null;
  } catch {
    const baseUrl = process.env.NEXTAUTH_URL?.trim();
    if (!baseUrl || !normalized.startsWith("/uploads/")) {
      return null;
    }
    try {
      const resolved = new URL(normalized, baseUrl);
      return resolved.protocol === "https:" ? resolved.toString() : null;
    } catch {
      return null;
    }
  }
};

const imageUrlsForCategoryArrangement = (product: CategoryArrangementProduct) =>
  Array.from(
    new Set(
      [product.photoUrl, ...(product.images ?? []).map((image) => image.url)]
        .map(resolveCategoryArrangementImageUrl)
        .filter((value): value is string => Boolean(value)),
    ),
  ).slice(0, 1);

const buildCategoryArrangementEvidence = (
  products: CategoryArrangementProduct[],
  context: CategoryArrangementContext,
) =>
  products.map((product) => ({
    id: product.id,
    name: product.name,
    sku: product.sku ?? null,
    categories: normalizeProductCategoryNames([product.category, ...product.categories]),
    description: product.description?.slice(0, 360) ?? null,
    variants: (product.variants ?? []).slice(0, 12).map((variant) => ({
      name: variant.name,
      sku: variant.sku,
      attributes: stringifyArrangementValue(variant.attributes).slice(0, 24),
    })),
    suggestedCategory: inferProductCategoryLocally(product, context),
    imageCount: imageUrlsForCategoryArrangement(product).length,
  }));

const buildCategoryArrangementUserContent = (
  products: CategoryArrangementProduct[],
  context: CategoryArrangementContext,
) => {
  const content: Array<
    | {
        type: "input_text";
        text: string;
      }
    | {
        type: "input_image";
        image_url: string;
        detail: "low";
      }
  > = [
    {
      type: "input_text",
      text: JSON.stringify({
        allowedOrdinaryCategories: context.availableCategories,
        products: buildCategoryArrangementEvidence(products, context),
      }),
    },
    {
      type: "input_text",
      text: 'JSON shape: [{"id":"product id","gender":"MEN|WOMEN|SKIP","category":"ordinary category in Russian or null","confidence":0.0-1.0,"reason":"short reason"}].',
    },
  ];

  for (const product of products) {
    const imageUrl = imageUrlsForCategoryArrangement(product)[0];
    if (!imageUrl) {
      continue;
    }
    content.push({
      type: "input_text",
      text: `Image for product ${product.id}`,
    });
    content.push({
      type: "input_image",
      image_url: imageUrl,
      detail: "low",
    });
  }

  return content;
};

const callCategoryArrangementAi = async (
  products: CategoryArrangementProduct[],
  context: CategoryArrangementContext,
) => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || !products.length) {
    return new Map<string, CategoryArrangementDecision>();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CATEGORY_ARRANGEMENT_OPENAI_TIMEOUT_MS);
  let response: Response;
  try {
    const requestBody: Record<string, unknown> = {
      model: CATEGORY_ARRANGEMENT_MODEL,
      max_output_tokens: 4000,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "Classify retail apparel, footwear, and fashion accessories into MEN or WOMEN using all evidence: name, SKU, categories, description, variant names/SKUs/attributes, adult size ranges, and product images. Adult women's apparel sizes often include 34-46 and shoes 35-39; adult men's apparel often includes 48-64 and shoes 41-47. Decide from a clear image when text is weak. For the ordinary product category, choose only one exact value from allowedOrdinaryCategories. If no allowed category clearly fits, return category null. Return SKIP only for kids, clearly unisex items, non-fashion products, or genuinely ambiguous evidence. Never invent categories or extra hierarchy. Return only a JSON array.",
            },
          ],
        },
        {
          role: "user",
          content: buildCategoryArrangementUserContent(products, context),
        },
      ],
    };
    if (/^(?:gpt-5|o[1-9]|o\d|o-mini|o-preview)/i.test(CATEGORY_ARRANGEMENT_MODEL)) {
      requestBody.reasoning = { effort: "minimal" };
    }

    response = await fetch(CATEGORY_ARRANGEMENT_OPENAI_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
  } catch {
    return new Map<string, CategoryArrangementDecision>();
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    return new Map<string, CategoryArrangementDecision>();
  }
  const body = await response.json().catch(() => null);
  const text = extractOpenAiText(body);
  if (!text) {
    return new Map<string, CategoryArrangementDecision>();
  }

  try {
    return new Map(parseAiCategoryArrangementJson(text, context));
  } catch {
    return new Map<string, CategoryArrangementDecision>();
  }
};

const resolveNextArrangedCategories = (
  currentCategories: string[],
  gender: CategoryArrangementGender,
  inferredCategory?: string | null,
) => {
  const currentNonGenderCategories = currentCategories.filter(
    (category) => !isGenderCategoryName(category),
  );
  const fallbackCategory = normalizeProductCategoryName(inferredCategory);
  return normalizeProductCategoryNames([
    categoryNameForGender(gender),
    ...(currentNonGenderCategories.length
      ? currentNonGenderCategories
      : fallbackCategory
        ? [fallbackCategory]
        : []),
  ]);
};

const formatGeneratedSku = (sequence: number) =>
  `${GENERATED_SKU_PREFIX}${String(sequence).padStart(GENERATED_SKU_PAD_LENGTH, "0")}`;

const resolveCreateSku = async (
  tx: Prisma.TransactionClient,
  input: { organizationId: string; requestedSku?: string | null },
) => {
  const requested = input.requestedSku?.trim();
  if (requested) {
    return requested;
  }

  const existingCount = await tx.product.count({
    where: { organizationId: input.organizationId },
  });

  const nextSequence = Math.max(existingCount, 0) + 1;
  for (let probe = 0; probe < GENERATED_SKU_MAX_PROBES; probe += 1) {
    const candidate = formatGeneratedSku(nextSequence + probe);
    const existing = await tx.product.findUnique({
      where: {
        organizationId_sku: {
          organizationId: input.organizationId,
          sku: candidate,
        },
      },
      select: { id: true },
    });
    if (!existing) {
      return candidate;
    }
  }

  throw new AppError("unexpectedError", "INTERNAL_SERVER_ERROR", 500);
};

export const suggestNextProductSku = async (organizationId: string) =>
  prisma.$transaction((tx) =>
    resolveCreateSku(tx, {
      organizationId,
    }),
  );

const isOrganizationSkuUniqueConstraintError = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { code?: string; meta?: { target?: unknown } };
  if (candidate.code !== "P2002") {
    return false;
  }

  const target = candidate.meta?.target;
  if (Array.isArray(target)) {
    return target.includes("organizationId") && target.includes("sku");
  }
  if (typeof target === "string") {
    return target.includes("organizationId") && target.includes("sku");
  }
  return false;
};

const upsertBaseProductCost = async (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    productId: string;
    avgCostKgs: number;
  },
) => {
  const existing = await tx.productCost.findUnique({
    where: {
      organizationId_productId_variantKey: {
        organizationId: input.organizationId,
        productId: input.productId,
        variantKey: "BASE",
      },
    },
    select: { id: true, costBasisQty: true },
  });

  if (existing) {
    await tx.productCost.update({
      where: { id: existing.id },
      data: {
        avgCostKgs: input.avgCostKgs,
        costBasisQty: Math.max(existing.costBasisQty, 1),
      },
    });
    return;
  }

  await tx.productCost.create({
    data: {
      organizationId: input.organizationId,
      productId: input.productId,
      variantKey: "BASE",
      avgCostKgs: input.avgCostKgs,
      costBasisQty: 1,
    },
  });
};

const normalizeBarcodes = (barcodes?: string[]) => {
  if (!barcodes) {
    return [];
  }
  const cleaned = barcodes.map((value) => normalizeScanValue(value)).filter(Boolean);
  if (cleaned.some((value) => value.length < MIN_PRODUCT_BARCODE_LENGTH)) {
    throw new AppError("barcodeTooShort", "BAD_REQUEST", 400);
  }
  const unique = new Set(cleaned);
  if (unique.size !== cleaned.length) {
    throw new AppError("duplicateBarcode", "CONFLICT", 409);
  }
  return Array.from(unique);
};

const ensureBarcodesAvailable = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  barcodes: string[],
  excludeProductId?: string,
) => {
  if (!barcodes.length) {
    return;
  }
  const existing = await tx.productBarcode.findMany({
    where: {
      organizationId,
      value: { in: barcodes },
      ...(excludeProductId ? { productId: { not: excludeProductId } } : {}),
    },
    select: { value: true },
  });
  if (existing.length) {
    throw new AppError("barcodeExists", "CONFLICT", 409);
  }
};

const generateUniqueBarcodeValue = async (input: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  mode: BarcodeGenerationMode;
}) => {
  try {
    return await resolveUniqueGeneratedBarcode({
      organizationId: input.organizationId,
      mode: input.mode,
      isTaken: async (value) => {
        const existing = await input.tx.productBarcode.findUnique({
          where: {
            organizationId_value: {
              organizationId: input.organizationId,
              value,
            },
          },
          select: { id: true },
        });
        return Boolean(existing);
      },
    });
  } catch {
    throw new AppError("barcodeGenerationFailed", "INTERNAL_SERVER_ERROR", 500);
  }
};

const ensureSupplier = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  supplierId?: string,
) => {
  if (!supplierId) {
    return;
  }
  const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier || supplier.organizationId !== organizationId) {
    throw new AppError("supplierNotFound", "NOT_FOUND", 404);
  }
};

const ensureUnit = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  baseUnitId: string,
) => {
  const unit = await tx.unit.findUnique({ where: { id: baseUnitId } });
  if (!unit || unit.organizationId !== organizationId) {
    throw new AppError("unitNotFound", "NOT_FOUND", 404);
  }
  return unit;
};

const ensureUnitByCode = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  code: string,
) =>
  tx.unit.upsert({
    where: { organizationId_code: { organizationId, code } },
    update: { labelRu: code, labelKg: code },
    create: { organizationId, code, labelRu: code, labelKg: code },
  });

const normalizeImportPhotoUrl = normalizeProductImageUrl;

const resolveRemoteImportPhotoUrl = async (
  value: string,
  organizationId: string | undefined,
  cache: Map<string, ResolveProductImageUrlResult>,
) => {
  if (!organizationId) {
    return value;
  }

  const resolved = await resolveProductImageUrl({
    value,
    organizationId,
    cache,
    fallbackToSource: false,
  });

  if (!resolved.url || !resolved.managed) {
    return value;
  }

  return resolved.url;
};

const normalizePacks = (packs?: CreateProductInput["packs"]) => {
  if (!packs) {
    return [];
  }
  const cleaned = packs
    .map((pack) => ({
      id: pack.id,
      packName: pack.packName.trim(),
      packBarcode: pack.packBarcode?.trim() || null,
      multiplierToBase: Math.trunc(pack.multiplierToBase),
      allowInPurchasing: pack.allowInPurchasing ?? true,
      allowInReceiving: pack.allowInReceiving ?? true,
    }))
    .filter((pack) => pack.packName.length > 0);

  const names = cleaned.map((pack) => pack.packName);
  if (new Set(names).size !== names.length) {
    throw new AppError("packNameDuplicate", "CONFLICT", 409);
  }

  const barcodes = cleaned.map((pack) => pack.packBarcode).filter(Boolean) as string[];
  if (new Set(barcodes).size !== barcodes.length) {
    throw new AppError("packBarcodeDuplicate", "CONFLICT", 409);
  }

  cleaned.forEach((pack) => {
    if (!Number.isFinite(pack.multiplierToBase) || pack.multiplierToBase <= 0) {
      throw new AppError("packMultiplierInvalid", "BAD_REQUEST", 400);
    }
  });

  return cleaned;
};

const normalizeBundleComponents = (components?: CreateProductInput["bundleComponents"]) => {
  if (!components) {
    return [];
  }
  const normalized = components
    .map((component) => ({
      componentProductId: component.componentProductId.trim(),
      componentVariantId: component.componentVariantId?.trim() || null,
      qty: Math.trunc(component.qty),
    }))
    .filter((component) => component.componentProductId.length > 0);

  const keys = normalized.map(
    (component) => `${component.componentProductId}:${component.componentVariantId ?? "BASE"}`,
  );
  if (new Set(keys).size !== keys.length) {
    throw new AppError("bundleComponentDuplicate", "CONFLICT", 409);
  }
  for (const component of normalized) {
    if (!Number.isFinite(component.qty) || component.qty <= 0) {
      throw new AppError("bundleQtyPositive", "BAD_REQUEST", 400);
    }
  }
  return normalized;
};

const syncBundleComponents = async (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    productId: string;
    components?: CreateProductInput["bundleComponents"];
    mode: "replace" | "create-only";
  },
) => {
  const normalized = normalizeBundleComponents(input.components);
  if (!normalized.length) {
    if (input.mode === "replace") {
      await tx.productBundleComponent.deleteMany({ where: { bundleProductId: input.productId } });
    }
    return;
  }

  const componentProductIds = Array.from(
    new Set(normalized.map((component) => component.componentProductId)),
  );
  const products = await tx.product.findMany({
    where: {
      id: { in: componentProductIds },
      organizationId: input.organizationId,
      isDeleted: false,
    },
    select: { id: true },
  });
  const validIds = new Set(products.map((product) => product.id));
  for (const component of normalized) {
    if (!validIds.has(component.componentProductId)) {
      throw new AppError("productNotFound", "NOT_FOUND", 404);
    }
    if (component.componentProductId === input.productId) {
      throw new AppError("bundleComponentInvalid", "BAD_REQUEST", 400);
    }
  }

  const componentVariantIds = normalized
    .map((component) => component.componentVariantId)
    .filter((value): value is string => Boolean(value));
  if (componentVariantIds.length) {
    const variants = await tx.productVariant.findMany({
      where: { id: { in: componentVariantIds }, isActive: true },
      select: { id: true, productId: true },
    });
    const variantMap = new Map(variants.map((variant) => [variant.id, variant]));
    for (const component of normalized) {
      if (!component.componentVariantId) {
        continue;
      }
      const variant = variantMap.get(component.componentVariantId);
      if (!variant || variant.productId !== component.componentProductId) {
        throw new AppError("variantNotFound", "NOT_FOUND", 404);
      }
    }
  }

  if (input.mode === "replace") {
    await tx.productBundleComponent.deleteMany({ where: { bundleProductId: input.productId } });
  }

  await tx.productBundleComponent.createMany({
    data: normalized.map((component) => ({
      organizationId: input.organizationId,
      bundleProductId: input.productId,
      componentProductId: component.componentProductId,
      componentVariantId: component.componentVariantId,
      qty: component.qty,
    })),
  });
};

type NormalizedImage = {
  id?: string;
  url: string;
  position: number;
};

const normalizeImages = (images?: CreateProductInput["images"]): NormalizedImage[] => {
  if (!images) {
    return [];
  }
  const cleaned = images
    .map((image, index) => ({
      id: image.id,
      url: image.url.trim(),
      position:
        typeof image.position === "number" && Number.isFinite(image.position)
          ? Math.trunc(image.position)
          : index,
    }))
    .filter((image) => image.url.length > 0)
    .sort((a, b) => a.position - b.position)
    .map((image, index) => ({ ...image, position: index }));
  return cleaned;
};

const ensurePackBarcodesAvailable = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  packBarcodes: string[],
  excludeProductId?: string,
) => {
  if (!packBarcodes.length) {
    return;
  }
  const [existingPacks, existingBarcodes] = await Promise.all([
    tx.productPack.findMany({
      where: {
        organizationId,
        packBarcode: { in: packBarcodes },
        ...(excludeProductId ? { productId: { not: excludeProductId } } : {}),
      },
      select: { packBarcode: true },
    }),
    tx.productBarcode.findMany({
      where: {
        organizationId,
        value: { in: packBarcodes },
        ...(excludeProductId ? { productId: { not: excludeProductId } } : {}),
      },
      select: { value: true },
    }),
  ]);
  if (existingPacks.length || existingBarcodes.length) {
    throw new AppError("packBarcodeExists", "CONFLICT", 409);
  }
};

const syncProductPacks = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  productId: string,
  packs?: CreateProductInput["packs"],
) => {
  if (!packs) {
    return;
  }
  const normalized = normalizePacks(packs);
  const packBarcodes = normalized.map((pack) => pack.packBarcode).filter(Boolean) as string[];
  await ensurePackBarcodesAvailable(tx, organizationId, packBarcodes, productId);

  await tx.productPack.deleteMany({ where: { productId } });
  if (!normalized.length) {
    return;
  }
  await tx.productPack.createMany({
    data: normalized.map((pack) => ({
      organizationId,
      productId,
      packName: pack.packName,
      packBarcode: pack.packBarcode,
      multiplierToBase: pack.multiplierToBase,
      allowInPurchasing: pack.allowInPurchasing ?? true,
      allowInReceiving: pack.allowInReceiving ?? true,
    })),
  });
};

type AttributeDefinitionRow = {
  key: string;
  type: AttributeType;
  required: boolean;
  optionsRu: Prisma.JsonValue | null;
  optionsKg: Prisma.JsonValue | null;
};

const loadAttributeDefinitions = async (tx: Prisma.TransactionClient, organizationId: string) =>
  tx.attributeDefinition.findMany({
    where: { organizationId, isActive: true },
    select: { key: true, type: true, required: true, optionsRu: true, optionsKg: true },
  });

const hasAttributeValue = (value: unknown, type: AttributeType) => {
  if (value === null || value === undefined) {
    return false;
  }
  if (type === "MULTI_SELECT") {
    return Array.isArray(value) && value.length > 0;
  }
  if (type === "NUMBER") {
    return Number.isFinite(typeof value === "number" ? value : Number(value));
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return true;
};

const ensureRequiredAttributes = (
  variants: CreateProductInput["variants"],
  definitions: AttributeDefinitionRow[],
) => {
  if (!variants?.length) {
    return;
  }
  const required = definitions.filter((definition) => definition.required);
  if (!required.length) {
    return;
  }
  for (const variant of variants) {
    const attributes = variant.attributes ?? {};
    for (const definition of required) {
      if (!hasAttributeValue(attributes[definition.key], definition.type)) {
        throw new AppError("attributeRequired", "BAD_REQUEST", 400);
      }
    }
  }
};

const syncVariantAttributeValues = async (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    productId: string;
    variantId: string;
    attributes?: Record<string, unknown>;
  },
  definitionMap: Map<string, AttributeDefinitionRow>,
) => {
  const entries = Object.entries(input.attributes ?? {}).filter(([key, value]) => {
    if (!definitionMap.has(key)) {
      return false;
    }
    if (value === null || value === undefined) {
      return false;
    }
    if (typeof value === "string") {
      return value.trim().length > 0;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return true;
  });

  if (!entries.length) {
    return;
  }

  await tx.variantAttributeValue.createMany({
    data: entries.map(([key, value]) => ({
      organizationId: input.organizationId,
      productId: input.productId,
      variantId: input.variantId,
      key,
      value: toJson(value),
    })),
    skipDuplicates: true,
  });
};

const createVariants = async (
  tx: Prisma.TransactionClient,
  productId: string,
  variants: CreateProductInput["variants"],
  organizationId: string,
  definitions: AttributeDefinitionRow[],
) => {
  if (!variants?.length) {
    return [];
  }
  const definitionMap = new Map<string, AttributeDefinitionRow>(
    definitions.map((definition: AttributeDefinitionRow) => [definition.key, definition]),
  );
  return Promise.all(
    variants.map(async (variant) => {
      const created = await tx.productVariant.create({
        data: {
          productId,
          name: variant.name ?? null,
          sku: variant.sku ?? null,
          attributes: toJson(variant.attributes ?? {}),
        },
      });

      await syncVariantAttributeValues(
        tx,
        {
          organizationId,
          productId,
          variantId: created.id,
          attributes: variant.attributes ?? {},
        },
        definitionMap,
      );

      return created;
    }),
  );
};

const ensureBaseSnapshots = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  productId: string,
  stores?: { id: string; allowNegativeStock: boolean }[],
) => {
  const resolvedStores =
    stores ??
    (await tx.store.findMany({
      where: { organizationId },
      select: { id: true, allowNegativeStock: true },
    }));

  if (!resolvedStores.length) {
    return;
  }

  await tx.inventorySnapshot.createMany({
    data: resolvedStores.map((store) => ({
      storeId: store.id,
      productId,
      variantKey: "BASE",
      onHand: 0,
      onOrder: 0,
      allowNegativeStock: store.allowNegativeStock,
    })),
    skipDuplicates: true,
  });
};

const resolveProductCreateStores = async (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    storeId?: string | null;
  },
) => {
  if (input.storeId) {
    const store = await tx.store.findFirst({
      where: { id: input.storeId, organizationId: input.organizationId },
      select: { id: true, allowNegativeStock: true },
    });
    if (!store) {
      throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
    }
    return [store];
  }

  const stores = await tx.store.findMany({
    where: { organizationId: input.organizationId },
    select: { id: true, allowNegativeStock: true },
    orderBy: { createdAt: "asc" },
    take: 2,
  });
  return stores.length === 1 ? stores : [];
};

const syncProductImages = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  productId: string,
  normalizedImages: NormalizedImage[],
) => {
  await tx.productImage.deleteMany({ where: { productId } });
  if (!normalizedImages.length) {
    return;
  }
  await tx.productImage.createMany({
    data: normalizedImages.map((image) => ({
      organizationId,
      productId,
      url: image.url,
      position: image.position,
    })),
  });
};

const resolveIncomingProductImages = async (input: {
  organizationId: string;
  productId?: string | null;
  photoUrl?: string | null;
  images?: CreateProductInput["images"];
}) => {
  const cache = new Map<string, ResolveProductImageUrlResult>();
  const normalizedImages = normalizeImages(input.images);
  const resolvedImages: NormalizedImage[] = [];

  for (const image of normalizedImages) {
    const resolved = await resolveProductImageUrl({
      value: image.url,
      organizationId: input.organizationId,
      productId: input.productId,
      cache,
    });
    if (!resolved.url) {
      continue;
    }
    resolvedImages.push({ ...image, url: resolved.url });
  }

  const explicitPhotoResolved =
    input.photoUrl !== undefined
      ? await resolveProductImageUrl({
          value: input.photoUrl,
          organizationId: input.organizationId,
          productId: input.productId,
          cache,
        })
      : undefined;

  const resolvedPhotoUrl =
    explicitPhotoResolved?.url ?? (resolvedImages.length ? resolvedImages[0].url : null);

  if (!resolvedImages.length && resolvedPhotoUrl) {
    resolvedImages.push({ id: undefined, url: resolvedPhotoUrl, position: 0 });
  }

  return {
    images: resolvedImages,
    photoUrl: resolvedPhotoUrl,
  };
};

export const createProduct = async (input: CreateProductInput) => {
  const productId = randomUUID();
  const resolvedMedia = await resolveIncomingProductImages({
    organizationId: input.organizationId,
    productId,
    photoUrl: input.photoUrl,
    images: input.images,
  });
  const normalizedBundleComponents = normalizeBundleComponents(input.bundleComponents);
  const resolvedBaseCost =
    input.avgCostKgs !== undefined && input.avgCostKgs !== null
      ? input.avgCostKgs
      : input.purchasePriceKgs !== undefined && input.purchasePriceKgs !== null
        ? input.purchasePriceKgs
        : undefined;

  const requestedSku = input.sku?.trim();
  const shouldGenerateSku = !requestedSku;

  const runCreateTransaction = () =>
    prisma.$transaction(async (tx) => {
      await assertWithinLimits({ organizationId: input.organizationId, kind: "products" });
      await ensureSupplier(tx, input.organizationId, input.supplierId);
      const baseUnit = await ensureUnit(tx, input.organizationId, input.baseUnitId);
      const attributeDefinitions = await loadAttributeDefinitions(tx, input.organizationId);
      ensureRequiredAttributes(input.variants, attributeDefinitions);
      const barcodes = normalizeBarcodes(input.barcodes);
      await ensureBarcodesAvailable(tx, input.organizationId, barcodes);
      const normalizedPacks = normalizePacks(input.packs);
      const packBarcodes = normalizedPacks
        .map((pack) => pack.packBarcode)
        .filter(Boolean) as string[];
      await ensurePackBarcodesAvailable(tx, input.organizationId, packBarcodes);
      const normalizedImages = resolvedMedia.images;
      const normalizedCategories = resolveNormalizedProductCategories({
        category: input.category,
        categories: input.categories,
      });
      for (const category of normalizedCategories) {
        await ensureProductCategory(tx, {
          organizationId: input.organizationId,
          name: category,
        });
      }
      if (input.isBundle && normalizedBundleComponents.length < 1) {
        throw new AppError("bundleEmpty", "BAD_REQUEST", 400);
      }

      const resolvedSku = await resolveCreateSku(tx, {
        organizationId: input.organizationId,
        requestedSku,
      });

      const product = await tx.product.create({
        data: {
          id: productId,
          organizationId: input.organizationId,
          sku: resolvedSku,
          name: input.name,
          category: resolvePrimaryProductCategory(normalizedCategories),
          categories: normalizedCategories,
          unit: baseUnit.code,
          baseUnitId: baseUnit.id,
          basePriceKgs: input.basePriceKgs ?? null,
          description: input.description ?? null,
          photoUrl: resolvedMedia.photoUrl,
          supplierId: input.supplierId,
          isBundle: Boolean(input.isBundle),
          barcodes: barcodes.length
            ? {
                create: barcodes.map((value) => ({
                  organizationId: input.organizationId,
                  value,
                })),
              }
            : undefined,
        },
      });

      if (normalizedPacks.length) {
        await tx.productPack.createMany({
          data: normalizedPacks.map((pack) => ({
            organizationId: input.organizationId,
            productId: product.id,
            packName: pack.packName,
            packBarcode: pack.packBarcode,
            multiplierToBase: pack.multiplierToBase,
            allowInPurchasing: pack.allowInPurchasing ?? true,
            allowInReceiving: pack.allowInReceiving ?? true,
          })),
        });
      }

      if (normalizedImages.length) {
        await tx.productImage.createMany({
          data: normalizedImages.map((image) => ({
            organizationId: input.organizationId,
            productId: product.id,
            url: image.url,
            position: image.position,
          })),
        });
      }

      await createVariants(
        tx,
        product.id,
        input.variants,
        input.organizationId,
        attributeDefinitions,
      );
      if (normalizedBundleComponents.length) {
        await syncBundleComponents(tx, {
          organizationId: input.organizationId,
          productId: product.id,
          components: normalizedBundleComponents,
          mode: "create-only",
        });
      }
      const assignmentStores = await resolveProductCreateStores(tx, {
        organizationId: input.organizationId,
        storeId: input.storeId,
      });
      for (const store of assignmentStores) {
        await assignProductToStore(tx, {
          organizationId: input.organizationId,
          storeId: store.id,
          productId: product.id,
          actorId: input.actorId,
        });
      }
      await ensureBaseSnapshots(tx, input.organizationId, product.id, assignmentStores);
      if (resolvedBaseCost !== undefined) {
        await upsertBaseProductCost(tx, {
          organizationId: input.organizationId,
          productId: product.id,
          avgCostKgs: resolvedBaseCost,
        });
      }

      await writeAuditLog(tx, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: "PRODUCT_CREATE",
        entity: "Product",
        entityId: product.id,
        before: null,
        after: toJson(product),
        requestId: input.requestId,
      });

      await recordFirstEvent({
        organizationId: input.organizationId,
        actorId: input.actorId,
        type: "first_product_created",
        metadata: { productId: product.id },
      });

      return product;
    });

  if (!shouldGenerateSku) {
    return runCreateTransaction();
  }

  for (let attempt = 0; attempt < GENERATED_SKU_MAX_RETRIES; attempt += 1) {
    try {
      return await runCreateTransaction();
    } catch (error) {
      if (
        !isOrganizationSkuUniqueConstraintError(error) ||
        attempt === GENERATED_SKU_MAX_RETRIES - 1
      ) {
        throw error;
      }
    }
  }

  throw new AppError("unexpectedError", "INTERNAL_SERVER_ERROR", 500);
};

export type UpdateProductInput = {
  productId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
  sku: string;
  name: string;
  category?: string | null;
  categories?: string[] | null;
  baseUnitId: string;
  basePriceKgs?: number | null;
  purchasePriceKgs?: number | null;
  avgCostKgs?: number | null;
  description?: string | null;
  photoUrl?: string | null;
  images?: CreateProductInput["images"];
  supplierId?: string | null;
  barcodes?: string[];
  packs?: CreateProductInput["packs"];
  variants?: {
    id?: string;
    name?: string | null;
    sku?: string | null;
    attributes?: Record<string, unknown>;
  }[];
  isBundle?: boolean;
  bundleComponents?: CreateProductInput["bundleComponents"];
};

export const updateProduct = async (input: UpdateProductInput) => {
  const resolvedMedia = await resolveIncomingProductImages({
    organizationId: input.organizationId,
    productId: input.productId,
    photoUrl: input.photoUrl,
    images: input.images,
  });
  const normalizedBundleComponents =
    input.bundleComponents !== undefined
      ? normalizeBundleComponents(input.bundleComponents)
      : undefined;
  const resolvedBaseCost =
    input.avgCostKgs !== undefined && input.avgCostKgs !== null
      ? input.avgCostKgs
      : input.purchasePriceKgs !== undefined && input.purchasePriceKgs !== null
        ? input.purchasePriceKgs
        : undefined;

  return prisma.$transaction(async (tx) => {
    const before = await tx.product.findUnique({ where: { id: input.productId } });
    if (!before || before.organizationId !== input.organizationId) {
      throw new AppError("productNotFound", "NOT_FOUND", 404);
    }

    await ensureSupplier(tx, input.organizationId, input.supplierId ?? undefined);
    const baseUnit = await ensureUnit(tx, input.organizationId, input.baseUnitId);
    const attributeDefinitions = await loadAttributeDefinitions(tx, input.organizationId);
    ensureRequiredAttributes(input.variants, attributeDefinitions);
    const barcodes = normalizeBarcodes(input.barcodes);
    await ensureBarcodesAvailable(tx, input.organizationId, barcodes, input.productId);
    if (before.baseUnitId !== baseUnit.id) {
      const movementCount = await tx.stockMovement.count({
        where: { productId: input.productId },
      });
      if (movementCount > 0) {
        throw new AppError("unitChangeNotAllowed", "CONFLICT", 409);
      }
    }

    const normalizedImages = input.images ? resolvedMedia.images : undefined;
    const normalizedCategories = resolveNormalizedProductCategories({
      category: input.category,
      categories: input.categories,
    });
    for (const category of normalizedCategories) {
      await ensureProductCategory(tx, {
        organizationId: input.organizationId,
        name: category,
      });
    }
    const nextIsBundle = input.isBundle ?? before.isBundle;
    if (
      nextIsBundle &&
      !before.isBundle &&
      normalizedBundleComponents !== undefined &&
      normalizedBundleComponents.length < 1
    ) {
      throw new AppError("bundleEmpty", "BAD_REQUEST", 400);
    }
    const product = await tx.product.update({
      where: { id: input.productId },
      data: {
        sku: input.sku,
        name: input.name,
        category: resolvePrimaryProductCategory(normalizedCategories),
        categories: normalizedCategories,
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
        basePriceKgs: input.basePriceKgs ?? null,
        description: input.description ?? null,
        photoUrl:
          resolvedMedia.photoUrl ?? (normalizedImages?.length ? normalizedImages[0].url : null),
        supplierId: input.supplierId ?? null,
        isBundle: nextIsBundle,
      },
    });

    await tx.productBarcode.deleteMany({ where: { productId: input.productId } });
    if (barcodes.length) {
      await tx.productBarcode.createMany({
        data: barcodes.map((value) => ({
          organizationId: input.organizationId,
          productId: input.productId,
          value,
        })),
      });
    }

    await syncProductPacks(tx, input.organizationId, input.productId, input.packs);
    if (normalizedImages) {
      await syncProductImages(tx, input.organizationId, input.productId, normalizedImages);
    }

    if (input.variants) {
      const incomingIds = new Set(
        input.variants.map((variant) => variant.id).filter(Boolean) as string[],
      );
      const existingVariants = await tx.productVariant.findMany({
        where: { productId: input.productId, isActive: true },
        select: { id: true },
      });
      const removedIds = existingVariants
        .map((variant) => variant.id)
        .filter((id) => !incomingIds.has(id));

      if (removedIds.length) {
        const [movementCount, snapshotCount, lineCount] = await Promise.all([
          tx.stockMovement.count({ where: { variantId: { in: removedIds } } }),
          tx.inventorySnapshot.count({
            where: {
              variantId: { in: removedIds },
              OR: [{ onHand: { not: 0 } }, { onOrder: { not: 0 } }],
            },
          }),
          tx.purchaseOrderLine.count({ where: { variantId: { in: removedIds } } }),
        ]);

        if (movementCount > 0 || snapshotCount > 0 || lineCount > 0) {
          throw new AppError("variantInUse", "CONFLICT", 409);
        }

        await tx.productVariant.updateMany({
          where: { id: { in: removedIds } },
          data: { isActive: false },
        });
        await tx.variantAttributeValue.deleteMany({
          where: { variantId: { in: removedIds } },
        });
      }

      const definitionMap = new Map<string, AttributeDefinitionRow>(
        attributeDefinitions.map((definition: AttributeDefinitionRow) => [
          definition.key,
          definition,
        ]),
      );
      for (const variant of input.variants) {
        if (variant.id) {
          await tx.productVariant.updateMany({
            where: { id: variant.id, productId: input.productId },
            data: {
              name: variant.name ?? null,
              sku: variant.sku ?? null,
              attributes: toJson(variant.attributes ?? {}),
              isActive: true,
            },
          });
          await tx.variantAttributeValue.deleteMany({
            where: { variantId: variant.id },
          });
          await syncVariantAttributeValues(
            tx,
            {
              organizationId: input.organizationId,
              productId: input.productId,
              variantId: variant.id,
              attributes: variant.attributes ?? {},
            },
            definitionMap,
          );
        } else {
          const createdVariant = await tx.productVariant.create({
            data: {
              productId: input.productId,
              name: variant.name ?? null,
              sku: variant.sku ?? null,
              attributes: toJson(variant.attributes ?? {}),
            },
          });
          await syncVariantAttributeValues(
            tx,
            {
              organizationId: input.organizationId,
              productId: input.productId,
              variantId: createdVariant.id,
              attributes: variant.attributes ?? {},
            },
            definitionMap,
          );
        }
      }
    }

    if (!nextIsBundle) {
      await tx.productBundleComponent.deleteMany({ where: { bundleProductId: input.productId } });
    } else if (normalizedBundleComponents !== undefined) {
      if (normalizedBundleComponents.length < 1) {
        throw new AppError("bundleEmpty", "BAD_REQUEST", 400);
      }
      await syncBundleComponents(tx, {
        organizationId: input.organizationId,
        productId: input.productId,
        components: normalizedBundleComponents,
        mode: "replace",
      });
    }

    if (resolvedBaseCost !== undefined) {
      await upsertBaseProductCost(tx, {
        organizationId: input.organizationId,
        productId: input.productId,
        avgCostKgs: resolvedBaseCost,
      });
    }

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "PRODUCT_UPDATE",
      entity: "Product",
      entityId: product.id,
      before: toJson(before),
      after: toJson(product),
      requestId: input.requestId,
    });

    return product;
  });
};

const resolveDuplicateSku = async (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    sourceSku: string;
    requestedSku?: string | null;
  },
) => {
  const requested = input.requestedSku?.trim();
  if (requested) {
    const exists = await tx.product.findFirst({
      where: {
        organizationId: input.organizationId,
        sku: requested,
      },
      select: { id: true },
    });
    if (exists) {
      throw new AppError("uniqueConstraintViolation", "CONFLICT", 409);
    }
    return requested;
  }

  const base = `${input.sourceSku}-COPY`;
  let suffix = 1;
  for (;;) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    const exists = await tx.product.findFirst({
      where: {
        organizationId: input.organizationId,
        sku: candidate,
      },
      select: { id: true },
    });
    if (!exists) {
      return candidate;
    }
    suffix += 1;
    if (suffix > 5000) {
      throw new AppError("unexpectedError", "INTERNAL_SERVER_ERROR", 500);
    }
  }
};

export const duplicateProduct = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  productId: string;
  sku?: string | null;
}) => {
  return prisma.$transaction(async (tx) => {
    await assertWithinLimits({ organizationId: input.organizationId, kind: "products" });

    const source = await tx.product.findUnique({
      where: { id: input.productId },
      include: {
        packs: true,
        images: true,
        variants: {
          where: { isActive: true },
          select: {
            name: true,
            sku: true,
            attributes: true,
          },
        },
        bundleComponents: {
          select: {
            componentProductId: true,
            componentVariantId: true,
            qty: true,
          },
        },
      },
    });

    if (!source || source.organizationId !== input.organizationId) {
      throw new AppError("productNotFound", "NOT_FOUND", 404);
    }

    const nextSku = await resolveDuplicateSku(tx, {
      organizationId: input.organizationId,
      sourceSku: source.sku,
      requestedSku: input.sku,
    });

    const duplicate = await tx.product.create({
      data: {
        organizationId: input.organizationId,
        supplierId: source.supplierId,
        sku: nextSku,
        name: source.name,
        category: source.category,
        categories: source.categories.length
          ? source.categories
          : source.category
            ? [source.category]
            : [],
        unit: source.unit,
        baseUnitId: source.baseUnitId,
        basePriceKgs: source.basePriceKgs,
        description: source.description,
        photoUrl: source.photoUrl,
        isBundle: source.isBundle,
      },
    });

    if (source.images.length) {
      await tx.productImage.createMany({
        data: source.images.map((image) => ({
          organizationId: input.organizationId,
          productId: duplicate.id,
          url: image.url,
          position: image.position,
        })),
      });
    }

    if (source.packs.length) {
      await tx.productPack.createMany({
        data: source.packs.map((pack) => ({
          organizationId: input.organizationId,
          productId: duplicate.id,
          packName: pack.packName,
          packBarcode: null,
          multiplierToBase: pack.multiplierToBase,
          allowInPurchasing: pack.allowInPurchasing,
          allowInReceiving: pack.allowInReceiving,
        })),
      });
    }

    const attributeDefinitions = await loadAttributeDefinitions(tx, input.organizationId);
    if (source.variants.length) {
      await createVariants(
        tx,
        duplicate.id,
        source.variants.map((variant) => ({
          name: variant.name,
          sku: variant.sku,
          attributes:
            variant.attributes && typeof variant.attributes === "object"
              ? (variant.attributes as Record<string, unknown>)
              : {},
        })),
        input.organizationId,
        attributeDefinitions,
      );
    }

    if (source.isBundle && source.bundleComponents.length) {
      await syncBundleComponents(tx, {
        organizationId: input.organizationId,
        productId: duplicate.id,
        components: source.bundleComponents.map((component) => ({
          componentProductId: component.componentProductId,
          componentVariantId: component.componentVariantId,
          qty: component.qty,
        })),
        mode: "create-only",
      });
    }

    await ensureBaseSnapshots(tx, input.organizationId, duplicate.id);

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "PRODUCT_CREATE",
      entity: "Product",
      entityId: duplicate.id,
      before: toJson({ sourceProductId: source.id }),
      after: toJson(duplicate),
      requestId: input.requestId,
    });

    return {
      productId: duplicate.id,
      sku: duplicate.sku,
      copiedBarcodes: false,
    };
  });
};

export const generateProductBarcode = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  productId: string;
  mode: BarcodeGenerationMode;
  force?: boolean;
}) =>
  prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: input.productId },
      select: {
        id: true,
        organizationId: true,
        isDeleted: true,
        barcodes: {
          orderBy: { createdAt: "asc" },
          select: { value: true },
        },
      },
    });
    if (!product || product.organizationId !== input.organizationId || product.isDeleted) {
      throw new AppError("productNotFound", "NOT_FOUND", 404);
    }

    const beforeValues = product.barcodes.map((barcode) => barcode.value);
    if (beforeValues.length > 0 && !input.force) {
      throw new AppError("productBarcodeExists", "CONFLICT", 409);
    }
    if (beforeValues.length > 0 && input.force) {
      await tx.productBarcode.deleteMany({
        where: {
          organizationId: input.organizationId,
          productId: input.productId,
        },
      });
    }

    const value = await generateUniqueBarcodeValue({
      tx,
      organizationId: input.organizationId,
      mode: input.mode,
    });
    await tx.productBarcode.create({
      data: {
        organizationId: input.organizationId,
        productId: input.productId,
        value,
      },
    });

    const barcodes = [value];
    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "PRODUCT_UPDATE",
      entity: "Product",
      entityId: product.id,
      before: toJson({ barcodes: beforeValues }),
      after: toJson({ barcodes, generated: true, mode: input.mode }),
      requestId: input.requestId,
    });

    return {
      productId: product.id,
      value,
      mode: input.mode,
      barcodes,
    };
  });

type ProductBulkGenerationFilter = {
  productIds?: string[];
  search?: string;
  category?: string | null;
  type?: "all" | "product" | "bundle";
  includeArchived?: boolean;
  storeId?: string | null;
  limit?: number;
};

type ProductBulkDescriptionLogger = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

const MAX_BULK_DESCRIPTION_PRODUCTS = 25;

export const bulkGenerateProductBarcodes = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  mode: BarcodeGenerationMode;
  filter?: ProductBulkGenerationFilter;
}) =>
  prisma.$transaction(async (tx) => {
    const productIds = input.filter?.productIds?.map((value) => value.trim()).filter(Boolean) ?? [];
    const uniqueProductIds = Array.from(new Set(productIds));
    const search = input.filter?.search?.trim();
    const category = input.filter?.category?.trim();
    const limit = Math.min(Math.max(input.filter?.limit ?? 500, 1), 5_000);

    if (input.filter?.storeId) {
      const store = await tx.store.findUnique({
        where: { id: input.filter.storeId },
        select: { id: true, organizationId: true },
      });
      if (!store || store.organizationId !== input.organizationId) {
        throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
      }
    }

    const filters: Prisma.ProductWhereInput[] = [];
    if (search) {
      filters.push({
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { sku: { contains: search, mode: "insensitive" } },
        ],
      });
    }
    if (category) {
      filters.push({ OR: [{ category }, { categories: { has: category } }] });
    }
    if (input.filter?.type === "product") {
      filters.push({ isBundle: false });
    } else if (input.filter?.type === "bundle") {
      filters.push({ isBundle: true });
    }
	    if (input.filter?.storeId) {
	      filters.push({
	        storeProducts: { some: { storeId: input.filter.storeId, isActive: true } },
	      });
	    }

    const where: Prisma.ProductWhereInput = {
      organizationId: input.organizationId,
      ...(input.filter?.includeArchived ? {} : { isDeleted: false }),
      ...(uniqueProductIds.length ? { id: { in: uniqueProductIds } } : {}),
      ...(filters.length ? { AND: filters } : {}),
    };

    const products = await tx.product.findMany({
      where,
      select: {
        id: true,
        barcodes: {
          orderBy: { createdAt: "asc" },
          select: { value: true },
        },
      },
      orderBy: { name: "asc" },
      take: limit,
    });

    let generatedCount = 0;
    let skippedCount = 0;
    const updatedProductIds: string[] = [];

    for (const product of products) {
      if (product.barcodes.length > 0) {
        skippedCount += 1;
        continue;
      }

      const value = await generateUniqueBarcodeValue({
        tx,
        organizationId: input.organizationId,
        mode: input.mode,
      });
      await tx.productBarcode.create({
        data: {
          organizationId: input.organizationId,
          productId: product.id,
          value,
        },
      });
      await writeAuditLog(tx, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: "PRODUCT_UPDATE",
        entity: "Product",
        entityId: product.id,
        before: toJson({ barcodes: [] }),
        after: toJson({ barcodes: [value], generated: true, mode: input.mode }),
        requestId: input.requestId,
      });
      generatedCount += 1;
      updatedProductIds.push(product.id);
    }

    return {
      scannedCount: products.length,
      generatedCount,
      skippedCount,
      updatedProductIds,
    };
  });

export const bulkGenerateProductDescriptions = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  productIds: string[];
  locale?: string | null;
  logger?: ProductBulkDescriptionLogger;
  maxProducts?: number;
}) => {
  const uniqueProductIds = Array.from(
    new Set(input.productIds.map((value) => value.trim()).filter(Boolean)),
  );
  if (!uniqueProductIds.length) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  const maxProducts = Math.max(1, Math.trunc(input.maxProducts ?? MAX_BULK_DESCRIPTION_PRODUCTS));
  if (uniqueProductIds.length > maxProducts) {
    throw new AppError("bulkGenerateDescriptionsLimitExceeded", "BAD_REQUEST", 400);
  }

  const products = await prisma.product.findMany({
    where: {
      organizationId: input.organizationId,
      id: { in: uniqueProductIds },
      isDeleted: false,
    },
    select: {
      id: true,
      name: true,
      category: true,
      isBundle: true,
      description: true,
      photoUrl: true,
      images: {
        where: {
          url: {
            not: { startsWith: "data:image/" },
          },
        },
        select: { url: true },
        orderBy: { position: "asc" },
        take: 3,
      },
    },
  });

  const productById = new Map(products.map((product) => [product.id, product]));
  let updatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let rateLimited = false;
  const updatedProductIds: string[] = [];

  for (const productId of uniqueProductIds) {
    const product = productById.get(productId);
    if (!product) {
      skippedCount += 1;
      continue;
    }

    const imageUrls = Array.from(
      new Set(
        [product.photoUrl, ...product.images.map((image) => image.url)]
          .map((value) => normalizeProductImageUrl(value ?? null))
          .filter((value): value is string => Boolean(value)),
      ),
    ).slice(0, 3);

    if (!imageUrls.length) {
      skippedCount += 1;
      continue;
    }

    try {
      const result = await generateProductDescriptionFromImages({
        name: product.name,
        category: product.category,
        isBundle: product.isBundle,
        locale: input.locale,
        imageUrls,
        logger: input.logger,
      });

      const nextDescription = result.description.trim();
      const previousDescription = product.description?.trim() ?? "";
      if (!nextDescription || nextDescription === previousDescription) {
        skippedCount += 1;
        continue;
      }

      await prisma.product.update({
        where: { id: product.id },
        data: { description: nextDescription },
      });
      await writeAuditLog(prisma, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: "PRODUCT_UPDATE",
        entity: "Product",
        entityId: product.id,
        before: toJson({ description: previousDescription || null }),
        after: toJson({ description: nextDescription, generated: true }),
        requestId: input.requestId,
      });

      updatedCount += 1;
      updatedProductIds.push(product.id);
    } catch (error) {
      if (error instanceof Error && error.message === "rateLimited") {
        rateLimited = true;
        break;
      }
      if (
        error instanceof Error &&
        (error.message === "aiDescriptionNoUsableImages" ||
          error.message === "aiDescriptionImageRequired")
      ) {
        skippedCount += 1;
        continue;
      }

      failedCount += 1;
      input.logger?.warn(
        {
          phase: "bulk-description-item",
          productId: product.id,
          error: error instanceof Error ? { message: error.message, name: error.name } : error,
        },
        "bulk product description generation failed for item",
      );
    }
  }

  const processedCount = updatedCount + skippedCount + failedCount;
  const deferredCount = rateLimited ? Math.max(0, uniqueProductIds.length - processedCount) : 0;

  return {
    updatedCount,
    skippedCount,
    failedCount,
    deferredCount,
    rateLimited,
    updatedProductIds,
  };
};

export const bulkUpdateProductCategory = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  productIds: string[];
  category?: string | null;
  mode?: "add" | "setPrimary" | "replace";
}) =>
  prisma.$transaction(async (tx) => {
    if (!input.productIds.length) {
      return { updated: 0 };
    }

    const products = await tx.product.findMany({
      where: { organizationId: input.organizationId, id: { in: input.productIds } },
      select: { id: true, category: true, categories: true },
    });

    if (!products.length) {
      return { updated: 0 };
    }

    const nextCategory = normalizeProductCategoryName(input.category);
    if (nextCategory) {
      await ensureProductCategory(tx, {
        organizationId: input.organizationId,
        name: nextCategory,
      });
    }
    const mode = input.mode ?? "add";
    let updated = 0;

    for (const product of products) {
      const currentCategories = normalizeProductCategoryNames([
        product.category,
        ...product.categories,
      ]);
      let nextCategories: string[];

      if (!nextCategory) {
        nextCategories = [];
      } else if (mode === "replace") {
        nextCategories = [nextCategory];
      } else if (mode === "setPrimary") {
        nextCategories = [
          nextCategory,
          ...currentCategories.filter((category) => category !== nextCategory),
        ];
      } else {
        nextCategories = currentCategories.includes(nextCategory)
          ? currentCategories
          : [...currentCategories, nextCategory];
      }

      const nextPrimaryCategory = resolvePrimaryProductCategory(nextCategories);
      if (
        product.category === nextPrimaryCategory &&
        areProductCategoryListsEqual(product.categories, nextCategories)
      ) {
        continue;
      }

      await tx.product.update({
        where: { id: product.id },
        data: {
          category: nextPrimaryCategory,
          categories: nextCategories,
        },
      });

      await writeAuditLog(tx, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: "PRODUCT_UPDATE",
        entity: "Product",
        entityId: product.id,
        before: toJson({
          id: product.id,
          category: product.category,
          categories: product.categories,
        }),
        after: toJson({
          id: product.id,
          category: nextPrimaryCategory,
          categories: nextCategories,
        }),
        requestId: input.requestId,
      });

      updated += 1;
    }

    return { updated };
  });

export const arrangeClothingCategoriesWithAi = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  productIds: string[];
}) => {
  const uniqueProductIds = Array.from(
    new Set(input.productIds.map((id) => id.trim()).filter(Boolean)),
  );
  if (!uniqueProductIds.length) {
    return { scanned: 0, eligible: 0, proposed: 0, updated: 0, skipped: 0, aiUsed: false };
  }

  const products = await prisma.product.findMany({
    where: {
      organizationId: input.organizationId,
      id: { in: uniqueProductIds },
      isDeleted: false,
    },
    select: {
      id: true,
      name: true,
      sku: true,
      category: true,
      categories: true,
      description: true,
      photoUrl: true,
      images: {
        where: {
          url: {
            not: { startsWith: "data:image/" },
          },
        },
        select: { url: true },
        orderBy: { position: "asc" },
        take: 2,
      },
      variants: {
        where: { isActive: true },
        select: {
          name: true,
          sku: true,
          attributes: true,
        },
        take: 20,
      },
    },
  });

  const availableCategories = (await listProductCategoriesFromDb(prisma, input.organizationId))
    .map((category) => normalizeProductCategoryName(category))
    .filter((category): category is string => Boolean(category))
    .filter((category) => !isGenderCategoryName(category));
  const context: CategoryArrangementContext = { availableCategories };
  const eligibleProducts = products;
  const decisions = new Map<string, CategoryArrangementDecision>();
  const uncertainProducts: CategoryArrangementProduct[] = [];

  for (const product of eligibleProducts) {
    const localDecision = classifyProductGenderLocally(product, context);
    if (localDecision) {
      decisions.set(product.id, localDecision);
    } else {
      uncertainProducts.push(product);
    }
  }

  let aiUsed = false;
  const aiBatches: CategoryArrangementProduct[][] = [];
  for (let index = 0; index < uncertainProducts.length; ) {
    const nextTextBatch = uncertainProducts.slice(index, index + CATEGORY_ARRANGEMENT_BATCH_SIZE);
    const batchSize = nextTextBatch.some(
      (product) => imageUrlsForCategoryArrangement(product).length,
    )
      ? CATEGORY_ARRANGEMENT_IMAGE_BATCH_SIZE
      : CATEGORY_ARRANGEMENT_BATCH_SIZE;
    const batch = uncertainProducts.slice(index, index + batchSize);
    index += batchSize;
    aiBatches.push(batch);
  }

  const aiDecisionResults = await Promise.all(
    aiBatches.map((batch) => callCategoryArrangementAi(batch, context)),
  );
  for (const aiDecisions of aiDecisionResults) {
    if (aiDecisions.size > 0) {
      aiUsed = true;
    }
    for (const [productId, decision] of aiDecisions) {
      decisions.set(productId, decision);
    }
  }

  let proposed = 0;
  let updated = 0;

  await prisma.$transaction(async (tx) => {
    await ensureProductCategory(tx, {
      organizationId: input.organizationId,
      name: MEN_CATEGORY_NAME,
    });
    await ensureProductCategory(tx, {
      organizationId: input.organizationId,
      name: WOMEN_CATEGORY_NAME,
    });

    for (const product of eligibleProducts) {
      const decision = decisions.get(product.id);
      if (!decision) {
        continue;
      }

      const currentCategories = normalizeProductCategoryNames([
        product.category,
        ...product.categories,
      ]);
      const nextCategories = resolveNextArrangedCategories(
        currentCategories,
        decision.gender,
        decision.inferredCategory,
      );
      const nextPrimaryCategory = resolvePrimaryProductCategory(nextCategories);
      if (
        product.category === nextPrimaryCategory &&
        areProductCategoryListsEqual(product.categories, nextCategories)
      ) {
        proposed += 1;
        continue;
      }

      await tx.product.update({
        where: { id: product.id },
        data: {
          category: nextPrimaryCategory,
          categories: nextCategories,
        },
      });

      await writeAuditLog(tx, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: "PRODUCT_CATEGORY_AI_ARRANGE",
        entity: "Product",
        entityId: product.id,
        before: toJson({
          id: product.id,
          category: product.category,
          categories: product.categories,
        }),
        after: toJson({
          id: product.id,
          category: nextPrimaryCategory,
          categories: nextCategories,
          decision,
        }),
        requestId: input.requestId,
      });

      proposed += 1;
      updated += 1;
    }
  });

  return {
    scanned: products.length,
    eligible: eligibleProducts.length,
    proposed,
    updated,
    skipped: Math.max(0, eligibleProducts.length - proposed),
    aiUsed,
  };
};

export type ImportProductRow = {
  sku: string;
  name?: string;
  category?: string | null;
  categories?: string[] | null;
  color?: string | null;
  unit?: string;
  description?: string | null;
  photoUrl?: string | null;
  images?: {
    url: string;
    position?: number;
  }[];
  variants?: CreateProductInput["variants"];
  barcodes?: string[];
  basePriceKgs?: number;
  purchasePriceKgs?: number;
  avgCostKgs?: number;
  minStock?: number;
};

export type ImportUpdateField =
  | "name"
  | "unit"
  | "category"
  | "color"
  | "description"
  | "photoUrl"
  | "variants"
  | "barcodes"
  | "basePriceKgs"
  | "purchasePriceKgs"
  | "avgCostKgs"
  | "minStock";

export type ImportPhotoResolutionSummary = {
  downloaded: number;
  fallback: number;
  missing: number;
};

const normalizeImportImages = (row: Pick<ImportProductRow, "photoUrl" | "images">) => {
  const sourceImages =
    row.images?.length || !row.photoUrl ? row.images : [{ url: row.photoUrl, position: 0 }];
  const seen = new Set<string>();
  const normalized = normalizeImages(sourceImages)
    .map((image) => ({
      ...image,
      url: normalizeImportPhotoUrl(image.url) ?? "",
    }))
    .filter((image) => {
      if (!image.url || seen.has(image.url)) {
        return false;
      }
      seen.add(image.url);
      return true;
    })
    .map((image, index) => ({ ...image, position: index }));

  return normalized;
};

const withResolvedImportImages = (row: ImportProductRow, images: NormalizedImage[]) => ({
  ...row,
  photoUrl: images[0]?.url,
  images: images.length ? images.map(({ url, position }) => ({ url, position })) : undefined,
});

const normalizeImportVariantAttributeValue = (value: unknown): unknown => {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeImportVariantAttributeValue(item))
      .filter((item) => item !== "");
  }
  return value;
};

const normalizeImportVariants = (variants?: CreateProductInput["variants"]) => {
  if (!variants?.length) {
    return [];
  }

  const seenNames = new Set<string>();
  const normalized: NonNullable<CreateProductInput["variants"]> = [];
  for (const variant of variants) {
    const name = variant.name?.trim().replace(/\s+/g, " ") ?? "";
    if (!name) {
      continue;
    }
    const nameKey = name.toLocaleLowerCase();
    if (seenNames.has(nameKey)) {
      continue;
    }
    seenNames.add(nameKey);
    const sku = variant.sku?.trim() || null;
    const attributes = Object.fromEntries(
      Object.entries(variant.attributes ?? {})
        .map(([key, value]) => [key.trim(), normalizeImportVariantAttributeValue(value)])
        .filter(([key, value]) => key && value !== ""),
    );

    normalized.push({
      name,
      sku,
      attributes: Object.keys(attributes).length ? attributes : {},
    });
  }

  return normalized;
};

const splitImportCategoryHierarchy = (value?: string | null) =>
  (value ?? "")
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter(Boolean);

const normalizeImportRowCategories = (
  row: Pick<ImportProductRow, "category" | "categories">,
) => {
  if (row.categories?.length) {
    return normalizeProductCategoryNames(row.categories.flatMap(splitImportCategoryHierarchy));
  }
  return normalizeProductCategoryNames(splitImportCategoryHierarchy(row.category));
};

const normalizeImportText = (value?: string | null) => {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized : null;
};

const mergeImportColorIntoVariants = (
  variants: NonNullable<CreateProductInput["variants"]>,
  color: string | null,
) => {
  if (!color || !variants.length) {
    return variants;
  }
  return variants.map((variant) => ({
    ...variant,
    attributes: {
      color,
      ...(variant.attributes ?? {}),
    },
  }));
};

const resolveImportImageWorkerCount = (rowsCount: number) => {
  const parsed = Number(process.env.IMPORT_IMAGE_WORKERS);
  if (Number.isFinite(parsed) && parsed >= 1) {
    return Math.max(1, Math.min(24, Math.trunc(parsed), rowsCount));
  }
  return Math.max(1, Math.min(12, rowsCount));
};

const resolveImportImageBudgetMs = () => {
  const parsed = Number(process.env.IMPORT_IMAGE_RESOLVE_BUDGET_MS);
  if (Number.isFinite(parsed) && parsed >= 5_000) {
    return parsed;
  }
  return 120_000;
};

export const resolveImportRowsPhotoUrls = async (rows: ImportProductRow[]) => {
  const cache = new Map<string, ResolveProductImageUrlResult>();
  const resolvedRows: ImportProductRow[] = new Array(rows.length);
  let cursor = 0;
  const workerCount = resolveImportImageWorkerCount(rows.length);
  const deadline = Date.now() + resolveImportImageBudgetMs();

  const runWorker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= rows.length) {
        return;
      }

      const row = rows[index];
      const normalizedImages = normalizeImportImages(row);
      if (!normalizedImages.length) {
        resolvedRows[index] = withResolvedImportImages(row, []);
        continue;
      }

      if (Date.now() > deadline) {
        resolvedRows[index] = withResolvedImportImages(row, normalizedImages);
        continue;
      }

      const resolvedImages: NormalizedImage[] = [];
      for (const image of normalizedImages) {
        const resolvedPhotoUrl = await resolveRemoteImportPhotoUrl(image.url, undefined, cache);
        resolvedImages.push({ ...image, url: resolvedPhotoUrl });
      }
      resolvedRows[index] = withResolvedImportImages(row, resolvedImages);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return resolvedRows;
};

export const resolveImportRowsPhotoUrlsForOrganization = async (
  rows: ImportProductRow[],
  organizationId: string,
) => {
  const cache = new Map<string, ResolveProductImageUrlResult>();
  const resolvedRows: ImportProductRow[] = new Array(rows.length);
  const summary: ImportPhotoResolutionSummary = {
    downloaded: 0,
    fallback: 0,
    missing: 0,
  };
  let cursor = 0;
  const workerCount = resolveImportImageWorkerCount(rows.length);
  const deadline = Date.now() + resolveImportImageBudgetMs();

  const runWorker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= rows.length) {
        return;
      }

      const row = rows[index];
      const normalizedImages = normalizeImportImages(row);
      if (!normalizedImages.length) {
        summary.missing += 1;
        resolvedRows[index] = withResolvedImportImages(row, []);
        continue;
      }

      if (Date.now() > deadline) {
        summary.fallback += normalizedImages.length;
        resolvedRows[index] = withResolvedImportImages(row, []);
        continue;
      }

      const resolvedImages: NormalizedImage[] = [];
      for (const image of normalizedImages) {
        if (Date.now() > deadline) {
          summary.fallback += 1;
          continue;
        }
        const resolved = await resolveProductImageUrl({
          value: image.url,
          organizationId,
          cache,
          fallbackToSource: false,
        });
        if (resolved.url && resolved.managed && isManagedProductImageUrl(resolved.url)) {
          summary.downloaded += 1;
          resolvedImages.push({ ...image, url: resolved.url });
        } else {
          summary.fallback += 1;
        }
      }
      resolvedRows[index] = withResolvedImportImages(row, resolvedImages);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return { rows: resolvedRows, summary };
};

export type ImportProductsInput = {
  organizationId: string;
  actorId: string;
  requestId: string;
  rows: ImportProductRow[];
  storeId?: string;
  batchId?: string;
  mode?: "full" | "update_selected";
  updateMask?: ImportUpdateField[];
};

const resolveImportTransactionTimeout = () => {
  const parsed = Number(process.env.IMPORT_TRANSACTION_TIMEOUT_MS);
  if (Number.isFinite(parsed) && parsed >= 5_000) {
    return parsed;
  }
  return 120_000;
};

export const importProductsTx = async (
  tx: Prisma.TransactionClient,
  input: ImportProductsInput,
) => {
  const results: { sku: string; action: "created" | "updated" | "skipped" }[] = [];
  const isUpdateSelectedMode = input.mode === "update_selected";
  const updateMask = new Set<ImportUpdateField>(input.updateMask ?? []);
  const shouldApplyField = (field: ImportUpdateField) =>
    !isUpdateSelectedMode || updateMask.has(field);
  const orgStores = await tx.store.findMany({
    where: { organizationId: input.organizationId },
    select: { id: true, allowNegativeStock: true },
    orderBy: { createdAt: "asc" },
  });
  const stores = input.storeId
    ? orgStores.filter((store) => store.id === input.storeId)
    : orgStores.length === 1
      ? orgStores
      : [];
  if (input.storeId && stores.length !== 1) {
    throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
  }

  const recordImportedEntity = async (entityType: string, entityId: string) => {
    if (!input.batchId) {
      return;
    }
    await tx.importedEntity.create({
      data: {
        batchId: input.batchId,
        entityType,
        entityId,
      },
    });
  };

  const resolveOptionalPrice = (value?: number) => {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (!Number.isFinite(value) || value < 0) {
      throw new AppError("unitCostInvalid", "BAD_REQUEST", 400);
    }
    return value;
  };

  const resolveOptionalInteger = (value?: number) => {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
      throw new AppError("invalidInput", "BAD_REQUEST", 400);
    }
    return value;
  };

  const setBaseCost = async (productId: string, avgCostKgs: number) => {
    const existing = await tx.productCost.findUnique({
      where: {
        organizationId_productId_variantKey: {
          organizationId: input.organizationId,
          productId,
          variantKey: "BASE",
        },
      },
      select: { id: true, costBasisQty: true },
    });

    if (existing) {
      await tx.productCost.update({
        where: { id: existing.id },
        data: {
          avgCostKgs,
          costBasisQty: Math.max(existing.costBasisQty, 1),
        },
      });
      return;
    }

    await tx.productCost.create({
      data: {
        organizationId: input.organizationId,
        productId,
        variantKey: "BASE",
        avgCostKgs,
        costBasisQty: 1,
      },
    });
  };

  const upsertStoreBasePrice = async (productId: string, priceKgs: number) => {
    if (!input.storeId) {
      return;
    }

    await tx.storePrice.upsert({
      where: {
        organizationId_storeId_productId_variantKey: {
          organizationId: input.organizationId,
          storeId: input.storeId,
          productId,
          variantKey: "BASE",
        },
      },
      create: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        productId,
        variantKey: "BASE",
        priceKgs,
        updatedById: input.actorId,
      },
      update: {
        priceKgs,
        updatedById: input.actorId,
      },
    });
  };

  const upsertMinStock = async (productId: string, minStock?: number) => {
    if (minStock === undefined) {
      return;
    }
    if (!input.storeId) {
      throw new AppError("storeRequired", "BAD_REQUEST", 400);
    }
    const existing = await tx.reorderPolicy.findUnique({
      where: { storeId_productId: { storeId: input.storeId, productId } },
      select: { id: true },
    });

    const policy = await tx.reorderPolicy.upsert({
      where: { storeId_productId: { storeId: input.storeId, productId } },
      update: { minStock },
      create: {
        storeId: input.storeId,
        productId,
        minStock,
        leadTimeDays: 7,
        reviewPeriodDays: 7,
        safetyStockDays: 3,
        minOrderQty: 0,
      },
    });

    if (!existing) {
      await recordImportedEntity("ReorderPolicy", policy.id);
    }
  };

  let attributeDefinitionsCache: AttributeDefinitionRow[] | null = null;
  const resolveAttributeDefinitions = async () => {
    if (!attributeDefinitionsCache) {
      attributeDefinitionsCache = await loadAttributeDefinitions(tx, input.organizationId);
    }
    return attributeDefinitionsCache;
  };

  const upsertImportVariants = async (
    productId: string,
    variants: NonNullable<CreateProductInput["variants"]>,
  ) => {
    if (!variants.length) {
      return;
    }

    const attributeDefinitions = await resolveAttributeDefinitions();
    ensureRequiredAttributes(variants, attributeDefinitions);
    const definitionMap = new Map<string, AttributeDefinitionRow>(
      attributeDefinitions.map((definition: AttributeDefinitionRow) => [
        definition.key,
        definition,
      ]),
    );
    const existingVariants = await tx.productVariant.findMany({
      where: { productId, isActive: true },
      select: { id: true, name: true },
    });
    const existingByName = new Map(
      existingVariants
        .map((variant) => [variant.name?.trim().toLocaleLowerCase() ?? "", variant] as const)
        .filter(([name]) => name.length > 0),
    );

    for (const variant of variants) {
      const name = variant.name?.trim() ?? "";
      const existingVariant = existingByName.get(name.toLocaleLowerCase());
      if (existingVariant) {
        await tx.productVariant.update({
          where: { id: existingVariant.id },
          data: {
            name,
            sku: variant.sku ?? null,
            attributes: toJson(variant.attributes ?? {}),
            isActive: true,
          },
        });
        await tx.variantAttributeValue.deleteMany({
          where: { variantId: existingVariant.id },
        });
        await syncVariantAttributeValues(
          tx,
          {
            organizationId: input.organizationId,
            productId,
            variantId: existingVariant.id,
            attributes: variant.attributes ?? {},
          },
          definitionMap,
        );
        continue;
      }

      const createdVariant = await tx.productVariant.create({
        data: {
          productId,
          name,
          sku: variant.sku ?? null,
          attributes: toJson(variant.attributes ?? {}),
        },
      });
      await recordImportedEntity("ProductVariant", createdVariant.id);
      await syncVariantAttributeValues(
        tx,
        {
          organizationId: input.organizationId,
          productId,
          variantId: createdVariant.id,
          attributes: variant.attributes ?? {},
        },
        definitionMap,
      );
    }
  };

  const applyImportColorToExistingVariants = async (productId: string, color: string) => {
    const existingVariants = await tx.productVariant.findMany({
      where: { productId, isActive: true },
      select: { id: true, attributes: true },
    });
    if (!existingVariants.length) {
      return;
    }

    const attributeDefinitions = await resolveAttributeDefinitions();
    const definitionMap = new Map<string, AttributeDefinitionRow>(
      attributeDefinitions.map((definition: AttributeDefinitionRow) => [
        definition.key,
        definition,
      ]),
    );

    for (const variant of existingVariants) {
      const currentAttributes =
        variant.attributes &&
        typeof variant.attributes === "object" &&
        !Array.isArray(variant.attributes)
          ? (variant.attributes as Record<string, unknown>)
          : {};
      const nextAttributes = { ...currentAttributes, color };
      await tx.productVariant.update({
        where: { id: variant.id },
        data: { attributes: toJson(nextAttributes) },
      });
      await tx.variantAttributeValue.deleteMany({
        where: { variantId: variant.id, key: "color" },
      });
      await syncVariantAttributeValues(
        tx,
        {
          organizationId: input.organizationId,
          productId,
          variantId: variant.id,
          attributes: { color },
        },
        definitionMap,
      );
    }
  };

  for (const row of input.rows) {
    const sku = row.sku.trim();
    if (!sku) {
      throw new AppError("skuRequired", "BAD_REQUEST", 400);
    }

    const barcodes = shouldApplyField("barcodes") ? normalizeBarcodes(row.barcodes) : [];
    const images = shouldApplyField("photoUrl") ? normalizeImportImages(row) : [];
    const photoUrl = images[0]?.url ?? null;
    const rowColor = shouldApplyField("color") ? normalizeImportText(row.color) : null;
    const variants = mergeImportColorIntoVariants(
      shouldApplyField("variants") ? normalizeImportVariants(row.variants) : [],
      rowColor,
    );
    const basePriceKgs = shouldApplyField("basePriceKgs")
      ? resolveOptionalPrice(row.basePriceKgs)
      : undefined;
    const avgCostKgs = shouldApplyField("avgCostKgs")
      ? resolveOptionalPrice(row.avgCostKgs)
      : undefined;
    const purchasePriceKgs = shouldApplyField("purchasePriceKgs")
      ? resolveOptionalPrice(row.purchasePriceKgs)
      : undefined;
    const minStock = shouldApplyField("minStock")
      ? resolveOptionalInteger(row.minStock)
      : undefined;
    const resolvedBaseCost = avgCostKgs ?? purchasePriceKgs;
    const normalizedRowCategories = normalizeImportRowCategories(row);
    const unitCode = row.unit?.trim() ?? "";
    const baseUnit =
      shouldApplyField("unit") && unitCode
        ? await ensureUnitByCode(tx, input.organizationId, unitCode)
        : null;
    const existing = await tx.product.findUnique({
      where: { organizationId_sku: { organizationId: input.organizationId, sku } },
    });

    if (shouldApplyField("barcodes")) {
      await ensureBarcodesAvailable(tx, input.organizationId, barcodes, existing?.id);
    }
    if (shouldApplyField("category")) {
      for (const category of normalizedRowCategories) {
        await ensureProductCategory(tx, {
          organizationId: input.organizationId,
          name: category,
        });
      }
    }

    if (existing) {
      const updateData: Prisma.ProductUpdateInput = {};
      if (isUpdateSelectedMode) {
        if (shouldApplyField("name") && row.name?.trim()) {
          updateData.name = row.name.trim();
        }
        if (shouldApplyField("category")) {
          updateData.category = resolvePrimaryProductCategory(normalizedRowCategories);
          updateData.categories = normalizedRowCategories;
        }
        if (shouldApplyField("description")) {
          updateData.description = row.description ?? null;
        }
        if (shouldApplyField("unit")) {
          if (!unitCode || !baseUnit) {
            throw new AppError("unitRequired", "BAD_REQUEST", 400);
          }
          updateData.unit = baseUnit.code;
          updateData.baseUnit = { connect: { id: baseUnit.id } };
        }
        if (shouldApplyField("basePriceKgs") && basePriceKgs !== undefined) {
          updateData.basePriceKgs = basePriceKgs;
        }
        if (shouldApplyField("photoUrl")) {
          updateData.photoUrl = photoUrl ?? existing.photoUrl;
        }
      } else {
        const name = row.name?.trim();
        if (!name) {
          throw new AppError("nameRequired", "BAD_REQUEST", 400);
        }
        if (!unitCode || !baseUnit) {
          throw new AppError("unitRequired", "BAD_REQUEST", 400);
        }
        updateData.name = name;
        updateData.category = resolvePrimaryProductCategory(normalizedRowCategories);
        updateData.categories = normalizedRowCategories;
        updateData.unit = baseUnit.code;
        updateData.baseUnit = { connect: { id: baseUnit.id } };
        updateData.description = row.description ?? null;
        updateData.photoUrl = photoUrl ?? existing.photoUrl;
        updateData.isDeleted = false;
        if (basePriceKgs !== undefined) {
          updateData.basePriceKgs = basePriceKgs;
        }
      }

      if (Object.keys(updateData).length > 0) {
        await tx.product.update({
          where: { id: existing.id },
          data: updateData,
        });
      }

      if (shouldApplyField("photoUrl") && images.length) {
        await syncProductImages(tx, input.organizationId, existing.id, images);
      }

      if (shouldApplyField("variants") && variants.length) {
        await upsertImportVariants(existing.id, variants);
      } else if (rowColor) {
        await applyImportColorToExistingVariants(existing.id, rowColor);
      }

      if (shouldApplyField("barcodes")) {
        const existingBarcodes = await tx.productBarcode.findMany({
          where: { productId: existing.id },
          select: { id: true, value: true },
        });
        const existingValues = new Map(
          existingBarcodes.map((barcode) => [barcode.value, barcode.id]),
        );
        const nextValues = new Set(barcodes);
        const toRemove = existingBarcodes.filter((barcode) => !nextValues.has(barcode.value));
        const toAdd = barcodes.filter((value) => !existingValues.has(value));

        if (toRemove.length) {
          await tx.productBarcode.deleteMany({
            where: { id: { in: toRemove.map((barcode) => barcode.id) } },
          });
        }
        for (const value of toAdd) {
          const barcode = await tx.productBarcode.create({
            data: {
              organizationId: input.organizationId,
              productId: existing.id,
              value,
            },
          });
          await recordImportedEntity("ProductBarcode", barcode.id);
        }
      }

      for (const store of stores) {
        await assignProductToStore(tx, {
          organizationId: input.organizationId,
          storeId: store.id,
          productId: existing.id,
          actorId: input.actorId,
        });
      }
      await ensureBaseSnapshots(tx, input.organizationId, existing.id, stores);
      if (shouldApplyField("basePriceKgs") && basePriceKgs !== undefined) {
        await upsertStoreBasePrice(existing.id, basePriceKgs);
      }
      if (
        (shouldApplyField("avgCostKgs") || shouldApplyField("purchasePriceKgs")) &&
        resolvedBaseCost !== undefined
      ) {
        await setBaseCost(existing.id, resolvedBaseCost);
      }
      if (shouldApplyField("minStock")) {
        await upsertMinStock(existing.id, minStock);
      }

      await writeAuditLog(tx, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: "PRODUCT_UPDATE",
        entity: "Product",
        entityId: existing.id,
        before: toJson(existing),
        after: toJson({ ...existing, ...row }),
        requestId: input.requestId,
      });

      results.push({ sku, action: "updated" });
    } else {
      if (isUpdateSelectedMode) {
        results.push({ sku, action: "skipped" });
        continue;
      }
      const name = row.name?.trim();
      if (!name) {
        throw new AppError("nameRequired", "BAD_REQUEST", 400);
      }
      if (!unitCode) {
        throw new AppError("unitRequired", "BAD_REQUEST", 400);
      }
      const resolvedBaseUnit =
        baseUnit ?? (await ensureUnitByCode(tx, input.organizationId, unitCode));

      const product = await tx.product.create({
        data: {
          organizationId: input.organizationId,
          sku,
          name,
          category: resolvePrimaryProductCategory(normalizedRowCategories),
          categories: normalizedRowCategories,
          unit: resolvedBaseUnit.code,
          baseUnitId: resolvedBaseUnit.id,
          basePriceKgs: basePriceKgs ?? null,
          description: row.description ?? null,
          photoUrl: photoUrl ?? null,
        },
      });

      await recordImportedEntity("Product", product.id);

      if (images.length) {
        await tx.productImage.createMany({
          data: images.map((image) => ({
            organizationId: input.organizationId,
            productId: product.id,
            url: image.url,
            position: image.position,
          })),
        });
      }

      for (const value of barcodes) {
        const barcode = await tx.productBarcode.create({
          data: {
            organizationId: input.organizationId,
            productId: product.id,
            value,
          },
        });
        await recordImportedEntity("ProductBarcode", barcode.id);
      }

      for (const store of stores) {
        await assignProductToStore(tx, {
          organizationId: input.organizationId,
          storeId: store.id,
          productId: product.id,
          actorId: input.actorId,
        });
      }
      await ensureBaseSnapshots(tx, input.organizationId, product.id, stores);
      if (basePriceKgs !== undefined) {
        await upsertStoreBasePrice(product.id, basePriceKgs);
      }
      if (resolvedBaseCost !== undefined) {
        await setBaseCost(product.id, resolvedBaseCost);
      }
      if (shouldApplyField("minStock")) {
        await upsertMinStock(product.id, minStock);
      }
      if (shouldApplyField("variants") && variants.length) {
        await upsertImportVariants(product.id, variants);
      }

      await writeAuditLog(tx, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: "PRODUCT_CREATE",
        entity: "Product",
        entityId: product.id,
        before: null,
        after: toJson(product),
        requestId: input.requestId,
      });

      results.push({ sku, action: "created" });
    }
  }

  return results;
};

export const importProducts = async (input: ImportProductsInput) =>
  prisma.$transaction(async (tx) => importProductsTx(tx, input), {
    maxWait: 10_000,
    timeout: resolveImportTransactionTimeout(),
  });

export type ArchiveProductInput = {
  productId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
};

export const archiveProduct = async (input: ArchiveProductInput) =>
  prisma.$transaction(async (tx) => {
    const before = await tx.product.findUnique({ where: { id: input.productId } });
    if (!before || before.organizationId !== input.organizationId) {
      throw new AppError("productNotFound", "NOT_FOUND", 404);
    }

    const product = await tx.product.update({
      where: { id: input.productId },
      data: { isDeleted: true },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "PRODUCT_ARCHIVE",
      entity: "Product",
      entityId: product.id,
      before: toJson(before),
      after: toJson(product),
      requestId: input.requestId,
    });

    return product;
  });

export type RestoreProductInput = {
  productId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
};

export const restoreProduct = async (input: RestoreProductInput) =>
  prisma.$transaction(async (tx) => {
    const before = await tx.product.findUnique({ where: { id: input.productId } });
    if (!before || before.organizationId !== input.organizationId) {
      throw new AppError("productNotFound", "NOT_FOUND", 404);
    }

    const product = await tx.product.update({
      where: { id: input.productId },
      data: { isDeleted: false },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "PRODUCT_RESTORE",
      entity: "Product",
      entityId: product.id,
      before: toJson(before),
      after: toJson(product),
      requestId: input.requestId,
    });

    return product;
  });

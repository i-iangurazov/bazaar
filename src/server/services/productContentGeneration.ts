import { defaultLocale, normalizeLocale } from "@/lib/locales";
import { AppError } from "@/server/services/errors";
import { generateProductDescriptionFromImages } from "@/server/services/productDescriptions";
import { suggestProductSpecsFromImages } from "@/server/services/productSpecSuggestions";

export type ProductContentSpecKind =
  | "manufacturer"
  | "model"
  | "type"
  | "color"
  | "material"
  | "compatibility"
  | "design"
  | "features"
  | "purpose";

export type ProductContentSpecValueSource = "metadata" | "image" | "product";

export type ProductContentRequestedSpec = {
  key: string;
  labelRu: string;
  labelKg?: string;
  kind: ProductContentSpecKind;
  options?: string[];
  existingValue?: string | null;
};

export type GeneratedProductContentSpec = {
  key: string;
  labelRu: string;
  kind: ProductContentSpecKind;
  value: string;
  source: ProductContentSpecValueSource;
};

type ProductContentLogger = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

type GenerateProductContentInput = {
  product: {
    id?: string;
    sku?: string | null;
    name?: string | null;
    description?: string | null;
    isBundle?: boolean;
    supplier?: { name: string | null } | null;
  };
  category?: string | null;
  imageUrls?: string[];
  locale?: string | null;
  mode?: "overwrite" | "missing-only";
  generateDescription?: boolean;
  generateSpecs?: boolean;
  overwriteDescription?: boolean;
  overwriteSpecs?: boolean;
  requestedSpecs?: ProductContentRequestedSpec[];
  integrationContext?: {
    source?: string;
    marketplace?: "m-market" | "bakai-store" | "o-market" | string;
  } | null;
  logger?: ProductContentLogger;
};

export const AI_GENERATED_SPEC_DEFINITIONS: Array<{
  key: string;
  labelRu: string;
  labelKg: string;
  kind: Exclude<ProductContentSpecKind, "manufacturer" | "model">;
}> = [
  { key: "ai_type", labelRu: "Тип", labelKg: "Түрү", kind: "type" },
  { key: "ai_purpose", labelRu: "Назначение", labelKg: "Багыты", kind: "purpose" },
  { key: "ai_features", labelRu: "Особенности", labelKg: "Өзгөчөлүктөрү", kind: "features" },
  { key: "ai_design", labelRu: "Дизайн", labelKg: "Дизайн", kind: "design" },
  { key: "ai_color", labelRu: "Цвет", labelKg: "Түсү", kind: "color" },
  { key: "ai_material", labelRu: "Материал", labelKg: "Материал", kind: "material" },
  {
    key: "ai_compatibility",
    labelRu: "Совместимость",
    labelKg: "Шайкештик",
    kind: "compatibility",
  },
];

const normalizeLabel = (value?: string | null) =>
  (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, "");

export const isDescriptionLikeSpec = (input: {
  labelRu?: string | null;
  attributeKey?: string | null;
}) => {
  const values = [normalizeLabel(input.labelRu), normalizeLabel(input.attributeKey)].filter(
    Boolean,
  );
  return values.some((value) => value.includes("описани") || value.includes("description"));
};

export const resolveProductContentSpecKind = (input: {
  labelRu?: string | null;
  attributeKey?: string | null;
}): ProductContentSpecKind | null => {
  const values = [normalizeLabel(input.labelRu), normalizeLabel(input.attributeKey)].filter(
    (value) => value.length > 0,
  );
  if (!values.length || isDescriptionLikeSpec(input)) {
    return null;
  }
  if (
    values.some(
      (value) =>
        value.includes("производ") ||
        value.includes("бренд") ||
        value.includes("manufacturer") ||
        value.includes("brand") ||
        value.includes("maker"),
    )
  ) {
    return "manufacturer";
  }
  if (values.some((value) => value.includes("модел") || value.includes("model"))) {
    return "model";
  }
  if (
    values.some(
      (value) =>
        value.includes("совмест") ||
        value.includes("подходит") ||
        value.includes("устройств") ||
        value.includes("compatib") ||
        value.includes("device"),
    )
  ) {
    return "compatibility";
  }
  if (
    values.some(
      (value) =>
        value.includes("материал") ||
        value.includes("состав") ||
        value.includes("material") ||
        value.includes("composition"),
    )
  ) {
    return "material";
  }
  if (
    values.some(
      (value) =>
        value.includes("дизайн") ||
        value.includes("принт") ||
        value.includes("рисунок") ||
        value.includes("pattern") ||
        value.includes("design") ||
        value.includes("style"),
    )
  ) {
    return "design";
  }
  if (
    values.some(
      (value) =>
        value.includes("особен") ||
        value.includes("характеристик") ||
        value.includes("feature"),
    )
  ) {
    return "features";
  }
  if (
    values.some(
      (value) =>
        value.includes("назначен") ||
        value.includes("применен") ||
        value.includes("purpose") ||
        value.includes("usecase"),
    )
  ) {
    return "purpose";
  }
  if (
    values.some(
      (value) =>
        value.includes("цвет") ||
        value.includes("расцвет") ||
        value.includes("color") ||
        value.includes("colour"),
    )
  ) {
    return "color";
  }
  if (values.some((value) => value.includes("тип") || value.includes("вид") || value.includes("type"))) {
    return "type";
  }
  return null;
};

const cleanSpecValue = (value: string) =>
  value
    .replace(/\s+/g, " ")
    .replace(/^[\s"'«“”„]+/, "")
    .replace(/[\s"'»“”„.]+$/, "")
    .trim();

const normalizeComparable = (value: string) =>
  value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s-]+/gu, "")
    .trim();

export const matchProductSpecOption = (value: string, options?: string[]) => {
  const cleaned = cleanSpecValue(value);
  const normalizedOptions = (options ?? [])
    .map((option) => option.trim())
    .filter((option) => option.length > 0);
  if (!cleaned || !normalizedOptions.length) {
    return cleaned;
  }

  const comparable = normalizeComparable(cleaned);
  const exact = normalizedOptions.find((option) => normalizeComparable(option) === comparable);
  if (exact) {
    return exact;
  }
  return (
    normalizedOptions.find((option) => {
      const normalizedOption = normalizeComparable(option);
      return normalizedOption.includes(comparable) || comparable.includes(normalizedOption);
    }) ?? cleaned
  );
};

const textIncludes = (input: string, values: string[]) =>
  values.some((value) => input.includes(value));

const buildMetadataSearchText = (input: {
  name?: string | null;
  category?: string | null;
}) => normalizeComparable([input.name, input.category].filter(Boolean).join(" "));

export const inferProductSpecValueFromMetadata = (input: {
  kind: ProductContentSpecKind;
  product: GenerateProductContentInput["product"];
  category?: string | null;
  options?: string[];
}) => {
  const searchText = buildMetadataSearchText({
    name: input.product.name,
    category: input.category,
  });
  const sku = input.product.sku?.trim() ?? "";
  const supplierName = input.product.supplier?.name?.trim() ?? "";

  let value: string | null = null;
  switch (input.kind) {
    case "manufacturer":
      value = supplierName || null;
      break;
    case "model":
      value = sku || null;
      break;
    case "type":
      if (textIncludes(searchText, ["чехол", "case", "кейс"])) {
        value = "Чехол";
      } else if (textIncludes(searchText, ["защитное стекло", "стекло", "glass"])) {
        value = "Защитное стекло";
      } else if (textIncludes(searchText, ["кабель", "cable", "usb"])) {
        value = "Кабель";
      } else if (textIncludes(searchText, ["заряд", "адаптер", "charger", "adapter"])) {
        value = "Зарядное устройство";
      } else if (textIncludes(searchText, ["наушник", "гарнитур", "headphone", "earphone"])) {
        value = "Наушники";
      } else if (textIncludes(searchText, ["смартфон", "телефон", "phone"])) {
        value = "Смартфон";
      } else if (textIncludes(searchText, ["игруш", "toy"])) {
        value = "Игрушка";
      } else {
        value = input.category?.trim() || null;
      }
      break;
    case "color": {
      const colors: Array<[string[], string]> = [
        [["черн", "black"], "Черный"],
        [["бел", "white"], "Белый"],
        [["красн", "red"], "Красный"],
        [["син", "blue"], "Синий"],
        [["зелен", "green"], "Зеленый"],
        [["розов", "pink"], "Розовый"],
        [["прозрач", "transparent", "clear"], "Прозрачный"],
        [["сер", "gray", "grey"], "Серый"],
        [["золот", "gold"], "Золотой"],
        [["сереб", "silver"], "Серебристый"],
        [["желт", "yellow"], "Желтый"],
        [["фиолет", "purple", "violet"], "Фиолетовый"],
      ];
      value = colors.find(([tokens]) => textIncludes(searchText, tokens))?.[1] ?? null;
      break;
    }
    case "material": {
      const materials: Array<[string[], string]> = [
        [["силикон", "silicone"], "Силикон"],
        [["пластик", "plastic", "polycarbonate", "поликарбонат"], "Пластик"],
        [["кожа", "leather"], "Кожа"],
        [["стекло", "glass"], "Стекло"],
        [["металл", "metal", "aluminum", "алюмин"], "Металл"],
        [["резин", "rubber"], "Резина"],
        [["ткан", "fabric", "textile"], "Текстиль"],
      ];
      value = materials.find(([tokens]) => textIncludes(searchText, tokens))?.[1] ?? null;
      break;
    }
    case "compatibility":
      if (
        textIncludes(searchText, [
          "чехол",
          "защитное стекло",
          "смартфон",
          "телефон",
          "phone",
          "case",
        ])
      ) {
        value = "Смартфон";
      }
      break;
    case "design":
      if (textIncludes(searchText, ["cs go", "csgo", "pubg", "minecraft", "игр", "gaming", "game"])) {
        value = "Игровой принт";
      } else if (textIncludes(searchText, ["принт", "рисунок", "pattern"])) {
        value = "Принт";
      }
      break;
    case "features":
      if (textIncludes(searchText, ["чехол", "case", "кейс"])) {
        value = "Вырез под камеру";
      } else if (textIncludes(searchText, ["защитное стекло", "стекло", "glass"])) {
        value = "Защита экрана";
      } else if (textIncludes(searchText, ["кабель", "cable", "usb"])) {
        value = "Для подключения устройства";
      }
      break;
    case "purpose":
      if (textIncludes(searchText, ["чехол", "case", "кейс"])) {
        value = "Защита смартфона";
      } else if (textIncludes(searchText, ["защитное стекло", "стекло", "glass"])) {
        value = "Защита экрана смартфона";
      } else if (textIncludes(searchText, ["кабель", "cable", "usb"])) {
        value = "Зарядка и передача данных";
      } else if (textIncludes(searchText, ["заряд", "адаптер", "charger", "adapter"])) {
        value = "Зарядка устройства";
      } else if (textIncludes(searchText, ["наушник", "гарнитур", "headphone", "earphone"])) {
        value = "Прослушивание аудио";
      }
      break;
  }

  return value ? matchProductSpecOption(value, input.options) : null;
};

const toErrorMessage = (error: unknown) => {
  if (error instanceof AppError) {
    return error.message;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "aiGenerationFailed";
};

export const generateProductContent = async (input: GenerateProductContentInput) => {
  const mode = input.mode ?? "overwrite";
  const overwriteDescription = input.overwriteDescription ?? mode === "overwrite";
  const overwriteSpecs = input.overwriteSpecs ?? mode === "overwrite";
  const imageUrls = Array.from(
    new Set((input.imageUrls ?? []).map((url) => url.trim()).filter(Boolean)),
  );
  const locale = normalizeLocale(input.locale) ?? defaultLocale;
  const previousDescription = input.product.description?.trim() ?? "";

  let description:
    | { status: "generated" | "overwritten"; value: string; reason: null }
    | { status: "skipped" | "failed"; value: null; reason: string } = {
    status: "skipped",
    value: null,
    reason: "descriptionGenerationDisabled",
  };

  if (input.generateDescription !== false) {
    if (previousDescription && !overwriteDescription) {
      description = { status: "skipped", value: null, reason: "descriptionAlreadyExists" };
    } else if (!imageUrls.length) {
      description = { status: "skipped", value: null, reason: "aiDescriptionImageRequired" };
    } else {
      try {
        const result = await generateProductDescriptionFromImages({
          name: input.product.name,
          category: input.category,
          isBundle: input.product.isBundle,
          locale,
          imageUrls,
          logger: input.logger,
        });
        const nextDescription = result.description.trim();
        description =
          nextDescription && nextDescription !== previousDescription
            ? {
                status: previousDescription ? "overwritten" : "generated",
                value: nextDescription,
                reason: null,
              }
            : { status: "skipped", value: null, reason: "aiDescriptionGenerationSkipped" };
      } catch (error) {
        description = { status: "failed", value: null, reason: toErrorMessage(error) };
      }
    }
  }

  const requestedSpecs = (input.requestedSpecs ?? []).filter(
    (spec) => spec.kind && !isDescriptionLikeSpec({ labelRu: spec.labelRu, attributeKey: spec.key }),
  );
  const generatedSpecs: GeneratedProductContentSpec[] = [];
  let specsError: string | null = null;
  let skippedExistingSpecs = 0;

  if (input.generateSpecs !== false && requestedSpecs.length) {
    const specsNeedingImage = requestedSpecs.filter(
      (spec) =>
        !spec.existingValue?.trim() || overwriteSpecs,
    );
    const aiRequestedSpecs = specsNeedingImage.filter(
      (spec) => spec.kind !== "manufacturer" && spec.kind !== "model",
    );
    let imageSuggestions: Partial<Record<ProductContentSpecKind, string>> = {};
    if (aiRequestedSpecs.length && imageUrls.length) {
      try {
        const result = await suggestProductSpecsFromImages({
          imageUrls,
          requestedSpecs: aiRequestedSpecs.map((spec) => ({
            kind: spec.kind as Exclude<ProductContentSpecKind, "manufacturer" | "model">,
            labelRu: spec.labelRu,
            options: spec.options,
          })),
          logger: input.logger,
        });
        imageSuggestions = result.suggestions;
      } catch (error) {
        specsError = toErrorMessage(error);
      }
    }

    for (const spec of requestedSpecs) {
      if (spec.existingValue?.trim() && !overwriteSpecs) {
        skippedExistingSpecs += 1;
        continue;
      }

      const imageValue = imageSuggestions[spec.kind];
      const metadataValue = inferProductSpecValueFromMetadata({
        kind: spec.kind,
        product: input.product,
        category: input.category,
        options: spec.options,
      });
      const value = imageValue
        ? matchProductSpecOption(imageValue, spec.options)
        : metadataValue;
      const cleaned = value ? cleanSpecValue(value) : "";
      if (!cleaned || isDescriptionLikeSpec({ labelRu: cleaned })) {
        continue;
      }

      generatedSpecs.push({
        key: spec.key,
        labelRu: spec.labelRu,
        kind: spec.kind,
        value: cleaned,
        source: imageValue ? "image" : spec.kind === "manufacturer" || spec.kind === "model" ? "product" : "metadata",
      });
    }
  }

  const specs =
    input.generateSpecs === false
      ? ({
          status: "skipped" as const,
          values: [] as GeneratedProductContentSpec[],
          reason: "specGenerationDisabled",
          skippedExistingCount: 0,
        })
      : generatedSpecs.length
        ? ({
            status:
              generatedSpecs.some((spec) =>
                requestedSpecs.find((requested) => requested.key === spec.key)?.existingValue,
              ) && overwriteSpecs
                ? ("overwritten" as const)
                : ("generated" as const),
            values: generatedSpecs,
            reason: null,
            skippedExistingCount: skippedExistingSpecs,
          })
        : ({
            status: specsError && specsError !== "aiSpecNoUsableImages" ? ("failed" as const) : ("skipped" as const),
            values: [] as GeneratedProductContentSpec[],
            reason:
              skippedExistingSpecs > 0 && skippedExistingSpecs === requestedSpecs.length
                ? "specsAlreadyExist"
                : specsError === "aiSpecNoUsableImages"
                  ? "aiSpecNoUsableImages"
                  : specsError ?? "noResolvedSpecValues",
            skippedExistingCount: skippedExistingSpecs,
          });

  return {
    description,
    specs,
    meta: {
      locale,
      mode,
      imageCount: imageUrls.length,
      integrationContext: input.integrationContext ?? null,
    },
  };
};

"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { z } from "zod";
import { useFieldArray, useForm, useWatch, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Cropper, { type Area } from "react-easy-crop";

import { ProductSearchResultItem } from "@/components/product-search-result-item";
import { ProductEditorCard, ProductEditorFieldGrid } from "@/components/product-editor-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormActions, FormGrid, FormRow, FormSection } from "@/components/form-layout";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import {
  AddIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CloseIcon,
  DeleteIcon,
  EditIcon,
  GripIcon,
  ImagePlusIcon,
  RestoreIcon,
  SparklesIcon,
  StatusSuccessIcon,
  ViewIcon,
} from "@/components/icons";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { buildVariantMatrix, type VariantGeneratorAttribute } from "@/lib/variantGenerator";
import {
  convertFromKgs,
  convertToKgs,
  normalizeCurrencyCode,
  normalizeCurrencyRateKgsPerUnit,
} from "@/lib/currency";
import {
  ProductImageUploadTimeoutError,
  fetchProductImageDirectUploadTarget,
  fetchProductImageUpload,
  normalizeImageMimeType,
  prepareProductImageFileForUpload,
  putProductImageDirectUpload,
  resolveProductImageDirectUploadTimeoutMs,
  resolveProductImageProxyUploadMaxBytes,
  resolvePrimaryImageUrl,
  type ProductImageDirectUploadTarget,
} from "@/lib/productImageUpload";
import { defaultLocale, normalizeLocale } from "@/lib/locales";
import { normalizeScanValue } from "@/lib/scanning/normalize";

const showProductPacksSection = false;

export type ProductFormValues = {
  sku: string;
  name: string;
  isBundle?: boolean;
  category?: string;
  categories?: string[];
  baseUnitId: string;
  basePriceKgs?: number;
  purchasePriceKgs?: number;
  avgCostKgs?: number;
  initialOnHand?: number;
  minStock?: number;
  description?: string;
  photoUrl?: string;
  images?: {
    id?: string;
    url: string;
    position?: number;
  }[];
  barcodes: string[];
  packs: {
    id?: string;
    packName: string;
    packBarcode?: string;
    multiplierToBase: number;
    allowInPurchasing: boolean;
    allowInReceiving: boolean;
  }[];
  variants: {
    id?: string;
    imageId?: string | null;
    imageUrl?: string | null;
    image?: {
      id: string;
      url: string;
      position: number;
    } | null;
    name?: string;
    sku?: string;
    initialOnHand?: number;
    attributes: Record<string, unknown>;
    canDelete?: boolean;
  }[];
  bundleComponents?: {
    componentProductId: string;
    componentVariantId?: string | null;
    qty: number;
    componentName?: string;
    componentSku?: string;
  }[];
};

type UnitOption = {
  id: string;
  code: string;
  labelRu: string;
  labelKg: string;
};

type AttributeDefinition = {
  id: string;
  key: string;
  labelRu: string;
  labelKg: string;
  type: "TEXT" | "NUMBER" | "SELECT" | "MULTI_SELECT";
  optionsRu?: unknown;
  optionsKg?: unknown;
  required?: boolean | null;
};

type PendingImageUploadStatus =
  | "selected"
  | "validating"
  | "optimizing"
  | "uploading"
  | "uploaded"
  | "failed";

type PendingImageUpload = {
  id: string;
  file: File;
  previewUrl: string;
  fileName: string;
  status: PendingImageUploadStatus;
  progress: number | null;
  error: string | null;
  uploadedUrl?: string;
};

type VariantImageUploadTarget =
  | { type: "variant"; index: number }
  | { type: "draftValue"; valueKey: string };

const defaultProductImageMaxBytes = 5 * 1024 * 1024;
const defaultProductImageMaxInputBytes = 32 * 1024 * 1024;
const productImageAccept = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heics",
  ".heif",
  ".heifs",
  ".hif",
].join(",");

const resolveClientImageMaxBytes = () => {
  const parsed = Number(process.env.NEXT_PUBLIC_PRODUCT_IMAGE_MAX_BYTES);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return defaultProductImageMaxBytes;
};

const resolveClientImageMaxInputBytes = (maxImageBytes: number) => {
  const parsed = Number(process.env.NEXT_PUBLIC_PRODUCT_IMAGE_MAX_INPUT_BYTES);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.max(Math.trunc(parsed), defaultProductImageMaxInputBytes, maxImageBytes);
  }
  return Math.max(defaultProductImageMaxInputBytes, maxImageBytes);
};

const resolveClientImageUploadConcurrency = () => {
  const parsed = Number(process.env.NEXT_PUBLIC_PRODUCT_IMAGE_UPLOAD_CONCURRENCY);
  if (Number.isFinite(parsed) && parsed >= 1) {
    return Math.min(6, Math.max(1, Math.trunc(parsed)));
  }
  return 2;
};

const createPendingImageUploadId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `upload-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const isPhotoUrlValid = (value?: string | null) => {
  const normalized = value?.trim();
  if (!normalized) {
    return true;
  }
  if (normalized.startsWith("/uploads/")) {
    return true;
  }
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const normalizeCategoryName = (value?: string | null) => {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized : null;
};

const normalizeCategoryKey = (value?: string | null) => {
  const normalized = normalizeCategoryName(value);
  return normalized ? normalized.toLocaleLowerCase("ru-RU") : null;
};

const normalizeVariantOptionLabel = (value?: string | null) => {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized : "";
};

const normalizeVariantOptionValueKey = (value?: string | null) =>
  normalizeVariantOptionLabel(value).toLocaleLowerCase("ru-RU");

const getFirstFormErrorMessage = (error: unknown): string | null => {
  if (!error || typeof error !== "object") {
    return null;
  }
  const maybeMessage = (error as { message?: unknown }).message;
  if (typeof maybeMessage === "string" && maybeMessage.trim()) {
    return maybeMessage;
  }
  if (Array.isArray(error)) {
    for (const item of error) {
      const message = getFirstFormErrorMessage(item);
      if (message) {
        return message;
      }
    }
    return null;
  }
  for (const value of Object.values(error)) {
    const message = getFirstFormErrorMessage(value);
    if (message) {
      return message;
    }
  }
  return null;
};

const VariantImageOptionPreview = ({ url, label }: { url: string; label: string }) => (
  <span className="inline-flex min-w-0 items-center gap-3">
    <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="max-h-full max-w-full object-contain" />
    </span>
    <span className="truncate">{label}</span>
  </span>
);

const parseVariantOptionValues = (value?: string | null) =>
  (value ?? "")
    .split(/[,;\n]/)
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter(Boolean);

const mergeVariantOptionValues = (currentValues: string[], nextValues: string[]) => {
  const seen = new Set(currentValues.map((value) => value.toLocaleLowerCase("ru-RU")));
  const merged = [...currentValues];
  nextValues.forEach((value) => {
    const normalized = normalizeVariantOptionLabel(value);
    const key = normalized.toLocaleLowerCase("ru-RU");
    if (!normalized || seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push(normalized);
  });
  return merged;
};

const replaceFileExtension = (fileName: string, extension: string) => {
  if (!fileName.includes(".")) {
    return `${fileName}.${extension}`;
  }
  return fileName.replace(/\.[^.]+$/, `.${extension}`);
};

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

const getRotatedBoundingBox = (width: number, height: number, rotation: number) => {
  const radians = toRadians(rotation);
  return {
    width: Math.abs(Math.cos(radians) * width) + Math.abs(Math.sin(radians) * height),
    height: Math.abs(Math.sin(radians) * width) + Math.abs(Math.cos(radians) * height),
  };
};

const resolveImageExtensionByMime = (mimeType: string) => {
  const normalizedMimeType = normalizeImageMimeType(mimeType);
  if (normalizedMimeType === "image/png") {
    return "png";
  }
  if (normalizedMimeType === "image/heic") {
    return "heic";
  }
  if (normalizedMimeType === "image/heif") {
    return "heif";
  }
  if (normalizedMimeType === "image/webp") {
    return "webp";
  }
  if (normalizedMimeType === "image/gif") {
    return "gif";
  }
  if (normalizedMimeType === "image/avif") {
    return "avif";
  }
  if (normalizedMimeType === "image/bmp") {
    return "bmp";
  }
  if (normalizedMimeType === "image/tiff") {
    return "tiff";
  }
  return "jpg";
};

const resolveImageMimeTypeByExtension = (extension: string) => {
  const normalized = extension.toLowerCase();
  if (normalized === "jpg" || normalized === "jpeg") {
    return "image/jpeg";
  }
  if (normalized === "png") {
    return "image/png";
  }
  if (normalized === "webp") {
    return "image/webp";
  }
  if (normalized === "avif") {
    return "image/avif";
  }
  if (normalized === "gif") {
    return "image/gif";
  }
  if (normalized === "bmp") {
    return "image/bmp";
  }
  if (normalized === "tif" || normalized === "tiff") {
    return "image/tiff";
  }
  if (normalized === "svg") {
    return "image/svg+xml";
  }
  if (normalized === "heic" || normalized === "heics") {
    return "image/heic";
  }
  if (normalized === "heif" || normalized === "heifs" || normalized === "hif") {
    return "image/heif";
  }
  return "";
};

const resolveImageMimeTypeFromUrl = (sourceUrl: string) => {
  try {
    const parsed = new URL(sourceUrl, "https://local.invalid");
    const rawExt = parsed.pathname.split(".").pop()?.trim().toLowerCase() ?? "";
    if (!rawExt) {
      return "";
    }
    return resolveImageMimeTypeByExtension(rawExt);
  } catch {
    return "";
  }
};

const inferImageMimeTypeFromBytes = (bytes: Uint8Array) => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return "image/gif";
  }
  return "";
};

const minimumProductBarcodeLength = 4;
const normalizeProductBarcodeInput = (value?: string | null) => normalizeScanValue(value ?? "");
const normalizeProductBarcodes = (values?: string[] | null) =>
  Array.from(
    new Set((values ?? []).map((value) => normalizeProductBarcodeInput(value)).filter(Boolean)),
  );
const normalizeSkuToken = (value?: string | null) =>
  (value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const preventInvalidIntegerInput = (event: KeyboardEvent<HTMLInputElement>) => {
  if (["-", "+", "e", "E", ".", ","].includes(event.key)) {
    event.preventDefault();
  }
};

const resolveHeicLikeMimeType = (file: File) => {
  const normalizedType = normalizeImageMimeType(file.type);
  if (normalizedType === "image/heic" || normalizedType === "image/heif") {
    return normalizedType;
  }
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "heic" || ext === "heics") {
    return "image/heic";
  }
  if (ext === "heif" || ext === "heifs" || ext === "hif") {
    return "image/heif";
  }
  return "";
};

const resolveDefaultUnitId = (options: UnitOption[]) => {
  const preferred = options.find((unit) => {
    const haystack = [unit.code, unit.labelRu, unit.labelKg]
      .map((value) => value.trim().toLowerCase())
      .join(" ");
    return (
      haystack.includes("шт") ||
      haystack.includes("шту") ||
      haystack.includes("pcs") ||
      haystack.includes("piece") ||
      haystack.includes("pc")
    );
  });
  return preferred?.id ?? options[0]?.id ?? "";
};

export const ProductForm = ({
  initialValues,
  onSubmit,
  isSubmitting,
  attributeDefinitions,
  units,
  readOnly = false,
  productId,
  showBasePriceField = true,
  currencyCode,
  currencyRateKgsPerUnit,
  quickCreateMode = false,
  shopifyEditorLayout = false,
  formId,
  hideActions = false,
  canEditInitialStock = true,
  enableSku = true,
  enableBarcode = true,
  enableSimilarProductCheck = true,
  categoryStoreId,
  onDirtyChange,
  savedRevision,
}: {
  initialValues: ProductFormValues;
  onSubmit: (values: ProductFormValues) => void;
  isSubmitting?: boolean;
  attributeDefinitions?: AttributeDefinition[];
  units?: UnitOption[];
  readOnly?: boolean;
  productId?: string;
  showBasePriceField?: boolean;
  currencyCode?: string | null;
  currencyRateKgsPerUnit?: number | string | null;
  quickCreateMode?: boolean;
  shopifyEditorLayout?: boolean;
  formId?: string;
  hideActions?: boolean;
  canEditInitialStock?: boolean;
  enableSku?: boolean;
  enableBarcode?: boolean;
  enableSimilarProductCheck?: boolean;
  categoryStoreId?: string | null;
  onDirtyChange?: (isDirty: boolean) => void;
  savedRevision?: number;
}) => {
  const t = useTranslations("products");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { toast } = useToast();
  const compactCreate = quickCreateMode && !productId && !readOnly;
  const shopifyEditor = shopifyEditorLayout || compactCreate;
  const moneyCurrencyCode = normalizeCurrencyCode(currencyCode);
  const moneyCurrencyRateKgsPerUnit = normalizeCurrencyRateKgsPerUnit(
    currencyRateKgsPerUnit,
    moneyCurrencyCode,
  );
  const displayMoneyFromKgs = (value?: number | null) =>
    value === null || value === undefined
      ? undefined
      : convertFromKgs(value, moneyCurrencyRateKgsPerUnit, moneyCurrencyCode);
  const submitMoneyToKgs = (value?: number | null) =>
    Number.isFinite(value ?? NaN)
      ? convertToKgs(value as number, moneyCurrencyRateKgsPerUnit, moneyCurrencyCode)
      : undefined;
  const definitions = useMemo(() => attributeDefinitions ?? [], [attributeDefinitions]);
  const definitionMap = useMemo(
    () => new Map(definitions.map((definition) => [definition.key, definition])),
    [definitions],
  );
  const requiredDefinitions = useMemo(
    () => definitions.filter((definition) => definition.required),
    [definitions],
  );

  const resolveLabel = useCallback(
    (definition?: AttributeDefinition, fallbackKey?: string) => {
      if (!definition) {
        return fallbackKey ?? "";
      }
      return locale === "kg" ? definition.labelKg : definition.labelRu;
    },
    [locale],
  );

  const resolveVariantOptionDefinition = useCallback(
    (value?: string | null) => {
      const normalized = normalizeVariantOptionValueKey(value);
      if (!normalized) {
        return undefined;
      }
      return definitions.find((definition) =>
        [definition.key, definition.labelRu, definition.labelKg].some(
          (candidate) => normalizeVariantOptionValueKey(candidate) === normalized,
        ),
      );
    },
    [definitions],
  );

  const resolveVariantOptionKey = useCallback(
    (value?: string | null) =>
      resolveVariantOptionDefinition(value)?.key ?? normalizeVariantOptionLabel(value),
    [resolveVariantOptionDefinition],
  );

  const resolveVariantOptionDisplayName = useCallback(
    (value?: string | null) => {
      const optionKey = resolveVariantOptionKey(value);
      return resolveLabel(definitionMap.get(optionKey), optionKey);
    },
    [definitionMap, resolveLabel, resolveVariantOptionKey],
  );

  const resolveOptions = (definition?: AttributeDefinition) => {
    if (!definition) {
      return [] as string[];
    }
    const options = locale === "kg" ? definition.optionsKg : definition.optionsRu;
    return Array.isArray(options) ? options : [];
  };
  const unitOptions = useMemo(() => units ?? [], [units]);
  const resolveUnitLabel = (unit: UnitOption) => (locale === "kg" ? unit.labelKg : unit.labelRu);
  const schema = useMemo(() => {
    const optionalPrice = z.preprocess(
      (value) => (value === "" || value === null || value === undefined ? undefined : value),
      z.coerce.number().min(0, t("priceNonNegative")).optional(),
    );
    const optionalStockQty = z.preprocess(
      (value) => (value === "" || value === null || value === undefined ? undefined : value),
      z.coerce.number().int(t("stockNonNegative")).min(0, t("stockNonNegative")).optional(),
    );

    return z
      .object({
        sku: z.string(),
        name: z.string().min(2, t("nameRequired")),
        isBundle: z.boolean().optional(),
        categories: z.array(z.string()).optional(),
        baseUnitId: z.string().min(1, t("unitRequired")),
        basePriceKgs: optionalPrice,
        purchasePriceKgs: optionalPrice,
        avgCostKgs: optionalPrice,
        initialOnHand: optionalStockQty,
        minStock: optionalStockQty,
        description: z.string().optional(),
        photoUrl: z
          .string()
          .optional()
          .refine((value) => isPhotoUrlValid(value), t("photoUrlInvalid")),
        images: z
          .array(
            z.object({
              id: z.string().optional(),
              url: z.string().min(1, t("imageUrlRequired")),
              position: z.number().int().optional(),
            }),
          )
          .optional(),
        barcodes: z.array(z.string()).optional(),
        packs: z
          .array(
            z.object({
              id: z.string().optional(),
              packName: z.string().min(1, t("packNameRequired")),
              packBarcode: z.string().optional().nullable(),
              multiplierToBase: z.coerce.number().int().positive(t("packMultiplierRequired")),
              allowInPurchasing: z.boolean().optional(),
              allowInReceiving: z.boolean().optional(),
            }),
          )
          .optional(),
        variants: z.array(
          z.object({
            id: z.string().optional(),
            imageId: z.string().optional().nullable(),
            imageUrl: z.string().optional().nullable(),
            name: z.string().optional(),
            sku: z.string().optional(),
            initialOnHand: optionalStockQty,
            attributes: z
              .array(
                z.object({
                  key: z.string().min(1, tErrors("validationError")),
                  value: z.unknown().optional(),
                }),
              )
              .optional(),
            canDelete: z.boolean().optional(),
          }),
        ),
        bundleComponents: z
          .array(
            z.object({
              componentProductId: z.string().min(1, t("bundleSelectComponent")),
              componentVariantId: z.string().optional().nullable(),
              qty: z.coerce.number().int().positive(t("bundleQtyPositive")),
              componentName: z.string().optional(),
              componentSku: z.string().optional(),
            }),
          )
          .optional(),
      })
      .superRefine((values, context) => {
        const normalizedSku = values.sku.trim();
        if (enableSku) {
          if (productId) {
            if (normalizedSku.length < 2) {
              context.addIssue({
                code: z.ZodIssueCode.custom,
                message: normalizedSku.length === 0 ? t("skuRequired") : t("skuMinLength"),
                path: ["sku"],
              });
            }
          } else if (normalizedSku.length > 0 && normalizedSku.length < 2) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: t("skuMinLength"),
              path: ["sku"],
            });
          }
        }
        if (!enableBarcode) {
          return;
        }
        const normalizedBarcodes = (values.barcodes ?? [])
          .map((value) => normalizeProductBarcodeInput(value))
          .filter(Boolean);
        const shortBarcode = normalizedBarcodes.find(
          (value) => value.length < minimumProductBarcodeLength,
        );
        if (shortBarcode) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: t("barcodeTooShort", { min: minimumProductBarcodeLength }),
            path: ["barcodes"],
          });
        }
        if (new Set(normalizedBarcodes).size !== normalizedBarcodes.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: t("barcodeDuplicate"),
            path: ["barcodes"],
          });
        }
      });
  }, [enableBarcode, enableSku, productId, t, tErrors]);
  type VariantFormRow = z.infer<typeof schema>["variants"][number];

  const toAttributeEntries = (attributes: Record<string, unknown>) => {
    const entries = Object.entries(attributes ?? {}).map(([key, value]) => ({
      key,
      value: Array.isArray(value)
        ? value.filter((item) => typeof item === "string").map((item) => item.trim())
        : (value ?? ""),
    }));
    const seen = new Set(entries.map((entry) => entry.key));
    for (const definition of requiredDefinitions) {
      if (!seen.has(definition.key)) {
        entries.push({
          key: definition.key,
          value: definition.type === "MULTI_SELECT" ? [] : "",
        });
      }
    }
    return entries;
  };

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      sku: initialValues.sku,
      name: initialValues.name,
      isBundle: initialValues.isBundle ?? false,
      categories:
        initialValues.categories ??
        (initialValues.category?.trim() ? [initialValues.category.trim()] : []),
      baseUnitId: initialValues.baseUnitId,
      basePriceKgs: displayMoneyFromKgs(initialValues.basePriceKgs),
      purchasePriceKgs: displayMoneyFromKgs(initialValues.purchasePriceKgs),
      avgCostKgs: displayMoneyFromKgs(initialValues.avgCostKgs),
      initialOnHand: initialValues.initialOnHand,
      minStock: initialValues.minStock,
      description: initialValues.description ?? "",
      photoUrl: initialValues.photoUrl ?? "",
      images: initialValues.images ?? [],
      barcodes: normalizeProductBarcodes(initialValues.barcodes),
      packs: initialValues.packs ?? [],
      variants:
        initialValues.variants.length > 0
          ? initialValues.variants.map((variant) => ({
              id: variant.id,
              imageId: variant.imageId ?? variant.image?.id ?? null,
              imageUrl: variant.image?.url ?? variant.imageUrl ?? "",
              name: variant.name ?? "",
              sku: variant.sku ?? "",
              initialOnHand: variant.initialOnHand,
              attributes: toAttributeEntries(variant.attributes ?? {}),
              canDelete: variant.canDelete ?? true,
            }))
          : [
              {
                id: undefined,
                imageId: null,
                imageUrl: "",
                name: "",
                sku: "",
                initialOnHand: undefined,
                attributes: toAttributeEntries({}),
                canDelete: true,
              },
            ],
      bundleComponents:
        initialValues.bundleComponents?.map((component) => ({
          componentProductId: component.componentProductId,
          componentVariantId: component.componentVariantId ?? null,
          qty: component.qty,
          componentName: component.componentName,
          componentSku: component.componentSku,
        })) ?? [],
    },
  });
  const formIsDirty = form.formState.isDirty;
  const savedRevisionRef = useRef(savedRevision);

  useEffect(() => {
    onDirtyChange?.(formIsDirty);
  }, [formIsDirty, onDirtyChange]);

  useEffect(() => {
    if (savedRevision === undefined || savedRevisionRef.current === savedRevision) {
      return;
    }

    savedRevisionRef.current = savedRevision;
    form.reset(form.getValues());
    onDirtyChange?.(false);
  }, [form, onDirtyChange, savedRevision]);

  useEffect(() => {
    if (!form.getValues("baseUnitId") && unitOptions.length) {
      form.setValue("baseUnitId", resolveDefaultUnitId(unitOptions), { shouldValidate: true });
    }
  }, [form, unitOptions]);

  const [categoryDraft, setCategoryDraft] = useState("");
  const [showHiddenCategoryOptions, setShowHiddenCategoryOptions] = useState(false);
  const watchedCategoryValues = useWatch({ control: form.control, name: "categories" });
  const watchedSku = useWatch({ control: form.control, name: "sku" });
  const watchedName = useWatch({ control: form.control, name: "name" });
  const watchedBarcodesValue = useWatch({ control: form.control, name: "barcodes" });
  const categoryValues = useMemo(() => watchedCategoryValues ?? [], [watchedCategoryValues]);
  const categoryValueKeys = useMemo(
    () => new Set(categoryValues.map((value) => normalizeCategoryKey(value)).filter(Boolean)),
    [categoryValues],
  );
  const watchedBarcodes = useMemo(() => watchedBarcodesValue ?? [], [watchedBarcodesValue]);
  const primaryCategoryValue = categoryValues[0]?.trim() ?? "";
  const categoryOptionsQuery = trpc.productCategories.listForStore.useQuery(
    { storeId: categoryStoreId ?? "", includeHidden: true },
    {
      enabled: !readOnly && Boolean(categoryStoreId),
    },
  );
  const templateQuery = trpc.categoryTemplates.list.useQuery(
    { category: primaryCategoryValue },
    { enabled: !readOnly && Boolean(primaryCategoryValue) },
  );
  const categoryOptions = useMemo(() => {
    const categories = new Map<
      string,
      {
        name: string;
        productCount: number;
        isVisibleInForms: boolean;
        isArchived: boolean;
      }
    >();

    (categoryOptionsQuery.data ?? []).forEach((item) => {
      const normalized = normalizeCategoryName(item.name);
      const key = normalizeCategoryKey(item.name);
      if (!normalized || !key) {
        return;
      }
      categories.set(key, {
        name: normalized,
        productCount: item.productCount,
        isVisibleInForms: item.isVisibleInForms,
        isArchived: item.isArchived,
      });
    });

    categoryValues.forEach((value) => {
      const normalized = normalizeCategoryName(value);
      const key = normalizeCategoryKey(value);
      if (!normalized || !key || categories.has(key)) {
        return;
      }
      categories.set(key, {
        name: normalized,
        productCount: 0,
        isVisibleInForms: true,
        isArchived: false,
      });
    });

    return Array.from(categories.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [categoryOptionsQuery.data, categoryValues]);
  const categoryDraftQuery = useDeferredValue(categoryDraft.trim().toLocaleLowerCase("ru-RU"));
  const showHiddenCategoryCount = useMemo(
    () =>
      categoryOptions.filter(
        (option) =>
          !categoryValueKeys.has(normalizeCategoryKey(option.name)) &&
          (!option.isVisibleInForms || option.isArchived),
      ).length,
    [categoryOptions, categoryValueKeys],
  );
  const matchingCategoryOptions = useMemo(
    () =>
      categoryOptions.filter((option) => {
        const key = normalizeCategoryKey(option.name);
        if (!key || categoryValueKeys.has(key)) {
          return false;
        }
        if ((!option.isVisibleInForms || option.isArchived) && !showHiddenCategoryOptions) {
          return false;
        }
        if (
          categoryDraftQuery &&
          !option.name.toLocaleLowerCase("ru-RU").includes(categoryDraftQuery)
        ) {
          return false;
        }
        return true;
      }),
    [categoryDraftQuery, categoryOptions, categoryValueKeys, showHiddenCategoryOptions],
  );
  const suggestedCategoryOptions = useMemo(
    () => matchingCategoryOptions.slice(0, 12),
    [matchingCategoryOptions],
  );
  const categoryMetaByKey = useMemo(() => {
    const map = new Map<string, (typeof categoryOptions)[number]>();
    categoryOptions.forEach((option) => {
      const key = normalizeCategoryKey(option.name);
      if (key) {
        map.set(key, option);
      }
    });
    return map;
  }, [categoryOptions]);
  const setProductCategories = (values: string[]) => {
    form.setValue("categories", values, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
  };
  const addProductCategory = (rawValue: string) => {
    const normalized = normalizeCategoryName(rawValue);
    if (!normalized) {
      return false;
    }
    const key = normalizeCategoryKey(normalized);
    if (key && categoryValueKeys.has(key)) {
      return true;
    }
    setProductCategories([...categoryValues, normalized]);
    return true;
  };
  const removeProductCategory = (value: string) => {
    setProductCategories(categoryValues.filter((item) => item !== value));
  };
  const promoteProductCategory = (value: string) => {
    if (!categoryValues.includes(value) || categoryValues[0] === value) {
      return;
    }
    setProductCategories([value, ...categoryValues.filter((item) => item !== value)]);
  };
  const templateKeys = useMemo(() => {
    return (templateQuery.data ?? [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((item) => item.attributeKey);
  }, [templateQuery.data]);
  const generatorDefinitions = useMemo(
    () =>
      definitions.filter(
        (definition) => definition.type === "SELECT" || definition.type === "MULTI_SELECT",
      ),
    [definitions],
  );
  const generatorDefinitionMap = useMemo(
    () => new Map(generatorDefinitions.map((definition) => [definition.key, definition])),
    [generatorDefinitions],
  );

  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: "variants",
  });
  const watchedVariantsValue = useWatch({ control: form.control, name: "variants" });
  const watchedVariants = useMemo(() => watchedVariantsValue ?? [], [watchedVariantsValue]);

  const collectUsedVariantSkus = (excludeIndex?: number) =>
    new Set(
      (form.getValues("variants") ?? [])
        .map((variant, index) => (index === excludeIndex ? "" : normalizeSkuToken(variant.sku)))
        .filter(Boolean),
    );

  const generateNextVariantSku = (usedSkus = collectUsedVariantSkus()) => {
    if (!enableSku) {
      return "";
    }
    const base =
      normalizeSkuToken(form.getValues("sku")) ||
      normalizeSkuToken(form.getValues("name")) ||
      "VAR";
    for (let counter = 1; counter <= 9999; counter += 1) {
      const candidate = `${base}-V${String(counter).padStart(2, "0")}`;
      if (!usedSkus.has(candidate)) {
        usedSkus.add(candidate);
        return candidate;
      }
    }
    const fallback = `${base}-V${Date.now().toString(36).toUpperCase()}`;
    usedSkus.add(fallback);
    return fallback;
  };

  const {
    fields: imageFields,
    append: appendImageField,
    remove: removeImageField,
    move: moveImageField,
  } = useFieldArray({
    control: form.control,
    name: "images",
    keyName: "fieldId",
  });
  const watchedImagesValue = useWatch({ control: form.control, name: "images" });
  const watchedPhotoUrl = useWatch({ control: form.control, name: "photoUrl" });
  const watchedImages = useMemo(() => watchedImagesValue ?? [], [watchedImagesValue]);
  const orderedImageUrls = useMemo(
    () =>
      imageFields
        .map((image, index) => ({
          id: image.id,
          url: watchedImages[index]?.url?.trim() || image.url?.trim() || "",
        }))
        .filter((image) => image.url.length > 0),
    [imageFields, watchedImages],
  );
  const descriptionSourceImageUrls = useMemo(() => {
    const directImages = orderedImageUrls
      .map((image) => image.url.trim())
      .filter((url) => url.length > 0);
    if (directImages.length) {
      return directImages;
    }
    const fallbackPhotoUrl = watchedPhotoUrl?.trim() ?? "";
    return fallbackPhotoUrl ? [fallbackPhotoUrl] : [];
  }, [orderedImageUrls, watchedPhotoUrl]);
  const persistedProductImageIds = useMemo(
    () =>
      new Set(
        (initialValues.images ?? [])
          .map((image) => image.id?.trim())
          .filter((id): id is string => Boolean(id)),
      ),
    [initialValues.images],
  );
  const variantImageOptions = useMemo(() => {
    const fromImages =
      watchedImages
        ?.map((image, index) => {
          const url = image.url?.trim() ?? "";
          if (!url || url.startsWith("data:image/")) {
            return null;
          }
          const imageId = image.id?.trim() || undefined;
          const persistedImageId =
            imageId && persistedProductImageIds.has(imageId) ? imageId : undefined;
          return {
            value: persistedImageId ? `id:${persistedImageId}` : `url:${url}`,
            imageId: persistedImageId,
            url,
            label: t("variantImageOption", { index: index + 1 }),
          };
        })
        .filter((image): image is NonNullable<typeof image> => Boolean(image)) ?? [];
    if (fromImages.length) {
      return fromImages;
    }
    const fallbackPhotoUrl = watchedPhotoUrl?.trim() ?? "";
    return fallbackPhotoUrl && !fallbackPhotoUrl.startsWith("data:image/")
      ? [
          {
            value: `url:${fallbackPhotoUrl}`,
            imageId: undefined,
            url: fallbackPhotoUrl,
            label: t("imagePrimary"),
          },
        ]
      : [];
  }, [persistedProductImageIds, t, watchedImages, watchedPhotoUrl]);
  const variantImageOptionByValue = useMemo(
    () => new Map(variantImageOptions.map((option) => [option.value, option])),
    [variantImageOptions],
  );
  const hasVariantImageOptions = variantImageOptions.length > 0;
  const resolveVariantImageValue = (variant: {
    imageId?: string | null;
    imageUrl?: string | null;
  }) => {
    const imageId = variant.imageId?.trim();
    if (imageId) {
      return `id:${imageId}`;
    }
    const imageUrl = variant.imageUrl?.trim();
    return imageUrl ? `url:${imageUrl}` : "__none";
  };
  const setVariantImageValue = (index: number, value: string) => {
    const option = variantImageOptionByValue.get(value);
    form.setValue(`variants.${index}.imageId`, option?.imageId ?? null, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue(`variants.${index}.imageUrl`, option?.url ?? "", {
      shouldDirty: true,
      shouldValidate: true,
    });
  };
  const showVariantImagePicker = hasVariantImageOptions || watchedVariants.length > 0;
  const openVariantImageUpload = (target?: VariantImageUploadTarget) => {
    pendingVariantImageUploadTargetRef.current = target ?? null;
    (quickFileInputRef.current ?? fileInputRef.current)?.click();
  };
  const compactVariantGridStyle = {
    "--variant-grid-cols": [
      "minmax(140px,1fr)",
      showVariantImagePicker ? "minmax(220px,280px)" : null,
      enableSku ? "160px" : null,
      canEditInitialStock ? "120px" : null,
      "40px",
    ]
      .filter(Boolean)
      .join(" "),
  } as CSSProperties;

  const {
    fields: packFields,
    append: appendPack,
    remove: removePack,
  } = useFieldArray({
    control: form.control,
    name: "packs",
  });

  const {
    fields: bundleComponentFields,
    append: appendBundleComponent,
    remove: removeBundleComponent,
  } = useFieldArray({
    control: form.control,
    name: "bundleComponents",
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const quickFileInputRef = useRef<HTMLInputElement | null>(null);
  const variantsEditorRef = useRef<HTMLDivElement | null>(null);
  const pendingVariantsEditorScrollRef = useRef(false);
  const pendingVariantImageUploadTargetRef = useRef<VariantImageUploadTarget | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [draggedImageIndex, setDraggedImageIndex] = useState<number | null>(null);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [barcodeGenerateMode, setBarcodeGenerateMode] = useState<"EAN13" | "CODE128">("EAN13");
  const [variantToRemove, setVariantToRemove] = useState<number | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(
    () =>
      !compactCreate && Boolean(initialValues.barcodes?.length || initialValues.variants?.length),
  );
  const [attributeDrafts, setAttributeDrafts] = useState<Record<string, string>>({});
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [generatorAttributes, setGeneratorAttributes] = useState<VariantGeneratorAttribute[]>([]);
  const [generatorDraftKey, setGeneratorDraftKey] = useState("");
  const [generatorValueDrafts, setGeneratorValueDrafts] = useState<Record<string, string>>({});
  const [variantOptionEditorOpen, setVariantOptionEditorOpen] = useState(false);
  const [variantOptionDraftName, setVariantOptionDraftName] = useState("");
  const [variantOptionValueDraft, setVariantOptionValueDraft] = useState("");
  const [variantOptionDraftValues, setVariantOptionDraftValues] = useState<string[]>([]);
  const [variantOptionDraftImages, setVariantOptionDraftImages] = useState<Record<string, string>>(
    {},
  );
  const [bundleSearch, setBundleSearch] = useState("");
  const [showBundleResults, setShowBundleResults] = useState(false);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [showImageUrlInput, setShowImageUrlInput] = useState(false);
  const [imageUrlDraft, setImageUrlDraft] = useState("");
  const [pendingImageUploads, setPendingImageUploads] = useState<PendingImageUpload[]>([]);
  const pendingImageUploadsRef = useRef<PendingImageUpload[]>([]);
  const [isImageEditorOpen, setIsImageEditorOpen] = useState(false);
  const [imageEditorIndex, setImageEditorIndex] = useState<number | null>(null);
  const [imageEditorSourceUrl, setImageEditorSourceUrl] = useState<string | null>(null);
  const [imageEditorObjectUrl, setImageEditorObjectUrl] = useState<string | null>(null);
  const [imageEditorSourceFile, setImageEditorSourceFile] = useState<File | null>(null);
  const [imageEditorAspect, setImageEditorAspect] = useState(1);
  const [imageEditorCrop, setImageEditorCrop] = useState({ x: 0, y: 0 });
  const [imageEditorZoom, setImageEditorZoom] = useState(1);
  const [imageEditorRotation, setImageEditorRotation] = useState(0);
  const [imageEditorCroppedAreaPixels, setImageEditorCroppedAreaPixels] = useState<Area | null>(
    null,
  );
  const [isPreparingImageEditor, setIsPreparingImageEditor] = useState(false);
  const [isSavingImageEdit, setIsSavingImageEdit] = useState(false);
  const [imagePreviewVersion, setImagePreviewVersion] = useState<Record<string, number>>({});
  const isBundle = Boolean(form.watch("isBundle"));
  const baseUnitId = form.watch("baseUnitId");
  const baseUnit = unitOptions.find((unit) => unit.id === baseUnitId);
  const maxImageBytes = resolveClientImageMaxBytes();
  const maxProxyUploadBytes = Math.min(
    maxImageBytes,
    resolveProductImageProxyUploadMaxBytes(process.env.NEXT_PUBLIC_PRODUCT_IMAGE_PROXY_MAX_BYTES),
  );
  const maxInputImageBytes = resolveClientImageMaxInputBytes(maxImageBytes);
  const maxImageUploadConcurrency = resolveClientImageUploadConcurrency();

  const bundleSearchQuery = trpc.products.searchQuick.useQuery(
    { q: bundleSearch.trim() },
    { enabled: !readOnly && isBundle && bundleSearch.trim().length >= 1 },
  );
  const duplicateDiagnosticsInput = useMemo(
    () => ({
      productId,
      sku: enableSku ? watchedSku?.trim() || undefined : undefined,
      name: watchedName?.trim() || undefined,
      barcodes: enableBarcode ? normalizeProductBarcodes(watchedBarcodes) : [],
    }),
    [enableBarcode, enableSku, productId, watchedBarcodes, watchedName, watchedSku],
  );
  const deferredDuplicateDiagnosticsInput = useDeferredValue(duplicateDiagnosticsInput);
  const duplicateDiagnosticsEnabled =
    !readOnly &&
    enableSimilarProductCheck &&
    (compactCreate
      ? deferredDuplicateDiagnosticsInput.barcodes.length > 0
      : Boolean(
          deferredDuplicateDiagnosticsInput.sku &&
          deferredDuplicateDiagnosticsInput.sku.length >= 2,
        ) ||
        Boolean(
          deferredDuplicateDiagnosticsInput.name &&
          deferredDuplicateDiagnosticsInput.name.length >= 4,
        ) ||
        deferredDuplicateDiagnosticsInput.barcodes.length > 0);
  const duplicateDiagnosticsQuery = trpc.products.duplicateDiagnostics.useQuery(
    deferredDuplicateDiagnosticsInput,
    {
      enabled: duplicateDiagnosticsEnabled,
      staleTime: 15_000,
      keepPreviousData: true,
    },
  );
  const generateBarcodeMutation = trpc.products.generateBarcode.useMutation({
    onSuccess: (result) => {
      form.setValue("barcodes", result.barcodes ?? [result.value], {
        shouldValidate: false,
        shouldDirty: true,
      });
      form.clearErrors("barcodes");
      toast({
        variant: "success",
        description: t("barcodeGenerated", { value: result.value }),
      });
    },
    onError: (error) => {
      toast({
        variant: "error",
        description: translateError(tErrors, error),
      });
    },
  });
  const generateDescriptionMutation = trpc.products.generateDescription.useMutation({
    onSuccess: (result) => {
      form.setValue("description", result.description, {
        shouldValidate: true,
        shouldDirty: true,
      });
      form.clearErrors("description");
      toast({
        variant: "success",
        description: t("aiDescriptionGenerated"),
      });
    },
    onError: (error) => {
      toast({
        variant: "error",
        description: translateError(tErrors, error),
      });
    },
  });

  const scrollToVariantsEditor = () => {
    pendingVariantsEditorScrollRef.current = true;
    setShowAdvanced(true);
  };

  useEffect(() => {
    if (!showAdvanced || !pendingVariantsEditorScrollRef.current) {
      return;
    }
    pendingVariantsEditorScrollRef.current = false;
    window.requestAnimationFrame(() => {
      variantsEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [showAdvanced, fields.length]);

  const addBarcodeFromDraft = () => {
    if (readOnly || !enableBarcode) {
      return false;
    }
    const value = normalizeProductBarcodeInput(barcodeInput);
    if (!value) {
      return false;
    }
    if (value.length < minimumProductBarcodeLength) {
      form.setError("barcodes", {
        message: t("barcodeTooShort", { min: minimumProductBarcodeLength }),
      });
      return false;
    }
    const current = normalizeProductBarcodes(form.getValues("barcodes"));
    if (current.includes(value)) {
      form.setError("barcodes", { message: t("barcodeDuplicate") });
      return false;
    }
    form.clearErrors("barcodes");
    form.setValue("barcodes", [...current, value], {
      shouldValidate: true,
      shouldDirty: true,
      shouldTouch: true,
    });
    setBarcodeInput("");
    return true;
  };

  const handleBarcodeInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!enableBarcode) {
      return;
    }
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    addBarcodeFromDraft();
  };

  const shouldLogImagePrepDebug =
    process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_IMAGE_UPLOAD_DEBUG === "1";
  const logImagePrepDebug = (step: string, details?: Record<string, unknown>, error?: unknown) => {
    if (!shouldLogImagePrepDebug) {
      return;
    }
    if (error) {
      // eslint-disable-next-line no-console
      console.error(`[product-image] ${step}`, details ?? {}, error);
      return;
    }
    // eslint-disable-next-line no-console
    console.warn(`[product-image] ${step}`, details ?? {});
  };

  useEffect(() => {
    pendingImageUploadsRef.current = pendingImageUploads;
  }, [pendingImageUploads]);

  useEffect(
    () => () => {
      pendingImageUploadsRef.current.forEach((upload) => {
        URL.revokeObjectURL(upload.previewUrl);
      });
    },
    [],
  );

  const updatePendingImageUpload = (
    id: string,
    patch:
      | Partial<PendingImageUpload>
      | ((current: PendingImageUpload) => Partial<PendingImageUpload>),
  ) => {
    setPendingImageUploads((current) =>
      current.map((upload) => {
        if (upload.id !== id) {
          return upload;
        }
        const nextPatch = typeof patch === "function" ? patch(upload) : patch;
        return { ...upload, ...nextPatch };
      }),
    );
  };

  const removePendingImageUpload = (id: string) => {
    setPendingImageUploads((current) => {
      const upload = current.find((item) => item.id === id);
      if (upload) {
        URL.revokeObjectURL(upload.previewUrl);
      }
      return current.filter((item) => item.id !== id);
    });
  };

  const clearUploadedPendingImageUploads = (ids: string[]) => {
    if (!ids.length) {
      return;
    }
    const idSet = new Set(ids);
    setPendingImageUploads((current) => {
      current.forEach((upload) => {
        if (idSet.has(upload.id)) {
          URL.revokeObjectURL(upload.previewUrl);
        }
      });
      return current.filter((upload) => !idSet.has(upload.id));
    });
  };

  const imagePrepareErrorMessage = (code?: string | null) => {
    if (code === "imageTooLargeInput") {
      return t("imageTooLargeInput", {
        size: Math.round(maxInputImageBytes / (1024 * 1024)),
      });
    }
    if (code === "imageTooLarge" || code === "imageTooLargeAfterCompression") {
      return t("imageTooLargeAfterCompression", {
        size: Math.round(maxImageBytes / (1024 * 1024)),
      });
    }
    if (code === "imageInvalidType") {
      return t("imageInvalidType");
    }
    if (code === "imageUploadTimedOut") {
      return t("imageUploadTimedOut");
    }
    if (code === "imageCompressionFailed") {
      return t("imageCompressionFailed");
    }
    return t("imageReadFailed");
  };

  const encodeCanvasToFile = async (input: {
    canvas: HTMLCanvasElement;
    fileName: string;
    lastModified: number;
    type: "image/jpeg" | "image/png" | "image/webp";
    quality?: number;
  }) => {
    const blob = await new Promise<Blob | null>((resolve) => {
      if (input.type === "image/jpeg" || input.type === "image/webp") {
        input.canvas.toBlob(resolve, input.type, input.quality ?? 1);
        return;
      }
      input.canvas.toBlob(resolve, input.type);
    });
    if (!blob) {
      return null;
    }
    return new File([blob], input.fileName, {
      type: input.type,
      lastModified: input.lastModified,
    });
  };

  const optimizeImageToLimit = async (file: File, targetMaxBytes = maxImageBytes) => {
    const normalizedType = normalizeImageMimeType(file.type);
    if (!["image/jpeg", "image/png", "image/webp"].includes(normalizedType)) {
      logImagePrepDebug("optimize-unsupported-type", {
        fileName: file.name,
        size: file.size,
        type: file.type,
        normalizedType,
      });
      return null;
    }

    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const nextImage = new Image();
        nextImage.onload = () => resolve(nextImage);
        nextImage.onerror = () => reject(new Error("imageCompressionFailed"));
        nextImage.src = objectUrl;
      });

      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (!width || !height) {
        logImagePrepDebug("optimize-invalid-dimensions", {
          fileName: file.name,
          size: file.size,
          width,
          height,
        });
        return null;
      }

      const optimizeFromDimensions = async (
        targetWidth: number,
        targetHeight: number,
        allowAggressiveQuality = false,
      ) => {
        const canvas = document.createElement("canvas");
        const safeWidth = Math.max(1, Math.round(targetWidth));
        const safeHeight = Math.max(1, Math.round(targetHeight));
        canvas.width = safeWidth;
        canvas.height = safeHeight;

        const context = canvas.getContext("2d");
        if (!context) {
          return null;
        }
        context.drawImage(image, 0, 0, safeWidth, safeHeight);

        const candidates: File[] = [];
        const pushCandidate = (candidate: File | null) => {
          if (!candidate) {
            return;
          }
          candidates.push(candidate);
        };

        // First pass: preserve visual quality as much as possible.
        pushCandidate(
          await encodeCanvasToFile({
            canvas,
            fileName: file.name,
            lastModified: file.lastModified || Date.now(),
            type: normalizedType as "image/jpeg" | "image/png" | "image/webp",
            quality: 1,
          }),
        );
        pushCandidate(
          await encodeCanvasToFile({
            canvas,
            fileName: file.name,
            lastModified: file.lastModified || Date.now(),
            type: "image/webp",
            quality: 1,
          }),
        );
        if (normalizedType !== "image/png") {
          pushCandidate(
            await encodeCanvasToFile({
              canvas,
              fileName: file.name,
              lastModified: file.lastModified || Date.now(),
              type: "image/jpeg",
              quality: 1,
            }),
          );
        }

        if (!candidates.length) {
          logImagePrepDebug("optimize-no-candidates", {
            fileName: file.name,
            targetWidth: safeWidth,
            targetHeight: safeHeight,
          });
          return null;
        }

        let best = candidates.reduce((smallest, candidate) =>
          candidate.size < smallest.size ? candidate : smallest,
        );
        if (best.size <= targetMaxBytes) {
          return best;
        }

        // Second pass: quality optimization before lowering dimensions further.
        const fallbackType: "image/jpeg" | "image/webp" =
          normalizedType === "image/png" ? "image/webp" : "image/jpeg";
        const qualitySteps = allowAggressiveQuality
          ? ([0.98, 0.95, 0.92, 0.9, 0.88, 0.85, 0.82, 0.78, 0.74, 0.7, 0.66, 0.62, 0.58] as const)
          : ([0.98, 0.95, 0.92, 0.9, 0.88, 0.85, 0.82] as const);
        for (const quality of qualitySteps) {
          const optimized = await encodeCanvasToFile({
            canvas,
            fileName: file.name,
            lastModified: file.lastModified || Date.now(),
            type: fallbackType,
            quality,
          });
          if (!optimized) {
            continue;
          }
          if (optimized.size < best.size) {
            best = optimized;
          }
          if (optimized.size <= targetMaxBytes) {
            return optimized;
          }
        }

        return best;
      };

      const maxCanvasPixels = 28_000_000;
      const maxCanvasSide = 8192;
      const areaScale =
        width * height > maxCanvasPixels ? Math.sqrt(maxCanvasPixels / (width * height)) : 1;
      const sideScale =
        Math.max(width, height) > maxCanvasSide ? maxCanvasSide / Math.max(width, height) : 1;
      const safeBaseScale = Math.min(1, areaScale, sideScale);
      let targetWidth = Math.max(1, Math.round(width * safeBaseScale));
      let targetHeight = Math.max(1, Math.round(height * safeBaseScale));

      let best = await optimizeFromDimensions(targetWidth, targetHeight, false);
      if (best?.size && best.size <= targetMaxBytes) {
        return best;
      }

      // Keep compressing/downscaling until target is met or hard minimum is reached.
      const minDimension = 320;
      const maxResizePasses = 8;
      for (let pass = 0; pass < maxResizePasses; pass += 1) {
        const referenceSize = best?.size ?? file.size;
        if (referenceSize <= targetMaxBytes) {
          return best;
        }
        if (targetWidth <= minDimension && targetHeight <= minDimension) {
          break;
        }

        const predictedScale = Math.sqrt(targetMaxBytes / Math.max(referenceSize, 1));
        const stepScale = Math.min(0.9, Math.max(0.55, predictedScale * 0.98));
        const nextTargetWidth = Math.max(minDimension, Math.round(targetWidth * stepScale));
        const nextTargetHeight = Math.max(minDimension, Math.round(targetHeight * stepScale));

        if (nextTargetWidth === targetWidth && nextTargetHeight === targetHeight) {
          break;
        }

        targetWidth = nextTargetWidth;
        targetHeight = nextTargetHeight;
        const resized = await optimizeFromDimensions(targetWidth, targetHeight, true);
        if (!resized) {
          continue;
        }
        if (!best || resized.size < best.size) {
          best = resized;
        }
        if (resized.size <= targetMaxBytes) {
          return resized;
        }
      }

      return best;
    } catch (error) {
      logImagePrepDebug(
        "optimize-failed",
        {
          fileName: file.name,
          size: file.size,
          type: file.type,
        },
        error,
      );
      return null;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };

  const convertBrowserReadableImageToJpeg = async (file: File) => {
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const nextImage = new Image();
        nextImage.onload = () => resolve(nextImage);
        nextImage.onerror = () => reject(new Error("imageReadFailed"));
        nextImage.src = objectUrl;
      });
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (!width || !height) {
        return null;
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      const context = canvas.getContext("2d");
      if (!context) {
        return null;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return encodeCanvasToFile({
        canvas,
        fileName: replaceFileExtension(file.name, "jpg"),
        lastModified: file.lastModified || Date.now(),
        type: "image/jpeg",
        quality: 0.95,
      });
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };

  const convertHeicToJpeg = async (file: File) => {
    const browserConverted = await convertBrowserReadableImageToJpeg(file);
    if (browserConverted) {
      logImagePrepDebug("heic-convert-browser-decoded", {
        fileName: file.name,
        size: file.size,
        type: file.type,
        outputSize: browserConverted.size,
      });
      return browserConverted;
    }

    try {
      const heic2anyModule = await import("heic2any");
      const topLevelDefault = (heic2anyModule as { default?: unknown }).default;
      const nestedDefault =
        topLevelDefault && typeof topLevelDefault === "object"
          ? (topLevelDefault as { default?: unknown }).default
          : undefined;
      const convertCandidate =
        typeof topLevelDefault === "function"
          ? topLevelDefault
          : typeof nestedDefault === "function"
            ? nestedDefault
            : typeof (heic2anyModule as unknown) === "function"
              ? (heic2anyModule as unknown)
              : null;
      if (typeof convertCandidate !== "function") {
        logImagePrepDebug("heic-convert-missing-function", {
          fileName: file.name,
          type: file.type,
          moduleKeys: Object.keys(heic2anyModule as Record<string, unknown>),
          defaultType: typeof topLevelDefault,
          nestedDefaultType: typeof nestedDefault,
        });
        return null;
      }
      const convert = convertCandidate as (options: {
        blob: Blob;
        toType: string;
        quality?: number;
      }) => Promise<Blob | Blob[]>;
      const converted = await convert({
        blob: file,
        toType: "image/jpeg",
        quality: 0.95,
      });
      const outputBlob = Array.isArray(converted) ? converted[0] : converted;
      if (!(outputBlob instanceof Blob)) {
        logImagePrepDebug("heic-convert-invalid-output", {
          fileName: file.name,
          type: file.type,
          outputType: typeof outputBlob,
          isArray: Array.isArray(converted),
        });
        return null;
      }
      return new File([outputBlob], replaceFileExtension(file.name, "jpg"), {
        type: "image/jpeg",
        lastModified: file.lastModified || Date.now(),
      });
    } catch (error) {
      const rawMessage = (() => {
        if (error instanceof Error) {
          return error.message;
        }
        if (typeof error === "string") {
          return error;
        }
        if (error && typeof error === "object") {
          const candidate = (error as { message?: unknown }).message;
          if (typeof candidate === "string") {
            return candidate;
          }
          try {
            return JSON.stringify(error);
          } catch {
            return String(error);
          }
        }
        return String(error ?? "");
      })();
      const browserReadableMatch = rawMessage.match(
        /Image is already browser readable:\s*(image\/[a-zA-Z0-9.+-]+)/i,
      );
      const browserReadableMimeType = browserReadableMatch?.[1]
        ? normalizeImageMimeType(browserReadableMatch[1])
        : "";
      if (browserReadableMimeType.startsWith("image/")) {
        const browserReadableConverted = await convertBrowserReadableImageToJpeg(file);
        if (browserReadableConverted) {
          logImagePrepDebug("heic-convert-browser-readable-decoded", {
            fileName: file.name,
            originalType: file.type,
            fallbackType: browserReadableMimeType,
            fallbackSize: browserReadableConverted.size,
            message: rawMessage,
          });
          return browserReadableConverted;
        }
        const fallbackFile = new File(
          [file],
          replaceFileExtension(file.name, resolveImageExtensionByMime(browserReadableMimeType)),
          {
            type: browserReadableMimeType,
            lastModified: file.lastModified || Date.now(),
          },
        );
        logImagePrepDebug("heic-convert-browser-readable-fallback", {
          fileName: file.name,
          originalType: file.type,
          fallbackType: browserReadableMimeType,
          fallbackSize: fallbackFile.size,
          message: rawMessage,
        });
        return fallbackFile;
      }
      const isLibHeifFormatUnsupported = /ERR_LIBHEIF\b.*format not supported/i.test(rawMessage);
      if (isLibHeifFormatUnsupported) {
        const heicLikeMimeType = resolveHeicLikeMimeType(file);
        if (heicLikeMimeType) {
          const passThroughFile = new File(
            [file],
            replaceFileExtension(file.name, resolveImageExtensionByMime(heicLikeMimeType)),
            {
              type: heicLikeMimeType,
              lastModified: file.lastModified || Date.now(),
            },
          );
          logImagePrepDebug("heic-convert-pass-through", {
            fileName: file.name,
            originalType: file.type,
            fallbackType: heicLikeMimeType,
            fallbackSize: passThroughFile.size,
            message: rawMessage,
          });
          return passThroughFile;
        }
      }
      logImagePrepDebug(
        "heic-convert-failed",
        {
          fileName: file.name,
          size: file.size,
          type: file.type,
          message: rawMessage,
        },
        error,
      );
      return null;
    }
  };

  const showUploadFailureToast = (code?: string | null, sizeBytes = maxImageBytes) => {
    if (code === "forbidden") {
      toast({ variant: "error", description: tErrors("forbidden") });
      return;
    }
    if (code === "imageInvalidType") {
      toast({ variant: "error", description: t("imageInvalidType") });
      return;
    }
    if (code === "imageTooLarge") {
      toast({
        variant: "error",
        description: t("imageTooLargeAfterCompression", {
          size: Math.round(sizeBytes / (1024 * 1024)),
        }),
      });
      return;
    }
    toast({ variant: "error", description: t("imageReadFailed") });
  };

  const putProductImageDirectUploadWithProgress = async (
    target: ProductImageDirectUploadTarget,
    file: File,
    onProgress?: (progress: number | null) => void,
  ) => {
    if (!onProgress || typeof XMLHttpRequest === "undefined") {
      return putProductImageDirectUpload({ target, file });
    }

    return new Promise<Response>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let settled = false;
      const timeout = window.setTimeout(
        () => {
          if (settled) {
            return;
          }
          settled = true;
          xhr.abort();
          reject(new ProductImageUploadTimeoutError());
        },
        resolveProductImageDirectUploadTimeoutMs(
          process.env.NEXT_PUBLIC_PRODUCT_IMAGE_DIRECT_UPLOAD_TIMEOUT_MS ??
            process.env.NEXT_PUBLIC_PRODUCT_IMAGE_UPLOAD_TIMEOUT_MS,
        ),
      );

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable || event.total <= 0) {
          onProgress(null);
          return;
        }
        onProgress(Math.min(99, Math.max(1, Math.round((event.loaded / event.total) * 100))));
      };
      xhr.onload = () => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        onProgress(100);
        resolve(new Response(null, { status: xhr.status, statusText: xhr.statusText }));
      };
      xhr.onerror = () => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        reject(new Error("imageUploadFailed"));
      };
      xhr.onabort = () => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        reject(new ProductImageUploadTimeoutError());
      };

      xhr.open(target.method, target.uploadUrl);
      Object.entries(target.headers ?? {}).forEach(([key, value]) => {
        xhr.setRequestHeader(key, value);
      });
      xhr.send(file);
    });
  };

  const uploadImageFileViaProxy = async (file: File) => {
    let uploadFile = file;
    if (uploadFile.size > maxProxyUploadBytes) {
      logImagePrepDebug("proxy-upload-optimize-start", {
        fileName: uploadFile.name,
        fileSize: uploadFile.size,
        fileType: uploadFile.type,
        targetSize: maxProxyUploadBytes,
      });
      const optimized = await optimizeImageToLimit(uploadFile, maxProxyUploadBytes);
      if (!optimized) {
        toast({ variant: "error", description: t("imageCompressionFailed") });
        return null;
      }
      if (optimized.size > maxProxyUploadBytes) {
        logImagePrepDebug("proxy-upload-optimized-too-large", {
          fileName: uploadFile.name,
          originalSize: uploadFile.size,
          optimizedSize: optimized.size,
          targetSize: maxProxyUploadBytes,
        });
        toast({
          variant: "error",
          description: t("imageTooLargeAfterCompression", {
            size: Math.round(maxProxyUploadBytes / (1024 * 1024)),
          }),
        });
        return null;
      }
      logImagePrepDebug("proxy-upload-optimized", {
        fileName: uploadFile.name,
        originalSize: uploadFile.size,
        optimizedSize: optimized.size,
        targetSize: maxProxyUploadBytes,
      });
      uploadFile = optimized;
    }

    const formData = new FormData();
    formData.set("file", uploadFile);
    if (productId) {
      formData.set("productId", productId);
    }

    let response: Response;
    try {
      response = await fetchProductImageUpload({
        url: "/api/product-images/upload",
        formData,
      });
    } catch (error) {
      logImagePrepDebug(
        "upload-request-error",
        {
          fileName: uploadFile.name,
          fileSize: uploadFile.size,
          fileType: uploadFile.type,
          code: error instanceof ProductImageUploadTimeoutError ? "imageUploadTimedOut" : "fetch",
        },
        error,
      );
      toast({
        variant: "error",
        description:
          error instanceof ProductImageUploadTimeoutError
            ? t("imageUploadTimedOut")
            : t("imageReadFailed"),
      });
      return null;
    }

    const body = (await response.json().catch(() => null)) as {
      message?: string;
      url?: string;
    } | null;
    if (!response.ok) {
      const code = body?.message ?? (response.status === 413 ? "imageTooLarge" : undefined);
      logImagePrepDebug("upload-request-failed", {
        status: response.status,
        code,
        fileName: uploadFile.name,
        fileSize: uploadFile.size,
        fileType: uploadFile.type,
      });
      showUploadFailureToast(code, code === "imageTooLarge" ? maxProxyUploadBytes : maxImageBytes);
      return null;
    }

    const uploadedUrl = body?.url?.trim();
    if (!uploadedUrl) {
      logImagePrepDebug("upload-missing-url", {
        status: response.status,
        fileName: uploadFile.name,
        fileSize: uploadFile.size,
        fileType: uploadFile.type,
      });
      toast({ variant: "error", description: t("imageReadFailed") });
      return null;
    }
    return uploadedUrl;
  };

  const uploadImageFileDirectly = async (
    file: File,
    onProgress?: (progress: number | null) => void,
  ) => {
    let targetResponse: Response;
    try {
      targetResponse = await fetchProductImageDirectUploadTarget({
        file,
        productId,
      });
    } catch (error) {
      logImagePrepDebug(
        "direct-upload-target-error",
        {
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          code: error instanceof ProductImageUploadTimeoutError ? "imageUploadTimedOut" : "fetch",
        },
        error,
      );
      return { attempted: false, url: null };
    }

    const targetBody = (await targetResponse.json().catch(() => null)) as
      | (Partial<ProductImageDirectUploadTarget> & { message?: string })
      | null;

    if (!targetResponse.ok) {
      const code = targetBody?.message;
      if (code === "directUploadUnavailable" || code === "imageTooLarge") {
        logImagePrepDebug(
          code === "imageTooLarge" ? "direct-upload-target-too-large" : "direct-upload-unavailable",
          {
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
          },
        );
        return { attempted: false, url: null };
      }
      if (targetResponse.status >= 500 || targetResponse.status === 404) {
        logImagePrepDebug("direct-upload-target-fallback", {
          status: targetResponse.status,
          code,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
        });
        return { attempted: false, url: null };
      }
      logImagePrepDebug("direct-upload-target-failed", {
        status: targetResponse.status,
        code,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
      });
      showUploadFailureToast(code);
      return { attempted: true, url: null };
    }

    if (targetBody?.message === "directUploadUnavailable") {
      logImagePrepDebug("direct-upload-unavailable", {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
      });
      return { attempted: false, url: null };
    }

    if (
      targetBody?.method !== "PUT" ||
      !targetBody.uploadUrl ||
      !targetBody.url ||
      typeof targetBody.uploadUrl !== "string" ||
      typeof targetBody.url !== "string"
    ) {
      logImagePrepDebug("direct-upload-target-invalid", {
        status: targetResponse.status,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
      });
      return { attempted: false, url: null };
    }

    const target: ProductImageDirectUploadTarget = {
      method: "PUT",
      uploadUrl: targetBody.uploadUrl,
      url: targetBody.url,
      headers: targetBody.headers,
      expiresIn: targetBody.expiresIn,
    };

    let uploadResponse: Response;
    try {
      uploadResponse = await putProductImageDirectUploadWithProgress(target, file, onProgress);
    } catch (error) {
      logImagePrepDebug(
        "direct-upload-put-error",
        {
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          code: error instanceof ProductImageUploadTimeoutError ? "imageUploadTimedOut" : "fetch",
        },
        error,
      );
      if (error instanceof ProductImageUploadTimeoutError) {
        toast({ variant: "error", description: t("imageUploadTimedOut") });
        return { attempted: true, url: null };
      }
      onProgress?.(null);
      return { attempted: false, url: null };
    }

    if (!uploadResponse.ok) {
      logImagePrepDebug("direct-upload-put-failed", {
        status: uploadResponse.status,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
      });
      if (
        uploadResponse.status >= 500 ||
        uploadResponse.status === 408 ||
        uploadResponse.status === 429
      ) {
        onProgress?.(null);
        return { attempted: false, url: null };
      }
      return { attempted: true, url: null };
    }

    return { attempted: true, url: target.url.trim() || null };
  };

  const uploadImageFile = async (file: File, onProgress?: (progress: number | null) => void) => {
    const directResult = await uploadImageFileDirectly(file, onProgress);
    if (directResult.url || directResult.attempted) {
      return directResult.url;
    }
    return uploadImageFileViaProxy(file);
  };

  const closeImageEditor = () => {
    setIsImageEditorOpen(false);
    setImageEditorIndex(null);
    setImageEditorSourceUrl(null);
    setImageEditorSourceFile(null);
    setImageEditorAspect(1);
    setImageEditorCrop({ x: 0, y: 0 });
    setImageEditorZoom(1);
    setImageEditorRotation(0);
    setImageEditorCroppedAreaPixels(null);
    setIsPreparingImageEditor(false);
    setIsSavingImageEdit(false);
    setImageEditorObjectUrl((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous);
      }
      return null;
    });
  };

  useEffect(() => {
    return () => {
      if (imageEditorObjectUrl) {
        URL.revokeObjectURL(imageEditorObjectUrl);
      }
    };
  }, [imageEditorObjectUrl]);

  const getImageDimensions = async (source: string) =>
    new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        resolve({
          width: image.naturalWidth || image.width,
          height: image.naturalHeight || image.height,
        });
      };
      image.onerror = () => reject(new Error("imageReadFailed"));
      image.src = source;
    });

  const resolveImageFileNameFromUrl = (sourceUrl: string, mimeType: string) => {
    const fallbackExtension = resolveImageExtensionByMime(mimeType);
    const fallbackName = `product-image.${fallbackExtension}`;
    try {
      const parsed = new URL(sourceUrl, window.location.origin);
      const rawName = parsed.pathname.split("/").pop();
      if (!rawName) {
        return fallbackName;
      }
      const normalized = rawName.trim();
      if (!normalized) {
        return fallbackName;
      }
      if (normalized.includes(".")) {
        return normalized;
      }
      return `${normalized}.${fallbackExtension}`;
    } catch {
      return fallbackName;
    }
  };

  const resolveImageEditorProxyUrl = (sourceUrl: string) =>
    `/api/product-images/source?url=${encodeURIComponent(sourceUrl)}`;

  const fetchImageEditorSourceFile = async (sourceUrl: string) => {
    const candidateUrls = [sourceUrl];
    const proxyUrl = resolveImageEditorProxyUrl(sourceUrl);
    if (!candidateUrls.includes(proxyUrl)) {
      candidateUrls.push(proxyUrl);
    }

    let lastError: unknown = null;
    for (const candidateUrl of candidateUrls) {
      try {
        const response = await fetch(candidateUrl, { cache: "no-store" });
        if (!response.ok) {
          throw new Error("imageReadFailed");
        }
        const arrayBuffer = await response.arrayBuffer();
        if (!arrayBuffer.byteLength) {
          throw new Error("imageReadFailed");
        }
        const fallbackMimeType = resolveImageMimeTypeFromUrl(sourceUrl);
        const headerMimeType = normalizeImageMimeType(response.headers.get("content-type") ?? "");
        const inferredMimeType = inferImageMimeTypeFromBytes(
          new Uint8Array(arrayBuffer.slice(0, 16)),
        );
        const finalMimeType = headerMimeType.startsWith("image/")
          ? headerMimeType
          : inferredMimeType ||
            (normalizeImageMimeType(fallbackMimeType).startsWith("image/")
              ? normalizeImageMimeType(fallbackMimeType)
              : "");
        if (!finalMimeType.startsWith("image/")) {
          throw new Error("imageInvalidType");
        }

        const fileName = resolveImageFileNameFromUrl(sourceUrl, finalMimeType || "image/jpeg");
        return new File([arrayBuffer], fileName, {
          type: finalMimeType || "image/jpeg",
          lastModified: Date.now(),
        });
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error("imageReadFailed");
  };

  const withPreviewVersion = (url: string, imageFieldId: string) => {
    const version = imagePreviewVersion[imageFieldId];
    if (!version) {
      return url;
    }

    try {
      const parsed = new URL(url, window.location.origin);
      parsed.searchParams.set("v", String(version));
      if (url.startsWith("/")) {
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
      return parsed.toString();
    } catch {
      const separator = url.includes("?") ? "&" : "?";
      return `${url}${separator}v=${version}`;
    }
  };

  const createEditedImageFile = async (input: {
    sourceFile: File;
    cropAreaPixels: Area;
    rotation: number;
  }) => {
    const sourceObjectUrl = URL.createObjectURL(input.sourceFile);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const nextImage = new Image();
        nextImage.onload = () => resolve(nextImage);
        nextImage.onerror = () => reject(new Error("imageReadFailed"));
        nextImage.src = sourceObjectUrl;
      });
      const sourceWidth = image.naturalWidth || image.width;
      const sourceHeight = image.naturalHeight || image.height;
      if (!sourceWidth || !sourceHeight) {
        return null;
      }

      const rotatedBounds = getRotatedBoundingBox(sourceWidth, sourceHeight, input.rotation);
      const rotatedCanvas = document.createElement("canvas");
      rotatedCanvas.width = Math.max(1, Math.round(rotatedBounds.width));
      rotatedCanvas.height = Math.max(1, Math.round(rotatedBounds.height));
      const rotatedContext = rotatedCanvas.getContext("2d");
      if (!rotatedContext) {
        return null;
      }

      rotatedContext.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2);
      rotatedContext.rotate(toRadians(input.rotation));
      rotatedContext.drawImage(image, -sourceWidth / 2, -sourceHeight / 2);

      const cropWidth = Math.max(1, Math.round(input.cropAreaPixels.width));
      const cropHeight = Math.max(1, Math.round(input.cropAreaPixels.height));
      const maxCropX = Math.max(0, rotatedCanvas.width - cropWidth);
      const maxCropY = Math.max(0, rotatedCanvas.height - cropHeight);
      const cropX = Math.max(0, Math.min(Math.round(input.cropAreaPixels.x), maxCropX));
      const cropY = Math.max(0, Math.min(Math.round(input.cropAreaPixels.y), maxCropY));

      const croppedCanvas = document.createElement("canvas");
      croppedCanvas.width = cropWidth;
      croppedCanvas.height = cropHeight;
      const croppedContext = croppedCanvas.getContext("2d");
      if (!croppedContext) {
        return null;
      }

      croppedContext.drawImage(
        rotatedCanvas,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        0,
        0,
        cropWidth,
        cropHeight,
      );

      const preferredType: "image/jpeg" | "image/png" | "image/webp" =
        input.sourceFile.type === "image/png"
          ? "image/png"
          : input.sourceFile.type === "image/webp"
            ? "image/webp"
            : "image/jpeg";
      const nextFileName = replaceFileExtension(
        input.sourceFile.name,
        resolveImageExtensionByMime(preferredType),
      );
      return encodeCanvasToFile({
        canvas: croppedCanvas,
        fileName: nextFileName,
        lastModified: Date.now(),
        type: preferredType,
        quality: preferredType === "image/png" ? undefined : 0.96,
      });
    } finally {
      URL.revokeObjectURL(sourceObjectUrl);
    }
  };

  const openImageEditor = async (index: number, imageUrl: string) => {
    setImageEditorIndex(index);
    setImageEditorSourceUrl(imageUrl);
    setImageEditorSourceFile(null);
    setImageEditorAspect(1);
    setImageEditorCrop({ x: 0, y: 0 });
    setImageEditorZoom(1);
    setImageEditorRotation(0);
    setImageEditorCroppedAreaPixels(null);
    setIsImageEditorOpen(true);
    setIsPreparingImageEditor(true);

    try {
      const sourceFile = await fetchImageEditorSourceFile(imageUrl);
      const objectUrl = URL.createObjectURL(sourceFile);
      const dimensions = await getImageDimensions(objectUrl);
      const nextAspect =
        dimensions.width > 0 && dimensions.height > 0 ? dimensions.width / dimensions.height : 1;
      setImageEditorAspect(nextAspect || 1);
      setImageEditorCroppedAreaPixels({
        x: 0,
        y: 0,
        width: dimensions.width,
        height: dimensions.height,
      });
      setImageEditorSourceFile(sourceFile);
      setImageEditorObjectUrl((previous) => {
        if (previous) {
          URL.revokeObjectURL(previous);
        }
        return objectUrl;
      });
    } catch {
      toast({ variant: "error", description: t("imageReadFailed") });
      closeImageEditor();
    } finally {
      setIsPreparingImageEditor(false);
    }
  };

  const saveEditedImage = async () => {
    if (
      readOnly ||
      isSavingImageEdit ||
      imageEditorIndex === null ||
      !imageEditorSourceFile ||
      !imageEditorCroppedAreaPixels
    ) {
      return;
    }
    setIsSavingImageEdit(true);
    try {
      const editedFile = await createEditedImageFile({
        sourceFile: imageEditorSourceFile,
        cropAreaPixels: imageEditorCroppedAreaPixels,
        rotation: imageEditorRotation,
      });
      if (!editedFile) {
        toast({ variant: "error", description: t("imageReadFailed") });
        return;
      }

      let uploadFile = editedFile;
      if (uploadFile.size > maxImageBytes) {
        const optimized = await optimizeImageToLimit(uploadFile);
        if (!optimized) {
          toast({ variant: "error", description: t("imageCompressionFailed") });
          return;
        }
        if (optimized.size > maxImageBytes) {
          toast({
            variant: "error",
            description: t("imageTooLargeAfterCompression", {
              size: Math.round(maxImageBytes / (1024 * 1024)),
            }),
          });
          return;
        }
        uploadFile = optimized;
      }

      const uploadedUrl = await uploadImageFile(uploadFile);
      if (!uploadedUrl) {
        return;
      }
      const editedImageFieldId = imageFields[imageEditorIndex]?.fieldId;
      form.setValue(`images.${imageEditorIndex}.url`, uploadedUrl, {
        shouldDirty: true,
        shouldValidate: true,
      });
      if (editedImageFieldId) {
        setImagePreviewVersion((previous) => ({
          ...previous,
          [editedImageFieldId]: Date.now(),
        }));
      }
      if (imageEditorIndex === 0) {
        form.setValue("photoUrl", uploadedUrl, {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
      toast({ variant: "success", description: t("imageEditSaved") });
      closeImageEditor();
    } finally {
      setIsSavingImageEdit(false);
    }
  };

  const imageEditorZoomPercent = Math.round(imageEditorZoom * 100);
  const imageEditorRotationDegrees = ((Math.round(imageEditorRotation) % 360) + 360) % 360;

  const syncPhotoUrlWithImages = (images: Array<{ url?: string | null }>) => {
    const nextPrimaryUrl = resolvePrimaryImageUrl(images);
    if ((form.getValues("photoUrl")?.trim() ?? "") === nextPrimaryUrl) {
      return;
    }
    form.setValue("photoUrl", nextPrimaryUrl, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const handleAppendImageEntries = (images: { url: string; position?: number }[]) => {
    if (!images.length) {
      return;
    }
    const currentImages = form.getValues("images") ?? [];
    appendImageField(images);
    syncPhotoUrlWithImages([...currentImages, ...images]);
  };

  const assignUploadedImageToVariantTarget = (
    target: VariantImageUploadTarget | null,
    url: string,
  ) => {
    if (!target || !url.trim()) {
      return;
    }
    if (target.type === "variant") {
      const variants = form.getValues("variants") ?? [];
      if (!variants[target.index]) {
        return;
      }
      form.setValue(`variants.${target.index}.imageId`, null, {
        shouldDirty: true,
        shouldValidate: true,
      });
      form.setValue(`variants.${target.index}.imageUrl`, url, {
        shouldDirty: true,
        shouldValidate: true,
      });
      return;
    }
    setVariantOptionDraftImages((current) => ({
      ...current,
      [target.valueKey]: `url:${url}`,
    }));
  };

  const addImageUrlFromDraft = () => {
    const nextUrl = imageUrlDraft.trim();
    if (!nextUrl) {
      toast({ variant: "error", description: t("imageUrlRequired") });
      return;
    }
    if (!isPhotoUrlValid(nextUrl)) {
      toast({ variant: "error", description: t("photoUrlInvalid") });
      return;
    }

    const currentImages = form.getValues("images") ?? [];
    if (!currentImages.some((image) => image.url.trim() === nextUrl)) {
      handleAppendImageEntries([{ url: nextUrl }]);
    }
    setImageUrlDraft("");
    setShowImageUrlInput(false);
  };

  const handleRemoveImageAt = (index: number) => {
    const currentImages = form.getValues("images") ?? [];
    if (index < 0 || index >= currentImages.length) {
      return;
    }
    const nextImages = currentImages.filter((_, itemIndex) => itemIndex !== index);
    removeImageField(index);
    syncPhotoUrlWithImages(nextImages);
  };

  const handleMoveImage = (fromIndex: number, toIndex: number) => {
    const currentImages = form.getValues("images") ?? [];
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= currentImages.length ||
      toIndex >= currentImages.length ||
      fromIndex === toIndex
    ) {
      return;
    }
    const nextImages = [...currentImages];
    const [moved] = nextImages.splice(fromIndex, 1);
    if (!moved) {
      return;
    }
    nextImages.splice(toIndex, 0, moved);
    moveImageField(fromIndex, toIndex);
    syncPhotoUrlWithImages(nextImages);
  };

  const processPendingImageUpload = async (upload: PendingImageUpload) => {
    updatePendingImageUpload(upload.id, {
      status: upload.file.size > maxImageBytes ? "optimizing" : "validating",
      progress: null,
      error: null,
      uploadedUrl: undefined,
    });

    const prepared = await prepareProductImageFileForUpload({
      file: upload.file,
      maxImageBytes,
      maxInputImageBytes,
      convertHeicToJpeg,
      optimizeImageToLimit,
    });
    if (!prepared.ok) {
      logImagePrepDebug("prepare-failed", {
        fileName: upload.file.name,
        fileSize: upload.file.size,
        fileType: upload.file.type,
        code: prepared.code,
        reason: prepared.reason,
      });
      const error = imagePrepareErrorMessage(prepared.code);
      updatePendingImageUpload(upload.id, { status: "failed", progress: null, error });
      toast({ variant: "error", description: error });
      return null;
    }

    updatePendingImageUpload(upload.id, { status: "uploading", progress: null, error: null });
    const uploadedUrl = await uploadImageFile(prepared.file, (progress) => {
      updatePendingImageUpload(upload.id, { progress });
    });
    if (!uploadedUrl) {
      const error = t("imageReadFailed");
      updatePendingImageUpload(upload.id, { status: "failed", progress: null, error });
      return null;
    }

    updatePendingImageUpload(upload.id, {
      status: "uploaded",
      progress: 100,
      error: null,
      uploadedUrl,
    });
    return { url: uploadedUrl, uploadId: upload.id };
  };

  const handleImageFiles = async (files: FileList | File[]) => {
    if (readOnly) {
      return;
    }
    const list = Array.from(files);
    if (!list.length) {
      pendingVariantImageUploadTargetRef.current = null;
      return;
    }
    const variantImageUploadTarget = pendingVariantImageUploadTargetRef.current;
    pendingVariantImageUploadTargetRef.current = null;
    const uploads = list.map((file) => ({
      id: createPendingImageUploadId(),
      file,
      previewUrl: URL.createObjectURL(file),
      fileName: file.name,
      status: "selected" as PendingImageUploadStatus,
      progress: null,
      error: null,
    }));
    setPendingImageUploads((current) => [...current, ...uploads]);
    setIsUploadingImages(true);
    try {
      const results: Array<{ url: string; uploadId: string } | null> = new Array(
        uploads.length,
      ).fill(null);
      let cursor = 0;
      const workers = Array.from(
        { length: Math.min(maxImageUploadConcurrency, uploads.length) },
        async () => {
          while (true) {
            const nextIndex = cursor;
            cursor += 1;
            if (nextIndex >= uploads.length) {
              return;
            }

            results[nextIndex] = await processPendingImageUpload(uploads[nextIndex]);
          }
        },
      );

      await Promise.all(workers);
      const uploadedImages = results.filter((result): result is { url: string; uploadId: string } =>
        Boolean(result),
      );
      const failedCount = uploads.length - uploadedImages.length;

      if (uploadedImages.length) {
        handleAppendImageEntries(uploadedImages.map((result) => ({ url: result.url })));
        assignUploadedImageToVariantTarget(variantImageUploadTarget, uploadedImages[0].url);
        window.setTimeout(
          () => clearUploadedPendingImageUploads(uploadedImages.map((result) => result.uploadId)),
          1600,
        );
      }
      if (failedCount > 0) {
        toast({ variant: "error", description: t("imageSomeFailed") });
      }
    } finally {
      setIsUploadingImages(false);
    }
  };

  const handleRetryPendingImageUpload = async (uploadId: string) => {
    if (readOnly || isUploadingImages) {
      return;
    }
    const upload = pendingImageUploadsRef.current.find((item) => item.id === uploadId);
    if (!upload) {
      return;
    }
    setIsUploadingImages(true);
    try {
      const result = await processPendingImageUpload(upload);
      if (result) {
        handleAppendImageEntries([{ url: result.url }]);
        window.setTimeout(() => clearUploadedPendingImageUploads([result.uploadId]), 1600);
      }
    } finally {
      setIsUploadingImages(false);
    }
  };

  const handleImageInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length) {
      void handleImageFiles(files);
    }
    event.target.value = "";
  };

  const handleImageDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    if (readOnly || isUploadingImages) {
      return;
    }
    if (event.dataTransfer?.files?.length) {
      void handleImageFiles(event.dataTransfer.files);
    }
  };

  const handleImageDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (readOnly || isUploadingImages) {
      return;
    }
    event.preventDefault();
    setIsDragActive(true);
  };

  const handleImageDragLeave = () => {
    setIsDragActive(false);
  };

  useEffect(() => {
    if (!requiredDefinitions.length) {
      return;
    }
    const variants = form.getValues("variants") ?? [];
    variants.forEach((variant, index) => {
      const attributes = variant.attributes ?? [];
      const existing = new Set(attributes.map((entry) => entry.key));
      const missing = requiredDefinitions.filter((definition) => !existing.has(definition.key));
      if (!missing.length) {
        return;
      }
      form.setValue(
        `variants.${index}.attributes`,
        [
          ...attributes,
          ...missing.map((definition) => ({
            key: definition.key,
            value: definition.type === "MULTI_SELECT" ? [] : "",
          })),
        ],
        { shouldDirty: false },
      );
    });
  }, [form, requiredDefinitions]);

  const generatorAvailableDefinitions = useMemo(
    () =>
      generatorDefinitions.filter(
        (definition) => !generatorAttributes.some((attr) => attr.key === definition.key),
      ),
    [generatorDefinitions, generatorAttributes],
  );
  const generatorPreviewCount = useMemo(
    () => buildVariantMatrix(generatorAttributes).length,
    [generatorAttributes],
  );

  useEffect(() => {
    if (!generatorOpen) {
      return;
    }
    const allowedKeys = new Set(generatorDefinitions.map((definition) => definition.key));
    const initialKeys = templateKeys.filter((key) => allowedKeys.has(key));
    setGeneratorAttributes(initialKeys.map((key) => ({ key, values: [] })));
    setGeneratorDraftKey("");
    setGeneratorValueDrafts({});
  }, [generatorOpen, generatorDefinitions, templateKeys]);

  const applyTemplateToVariants = () => {
    if (!templateKeys.length) {
      return;
    }
    const variants = form.getValues("variants") ?? [];
    variants.forEach((variant, index) => {
      const attributes = variant.attributes ?? [];
      const existing = new Set(attributes.map((entry) => entry.key));
      const next = [...attributes];
      templateKeys.forEach((key) => {
        if (existing.has(key)) {
          return;
        }
        const definition = definitionMap.get(key);
        next.push({ key, value: definition?.type === "MULTI_SELECT" ? [] : "" });
      });
      form.setValue(`variants.${index}.attributes`, next, {
        shouldDirty: true,
        shouldValidate: true,
      });
    });
  };

  const buildAttributeSignature = (attributes: { key: string; value?: unknown }[]) => {
    const normalized = attributes.map((entry) => {
      const value = Array.isArray(entry.value)
        ? [...entry.value].map(String).sort()
        : (entry.value ?? "");
      return [entry.key, value];
    });
    normalized.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return JSON.stringify(normalized);
  };

  const handleGenerateVariants = () => {
    if (readOnly) {
      return;
    }
    if (!generatorAttributes.length) {
      toast({ variant: "error", description: t("generatorAttributesRequired") });
      return;
    }
    if (generatorAttributes.some((attr) => attr.values.length === 0)) {
      toast({ variant: "error", description: t("generatorValuesRequired") });
      return;
    }
    const combinations = buildVariantMatrix(generatorAttributes);
    if (!combinations.length) {
      toast({ variant: "error", description: t("generatorValuesRequired") });
      return;
    }
    if (combinations.length > 200) {
      toast({
        variant: "error",
        description: t("generatorTooMany", { count: combinations.length }),
      });
      return;
    }

    const existingVariants = form.getValues("variants") ?? [];
    const existingSignatures = new Set(
      existingVariants.map((variant) => buildAttributeSignature(variant.attributes ?? [])),
    );
    const usedVariantSkus = collectUsedVariantSkus();

    const newVariants = combinations.reduce<VariantFormRow[]>((acc, combo) => {
      const attributes = generatorAttributes.map((attr) => ({
        key: attr.key,
        value: combo[attr.key],
      }));
      const signature = buildAttributeSignature(attributes);
      if (existingSignatures.has(signature)) {
        return acc;
      }
      existingSignatures.add(signature);
      const name = generatorAttributes.map((attr) => combo[attr.key]).join(" / ");
      acc.push({
        id: undefined,
        imageId: null,
        imageUrl: "",
        name,
        sku: generateNextVariantSku(usedVariantSkus),
        initialOnHand: undefined,
        attributes,
        canDelete: true,
      });
      return acc;
    }, []);

    if (!newVariants.length) {
      toast({ variant: "error", description: t("generatorNoNewVariants") });
      return;
    }

    append(newVariants);
    setGeneratorOpen(false);
  };

  const addBundleComponentFromSearch = (component: { id: string; name: string; sku: string }) => {
    if (readOnly) {
      return;
    }
    const existing = form.getValues("bundleComponents") ?? [];
    const duplicate = existing.some(
      (entry) => entry.componentProductId === component.id && !entry.componentVariantId,
    );
    if (duplicate) {
      toast({ variant: "error", description: t("bundleComponentDuplicate") });
      return;
    }
    appendBundleComponent({
      componentProductId: component.id,
      componentVariantId: null,
      qty: 1,
      componentName: component.name,
      componentSku: component.sku,
    });
    setBundleSearch("");
    setShowBundleResults(false);
  };

  const handleGenerateDescription = () => {
    if (readOnly || generateDescriptionMutation.isLoading) {
      return;
    }
    if (!descriptionSourceImageUrls.length) {
      toast({ variant: "error", description: t("aiDescriptionImageRequired") });
      return;
    }

    const descriptionLocale = normalizeLocale(locale) ?? defaultLocale;
    generateDescriptionMutation.mutate({
      locale: descriptionLocale,
      imageUrls: descriptionSourceImageUrls,
    });
  };

  const handleSubmit = (values: z.infer<typeof schema>) => {
    if (readOnly) {
      return;
    }
    const parsedVariants: ProductFormValues["variants"] = [];

    for (const [index, variant] of values.variants.entries()) {
      const attributes = variant.attributes ?? [];
      const hasContent =
        Boolean(variant.name?.trim()) ||
        (enableSku && Boolean(variant.sku?.trim())) ||
        (variant.initialOnHand !== undefined &&
          variant.initialOnHand !== null &&
          Number(variant.initialOnHand) > 0) ||
        attributes.some((entry) => {
          const value = entry.value;
          if (Array.isArray(value)) {
            return value.length > 0;
          }
          if (typeof value === "number") {
            return true;
          }
          return Boolean(String(value ?? "").trim());
        });
      if (!hasContent) {
        continue;
      }

      const definitionErrors = new Map<string, string>();
      for (const definition of requiredDefinitions) {
        const entryIndex = attributes.findIndex((entry) => entry.key === definition.key);
        const entry = entryIndex >= 0 ? attributes[entryIndex] : undefined;
        const value = entry?.value;
        const isMissing =
          value === undefined ||
          value === null ||
          (typeof value === "string" && value.trim().length === 0) ||
          (Array.isArray(value) && value.length === 0);
        if (isMissing) {
          definitionErrors.set(
            definition.key,
            t("attributeRequired", { attribute: resolveLabel(definition, definition.key) }),
          );
          if (entryIndex >= 0) {
            form.setError(`variants.${index}.attributes.${entryIndex}.value`, {
              message: t("attributeRequired", {
                attribute: resolveLabel(definition, definition.key),
              }),
            });
          }
        }
      }

      if (definitionErrors.size > 0) {
        return;
      }

      const parsedAttributes: Record<string, unknown> = {};
      for (const [attrIndex, entry] of attributes.entries()) {
        if (!entry.key) {
          continue;
        }
        const definition = definitionMap.get(entry.key);
        const rawValue = entry.value;
        if (
          rawValue === undefined ||
          rawValue === null ||
          (typeof rawValue === "string" && rawValue.trim().length === 0) ||
          (Array.isArray(rawValue) && rawValue.length === 0)
        ) {
          continue;
        }

        if (definition?.type === "NUMBER") {
          const parsed = typeof rawValue === "number" ? rawValue : Number(String(rawValue));
          if (!Number.isFinite(parsed)) {
            form.setError(`variants.${index}.attributes.${attrIndex}.value`, {
              message: t("attributeNumberInvalid"),
            });
            return;
          }
          parsedAttributes[entry.key] = parsed;
          continue;
        }

        if (definition?.type === "MULTI_SELECT") {
          const selected = Array.isArray(rawValue) ? rawValue.map((value) => String(value)) : [];
          if (selected.length) {
            parsedAttributes[entry.key] = selected;
          }
          continue;
        }

        parsedAttributes[entry.key] = String(rawValue);
      }

      parsedVariants.push({
        id: variant.id,
        imageId: variant.imageId?.trim() || null,
        imageUrl: variant.imageUrl?.trim() || null,
        name: variant.name?.trim() || undefined,
        sku: enableSku ? variant.sku?.trim() || undefined : undefined,
        initialOnHand: variant.initialOnHand,
        attributes: parsedAttributes,
      });
    }

    const normalizedImages =
      values.images
        ?.map((image) => ({
          id: image.id,
          url: image.url.trim(),
          position: image.position,
        }))
        .filter((image) => image.url.length > 0) ?? [];
    const fallbackPhotoUrl = values.photoUrl?.trim() || "";
    const resolvedImages =
      normalizedImages.length > 0
        ? normalizedImages.map((image, index) => ({ ...image, position: index }))
        : fallbackPhotoUrl
          ? [{ id: undefined, url: fallbackPhotoUrl, position: 0 }]
          : [];
    const resolvedPhotoUrl = resolvedImages.length > 0 ? resolvedImages[0].url : undefined;
    const hasInlineImage = resolvedImages.some((image) => image.url.startsWith("data:image/"));
    if (hasInlineImage || resolvedPhotoUrl?.startsWith("data:image/")) {
      toast({ variant: "error", description: t("imageReadFailed") });
      return;
    }

    const draftBarcode = enableBarcode ? normalizeProductBarcodeInput(barcodeInput) : "";
    if (draftBarcode && draftBarcode.length < minimumProductBarcodeLength) {
      form.setError("barcodes", {
        message: t("barcodeTooShort", { min: minimumProductBarcodeLength }),
      });
      return;
    }
    const submittedBarcodes = enableBarcode
      ? normalizeProductBarcodes([
          ...(values.barcodes ?? []),
          ...(draftBarcode ? [draftBarcode] : []),
        ])
      : normalizeProductBarcodes(values.barcodes ?? []);

    onSubmit({
      sku: values.sku.trim(),
      name: values.name.trim(),
      isBundle: Boolean(values.isBundle),
      category: categoryValues[0],
      categories: categoryValues,
      baseUnitId: values.baseUnitId,
      basePriceKgs: submitMoneyToKgs(values.basePriceKgs),
      purchasePriceKgs: submitMoneyToKgs(values.purchasePriceKgs),
      avgCostKgs: submitMoneyToKgs(values.avgCostKgs),
      initialOnHand: values.initialOnHand,
      minStock: values.minStock,
      description: values.description?.trim() || undefined,
      photoUrl: resolvedPhotoUrl,
      images: resolvedImages,
      barcodes: submittedBarcodes,
      packs:
        values.packs?.map((pack) => ({
          id: pack.id,
          packName: pack.packName.trim(),
          packBarcode: pack.packBarcode?.trim() || undefined,
          multiplierToBase: pack.multiplierToBase,
          allowInPurchasing: pack.allowInPurchasing ?? true,
          allowInReceiving: pack.allowInReceiving ?? true,
        })) ?? [],
      variants: parsedVariants,
      bundleComponents:
        values.bundleComponents
          ?.map((component) => ({
            componentProductId: component.componentProductId,
            componentVariantId: component.componentVariantId ?? null,
            qty: component.qty,
            componentName: component.componentName,
            componentSku: component.componentSku,
          }))
          .filter((component) => component.componentProductId) ?? [],
    });
  };

  const handleInvalidSubmit = (errors: FieldErrors<z.infer<typeof schema>>) => {
    if (errors.variants) {
      pendingVariantsEditorScrollRef.current = true;
      setShowAdvanced(true);
    }
    const message = getFirstFormErrorMessage(errors) ?? tErrors("validationError");
    toast({ variant: "error", description: message });
  };

  const handleConfirmRemoveVariant = () => {
    if (variantToRemove === null) {
      return;
    }
    const removedFieldId = fields[variantToRemove]?.id;
    remove(variantToRemove);
    if (removedFieldId) {
      setAttributeDrafts((prev) => {
        const next = { ...prev };
        delete next[removedFieldId];
        return next;
      });
    }
    setVariantToRemove(null);
  };

  const appendEmptyVariant = () => {
    if (readOnly) {
      return;
    }
    const existingEmptyDraftIndex = watchedVariants.findIndex((variant, index) => {
      const hasSavedId = Boolean(fields[index]?.id && variant.id);
      const attributes = Array.isArray(variant.attributes) ? variant.attributes : [];
      const hasAttributeValue = attributes.some((entry) => {
        const value = entry.value;
        if (Array.isArray(value)) {
          return value.length > 0;
        }
        return Boolean(String(value ?? "").trim());
      });
      return (
        !hasSavedId &&
        !variant.name?.trim() &&
        (!enableSku || !variant.sku?.trim()) &&
        !hasAttributeValue
      );
    });
    if (existingEmptyDraftIndex >= 0) {
      form.setValue(
        `variants.${existingEmptyDraftIndex}.sku`,
        generateNextVariantSku(collectUsedVariantSkus(existingEmptyDraftIndex)),
        {
          shouldDirty: true,
          shouldTouch: true,
          shouldValidate: true,
        },
      );
      scrollToVariantsEditor();
      return;
    }
    append({
      id: undefined,
      imageId: null,
      imageUrl: "",
      name: "",
      sku: generateNextVariantSku(),
      initialOnHand: undefined,
      attributes: toAttributeEntries({}),
      canDelete: true,
    });
    scrollToVariantsEditor();
  };

  const openVariantGenerator = () => {
    if (readOnly) {
      return;
    }
    scrollToVariantsEditor();
    setGeneratorOpen(true);
  };

  const variantSummaries = watchedVariants
    .map((variant, index) => {
      const attributes = Array.isArray(variant.attributes) ? variant.attributes : [];
      const hasAttributeValue = attributes.some((entry) => {
        const value = entry.value;
        if (Array.isArray(value)) {
          return value.length > 0;
        }
        return Boolean(String(value ?? "").trim());
      });
      const hasContent =
        Boolean(variant.id) ||
        Boolean(variant.name?.trim()) ||
        (enableSku && Boolean(variant.sku?.trim())) ||
        (variant.initialOnHand !== undefined &&
          variant.initialOnHand !== null &&
          Number(variant.initialOnHand) > 0) ||
        hasAttributeValue;
      return {
        index,
        key: fields[index]?.id ?? `${variant.name ?? variant.sku ?? "variant"}-${index}`,
        name: variant.name?.trim() || (enableSku ? variant.sku?.trim() : "") || `#${index + 1}`,
        attributeCount: attributes.length,
        hasContent,
      };
    })
    .filter((variant) => variant.hasContent);

  type CompactVariantOption = {
    key: string;
    name: string;
    values: string[];
  };

  const compactVariantOptions = useMemo<CompactVariantOption[]>(() => {
    const order: string[] = [];
    const namesByKey = new Map<string, string>();
    const valuesByKey = new Map<string, string[]>();
    const seenByKey = new Map<string, Set<string>>();

    watchedVariants.forEach((variant) => {
      const attributes = Array.isArray(variant.attributes) ? variant.attributes : [];
      attributes.forEach((entry) => {
        const key = resolveVariantOptionKey(entry.key);
        if (!key) {
          return;
        }
        if (!valuesByKey.has(key)) {
          valuesByKey.set(key, []);
          seenByKey.set(key, new Set<string>());
          namesByKey.set(key, resolveVariantOptionDisplayName(key));
          order.push(key);
        }
        const rawValues = Array.isArray(entry.value) ? entry.value : [entry.value];
        rawValues.forEach((rawValue) => {
          const value = normalizeVariantOptionLabel(String(rawValue ?? ""));
          const valueKey = value.toLocaleLowerCase("ru-RU");
          const seen = seenByKey.get(key);
          const values = valuesByKey.get(key);
          if (!value || !seen || !values || seen.has(valueKey)) {
            return;
          }
          seen.add(valueKey);
          values.push(value);
        });
      });
    });

    return order
      .map((key) => ({ key, name: namesByKey.get(key) ?? key, values: valuesByKey.get(key) ?? [] }))
      .filter((option) => option.values.length > 0);
  }, [resolveVariantOptionDisplayName, resolveVariantOptionKey, watchedVariants]);

  const compactVariantRows = watchedVariants
    .map((variant, index) => {
      const attributes = Array.isArray(variant.attributes) ? variant.attributes : [];
      const optionValues = compactVariantOptions
        .map((option) => {
          const entry = attributes.find(
            (attribute) => resolveVariantOptionKey(attribute.key) === option.key,
          );
          const value = Array.isArray(entry?.value)
            ? entry.value.map((item) => String(item)).join(", ")
            : String(entry?.value ?? "");
          return normalizeVariantOptionLabel(value);
        })
        .filter(Boolean);
      const hasContent =
        Boolean(variant.id) ||
        Boolean(variant.name?.trim()) ||
        (enableSku && Boolean(variant.sku?.trim())) ||
        (variant.initialOnHand !== undefined &&
          variant.initialOnHand !== null &&
          Number(variant.initialOnHand) > 0) ||
        optionValues.length > 0;

      return {
        index,
        key: fields[index]?.id ?? `${variant.name ?? variant.sku ?? "variant"}-${index}`,
        name: optionValues.join(" / ") || variant.name?.trim() || `#${index + 1}`,
        canDelete: fields[index]?.canDelete ?? variant.canDelete ?? true,
        hasContent,
      };
    })
    .filter((variant) => variant.hasContent);
  const variantOptionPreviewValues = mergeVariantOptionValues(
    variantOptionDraftValues,
    parseVariantOptionValues(variantOptionValueDraft),
  );

  const resetVariantOptionDraft = () => {
    setVariantOptionDraftName("");
    setVariantOptionValueDraft("");
    setVariantOptionDraftValues([]);
    setVariantOptionDraftImages({});
    setVariantOptionEditorOpen(false);
  };

  const addVariantOptionDraftValues = (rawValue: string) => {
    const values = parseVariantOptionValues(rawValue);
    if (!values.length) {
      return false;
    }
    setVariantOptionDraftValues((current) => mergeVariantOptionValues(current, values));
    setVariantOptionValueDraft("");
    return true;
  };

  const removeVariantOptionDraftValue = (value: string) => {
    const valueKey = normalizeVariantOptionValueKey(value);
    setVariantOptionDraftValues((current) => current.filter((item) => item !== value));
    setVariantOptionValueDraft((current) => {
      const currentValues = parseVariantOptionValues(current);
      if (!currentValues.some((item) => normalizeVariantOptionValueKey(item) === valueKey)) {
        return current;
      }
      return currentValues
        .filter((item) => normalizeVariantOptionValueKey(item) !== valueKey)
        .join(", ");
    });
    setVariantOptionDraftImages((current) => {
      if (!(valueKey in current)) {
        return current;
      }
      const next = { ...current };
      delete next[valueKey];
      return next;
    });
  };

  const setVariantOptionDraftImageValue = (value: string, imageValue: string) => {
    const valueKey = normalizeVariantOptionValueKey(value);
    setVariantOptionDraftImages((current) => {
      if (imageValue === "__none") {
        if (!(valueKey in current)) {
          return current;
        }
        const next = { ...current };
        delete next[valueKey];
        return next;
      }
      return { ...current, [valueKey]: imageValue };
    });
  };

  const buildVariantOptionSignature = (
    attributes: { key: string; value?: unknown }[] | undefined,
    optionKeys: string[],
  ) => {
    const allowedOptionKeys = new Set(optionKeys);
    return buildAttributeSignature(
      (attributes ?? [])
        .filter((entry) => allowedOptionKeys.has(resolveVariantOptionKey(entry.key)))
        .map((entry) => ({
          key: resolveVariantOptionKey(entry.key),
          value: entry.value,
        })),
    );
  };

  const rebuildCompactVariantsFromOptions = (
    options: CompactVariantOption[],
    imageAssignments?: { optionName: string; valuesByKey: Map<string, string> },
  ) => {
    const normalizedOptions = options
      .map((option) => ({
        key: resolveVariantOptionKey(option.key || option.name),
        name: resolveVariantOptionDisplayName(option.key || option.name),
        values: mergeVariantOptionValues([], option.values),
      }))
      .filter((option) => option.key && option.values.length > 0);

    if (!normalizedOptions.length) {
      replace([]);
      return;
    }

    const combinations = buildVariantMatrix(
      normalizedOptions.map((option) => ({
        key: option.key,
        values: option.values,
      })),
    );
    if (!combinations.length) {
      replace([]);
      return;
    }
    if (combinations.length > 200) {
      toast({
        variant: "error",
        description: t("generatorTooMany", { count: combinations.length }),
      });
      return;
    }

    const optionKeys = normalizedOptions.map((option) => option.key);
    const assignedOptionKey = imageAssignments
      ? resolveVariantOptionKey(imageAssignments.optionName)
      : "";
    const existingVariants = form.getValues("variants") ?? [];
    const existingBySignature = new Map<string, VariantFormRow>();
    existingVariants.forEach((variant) => {
      const signature = buildVariantOptionSignature(variant.attributes, optionKeys);
      if (!existingBySignature.has(signature)) {
        existingBySignature.set(signature, variant);
      }
    });
    const usedVariantSkus = collectUsedVariantSkus();
    const nextVariants = combinations.map<VariantFormRow>((combo) => {
      const attributes = normalizedOptions.map((option) => ({
        key: option.key,
        value: combo[option.key],
      }));
      const signature = buildVariantOptionSignature(attributes, optionKeys);
      const existing = existingBySignature.get(signature);
      const assignedImageValue = assignedOptionKey
        ? (normalizedOptions
            .map((option) => {
              if (option.key !== assignedOptionKey) {
                return null;
              }
              return imageAssignments?.valuesByKey.get(
                normalizeVariantOptionValueKey(String(combo[option.key] ?? "")),
              );
            })
            .find((value): value is string => Boolean(value)) ?? null)
        : null;
      const assignedImage = assignedImageValue
        ? variantImageOptionByValue.get(assignedImageValue)
        : null;
      return {
        id: existing?.id,
        imageId: assignedImage ? (assignedImage.imageId ?? null) : (existing?.imageId ?? null),
        imageUrl: assignedImage ? assignedImage.url : (existing?.imageUrl ?? ""),
        name: normalizedOptions.map((option) => String(combo[option.key])).join(" / "),
        sku: existing?.sku?.trim() || generateNextVariantSku(usedVariantSkus),
        initialOnHand: existing?.initialOnHand,
        attributes,
        canDelete: existing?.canDelete ?? true,
      };
    });

    replace(nextVariants);
  };

  const handleSaveVariantOption = () => {
    const name = normalizeVariantOptionLabel(variantOptionDraftName);
    const optionKey = resolveVariantOptionKey(name);
    const optionDisplayName = resolveVariantOptionDisplayName(name);
    const values = mergeVariantOptionValues(
      variantOptionDraftValues,
      parseVariantOptionValues(variantOptionValueDraft),
    );
    if (!name) {
      toast({ variant: "error", description: t("variantOptionNameRequired") });
      return;
    }
    if (!values.length) {
      toast({ variant: "error", description: t("variantOptionValuesRequired") });
      return;
    }

    const existingIndex = compactVariantOptions.findIndex((option) => option.key === optionKey);
    const nextOptions =
      existingIndex >= 0
        ? compactVariantOptions.map((option, index) =>
            index === existingIndex
              ? { ...option, values: mergeVariantOptionValues(option.values, values) }
              : option,
          )
        : [...compactVariantOptions, { key: optionKey, name: optionDisplayName, values }];

    const assignedImages = new Map<string, string>();
    values.forEach((value) => {
      const valueKey = normalizeVariantOptionValueKey(value);
      const imageValue = variantOptionDraftImages[valueKey];
      if (imageValue && variantImageOptionByValue.has(imageValue)) {
        assignedImages.set(valueKey, imageValue);
      }
    });

    rebuildCompactVariantsFromOptions(
      nextOptions,
      assignedImages.size ? { optionName: optionKey, valuesByKey: assignedImages } : undefined,
    );
    resetVariantOptionDraft();
  };

  const handleRemoveVariantOption = (key: string) => {
    rebuildCompactVariantsFromOptions(compactVariantOptions.filter((option) => option.key !== key));
  };

  const pendingImageUploadStatusLabel = (status: PendingImageUploadStatus) => {
    switch (status) {
      case "validating":
        return t("imageUploadStatusValidating");
      case "optimizing":
        return t("imageUploadStatusOptimizing");
      case "uploading":
        return t("imageUploadStatusUploading");
      case "uploaded":
        return t("imageUploadStatusUploaded");
      case "failed":
        return t("imageUploadStatusFailed");
      case "selected":
      default:
        return t("imageUploadStatusSelected");
    }
  };
  const mobileProductSectionClassName =
    "rounded-md border border-border/70 bg-background p-4 md:border-0 md:bg-transparent md:p-0";
  const editorFormCardClassName = "product-editor-card-form";

  const pendingImageUploadCards = pendingImageUploads.length ? (
    <div className="grid gap-3 sm:grid-cols-2">
      {pendingImageUploads.map((upload) => {
        const isBusy =
          upload.status === "selected" ||
          upload.status === "validating" ||
          upload.status === "optimizing" ||
          upload.status === "uploading";
        const showProgress = upload.status === "uploading" && upload.progress !== null;
        return (
          <div
            key={upload.id}
            className="grid min-w-0 grid-cols-[88px_minmax(0,1fr)] gap-3 border border-border bg-card p-3 sm:grid-cols-[104px_minmax(0,1fr)]"
          >
            <div className="flex h-[88px] w-[88px] items-center justify-center overflow-hidden bg-muted/30 sm:h-[104px] sm:w-[104px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={upload.previewUrl}
                alt={upload.fileName}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0 space-y-2">
              <div className="flex min-w-0 items-center gap-2">
                {isBusy ? <Spinner className="h-4 w-4 shrink-0" /> : null}
                {upload.status === "uploaded" ? (
                  <StatusSuccessIcon className="h-4 w-4 shrink-0 text-success" aria-hidden />
                ) : null}
                <span className="truncate text-sm font-medium text-foreground">
                  {upload.fileName}
                </span>
              </div>
              <p
                className={`text-xs ${
                  upload.status === "failed" ? "text-danger" : "text-muted-foreground"
                }`}
              >
                {upload.error ?? pendingImageUploadStatusLabel(upload.status)}
              </p>
              {showProgress ? (
                <div className="h-2 overflow-hidden bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${upload.progress ?? 0}%` }}
                  />
                </div>
              ) : null}
              {upload.status === "failed" ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-8 px-3 text-xs"
                    onClick={() => void handleRetryPendingImageUpload(upload.id)}
                    disabled={isUploadingImages || readOnly}
                  >
                    <RestoreIcon className="h-3.5 w-3.5" aria-hidden />
                    {t("imageRetry")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 px-3 text-xs"
                    onClick={() => removePendingImageUpload(upload.id)}
                    disabled={readOnly}
                  >
                    <CloseIcon className="h-3.5 w-3.5" aria-hidden />
                    {t("imageRemove")}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  ) : null;

  const imageManagementSection = (
    <FormSection
      title={t("imagesTitle")}
      description={t("imagesHint")}
      className={mobileProductSectionClassName}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={productImageAccept}
          multiple
          className="hidden"
          disabled={readOnly || isUploadingImages}
          onChange={handleImageInputChange}
        />
        <Button
          type="button"
          variant="secondary"
          className="w-full sm:w-auto"
          onClick={() => {
            pendingVariantImageUploadTargetRef.current = null;
            fileInputRef.current?.click();
          }}
          disabled={readOnly || isUploadingImages}
        >
          {isUploadingImages ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <ImagePlusIcon className="h-4 w-4" aria-hidden />
          )}
          {isUploadingImages ? tCommon("loading") : t("imagesAdd")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("imagesReorderHint")}</span>
      </div>
      <div
        className={`rounded-md border border-dashed px-4 py-4 text-sm text-muted-foreground transition ${
          isDragActive ? "border-ink bg-muted/30" : "border-border"
        }`}
        onDragOver={handleImageDragOver}
        onDragLeave={handleImageDragLeave}
        onDrop={handleImageDrop}
      >
        {t("imagesDrop")}
      </div>
      {pendingImageUploadCards}
      {imageFields.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {imageFields.map((image, index) => {
            const imageUrl = watchedImages[index]?.url?.trim() || image.url;
            const canMoveUp = index > 0;
            const canMoveDown = index < imageFields.length - 1;
            return (
              <div
                key={image.fieldId}
                className={`grid min-w-0 grid-cols-[96px_minmax(0,1fr)] gap-3 rounded-md border border-border bg-card p-3 sm:flex sm:items-start ${
                  draggedImageIndex === index ? "opacity-60" : ""
                }`}
                draggable={!readOnly}
                onDragStart={() => {
                  if (readOnly) {
                    return;
                  }
                  setDraggedImageIndex(index);
                }}
                onDragEnd={() => setDraggedImageIndex(null)}
                onDragOver={(event) => {
                  if (draggedImageIndex === null || readOnly) {
                    return;
                  }
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedImageIndex === null || draggedImageIndex === index || readOnly) {
                    return;
                  }
                  handleMoveImage(draggedImageIndex, index);
                  setDraggedImageIndex(null);
                }}
              >
                <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-md bg-muted/30 sm:h-36 sm:w-36 sm:shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={withPreviewVersion(imageUrl, image.fieldId)}
                    alt={t("imageAlt", { index: index + 1 })}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {index === 0 ? <Badge variant="muted">{t("imagePrimary")}</Badge> : null}
                    <span className="text-xs text-muted-foreground">
                      {t("imagePosition", {
                        index: index + 1,
                        total: imageFields.length,
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <GripIcon className="h-4 w-4" aria-hidden />
                    {t("imageDragHint")}
                  </div>
                  <div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-8 px-3 text-xs"
                      onClick={() => void openImageEditor(index, imageUrl)}
                      disabled={isUploadingImages || isSavingImageEdit}
                    >
                      {readOnly ? (
                        <ViewIcon className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <EditIcon className="h-3.5 w-3.5" aria-hidden />
                      )}
                      {readOnly ? t("imagePreview") : t("imagePreviewEdit")}
                    </Button>
                  </div>
                </div>
                <div className="col-span-2 flex items-center justify-end gap-2 sm:col-auto sm:flex-col">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shadow-none"
                        aria-label={t("imageMoveUp")}
                        onClick={() => canMoveUp && handleMoveImage(index, index - 1)}
                        disabled={!canMoveUp || readOnly}
                      >
                        <ArrowUpIcon className="h-4 w-4" aria-hidden />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("imageMoveUp")}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shadow-none"
                        aria-label={t("imageMoveDown")}
                        onClick={() => canMoveDown && handleMoveImage(index, index + 1)}
                        disabled={!canMoveDown || readOnly}
                      >
                        <ArrowDownIcon className="h-4 w-4" aria-hidden />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("imageMoveDown")}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-danger shadow-none hover:text-danger"
                        aria-label={t("imageRemove")}
                        onClick={() => handleRemoveImageAt(index)}
                        disabled={readOnly}
                      >
                        <DeleteIcon className="h-4 w-4" aria-hidden />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("imageRemove")}</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground/80">{t("imagesEmpty")}</p>
      )}
      {!compactCreate ? (
        <FormField
          control={form.control}
          name="photoUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("photoUrl")}</FormLabel>
              {orderedImageUrls.length ? (
                <div className="space-y-2">
                  {orderedImageUrls.map((image, index) => (
                    <a
                      key={image.id ?? `${image.url}-${index}`}
                      href={image.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block space-y-1 rounded-md border border-border bg-card px-3 py-2 transition hover:bg-muted/30"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {index === 0 ? (
                            <Badge variant="muted">{t("imagePrimary")}</Badge>
                          ) : (
                            <Badge variant="muted">{`#${index + 1}`}</Badge>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {t("imagePosition", {
                              index: index + 1,
                              total: orderedImageUrls.length,
                            })}
                          </span>
                        </div>
                        <ViewIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                      </div>
                      <p className="break-all text-xs text-muted-foreground">{image.url}</p>
                    </a>
                  ))}
                </div>
              ) : (
                <FormControl>
                  <Input {...field} value={field.value ?? ""} disabled={readOnly} />
                </FormControl>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}
    </FormSection>
  );

  const barcodeManagementSection = (
    <FormSection title={t("barcodes")} className={mobileProductSectionClassName}>
      <FormField
        control={form.control}
        name="barcodes"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="sr-only">{t("barcodes")}</FormLabel>
            <FormRow className="flex-col items-stretch sm:flex-row sm:items-end">
              <FormControl>
                <Input
                  value={barcodeInput}
                  onChange={(event) => setBarcodeInput(event.target.value)}
                  onKeyDown={handleBarcodeInputKeyDown}
                  placeholder={t("barcodePlaceholder")}
                  className="flex-1"
                  disabled={readOnly}
                />
              </FormControl>
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={addBarcodeFromDraft}
                disabled={readOnly}
              >
                <AddIcon className="h-4 w-4" aria-hidden />
                {t("addBarcode")}
              </Button>
            </FormRow>
            <FormRow className="flex-col items-stretch sm:flex-row sm:items-end">
              <div className="w-full sm:w-[220px]">
                <Select
                  value={barcodeGenerateMode}
                  onValueChange={(value) => setBarcodeGenerateMode(value as "EAN13" | "CODE128")}
                  disabled={readOnly || !productId || generateBarcodeMutation.isLoading}
                >
                  <SelectTrigger aria-label={t("generateBarcodeMode")}>
                    <SelectValue placeholder={t("generateBarcodeMode")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EAN13">{t("barcodeModeEan13")}</SelectItem>
                    <SelectItem value="CODE128">{t("barcodeModeCode128")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => {
                  if (!productId || readOnly) {
                    return;
                  }
                  const currentBarcodes =
                    form
                      .getValues("barcodes")
                      ?.map((value) => value.trim())
                      .filter(Boolean) ?? [];
                  generateBarcodeMutation.mutate({
                    productId,
                    mode: barcodeGenerateMode,
                    force: currentBarcodes.length === 0,
                  });
                }}
                disabled={readOnly || !productId || generateBarcodeMutation.isLoading}
              >
                {generateBarcodeMutation.isLoading ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <AddIcon className="h-4 w-4" aria-hidden />
                )}
                {generateBarcodeMutation.isLoading ? tCommon("loading") : t("generateBarcode")}
              </Button>
            </FormRow>
            <p className="text-xs text-muted-foreground">{t("barcodeScanHint")}</p>
            {!productId ? (
              <p className="text-xs text-muted-foreground">{t("barcodeGenerateRequiresSave")}</p>
            ) : null}
            <div className="flex min-h-[36px] flex-wrap gap-2">
              {field.value?.length ? (
                field.value.map((barcode, index) => (
                  <Badge key={`${barcode}-${index}`} variant="muted" className="gap-1 pr-1">
                    <span>{barcode}</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 shadow-none"
                          aria-label={t("removeBarcode")}
                          onClick={() => {
                            if (readOnly) {
                              return;
                            }
                            const next = (field.value ?? []).filter((_, i) => i !== index);
                            form.clearErrors("barcodes");
                            form.setValue("barcodes", next, {
                              shouldValidate: false,
                              shouldDirty: true,
                            });
                          }}
                          disabled={readOnly}
                        >
                          <CloseIcon className="h-3 w-3" aria-hidden />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("removeBarcode")}</TooltipContent>
                    </Tooltip>
                  </Badge>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">{t("barcodeEmpty")}</p>
              )}
            </div>
            <FormDescription>{t("barcodeHint")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormSection>
  );

  const variantSetupSection = (
    <FormSection
      title={t("variantSetupTitle")}
      description={t("variantSetupHint")}
      className={mobileProductSectionClassName}
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-md border border-border/70 bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {t("variantSetupCount", { count: variantSummaries.length })}
            </p>
            <p className="text-xs text-muted-foreground">{t("variantSetupAdvancedHint")}</p>
          </div>
          {!readOnly ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              {generatorDefinitions.length ? (
                <Button type="button" variant="secondary" onClick={openVariantGenerator}>
                  {t("generateVariants")}
                </Button>
              ) : null}
              <Button type="button" variant="secondary" onClick={appendEmptyVariant}>
                <AddIcon className="h-4 w-4" aria-hidden />
                {t("addVariant")}
              </Button>
            </div>
          ) : null}
        </div>

        {variantSummaries.length ? (
          <div className="grid gap-2 md:grid-cols-2">
            {variantSummaries.map((variant) => (
              <div key={variant.key} className="rounded-md border border-border/70 bg-card p-3">
                <p className="truncate text-sm font-semibold text-foreground">{variant.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t("variantSetupAttributes", { count: variant.attributeCount })}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("variantsEmpty")}</p>
        )}
      </div>
    </FormSection>
  );

  const quickImageUrl = orderedImageUrls[0]?.url ?? watchedPhotoUrl?.trim() ?? "";
  const quickImageSection = (
    <FormSection title={t("quickCreatePhotoTitle")} className={mobileProductSectionClassName}>
      <div className="grid gap-4 md:grid-cols-[160px_1fr]">
        <div className="flex h-40 w-full items-center justify-center overflow-hidden border border-dashed border-border bg-muted/30 md:w-40">
          {quickImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={quickImageUrl}
              alt={t("imageAlt", { index: 1 })}
              className="h-full w-full object-cover"
            />
          ) : (
            <ImagePlusIcon className="h-8 w-8 text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="space-y-3">
          <Button
            type="button"
            variant="secondary"
            className="w-full sm:w-auto"
            onClick={() => {
              pendingVariantImageUploadTargetRef.current = null;
              quickFileInputRef.current?.click();
            }}
            disabled={readOnly || isUploadingImages}
          >
            {isUploadingImages ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <ImagePlusIcon className="h-4 w-4" aria-hidden />
            )}
            {isUploadingImages ? tCommon("loading") : t("imagesAdd")}
          </Button>
          {pendingImageUploadCards}
          {orderedImageUrls.length ? (
            <div className="flex flex-wrap gap-2 pb-1">
              {orderedImageUrls.map((image, index) => (
                <div
                  key={image.id ?? `${image.url}-${index}`}
                  className="relative h-20 w-20 shrink-0 overflow-hidden border border-border bg-muted/30"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={withPreviewVersion(image.url, image.id ?? image.url)}
                    alt={t("imageAlt", { index: index + 1 })}
                    className="h-full w-full object-cover"
                  />
                  {!readOnly ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      className="absolute right-1 top-1 h-6 w-6 shadow-none"
                      aria-label={t("imageRemove")}
                      onClick={() => handleRemoveImageAt(index)}
                      disabled={isUploadingImages}
                    >
                      <CloseIcon className="h-3 w-3" aria-hidden />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          <FormField
            control={form.control}
            name="photoUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("photoUrl")}</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} disabled={readOnly} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>
    </FormSection>
  );

  const duplicateDiagnosticsPanel = duplicateDiagnosticsEnabled ? (
    <div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{t("duplicateDiagnosticsTitle")}</p>
        {duplicateDiagnosticsQuery.isFetching ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="h-4 w-4" />
            {t("duplicateDiagnosticsLoading")}
          </div>
        ) : null}
      </div>
      <div className="mt-3 space-y-2">
        {enableSku && duplicateDiagnosticsQuery.data?.exactSkuMatch ? (
          <div className="rounded-md border border-danger/30 bg-background p-3">
            <p className="text-xs font-semibold text-danger">{t("duplicateExactSkuTitle")}</p>
            <p className="mt-1 text-sm text-foreground">
              {duplicateDiagnosticsQuery.data.exactSkuMatch.name}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="muted">{duplicateDiagnosticsQuery.data.exactSkuMatch.sku}</Badge>
              {duplicateDiagnosticsQuery.data.exactSkuMatch.isDeleted ? (
                <Badge variant="muted">{t("archived")}</Badge>
              ) : null}
              <Link
                href={`/products/${duplicateDiagnosticsQuery.data.exactSkuMatch.id}`}
                target="_blank"
                className="text-primary underline-offset-4 hover:underline"
              >
                {t("duplicateOpenProduct")}
              </Link>
            </div>
          </div>
        ) : null}
        {enableBarcode && duplicateDiagnosticsQuery.data?.exactBarcodeMatches.length
          ? duplicateDiagnosticsQuery.data.exactBarcodeMatches.map((match) => (
              <div
                key={`${match.barcode}-${match.id}`}
                className="rounded-md border border-danger/30 bg-background p-3"
              >
                <p className="text-xs font-semibold text-danger">
                  {t("duplicateExactBarcodesTitle")}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge variant="muted">{match.barcode}</Badge>
                  <span className="text-sm text-foreground">{match.name}</span>
                  {enableSku ? (
                    <span className="text-xs text-muted-foreground">{match.sku}</span>
                  ) : null}
                  {match.isDeleted ? <Badge variant="muted">{t("archived")}</Badge> : null}
                </div>
                <Link
                  href={`/products/${match.id}`}
                  target="_blank"
                  className="mt-2 inline-flex text-xs text-primary underline-offset-4 hover:underline"
                >
                  {t("duplicateOpenProduct")}
                </Link>
              </div>
            ))
          : null}
        {duplicateDiagnosticsQuery.data?.likelyNameMatches.length ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground">
              {t("duplicateLikelyMatchesTitle")}
            </p>
            {duplicateDiagnosticsQuery.data.likelyNameMatches.map((match) => (
              <div key={match.id} className="rounded-md border border-warning/30 bg-background p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-foreground">{match.name}</span>
                  {enableSku ? <Badge variant="muted">{match.sku}</Badge> : null}
                  {match.isDeleted ? <Badge variant="muted">{t("archived")}</Badge> : null}
                </div>
                <Link
                  href={`/products/${match.id}`}
                  target="_blank"
                  className="mt-2 inline-flex text-xs text-primary underline-offset-4 hover:underline"
                >
                  {t("duplicateOpenProduct")}
                </Link>
              </div>
            ))}
          </div>
        ) : null}
        {!duplicateDiagnosticsQuery.isFetching &&
        !(enableSku && duplicateDiagnosticsQuery.data?.exactSkuMatch) &&
        !(enableBarcode && duplicateDiagnosticsQuery.data?.exactBarcodeMatches.length) &&
        !duplicateDiagnosticsQuery.data?.likelyNameMatches.length ? (
          <p className="text-xs text-muted-foreground">{t("duplicateDiagnosticsEmpty")}</p>
        ) : null}
      </div>
    </div>
  ) : null;

  const shopifyMediaBlock = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>{t("imagesTitle")}</Label>
        <input
          ref={quickFileInputRef}
          type="file"
          accept={productImageAccept}
          multiple
          className="hidden"
          disabled={readOnly || isUploadingImages}
          onChange={handleImageInputChange}
        />
      </div>
      <div
        className={`rounded-lg border border-dashed px-4 py-6 text-center transition ${
          isDragActive ? "border-ink bg-muted/40" : "border-black/20 bg-muted/20"
        }`}
        onDragOver={handleImageDragOver}
        onDragLeave={handleImageDragLeave}
        onDrop={handleImageDrop}
      >
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            pendingVariantImageUploadTargetRef.current = null;
            quickFileInputRef.current?.click();
          }}
          disabled={readOnly || isUploadingImages}
        >
          {isUploadingImages ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <ImagePlusIcon className="h-4 w-4" aria-hidden />
          )}
          {isUploadingImages ? tCommon("loading") : t("imagesAdd")}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">{t("imagesDrop")}</p>
      </div>
      {pendingImageUploadCards}
      {imageFields.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {imageFields.map((image, index) => {
            const imageUrl = watchedImages[index]?.url?.trim() || image.url?.trim() || "";
            const canMoveUp = index > 0;
            const canMoveDown = index < imageFields.length - 1;
            return (
              <div
                key={image.fieldId}
                className={`group min-w-0 overflow-hidden rounded-md border border-border bg-card ${
                  draggedImageIndex === index ? "opacity-60" : ""
                }`}
                draggable={!readOnly}
                onDragStart={() => {
                  if (readOnly) {
                    return;
                  }
                  setDraggedImageIndex(index);
                }}
                onDragEnd={() => setDraggedImageIndex(null)}
                onDragOver={(event) => {
                  if (draggedImageIndex === null || readOnly) {
                    return;
                  }
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedImageIndex === null || draggedImageIndex === index || readOnly) {
                    return;
                  }
                  handleMoveImage(draggedImageIndex, index);
                  setDraggedImageIndex(null);
                }}
              >
                <button
                  type="button"
                  className="relative block aspect-square w-full overflow-hidden bg-muted/30 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  aria-label={readOnly ? t("imagePreview") : t("imagePreviewEdit")}
                  onClick={() => void openImageEditor(index, imageUrl)}
                  disabled={!imageUrl || isUploadingImages || isSavingImageEdit}
                >
                  {imageUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={withPreviewVersion(imageUrl, image.fieldId)}
                        alt={t("imageAlt", { index: index + 1 })}
                        className="h-full w-full object-cover"
                      />
                      <span className="absolute inset-x-2 bottom-2 inline-flex items-center justify-center gap-1 rounded-md bg-black/70 px-2 py-1 text-xs font-medium text-white opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                        {readOnly ? (
                          <ViewIcon className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <EditIcon className="h-3.5 w-3.5" aria-hidden />
                        )}
                        {readOnly ? t("imagePreview") : t("imageEdit")}
                      </span>
                    </>
                  ) : null}
                  {index === 0 ? (
                    <Badge variant="muted" className="absolute left-1.5 top-1.5">
                      {t("imagePrimary")}
                    </Badge>
                  ) : null}
                </button>
                <div className="space-y-2 p-2">
                  <span className="block min-w-0 truncate text-[11px] text-muted-foreground">
                    {t("imagePosition", {
                      index: index + 1,
                      total: imageFields.length,
                    })}
                  </span>
                  {!readOnly && canMoveUp ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-8 w-full justify-center px-2 text-xs shadow-none"
                      onClick={() => handleMoveImage(index, 0)}
                      disabled={isUploadingImages}
                    >
                      {t("imageSetPrimary")}
                    </Button>
                  ) : null}
                  <div className="grid grid-cols-3 gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-full shadow-none"
                          aria-label={t("imageMoveUp")}
                          onClick={() => canMoveUp && handleMoveImage(index, index - 1)}
                          disabled={!canMoveUp || readOnly || isUploadingImages}
                        >
                          <ArrowUpIcon className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("imageMoveUp")}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-full shadow-none"
                          aria-label={t("imageMoveDown")}
                          onClick={() => canMoveDown && handleMoveImage(index, index + 1)}
                          disabled={!canMoveDown || readOnly || isUploadingImages}
                        >
                          <ArrowDownIcon className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("imageMoveDown")}</TooltipContent>
                    </Tooltip>
                    {!readOnly ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-full text-danger shadow-none hover:text-danger"
                            aria-label={t("imageRemove")}
                            onClick={() => handleRemoveImageAt(index)}
                            disabled={isUploadingImages}
                          >
                            <CloseIcon className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("imageRemove")}</TooltipContent>
                      </Tooltip>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("imagesEmpty")}</p>
      )}
      {!readOnly ? (
        <div className="space-y-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-0 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowImageUrlInput((current) => !current)}
          >
            <AddIcon className="h-3.5 w-3.5" aria-hidden />
            {t("imageAddByUrl")}
          </Button>
          {showImageUrlInput ? (
            <FormRow className="flex-col items-stretch gap-2 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="product-image-url">{t("photoUrl")}</Label>
                <Input
                  id="product-image-url"
                  value={imageUrlDraft}
                  onChange={(event) => setImageUrlDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") {
                      return;
                    }
                    event.preventDefault();
                    addImageUrlFromDraft();
                  }}
                  placeholder={t("imageUrlPlaceholder")}
                  disabled={isUploadingImages}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={addImageUrlFromDraft}
                disabled={isUploadingImages}
              >
                {t("imageUrlAdd")}
              </Button>
            </FormRow>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const shopifyCategoryPicker = (
    <FormField
      control={form.control}
      name="categories"
      render={() => (
        <FormItem>
          <FormLabel>{t("category")}</FormLabel>
          <div className="space-y-3">
            <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border border-input bg-background px-2 py-1.5">
              {categoryValues.length ? (
                categoryValues.map((value, index) => {
                  const categoryMeta = categoryMetaByKey.get(normalizeCategoryKey(value) ?? "");
                  const isHiddenCategory = Boolean(
                    categoryMeta && (!categoryMeta.isVisibleInForms || categoryMeta.isArchived),
                  );
                  return (
                    <Badge key={value} variant="muted" className="gap-1 pr-1">
                      <span>{value}</span>
                      {index === 0 ? <span className="text-muted-foreground">•</span> : null}
                      {index === 0 ? <span>{t("categoryPrimaryBadge")}</span> : null}
                      {isHiddenCategory ? <span>{t("categoryHiddenBadge")}</span> : null}
                      {!readOnly && index > 0 ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 shadow-none"
                          aria-label={t("categoryPromote")}
                          onClick={() => promoteProductCategory(value)}
                        >
                          <ArrowUpIcon className="h-3 w-3" aria-hidden />
                        </Button>
                      ) : null}
                      {!readOnly ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 shadow-none"
                          aria-label={tCommon("delete")}
                          onClick={() => removeProductCategory(value)}
                        >
                          <CloseIcon className="h-3 w-3" aria-hidden />
                        </Button>
                      ) : null}
                    </Badge>
                  );
                })
              ) : (
                <span className="text-sm text-muted-foreground">{tCommon("notAvailable")}</span>
              )}
            </div>
            {!readOnly ? (
              <>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={categoryDraft}
                    onChange={(event) => setCategoryDraft(event.target.value)}
                    placeholder={t("categoryPlaceholder")}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") {
                        return;
                      }
                      event.preventDefault();
                      if (addProductCategory(categoryDraft)) {
                        setCategoryDraft("");
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="shrink-0"
                    onClick={() => {
                      if (addProductCategory(categoryDraft)) {
                        setCategoryDraft("");
                      }
                    }}
                  >
                    <AddIcon className="h-4 w-4" aria-hidden />
                    {t("categoryAdd")}
                  </Button>
                </div>
                {suggestedCategoryOptions.length ? (
                  <div className="flex flex-wrap gap-2">
                    {suggestedCategoryOptions.slice(0, 6).map((option) => (
                      <Button
                        key={option.name}
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 rounded-md border border-border bg-secondary/40 px-2.5 text-xs"
                        onClick={() => addProductCategory(option.name)}
                      >
                        <AddIcon className="h-3 w-3" aria-hidden />
                        {option.name}
                      </Button>
                    ))}
                  </div>
                ) : categoryDraftQuery ? (
                  <p className="text-xs text-muted-foreground">{t("categoryNoSuggestions")}</p>
                ) : null}
                {showHiddenCategoryCount ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-0 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setShowHiddenCategoryOptions((current) => !current)}
                  >
                    {showHiddenCategoryOptions
                      ? t("categoryHideHidden")
                      : t("categoryShowHidden", { count: showHiddenCategoryCount })}
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const shopifyPackRows = (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            appendPack({
              packName: "",
              packBarcode: "",
              multiplierToBase: 1,
              allowInPurchasing: true,
              allowInReceiving: true,
            })
          }
          disabled={readOnly}
        >
          <AddIcon className="h-4 w-4" aria-hidden />
          {t("addPack")}
        </Button>
      </div>
      {packFields.length ? (
        <div className="space-y-3">
          {packFields.map((field, index) => (
            <div key={field.id} className="space-y-3 rounded-md border border-border/80 p-3">
              <ProductEditorFieldGrid>
                <FormField
                  control={form.control}
                  name={`packs.${index}.packName`}
                  render={({ field: itemField }) => (
                    <FormItem>
                      <FormLabel>{t("packName")}</FormLabel>
                      <FormControl>
                        <Input {...itemField} value={itemField.value ?? ""} disabled={readOnly} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`packs.${index}.multiplierToBase`}
                  render={({ field: itemField }) => (
                    <FormItem>
                      <FormLabel>{t("packMultiplier")}</FormLabel>
                      <FormControl>
                        <Input
                          {...itemField}
                          value={itemField.value ?? ""}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          disabled={readOnly}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {enableBarcode ? (
                  <FormField
                    control={form.control}
                    name={`packs.${index}.packBarcode`}
                    render={({ field: itemField }) => (
                      <FormItem>
                        <FormLabel>{t("packBarcode")}</FormLabel>
                        <FormControl>
                          <Input
                            {...(() => {
                              const { value: _value, ...rest } = itemField;
                              void _value;
                              return rest;
                            })()}
                            value={itemField.value ?? ""}
                            onChange={(event) => itemField.onChange(event.target.value)}
                            disabled={readOnly}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : null}
              </ProductEditorFieldGrid>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-4">
                  <FormField
                    control={form.control}
                    name={`packs.${index}.allowInPurchasing`}
                    render={({ field: itemField }) => (
                      <FormItem className="flex items-center gap-2 space-y-0">
                        <FormControl>
                          <Switch
                            checked={itemField.value}
                            onCheckedChange={itemField.onChange}
                            disabled={readOnly}
                          />
                        </FormControl>
                        <FormLabel className="text-sm">{t("packAllowPurchasing")}</FormLabel>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`packs.${index}.allowInReceiving`}
                    render={({ field: itemField }) => (
                      <FormItem className="flex items-center gap-2 space-y-0">
                        <FormControl>
                          <Switch
                            checked={itemField.value}
                            onCheckedChange={itemField.onChange}
                            disabled={readOnly}
                          />
                        </FormControl>
                        <FormLabel className="text-sm">{t("packAllowReceiving")}</FormLabel>
                      </FormItem>
                    )}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:text-danger"
                  onClick={() => removePack(index)}
                  disabled={readOnly}
                >
                  <DeleteIcon className="h-4 w-4" aria-hidden />
                  {t("removePack")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("packsEmpty")}</p>
      )}
      <p className="text-xs text-muted-foreground">{t("packsHint")}</p>
    </div>
  );

  if (shopifyEditor) {
    return (
      <Form {...form}>
        <form
          id={formId}
          className="space-y-3 sm:space-y-4"
          onSubmit={form.handleSubmit(handleSubmit, handleInvalidSubmit)}
        >
          <TooltipProvider>
            <ProductEditorCard
              title={t("productInformationTitle")}
              className={editorFormCardClassName}
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("name")}</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} disabled={readOnly} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <FormLabel>{t("description")}</FormLabel>
                      {!readOnly ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={handleGenerateDescription}
                          disabled={
                            isUploadingImages ||
                            generateDescriptionMutation.isLoading ||
                            !descriptionSourceImageUrls.length
                          }
                        >
                          {generateDescriptionMutation.isLoading ? (
                            <Spinner className="h-4 w-4" />
                          ) : (
                            <SparklesIcon className="h-4 w-4" />
                          )}
                          {generateDescriptionMutation.isLoading
                            ? t("aiDescriptionGenerating")
                            : t("aiDescriptionGenerate")}
                        </Button>
                      ) : null}
                    </div>
                    <FormControl>
                      <Textarea {...field} rows={7} disabled={readOnly} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {shopifyMediaBlock}
              {duplicateDiagnosticsPanel}
            </ProductEditorCard>

            <ProductEditorCard title={t("category")} className={editorFormCardClassName}>
              {shopifyCategoryPicker}
              {!unitOptions.length ? (
                <FormField
                  control={form.control}
                  name="baseUnitId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("unit")}</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={readOnly || !unitOptions.length}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t("unitPlaceholder")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {unitOptions.map((unit) => (
                            <SelectItem key={unit.id} value={unit.id}>
                              {resolveUnitLabel(unit)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>{t("unitMissingHint")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}
            </ProductEditorCard>

            <ProductEditorCard title={t("pricingTitle")} className={editorFormCardClassName}>
              <ProductEditorFieldGrid>
                {showBasePriceField ? (
                  <FormField
                    control={form.control}
                    name="basePriceKgs"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("salePrice")}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            value={field.value ?? ""}
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            placeholder={t("pricePlaceholder")}
                            disabled={readOnly}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : null}
                <FormField
                  control={form.control}
                  name="avgCostKgs"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("quickAvgCost")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ""}
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          placeholder={t("pricePlaceholder")}
                          disabled={readOnly}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </ProductEditorFieldGrid>
            </ProductEditorCard>

            <ProductEditorCard title={t("inventoryTitle")} className={editorFormCardClassName}>
              <ProductEditorFieldGrid>
                {canEditInitialStock ? (
                  <FormField
                    control={form.control}
                    name="initialOnHand"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("initialOnHand")}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            value={field.value ?? ""}
                            type="number"
                            inputMode="numeric"
                            min={0}
                            step={1}
                            placeholder={t("initialOnHandPlaceholder")}
                            onKeyDown={preventInvalidIntegerInput}
                            disabled={readOnly}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : null}
                <FormField
                  control={form.control}
                  name="minStock"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("quickMinStock")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ""}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          step={1}
                          placeholder={t("minStockPlaceholder")}
                          onKeyDown={preventInvalidIntegerInput}
                          disabled={readOnly}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {enableSku ? (
                  <FormField
                    control={form.control}
                    name="sku"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("sku")}</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} disabled={readOnly} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : null}
              </ProductEditorFieldGrid>
              {shopifyEditor && enableBarcode ? (
                <FormField
                  control={form.control}
                  name="barcodes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("barcodes")}</FormLabel>
                      <FormRow className="flex-col items-stretch sm:flex-row sm:items-end">
                        <FormControl>
                          <Input
                            value={barcodeInput}
                            onChange={(event) => setBarcodeInput(event.target.value)}
                            onKeyDown={handleBarcodeInputKeyDown}
                            placeholder={t("barcodePlaceholder")}
                            className="flex-1"
                            disabled={readOnly}
                          />
                        </FormControl>
                        <Button
                          type="button"
                          variant="secondary"
                          className="w-full sm:w-auto"
                          onClick={addBarcodeFromDraft}
                          disabled={readOnly}
                        >
                          <AddIcon className="h-4 w-4" aria-hidden />
                          {t("addBarcode")}
                        </Button>
                      </FormRow>
                      <div className="flex min-h-8 flex-wrap gap-2">
                        {field.value?.length ? (
                          field.value.map((barcode, index) => (
                            <Badge
                              key={`${barcode}-${index}`}
                              variant="muted"
                              className="gap-1 pr-1"
                            >
                              <span>{barcode}</span>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 shadow-none"
                                aria-label={t("removeBarcode")}
                                onClick={() => {
                                  if (readOnly) {
                                    return;
                                  }
                                  const next = (field.value ?? []).filter((_, i) => i !== index);
                                  form.clearErrors("barcodes");
                                  form.setValue("barcodes", next, {
                                    shouldValidate: false,
                                    shouldDirty: true,
                                  });
                                }}
                                disabled={readOnly}
                              >
                                <CloseIcon className="h-3 w-3" aria-hidden />
                              </Button>
                            </Badge>
                          ))
                        ) : (
                          <p className="text-xs text-muted-foreground">{t("barcodeEmpty")}</p>
                        )}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}
            </ProductEditorCard>

            {isBundle ? (
              <ProductEditorCard
                title={t("bundleComponentsTitle")}
                description={t("bundleComponentsHint")}
                className={editorFormCardClassName}
              >
                <div className="relative">
                  <Input
                    value={bundleSearch}
                    onChange={(event) => {
                      setBundleSearch(event.target.value);
                      setShowBundleResults(true);
                    }}
                    onFocus={() => setShowBundleResults(true)}
                    onBlur={() => {
                      window.setTimeout(() => setShowBundleResults(false), 120);
                    }}
                    placeholder={t("bundleSearchPlaceholder")}
                    disabled={readOnly}
                  />
                  {showBundleResults && bundleSearch.trim().length > 0 ? (
                    <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-background shadow-lg">
                      {bundleSearchQuery.isLoading ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          {tCommon("loading")}
                        </div>
                      ) : bundleSearchQuery.data?.length ? (
                        bundleSearchQuery.data.map((product) => (
                          <ProductSearchResultItem
                            key={product.id}
                            product={product}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() =>
                              addBundleComponentFromSearch({
                                id: product.id,
                                name: product.name,
                                sku: product.sku,
                              })
                            }
                          />
                        ))
                      ) : (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          {tCommon("nothingFound")}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
                {bundleComponentFields.length ? (
                  <div className="space-y-2">
                    {bundleComponentFields.map((component, index) => (
                      <div
                        key={component.id}
                        className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_120px_auto]"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {component.componentName || tCommon("notAvailable")}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {component.componentSku || component.componentProductId}
                          </p>
                        </div>
                        <FormField
                          control={form.control}
                          name={`bundleComponents.${index}.qty`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input
                                  {...field}
                                  value={field.value ?? ""}
                                  type="number"
                                  min={1}
                                  step={1}
                                  inputMode="numeric"
                                  disabled={readOnly}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon"
                          onClick={() => removeBundleComponent(index)}
                          disabled={readOnly}
                          aria-label={t("bundleRemoveComponent")}
                        >
                          <DeleteIcon className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("bundleEmpty")}</p>
                )}
              </ProductEditorCard>
            ) : null}

            {showProductPacksSection ? (
              <ProductEditorCard title={t("packagingTitle")} className={editorFormCardClassName}>
                {shopifyPackRows}
              </ProductEditorCard>
            ) : null}

            <ProductEditorCard title={t("variants")} className={editorFormCardClassName}>
              {!compactVariantOptions.length && !variantOptionEditorOpen ? (
                <div className="rounded-md border border-dashed border-border bg-muted/20 p-4">
                  <p className="text-sm font-medium text-foreground">{t("variantsEmpty")}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("variantOptionsEmptyHelper")}
                  </p>
                  {!readOnly ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="mt-3"
                      onClick={() => setVariantOptionEditorOpen(true)}
                    >
                      <AddIcon className="h-4 w-4" aria-hidden />
                      {t("variantAddOption")}
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {compactVariantOptions.length ? (
                <div className="space-y-2">
                  {compactVariantOptions.map((option) => (
                    <div
                      key={option.key}
                      className="rounded-md border border-border bg-background p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">{option.name}</p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {option.values.map((value) => (
                              <Badge key={`${option.key}-${value}`} variant="muted">
                                {value}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        {!readOnly ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="shrink-0 text-danger hover:text-danger"
                            onClick={() => handleRemoveVariantOption(option.key)}
                          >
                            {t("variantOptionDelete")}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {variantOptionEditorOpen ? (
                <div className="space-y-3 rounded-md border border-border bg-background p-3">
                  <ProductEditorFieldGrid>
                    <div className="space-y-2">
                      <Label htmlFor="variant-option-name">{t("variantOptionName")}</Label>
                      <Input
                        id="variant-option-name"
                        value={variantOptionDraftName}
                        onChange={(event) => setVariantOptionDraftName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                          }
                        }}
                        placeholder={t("variantOptionNamePlaceholder")}
                        disabled={readOnly}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="variant-option-values">{t("variantOptionValues")}</Label>
                      <Input
                        id="variant-option-values"
                        value={variantOptionValueDraft}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          if (nextValue.includes(",") || nextValue.includes(";")) {
                            addVariantOptionDraftValues(nextValue);
                            return;
                          }
                          setVariantOptionValueDraft(nextValue);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== ",") {
                            return;
                          }
                          event.preventDefault();
                          addVariantOptionDraftValues(variantOptionValueDraft);
                        }}
                        placeholder={t("variantOptionValuesPlaceholder")}
                        disabled={readOnly}
                      />
                    </div>
                  </ProductEditorFieldGrid>
                  <div className="min-h-8 space-y-2">
                    {variantOptionPreviewValues.length ? (
                      variantOptionPreviewValues.map((value) => {
                        const valueKey = normalizeVariantOptionValueKey(value);
                        const imageValue = variantOptionDraftImages[valueKey] ?? "__none";
                        const selectedImageValue = variantImageOptionByValue.has(imageValue)
                          ? imageValue
                          : "__none";
                        return (
                          <div
                            key={value}
                            className="grid gap-2 rounded-md border border-border/70 bg-card p-2 sm:grid-cols-[minmax(0,1fr)_minmax(280px,360px)_32px] sm:items-center"
                          >
                            <Badge variant="muted" className="min-w-0 justify-start">
                              <span className="truncate">{value}</span>
                            </Badge>
                            <div className="min-w-0">
                              <Label className="sr-only">{t("variantImage")}</Label>
                              {hasVariantImageOptions ? (
                                <Select
                                  value={selectedImageValue}
                                  onValueChange={(nextValue) =>
                                    setVariantOptionDraftImageValue(value, nextValue)
                                  }
                                  disabled={readOnly}
                                >
                                  <SelectTrigger className="h-16 min-w-0 gap-3 whitespace-nowrap px-2 [&>span]:flex [&>span]:min-w-0 [&>span]:items-center [&>span]:gap-3 [&>span]:truncate">
                                    <SelectValue placeholder={t("variantImageNone")} />
                                  </SelectTrigger>
                                  <SelectContent className="min-w-[280px]">
                                    <SelectItem
                                      value="__none"
                                      className="min-h-12 whitespace-nowrap"
                                    >
                                      {t("variantImageNone")}
                                    </SelectItem>
                                    {variantImageOptions.map((option) => (
                                      <SelectItem
                                        key={option.value}
                                        value={option.value}
                                        className="min-h-16 whitespace-nowrap"
                                      >
                                        <VariantImageOptionPreview
                                          url={option.url}
                                          label={option.label}
                                        />
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  className="h-16 w-full justify-start px-3"
                                  onClick={() =>
                                    openVariantImageUpload({ type: "draftValue", valueKey })
                                  }
                                  disabled={readOnly || isUploadingImages}
                                >
                                  {isUploadingImages ? (
                                    <Spinner className="h-4 w-4" />
                                  ) : (
                                    <ImagePlusIcon className="h-4 w-4" aria-hidden />
                                  )}
                                  <span className="min-w-0 truncate">
                                    {isUploadingImages ? tCommon("loading") : t("imagesAdd")}
                                  </span>
                                </Button>
                              )}
                            </div>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 justify-self-end shadow-none"
                              aria-label={t("variantOptionRemoveValue")}
                              onClick={() => removeVariantOptionDraftValue(value)}
                              disabled={readOnly}
                            >
                              <CloseIcon className="h-3 w-3" aria-hidden />
                            </Button>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {t("variantOptionValuesHint")}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-danger hover:text-danger"
                      onClick={resetVariantOptionDraft}
                      disabled={readOnly}
                    >
                      {t("variantOptionDelete")}
                    </Button>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={resetVariantOptionDraft}
                      >
                        {t("variantOptionCancel")}
                      </Button>
                      <Button type="button" size="sm" onClick={handleSaveVariantOption}>
                        {t("variantOptionDone")}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : compactVariantOptions.length && !readOnly ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start border border-dashed border-border"
                  onClick={() => setVariantOptionEditorOpen(true)}
                >
                  <AddIcon className="h-4 w-4" aria-hidden />
                  {t("variantAddOption")}
                </Button>
              ) : null}

              {compactVariantRows.length ? (
                <div className="space-y-2" data-variant-visual-anchor>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">
                      {t("variantGeneratedTitle", { count: compactVariantRows.length })}
                    </p>
                    {!hasVariantImageOptions && !readOnly ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-8 shrink-0 px-3 text-xs"
                        onClick={() => {
                          const singleVariantRow =
                            compactVariantRows.length === 1 ? compactVariantRows[0] : null;
                          openVariantImageUpload(
                            singleVariantRow
                              ? { type: "variant", index: singleVariantRow.index }
                              : undefined,
                          );
                        }}
                        disabled={isUploadingImages}
                      >
                        {isUploadingImages ? (
                          <Spinner className="h-3.5 w-3.5" />
                        ) : (
                          <ImagePlusIcon className="h-3.5 w-3.5" aria-hidden />
                        )}
                        {isUploadingImages ? tCommon("loading") : t("imagesAdd")}
                      </Button>
                    ) : null}
                  </div>
                  <div className="overflow-x-auto rounded-md border border-border">
                    <div
                      className="hidden gap-2 bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[var(--variant-grid-cols)]"
                      style={compactVariantGridStyle}
                    >
                      <span>{t("variantTableVariant")}</span>
                      {showVariantImagePicker ? <span>{t("variantTableImage")}</span> : null}
                      {enableSku ? <span>{t("variantTableSku")}</span> : null}
                      {canEditInitialStock ? <span>{t("variantTableStock")}</span> : null}
                      <span className="sr-only">{tCommon("actions")}</span>
                    </div>
                    <div className="divide-y divide-border">
                      {compactVariantRows.map((variant) => {
                        const canDelete = variant.canDelete;
                        const imageValue = resolveVariantImageValue(
                          watchedVariants[variant.index] ?? {},
                        );
                        const selectedImageValue = variantImageOptionByValue.has(imageValue)
                          ? imageValue
                          : "__none";
                        return (
                          <div
                            key={variant.key}
                            className="grid gap-2 px-3 py-3 sm:grid-cols-[var(--variant-grid-cols)] sm:items-center"
                            style={compactVariantGridStyle}
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">
                                {variant.name}
                              </p>
                            </div>
                            {showVariantImagePicker ? (
                              <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground sm:sr-only">
                                  {t("variantTableImage")}
                                </Label>
                                {hasVariantImageOptions ? (
                                  <Select
                                    value={selectedImageValue}
                                    onValueChange={(value) =>
                                      setVariantImageValue(variant.index, value)
                                    }
                                    disabled={readOnly}
                                  >
                                    <SelectTrigger className="h-16 min-w-0 gap-3 whitespace-nowrap px-2 [&>span]:flex [&>span]:min-w-0 [&>span]:items-center [&>span]:gap-3 [&>span]:truncate">
                                      <SelectValue placeholder={t("variantImageNone")} />
                                    </SelectTrigger>
                                    <SelectContent className="min-w-[280px]">
                                      <SelectItem
                                        value="__none"
                                        className="min-h-12 whitespace-nowrap"
                                      >
                                        {t("variantImageNone")}
                                      </SelectItem>
                                      {variantImageOptions.map((option) => (
                                        <SelectItem
                                          key={option.value}
                                          value={option.value}
                                          className="min-h-16 whitespace-nowrap"
                                        >
                                          <VariantImageOptionPreview
                                            url={option.url}
                                            label={option.label}
                                          />
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    className="h-16 w-full justify-start px-3"
                                    onClick={() =>
                                      openVariantImageUpload({
                                        type: "variant",
                                        index: variant.index,
                                      })
                                    }
                                    disabled={readOnly || isUploadingImages}
                                  >
                                    {isUploadingImages ? (
                                      <Spinner className="h-4 w-4" />
                                    ) : (
                                      <ImagePlusIcon className="h-4 w-4" aria-hidden />
                                    )}
                                    <span className="min-w-0 truncate">
                                      {isUploadingImages ? tCommon("loading") : t("imagesAdd")}
                                    </span>
                                  </Button>
                                )}
                              </div>
                            ) : null}
                            {enableSku ? (
                              <FormField
                                control={form.control}
                                name={`variants.${variant.index}.sku`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="sr-only">
                                      {t("variantTableSku")}
                                    </FormLabel>
                                    <FormControl>
                                      <Input
                                        {...field}
                                        value={field.value ?? ""}
                                        className="h-9"
                                        disabled={readOnly}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            ) : null}
                            {canEditInitialStock ? (
                              <FormField
                                control={form.control}
                                name={`variants.${variant.index}.initialOnHand`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="sr-only">
                                      {t("variantTableStock")}
                                    </FormLabel>
                                    <FormControl>
                                      <Input
                                        {...field}
                                        value={field.value ?? ""}
                                        type="number"
                                        inputMode="numeric"
                                        min={0}
                                        step={1}
                                        className="h-9"
                                        placeholder={t("initialOnHandPlaceholder")}
                                        onKeyDown={preventInvalidIntegerInput}
                                        disabled={readOnly}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            ) : null}
                            {!readOnly ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex justify-end">
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      className="h-9 w-9 text-danger shadow-none hover:text-danger"
                                      aria-label={t("removeVariant")}
                                      onClick={() => remove(variant.index)}
                                      disabled={!canDelete}
                                    >
                                      <DeleteIcon className="h-4 w-4" aria-hidden />
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {canDelete ? t("removeVariant") : tErrors("variantInUse")}
                                </TooltipContent>
                              </Tooltip>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}
            </ProductEditorCard>
          </TooltipProvider>

          {!readOnly && !hideActions ? (
            <FormActions className="hidden md:flex">
              <Button type="submit" className="w-full sm:w-auto" disabled={isSubmitting}>
                {isSubmitting ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <StatusSuccessIcon className="h-4 w-4" aria-hidden />
                )}
                {isSubmitting ? t("saving") : t("save")}
              </Button>
            </FormActions>
          ) : null}
          {!readOnly && !hideActions ? (
            <div className="sticky bottom-3 z-20 mt-4 rounded-lg border border-border bg-background p-3 shadow-[0_10px_30px_rgba(15,23,42,0.12)] md:hidden">
              <Button type="submit" className="min-h-11 w-full" disabled={isSubmitting}>
                {isSubmitting ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <StatusSuccessIcon className="h-4 w-4" aria-hidden />
                )}
                {isSubmitting ? t("saving") : t("save")}
              </Button>
            </div>
          ) : null}
        </form>

        {!readOnly ? (
          <Modal
            open={generatorOpen}
            onOpenChange={(open) => setGeneratorOpen(open)}
            title={t("generatorTitle")}
            subtitle={t("generatorSubtitle")}
          >
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">
                    {t("generatorAttributes")}
                  </p>
                  {generatorAvailableDefinitions.length ? (
                    <FormRow className="w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-end">
                      <Select
                        value={generatorDraftKey}
                        onValueChange={(value) => setGeneratorDraftKey(value)}
                      >
                        <SelectTrigger className="min-w-[180px]">
                          <SelectValue placeholder={t("generatorAttributePlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          {generatorAvailableDefinitions.map((definition) => (
                            <SelectItem key={definition.key} value={definition.key}>
                              {resolveLabel(definition, definition.key)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-9 px-3"
                        onClick={() => {
                          if (!generatorDraftKey) {
                            return;
                          }
                          setGeneratorAttributes((prev) => [
                            ...prev,
                            { key: generatorDraftKey, values: [] },
                          ]);
                          setGeneratorDraftKey("");
                        }}
                      >
                        <AddIcon className="h-4 w-4" aria-hidden />
                        {t("generatorAddAttribute")}
                      </Button>
                    </FormRow>
                  ) : null}
                </div>

                {generatorAttributes.length ? (
                  <div className="space-y-3">
                    {generatorAttributes.map((attribute) => {
                      const definition = generatorDefinitionMap.get(attribute.key);
                      const label = resolveLabel(definition, attribute.key);
                      const options = resolveOptions(definition);
                      const selectedValues = attribute.values;
                      const draftValue = generatorValueDrafts[attribute.key] ?? "";
                      return (
                        <div
                          key={attribute.key}
                          className="rounded-md border border-border/70 bg-card p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-foreground">{label}</p>
                              <p className="text-xs text-muted-foreground">
                                {t("generatorAttributeHint")}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label={t("removeAttribute")}
                              onClick={() =>
                                setGeneratorAttributes((prev) =>
                                  prev.filter((entry) => entry.key !== attribute.key),
                                )
                              }
                            >
                              <CloseIcon className="h-4 w-4" aria-hidden />
                            </Button>
                          </div>

                          <div className="mt-3 space-y-2">
                            {options.length ? (
                              <div className="flex flex-wrap gap-2">
                                {options.map((option) => {
                                  const isSelected = selectedValues.includes(option);
                                  return (
                                    <Button
                                      key={option}
                                      type="button"
                                      variant={isSelected ? "secondary" : "ghost"}
                                      className="h-8 px-3 text-xs"
                                      aria-pressed={isSelected}
                                      onClick={() => {
                                        const nextValues = isSelected
                                          ? selectedValues.filter((value) => value !== option)
                                          : [...selectedValues, option];
                                        setGeneratorAttributes((prev) =>
                                          prev.map((entry) =>
                                            entry.key === attribute.key
                                              ? { ...entry, values: nextValues }
                                              : entry,
                                          ),
                                        );
                                      }}
                                    >
                                      {option}
                                    </Button>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                {t("generatorNoOptions")}
                              </p>
                            )}

                            <FormRow className="flex-col items-stretch gap-2 sm:flex-row sm:items-end">
                              <Input
                                value={draftValue}
                                onChange={(event) =>
                                  setGeneratorValueDrafts((prev) => ({
                                    ...prev,
                                    [attribute.key]: event.target.value,
                                  }))
                                }
                                placeholder={t("generatorValuePlaceholder")}
                                disabled={readOnly}
                              />
                              <Button
                                type="button"
                                variant="secondary"
                                className="h-9 px-3"
                                onClick={() => {
                                  const value = draftValue.trim();
                                  if (!value || selectedValues.includes(value)) {
                                    return;
                                  }
                                  setGeneratorAttributes((prev) =>
                                    prev.map((entry) =>
                                      entry.key === attribute.key
                                        ? { ...entry, values: [...entry.values, value] }
                                        : entry,
                                    ),
                                  );
                                  setGeneratorValueDrafts((prev) => ({
                                    ...prev,
                                    [attribute.key]: "",
                                  }));
                                }}
                              >
                                {t("generatorAddValue")}
                              </Button>
                            </FormRow>

                            {selectedValues.filter((value) => !options.includes(value)).length ? (
                              <div className="flex flex-wrap gap-2">
                                {selectedValues
                                  .filter((value) => !options.includes(value))
                                  .map((value) => (
                                    <Badge key={value} variant="muted" className="gap-1 pr-1">
                                      <span>{value}</span>
                                      <Button
                                        type="button"
                                        size="icon"
                                        variant="ghost"
                                        className="h-6 w-6 shadow-none"
                                        aria-label={t("removeAttributeValue")}
                                        onClick={() =>
                                          setGeneratorAttributes((prev) =>
                                            prev.map((entry) =>
                                              entry.key === attribute.key
                                                ? {
                                                    ...entry,
                                                    values: entry.values.filter(
                                                      (item) => item !== value,
                                                    ),
                                                  }
                                                : entry,
                                            ),
                                          )
                                        }
                                      >
                                        <CloseIcon className="h-3 w-3" aria-hidden />
                                      </Button>
                                    </Badge>
                                  ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("generatorEmpty")}</p>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{t("generatorPreview", { count: generatorPreviewCount })}</span>
                {templateKeys.length ? <span>{t("generatorTemplateHint")}</span> : null}
              </div>

              <ModalFooter>
                <Button type="button" variant="ghost" onClick={() => setGeneratorOpen(false)}>
                  {tCommon("cancel")}
                </Button>
                <Button type="button" onClick={handleGenerateVariants}>
                  {t("generatorConfirm")}
                </Button>
              </ModalFooter>
            </div>
          </Modal>
        ) : null}
      </Form>
    );
  }

  return (
    <Form {...form}>
      <form
        id={formId}
        className="space-y-6 pb-28 md:pb-0"
        onSubmit={form.handleSubmit(handleSubmit, handleInvalidSubmit)}
      >
        <TooltipProvider>
          <Card>
            <CardHeader>
              <CardTitle>
                {compactCreate
                  ? t("quickCreateTitle")
                  : isBundle
                    ? t("detailsBundleTitle")
                    : t("detailsTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div
                className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 md:hidden"
                data-mobile-product-form-sections
              >
                {[
                  t("quickCreatePhotoTitle"),
                  t("basicInfoTitle"),
                  t("salePrice"),
                  t("initialOnHand"),
                ]
                  .concat(enableSku ? [t("sku")] : [])
                  .concat(enableBarcode ? [t("barcodes")] : [])
                  .concat([t("variants"), t("advancedTitle")])
                  .map((label) => (
                    <Badge key={label} variant="muted" className="shrink-0 px-3 py-1.5">
                      {label}
                    </Badge>
                  ))}
              </div>
              {compactCreate ? quickImageSection : imageManagementSection}

              <FormSection
                title={
                  compactCreate
                    ? t("quickCreateCoreTitle")
                    : isBundle
                      ? t("basicInfoBundleTitle")
                      : t("basicInfoTitle")
                }
                className={mobileProductSectionClassName}
              >
                <div className="space-y-6">
                  <FormGrid className="items-start">
                    {enableSku ? (
                      <FormField
                        control={form.control}
                        name="sku"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("sku")}</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value ?? ""} disabled={readOnly} />
                            </FormControl>
                            {!productId && !compactCreate ? (
                              <FormDescription>{t("skuAutoGeneratedHint")}</FormDescription>
                            ) : null}
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ) : null}
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("name")}</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} disabled={readOnly} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {!compactCreate ? (
                      <FormField
                        control={form.control}
                        name="isBundle"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("typeLabel")}</FormLabel>
                            <Select
                              value={field.value ? "bundle" : "product"}
                              onValueChange={(value) => field.onChange(value === "bundle")}
                              disabled={readOnly}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="product">{t("typeProduct")}</SelectItem>
                                <SelectItem value="bundle">{t("typeBundle")}</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ) : null}
                    <FormField
                      control={form.control}
                      name="categories"
                      render={() => (
                        <FormItem>
                          <FormLabel>{t("category")}</FormLabel>
                          <div className="space-y-3">
                            <div className="flex min-h-10 flex-wrap gap-2 rounded-md border border-border bg-muted/20 p-2">
                              {categoryValues.length ? (
                                categoryValues.map((value, index) => {
                                  const categoryMeta = categoryMetaByKey.get(
                                    normalizeCategoryKey(value) ?? "",
                                  );
                                  const isHiddenCategory = Boolean(
                                    categoryMeta &&
                                    (!categoryMeta.isVisibleInForms || categoryMeta.isArchived),
                                  );

                                  return (
                                    <div
                                      key={value}
                                      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                                    >
                                      <span>{value}</span>
                                      {index === 0 ? (
                                        <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                                          {t("categoryPrimaryBadge")}
                                        </span>
                                      ) : null}
                                      {isHiddenCategory ? (
                                        <span className="rounded-md bg-warning/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-warning">
                                          {t("categoryHiddenBadge")}
                                        </span>
                                      ) : null}
                                      {!readOnly && index > 0 ? (
                                        <button
                                          type="button"
                                          className="rounded-md p-0.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                                          onClick={() => promoteProductCategory(value)}
                                          aria-label={t("categoryPromote")}
                                        >
                                          <ArrowUpIcon className="h-3 w-3" aria-hidden />
                                        </button>
                                      ) : null}
                                      {!readOnly ? (
                                        <button
                                          type="button"
                                          className="rounded-md p-0.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                                          onClick={() => removeProductCategory(value)}
                                          aria-label={tCommon("delete")}
                                        >
                                          <CloseIcon className="h-3 w-3" aria-hidden />
                                        </button>
                                      ) : null}
                                    </div>
                                  );
                                })
                              ) : (
                                <span className="text-sm text-muted-foreground">
                                  {tCommon("notAvailable")}
                                </span>
                              )}
                            </div>
                            {!readOnly ? (
                              <>
                                <div className="flex flex-col gap-2 sm:flex-row">
                                  <Input
                                    value={categoryDraft}
                                    onChange={(event) => setCategoryDraft(event.target.value)}
                                    placeholder={t("categoryPlaceholder")}
                                    onKeyDown={(event) => {
                                      if (event.key !== "Enter") {
                                        return;
                                      }
                                      event.preventDefault();
                                      if (addProductCategory(categoryDraft)) {
                                        setCategoryDraft("");
                                      }
                                    }}
                                  />
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() => {
                                      if (addProductCategory(categoryDraft)) {
                                        setCategoryDraft("");
                                      }
                                    }}
                                  >
                                    <AddIcon className="h-4 w-4" aria-hidden />
                                    {t("categoryAdd")}
                                  </Button>
                                </div>
                                {showHiddenCategoryCount ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="w-fit px-0 text-xs text-muted-foreground hover:text-foreground"
                                    onClick={() =>
                                      setShowHiddenCategoryOptions((current) => !current)
                                    }
                                  >
                                    {showHiddenCategoryOptions
                                      ? t("categoryHideHidden")
                                      : t("categoryShowHidden", {
                                          count: showHiddenCategoryCount,
                                        })}
                                  </Button>
                                ) : null}
                                {suggestedCategoryOptions.length ? (
                                  <div className="grid gap-2 sm:grid-cols-2">
                                    {suggestedCategoryOptions.map((option) => {
                                      const isHiddenCategory =
                                        !option.isVisibleInForms || option.isArchived;
                                      return (
                                        <Button
                                          key={option.name}
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="h-auto justify-start gap-2 rounded-md border border-dashed border-border px-3 py-2 text-left text-xs"
                                          onClick={() => addProductCategory(option.name)}
                                        >
                                          <AddIcon className="h-3 w-3" aria-hidden />
                                          <span className="min-w-0 flex-1 truncate">
                                            {option.name}
                                          </span>
                                          {isHiddenCategory ? (
                                            <span className="rounded-md bg-warning/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-warning">
                                              {t("categoryHiddenBadge")}
                                            </span>
                                          ) : null}
                                        </Button>
                                      );
                                    })}
                                  </div>
                                ) : categoryDraftQuery ? (
                                  <p className="text-xs text-muted-foreground">
                                    {t("categoryNoSuggestions")}
                                  </p>
                                ) : null}
                                {matchingCategoryOptions.length >
                                suggestedCategoryOptions.length ? (
                                  <p className="text-xs text-muted-foreground">
                                    {t("categoryMoreSuggestions", {
                                      count:
                                        matchingCategoryOptions.length -
                                        suggestedCategoryOptions.length,
                                    })}
                                  </p>
                                ) : null}
                              </>
                            ) : null}
                          </div>
                          {!compactCreate ? (
                            <FormDescription>{t("categoryHint")}</FormDescription>
                          ) : null}
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {!compactCreate || !unitOptions.length ? (
                      <FormField
                        control={form.control}
                        name="baseUnitId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("unit")}</FormLabel>
                            <Select
                              value={field.value}
                              onValueChange={field.onChange}
                              disabled={readOnly || !unitOptions.length}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder={t("unitPlaceholder")} />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {unitOptions.map((unit) => (
                                  <SelectItem key={unit.id} value={unit.id}>
                                    {resolveUnitLabel(unit)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {!unitOptions.length ? (
                              <FormDescription>{t("unitMissingHint")}</FormDescription>
                            ) : null}
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ) : null}
                    {showBasePriceField ? (
                      <FormField
                        control={form.control}
                        name="basePriceKgs"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("salePrice")}</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                value={field.value ?? ""}
                                type="number"
                                inputMode="decimal"
                                step="0.01"
                                placeholder={t("pricePlaceholder")}
                                disabled={readOnly}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ) : null}
                    {compactCreate ? (
                      <>
                        {canEditInitialStock ? (
                          <FormField
                            control={form.control}
                            name="initialOnHand"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t("initialOnHand")}</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    value={field.value ?? ""}
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    step={1}
                                    placeholder={t("initialOnHandPlaceholder")}
                                    onKeyDown={preventInvalidIntegerInput}
                                    disabled={readOnly}
                                  />
                                </FormControl>
                                <FormDescription>{t("initialOnHandHint")}</FormDescription>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        ) : null}
                        <FormField
                          control={form.control}
                          name="minStock"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t("quickMinStock")}</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  value={field.value ?? ""}
                                  type="number"
                                  inputMode="numeric"
                                  min={0}
                                  step={1}
                                  placeholder={t("minStockPlaceholder")}
                                  onKeyDown={preventInvalidIntegerInput}
                                  disabled={readOnly}
                                />
                              </FormControl>
                              <FormDescription>{t("quickMinStockHint")}</FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="avgCostKgs"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t("quickAvgCost")}</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  value={field.value ?? ""}
                                  type="number"
                                  inputMode="decimal"
                                  step="0.01"
                                  placeholder={t("pricePlaceholder")}
                                  disabled={readOnly}
                                />
                              </FormControl>
                              <FormDescription>{t("quickAvgCostHint")}</FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </>
                    ) : null}
                    {compactCreate && enableBarcode ? (
                      <FormField
                        control={form.control}
                        name="barcodes"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("barcodes")}</FormLabel>
                            <FormRow className="flex-col items-stretch sm:flex-row sm:items-end">
                              <FormControl>
                                <Input
                                  value={barcodeInput}
                                  onChange={(event) => setBarcodeInput(event.target.value)}
                                  onKeyDown={handleBarcodeInputKeyDown}
                                  placeholder={t("barcodePlaceholder")}
                                  className="flex-1"
                                  disabled={readOnly}
                                />
                              </FormControl>
                              <Button
                                type="button"
                                variant="secondary"
                                className="w-full sm:w-auto"
                                onClick={addBarcodeFromDraft}
                                disabled={readOnly}
                              >
                                <AddIcon className="h-4 w-4" aria-hidden />
                                {t("addBarcode")}
                              </Button>
                            </FormRow>
                            <div className="flex min-h-8 flex-wrap gap-2">
                              {field.value?.length ? (
                                field.value.map((barcode, index) => (
                                  <Badge
                                    key={`${barcode}-${index}`}
                                    variant="muted"
                                    className="gap-1 pr-1"
                                  >
                                    <span>{barcode}</span>
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      className="h-6 w-6 shadow-none"
                                      aria-label={t("removeBarcode")}
                                      onClick={() => {
                                        if (readOnly) {
                                          return;
                                        }
                                        const next = (field.value ?? []).filter(
                                          (_, i) => i !== index,
                                        );
                                        form.clearErrors("barcodes");
                                        form.setValue("barcodes", next, {
                                          shouldValidate: false,
                                          shouldDirty: true,
                                        });
                                      }}
                                      disabled={readOnly}
                                    >
                                      <CloseIcon className="h-3 w-3" aria-hidden />
                                    </Button>
                                  </Badge>
                                ))
                              ) : (
                                <p className="text-xs text-muted-foreground">{t("barcodeEmpty")}</p>
                              )}
                            </div>
                            <FormDescription>{t("barcodeHint")}</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ) : null}
                    {!compactCreate ? (
                      <FormField
                        control={form.control}
                        name="avgCostKgs"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("avgCost")}</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                value={field.value ?? ""}
                                type="number"
                                inputMode="decimal"
                                step="0.01"
                                placeholder={t("pricePlaceholder")}
                                disabled={readOnly}
                              />
                            </FormControl>
                            <FormDescription>{t("avgCostHint")}</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ) : null}
                  </FormGrid>
                  {duplicateDiagnosticsEnabled ? (
                    <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-foreground">
                          {t("duplicateDiagnosticsTitle")}
                        </p>
                        {duplicateDiagnosticsQuery.isFetching ? (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Spinner className="h-4 w-4" />
                            {t("duplicateDiagnosticsLoading")}
                          </div>
                        ) : null}
                      </div>
                      {enableSku && duplicateDiagnosticsQuery.data?.exactSkuMatch ? (
                        <div className="mt-3 rounded-md border border-danger/30 bg-background p-3">
                          <p className="text-xs font-medium text-danger">
                            {t("duplicateExactSkuTitle")}
                          </p>
                          <p className="mt-1 text-sm text-foreground">
                            {duplicateDiagnosticsQuery.data.exactSkuMatch.name}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="muted">
                              {duplicateDiagnosticsQuery.data.exactSkuMatch.sku}
                            </Badge>
                            {duplicateDiagnosticsQuery.data.exactSkuMatch.isDeleted ? (
                              <Badge variant="muted">{t("archived")}</Badge>
                            ) : null}
                            <Link
                              href={`/products/${duplicateDiagnosticsQuery.data.exactSkuMatch.id}`}
                              target="_blank"
                              className="text-primary underline-offset-4 hover:underline"
                            >
                              {t("duplicateOpenProduct")}
                            </Link>
                          </div>
                        </div>
                      ) : null}
                      {enableBarcode &&
                      duplicateDiagnosticsQuery.data?.exactBarcodeMatches.length ? (
                        <div className="mt-3 space-y-2">
                          <p className="text-xs font-medium text-foreground">
                            {t("duplicateExactBarcodesTitle")}
                          </p>
                          {duplicateDiagnosticsQuery.data.exactBarcodeMatches.map((match) => (
                            <div
                              key={`${match.barcode}-${match.id}`}
                              className="rounded-md border border-danger/30 bg-background p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="muted">{match.barcode}</Badge>
                                <span className="text-sm text-foreground">{match.name}</span>
                                {enableSku ? (
                                  <span className="text-xs text-muted-foreground">{match.sku}</span>
                                ) : null}
                                {match.isDeleted ? (
                                  <Badge variant="muted">{t("archived")}</Badge>
                                ) : null}
                              </div>
                              <Link
                                href={`/products/${match.id}`}
                                target="_blank"
                                className="mt-2 inline-flex text-xs text-primary underline-offset-4 hover:underline"
                              >
                                {t("duplicateOpenProduct")}
                              </Link>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {duplicateDiagnosticsQuery.data?.likelyNameMatches.length ? (
                        <div className="mt-3 space-y-2">
                          <p className="text-xs font-medium text-foreground">
                            {t("duplicateLikelyMatchesTitle")}
                          </p>
                          {duplicateDiagnosticsQuery.data.likelyNameMatches.map((match) => (
                            <div
                              key={match.id}
                              className="rounded-md border border-warning/30 bg-background p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm text-foreground">{match.name}</span>
                                {enableSku ? <Badge variant="muted">{match.sku}</Badge> : null}
                                {match.isDeleted ? (
                                  <Badge variant="muted">{t("archived")}</Badge>
                                ) : null}
                              </div>
                              <Link
                                href={`/products/${match.id}`}
                                target="_blank"
                                className="mt-2 inline-flex text-xs text-primary underline-offset-4 hover:underline"
                              >
                                {t("duplicateOpenProduct")}
                              </Link>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {!duplicateDiagnosticsQuery.isFetching &&
                      !(enableSku && duplicateDiagnosticsQuery.data?.exactSkuMatch) &&
                      !(
                        enableBarcode && duplicateDiagnosticsQuery.data?.exactBarcodeMatches.length
                      ) &&
                      !duplicateDiagnosticsQuery.data?.likelyNameMatches.length ? (
                        <p className="mt-3 text-xs text-muted-foreground">
                          {t("duplicateDiagnosticsEmpty")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {!compactCreate ? (
                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <FormLabel>{t("description")}</FormLabel>
                            {!readOnly ? (
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={handleGenerateDescription}
                                disabled={
                                  isUploadingImages ||
                                  generateDescriptionMutation.isLoading ||
                                  !descriptionSourceImageUrls.length
                                }
                              >
                                {generateDescriptionMutation.isLoading ? (
                                  <Spinner className="h-4 w-4" />
                                ) : (
                                  <SparklesIcon className="h-4 w-4" />
                                )}
                                {generateDescriptionMutation.isLoading
                                  ? t("aiDescriptionGenerating")
                                  : t("aiDescriptionGenerate")}
                              </Button>
                            ) : null}
                          </div>
                          <FormControl>
                            <Textarea {...field} rows={4} disabled={readOnly} />
                          </FormControl>
                          {!readOnly ? (
                            <FormDescription>
                              {descriptionSourceImageUrls.length
                                ? t("aiDescriptionHint")
                                : t("aiDescriptionImageHint")}
                            </FormDescription>
                          ) : null}
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : null}
                </div>
              </FormSection>

              {!compactCreate && enableBarcode ? barcodeManagementSection : null}

              {isBundle ? (
                <FormSection
                  title={t("bundleComponentsTitle")}
                  description={t("bundleComponentsHint")}
                  className={mobileProductSectionClassName}
                >
                  <div className="space-y-3 rounded-md border border-border p-3">
                    <div className="relative">
                      <Input
                        value={bundleSearch}
                        onChange={(event) => {
                          setBundleSearch(event.target.value);
                          setShowBundleResults(true);
                        }}
                        onFocus={() => setShowBundleResults(true)}
                        onBlur={() => {
                          window.setTimeout(() => setShowBundleResults(false), 120);
                        }}
                        placeholder={t("bundleSearchPlaceholder")}
                        disabled={readOnly}
                      />
                      {showBundleResults && bundleSearch.trim().length > 0 ? (
                        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-background shadow-lg">
                          {bundleSearchQuery.isLoading ? (
                            <div className="px-3 py-2 text-sm text-muted-foreground">
                              {tCommon("loading")}
                            </div>
                          ) : bundleSearchQuery.data?.length ? (
                            bundleSearchQuery.data.map((product) => (
                              <ProductSearchResultItem
                                key={product.id}
                                product={product}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() =>
                                  addBundleComponentFromSearch({
                                    id: product.id,
                                    name: product.name,
                                    sku: product.sku,
                                  })
                                }
                              />
                            ))
                          ) : (
                            <div className="px-3 py-2 text-sm text-muted-foreground">
                              {tCommon("nothingFound")}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>

                    {bundleComponentFields.length ? (
                      <div className="space-y-2">
                        {bundleComponentFields.map((component, index) => (
                          <div
                            key={component.id}
                            className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_120px_auto]"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">
                                {component.componentName || tCommon("notAvailable")}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {component.componentSku || component.componentProductId}
                              </p>
                            </div>
                            <FormField
                              control={form.control}
                              name={`bundleComponents.${index}.qty`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormControl>
                                    <Input
                                      {...field}
                                      type="number"
                                      min={1}
                                      step={1}
                                      inputMode="numeric"
                                      disabled={readOnly}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <Button
                              type="button"
                              variant="secondary"
                              size="icon"
                              onClick={() => removeBundleComponent(index)}
                              disabled={readOnly}
                              aria-label={t("bundleRemoveComponent")}
                            >
                              <DeleteIcon className="h-4 w-4" aria-hidden />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">{t("bundleEmpty")}</p>
                    )}
                  </div>
                </FormSection>
              ) : null}

              {variantSetupSection}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">{t("advancedTitle")}</h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAdvanced((prev) => !prev)}
                >
                  {showAdvanced ? t("hideAdvanced") : t("showAdvanced")}
                </Button>
              </div>
              {showAdvanced ? (
                <>
                  <Separator />
                  {compactCreate ? (
                    <>
                      <FormSection
                        title={t("descriptionTitle")}
                        className={mobileProductSectionClassName}
                      >
                        <FormField
                          control={form.control}
                          name="description"
                          render={({ field }) => (
                            <FormItem>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <FormLabel>{t("description")}</FormLabel>
                                {!readOnly ? (
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={handleGenerateDescription}
                                    disabled={
                                      isUploadingImages ||
                                      generateDescriptionMutation.isLoading ||
                                      !descriptionSourceImageUrls.length
                                    }
                                  >
                                    {generateDescriptionMutation.isLoading ? (
                                      <Spinner className="h-4 w-4" />
                                    ) : (
                                      <SparklesIcon className="h-4 w-4" />
                                    )}
                                    {generateDescriptionMutation.isLoading
                                      ? t("aiDescriptionGenerating")
                                      : t("aiDescriptionGenerate")}
                                  </Button>
                                ) : null}
                              </div>
                              <FormControl>
                                <Textarea {...field} rows={4} disabled={readOnly} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </FormSection>
                      <Separator />
                      {imageManagementSection}
                      <Separator />
                    </>
                  ) : null}
                  {showProductPacksSection ? (
                    <>
                      <FormSection
                        title={t("packsTitle")}
                        className={mobileProductSectionClassName}
                      >
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            className="w-full sm:w-auto"
                            onClick={() =>
                              appendPack({
                                packName: "",
                                packBarcode: "",
                                multiplierToBase: 1,
                                allowInPurchasing: true,
                                allowInReceiving: true,
                              })
                            }
                            disabled={readOnly}
                          >
                            <AddIcon className="h-4 w-4" aria-hidden />
                            {t("addPack")}
                          </Button>
                        </div>
                        {packFields.length ? (
                          <div className="space-y-4">
                            {packFields.map((field, index) => (
                              <div
                                key={field.id}
                                className="space-y-3 rounded-md border border-border/70 bg-card p-4"
                              >
                                <FormGrid className="items-start">
                                  <FormField
                                    control={form.control}
                                    name={`packs.${index}.packName`}
                                    render={({ field: itemField }) => (
                                      <FormItem>
                                        <FormLabel>{t("packName")}</FormLabel>
                                        <FormControl>
                                          <Input
                                            {...itemField}
                                            value={itemField.value ?? ""}
                                            disabled={readOnly}
                                          />
                                        </FormControl>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />
                                  <FormField
                                    control={form.control}
                                    name={`packs.${index}.multiplierToBase`}
                                    render={({ field: itemField }) => (
                                      <FormItem>
                                        <FormLabel>{t("packMultiplier")}</FormLabel>
                                        <FormControl>
                                          <Input
                                            {...itemField}
                                            value={itemField.value ?? ""}
                                            type="number"
                                            inputMode="numeric"
                                            min={1}
                                            disabled={readOnly}
                                          />
                                        </FormControl>
                                        <FormDescription>
                                          {t("packMultiplierHint", {
                                            unit: baseUnit
                                              ? resolveUnitLabel(baseUnit)
                                              : tCommon("notAvailable"),
                                          })}
                                        </FormDescription>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />
                                  {enableBarcode ? (
                                    <FormField
                                      control={form.control}
                                      name={`packs.${index}.packBarcode`}
                                      render={({ field: itemField }) => (
                                        <FormItem>
                                          <FormLabel>{t("packBarcode")}</FormLabel>
                                          <FormControl>
                                            <Input
                                              {...(() => {
                                                const { value: _value, ...rest } = itemField;
                                                void _value;
                                                return rest;
                                              })()}
                                              value={itemField.value ?? ""}
                                              onChange={(event) =>
                                                itemField.onChange(event.target.value)
                                              }
                                              disabled={readOnly}
                                            />
                                          </FormControl>
                                          <FormMessage />
                                        </FormItem>
                                      )}
                                    />
                                  ) : null}
                                </FormGrid>
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <div className="flex flex-wrap items-center gap-4">
                                    <FormField
                                      control={form.control}
                                      name={`packs.${index}.allowInPurchasing`}
                                      render={({ field: itemField }) => (
                                        <FormItem className="flex items-center gap-2 space-y-0">
                                          <FormControl>
                                            <Switch
                                              checked={itemField.value}
                                              onCheckedChange={itemField.onChange}
                                              disabled={readOnly}
                                            />
                                          </FormControl>
                                          <FormLabel className="text-sm">
                                            {t("packAllowPurchasing")}
                                          </FormLabel>
                                        </FormItem>
                                      )}
                                    />
                                    <FormField
                                      control={form.control}
                                      name={`packs.${index}.allowInReceiving`}
                                      render={({ field: itemField }) => (
                                        <FormItem className="flex items-center gap-2 space-y-0">
                                          <FormControl>
                                            <Switch
                                              checked={itemField.value}
                                              onCheckedChange={itemField.onChange}
                                              disabled={readOnly}
                                            />
                                          </FormControl>
                                          <FormLabel className="text-sm">
                                            {t("packAllowReceiving")}
                                          </FormLabel>
                                        </FormItem>
                                      )}
                                    />
                                  </div>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    className="h-9 px-3 text-danger"
                                    onClick={() => removePack(index)}
                                    disabled={readOnly}
                                  >
                                    <DeleteIcon className="h-4 w-4" aria-hidden />
                                    {t("removePack")}
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">{t("packsEmpty")}</p>
                        )}
                        <p className="text-xs text-muted-foreground">{t("packsHint")}</p>
                      </FormSection>
                      <Separator />
                    </>
                  ) : null}

                  <div ref={variantsEditorRef} className="scroll-mt-24">
                    <FormSection title={t("variants")} className={mobileProductSectionClassName}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {!readOnly && templateKeys.length ? (
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-9 px-3"
                              onClick={applyTemplateToVariants}
                            >
                              {t("applyTemplate")}
                            </Button>
                          ) : null}
                          {!readOnly && generatorDefinitions.length ? (
                            <Button
                              type="button"
                              variant="secondary"
                              className="h-9 px-3"
                              onClick={openVariantGenerator}
                            >
                              {t("generateVariants")}
                            </Button>
                          ) : null}
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          className="w-full sm:w-auto"
                          onClick={appendEmptyVariant}
                          disabled={readOnly}
                        >
                          <AddIcon className="h-4 w-4" aria-hidden />
                          {t("addVariant")}
                        </Button>
                      </div>
                      {fields.map((field, index) => {
                        const canDelete = field.canDelete ?? true;
                        const isBlocked = Boolean(field.id) && !canDelete;
                        const tooltipLabel = isBlocked
                          ? tErrors("variantInUse")
                          : t("removeVariant");
                        const variantAttributes = form.watch(`variants.${index}.attributes`) ?? [];
                        const availableDefinitions = definitions.filter(
                          (definition) =>
                            !variantAttributes.some((entry) => entry.key === definition.key),
                        );
                        const selectedAttributeKey = attributeDrafts[field.id] ?? "";
                        const imageValue = resolveVariantImageValue(watchedVariants[index] ?? {});
                        const selectedImageValue = variantImageOptionByValue.has(imageValue)
                          ? imageValue
                          : "__none";
                        return (
                          <div
                            key={field.id}
                            className="space-y-4 rounded-md border border-border/70 bg-card p-4"
                          >
                            <FormGrid className="items-start">
                              <FormField
                                control={form.control}
                                name={`variants.${index}.name`}
                                render={({ field: itemField }) => (
                                  <FormItem>
                                    <FormLabel>{t("variantName")}</FormLabel>
                                    <FormControl>
                                      <Input
                                        {...itemField}
                                        value={itemField.value ?? ""}
                                        disabled={readOnly}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              {enableSku ? (
                                <FormField
                                  control={form.control}
                                  name={`variants.${index}.sku`}
                                  render={({ field: itemField }) => (
                                    <FormItem>
                                      <FormLabel>{t("variantSku")}</FormLabel>
                                      <FormControl>
                                        <Input
                                          {...itemField}
                                          value={itemField.value ?? ""}
                                          disabled={readOnly}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              ) : null}
                              {!productId && canEditInitialStock ? (
                                <FormField
                                  control={form.control}
                                  name={`variants.${index}.initialOnHand`}
                                  render={({ field: itemField }) => (
                                    <FormItem>
                                      <FormLabel>{t("variantInitialOnHand")}</FormLabel>
                                      <FormControl>
                                        <Input
                                          {...itemField}
                                          value={itemField.value ?? ""}
                                          type="number"
                                          inputMode="numeric"
                                          min={0}
                                          step={1}
                                          placeholder={t("initialOnHandPlaceholder")}
                                          onKeyDown={preventInvalidIntegerInput}
                                          disabled={readOnly}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              ) : null}
                              {showVariantImagePicker ? (
                                <FormItem>
                                  <FormLabel>{t("variantImage")}</FormLabel>
                                  {hasVariantImageOptions ? (
                                    <Select
                                      value={selectedImageValue}
                                      onValueChange={(value) => setVariantImageValue(index, value)}
                                      disabled={readOnly}
                                    >
                                      <FormControl>
                                        <SelectTrigger className="h-16 min-w-0 gap-3 whitespace-nowrap px-2 [&>span]:flex [&>span]:min-w-0 [&>span]:items-center [&>span]:gap-3 [&>span]:truncate">
                                          <SelectValue placeholder={t("variantImageNone")} />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent className="min-w-[280px]">
                                        <SelectItem
                                          value="__none"
                                          className="min-h-12 whitespace-nowrap"
                                        >
                                          {t("variantImageNone")}
                                        </SelectItem>
                                        {variantImageOptions.map((option) => (
                                          <SelectItem
                                            key={option.value}
                                            value={option.value}
                                            className="min-h-16 whitespace-nowrap"
                                          >
                                            <VariantImageOptionPreview
                                              url={option.url}
                                              label={option.label}
                                            />
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      className="h-16 w-full justify-start"
                                      onClick={() =>
                                        openVariantImageUpload({ type: "variant", index })
                                      }
                                      disabled={readOnly || isUploadingImages}
                                    >
                                      {isUploadingImages ? (
                                        <Spinner className="h-4 w-4" />
                                      ) : (
                                        <ImagePlusIcon className="h-4 w-4" aria-hidden />
                                      )}
                                      {isUploadingImages ? tCommon("loading") : t("imagesAdd")}
                                    </Button>
                                  )}
                                </FormItem>
                              ) : null}
                            </FormGrid>

                            <div className="space-y-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <h4 className="text-sm font-semibold text-foreground">
                                  {t("variantAttributes")}
                                </h4>
                                {!readOnly && availableDefinitions.length ? (
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Select
                                      value={selectedAttributeKey}
                                      onValueChange={(value) =>
                                        setAttributeDrafts((prev) => ({
                                          ...prev,
                                          [field.id]: value,
                                        }))
                                      }
                                    >
                                      <SelectTrigger className="min-w-[160px]">
                                        <SelectValue placeholder={t("addAttribute")} />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {availableDefinitions.map((definition) => (
                                          <SelectItem key={definition.key} value={definition.key}>
                                            {resolveLabel(definition, definition.key)}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      className="h-9 px-3"
                                      onClick={() => {
                                        if (!selectedAttributeKey) {
                                          return;
                                        }
                                        const current =
                                          form.getValues(`variants.${index}.attributes`) ?? [];
                                        if (
                                          current.some(
                                            (entry) => entry.key === selectedAttributeKey,
                                          )
                                        ) {
                                          return;
                                        }
                                        const definition = definitionMap.get(selectedAttributeKey);
                                        const defaultValue =
                                          definition?.type === "MULTI_SELECT" ? [] : "";
                                        form.setValue(
                                          `variants.${index}.attributes`,
                                          [
                                            ...current,
                                            { key: selectedAttributeKey, value: defaultValue },
                                          ],
                                          { shouldDirty: true, shouldValidate: true },
                                        );
                                        setAttributeDrafts((prev) => ({
                                          ...prev,
                                          [field.id]: "",
                                        }));
                                      }}
                                    >
                                      <AddIcon className="h-4 w-4" aria-hidden />
                                      {t("addAttribute")}
                                    </Button>
                                  </div>
                                ) : null}
                              </div>

                              {variantAttributes.length ? (
                                <div className="grid gap-3 md:grid-cols-2">
                                  {variantAttributes.map((attribute, attrIndex) => {
                                    const definition = definitionMap.get(attribute.key);
                                    const label = resolveLabel(definition, attribute.key);
                                    const isRequired = Boolean(definition?.required);
                                    const options = resolveOptions(definition);
                                    const fieldName =
                                      `variants.${index}.attributes.${attrIndex}.value` as const;
                                    const selectedValues = Array.isArray(attribute.value)
                                      ? attribute.value.map((value) => String(value))
                                      : [];
                                    const currentValue =
                                      typeof attribute.value === "string" ||
                                      typeof attribute.value === "number"
                                        ? String(attribute.value)
                                        : "";
                                    const selectOptions =
                                      currentValue && !options.includes(currentValue)
                                        ? [currentValue, ...options]
                                        : options;
                                    return (
                                      <FormField
                                        key={`${attribute.key}-${attrIndex}`}
                                        control={form.control}
                                        name={fieldName}
                                        render={({ field: attrField }) => (
                                          <FormItem className="rounded-md border border-border/70 p-3">
                                            <div className="flex items-center justify-between gap-2">
                                              <FormLabel>
                                                {label}
                                                {isRequired ? (
                                                  <span className="text-danger"> *</span>
                                                ) : null}
                                              </FormLabel>
                                              {!readOnly && !isRequired ? (
                                                <Tooltip>
                                                  <TooltipTrigger asChild>
                                                    <Button
                                                      type="button"
                                                      size="icon"
                                                      variant="ghost"
                                                      className="h-7 w-7"
                                                      aria-label={t("removeAttribute")}
                                                      onClick={() => {
                                                        const next = variantAttributes.filter(
                                                          (_, idx) => idx !== attrIndex,
                                                        );
                                                        form.setValue(
                                                          `variants.${index}.attributes`,
                                                          next,
                                                          {
                                                            shouldDirty: true,
                                                            shouldValidate: true,
                                                          },
                                                        );
                                                      }}
                                                    >
                                                      <DeleteIcon className="h-3 w-3" aria-hidden />
                                                    </Button>
                                                  </TooltipTrigger>
                                                  <TooltipContent>
                                                    {t("removeAttribute")}
                                                  </TooltipContent>
                                                </Tooltip>
                                              ) : null}
                                            </div>
                                            {definition?.type === "SELECT" ? (
                                              <FormControl>
                                                <Select
                                                  value={currentValue}
                                                  onValueChange={(value) =>
                                                    attrField.onChange(value)
                                                  }
                                                  disabled={readOnly}
                                                >
                                                  <SelectTrigger>
                                                    <SelectValue
                                                      placeholder={t("selectAttributeValue")}
                                                    />
                                                  </SelectTrigger>
                                                  <SelectContent>
                                                    {selectOptions.map((option) => (
                                                      <SelectItem key={option} value={option}>
                                                        {option}
                                                      </SelectItem>
                                                    ))}
                                                  </SelectContent>
                                                </Select>
                                              </FormControl>
                                            ) : definition?.type === "MULTI_SELECT" ? (
                                              <FormControl>
                                                <div className="flex flex-wrap gap-2">
                                                  {options.map((option) => {
                                                    const isSelected =
                                                      selectedValues.includes(option);
                                                    return (
                                                      <Button
                                                        key={option}
                                                        type="button"
                                                        variant={isSelected ? "secondary" : "ghost"}
                                                        className="h-8 px-3 text-xs"
                                                        aria-pressed={isSelected}
                                                        onClick={() => {
                                                          if (readOnly) {
                                                            return;
                                                          }
                                                          const next = isSelected
                                                            ? selectedValues.filter(
                                                                (value) => value !== option,
                                                              )
                                                            : [...selectedValues, option];
                                                          attrField.onChange(next);
                                                        }}
                                                        disabled={readOnly}
                                                      >
                                                        {option}
                                                      </Button>
                                                    );
                                                  })}
                                                  {selectedValues
                                                    .filter((value) => !options.includes(value))
                                                    .map((value) => (
                                                      <Badge
                                                        key={value}
                                                        variant="muted"
                                                        className="gap-1 pr-1"
                                                      >
                                                        <span>{value}</span>
                                                        {!readOnly ? (
                                                          <Button
                                                            type="button"
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-6 w-6 shadow-none"
                                                            aria-label={t("removeAttributeValue")}
                                                            onClick={() => {
                                                              const next = selectedValues.filter(
                                                                (entry) => entry !== value,
                                                              );
                                                              attrField.onChange(next);
                                                            }}
                                                          >
                                                            <CloseIcon
                                                              className="h-3 w-3"
                                                              aria-hidden
                                                            />
                                                          </Button>
                                                        ) : null}
                                                      </Badge>
                                                    ))}
                                                </div>
                                              </FormControl>
                                            ) : (
                                              <FormControl>
                                                <Input
                                                  {...(() => {
                                                    const { value: _unused, ...rest } = attrField;
                                                    void _unused;
                                                    return rest;
                                                  })()}
                                                  value={currentValue}
                                                  onChange={(event) =>
                                                    attrField.onChange(event.target.value)
                                                  }
                                                  type={
                                                    definition?.type === "NUMBER"
                                                      ? "number"
                                                      : "text"
                                                  }
                                                  inputMode={
                                                    definition?.type === "NUMBER"
                                                      ? "decimal"
                                                      : "text"
                                                  }
                                                  disabled={readOnly}
                                                />
                                              </FormControl>
                                            )}
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                    );
                                  })}
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground">
                                  {t("variantAttributesEmpty")}
                                </p>
                              )}
                              {definitions.length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                  {t("variantAttributesNoDefinitions")}
                                </p>
                              ) : null}
                            </div>

                            <div className="flex items-center justify-end">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex">
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      className="shadow-none"
                                      aria-label={t("removeVariant")}
                                      onClick={() => setVariantToRemove(index)}
                                      disabled={readOnly || isBlocked}
                                    >
                                      <DeleteIcon className="h-4 w-4" aria-hidden />
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>{tooltipLabel}</TooltipContent>
                              </Tooltip>
                            </div>
                          </div>
                        );
                      })}
                    </FormSection>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        </TooltipProvider>

        {!readOnly && !hideActions ? (
          <FormActions className="hidden md:flex">
            <Button type="submit" className="w-full sm:w-auto" disabled={isSubmitting}>
              {isSubmitting ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <StatusSuccessIcon className="h-4 w-4" aria-hidden />
              )}
              {isSubmitting ? t("saving") : t("save")}
            </Button>
          </FormActions>
        ) : null}
        {!readOnly && !hideActions ? (
          <div className="mt-4 rounded-md border border-border bg-background p-3 shadow-[0_10px_30px_rgba(15,23,42,0.08)] md:hidden">
            <Button type="submit" className="min-h-11 w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <StatusSuccessIcon className="h-4 w-4" aria-hidden />
              )}
              {isSubmitting ? t("saving") : t("save")}
            </Button>
          </div>
        ) : null}
      </form>

      {!readOnly ? (
        <Modal
          open={generatorOpen}
          onOpenChange={(open) => setGeneratorOpen(open)}
          title={t("generatorTitle")}
          subtitle={t("generatorSubtitle")}
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">{t("generatorAttributes")}</p>
                {generatorAvailableDefinitions.length ? (
                  <FormRow className="w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-end">
                    <Select
                      value={generatorDraftKey}
                      onValueChange={(value) => setGeneratorDraftKey(value)}
                    >
                      <SelectTrigger className="min-w-[180px]">
                        <SelectValue placeholder={t("generatorAttributePlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {generatorAvailableDefinitions.map((definition) => (
                          <SelectItem key={definition.key} value={definition.key}>
                            {resolveLabel(definition, definition.key)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-9 px-3"
                      onClick={() => {
                        if (!generatorDraftKey) {
                          return;
                        }
                        setGeneratorAttributes((prev) => [
                          ...prev,
                          { key: generatorDraftKey, values: [] },
                        ]);
                        setGeneratorDraftKey("");
                      }}
                    >
                      <AddIcon className="h-4 w-4" aria-hidden />
                      {t("generatorAddAttribute")}
                    </Button>
                  </FormRow>
                ) : null}
              </div>

              {generatorAttributes.length ? (
                <div className="space-y-3">
                  {generatorAttributes.map((attribute) => {
                    const definition = generatorDefinitionMap.get(attribute.key);
                    const label = resolveLabel(definition, attribute.key);
                    const options = resolveOptions(definition);
                    const selectedValues = attribute.values;
                    const draftValue = generatorValueDrafts[attribute.key] ?? "";
                    return (
                      <div
                        key={attribute.key}
                        className="rounded-md border border-border/70 bg-card p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-foreground">{label}</p>
                            <p className="text-xs text-muted-foreground">
                              {t("generatorAttributeHint")}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={t("removeAttribute")}
                            onClick={() =>
                              setGeneratorAttributes((prev) =>
                                prev.filter((entry) => entry.key !== attribute.key),
                              )
                            }
                          >
                            <CloseIcon className="h-4 w-4" aria-hidden />
                          </Button>
                        </div>

                        <div className="mt-3 space-y-2">
                          {options.length ? (
                            <div className="flex flex-wrap gap-2">
                              {options.map((option) => {
                                const isSelected = selectedValues.includes(option);
                                return (
                                  <Button
                                    key={option}
                                    type="button"
                                    variant={isSelected ? "secondary" : "ghost"}
                                    className="h-8 px-3 text-xs"
                                    aria-pressed={isSelected}
                                    onClick={() => {
                                      const nextValues = isSelected
                                        ? selectedValues.filter((value) => value !== option)
                                        : [...selectedValues, option];
                                      setGeneratorAttributes((prev) =>
                                        prev.map((entry) =>
                                          entry.key === attribute.key
                                            ? { ...entry, values: nextValues }
                                            : entry,
                                        ),
                                      );
                                    }}
                                  >
                                    {option}
                                  </Button>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              {t("generatorNoOptions")}
                            </p>
                          )}

                          <FormRow className="flex-col items-stretch gap-2 sm:flex-row sm:items-end">
                            <Input
                              value={draftValue}
                              onChange={(event) =>
                                setGeneratorValueDrafts((prev) => ({
                                  ...prev,
                                  [attribute.key]: event.target.value,
                                }))
                              }
                              placeholder={t("generatorValuePlaceholder")}
                              disabled={readOnly}
                            />
                            <Button
                              type="button"
                              variant="secondary"
                              className="h-9 px-3"
                              onClick={() => {
                                const value = draftValue.trim();
                                if (!value) {
                                  return;
                                }
                                if (selectedValues.includes(value)) {
                                  return;
                                }
                                setGeneratorAttributes((prev) =>
                                  prev.map((entry) =>
                                    entry.key === attribute.key
                                      ? { ...entry, values: [...entry.values, value] }
                                      : entry,
                                  ),
                                );
                                setGeneratorValueDrafts((prev) => ({
                                  ...prev,
                                  [attribute.key]: "",
                                }));
                              }}
                            >
                              {t("generatorAddValue")}
                            </Button>
                          </FormRow>

                          {selectedValues.filter((value) => !options.includes(value)).length ? (
                            <div className="flex flex-wrap gap-2">
                              {selectedValues
                                .filter((value) => !options.includes(value))
                                .map((value) => (
                                  <Badge key={value} variant="muted" className="gap-1 pr-1">
                                    <span>{value}</span>
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      className="h-6 w-6 shadow-none"
                                      aria-label={t("removeAttributeValue")}
                                      onClick={() =>
                                        setGeneratorAttributes((prev) =>
                                          prev.map((entry) =>
                                            entry.key === attribute.key
                                              ? {
                                                  ...entry,
                                                  values: entry.values.filter(
                                                    (item) => item !== value,
                                                  ),
                                                }
                                              : entry,
                                          ),
                                        )
                                      }
                                    >
                                      <CloseIcon className="h-3 w-3" aria-hidden />
                                    </Button>
                                  </Badge>
                                ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{t("generatorEmpty")}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{t("generatorPreview", { count: generatorPreviewCount })}</span>
              {templateKeys.length ? <span>{t("generatorTemplateHint")}</span> : null}
            </div>

            <ModalFooter>
              <Button type="button" variant="ghost" onClick={() => setGeneratorOpen(false)}>
                {tCommon("cancel")}
              </Button>
              <Button type="button" onClick={handleGenerateVariants}>
                {t("generatorConfirm")}
              </Button>
            </ModalFooter>
          </div>
        </Modal>
      ) : null}

      {!readOnly ? (
        <Modal
          open={variantToRemove !== null}
          onOpenChange={(open) => {
            if (!open) {
              setVariantToRemove(null);
            }
          }}
          title={t("removeVariant")}
          subtitle={t("confirmRemoveVariant")}
        >
          <ModalFooter>
            <Button type="button" variant="ghost" onClick={() => setVariantToRemove(null)}>
              {tCommon("cancel")}
            </Button>
            <Button type="button" variant="danger" onClick={handleConfirmRemoveVariant}>
              {tCommon("confirm")}
            </Button>
          </ModalFooter>
        </Modal>
      ) : null}

      <Modal
        open={isImageEditorOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeImageEditor();
          }
        }}
        title={t("imageEditorTitle")}
        subtitle={readOnly ? t("imageEditorPreviewSubtitle") : t("imageEditorSubtitle")}
        className="max-w-4xl"
        bodyClassName="space-y-4 p-4 sm:p-6"
        usePortal
      >
        <div className="space-y-4">
          <div className="relative h-[48vh] min-h-[280px] overflow-hidden rounded-md border border-border bg-black/70">
            {isPreparingImageEditor ? (
              <div className="flex h-full items-center justify-center text-sm text-white/90">
                <Spinner className="h-4 w-4" />
                {tCommon("loading")}
              </div>
            ) : imageEditorObjectUrl ? (
              <Cropper
                image={imageEditorObjectUrl}
                crop={imageEditorCrop}
                zoom={imageEditorZoom}
                rotation={imageEditorRotation}
                aspect={imageEditorAspect}
                minZoom={1}
                maxZoom={3}
                zoomSpeed={0.15}
                showGrid
                objectFit="contain"
                onCropChange={setImageEditorCrop}
                onZoomChange={setImageEditorZoom}
                onRotationChange={setImageEditorRotation}
                onCropComplete={(_, croppedAreaPixels) =>
                  setImageEditorCroppedAreaPixels(croppedAreaPixels)
                }
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-white/90">
                {t("imagesEmpty")}
              </div>
            )}
          </div>

          {imageEditorSourceUrl ? (
            <p className="truncate text-xs text-muted-foreground">
              {t("imageEditorSource", { source: imageEditorSourceUrl })}
            </p>
          ) : null}

          {!readOnly ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-3 rounded-md border border-border bg-secondary/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {t("imageEditorZoom")}
                  </span>
                  <Badge variant="muted">{imageEditorZoomPercent}%</Badge>
                </div>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={imageEditorZoom}
                  onChange={(event) => {
                    const nextValue = event.currentTarget.valueAsNumber;
                    if (Number.isFinite(nextValue)) {
                      setImageEditorZoom(nextValue);
                    }
                  }}
                  aria-label={t("imageEditorZoom")}
                  className="h-2 w-full cursor-pointer appearance-none rounded-md bg-muted accent-primary"
                />
              </div>

              <div className="space-y-3 rounded-md border border-border bg-secondary/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {t("imageEditorRotation")}
                  </span>
                  <Badge variant="muted">{imageEditorRotationDegrees}°</Badge>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="range"
                    min={0}
                    max={360}
                    step={1}
                    value={imageEditorRotation}
                    onChange={(event) => {
                      const nextValue = event.currentTarget.valueAsNumber;
                      if (Number.isFinite(nextValue)) {
                        setImageEditorRotation(nextValue);
                      }
                    }}
                    aria-label={t("imageEditorRotation")}
                    className="h-2 w-full cursor-pointer appearance-none rounded-md bg-muted accent-primary"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-8 shrink-0 px-3"
                    onClick={() => setImageEditorRotation((prev) => (prev + 90) % 360)}
                    disabled={isSavingImageEdit}
                  >
                    <RestoreIcon className="h-3.5 w-3.5" aria-hidden />
                    {t("imageEditorRotate90")}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          <ModalFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={closeImageEditor}
              disabled={isSavingImageEdit}
            >
              {tCommon("cancel")}
            </Button>
            {!readOnly ? (
              <Button
                type="button"
                onClick={() => void saveEditedImage()}
                disabled={isSavingImageEdit || isPreparingImageEditor || !imageEditorObjectUrl}
              >
                {isSavingImageEdit ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <StatusSuccessIcon className="h-4 w-4" aria-hidden />
                )}
                {isSavingImageEdit ? tCommon("loading") : t("imageEditorSave")}
              </Button>
            ) : null}
          </ModalFooter>
        </div>
      </Modal>
    </Form>
  );
};

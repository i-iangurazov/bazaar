"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { z } from "zod";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Cropper, { type Area } from "react-easy-crop";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FormActions,
  FormGrid,
  FormRow,
  FormSection,
} from "@/components/form-layout";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  StatusSuccessIcon,
  ViewIcon,
} from "@/components/icons";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { buildVariantMatrix, type VariantGeneratorAttribute } from "@/lib/variantGenerator";
import {
  normalizeImageMimeType,
  prepareProductImageFileForUpload,
  resolvePrimaryImageUrl,
} from "@/lib/productImageUpload";

export type ProductFormValues = {
  sku: string;
  name: string;
  isBundle?: boolean;
  category?: string;
  baseUnitId: string;
  basePriceKgs?: number;
  purchasePriceKgs?: number;
  avgCostKgs?: number;
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
    name?: string;
    sku?: string;
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

const defaultProductImageMaxBytes = 5 * 1024 * 1024;
const defaultProductImageMaxInputBytes = 10 * 1024 * 1024;

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
    return Math.max(Math.trunc(parsed), maxImageBytes);
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


export const ProductForm = ({
  initialValues,
  onSubmit,
  isSubmitting,
  attributeDefinitions,
  units,
  readOnly = false,
  productId,
}: {
  initialValues: ProductFormValues;
  onSubmit: (values: ProductFormValues) => void;
  isSubmitting?: boolean;
  attributeDefinitions?: AttributeDefinition[];
  units?: UnitOption[];
  readOnly?: boolean;
  productId?: string;
}) => {
  const t = useTranslations("products");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { toast } = useToast();
  const definitions = useMemo(() => attributeDefinitions ?? [], [attributeDefinitions]);
  const definitionMap = useMemo(
    () => new Map(definitions.map((definition) => [definition.key, definition])),
    [definitions],
  );
  const requiredDefinitions = useMemo(
    () => definitions.filter((definition) => definition.required),
    [definitions],
  );

  const resolveLabel = (definition?: AttributeDefinition, fallbackKey?: string) => {
    if (!definition) {
      return fallbackKey ?? "";
    }
    return locale === "kg" ? definition.labelKg : definition.labelRu;
  };

  const resolveOptions = (definition?: AttributeDefinition) => {
    if (!definition) {
      return [] as string[];
    }
    const options = locale === "kg" ? definition.optionsKg : definition.optionsRu;
    return Array.isArray(options) ? options : [];
  };
  const unitOptions = useMemo(() => units ?? [], [units]);
  const resolveUnitLabel = (unit: UnitOption) =>
    locale === "kg" ? unit.labelKg : unit.labelRu;
  const schema = useMemo(
    () => {
      const optionalPrice = z.preprocess(
        (value) => (value === "" || value === null || value === undefined ? undefined : value),
        z.coerce.number().min(0, t("priceNonNegative")).optional(),
      );

      return z.object({
        sku: z.string().min(2, t("skuRequired")),
        name: z.string().min(2, t("nameRequired")),
        isBundle: z.boolean().optional(),
        category: z.string().optional(),
        baseUnitId: z.string().min(1, t("unitRequired")),
        basePriceKgs: optionalPrice,
        purchasePriceKgs: optionalPrice,
        avgCostKgs: optionalPrice,
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
            name: z.string().optional(),
            sku: z.string().optional(),
            attributes: z
              .array(
                z.object({
                  key: z.string().min(1),
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
              componentProductId: z.string().min(1),
              componentVariantId: z.string().optional().nullable(),
              qty: z.coerce.number().int().positive(t("bundleQtyPositive")),
              componentName: z.string().optional(),
              componentSku: z.string().optional(),
            }),
          )
          .optional(),
      });
    },
    [t],
  );
  type VariantFormRow = z.infer<typeof schema>["variants"][number];

  const toAttributeEntries = (attributes: Record<string, unknown>) => {
    const entries = Object.entries(attributes ?? {}).map(([key, value]) => ({
      key,
      value: Array.isArray(value)
        ? value.filter((item) => typeof item === "string").map((item) => item.trim())
        : value ?? "",
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
      category: initialValues.category ?? "",
      baseUnitId: initialValues.baseUnitId,
      basePriceKgs: initialValues.basePriceKgs ?? undefined,
      purchasePriceKgs: initialValues.purchasePriceKgs ?? undefined,
      avgCostKgs: initialValues.avgCostKgs ?? undefined,
      description: initialValues.description ?? "",
      photoUrl: initialValues.photoUrl ?? "",
      images: initialValues.images ?? [],
      barcodes: initialValues.barcodes ?? [],
      packs: initialValues.packs ?? [],
      variants:
        initialValues.variants.length > 0
          ? initialValues.variants.map((variant) => ({
              id: variant.id,
              name: variant.name ?? "",
              sku: variant.sku ?? "",
              attributes: toAttributeEntries(variant.attributes ?? {}),
              canDelete: variant.canDelete ?? true,
            }))
          : [
              {
                id: undefined,
                name: "",
                sku: "",
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

  useEffect(() => {
    if (!form.getValues("baseUnitId") && unitOptions.length) {
      form.setValue("baseUnitId", unitOptions[0].id, { shouldValidate: true });
    }
  }, [form, unitOptions]);

  const categoryValue = form.watch("category");
  const emptyCategoryOptionValue = "__category_none__";
  const categoryOptionsQuery = trpc.productCategories.list.useQuery(undefined, {
    enabled: !readOnly,
  });
  const templateQuery = trpc.categoryTemplates.list.useQuery(
    { category: categoryValue?.trim() || "" },
    { enabled: !readOnly && Boolean(categoryValue?.trim()) },
  );
  const categoryOptions = useMemo(() => {
    const categories = new Set<string>();
    (categoryOptionsQuery.data ?? []).forEach((value) => {
      const normalized = value.trim();
      if (normalized) {
        categories.add(normalized);
      }
    });
    const selected = categoryValue?.trim();
    if (selected) {
      categories.add(selected);
    }
    return Array.from(categories).sort((a, b) => a.localeCompare(b));
  }, [categoryOptionsQuery.data, categoryValue]);
  const templateKeys = useMemo(() => {
    return (templateQuery.data ?? [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((item) => item.attributeKey);
  }, [templateQuery.data]);
  const generatorDefinitions = useMemo(
    () => definitions.filter((definition) => definition.type === "SELECT" || definition.type === "MULTI_SELECT"),
    [definitions],
  );
  const generatorDefinitionMap = useMemo(
    () => new Map(generatorDefinitions.map((definition) => [definition.key, definition])),
    [generatorDefinitions],
  );

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "variants",
  });

  const {
    fields: imageFields,
    append: appendImageField,
    remove: removeImageField,
    move: moveImageField,
  } = useFieldArray({
    control: form.control,
    name: "images",
  });
  const watchedImagesValue = useWatch({ control: form.control, name: "images" });
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
  const [isDragActive, setIsDragActive] = useState(false);
  const [draggedImageIndex, setDraggedImageIndex] = useState<number | null>(null);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [barcodeGenerateMode, setBarcodeGenerateMode] = useState<"EAN13" | "CODE128">("EAN13");
  const [variantToRemove, setVariantToRemove] = useState<number | null>(null);
  const [showDetails, setShowDetails] = useState(
    () =>
      Boolean(
        initialValues.description?.trim() ||
          initialValues.photoUrl?.trim() ||
          initialValues.images?.length,
      ),
  );
  const [showAdvanced, setShowAdvanced] = useState(
    () => Boolean(initialValues.barcodes?.length || initialValues.variants?.length),
  );
  const [attributeDrafts, setAttributeDrafts] = useState<Record<string, string>>({});
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [generatorAttributes, setGeneratorAttributes] = useState<VariantGeneratorAttribute[]>([]);
  const [generatorDraftKey, setGeneratorDraftKey] = useState("");
  const [generatorValueDrafts, setGeneratorValueDrafts] = useState<Record<string, string>>({});
  const [bundleSearch, setBundleSearch] = useState("");
  const [showBundleResults, setShowBundleResults] = useState(false);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
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
  const maxInputImageBytes = resolveClientImageMaxInputBytes(maxImageBytes);
  const maxImageUploadConcurrency = resolveClientImageUploadConcurrency();

  const bundleSearchQuery = trpc.products.searchQuick.useQuery(
    { q: bundleSearch.trim() },
    { enabled: !readOnly && isBundle && bundleSearch.trim().length >= 1 },
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

  const shouldLogImagePrepDebug =
    process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_IMAGE_UPLOAD_DEBUG === "1";
  const logImagePrepDebug = (
    step: string,
    details?: Record<string, unknown>,
    error?: unknown,
  ) => {
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

  const optimizeImageToLimit = async (file: File) => {
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
        if (best.size <= maxImageBytes) {
          return best;
        }

        // Second pass: quality optimization before lowering dimensions further.
        const fallbackType: "image/jpeg" | "image/webp" =
          normalizedType === "image/png" ? "image/webp" : "image/jpeg";
        const qualitySteps = allowAggressiveQuality
          ? [0.98, 0.95, 0.92, 0.9, 0.88, 0.85, 0.82, 0.78, 0.74, 0.7, 0.66, 0.62, 0.58] as const
          : [0.98, 0.95, 0.92, 0.9, 0.88, 0.85, 0.82] as const;
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
          if (optimized.size <= maxImageBytes) {
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
      if (best?.size && best.size <= maxImageBytes) {
        return best;
      }

      // Keep compressing/downscaling until target is met or hard minimum is reached.
      const minDimension = 320;
      const maxResizePasses = 8;
      for (let pass = 0; pass < maxResizePasses; pass += 1) {
        const referenceSize = best?.size ?? file.size;
        if (referenceSize <= maxImageBytes) {
          return best;
        }
        if (targetWidth <= minDimension && targetHeight <= minDimension) {
          break;
        }

        const predictedScale = Math.sqrt(maxImageBytes / Math.max(referenceSize, 1));
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
        if (resized.size <= maxImageBytes) {
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

  const convertHeicToJpeg = async (file: File) => {
    try {
      const heic2anyModule = await import("heic2any");
      const topLevelDefault = (heic2anyModule as { default?: unknown }).default;
      const nestedDefault =
        topLevelDefault && typeof topLevelDefault === "object"
          ? (topLevelDefault as { default?: unknown }).default
          : undefined;
      const convertCandidate = (
        typeof topLevelDefault === "function"
          ? topLevelDefault
          : typeof nestedDefault === "function"
            ? nestedDefault
            : typeof (heic2anyModule as unknown) === "function"
              ? (heic2anyModule as unknown)
              : null
      );
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
      const convert = convertCandidate as (
        options: { blob: Blob; toType: string; quality?: number },
      ) => Promise<Blob | Blob[]>;
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
      logImagePrepDebug(
        "heic-convert-failed",
        {
          fileName: file.name,
          size: file.size,
          type: file.type,
        },
        error,
      );
      return null;
    }
  };

  const uploadImageFile = async (file: File) => {
    const formData = new FormData();
    formData.set("file", file);
    if (productId) {
      formData.set("productId", productId);
    }

    const response = await fetch("/api/product-images/upload", {
      method: "POST",
      body: formData,
    });
    const body = (await response.json().catch(() => null)) as
      | { message?: string; url?: string }
      | null;
    if (!response.ok) {
      const code = body?.message;
      logImagePrepDebug("upload-request-failed", {
        status: response.status,
        code,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
      });
      if (code === "forbidden") {
        toast({ variant: "error", description: tErrors("forbidden") });
      } else if (code === "imageInvalidType") {
        toast({ variant: "error", description: t("imageInvalidType") });
      } else if (code === "imageTooLarge") {
        toast({
          variant: "error",
          description: t("imageTooLargeAfterCompression", {
            size: Math.round(maxImageBytes / (1024 * 1024)),
          }),
        });
      } else {
        toast({ variant: "error", description: t("imageReadFailed") });
      }
      return null;
    }

    const uploadedUrl = body?.url?.trim();
    if (!uploadedUrl) {
      logImagePrepDebug("upload-missing-url", {
        status: response.status,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
      });
      toast({ variant: "error", description: t("imageReadFailed") });
      return null;
    }
    return uploadedUrl;
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

      const rotatedBounds = getRotatedBoundingBox(
        sourceWidth,
        sourceHeight,
        input.rotation,
      );
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
      const cropX = Math.max(
        0,
        Math.min(Math.round(input.cropAreaPixels.x), maxCropX),
      );
      const cropY = Math.max(
        0,
        Math.min(Math.round(input.cropAreaPixels.y), maxCropY),
      );

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
      const response = await fetch(imageUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("imageReadFailed");
      }
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) {
        throw new Error("imageInvalidType");
      }

      const fileName = resolveImageFileNameFromUrl(imageUrl, blob.type || "image/jpeg");
      const sourceFile = new File([blob], fileName, {
        type: blob.type || "image/jpeg",
        lastModified: Date.now(),
      });
      const objectUrl = URL.createObjectURL(sourceFile);
      const dimensions = await getImageDimensions(objectUrl);
      const nextAspect =
        dimensions.width > 0 && dimensions.height > 0
          ? dimensions.width / dimensions.height
          : 1;
      setImageEditorAspect(nextAspect || 1);
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
      const editedImageFieldId = imageFields[imageEditorIndex]?.id;
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

  const handleImageFiles = async (files: FileList | File[]) => {
    if (readOnly || isUploadingImages) {
      return;
    }
    const list = Array.from(files);
    if (!list.length) {
      return;
    }
    setIsUploadingImages(true);
    try {
      const results: Array<{ url: string } | null> = new Array(list.length).fill(null);
      let cursor = 0;
      const workers = Array.from({ length: Math.min(maxImageUploadConcurrency, list.length) }, async () => {
        while (true) {
          const nextIndex = cursor;
          cursor += 1;
          if (nextIndex >= list.length) {
            return;
          }

          const originalFile = list[nextIndex];
          const prepared = await prepareProductImageFileForUpload({
            file: originalFile,
            maxImageBytes,
            maxInputImageBytes,
            convertHeicToJpeg,
            optimizeImageToLimit,
          });
          if (!prepared.ok) {
            logImagePrepDebug("prepare-failed", {
              fileName: originalFile.name,
              fileSize: originalFile.size,
              fileType: originalFile.type,
              code: prepared.code,
              reason: prepared.reason,
            });
            if (prepared.code === "imageTooLargeInput") {
              toast({
                variant: "error",
                description: t("imageTooLargeInput", {
                  size: Math.round(maxInputImageBytes / (1024 * 1024)),
                }),
              });
              continue;
            }
            if (prepared.code === "imageTooLargeAfterCompression") {
              toast({
                variant: "error",
                description: t("imageTooLargeAfterCompression", {
                  size: Math.round(maxImageBytes / (1024 * 1024)),
                }),
              });
              continue;
            }
            if (prepared.code === "imageInvalidType") {
              toast({ variant: "error", description: t("imageInvalidType") });
              continue;
            }
            toast({ variant: "error", description: t("imageCompressionFailed") });
            continue;
          }

          const uploadedUrl = await uploadImageFile(prepared.file);
          if (uploadedUrl) {
            results[nextIndex] = { url: uploadedUrl };
          }
        }
      });

      await Promise.all(workers);
      const nextImages = results.filter((result): result is { url: string } => Boolean(result));

      if (nextImages.length) {
        handleAppendImageEntries(nextImages);
      }
    } finally {
      setIsUploadingImages(false);
    }
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
        : entry.value ?? "";
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
        name,
        sku: "",
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

  const addBundleComponentFromSearch = (component: {
    id: string;
    name: string;
    sku: string;
  }) => {
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

  const handleSubmit = (values: z.infer<typeof schema>) => {
    if (readOnly) {
      return;
    }
    const parsedVariants: ProductFormValues["variants"] = [];

    for (const [index, variant] of values.variants.entries()) {
      const attributes = variant.attributes ?? [];
      const hasContent =
        Boolean(variant.name?.trim()) ||
        Boolean(variant.sku?.trim()) ||
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
              message: t("attributeRequired", { attribute: resolveLabel(definition, definition.key) }),
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
          const selected = Array.isArray(rawValue)
            ? rawValue.map((value) => String(value))
            : [];
          if (selected.length) {
            parsedAttributes[entry.key] = selected;
          }
          continue;
        }

        parsedAttributes[entry.key] = String(rawValue);
      }

      parsedVariants.push({
        id: variant.id,
        name: variant.name?.trim() || undefined,
        sku: variant.sku?.trim() || undefined,
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

    onSubmit({
      sku: values.sku.trim(),
      name: values.name.trim(),
      isBundle: Boolean(values.isBundle),
      category: values.category?.trim() || undefined,
      baseUnitId: values.baseUnitId,
      basePriceKgs: Number.isFinite(values.basePriceKgs ?? NaN)
        ? values.basePriceKgs
        : undefined,
      purchasePriceKgs: Number.isFinite(values.purchasePriceKgs ?? NaN)
        ? values.purchasePriceKgs
        : undefined,
      avgCostKgs: Number.isFinite(values.avgCostKgs ?? NaN)
        ? values.avgCostKgs
        : undefined,
      description: values.description?.trim() || undefined,
      photoUrl: resolvedPhotoUrl,
      images: resolvedImages,
      barcodes: values.barcodes?.map((value) => value.trim()).filter(Boolean) ?? [],
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

  return (
    <Form {...form}>
      <form className="space-y-6" onSubmit={form.handleSubmit(handleSubmit)}>
        <TooltipProvider>
          <Card>
            <CardHeader>
              <CardTitle>{isBundle ? t("detailsBundleTitle") : t("detailsTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormSection title={isBundle ? t("basicInfoBundleTitle") : t("basicInfoTitle")}>
                <FormGrid className="items-start">
                  <FormField
                    control={form.control}
                    name="sku"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("sku")}</FormLabel>
                        <FormControl>
                          <Input {...field} disabled={readOnly} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("name")}</FormLabel>
                        <FormControl>
                          <Input {...field} disabled={readOnly} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
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
                  <FormField
                    control={form.control}
                    name="category"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("category")}</FormLabel>
                        <FormControl>
                          <Select
                            value={field.value?.trim() || emptyCategoryOptionValue}
                            onValueChange={(value) =>
                              field.onChange(value === emptyCategoryOptionValue ? "" : value)
                            }
                            disabled={readOnly}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder={t("categoryPlaceholder")} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={emptyCategoryOptionValue}>
                                {tCommon("notAvailable")}
                              </SelectItem>
                              {categoryOptions.map((value) => (
                                <SelectItem key={value} value={value}>
                                  {value}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormDescription>{t("categoryHint")}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
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
                  <FormField
                    control={form.control}
                    name="basePriceKgs"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("basePrice")}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
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
                  <FormField
                    control={form.control}
                    name="purchasePriceKgs"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("purchasePrice")}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            placeholder={t("pricePlaceholder")}
                            disabled={readOnly}
                          />
                        </FormControl>
                        <FormDescription>{t("purchasePriceHint")}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="avgCostKgs"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("avgCost")}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
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
                </FormGrid>
              </FormSection>

              {isBundle ? (
                <FormSection
                  title={t("bundleComponentsTitle")}
                  description={t("bundleComponentsHint")}
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
                              <button
                                key={product.id}
                                type="button"
                                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() =>
                                  addBundleComponentFromSearch({
                                    id: product.id,
                                    name: product.name,
                                    sku: product.sku,
                                  })
                                }
                              >
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-foreground">{product.name}</p>
                                  <p className="truncate text-xs text-muted-foreground">{product.sku}</p>
                                </div>
                                {product.isBundle ? (
                                  <Badge variant="muted">{t("bundleProductLabel")}</Badge>
                                ) : null}
                              </button>
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

              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">{t("descriptionTitle")}</h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDetails((prev) => !prev)}
                >
                  {showDetails ? t("hideDetails") : t("showDetails")}
                </Button>
              </div>
              {showDetails ? (
                <>
                  <Separator />
                  <FormSection title={t("imagesTitle")} description={t("imagesHint")}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,.heic,.heif,image/heic,image/heif"
                        multiple
                        className="hidden"
                        disabled={readOnly || isUploadingImages}
                        onChange={(event) => {
                          const files = event.target.files;
                          if (files && files.length) {
                            void handleImageFiles(files);
                          }
                          event.target.value = "";
                        }}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full sm:w-auto"
                        onClick={() => fileInputRef.current?.click()}
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
                    {imageFields.length ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {imageFields.map((image, index) => {
                          const imageUrl = watchedImages[index]?.url?.trim() || image.url;
                          const canMoveUp = index > 0;
                          const canMoveDown = index < imageFields.length - 1;
                          return (
                            <div
                              key={image.id}
                              className={`flex items-start gap-3 rounded-md border border-border bg-card p-3 ${
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
                              <div className="flex h-36 w-36 items-center justify-center overflow-hidden rounded-md bg-muted/30">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={withPreviewVersion(imageUrl, image.id)}
                                  alt={t("imageAlt", { index: index + 1 })}
                                  className="h-full w-full object-cover"
                                />
                              </div>
                              <div className="min-w-0 flex-1 space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  {index === 0 ? (
                                    <Badge variant="success">{t("imagePrimary")}</Badge>
                                  ) : null}
                                  <span className="text-xs text-muted-foreground">
                                    {t("imagePosition", { index: index + 1, total: imageFields.length })}
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
                              <div className="flex flex-col items-center gap-2">
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
                                  key={image.id}
                                  href={image.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block space-y-1 rounded-md border border-border bg-card px-3 py-2 transition hover:bg-muted/30"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      {index === 0 ? (
                                        <Badge variant="success">{t("imagePrimary")}</Badge>
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
                              <Input {...field} disabled={readOnly} />
                            </FormControl>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </FormSection>
                  <FormSection>
                    <FormGrid className="items-start">
                      <FormField
                        control={form.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("description")}</FormLabel>
                            <FormControl>
                              <Textarea {...field} rows={4} disabled={readOnly} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </FormGrid>
                  </FormSection>
                </>
              ) : null}

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
                  <FormSection title={t("barcodes")}>
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
                                placeholder={t("barcodePlaceholder")}
                                className="flex-1"
                                disabled={readOnly}
                              />
                            </FormControl>
                            <Button
                              type="button"
                              variant="secondary"
                              className="w-full sm:w-auto"
                              onClick={() => {
                                if (readOnly) {
                                  return;
                                }
                                const value = barcodeInput.trim();
                                if (!value) {
                                  return;
                                }
                                const current = field.value ?? [];
                                if (current.includes(value)) {
                                  form.setError("barcodes", { message: t("barcodeDuplicate") });
                                  return;
                                }
                                form.clearErrors("barcodes");
                                form.setValue("barcodes", [...current, value], {
                                  shouldValidate: true,
                                });
                                setBarcodeInput("");
                              }}
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
                                onValueChange={(value) =>
                                  setBarcodeGenerateMode(value as "EAN13" | "CODE128")
                                }
                                disabled={
                                  readOnly ||
                                  !productId ||
                                  generateBarcodeMutation.isLoading
                                }
                              >
                                <SelectTrigger aria-label={t("generateBarcodeMode")}>
                                  <SelectValue placeholder={t("generateBarcodeMode")} />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="EAN13">
                                    {t("barcodeModeEan13")}
                                  </SelectItem>
                                  <SelectItem value="CODE128">
                                    {t("barcodeModeCode128")}
                                  </SelectItem>
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
                                const currentBarcodes = form
                                  .getValues("barcodes")
                                  ?.map((value) => value.trim())
                                  .filter(Boolean) ?? [];
                                generateBarcodeMutation.mutate({
                                  productId,
                                  mode: barcodeGenerateMode,
                                  force: currentBarcodes.length === 0,
                                });
                              }}
                              disabled={
                                readOnly ||
                                !productId ||
                                generateBarcodeMutation.isLoading
                              }
                            >
                              {generateBarcodeMutation.isLoading ? (
                                <Spinner className="h-4 w-4" />
                              ) : (
                                <AddIcon className="h-4 w-4" aria-hidden />
                              )}
                              {generateBarcodeMutation.isLoading
                                ? tCommon("loading")
                                : t("generateBarcode")}
                            </Button>
                          </FormRow>
                          <p className="text-xs text-muted-foreground">
                            {t("barcodeInternalHint")}
                          </p>
                          {!productId ? (
                            <p className="text-xs text-muted-foreground">
                              {t("barcodeGenerateRequiresSave")}
                            </p>
                          ) : null}
                          <div className="flex min-h-[36px] flex-wrap gap-2">
                            {field.value?.length ? (
                              field.value.map((barcode, index) => (
                                <Badge
                                  key={`${barcode}-${index}`}
                                  variant="muted"
                                  className="gap-1 pr-1"
                                >
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

                  <Separator />

                  <FormSection title={t("packsTitle")}>
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
                            className="space-y-3 rounded-lg border border-border/70 bg-card p-4"
                          >
                            <FormGrid className="items-start">
                              <FormField
                                control={form.control}
                                name={`packs.${index}.packName`}
                                render={({ field: itemField }) => (
                                  <FormItem>
                                    <FormLabel>{t("packName")}</FormLabel>
                                    <FormControl>
                                      <Input {...itemField} disabled={readOnly} />
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
                                        type="number"
                                        inputMode="numeric"
                                        min={1}
                                        disabled={readOnly}
                                      />
                                    </FormControl>
                                    <FormDescription>
                                      {t("packMultiplierHint", {
                                        unit: baseUnit ? resolveUnitLabel(baseUnit) : tCommon("notAvailable"),
                                      })}
                                    </FormDescription>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
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

                  <FormSection title={t("variants")}>
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
                            onClick={() => setGeneratorOpen(true)}
                          >
                            {t("generateVariants")}
                          </Button>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full sm:w-auto"
                        onClick={() =>
                          append({
                            id: undefined,
                            name: "",
                            sku: "",
                            attributes: toAttributeEntries({}),
                            canDelete: true,
                          })
                        }
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
                      const variantAttributes =
                        form.watch(`variants.${index}.attributes`) ?? [];
                      const availableDefinitions = definitions.filter(
                        (definition) =>
                          !variantAttributes.some((entry) => entry.key === definition.key),
                      );
                      const selectedAttributeKey = attributeDrafts[field.id] ?? "";
                      return (
                        <div
                          key={field.id}
                          className="space-y-4 rounded-lg border border-border/70 bg-card p-4"
                        >
                          <FormGrid className="items-start">
                            <FormField
                              control={form.control}
                              name={`variants.${index}.name`}
                              render={({ field: itemField }) => (
                                <FormItem>
                                  <FormLabel>{t("variantName")}</FormLabel>
                                  <FormControl>
                                    <Input {...itemField} disabled={readOnly} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name={`variants.${index}.sku`}
                              render={({ field: itemField }) => (
                                <FormItem>
                                  <FormLabel>{t("variantSku")}</FormLabel>
                                  <FormControl>
                                    <Input {...itemField} disabled={readOnly} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
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
                                      if (current.some((entry) => entry.key === selectedAttributeKey)) {
                                        return;
                                      }
                                      const definition = definitionMap.get(selectedAttributeKey);
                                      const defaultValue =
                                        definition?.type === "MULTI_SELECT" ? [] : "";
                                      form.setValue(
                                        `variants.${index}.attributes`,
                                        [...current, { key: selectedAttributeKey, value: defaultValue }],
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
                                  const fieldName = `variants.${index}.attributes.${attrIndex}.value` as const;
                                  const selectedValues = Array.isArray(attribute.value)
                                    ? attribute.value.map((value) => String(value))
                                    : [];
                                  const currentValue =
                                    typeof attribute.value === "string" || typeof attribute.value === "number"
                                      ? String(attribute.value)
                                      : "";
                                  const selectOptions = currentValue && !options.includes(currentValue)
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
                                              {isRequired ? <span className="text-danger"> *</span> : null}
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
                                                        { shouldDirty: true, shouldValidate: true },
                                                      );
                                                    }}
                                                  >
                                                    <DeleteIcon className="h-3 w-3" aria-hidden />
                                                  </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>{t("removeAttribute")}</TooltipContent>
                                              </Tooltip>
                                            ) : null}
                                          </div>
                                          {definition?.type === "SELECT" ? (
                                            <FormControl>
                                              <Select
                                                value={currentValue}
                                                onValueChange={(value) => attrField.onChange(value)}
                                                disabled={readOnly}
                                              >
                                                <SelectTrigger>
                                                  <SelectValue placeholder={t("selectAttributeValue")} />
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
                                                  const isSelected = selectedValues.includes(option);
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
                                                          ? selectedValues.filter((value) => value !== option)
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
                                                    <Badge key={value} variant="muted" className="gap-1 pr-1">
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
                                                          <CloseIcon className="h-3 w-3" aria-hidden />
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
                                                onChange={(event) => attrField.onChange(event.target.value)}
                                                type={definition?.type === "NUMBER" ? "number" : "text"}
                                                inputMode={definition?.type === "NUMBER" ? "decimal" : "text"}
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
                              <p className="text-xs text-muted-foreground">{t("variantAttributesEmpty")}</p>
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
                </>
              ) : null}
            </CardContent>
          </Card>
        </TooltipProvider>

        {!readOnly ? (
          <FormActions>
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
                        className="rounded-lg border border-border/70 bg-card p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-foreground">{label}</p>
                            <p className="text-xs text-muted-foreground">{t("generatorAttributeHint")}</p>
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
              {templateKeys.length ? (
                <span>{t("generatorTemplateHint")}</span>
              ) : null}
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setGeneratorOpen(false)}>
                {tCommon("cancel")}
              </Button>
              <Button type="button" onClick={handleGenerateVariants}>
                {t("generatorConfirm")}
              </Button>
            </div>
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
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setVariantToRemove(null)}>
              {tCommon("cancel")}
            </Button>
            <Button type="button" variant="danger" onClick={handleConfirmRemoveVariant}>
              {tCommon("confirm")}
            </Button>
          </div>
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
          <div className="relative h-[48vh] min-h-[280px] overflow-hidden rounded-lg border border-border bg-black/70">
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
              <div className="space-y-3 rounded-lg border border-border bg-secondary/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{t("imageEditorZoom")}</span>
                  <Badge variant="muted">{imageEditorZoomPercent}%</Badge>
                </div>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={imageEditorZoom}
                  onChange={(event) => setImageEditorZoom(Number(event.target.value))}
                  aria-label={t("imageEditorZoom")}
                  className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
                />
              </div>

              <div className="space-y-3 rounded-lg border border-border bg-secondary/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{t("imageEditorRotation")}</span>
                  <Badge variant="muted">{imageEditorRotationDegrees}°</Badge>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="range"
                    min={0}
                    max={360}
                    step={1}
                    value={imageEditorRotation}
                    onChange={(event) => setImageEditorRotation(Number(event.target.value))}
                    aria-label={t("imageEditorRotation")}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
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

          <div className="flex flex-wrap justify-end gap-2">
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
          </div>
        </div>
      </Modal>
    </Form>
  );
};

"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { z } from "zod";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

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
  GripIcon,
  ImagePlusIcon,
  StatusSuccessIcon,
} from "@/components/icons";
import { trpc } from "@/lib/trpc";
import { buildVariantMatrix, type VariantGeneratorAttribute } from "@/lib/variantGenerator";

export type ProductFormValues = {
  sku: string;
  name: string;
  isBundle?: boolean;
  category?: string;
  baseUnitId: string;
  basePriceKgs?: number;
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

const isPhotoUrlValid = (value?: string | null) => {
  const normalized = value?.trim();
  if (!normalized) {
    return true;
  }
  if (normalized.startsWith("/uploads/") || normalized.startsWith("data:image/")) {
    return true;
  }
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};


export const ProductForm = ({
  initialValues,
  onSubmit,
  isSubmitting,
  attributeDefinitions,
  units,
  readOnly = false,
}: {
  initialValues: ProductFormValues;
  onSubmit: (values: ProductFormValues) => void;
  isSubmitting?: boolean;
  attributeDefinitions?: AttributeDefinition[];
  units?: UnitOption[];
  readOnly?: boolean;
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
    () =>
      z.object({
        sku: z.string().min(2, t("skuRequired")),
        name: z.string().min(2, t("nameRequired")),
        isBundle: z.boolean().optional(),
        category: z.string().optional(),
        baseUnitId: z.string().min(1, t("unitRequired")),
        basePriceKgs: z.coerce.number().min(0, t("priceNonNegative")).optional(),
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
      }),
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
  const templateQuery = trpc.categoryTemplates.list.useQuery(
    { category: categoryValue?.trim() || "" },
    { enabled: !readOnly && Boolean(categoryValue?.trim()) },
  );
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
    append: appendImage,
    remove: removeImage,
    move: moveImage,
  } = useFieldArray({
    control: form.control,
    name: "images",
  });

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
  const isBundle = Boolean(form.watch("isBundle"));
  const baseUnitId = form.watch("baseUnitId");
  const baseUnit = unitOptions.find((unit) => unit.id === baseUnitId);
  const maxImageBytes = 5 * 1024 * 1024;

  const bundleSearchQuery = trpc.products.searchQuick.useQuery(
    { q: bundleSearch.trim() },
    { enabled: !readOnly && isBundle && bundleSearch.trim().length >= 1 },
  );

  const readImageFile = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("imageReadFailed"));
      reader.readAsDataURL(file);
    });

  const handleImageFiles = async (files: FileList | File[]) => {
    if (readOnly) {
      return;
    }
    const list = Array.from(files);
    if (!list.length) {
      return;
    }
    const nextImages: { url: string; position?: number }[] = [];
    for (const file of list) {
      if (!file.type.startsWith("image/")) {
        toast({ variant: "error", description: t("imageInvalidType") });
        continue;
      }
      if (file.size > maxImageBytes) {
        toast({
          variant: "error",
          description: t("imageTooLarge", { size: Math.round(maxImageBytes / (1024 * 1024)) }),
        });
        continue;
      }
      try {
        const url = await readImageFile(file);
        if (url) {
          nextImages.push({ url });
        }
      } catch {
        toast({ variant: "error", description: t("imageReadFailed") });
      }
    }
    if (nextImages.length) {
      appendImage(nextImages);
    }
  };

  const handleImageDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    if (readOnly) {
      return;
    }
    if (event.dataTransfer?.files?.length) {
      void handleImageFiles(event.dataTransfer.files);
    }
  };

  const handleImageDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (readOnly) {
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

    onSubmit({
      sku: values.sku.trim(),
      name: values.name.trim(),
      isBundle: Boolean(values.isBundle),
      category: values.category?.trim() || undefined,
      baseUnitId: values.baseUnitId,
      basePriceKgs: Number.isFinite(values.basePriceKgs ?? NaN)
        ? values.basePriceKgs
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
              <CardTitle>{t("detailsTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormSection title={t("basicInfoTitle")}>
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
                          <Input {...field} disabled={readOnly} />
                        </FormControl>
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
                <h3 className="text-sm font-semibold text-ink">{t("descriptionTitle")}</h3>
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
                        accept="image/*"
                        multiple
                        className="hidden"
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
                        disabled={readOnly}
                      >
                        <ImagePlusIcon className="h-4 w-4" aria-hidden />
                        {t("imagesAdd")}
                      </Button>
                      <span className="text-xs text-gray-500">{t("imagesReorderHint")}</span>
                    </div>
                    <div
                      className={`rounded-md border border-dashed px-4 py-4 text-sm text-gray-500 transition ${
                        isDragActive ? "border-ink bg-gray-50" : "border-gray-200"
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
                          const canMoveUp = index > 0;
                          const canMoveDown = index < imageFields.length - 1;
                          return (
                            <div
                              key={image.id}
                              className={`flex items-start gap-3 rounded-md border border-gray-200 bg-white p-3 ${
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
                                moveImage(draggedImageIndex, index);
                                setDraggedImageIndex(null);
                              }}
                            >
                              <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md bg-gray-50">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={image.url}
                                  alt={t("imageAlt", { index: index + 1 })}
                                  className="h-full w-full object-cover"
                                />
                              </div>
                              <div className="min-w-0 flex-1 space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  {index === 0 ? (
                                    <Badge variant="success">{t("imagePrimary")}</Badge>
                                  ) : null}
                                  <span className="text-xs text-gray-500">
                                    {t("imagePosition", { index: index + 1, total: imageFields.length })}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                  <GripIcon className="h-4 w-4" aria-hidden />
                                  {t("imageDragHint")}
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
                                      onClick={() => canMoveUp && moveImage(index, index - 1)}
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
                                      onClick={() => canMoveDown && moveImage(index, index + 1)}
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
                                      onClick={() => removeImage(index)}
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
                      <p className="text-xs text-gray-400">{t("imagesEmpty")}</p>
                    )}
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
                      <FormField
                        control={form.control}
                        name="photoUrl"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("photoUrl")}</FormLabel>
                            <FormControl>
                              <Input {...field} disabled={readOnly} />
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
                <h3 className="text-sm font-semibold text-ink">{t("advancedTitle")}</h3>
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
                                          form.setValue("barcodes", next, {
                                            shouldValidate: true,
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
                              <p className="text-xs text-gray-500">{t("barcodeEmpty")}</p>
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
                            className="space-y-3 rounded-lg border border-gray-100 bg-white p-4"
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
                      <p className="text-xs text-gray-500">{t("packsEmpty")}</p>
                    )}
                    <p className="text-xs text-gray-500">{t("packsHint")}</p>
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
                          className="space-y-4 rounded-lg border border-gray-100 bg-white p-4"
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
                              <h4 className="text-sm font-semibold text-ink">
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
                                        <FormItem className="rounded-md border border-gray-100 p-3">
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
                              <p className="text-xs text-gray-500">{t("variantAttributesEmpty")}</p>
                            )}
                            {definitions.length === 0 ? (
                              <p className="text-xs text-gray-500">
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
                <p className="text-sm font-semibold text-ink">{t("generatorAttributes")}</p>
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
                        className="rounded-lg border border-gray-100 bg-white p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-ink">{label}</p>
                            <p className="text-xs text-gray-500">{t("generatorAttributeHint")}</p>
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
                            <p className="text-xs text-gray-500">
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
                <p className="text-xs text-gray-500">{t("generatorEmpty")}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
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
    </Form>
  );
};

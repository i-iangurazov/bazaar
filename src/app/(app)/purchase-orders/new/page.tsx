"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { z } from "zod";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Modal } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/form-layout";
import { Spinner } from "@/components/ui/spinner";
import { AddIcon, DeleteIcon, EditIcon, EmptyIcon, UploadIcon } from "@/components/icons";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { RowActions } from "@/components/row-actions";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatCurrencyKGS, formatNumber } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { useToast } from "@/components/ui/toast";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";

const NewPurchaseOrderPage = () => {
  const router = useRouter();
  const t = useTranslations("purchaseOrders");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session, status } = useSession();
  const role = session?.user?.role;
  const canManage = role === "ADMIN" || role === "MANAGER";
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const isForbidden = status === "authenticated" && !canManage;

  const storesQuery = trpc.stores.list.useQuery(undefined, { enabled: !isForbidden });
  const suppliersQuery = trpc.suppliers.list.useQuery(undefined, { enabled: !isForbidden });

  const lineSchema = useMemo(() => {
    const optionalCost = z.preprocess(
      (value) => (value === "" || value === null ? undefined : value),
      z.coerce.number().min(0, t("unitCostNonNegative")).optional(),
    );
    return z.object({
      productId: z.string().min(1, t("productRequired")),
      variantId: z.string().optional().nullable(),
      qtyOrdered: z.coerce.number().int().positive(t("qtyPositive")),
      unitSelection: z.string().min(1, t("unitRequired")),
      unitCost: optionalCost,
    });
  }, [t]);

  const schema = useMemo(
    () =>
      z.object({
        storeId: z.string().min(1, t("storeRequired")),
        supplierId: z.string().optional().nullable(),
        lines: z.array(lineSchema).min(1, t("linesRequired")),
      }),
    [t, lineSchema],
  );

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      storeId: "",
      supplierId: "",
      lines: [],
    },
  });

  const { fields, append, update, remove } = useFieldArray({
    control: form.control,
    name: "lines",
  });

  const [lineDialogOpen, setLineDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [lineSearch, setLineSearch] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<{
    id: string;
    name: string;
    sku: string;
  } | null>(null);
  type ProductCacheEntry = {
    name: string;
    sku: string;
    baseUnit?: {
      id: string;
      code: string;
      labelRu: string;
      labelKg: string;
    } | null;
    packs?: {
      id: string;
      packName: string;
      multiplierToBase: number;
      allowInPurchasing: boolean;
      allowInReceiving: boolean;
    }[];
  };
  const [productCache, setProductCache] = useState<Record<string, ProductCacheEntry>>({});
  const [variantCache, setVariantCache] = useState<Record<string, string>>({});

  const lineForm = useForm<z.infer<typeof lineSchema>>({
    resolver: zodResolver(lineSchema),
    defaultValues: {
      productId: "",
      variantId: null,
      qtyOrdered: 1,
      unitSelection: "BASE",
      unitCost: undefined,
    },
  });

  const lineProductId = lineForm.watch("productId");

  const productSearchQuery = trpc.products.searchQuick.useQuery(
    { q: lineSearch },
    { enabled: !isForbidden && lineDialogOpen && lineSearch.trim().length >= 1 },
  );
  const lineProductQuery = trpc.products.getById.useQuery(
    { productId: lineProductId },
    { enabled: !isForbidden && Boolean(lineProductId) },
  );
  const lineUnitSelection = lineForm.watch("unitSelection");
  const lineQtyOrdered = lineForm.watch("qtyOrdered");
  const lineProduct = lineProductId ? productCache[lineProductId] : undefined;

  const storeId = form.watch("storeId");
  const lines = form.watch("lines");

  const resolveUnitLabel = (unit?: ProductCacheEntry["baseUnit"]) => {
    if (!unit) {
      return tCommon("notAvailable");
    }
    return (locale === "kg" ? unit.labelKg : unit.labelRu) || unit.code;
  };

  const buildUnitOptions = (product?: ProductCacheEntry | null) => {
    if (!product?.baseUnit) {
      return [];
    }
    const baseLabel = resolveUnitLabel(product.baseUnit);
    const options = [{ value: "BASE", label: baseLabel }];
    (product.packs ?? [])
      .filter((pack) => pack.allowInPurchasing)
      .forEach((pack) => {
        options.push({
          value: pack.id,
          label: `${pack.packName} × ${pack.multiplierToBase} ${baseLabel}`,
        });
      });
    return options;
  };

  const resolveBasePreview = useCallback(
    (
      product: ProductCacheEntry | null | undefined,
      selection: string,
      qty: number,
    ) => {
      if (!product || !Number.isFinite(qty)) {
        return null;
      }
      if (selection === "BASE") {
        return qty;
      }
      const pack = product.packs?.find((item) => item.id === selection);
      if (!pack) {
        return null;
      }
      return qty * pack.multiplierToBase;
    },
    [],
  );

  const resolveLineBaseQty = useCallback(
    (line: z.infer<typeof lineSchema>) => {
      const product = productCache[line.productId];
      const baseQty = resolveBasePreview(product, line.unitSelection, line.qtyOrdered);
      return baseQty ?? line.qtyOrdered;
    },
    [productCache, resolveBasePreview],
  );

  const buildLinePayload = (line: z.infer<typeof lineSchema>) => ({
    productId: line.productId,
    variantId: line.variantId ?? undefined,
    qtyOrdered: line.qtyOrdered,
    unitCost: line.unitCost ?? undefined,
    unitId:
      line.unitSelection === "BASE"
        ? productCache[line.productId]?.baseUnit?.id
        : undefined,
    packId: line.unitSelection !== "BASE" ? line.unitSelection : undefined,
  });

  useEffect(() => {
    if (!storeId && storesQuery.data?.[0]) {
      form.setValue("storeId", storesQuery.data[0].id, { shouldValidate: true });
    }
  }, [storeId, storesQuery.data, form]);

  useEffect(() => {
    const product = lineProductQuery.data;
    if (!product) {
      return;
    }
    setProductCache((prev) => ({
      ...prev,
      [product.id]: {
        name: product.name,
        sku: product.sku,
        baseUnit: product.baseUnit ?? null,
        packs: product.packs ?? [],
      },
    }));
    if (product.variants.length) {
      setVariantCache((prev) => {
        const next = { ...prev };
        product.variants.forEach((variant) => {
          next[variant.id] = variant.name ?? "";
        });
        return next;
      });
    }
  }, [lineProductQuery.data]);

  const closeLineDialog = () => {
    setLineDialogOpen(false);
    setEditingIndex(null);
    lineForm.reset({
      productId: "",
      variantId: null,
      qtyOrdered: 1,
      unitSelection: "BASE",
      unitCost: undefined,
    });
    setLineSearch("");
    setSelectedProduct(null);
    setShowResults(false);
  };

  const openAddLine = () => {
    setEditingIndex(null);
    lineForm.reset({
      productId: "",
      variantId: null,
      qtyOrdered: 1,
      unitSelection: "BASE",
      unitCost: undefined,
    });
    setLineSearch("");
    setSelectedProduct(null);
    setShowResults(false);
    setLineDialogOpen(true);
  };

  const openEditLine = (index: number) => {
    const line = form.getValues(`lines.${index}`);
    const product = productCache[line.productId];
    setEditingIndex(index);
    lineForm.reset({
      productId: line.productId,
      variantId: line.variantId ?? null,
      qtyOrdered: line.qtyOrdered,
      unitSelection: line.unitSelection ?? "BASE",
      unitCost: line.unitCost ?? undefined,
    });
    setLineSearch(product?.name ?? "");
    setSelectedProduct(product ? { id: line.productId, name: product.name, sku: product.sku } : null);
    setShowResults(false);
    setLineDialogOpen(true);
  };

  const createMutation = trpc.purchaseOrders.create.useMutation({
    onSuccess: (po) => {
      toast({ variant: "success", description: t("createSuccess") });
      router.push(`/purchase-orders/${po.id}`);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const hasCost = lines.some((line) => line.unitCost !== undefined && line.unitCost !== null);

  const totals = useMemo(() => {
    const lineTotals = lines.map((line) => (line.unitCost ?? 0) * resolveLineBaseQty(line));
    return lineTotals.reduce((sum, total) => sum + total, 0);
  }, [lines, resolveLineBaseQty]);

  if (isForbidden) {
    return (
      <div>
        <PageHeader title={t("new")} subtitle={t("subtitle")} />
        <p className="mt-4 text-sm text-danger">{tErrors("forbidden")}</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t("new")} subtitle={t("newSubtitle")} />

      <Form {...form}>
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{t("orderDetails")}</CardTitle>
          </CardHeader>
          <CardContent>
            <FormGrid>
              <FormField
                control={form.control}
                name="storeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("store")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={tCommon("selectStore")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {storesQuery.data?.map((store) => (
                          <SelectItem key={store.id} value={store.id}>
                            {store.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="supplierId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("supplier")}</FormLabel>
                    <Select
                      value={field.value ?? "__none__"}
                      onValueChange={(value) => field.onChange(value === "__none__" ? null : value)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={tCommon("selectSupplier")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">{tCommon("supplierUnassigned")}</SelectItem>
                        {suppliersQuery.data?.map((supplier) => (
                          <SelectItem key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGrid>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>{t("linesTitle")}</CardTitle>
            <Button className="w-full sm:w-auto" type="button" onClick={openAddLine}>
              <AddIcon className="h-4 w-4" aria-hidden />
              {t("addLine")}
            </Button>
          </CardHeader>
          <CardContent>
            <ResponsiveDataList
              items={fields}
              getKey={(field) => field.id}
              renderDesktop={(visibleItems) => (
                <div className="overflow-x-auto">
                  <TooltipProvider>
                    <Table className="min-w-[640px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>{tCommon("product")}</TableHead>
                          <TableHead className="hidden sm:table-cell">{t("variant")}</TableHead>
                          <TableHead>{t("orderQty")}</TableHead>
                          <TableHead className="hidden md:table-cell">{t("unitCost")}</TableHead>
                          <TableHead className="hidden md:table-cell">{t("lineTotal")}</TableHead>
                          <TableHead>{tCommon("actions")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleItems.map((field) => {
                          const absoluteIndex = fields.findIndex((entry) => entry.id === field.id);
                          const line = absoluteIndex >= 0 ? lines[absoluteIndex] : null;
                          if (!line || absoluteIndex < 0) {
                            return null;
                          }
                          const product = productCache[line.productId];
                          const baseUnitLabel = resolveUnitLabel(product?.baseUnit ?? null);
                          const unitLabel =
                            line.unitSelection === "BASE"
                              ? baseUnitLabel
                              : product?.packs?.find((pack) => pack.id === line.unitSelection)?.packName ??
                                baseUnitLabel;
                          const baseQty = resolveBasePreview(
                            product,
                            line.unitSelection,
                            line.qtyOrdered,
                          );
                          const variantLabel =
                            line.variantId && variantCache[line.variantId]
                              ? variantCache[line.variantId]
                              : tCommon("notAvailable");
                          return (
                            <TableRow key={field.id}>
                              <TableCell className="font-medium">
                                {product?.name ?? tCommon("notAvailable")}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground hidden sm:table-cell">
                                {variantLabel}
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-col">
                                  <span>
                                    {formatNumber(line.qtyOrdered, locale)} {unitLabel}
                                  </span>
                                  {line.unitSelection !== "BASE" && baseQty !== null ? (
                                    <span className="text-xs text-muted-foreground">
                                      {t("baseQtyPreview", {
                                        qty: formatNumber(baseQty, locale),
                                        unit: baseUnitLabel,
                                      })}
                                    </span>
                                  ) : null}
                                </div>
                              </TableCell>
                              <TableCell className="hidden md:table-cell">
                                {line.unitCost === undefined
                                  ? tCommon("notAvailable")
                                  : formatCurrencyKGS(line.unitCost ?? 0, locale)}
                              </TableCell>
                              <TableCell className="hidden md:table-cell">
                                {line.unitCost === undefined
                                  ? tCommon("notAvailable")
                                  : formatCurrencyKGS(
                                      (line.unitCost ?? 0) * resolveLineBaseQty(line),
                                      locale,
                                    )}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="shadow-none"
                                        aria-label={t("editLine")}
                                        onClick={() => openEditLine(absoluteIndex)}
                                      >
                                        <EditIcon className="h-4 w-4" aria-hidden />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>{t("editLine")}</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="text-danger shadow-none hover:text-danger"
                                        aria-label={t("removeLine")}
                                        onClick={async () => {
                                          if (!(await confirm({ description: t("confirmRemoveLine"), confirmVariant: "danger" }))) {
                                            return;
                                          }
                                          remove(absoluteIndex);
                                        }}
                                      >
                                        <DeleteIcon className="h-4 w-4" aria-hidden />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>{t("removeLine")}</TooltipContent>
                                  </Tooltip>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TooltipProvider>
                </div>
              )}
              renderMobile={(_, index) => {
                const line = lines[index];
                if (!line) {
                  return null;
                }
                const product = productCache[line.productId];
                const baseUnitLabel = resolveUnitLabel(product?.baseUnit ?? null);
                const unitLabel =
                  line.unitSelection === "BASE"
                    ? baseUnitLabel
                    : product?.packs?.find((pack) => pack.id === line.unitSelection)?.packName ??
                      baseUnitLabel;
                const baseQty = resolveBasePreview(product, line.unitSelection, line.qtyOrdered);
                const variantLabel =
                  line.variantId && variantCache[line.variantId]
                    ? variantCache[line.variantId]
                    : tCommon("notAvailable");
                const lineTotal =
                  line.unitCost === undefined
                    ? null
                    : (line.unitCost ?? 0) * resolveLineBaseQty(line);

                return (
                  <div className="rounded-md border border-border bg-card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {product?.name ?? tCommon("notAvailable")}
                        </p>
                        <p className="text-xs text-muted-foreground">{variantLabel}</p>
                        <p className="text-xs text-muted-foreground">
                          {t("orderQty")}: {formatNumber(line.qtyOrdered, locale)} {unitLabel}
                        </p>
                        {line.unitSelection !== "BASE" && baseQty !== null ? (
                          <p className="text-xs text-muted-foreground">
                            {t("baseQtyPreview", {
                              qty: formatNumber(baseQty, locale),
                              unit: baseUnitLabel,
                            })}
                          </p>
                        ) : null}
                        <p className="text-xs text-muted-foreground">
                          {t("unitCost")}{" "}
                          {line.unitCost === undefined
                            ? tCommon("notAvailable")
                            : formatCurrencyKGS(line.unitCost ?? 0, locale)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t("lineTotal")}{" "}
                          {lineTotal === null ? tCommon("notAvailable") : formatCurrencyKGS(lineTotal, locale)}
                        </p>
                      </div>
                      <RowActions
                        actions={[
                          {
                            key: "edit",
                            label: t("editLine"),
                            icon: EditIcon,
                            onSelect: () => openEditLine(index),
                          },
                          {
                            key: "remove",
                            label: t("removeLine"),
                            icon: DeleteIcon,
                            variant: "danger",
                            onSelect: async () => {
                              if (!(await confirm({ description: t("confirmRemoveLine"), confirmVariant: "danger" }))) {
                                return;
                              }
                              remove(index);
                            },
                          },
                        ]}
                        maxInline={1}
                        moreLabel={tCommon("tooltips.moreActions")}
                      />
                    </div>
                  </div>
                );
              }}
            />
            {!fields.length ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <EmptyIcon className="h-4 w-4" aria-hidden />
                {t("noLines")}
              </div>
            ) : null}
            {form.formState.errors.lines?.message ? (
              <p className="mt-3 text-sm text-danger">
                {String(form.formState.errors.lines.message)}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end text-sm font-semibold">
              {t("total")}:{" "}
              {hasCost ? formatCurrencyKGS(totals, locale) : tCommon("notAvailable")}
            </div>

            <FormActions className="mt-6">
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={form.handleSubmit((values) => {
                  createMutation.mutate({
                    storeId: values.storeId,
                    supplierId:
                      values.supplierId && values.supplierId.trim().length
                        ? values.supplierId
                        : undefined,
                    lines: values.lines.map(buildLinePayload),
                    submit: false,
                  });
                })}
                disabled={createMutation.isLoading || !storeId || !fields.length}
              >
                {createMutation.isLoading ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <AddIcon className="h-4 w-4" aria-hidden />
                )}
                {createMutation.isLoading ? tCommon("loading") : t("saveDraft")}
              </Button>
              <Button
                className="w-full sm:w-auto"
                onClick={form.handleSubmit((values) => {
                  createMutation.mutate({
                    storeId: values.storeId,
                    supplierId:
                      values.supplierId && values.supplierId.trim().length
                        ? values.supplierId
                        : undefined,
                    lines: values.lines.map(buildLinePayload),
                    submit: true,
                  });
                })}
                disabled={createMutation.isLoading || !storeId || !fields.length}
              >
                {createMutation.isLoading ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <UploadIcon className="h-4 w-4" aria-hidden />
                )}
                {createMutation.isLoading ? tCommon("loading") : t("submitOrder")}
              </Button>
            </FormActions>
          </CardContent>
        </Card>
      </Form>

      <Modal
        open={lineDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeLineDialog();
          }
        }}
        title={editingIndex === null ? t("addLineTitle") : t("editLineTitle")}
        subtitle={editingIndex === null ? t("lineDialogSubtitle") : lineSearch}
      >
        <Form {...lineForm}>
          <form
            className="space-y-4"
            onSubmit={lineForm.handleSubmit((values) => {
              const key = `${values.productId}:${values.variantId ?? "BASE"}`;
              const hasDuplicate = lines.some((line, index) => {
                if (editingIndex !== null && index === editingIndex) {
                  return false;
                }
                return `${line.productId}:${line.variantId ?? "BASE"}` === key;
              });
              if (hasDuplicate) {
                toast({ variant: "error", description: tErrors("duplicateLineItem") });
                return;
              }
              if (editingIndex === null) {
                append({
                  productId: values.productId,
                  variantId: values.variantId ?? null,
                  qtyOrdered: values.qtyOrdered,
                  unitSelection: values.unitSelection,
                  unitCost: values.unitCost ?? undefined,
                });
              } else {
                update(editingIndex, {
                  productId: values.productId,
                  variantId: values.variantId ?? null,
                  qtyOrdered: values.qtyOrdered,
                  unitSelection: values.unitSelection,
                  unitCost: values.unitCost ?? undefined,
                });
              }
              const productEntry = selectedProduct
                ? { name: selectedProduct.name, sku: selectedProduct.sku }
                : undefined;
              if (productEntry) {
                setProductCache((prev) => ({
                  ...prev,
                  [values.productId]: productEntry,
                }));
              }
              closeLineDialog();
            })}
          >
            <FormGrid>
              <FormField
                control={lineForm.control}
                name="productId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tCommon("product")}</FormLabel>
                    <div className="relative">
                      <FormControl>
                        <Input
                          value={lineSearch}
                          autoFocus
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setLineSearch(nextValue);
                            setShowResults(true);
                            if (selectedProduct && nextValue !== selectedProduct.name) {
                              setSelectedProduct(null);
                              field.onChange("");
                              lineForm.setValue("variantId", null, { shouldValidate: true });
                              lineForm.setValue("unitSelection", "BASE", { shouldValidate: true });
                            }
                          }}
                          onFocus={() => setShowResults(true)}
                          onBlur={() => setTimeout(() => setShowResults(false), 150)}
                          placeholder={t("productSearchPlaceholder")}
                        />
                      </FormControl>
                      {showResults && productSearchQuery.data?.length ? (
                        <div className="absolute z-20 mt-2 w-full rounded-md border border-border bg-card shadow-lg">
                          <div className="max-h-64 overflow-y-auto py-1">
                            {productSearchQuery.data.map((product) => (
                              <button
                                key={product.id}
                                type="button"
                                className="flex w-full flex-col px-3 py-2 text-left text-sm transition hover:bg-accent/50"
                                onMouseDown={(event) => event.preventDefault()}
                                onPointerDown={(event) => event.preventDefault()}
                                onClick={() => {
                                  setSelectedProduct({
                                    id: product.id,
                                    name: product.name,
                                    sku: product.sku,
                                  });
                                  setLineSearch(product.name);
                                  field.onChange(product.id);
                                  lineForm.setValue("variantId", null, { shouldValidate: true });
                                  lineForm.setValue("unitSelection", "BASE", { shouldValidate: true });
                                  setShowResults(false);
                                }}
                              >
                                <span className="font-medium text-foreground">{product.name}</span>
                                <span className="text-xs text-muted-foreground">{product.sku}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    {editingIndex === null ? <FormDescription>{t("productSearchHint")}</FormDescription> : null}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={lineForm.control}
                name="variantId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("variant")}</FormLabel>
                    <Select
                      value={field.value ?? "BASE"}
                      onValueChange={(value) => field.onChange(value === "BASE" ? null : value)}
                      disabled={!lineProductId}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t("variantPlaceholder")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="BASE">{t("variantBase")}</SelectItem>
                        {lineProductQuery.data?.variants.map((variant) => (
                          <SelectItem key={variant.id} value={variant.id}>
                            {variant.name ?? tCommon("notAvailable")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGrid>
            <FormGrid>
              <FormField
                control={lineForm.control}
                name="qtyOrdered"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("orderQty")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        inputMode="numeric"
                        placeholder={t("qtyPlaceholder")}
                      />
                    </FormControl>
                    {lineProduct ? (
                      <FormDescription>
                        {(() => {
                          const baseQty = resolveBasePreview(
                            lineProduct,
                            lineUnitSelection,
                            lineQtyOrdered,
                          );
                          if (baseQty === null) {
                            return null;
                          }
                          return t("baseQtyPreview", {
                            qty: formatNumber(baseQty, locale),
                            unit: resolveUnitLabel(lineProduct.baseUnit ?? null),
                          });
                        })()}
                      </FormDescription>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={lineForm.control}
                name="unitSelection"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("unit")}</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={!lineProduct}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t("unitPlaceholder")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {buildUnitOptions(lineProduct).map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGrid>
            <FormGrid>
              <FormField
                control={lineForm.control}
                name="unitCost"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("unitCost")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        placeholder={t("unitCostPlaceholder")}
                      />
                    </FormControl>
                    <FormDescription>
                      {t("unitCostHint", {
                        unit: resolveUnitLabel(lineProduct?.baseUnit ?? null),
                      })}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGrid>
            <FormActions>
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={closeLineDialog}
              >
                {tCommon("cancel")}
              </Button>
              <Button type="submit" className="w-full sm:w-auto">
                <AddIcon className="h-4 w-4" aria-hidden />
                {editingIndex === null ? t("addLine") : t("saveLine")}
              </Button>
            </FormActions>
          </form>
        </Form>
      </Modal>
      {confirmDialog}
    </div>
  );
};

export default NewPurchaseOrderPage;

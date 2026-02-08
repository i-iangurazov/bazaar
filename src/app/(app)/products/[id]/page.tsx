"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { PageHeader } from "@/components/page-header";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { FormActions } from "@/components/form-layout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ProductForm } from "@/components/product-form";
import { AddIcon, ArchiveIcon, DeleteIcon, EmptyIcon, ViewIcon } from "@/components/icons";
import { formatCurrencyKGS, formatDateTime, formatNumber } from "@/lib/i18nFormat";
import { formatMovementNote } from "@/lib/i18n/movementNote";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { useToast } from "@/components/ui/toast";
import { RowActions } from "@/components/row-actions";

const ProductDetailPage = () => {
  const params = useParams();
  const productId = String(params?.id ?? "");
  const t = useTranslations("products");
  const tInventory = useTranslations("inventory");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const locale = useLocale();
  const { data: session } = useSession();
  const role = session?.user?.role;
  const isAdmin = role === "ADMIN";
  const canManageBundles = role === "ADMIN" || role === "MANAGER";
  const { toast } = useToast();
  const [movementsOpen, setMovementsOpen] = useState(false);
  const [movementStoreId, setMovementStoreId] = useState("");
  const [pricingStoreId, setPricingStoreId] = useState("");
  const [showLots, setShowLots] = useState(false);
  const [showBundle, setShowBundle] = useState(false);
  const [componentDialogOpen, setComponentDialogOpen] = useState(false);
  const [componentSearch, setComponentSearch] = useState("");
  const [selectedComponent, setSelectedComponent] = useState<{
    id: string;
    name: string;
    sku: string;
  } | null>(null);
  const [assembleOpen, setAssembleOpen] = useState(false);

  const productQuery = trpc.products.getById.useQuery(
    { productId },
    { enabled: Boolean(productId) },
  );
  const bundleComponentsQuery = trpc.bundles.listComponents.useQuery(
    { bundleProductId: productId },
    { enabled: Boolean(productId) },
  );
  const pricingQuery = trpc.products.pricing.useQuery(
    { productId, storeId: pricingStoreId || undefined },
    { enabled: Boolean(productId) },
  );
  const attributesQuery = trpc.attributes.list.useQuery();
  const unitsQuery = trpc.units.list.useQuery();
  const storesQuery = trpc.stores.list.useQuery();
  const movementsQuery = trpc.inventory.movements.useQuery(
    movementStoreId
      ? { storeId: movementStoreId, productId }
      : { storeId: "", productId: "" },
    { enabled: movementsOpen && Boolean(movementStoreId) && Boolean(productId) },
  );
  const componentSearchQuery = trpc.products.searchQuick.useQuery(
    { q: componentSearch },
    { enabled: componentDialogOpen && componentSearch.trim().length >= 2 },
  );
  const componentDetailQuery = trpc.products.getById.useQuery(
    { productId: selectedComponent?.id ?? "" },
    { enabled: Boolean(selectedComponent?.id) },
  );
  type StoreRow = NonNullable<typeof storesQuery.data>[number] & { trackExpiryLots?: boolean };
  const stores: StoreRow[] = (storesQuery.data ?? []) as StoreRow[];
  const selectedPricingStore = stores.find((store) => store.id === pricingStoreId);
  const lotsEnabled = Boolean(selectedPricingStore?.trackExpiryLots);
  const lotsQuery = trpc.stockLots.byProduct.useQuery(
    pricingStoreId
      ? { storeId: pricingStoreId, productId }
      : { storeId: "", productId: "" },
    { enabled: Boolean(pricingStoreId && showLots && lotsEnabled) },
  );
  const updateMutation = trpc.products.update.useMutation({
    onSuccess: () => {
      productQuery.refetch();
      toast({ variant: "success", description: t("saveSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const addComponentMutation = trpc.bundles.addComponent.useMutation({
    onSuccess: () => {
      bundleComponentsQuery.refetch();
      toast({ variant: "success", description: t("bundleComponentAdded") });
      setComponentDialogOpen(false);
      setSelectedComponent(null);
      setComponentSearch("");
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const removeComponentMutation = trpc.bundles.removeComponent.useMutation({
    onSuccess: () => {
      bundleComponentsQuery.refetch();
      toast({ variant: "success", description: t("bundleComponentRemoved") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const assembleMutation = trpc.bundles.assemble.useMutation({
    onSuccess: () => {
      toast({ variant: "success", description: t("bundleAssembled") });
      setAssembleOpen(false);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const archiveMutation = trpc.products.archive.useMutation({
    onSuccess: () => {
      toast({ variant: "success", description: t("archiveSuccess") });
      router.push("/products");
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  useEffect(() => {
    if (!movementStoreId && storesQuery.data?.[0]) {
      setMovementStoreId(storesQuery.data[0].id);
    }
  }, [movementStoreId, storesQuery.data]);

  useEffect(() => {
    if (!pricingStoreId && storesQuery.data?.length === 1) {
      setPricingStoreId(storesQuery.data[0].id);
    }
  }, [pricingStoreId, storesQuery.data]);

  const movementTypeLabel = (type: string) => {
    switch (type) {
      case "RECEIVE":
        return tInventory("movementType.receive");
      case "SALE":
        return tInventory("movementType.sale");
      case "ADJUSTMENT":
        return tInventory("movementType.adjustment");
      case "TRANSFER_IN":
        return tInventory("movementType.transferIn");
      case "TRANSFER_OUT":
        return tInventory("movementType.transferOut");
      default:
        return type;
    }
  };

  const movementBadgeVariant = (type: string) => {
    switch (type) {
      case "RECEIVE":
      case "TRANSFER_IN":
        return "success";
      case "TRANSFER_OUT":
        return "warning";
      case "SALE":
        return "danger";
      default:
        return "default";
    }
  };

  const formValues = useMemo(() => {
    if (!productQuery.data) {
      return null;
    }
    return {
      sku: productQuery.data.sku,
      name: productQuery.data.name,
      category: productQuery.data.category ?? "",
      baseUnitId: productQuery.data.baseUnitId,
      basePriceKgs: productQuery.data.basePriceKgs ?? undefined,
      description: productQuery.data.description ?? "",
      photoUrl: productQuery.data.photoUrl ?? "",
      images: (productQuery.data.images?.length
        ? productQuery.data.images
        : productQuery.data.photoUrl
          ? [{ id: undefined, url: productQuery.data.photoUrl, position: 0 }]
          : []
      ).map((image) => ({
        id: image.id,
        url: image.url,
        position: image.position ?? 0,
      })),
      barcodes: productQuery.data.barcodes ?? [],
      packs: (productQuery.data.packs ?? []).map((pack) => ({
        id: pack.id,
        packName: pack.packName,
        packBarcode: pack.packBarcode ?? "",
        multiplierToBase: pack.multiplierToBase,
        allowInPurchasing: pack.allowInPurchasing,
        allowInReceiving: pack.allowInReceiving,
      })),
      variants: productQuery.data.variants.map((variant) => ({
        id: variant.id,
        name: variant.name ?? "",
        sku: variant.sku ?? "",
        attributes: (variant.attributes as Record<string, unknown>) ?? {},
        canDelete: variant.canDelete ?? true,
      })),
    };
  }, [productQuery.data]);

  type BundleComponent = NonNullable<typeof bundleComponentsQuery.data>[number];
  type LotRow = NonNullable<typeof lotsQuery.data>[number];
  const bundleComponents: BundleComponent[] = bundleComponentsQuery.data ?? [];
  const lots: LotRow[] = lotsQuery.data ?? [];

  useEffect(() => {
    if (productQuery.data?.isBundle || bundleComponentsQuery.data?.length) {
      setShowBundle(true);
    }
  }, [productQuery.data, bundleComponentsQuery.data]);

  const componentSchema = useMemo(
    () =>
      z.object({
        qty: z.coerce.number().int().positive(t("bundleQtyPositive")),
        variantId: z.string().optional().nullable(),
      }),
    [t],
  );

  const componentForm = useForm<z.infer<typeof componentSchema>>({
    resolver: zodResolver(componentSchema),
    defaultValues: { qty: 1, variantId: null },
  });

  const assembleSchema = useMemo(
    () =>
      z.object({
        qty: z.coerce.number().int().positive(t("bundleQtyPositive")),
      }),
    [t],
  );

  const assembleForm = useForm<z.infer<typeof assembleSchema>>({
    resolver: zodResolver(assembleSchema),
    defaultValues: { qty: 1 },
  });

  useEffect(() => {
    if (componentDialogOpen) {
      componentForm.reset({ qty: 1, variantId: null });
    }
  }, [componentDialogOpen, componentForm]);

  useEffect(() => {
    if (assembleOpen) {
      assembleForm.reset({ qty: 1 });
    }
  }, [assembleOpen, assembleForm]);

  const basePrice = pricingQuery.data?.basePriceKgs ?? null;
  const effectivePrice = pricingQuery.data?.effectivePriceKgs ?? null;
  const avgCost = pricingQuery.data?.avgCostKgs ?? null;
  const markupPct =
    avgCost && avgCost > 0 && effectivePrice !== null
      ? ((effectivePrice - avgCost) / avgCost) * 100
      : null;
  const marginPct =
    effectivePrice && effectivePrice > 0 && avgCost !== null
      ? ((effectivePrice - avgCost) / effectivePrice) * 100
      : null;

  if (productQuery.isLoading || !formValues) {
    return (
      <div>
        <PageHeader title={t("editTitle")} subtitle={tCommon("loading")} />
      </div>
    );
  }

  if (productQuery.error) {
    return (
      <div>
        <PageHeader title={t("editTitle")} subtitle={tErrors("genericTitle")} />
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-red-500">
          <span>{translateError(tErrors, productQuery.error)}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => productQuery.refetch()}
          >
            {tErrors("tryAgain")}
          </Button>
        </div>
      </div>
    );
  }

  if (!productQuery.data) {
    return (
      <div>
        <PageHeader title={t("editTitle")} subtitle={t("notFound")} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t("editTitle")}
        subtitle={productQuery.data.name}
        action={
          <>
            <Button
              variant="secondary"
              className="w-full sm:w-auto"
              onClick={() => setMovementsOpen(true)}
            >
              <ViewIcon className="h-4 w-4" aria-hidden />
              {tInventory("viewMovements")}
            </Button>
            {isAdmin ? (
              <Button
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => {
                  if (!window.confirm(t("confirmArchive"))) {
                    return;
                  }
                  archiveMutation.mutate({ productId });
                }}
                disabled={archiveMutation.isLoading}
              >
                {archiveMutation.isLoading ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <ArchiveIcon className="h-4 w-4" aria-hidden />
                )}
                {archiveMutation.isLoading ? tCommon("loading") : t("archive")}
              </Button>
            ) : null}
          </>
        }
      />

      <Card className="mb-6">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{t("profitabilityTitle")}</CardTitle>
          <div className="w-full sm:max-w-xs">
            <Select
              value={pricingStoreId || "all"}
              onValueChange={(value) => setPricingStoreId(value === "all" ? "" : value)}
            >
              <SelectTrigger>
                <SelectValue placeholder={tCommon("selectStore")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allStores")}</SelectItem>
                {storesQuery.data?.map((store) => (
                  <SelectItem key={store.id} value={store.id}>
                    {store.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-gray-100 bg-white p-3">
            <p className="text-xs text-gray-500">{t("basePrice")}</p>
            <p className="text-sm font-semibold">
              {basePrice !== null ? formatCurrencyKGS(basePrice, locale) : tCommon("notAvailable")}
            </p>
          </div>
          <div className="rounded-lg border border-gray-100 bg-white p-3">
            <div className="flex items-center gap-2">
              <p className="text-xs text-gray-500">{t("effectivePrice")}</p>
              {pricingQuery.data?.priceOverridden ? (
                <Badge variant="muted">{t("priceOverridden")}</Badge>
              ) : null}
            </div>
            <p className="text-sm font-semibold">
              {effectivePrice !== null
                ? formatCurrencyKGS(effectivePrice, locale)
                : tCommon("notAvailable")}
            </p>
          </div>
          <div className="rounded-lg border border-gray-100 bg-white p-3">
            <p className="text-xs text-gray-500">{t("avgCost")}</p>
            <p className="text-sm font-semibold">
              {avgCost !== null ? formatCurrencyKGS(avgCost, locale) : tCommon("notAvailable")}
            </p>
          </div>
          <div className="rounded-lg border border-gray-100 bg-white p-3">
            <p className="text-xs text-gray-500">{t("markupMargin")}</p>
            <p className="text-sm font-semibold">
              {markupPct !== null ? `${formatNumber(markupPct, locale)}%` : tCommon("notAvailable")}
              {" · "}
              {marginPct !== null ? `${formatNumber(marginPct, locale)}%` : tCommon("notAvailable")}
            </p>
            <p className="mt-1 text-xs text-gray-400">{t("profitabilityHint")}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{t("bundleTitle")}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {canManageBundles ? (
              <Button
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => setComponentDialogOpen(true)}
              >
                <AddIcon className="h-4 w-4" aria-hidden />
                {t("bundleAddComponent")}
              </Button>
            ) : null}
            {canManageBundles && bundleComponentsQuery.data?.length ? (
              <Button className="w-full sm:w-auto" onClick={() => setAssembleOpen(true)}>
                <AddIcon className="h-4 w-4" aria-hidden />
                {t("bundleAssemble")}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowBundle((prev) => !prev)}
            >
              {showBundle ? t("hideBundle") : t("showBundle")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {showBundle ? (
            bundleComponentsQuery.isLoading ? (
              <p className="text-sm text-gray-500">{tCommon("loading")}</p>
            ) : bundleComponents.length ? (
              <ResponsiveDataList
                items={bundleComponents}
                getKey={(component) => component.id}
                renderDesktop={(visibleItems) => (
                  <div className="overflow-x-auto">
                    <Table className="min-w-[520px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>{tCommon("product")}</TableHead>
                          <TableHead>{t("variant")}</TableHead>
                          <TableHead>{t("bundleQty")}</TableHead>
                          <TableHead>{tCommon("actions")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleItems.map((component) => {
                          const actions = [
                            {
                              key: "remove",
                              label: t("bundleRemoveComponent"),
                              icon: DeleteIcon,
                              variant: "danger" as const,
                              onSelect: () => {
                                if (!window.confirm(t("bundleRemoveConfirm"))) {
                                  return;
                                }
                                removeComponentMutation.mutate({ componentId: component.id });
                              },
                              disabled: !canManageBundles,
                            },
                          ];

                          return (
                            <TableRow key={component.id}>
                              <TableCell>{component.componentProduct.name}</TableCell>
                              <TableCell>
                                {component.componentVariant?.name ?? tCommon("notAvailable")}
                              </TableCell>
                              <TableCell>{formatNumber(component.qty, locale)}</TableCell>
                              <TableCell>
                                {canManageBundles ? (
                                  <RowActions
                                    actions={actions}
                                    maxInline={1}
                                    moreLabel={tCommon("tooltips.moreActions")}
                                  />
                                ) : (
                                  <span className="text-xs text-gray-400">
                                    {tCommon("notAvailable")}
                                  </span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
                renderMobile={(component) => {
                  const actions = [
                    {
                      key: "remove",
                      label: t("bundleRemoveComponent"),
                      icon: DeleteIcon,
                      variant: "danger" as const,
                      onSelect: () => {
                        if (!window.confirm(t("bundleRemoveConfirm"))) {
                          return;
                        }
                        removeComponentMutation.mutate({ componentId: component.id });
                      },
                      disabled: !canManageBundles,
                    },
                  ];

                  return (
                    <div className="rounded-md border border-gray-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink">
                            {component.componentProduct.name}
                          </p>
                          <p className="text-xs text-gray-500">
                            {component.componentVariant?.name ?? tCommon("notAvailable")}
                          </p>
                        </div>
                        <div className="text-sm font-semibold text-ink">
                          {formatNumber(component.qty, locale)}
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-end">
                        {canManageBundles ? (
                          <RowActions
                            actions={actions}
                            maxInline={1}
                            moreLabel={tCommon("tooltips.moreActions")}
                          />
                        ) : (
                          <span className="text-xs text-gray-400">
                            {tCommon("notAvailable")}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                }}
              />
            ) : (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <EmptyIcon className="h-4 w-4" aria-hidden />
                {t("bundleEmpty")}
              </div>
            )
          ) : (
            <p className="text-sm text-gray-500">{t("bundleHiddenHint")}</p>
          )}
        </CardContent>
      </Card>

      <ProductForm
        initialValues={formValues}
        onSubmit={(values) =>
          updateMutation.mutate({
            productId,
            ...values,
          })
        }
        attributeDefinitions={attributesQuery.data ?? []}
        units={unitsQuery.data ?? []}
        isSubmitting={updateMutation.isLoading}
        readOnly={!isAdmin}
      />
      <Card className="mt-6">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{t("expiryLotsTitle")}</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLots((prev) => !prev)}
            disabled={!lotsEnabled}
          >
            {showLots ? t("hideLots") : t("showLots")}
          </Button>
        </CardHeader>
        <CardContent>
          {!lotsEnabled ? (
            <p className="text-sm text-gray-500">{t("expiryLotsDisabled")}</p>
          ) : showLots ? (
            lotsQuery.isLoading ? (
              <p className="text-sm text-gray-500">{tCommon("loading")}</p>
            ) : lots.length ? (
              <ResponsiveDataList
                items={lots}
                getKey={(lot) => lot.id}
                renderDesktop={(visibleItems) => (
                  <div className="overflow-x-auto">
                    <Table className="min-w-[420px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("expiryDate")}</TableHead>
                          <TableHead>{tInventory("onHand")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleItems.map((lot) => (
                          <TableRow key={lot.id}>
                            <TableCell>
                              {lot.expiryDate
                                ? formatDateTime(lot.expiryDate, locale)
                                : t("noExpiry")}
                            </TableCell>
                            <TableCell>{formatNumber(lot.onHandQty, locale)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                renderMobile={(lot) => (
                  <div className="rounded-md border border-gray-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs text-gray-500">{t("expiryDate")}</p>
                        <p className="text-sm font-medium text-ink">
                          {lot.expiryDate
                            ? formatDateTime(lot.expiryDate, locale)
                            : t("noExpiry")}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">{tInventory("onHand")}</p>
                        <p className="text-sm font-semibold text-ink">
                          {formatNumber(lot.onHandQty, locale)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              />
            ) : (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <EmptyIcon className="h-4 w-4" aria-hidden />
                {t("noLots")}
              </div>
            )
          ) : (
            <p className="text-sm text-gray-500">{t("lotsHiddenHint")}</p>
          )}
        </CardContent>
      </Card>
      {updateMutation.error ? (
        <p className="mt-3 text-sm text-red-500">
          {translateError(tErrors, updateMutation.error)}
        </p>
      ) : null}

      <Modal
        open={componentDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setComponentDialogOpen(false);
            setSelectedComponent(null);
            setComponentSearch("");
          }
        }}
        title={t("bundleAddComponent")}
        subtitle={productQuery.data.name}
      >
        <Form {...componentForm}>
          <form
            className="space-y-4"
            onSubmit={componentForm.handleSubmit((values) => {
              if (!selectedComponent) {
                toast({ variant: "error", description: t("bundleSelectComponent") });
                return;
              }
              addComponentMutation.mutate({
                bundleProductId: productId,
                componentProductId: selectedComponent.id,
                componentVariantId: values.variantId ?? undefined,
                qty: values.qty,
              });
            })}
          >
            <div>
              <FormLabel>{t("bundleSearch")}</FormLabel>
              <div className="relative mt-2">
                <Input
                  value={componentSearch}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setComponentSearch(nextValue);
                    if (selectedComponent && nextValue !== selectedComponent.name) {
                      setSelectedComponent(null);
                      componentForm.setValue("variantId", null);
                    }
                  }}
                  placeholder={t("bundleSearchPlaceholder")}
                />
                {componentSearchQuery.data?.length ? (
                  <div className="absolute z-20 mt-2 w-full rounded-md border border-gray-200 bg-white shadow-lg">
                    <div className="max-h-56 overflow-y-auto py-1">
                      {componentSearchQuery.data.map((product) => (
                        <button
                          key={product.id}
                          type="button"
                          className="flex w-full flex-col px-3 py-2 text-left text-sm transition hover:bg-gray-50"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            setSelectedComponent({
                              id: product.id,
                              name: product.name,
                              sku: product.sku,
                            });
                            setComponentSearch(product.name);
                          }}
                        >
                          <span className="font-medium text-ink">{product.name}</span>
                          <span className="text-xs text-gray-500">{product.sku}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              {selectedComponent ? (
                <p className="mt-2 text-xs text-gray-500">
                  {t("bundleSelected")}: {selectedComponent.name}
                </p>
              ) : null}
            </div>

            <FormField
              control={componentForm.control}
              name="variantId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("variant")}</FormLabel>
                  <FormControl>
                    <Select
                      value={field.value ?? "BASE"}
                      onValueChange={(value) => field.onChange(value === "BASE" ? null : value)}
                      disabled={!selectedComponent}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("variant")}/>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BASE">{t("variantBase")}</SelectItem>
                        {componentDetailQuery.data?.variants.map((variant) => (
                          <SelectItem key={variant.id} value={variant.id}>
                            {variant.name ?? tCommon("notAvailable")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={componentForm.control}
              name="qty"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("bundleQty")}</FormLabel>
                  <FormControl>
                    <Input {...field} type="number" inputMode="numeric" min={1} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormActions>
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => setComponentDialogOpen(false)}
              >
                {tCommon("cancel")}
              </Button>
              <Button type="submit" className="w-full sm:w-auto" disabled={addComponentMutation.isLoading}>
                {addComponentMutation.isLoading ? <Spinner className="h-4 w-4" /> : <AddIcon className="h-4 w-4" aria-hidden />}
                {addComponentMutation.isLoading ? tCommon("loading") : t("bundleAddComponent")}
              </Button>
            </FormActions>
          </form>
        </Form>
      </Modal>

      <Modal
        open={assembleOpen}
        onOpenChange={(open) => {
          if (!open) {
            setAssembleOpen(false);
          }
        }}
        title={t("bundleAssemble")}
        subtitle={productQuery.data.name}
      >
        <Form {...assembleForm}>
          <form
            className="space-y-4"
            onSubmit={assembleForm.handleSubmit((values) => {
              const targetStoreId = pricingStoreId || movementStoreId;
              if (!targetStoreId) {
                toast({ variant: "error", description: tErrors("storeRequired") });
                return;
              }
              assembleMutation.mutate({
                storeId: targetStoreId,
                bundleProductId: productId,
                qty: values.qty,
                idempotencyKey: crypto.randomUUID(),
              });
            })}
          >
            <FormField
              control={assembleForm.control}
              name="qty"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("bundleQty")}</FormLabel>
                  <FormControl>
                    <Input {...field} type="number" inputMode="numeric" min={1} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormActions>
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => setAssembleOpen(false)}
              >
                {tCommon("cancel")}
              </Button>
              <Button type="submit" className="w-full sm:w-auto" disabled={assembleMutation.isLoading}>
                {assembleMutation.isLoading ? <Spinner className="h-4 w-4" /> : <AddIcon className="h-4 w-4" aria-hidden />}
                {assembleMutation.isLoading ? tCommon("loading") : t("bundleAssembleConfirm")}
              </Button>
            </FormActions>
          </form>
        </Form>
      </Modal>

      <Modal
        open={movementsOpen}
        onOpenChange={setMovementsOpen}
        title={tInventory("movementsTitle")}
        subtitle={productQuery.data.name}
        className="max-w-3xl"
      >
        <div className="space-y-4">
          <div className="w-full sm:max-w-xs">
            <Select
              value={movementStoreId}
              onValueChange={(value) => setMovementStoreId(value)}
            >
              <SelectTrigger>
                <SelectValue placeholder={tCommon("selectStore")} />
              </SelectTrigger>
              <SelectContent>
                {storesQuery.data?.map((store) => (
                  <SelectItem key={store.id} value={store.id}>
                    {store.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {movementsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : movementsQuery.error ? (
            <div className="flex flex-wrap items-center gap-3 text-sm text-red-500">
              <span>{translateError(tErrors, movementsQuery.error)}</span>
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => movementsQuery.refetch()}
              >
                {tCommon("tryAgain")}
              </Button>
            </div>
          ) : movementsQuery.data?.length ? (
            <ResponsiveDataList
              items={movementsQuery.data}
              getKey={(movement) => movement.id}
              renderDesktop={(visibleItems) => (
                <div className="overflow-x-auto">
                  <Table className="min-w-[520px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tInventory("movementDate")}</TableHead>
                        <TableHead>{tInventory("movementTypeLabel")}</TableHead>
                        <TableHead>{tInventory("movementQty")}</TableHead>
                        <TableHead className="hidden md:table-cell">
                          {tInventory("movementUser")}
                        </TableHead>
                        <TableHead className="hidden md:table-cell">
                          {tInventory("movementNote")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleItems.map((movement) => (
                        <TableRow key={movement.id}>
                          <TableCell className="text-xs text-gray-500">
                            {formatDateTime(movement.createdAt, locale)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={movementBadgeVariant(movement.type)}>
                              {movementTypeLabel(movement.type)}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium">
                            {movement.qtyDelta > 0 ? "+" : ""}
                            {formatNumber(movement.qtyDelta, locale)}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-xs text-gray-500">
                            {movement.createdBy?.name ??
                              movement.createdBy?.email ??
                              tCommon("notAvailable")}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-xs text-gray-500">
                            {formatMovementNote(tInventory, movement.note) || tCommon("notAvailable")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              renderMobile={(movement) => (
                <div className="rounded-md border border-gray-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500">
                        {formatDateTime(movement.createdAt, locale)}
                      </p>
                      <div className="mt-1">
                        <Badge variant={movementBadgeVariant(movement.type)}>
                          {movementTypeLabel(movement.type)}
                        </Badge>
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-ink">
                      {movement.qtyDelta > 0 ? "+" : ""}
                      {formatNumber(movement.qtyDelta, locale)}
                    </p>
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-gray-500">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-gray-400">
                        {tInventory("movementUser")}
                      </p>
                      <p className="text-gray-700">
                        {movement.createdBy?.name ??
                          movement.createdBy?.email ??
                          tCommon("notAvailable")}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-gray-400">
                        {tInventory("movementNote")}
                      </p>
                      <p className="text-gray-700">
                        {formatMovementNote(tInventory, movement.note) || tCommon("notAvailable")}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            />
          ) : (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <EmptyIcon className="h-4 w-4" aria-hidden />
              {tInventory("noMovements")}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default ProductDetailPage;

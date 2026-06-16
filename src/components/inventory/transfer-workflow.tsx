"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { PageHeader } from "@/components/page-header";
import { PageLoading } from "@/components/page-loading";
import {
  BackIcon,
  DeleteIcon,
  EmptyIcon,
  SearchIcon,
  StatusDangerIcon,
  StatusSuccessIcon,
  TransferIcon,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { formatStoreMoney } from "@/lib/currencyDisplay";
import { formatNumber } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { cn } from "@/lib/utils";

type TransferLine = {
  key: string;
  productId: string;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  sku: string;
  barcode: string | null;
  imageUrl: string | null;
  unitLabel: string;
  sourceStock: number;
  destinationStock: number;
  unitCostKgs: number | null;
  quantityInput: string;
  duplicateHint?: boolean;
};

type TransferInputViewport = "desktop" | "mobile";

const parseDecimalInput = (value: string) => Number(value.replace(",", "."));
const lineKey = (productId: string, variantId?: string | null) =>
  `${productId}:${variantId ?? "BASE"}`;
const transferInputRefKey = (key: string, viewport: TransferInputViewport) =>
  `${key}:quantity:${viewport}`;
const transferProductSearchFields: ["name"] = ["name"];

const focusInputElement = (input: HTMLInputElement | null | undefined, selectContents = false) => {
  if (!input || input.disabled || input.readOnly) {
    return;
  }
  input.focus();
  if (!selectContents) {
    return;
  }
  const selectFocusedInput = () => {
    if (document.activeElement !== input || input.disabled || input.readOnly) {
      return;
    }
    try {
      input.select();
    } catch {
      // Some mobile/browser input types may reject text selection.
    }
  };
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(selectFocusedInput);
  } else {
    window.setTimeout(selectFocusedInput, 0);
  }
};

type InventoryTransfersPageProps = {
  editDocumentKey?: string;
  editBackHref?: string;
};

export const InventoryTransfersPage = ({
  editDocumentKey,
  editBackHref = "/inventory/movements",
}: InventoryTransfersPageProps = {}) => {
  const t = useTranslations("inventory");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status: sessionStatus } = useSession();
  const { toast } = useToast();
  const trpcUtils = trpc.useUtils();
  const canManageStock =
    session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";
  const isEditMode = Boolean(editDocumentKey);
  const loadedEditDocumentRef = useRef("");

  const storesQuery = trpc.stores.list.useQuery();
  type StoreRow = NonNullable<typeof storesQuery.data>[number];
  const stores: StoreRow[] = useMemo(() => storesQuery.data ?? [], [storesQuery.data]);
  const editableDocumentQuery = trpc.inventory.editableProductMovementDocument.useQuery(
    { documentKey: editDocumentKey ?? "" },
    { enabled: Boolean(editDocumentKey && canManageStock), staleTime: 0 },
  );
  const editableDocument = editableDocumentQuery.data ?? null;
  const initialFromStoreId =
    searchParams?.get("fromStoreId")?.trim() || searchParams?.get("storeId")?.trim() || "";
  const initialToStoreId = searchParams?.get("toStoreId")?.trim() || "";
  const requestedProductId = searchParams?.get("productId")?.trim() ?? "";
  const requestedVariantId = searchParams?.get("variantId")?.trim() ?? "";

  const [fromStoreId, setFromStoreId] = useState("");
  const [toStoreId, setToStoreId] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<TransferLine[]>([]);
  const transferInputRefs = useRef(new Map<string, HTMLInputElement>());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const handledPrefillRef = useRef("");

  const fromStore = stores.find((store) => store.id === fromStoreId) ?? null;
  const toStore = stores.find((store) => store.id === toStoreId) ?? null;
  const enableSku = fromStore?.enableSku ?? true;
  const enableBarcode = fromStore?.enableBarcode ?? true;
  const storesAreSame = Boolean(fromStoreId && toStoreId && fromStoreId === toStoreId);
  const canSearch = Boolean(fromStoreId && toStoreId && !storesAreSame && canManageStock);
  const formatMoney = useCallback(
    (value: number) => formatStoreMoney(value, locale, fromStore),
    [fromStore, locale],
  );

  const searchQuery = trpc.inventory.searchProducts.useQuery(
    {
      storeId: fromStoreId,
      search: search.trim() || undefined,
      searchFields: transferProductSearchFields,
      limit: 100,
    },
    {
      enabled: canSearch,
      keepPreviousData: true,
    },
  );
  type SearchResult = NonNullable<typeof searchQuery.data>[number];

  useEffect(() => {
    if (!stores.length) {
      return;
    }
    if (!fromStoreId) {
      const queryStore = stores.find((store) => store.id === initialFromStoreId);
      setFromStoreId(queryStore?.id ?? stores[0]?.id ?? "");
    }
    if (!toStoreId) {
      const queryStore = stores.find((store) => store.id === initialToStoreId);
      const fallbackStore = stores.find(
        (store) => store.id !== (initialFromStoreId || stores[0]?.id),
      );
      setToStoreId(queryStore?.id ?? fallbackStore?.id ?? "");
    }
  }, [fromStoreId, initialFromStoreId, initialToStoreId, stores, toStoreId]);

  useEffect(() => {
    if (!editableDocument || !editDocumentKey || loadedEditDocumentRef.current === editDocumentKey) {
      return;
    }
    loadedEditDocumentRef.current = editDocumentKey;
    setFromStoreId(editableDocument.sourceStoreId ?? editableDocument.storeId);
    setToStoreId(editableDocument.destinationStoreId ?? "");
    setNote(editableDocument.notes ?? "");
    setSearch("");
    setLines(
      editableDocument.lines.map((line) => ({
        key: lineKey(line.productId, line.variantId),
        productId: line.productId,
        variantId: line.variantId,
        productName: line.productName,
        variantName: line.variantName,
        sku: "",
        barcode: null,
        imageUrl: null,
        unitLabel: t("unit"),
        sourceStock: line.quantity,
        destinationStock: 0,
        unitCostKgs: line.unitCostKgs,
        quantityInput: String(line.quantity),
      })),
    );
  }, [editDocumentKey, editableDocument, t]);

  const getPreviewUrl = useCallback((result: SearchResult) => {
    const imageUrl = result.product.images?.[0]?.url ?? result.product.photoUrl ?? null;
    if (!imageUrl || imageUrl.startsWith("data:image/")) {
      return null;
    }
    return imageUrl;
  }, []);

  const getDisplayName = (result: SearchResult) =>
    result.variant?.name ? `${result.product.name} • ${result.variant.name}` : result.product.name;

  const getBaseUnitLabel = useCallback((result: SearchResult) => {
    const unit = result.product.baseUnit;
    if (!unit) {
      return t("unit");
    }
    if (locale === "kg") {
      return unit.labelKg || unit.code;
    }
    if (locale === "ru") {
      return unit.labelRu || unit.code;
    }
    return unit.code || unit.labelRu || t("unit");
  }, [locale, t]);

  const setTransferInputRef = (
    key: string,
    viewport: TransferInputViewport,
    node: HTMLInputElement | null,
  ) => {
    const refKey = transferInputRefKey(key, viewport);
    if (node) {
      transferInputRefs.current.set(refKey, node);
    } else {
      transferInputRefs.current.delete(refKey);
    }
  };

  const focusTransferQuantity = useCallback(
    (key: string, viewport?: TransferInputViewport, options?: { selectContents?: boolean }) => {
      window.setTimeout(() => {
        const viewportKey =
          viewport ?? (window.matchMedia("(min-width: 1024px)").matches ? "desktop" : "mobile");
        const input =
          transferInputRefs.current.get(transferInputRefKey(key, viewportKey)) ??
          transferInputRefs.current.get(transferInputRefKey(key, "desktop")) ??
          transferInputRefs.current.get(transferInputRefKey(key, "mobile"));
        focusInputElement(input, options?.selectContents ?? false);
      }, 0);
    },
    [],
  );

  const clearDuplicateHint = useCallback((key: string) => {
    window.setTimeout(() => {
      setLines((current) =>
        current.map((line) => (line.key === key ? { ...line, duplicateHint: false } : line)),
      );
    }, 1800);
  }, []);

  const handleFromStoreChange = (nextStoreId: string) => {
    if (nextStoreId === fromStoreId) {
      return;
    }
    setFromStoreId(nextStoreId);
    if (nextStoreId === toStoreId) {
      setToStoreId(stores.find((store) => store.id !== nextStoreId)?.id ?? "");
    }
    setLines([]);
    setSearch("");
  };

  const handleToStoreChange = (nextStoreId: string) => {
    if (nextStoreId === toStoreId) {
      return;
    }
    setToStoreId(nextStoreId);
    setLines([]);
  };

  const addSearchResult = useCallback(
    async (
      result: SearchResult,
      mode: "manual" | "scan",
      options?: { selectQuantity?: boolean },
    ) => {
      if (!toStoreId) {
        toast({ variant: "error", description: t("transferValidationNoDestinationStore") });
        return;
      }
      if (fromStoreId === toStoreId) {
        toast({ variant: "error", description: t("transferValidationSameStore") });
        return;
      }

      const key = lineKey(result.product.id, result.snapshot.variantId);
      let destinationStock = 0;
      try {
        const destinationResults = await trpcUtils.inventory.searchProducts.fetch({
          storeId: toStoreId,
          productId: result.product.id,
          limit: 100,
        });
        const destination = destinationResults.find(
          (item) => lineKey(item.product.id, item.snapshot.variantId) === key,
        );
        destinationStock = destination?.snapshot.onHand ?? 0;
      } catch (error) {
        toast({
          variant: "error",
          description: translateError(tErrors, error as Parameters<typeof translateError>[1]),
        });
        return;
      }
      setLines((current) => {
        const existing = current.find((line) => line.key === key);
        if (existing) {
          return current.map((line) => {
            if (line.key !== key) {
              return line;
            }
            const currentQty = parseDecimalInput(line.quantityInput);
            const nextQty =
              mode === "scan" && Number.isInteger(currentQty) && currentQty > 0
                ? currentQty + 1
                : currentQty;
            return {
              ...line,
              quantityInput: Number.isFinite(nextQty) ? String(nextQty) : line.quantityInput,
              duplicateHint: true,
            };
          });
        }
        return [
          ...current,
          {
            key,
            productId: result.product.id,
            variantId: result.snapshot.variantId ?? null,
            productName: result.product.name,
            variantName: result.variant?.name ?? null,
            sku: enableSku ? result.product.sku : "",
            barcode: enableBarcode ? result.primaryBarcode : null,
            imageUrl: getPreviewUrl(result),
            unitLabel: getBaseUnitLabel(result),
            sourceStock: result.snapshot.onHand,
            destinationStock,
            unitCostKgs: result.unitCostKgs,
            quantityInput: "1",
          },
        ];
      });
      focusTransferQuantity(key, undefined, { selectContents: options?.selectQuantity ?? false });
      clearDuplicateHint(key);
    },
    [
      clearDuplicateHint,
      enableBarcode,
      enableSku,
      focusTransferQuantity,
      fromStoreId,
      getBaseUnitLabel,
      getPreviewUrl,
      t,
      tErrors,
      toStoreId,
      toast,
      trpcUtils.inventory.searchProducts,
    ],
  );

  useEffect(() => {
    if (!requestedProductId || !fromStoreId || !toStoreId || !canSearch) {
      return;
    }
    const handledKey = `${fromStoreId}:${toStoreId}:${requestedProductId}:${requestedVariantId}`;
    if (handledPrefillRef.current === handledKey) {
      return;
    }
    handledPrefillRef.current = handledKey;

    const prefillLine = async () => {
      try {
        const results = await trpcUtils.inventory.searchProducts.fetch({
          storeId: fromStoreId,
          productId: requestedProductId,
          limit: 100,
        });
        const result =
          results.find(
            (item) =>
              item.product.id === requestedProductId &&
              (item.snapshot.variantId ?? "") === requestedVariantId,
          ) ??
          results.find((item) => item.product.id === requestedProductId) ??
          results[0];
        if (result) {
          await addSearchResult(result, "manual", { selectQuantity: true });
        }
      } catch (error) {
        toast({
          variant: "error",
          description: translateError(tErrors, error as Parameters<typeof translateError>[1]),
        });
      }
    };

    void prefillLine();
  }, [
    addSearchResult,
    canSearch,
    fromStoreId,
    requestedProductId,
    requestedVariantId,
    tErrors,
    toStoreId,
    toast,
    trpcUtils.inventory.searchProducts,
  ]);

  const handleSearchSubmit = async () => {
    if (!canSearch || !search.trim()) {
      return;
    }
    try {
      const results = await trpcUtils.inventory.searchProducts.fetch({
        storeId: fromStoreId,
        search: search.trim(),
        searchFields: transferProductSearchFields,
        limit: 100,
      });
      if (!results.length) {
        toast({ variant: "error", description: t("transferProductUnavailableSource") });
      }
    } catch (error) {
      toast({
        variant: "error",
        description: translateError(tErrors, error as Parameters<typeof translateError>[1]),
      });
    }
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    void handleSearchSubmit();
  };

  const handleQuantityKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    key: string,
    viewport: TransferInputViewport,
  ) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    const currentRow = event.currentTarget.closest("[data-transfer-line-row]");
    const nextRow = event.shiftKey
      ? currentRow?.previousElementSibling
      : currentRow?.nextElementSibling;
    const nextInput = nextRow?.querySelector<HTMLInputElement>(
      'input[data-transfer-input="quantity"]',
    );
    if (nextInput) {
      window.setTimeout(() => focusInputElement(nextInput, true), 0);
      return;
    }

    const currentIndex = lines.findIndex((line) => line.key === key);
    if (currentIndex === -1) {
      return;
    }
    const nextLine = lines[currentIndex + (event.shiftKey ? -1 : 1)];
    if (nextLine) {
      focusTransferQuantity(nextLine.key, viewport, { selectContents: true });
    }
  };

  const updateLine = (key: string, patch: Partial<TransferLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const removeLine = (key: string) => {
    setLines((current) => current.filter((line) => line.key !== key));
  };

  const lineMetrics = useMemo(
    () =>
      lines.map((line) => {
        const quantity = parseDecimalInput(line.quantityInput);
        const quantityValid = Number.isInteger(quantity) && quantity > 0;
        const lineTotal =
          quantityValid && typeof line.unitCostKgs === "number"
            ? quantity * line.unitCostKgs
            : null;
        return {
          key: line.key,
          quantity,
          quantityValid,
          sourceAfter: quantityValid ? line.sourceStock - quantity : line.sourceStock,
          destinationAfter: quantityValid
            ? line.destinationStock + quantity
            : line.destinationStock,
          lineTotal,
        };
      }),
    [lines],
  );
  const metricByKey = useMemo(
    () => new Map(lineMetrics.map((metric) => [metric.key, metric])),
    [lineMetrics],
  );
  const invalidQuantity = lineMetrics.some((metric) => !metric.quantityValid);
  const hasTotalCost = lines.some((line) => typeof line.unitCostKgs === "number");
  const summary = useMemo(
    () => ({
      products: lines.length,
      totalQuantity: lineMetrics.reduce(
        (sum, metric) => sum + (metric.quantityValid ? metric.quantity : 0),
        0,
      ),
      totalCost: hasTotalCost
        ? lineMetrics.reduce((sum, metric) => sum + (metric.lineTotal ?? 0), 0)
        : null,
    }),
    [hasTotalCost, lineMetrics, lines.length],
  );
  const validationMessage = !fromStoreId
    ? t("transferValidationNoSourceStore")
    : !toStoreId
      ? t("transferValidationNoDestinationStore")
      : storesAreSame
        ? t("transferValidationSameStore")
        : !lines.length
          ? t("transferValidationNoProducts")
          : invalidQuantity
            ? t("transferValidationInvalidQuantity")
            : "";

  const transferMutation = trpc.inventory.transfer.useMutation({
    onSuccess: async (result) => {
      await trpcUtils.inventory.list.invalidate();
      await trpcUtils.inventory.searchProducts.invalidate();
      await trpcUtils.inventory.productMovements.invalidate();
      await trpcUtils.inventory.productMovementDocument.invalidate();
      toast({ variant: "success", description: t("transferSuccess") });
      router.push(
        `/inventory/movements/${encodeURIComponent(`TRANSFER:TRANSFER:${result.transferId}`)}`,
      );
    },
    onError: (error) => {
      toast({
        variant: "error",
        description: translateError(tErrors, error) || t("transferPostFailed"),
      });
    },
  });
  const editMutation = trpc.inventory.editProductMovementDocument.useMutation({
    onSuccess: async () => {
      await trpcUtils.inventory.list.invalidate();
      await trpcUtils.inventory.searchProducts.invalidate();
      await trpcUtils.inventory.productMovements.invalidate();
      await trpcUtils.inventory.productMovementDocument.invalidate();
      await trpcUtils.inventory.editableProductMovementDocument.invalidate();
      toast({ variant: "success", description: t("transferEditSuccess") });
      router.push(`/inventory/movements/${encodeURIComponent(editDocumentKey ?? "")}`);
    },
    onError: (error) => {
      toast({
        variant: "error",
        description: translateError(tErrors, error) || t("transferPostFailed"),
      });
    },
  });

  const handlePost = () => {
    if (validationMessage || transferMutation.isLoading || editMutation.isLoading) {
      if (validationMessage) {
        toast({ variant: "error", description: validationMessage });
      }
      return;
    }
    const normalizedLines = lines.map((line) => ({
      productId: line.productId,
      variantId: line.variantId,
      quantity: metricByKey.get(line.key)?.quantity ?? 0,
      unitCostKgs: line.unitCostKgs,
    }));

    if (isEditMode && editDocumentKey) {
      editMutation.mutate({
        documentKey: editDocumentKey,
        destinationStoreId: toStoreId,
        notes: note.trim() || undefined,
        reason: note.trim() || t("transferEditReason"),
        lines: normalizedLines,
        idempotencyKey: crypto.randomUUID(),
      });
      return;
    }

    transferMutation.mutate({
      fromStoreId,
      toStoreId,
      note: note.trim() || undefined,
      lines: normalizedLines.map((line) => ({
        productId: line.productId,
        variantId: line.variantId,
        qty: line.quantity,
      })),
      idempotencyKey: crypto.randomUUID(),
    });
  };

  const formatOptionalMoney = (value: number | null) =>
    typeof value === "number" ? formatMoney(value) : t("transferCostNotSpecified");
  const pageTitle = isEditMode ? t("transferEditTitle") : t("transferStock");
  const pageSubtitle = isEditMode ? t("transferEditSubtitle") : t("transferStockSubtitle");
  const backHref = isEditMode ? editBackHref : "/inventory";
  const saving = transferMutation.isLoading || editMutation.isLoading;
  const submitLabel = isEditMode ? t("saveChanges") : t("transferPost");
  const submitShortLabel = isEditMode ? t("saveChangesShort") : t("transferPostShort");

  if (sessionStatus === "loading") {
    return <PageLoading />;
  }

  if (!canManageStock) {
    return (
      <div>
        <PageHeader
          title={pageTitle}
          subtitle={pageSubtitle}
          action={
            <Button asChild variant="secondary">
              <Link href={backHref}>
                <BackIcon className="h-4 w-4" aria-hidden />
                {isEditMode ? t("backToMovements") : tCommon("back")}
              </Link>
            </Button>
          }
        />
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          {t("transferPermissionDenied")}
        </div>
      </div>
    );
  }

  if (isEditMode && editableDocumentQuery.isLoading) {
    return (
      <div>
        <PageHeader
          title={pageTitle}
          subtitle={pageSubtitle}
          action={
            <Button asChild variant="secondary">
              <Link href={backHref}>
                <BackIcon className="h-4 w-4" aria-hidden />
                {t("backToMovements")}
              </Link>
            </Button>
          }
        />
        <PageLoading />
      </div>
    );
  }

  if (isEditMode && editableDocumentQuery.error) {
    return (
      <div>
        <PageHeader
          title={pageTitle}
          subtitle={pageSubtitle}
          action={
            <Button asChild variant="secondary">
              <Link href={backHref}>
                <BackIcon className="h-4 w-4" aria-hidden />
                {t("backToMovements")}
              </Link>
            </Button>
          }
        />
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          {translateError(tErrors, editableDocumentQuery.error)}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-hidden pb-[15rem] md:pb-0">
      <PageHeader
        title={pageTitle}
        subtitle={pageSubtitle}
        action={
          <Button asChild variant="secondary">
            <Link href={backHref}>
              <BackIcon className="h-4 w-4" aria-hidden />
              {isEditMode ? t("backToMovements") : tCommon("back")}
            </Link>
          </Button>
        }
        actionClassName="hidden md:flex"
      />

      <div className="space-y-6">
        <section className="bazaar-doc-surface p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-foreground">{t("transferDetailsTitle")}</h3>
            <Button asChild variant="ghost" size="sm" className="md:hidden">
              <Link href={backHref}>
                <BackIcon className="h-4 w-4" aria-hidden />
                {isEditMode ? t("backToMovements") : tCommon("back")}
              </Link>
            </Button>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("transferSourceStore")}</Label>
              <Select value={fromStoreId} onValueChange={handleFromStoreChange}>
                <SelectTrigger>
                  <SelectValue placeholder={tCommon("selectStore")} />
                </SelectTrigger>
                <SelectContent>
                  {stores.map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("transferDestinationStore")}</Label>
              <Select value={toStoreId} onValueChange={handleToStoreChange}>
                <SelectTrigger>
                  <SelectValue placeholder={tCommon("selectStore")} />
                </SelectTrigger>
                <SelectContent>
                  {stores.map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="transfer-note">{t("transferNote")}</Label>
              <Textarea
                id="transfer-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t("notePlaceholder")}
                rows={3}
              />
            </div>
          </div>
        </section>

        <div className="grid items-start gap-4 xl:grid-cols-2">
          <section className="bazaar-doc-surface p-4">
            <div className="mb-4 flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <h3 className="text-base font-semibold text-foreground">
                {t("transferSearchTitle")}
              </h3>
              {fromStore && toStore ? (
                <Badge variant={storesAreSame ? "warning" : "muted"} className="min-w-0 max-w-full">
                  <span className="min-w-0 truncate">
                    {fromStore.name} → {toStore.name}
                  </span>
                </Badge>
              ) : null}
            </div>
            <div className="relative">
              <SearchIcon
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                ref={searchInputRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={t("transferSearchPlaceholderShort")}
                disabled={!canSearch}
                className="pl-9"
                autoComplete="off"
              />
            </div>
            <div className="bazaar-doc-search-list">
              {searchQuery.isFetching ? (
                <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                  <Spinner className="h-4 w-4" />
                  {tCommon("loading")}
                </div>
              ) : (searchQuery.data ?? []).length ? (
                (searchQuery.data ?? []).map((result) => {
                  const key = lineKey(result.product.id, result.snapshot.variantId);
                  const added = lines.some((line) => line.key === key);
                  return (
                    <div
                      key={key}
                      className="bazaar-doc-search-row"
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left text-sm disabled:cursor-wait disabled:opacity-60"
                        onClick={() => void addSearchResult(result, "manual")}
                        disabled={!canSearch}
                      >
                        <span className="bazaar-doc-thumb">
                          {getPreviewUrl(result) ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={getPreviewUrl(result) ?? ""}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <EmptyIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-foreground">
                            {getDisplayName(result)}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {[
                              enableSku ? result.product.sku : "",
                              enableBarcode ? result.primaryBarcode : "",
                            ]
                              .filter(Boolean)
                              .join(" • ") || tCommon("notAvailable")}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {t("transferSourceStock")}:{" "}
                            {formatNumber(result.snapshot.onHand, locale)}
                            {result.unitCostKgs !== null
                              ? ` • ${t("unitCost")}: ${formatMoney(result.unitCostKgs)}`
                              : ""}
                          </span>
                        </span>
                        {added ? <Badge variant="success">{t("transferAdded")}</Badge> : null}
                      </button>
                    </div>
                  );
                })
              ) : (
                <div className="px-3 py-3 text-sm text-muted-foreground">
                  {canSearch
                    ? t("productSearchEmpty")
                    : validationMessage || t("transferEmptyState")}
                </div>
              )}
            </div>
          </section>

          <section className="bazaar-doc-surface p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-foreground">{t("transferTableTitle")}</h3>
              <Badge variant={validationMessage ? "warning" : "success"}>
                {validationMessage || t("transferValidationReady")}
              </Badge>
            </div>

            {lines.length ? (
              <div className="space-y-3">
                <div className="hidden px-3 text-[11px] font-medium text-muted-foreground lg:grid lg:grid-cols-[minmax(10rem,1fr)_4.75rem_5.75rem_5.75rem_5.75rem_5.75rem_2.25rem] lg:gap-2">
                  <span>{tCommon("product")}</span>
                  <span>{t("transferQty")}</span>
                  <span>{t("transferSourceAfter")}</span>
                  <span>{t("transferDestinationAfter")}</span>
                  <span>{t("unitCost")}</span>
                  <span>{t("receivingLineTotal")}</span>
                  <span />
                </div>
                {lines.map((line, index) => {
                  const metric = metricByKey.get(line.key);
                  const lineNumber = index + 1;
                  return (
                    <div
                      key={line.key}
                      data-transfer-line-row
                      className="bazaar-doc-line-row grid gap-3 lg:grid-cols-[minmax(10rem,1fr)_4.75rem_5.75rem_5.75rem_5.75rem_5.75rem_2.25rem] lg:items-center lg:gap-2"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="bazaar-doc-line-index">
                          {lineNumber}
                        </span>
                        <span className="bazaar-doc-line-thumb">
                          {line.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={line.imageUrl}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <EmptyIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {line.variantName
                              ? `${line.productName} • ${line.variantName}`
                              : line.productName}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {[enableSku ? line.sku : "", enableBarcode ? line.barcode : ""]
                              .filter(Boolean)
                              .join(" • ") || tCommon("notAvailable")}
                          </p>
                          <p className="truncate text-xs text-muted-foreground lg:hidden">
                            {t("transferSourceStock")}: {formatNumber(line.sourceStock, locale)}
                            <span className="px-1 text-muted-foreground/60">·</span>
                            {t("transferDestinationStock")}:{" "}
                            {formatNumber(line.destinationStock, locale)}
                          </p>
                          {line.duplicateHint ? (
                            <p className="truncate text-xs text-warning">
                              {t("transferDuplicateHint")}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="space-y-1 lg:space-y-0">
                        <Label className="block text-[11px] leading-4 lg:hidden">
                          {t("transferQty")}
                        </Label>
                        <Input
                          ref={(node) => {
                            setTransferInputRef(line.key, "desktop", node);
                          }}
                          value={line.quantityInput}
                          onChange={(event) =>
                            updateLine(line.key, { quantityInput: event.target.value })
                          }
                          onKeyDown={(event) => handleQuantityKeyDown(event, line.key, "desktop")}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          step={1}
                          data-transfer-input="quantity"
                          className={cn("h-8 px-2", !metric?.quantityValid && "border-danger/60")}
                        />
                      </div>
                      <div>
                        <p className="text-[11px] leading-4 text-muted-foreground lg:hidden">
                          {t("transferSourceAfter")}
                        </p>
                        <p
                          className={cn(
                            "flex h-8 items-center text-sm font-semibold",
                            (metric?.sourceAfter ?? line.sourceStock) < 0
                              ? "text-danger"
                              : "text-foreground",
                          )}
                        >
                          {formatNumber(metric?.sourceAfter ?? line.sourceStock, locale)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] leading-4 text-muted-foreground lg:hidden">
                          {t("transferDestinationAfter")}
                        </p>
                        <p className="flex h-8 items-center text-sm font-semibold text-foreground">
                          {formatNumber(metric?.destinationAfter ?? line.destinationStock, locale)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] leading-4 text-muted-foreground lg:hidden">
                          {t("unitCost")}
                        </p>
                        <p className="flex h-8 items-center text-sm font-semibold text-foreground">
                          {formatOptionalMoney(line.unitCostKgs)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] leading-4 text-muted-foreground lg:hidden">
                          {t("receivingLineTotal")}
                        </p>
                        <p className="flex h-8 items-center text-sm font-semibold text-foreground">
                          {formatOptionalMoney(metric?.lineTotal ?? null)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="self-start lg:h-8 lg:w-8 lg:self-center lg:justify-self-end"
                        aria-label={t("transferRemoveLine")}
                        onClick={() => removeLine(line.key)}
                      >
                        <DeleteIcon className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bazaar-doc-empty">
                <EmptyIcon className="mx-auto mb-3 h-8 w-8" aria-hidden />
                {t("transferEmptyState")}
              </div>
            )}
          </section>
        </div>

        <section className="hidden md:block">
          <div className="bazaar-doc-summary">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h3 className="text-base font-semibold text-foreground">
                {t("transferSummaryTitle")}
              </h3>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="secondary">
                  <Link href={backHref}>{tCommon("cancel")}</Link>
                </Button>
                <Button
                  type="button"
                  onClick={handlePost}
                  disabled={saving || Boolean(validationMessage)}
                >
                  {saving ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <TransferIcon className="h-4 w-4" aria-hidden />
                  )}
                  {saving ? tCommon("saving") : submitLabel}
                </Button>
              </div>
            </div>
            <dl className="mt-4 grid gap-3 text-sm lg:grid-cols-4">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{t("transferSourceStore")}</dt>
                <dd className="text-right font-medium text-foreground">
                  {fromStore?.name ?? tCommon("notAvailable")}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{t("transferDestinationStore")}</dt>
                <dd className="text-right font-medium text-foreground">
                  {toStore?.name ?? tCommon("notAvailable")}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{t("transferTotalQuantity")}</dt>
                <dd className="font-medium text-foreground">
                  {formatNumber(summary.totalQuantity, locale)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{t("receivingTotalCost")}</dt>
                <dd className="font-medium text-foreground">
                  {formatOptionalMoney(summary.totalCost)}
                </dd>
              </div>
            </dl>
            <div
              className={cn(
                "bazaar-doc-validation",
                validationMessage
                  ? "border-warning/30 bg-warning/10 text-warning"
                  : "border-success/30 bg-success/10 text-success",
              )}
            >
              {validationMessage ? (
                <StatusDangerIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              ) : (
                <StatusSuccessIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              )}
              <span>{validationMessage || t("transferValidationReady")}</span>
            </div>
          </div>
        </section>
      </div>

      <div className="bazaar-doc-mobile-actions bottom-[calc(4.25rem+env(safe-area-inset-bottom))] md:hidden">
        <div className="mx-auto max-w-screen-sm space-y-2 pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <div className="min-w-0">
              <span className="font-semibold text-foreground">
                {formatNumber(summary.products, locale)}
              </span>{" "}
              {t("transferProductsCountShort")}
              <span className="px-1 text-muted-foreground/60">·</span>
              <span className="font-semibold text-foreground">
                {formatNumber(summary.totalQuantity, locale)}
              </span>{" "}
              {t("transferTotalQuantityShort")}
            </div>
            <div className="shrink-0 text-sm font-semibold text-foreground">
              {formatOptionalMoney(summary.totalCost)}
            </div>
          </div>
          <div className="grid grid-cols-[0.8fr_1.2fr] gap-2">
            <Button asChild variant="secondary" className="min-h-11">
              <Link href={backHref}>{tCommon("cancel")}</Link>
            </Button>
            <Button
              type="button"
              className="min-h-11"
              onClick={handlePost}
              disabled={saving || Boolean(validationMessage)}
            >
              {saving ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <TransferIcon className="h-4 w-4" aria-hidden />
              )}
              <span className="sm:hidden">
                {saving ? tCommon("saving") : submitShortLabel}
              </span>
              <span className="hidden sm:inline">
                {saving ? tCommon("saving") : submitLabel}
              </span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InventoryTransfersPage;

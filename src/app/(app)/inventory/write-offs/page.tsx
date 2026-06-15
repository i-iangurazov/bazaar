"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { PageHeader } from "@/components/page-header";
import { PageLoading } from "@/components/page-loading";
import {
  ArchiveIcon,
  BackIcon,
  DeleteIcon,
  EmptyIcon,
  SearchIcon,
  StatusDangerIcon,
  StatusSuccessIcon,
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
import { WRITE_OFF_REASONS, type StockWriteOffReason } from "@/lib/inventory/writeOff";
import { formatStoreMoney } from "@/lib/currencyDisplay";
import { formatDateTime, formatNumber } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { cn } from "@/lib/utils";

type WriteOffLine = {
  key: string;
  productId: string;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  sku: string;
  barcode: string | null;
  imageUrl: string | null;
  unitLabel: string;
  currentStock: number;
  unitCostKgs: number | null;
  quantityInput: string;
  duplicateHint?: boolean;
};

type WriteOffInputViewport = "desktop" | "mobile";

const writeOffProductSearchFields: ["name"] = ["name"];

const parseDecimalInput = (value: string) => Number(value.replace(",", "."));
const lineKey = (productId: string, variantId?: string | null) =>
  `${productId}:${variantId ?? "BASE"}`;
const writeOffInputRefKey = (key: string, viewport: WriteOffInputViewport) =>
  `${key}:quantity:${viewport}`;
const toDateTimeLocalValue = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

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

const InventoryWriteOffsPage = () => {
  const t = useTranslations("inventory");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status: sessionStatus } = useSession();
  const { toast } = useToast();
  const trpcUtils = trpc.useUtils();
  const canManageStock = session?.user?.role === "ADMIN";

  const storesQuery = trpc.stores.list.useQuery();
  type StoreRow = NonNullable<typeof storesQuery.data>[number];
  const stores: StoreRow[] = useMemo(() => storesQuery.data ?? [], [storesQuery.data]);
  const initialStoreId = searchParams?.get("storeId")?.trim() || "";
  const requestedProductId = searchParams?.get("productId")?.trim() ?? "";
  const requestedVariantId = searchParams?.get("variantId")?.trim() ?? "";

  const [storeId, setStoreId] = useState("");
  const [documentDate, setDocumentDate] = useState(() => toDateTimeLocalValue(new Date()));
  const [reason, setReason] = useState<StockWriteOffReason | "">("");
  const [comment, setComment] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<WriteOffLine[]>([]);
  const writeOffInputRefs = useRef(new Map<string, HTMLInputElement>());
  const handledPrefillRef = useRef("");

  const selectedStore = stores.find((store) => store.id === storeId) ?? null;
  const enableSku = selectedStore?.enableSku ?? true;
  const enableBarcode = selectedStore?.enableBarcode ?? true;
  const canSearch = Boolean(storeId && canManageStock);
  const authorLabel =
    session?.user?.name ||
    session?.user?.email ||
    (sessionStatus === "loading" ? "" : tCommon("notAvailable"));
  const formatMoney = useCallback(
    (value: number) => formatStoreMoney(value, locale, selectedStore),
    [locale, selectedStore],
  );

  const searchQuery = trpc.inventory.searchProducts.useQuery(
    {
      storeId,
      search: search.trim() || undefined,
      searchFields: writeOffProductSearchFields,
      limit: 100,
    },
    {
      enabled: canSearch,
      keepPreviousData: true,
    },
  );
  type SearchResult = NonNullable<typeof searchQuery.data>[number];

  useEffect(() => {
    if (!stores.length || storeId) {
      return;
    }
    const queryStore = stores.find((store) => store.id === initialStoreId);
    setStoreId(queryStore?.id ?? stores[0]?.id ?? "");
  }, [initialStoreId, storeId, stores]);

  const getPreviewUrl = useCallback((result: SearchResult) => {
    const imageUrl = result.product.images?.[0]?.url ?? result.product.photoUrl ?? null;
    if (!imageUrl || imageUrl.startsWith("data:image/")) {
      return null;
    }
    return imageUrl;
  }, []);

  const getDisplayName = (result: SearchResult) =>
    result.variant?.name ? `${result.product.name} • ${result.variant.name}` : result.product.name;

  const getBaseUnitLabel = useCallback(
    (result: SearchResult) => {
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
    },
    [locale, t],
  );

  const setWriteOffInputRef = (
    key: string,
    viewport: WriteOffInputViewport,
    node: HTMLInputElement | null,
  ) => {
    const refKey = writeOffInputRefKey(key, viewport);
    if (node) {
      writeOffInputRefs.current.set(refKey, node);
    } else {
      writeOffInputRefs.current.delete(refKey);
    }
  };

  const focusWriteOffQuantity = useCallback(
    (key: string, viewport?: WriteOffInputViewport, options?: { selectContents?: boolean }) => {
      window.setTimeout(() => {
        const viewportKey =
          viewport ?? (window.matchMedia("(min-width: 1024px)").matches ? "desktop" : "mobile");
        const input =
          writeOffInputRefs.current.get(writeOffInputRefKey(key, viewportKey)) ??
          writeOffInputRefs.current.get(writeOffInputRefKey(key, "desktop")) ??
          writeOffInputRefs.current.get(writeOffInputRefKey(key, "mobile"));
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

  const handleStoreChange = (nextStoreId: string) => {
    if (nextStoreId === storeId) {
      return;
    }
    setStoreId(nextStoreId);
    setLines([]);
    setSearch("");
  };

  const addSearchResult = useCallback(
    (result: SearchResult, options?: { selectQuantity?: boolean }) => {
      const key = lineKey(result.product.id, result.snapshot.variantId);
      setLines((current) => {
        const existing = current.find((line) => line.key === key);
        if (existing) {
          return current.map((line) =>
            line.key === key ? { ...line, duplicateHint: true } : line,
          );
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
            currentStock: result.snapshot.onHand,
            unitCostKgs: result.unitCostKgs,
            quantityInput: "1",
          },
        ];
      });
      focusWriteOffQuantity(key, undefined, { selectContents: options?.selectQuantity ?? false });
      clearDuplicateHint(key);
    },
    [
      clearDuplicateHint,
      enableBarcode,
      enableSku,
      focusWriteOffQuantity,
      getBaseUnitLabel,
      getPreviewUrl,
    ],
  );

  useEffect(() => {
    if (!requestedProductId || !storeId || !canSearch) {
      return;
    }
    const handledKey = `${storeId}:${requestedProductId}:${requestedVariantId}`;
    if (handledPrefillRef.current === handledKey) {
      return;
    }
    handledPrefillRef.current = handledKey;

    const prefillLine = async () => {
      try {
        const results = await trpcUtils.inventory.searchProducts.fetch({
          storeId,
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
          addSearchResult(result, { selectQuantity: true });
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
    requestedProductId,
    requestedVariantId,
    storeId,
    tErrors,
    toast,
    trpcUtils.inventory.searchProducts,
  ]);

  const handleSearchSubmit = async () => {
    if (!canSearch || !search.trim()) {
      return;
    }
    try {
      const results = await trpcUtils.inventory.searchProducts.fetch({
        storeId,
        search: search.trim(),
        searchFields: writeOffProductSearchFields,
        limit: 100,
      });
      if (!results.length) {
        toast({ variant: "error", description: t("writeOffProductUnavailable") });
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
    viewport: WriteOffInputViewport,
  ) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    const currentRow = event.currentTarget.closest("[data-write-off-line-row]");
    const nextRow = event.shiftKey
      ? currentRow?.previousElementSibling
      : currentRow?.nextElementSibling;
    const nextInput = nextRow?.querySelector<HTMLInputElement>(
      'input[data-write-off-input="quantity"]',
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
      focusWriteOffQuantity(nextLine.key, viewport, { selectContents: true });
    }
  };

  const updateLine = (key: string, patch: Partial<WriteOffLine>) => {
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
        const exceedsStock =
          quantityValid && !selectedStore?.allowNegativeStock && quantity > line.currentStock;
        const lineTotal =
          quantityValid && typeof line.unitCostKgs === "number"
            ? quantity * line.unitCostKgs
            : null;
        return {
          key: line.key,
          quantity,
          quantityValid,
          exceedsStock,
          stockAfter: quantityValid ? line.currentStock - quantity : line.currentStock,
          lineTotal,
        };
      }),
    [lines, selectedStore?.allowNegativeStock],
  );
  const metricByKey = useMemo(
    () => new Map(lineMetrics.map((metric) => [metric.key, metric])),
    [lineMetrics],
  );
  const invalidQuantity = lineMetrics.some((metric) => !metric.quantityValid);
  const hasExceededStock = lineMetrics.some((metric) => metric.exceedsStock);
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
  const validationMessage = !storeId
    ? t("writeOffValidationNoStore")
    : !reason
      ? t("writeOffValidationNoReason")
      : !lines.length
        ? t("writeOffValidationNoProducts")
        : invalidQuantity
          ? t("writeOffValidationInvalidQuantity")
          : hasExceededStock
            ? t("writeOffValidationExceedsStock")
            : "";

  const writeOffMutation = trpc.inventory.postStockWriteOff.useMutation({
    onSuccess: async (result) => {
      await trpcUtils.inventory.list.invalidate();
      await trpcUtils.inventory.searchProducts.invalidate();
      await trpcUtils.inventory.productMovements.invalidate();
      await trpcUtils.inventory.productMovementDocument.invalidate();
      toast({ variant: "success", description: t("writeOffSuccess") });
      router.push(
        `/inventory/movements/${encodeURIComponent(`WRITE_OFF:WRITE_OFF:${result.writeOffId}`)}`,
      );
    },
    onError: (error) => {
      toast({
        variant: "error",
        description: translateError(tErrors, error) || t("writeOffPostFailed"),
      });
    },
  });

  const handlePost = () => {
    if (validationMessage || writeOffMutation.isLoading || !reason) {
      if (validationMessage) {
        toast({ variant: "error", description: validationMessage });
      }
      return;
    }
    writeOffMutation.mutate({
      storeId,
      date: documentDate ? new Date(documentDate).toISOString() : undefined,
      reason,
      comment: comment.trim() || undefined,
      lines: lines.map((line) => ({
        productId: line.productId,
        variantId: line.variantId,
        qty: metricByKey.get(line.key)?.quantity ?? 0,
      })),
      idempotencyKey: crypto.randomUUID(),
    });
  };

  const formatOptionalMoney = (value: number | null) =>
    typeof value === "number" ? formatMoney(value) : t("writeOffCostNotSpecified");

  if (sessionStatus === "loading") {
    return <PageLoading />;
  }

  if (!canManageStock) {
    return (
      <div>
        <PageHeader
          title={t("stockWriteOff")}
          subtitle={t("stockWriteOffSubtitle")}
          action={
            <Button asChild variant="secondary">
              <Link href="/inventory">
                <BackIcon className="h-4 w-4" aria-hidden />
                {tCommon("back")}
              </Link>
            </Button>
          }
        />
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          {t("writeOffPermissionDenied")}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-hidden pb-[15rem] md:pb-0">
      <PageHeader
        title={t("stockWriteOff")}
        subtitle={t("stockWriteOffSubtitle")}
        action={
          <Button asChild variant="secondary">
            <Link href="/inventory">
              <BackIcon className="h-4 w-4" aria-hidden />
              {tCommon("back")}
            </Link>
          </Button>
        }
        actionClassName="hidden md:flex"
      />

      <div className="space-y-6">
        <section className="bazaar-doc-surface p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-foreground">{t("writeOffDetailsTitle")}</h3>
            <Button asChild variant="ghost" size="sm" className="md:hidden">
              <Link href="/inventory">
                <BackIcon className="h-4 w-4" aria-hidden />
                {tCommon("back")}
              </Link>
            </Button>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("writeOffStore")}</Label>
              <Select value={storeId} onValueChange={handleStoreChange}>
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
              <Label htmlFor="write-off-date">{t("writeOffDate")}</Label>
              <Input
                id="write-off-date"
                type="datetime-local"
                value={documentDate}
                onChange={(event) => setDocumentDate(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("writeOffAuthor")}</Label>
              <div className="flex h-10 items-center rounded-xl border border-input bg-muted/30 px-3 text-sm text-foreground">
                {authorLabel}
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("writeOffReason")}</Label>
              <Select
                value={reason}
                onValueChange={(value) => setReason(value as StockWriteOffReason)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("writeOffReasonPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {WRITE_OFF_REASONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="write-off-comment">{t("writeOffComment")}</Label>
              <Textarea
                id="write-off-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
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
                {t("writeOffSearchTitle")}
              </h3>
              {selectedStore ? (
                <Badge variant={selectedStore.allowNegativeStock ? "warning" : "muted"}>
                  {selectedStore.allowNegativeStock
                    ? t("writeOffNegativeAllowed")
                    : selectedStore.name}
                </Badge>
              ) : null}
            </div>
            <div className="relative">
              <SearchIcon
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={t("writeOffSearchPlaceholderShort")}
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
                        onClick={() => addSearchResult(result)}
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
                            {t("writeOffCurrentStock")}:{" "}
                            {formatNumber(result.snapshot.onHand, locale)}
                            {result.unitCostKgs !== null
                              ? ` • ${t("unitCost")}: ${formatMoney(result.unitCostKgs)}`
                              : ""}
                          </span>
                        </span>
                        {added ? <Badge variant="success">{t("writeOffAdded")}</Badge> : null}
                      </button>
                    </div>
                  );
                })
              ) : (
                <div className="px-3 py-3 text-sm text-muted-foreground">
                  {canSearch
                    ? t("productSearchEmpty")
                    : validationMessage || t("writeOffEmptyState")}
                </div>
              )}
            </div>
          </section>

          <section className="bazaar-doc-surface p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-foreground">{t("writeOffTableTitle")}</h3>
              <Badge variant={validationMessage ? "warning" : "success"}>
                {validationMessage || t("writeOffValidationReady")}
              </Badge>
            </div>

            {lines.length ? (
              <div className="space-y-3">
                <div className="hidden px-3 text-[11px] font-medium text-muted-foreground lg:grid lg:grid-cols-[minmax(10rem,1fr)_4.75rem_5.75rem_5.75rem_5.75rem_5.75rem_2.25rem] lg:gap-2">
                  <span>{tCommon("product")}</span>
                  <span>{t("writeOffQty")}</span>
                  <span>{t("writeOffCurrentStock")}</span>
                  <span>{t("writeOffStockAfter")}</span>
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
                      data-write-off-line-row
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
                            {t("writeOffCurrentStock")}: {formatNumber(line.currentStock, locale)}
                          </p>
                          {line.duplicateHint ? (
                            <p className="truncate text-xs text-warning">
                              {t("writeOffDuplicateHint")}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="space-y-1 lg:space-y-0">
                        <Label className="block text-[11px] leading-4 lg:hidden">
                          {t("writeOffQty")}
                        </Label>
                        <Input
                          ref={(node) => {
                            setWriteOffInputRef(line.key, "desktop", node);
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
                          data-write-off-input="quantity"
                          className={cn(
                            "h-8 px-2",
                            (!metric?.quantityValid || metric?.exceedsStock) && "border-danger/60",
                          )}
                        />
                      </div>
                      <div>
                        <p className="text-[11px] leading-4 text-muted-foreground lg:hidden">
                          {t("writeOffCurrentStock")}
                        </p>
                        <p className="flex h-8 items-center text-sm font-semibold text-foreground">
                          {formatNumber(line.currentStock, locale)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] leading-4 text-muted-foreground lg:hidden">
                          {t("writeOffStockAfter")}
                        </p>
                        <p
                          className={cn(
                            "flex h-8 items-center text-sm font-semibold",
                            (metric?.stockAfter ?? line.currentStock) < 0
                              ? "text-danger"
                              : "text-foreground",
                          )}
                        >
                          {formatNumber(metric?.stockAfter ?? line.currentStock, locale)}
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
                        aria-label={t("writeOffRemoveLine")}
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
                {t("writeOffEmptyState")}
              </div>
            )}
          </section>
        </div>

        <section className="hidden md:block">
          <div className="bazaar-doc-summary">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h3 className="text-base font-semibold text-foreground">
                {t("writeOffSummaryTitle")}
              </h3>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="secondary">
                  <Link href="/inventory">{tCommon("cancel")}</Link>
                </Button>
                <Button
                  type="button"
                  onClick={handlePost}
                  disabled={writeOffMutation.isLoading || Boolean(validationMessage)}
                >
                  {writeOffMutation.isLoading ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <ArchiveIcon className="h-4 w-4" aria-hidden />
                  )}
                  {writeOffMutation.isLoading ? tCommon("saving") : t("writeOffPost")}
                </Button>
              </div>
            </div>
            <dl className="mt-4 grid gap-3 text-sm lg:grid-cols-4">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{t("writeOffStore")}</dt>
                <dd className="text-right font-medium text-foreground">
                  {selectedStore?.name ?? tCommon("notAvailable")}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{t("writeOffDate")}</dt>
                <dd className="font-medium text-foreground">
                  {documentDate
                    ? formatDateTime(new Date(documentDate).toISOString(), locale)
                    : tCommon("notAvailable")}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{t("writeOffTotalQuantity")}</dt>
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
              <span>{validationMessage || t("writeOffValidationReady")}</span>
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
              {t("writeOffProductsCountShort")}
              <span className="px-1 text-muted-foreground/60">·</span>
              <span className="font-semibold text-foreground">
                {formatNumber(summary.totalQuantity, locale)}
              </span>{" "}
              {t("writeOffTotalQuantityShort")}
            </div>
            <div className="shrink-0 text-sm font-semibold text-foreground">
              {formatOptionalMoney(summary.totalCost)}
            </div>
          </div>
          <div className="grid grid-cols-[0.8fr_1.2fr] gap-2">
            <Button asChild variant="secondary" className="min-h-11">
              <Link href="/inventory">{tCommon("cancel")}</Link>
            </Button>
            <Button
              type="button"
              className="min-h-11"
              onClick={handlePost}
              disabled={writeOffMutation.isLoading || Boolean(validationMessage)}
            >
              {writeOffMutation.isLoading ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <ArchiveIcon className="h-4 w-4" aria-hidden />
              )}
              <span className="sm:hidden">
                {writeOffMutation.isLoading ? tCommon("saving") : t("writeOffPostShort")}
              </span>
              <span className="hidden sm:inline">
                {writeOffMutation.isLoading ? tCommon("saving") : t("writeOffPost")}
              </span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InventoryWriteOffsPage;

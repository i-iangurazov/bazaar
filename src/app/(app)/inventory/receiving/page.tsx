"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { PageHeader } from "@/components/page-header";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import {
  BackIcon,
  DeleteIcon,
  EmptyIcon,
  ReceiveIcon,
  SearchIcon,
  StatusDangerIcon,
  StatusSuccessIcon,
} from "@/components/icons";
import { formatStoreMoney } from "@/lib/currencyDisplay";
import { formatNumber } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { cn } from "@/lib/utils";

type ReceivingLine = {
  key: string;
  productId: string;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  sku: string;
  barcode: string | null;
  imageUrl: string | null;
  currentStock: number;
  unitCostInput: string;
  quantityInput: string;
  duplicateHint?: boolean;
};

const toDateTimeLocalValue = (date: Date) => {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

const parseDecimalInput = (value: string) => Number(value.replace(",", "."));
const lineKey = (productId: string, variantId?: string | null) =>
  `${productId}:${variantId ?? "BASE"}`;
const normalizeCode = (value: string | null | undefined) => value?.trim().toLowerCase() ?? "";

const InventoryReceivingPage = () => {
  const t = useTranslations("inventory");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const { toast } = useToast();
  const trpcUtils = trpc.useUtils();
  const canManageStock = session?.user?.role === "ADMIN";

  const storesQuery = trpc.stores.list.useQuery();
  type StoreRow = NonNullable<typeof storesQuery.data>[number];
  const stores: StoreRow[] = useMemo(() => storesQuery.data ?? [], [storesQuery.data]);
  const [storeId, setStoreId] = useState("");
  const [dateTime, setDateTime] = useState(() => toDateTimeLocalValue(new Date()));
  const [supplierName, setSupplierName] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<ReceivingLine[]>([]);
  const quantityRefs = useRef(new Map<string, HTMLInputElement>());

  const selectedStore = stores.find((store) => store.id === storeId) ?? null;
  const enableSku = selectedStore?.enableSku ?? true;
  const enableBarcode = selectedStore?.enableBarcode ?? true;
  const formatMoney = useCallback(
    (value: number) => formatStoreMoney(value, locale, selectedStore),
    [locale, selectedStore],
  );

  const searchQuery = trpc.inventory.searchProducts.useQuery(
    { storeId, search: search.trim() || undefined, limit: 100 },
    {
      enabled: Boolean(storeId && canManageStock),
      keepPreviousData: true,
    },
  );
  type SearchResult = NonNullable<typeof searchQuery.data>[number];

  useEffect(() => {
    if (!storeId && stores[0]) {
      setStoreId(stores[0].id);
    }
  }, [storeId, stores]);

  useEffect(() => {
    setLines([]);
    setSearch("");
  }, [storeId]);

  const getPreviewUrl = (result: SearchResult) => {
    const imageUrl = result.product.images?.[0]?.url ?? result.product.photoUrl ?? null;
    if (!imageUrl || imageUrl.startsWith("data:image/")) {
      return null;
    }
    return imageUrl;
  };

  const getDisplayName = (result: SearchResult) =>
    result.variant?.name ? `${result.product.name} • ${result.variant.name}` : result.product.name;

  const exactBarcodeMatch = useCallback(
    (result: SearchResult, rawCode: string) => {
      if (!enableBarcode) {
        return false;
      }
      const code = normalizeCode(rawCode);
      if (!code) {
        return false;
      }
      const barcodes = [
        result.primaryBarcode,
        ...result.product.barcodes.map((barcode) => barcode.value),
        ...result.product.packs.map((pack) => pack.packBarcode),
      ];
      return barcodes.some((barcode) => normalizeCode(barcode) === code);
    },
    [enableBarcode],
  );

  const focusQuantity = (key: string) => {
    window.setTimeout(() => {
      const viewportKey = window.matchMedia("(min-width: 768px)").matches ? "desktop" : "mobile";
      const input =
        quantityRefs.current.get(`${key}:${viewportKey}`) ??
        quantityRefs.current.get(`${key}:desktop`) ??
        quantityRefs.current.get(`${key}:mobile`);
      input?.focus();
    }, 0);
  };

  const clearDuplicateHint = (key: string) => {
    window.setTimeout(() => {
      setLines((current) =>
        current.map((line) => (line.key === key ? { ...line, duplicateHint: false } : line)),
      );
    }, 1800);
  };

  const addSearchResult = (result: SearchResult, mode: "manual" | "scan") => {
    const key = lineKey(result.product.id, result.snapshot.variantId);
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
          currentStock: result.snapshot.onHand,
          quantityInput: "1",
          unitCostInput: result.unitCostKgs !== null ? String(result.unitCostKgs) : "0",
        },
      ];
    });
    setSearch("");
    focusQuantity(key);
    clearDuplicateHint(key);
  };

  const handleSearchSubmit = async () => {
    if (!storeId || !search.trim()) {
      return;
    }
    try {
      const results = await trpcUtils.inventory.searchProducts.fetch({
        storeId,
        search: search.trim(),
        limit: 100,
      });
      const exact = results.find((result) => exactBarcodeMatch(result, search));
      if (exact) {
        addSearchResult(exact, "scan");
        return;
      }
      if (!results.length) {
        toast({ variant: "error", description: t("receivingProductUnavailable") });
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

  const updateLine = (key: string, patch: Partial<ReceivingLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const removeLine = (key: string) => {
    setLines((current) => current.filter((line) => line.key !== key));
  };

  const lineMetrics = useMemo(
    () =>
      lines.map((line) => {
        const quantity = parseDecimalInput(line.quantityInput);
        const unitCost = parseDecimalInput(line.unitCostInput);
        const quantityValid = Number.isInteger(quantity) && quantity > 0;
        const unitCostValid = Number.isFinite(unitCost) && unitCost >= 0;
        return {
          key: line.key,
          quantity,
          unitCost,
          quantityValid,
          unitCostValid,
          lineTotal: quantityValid && unitCostValid ? quantity * unitCost : 0,
          newStock: quantityValid ? line.currentStock + quantity : line.currentStock,
        };
      }),
    [lines],
  );

  const metricByKey = useMemo(
    () => new Map(lineMetrics.map((metric) => [metric.key, metric])),
    [lineMetrics],
  );
  const invalidQuantity = lineMetrics.some((metric) => !metric.quantityValid);
  const invalidUnitCost = lineMetrics.some((metric) => !metric.unitCostValid);
  const summary = useMemo(
    () => ({
      products: lines.length,
      totalQuantity: lineMetrics.reduce(
        (sum, metric) => sum + (metric.quantityValid ? metric.quantity : 0),
        0,
      ),
      totalCost: lineMetrics.reduce((sum, metric) => sum + metric.lineTotal, 0),
    }),
    [lineMetrics, lines.length],
  );
  const validationMessage = !storeId
    ? t("receivingValidationNoStore")
    : !lines.length
      ? t("receivingValidationNoProducts")
      : invalidQuantity
        ? t("receivingValidationInvalidQuantity")
        : invalidUnitCost
          ? t("receivingValidationInvalidUnitCost")
          : "";

  const postMutation = trpc.inventory.postStockReceiving.useMutation({
    onSuccess: async () => {
      await trpcUtils.inventory.list.invalidate();
      await trpcUtils.inventory.searchProducts.invalidate();
      toast({ variant: "success", description: t("receivingSuccess") });
      router.push("/inventory");
    },
    onError: (error) => {
      toast({
        variant: "error",
        description: translateError(tErrors, error) || t("receivingPostFailed"),
      });
    },
  });

  const handlePost = () => {
    if (validationMessage || postMutation.isLoading) {
      if (validationMessage) {
        toast({ variant: "error", description: validationMessage });
      }
      return;
    }
    const parsedDate = dateTime ? new Date(dateTime) : null;
    postMutation.mutate({
      storeId,
      date:
        parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate.toISOString() : undefined,
      supplierName: supplierName.trim() || undefined,
      referenceNumber: referenceNumber.trim() || undefined,
      note: note.trim() || undefined,
      lines: lines.map((line) => {
        const metric = metricByKey.get(line.key);
        return {
          productId: line.productId,
          variantId: line.variantId,
          quantity: metric?.quantity ?? 0,
          unitCost: metric?.unitCost ?? 0,
        };
      }),
      idempotencyKey: crypto.randomUUID(),
    });
  };

  const renderProductImage = (line: ReceivingLine) => (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden border border-border bg-muted/30">
      {line.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={line.imageUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <EmptyIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
      )}
    </span>
  );

  if (sessionStatus === "loading") {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  if (!canManageStock) {
    return (
      <div>
        <PageHeader
          title={t("stockReceiving")}
          subtitle={t("stockReceivingSubtitle")}
          action={
            <Button asChild variant="secondary">
              <Link href="/inventory">
                <BackIcon className="h-4 w-4" aria-hidden />
                {tCommon("back")}
              </Link>
            </Button>
          }
        />
        <div className="border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          {t("receivingPermissionDenied")}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-hidden pb-[15rem] md:pb-0">
      <PageHeader
        title={t("stockReceiving")}
        subtitle={t("stockReceivingSubtitle")}
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <section className="rounded-md border border-border bg-card p-4 md:p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-foreground">
                {t("receivingDetailsTitle")}
              </h3>
              <Button asChild variant="ghost" size="sm" className="md:hidden">
                <Link href="/inventory">
                  <BackIcon className="h-4 w-4" aria-hidden />
                  {tCommon("back")}
                </Link>
              </Button>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <Label>{tCommon("store")}</Label>
                <Select value={storeId} onValueChange={setStoreId}>
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
                <Label htmlFor="receiving-date">{t("receivingDate")}</Label>
                <Input
                  id="receiving-date"
                  type="datetime-local"
                  value={dateTime}
                  onChange={(event) => setDateTime(event.target.value)}
                />
              </div>
              <details className="rounded-md border border-border bg-muted/20 p-3 lg:hidden">
                <summary className="cursor-pointer text-sm font-semibold text-foreground">
                  {tCommon("additional")}
                </summary>
                <div className="mt-3 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="receiving-supplier-mobile">{t("receivingSupplier")}</Label>
                    <Input
                      id="receiving-supplier-mobile"
                      value={supplierName}
                      onChange={(event) => setSupplierName(event.target.value)}
                      placeholder={t("receivingSupplierPlaceholder")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="receiving-reference-mobile">{t("receivingReference")}</Label>
                    <Input
                      id="receiving-reference-mobile"
                      value={referenceNumber}
                      onChange={(event) => setReferenceNumber(event.target.value)}
                      placeholder={t("receivingReferencePlaceholder")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="receiving-note-mobile">{t("receivingNote")}</Label>
                    <Textarea
                      id="receiving-note-mobile"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder={t("notePlaceholder")}
                      rows={3}
                    />
                  </div>
                </div>
              </details>
              <div className="hidden space-y-2 lg:block">
                <Label htmlFor="receiving-supplier">{t("receivingSupplier")}</Label>
                <Input
                  id="receiving-supplier"
                  value={supplierName}
                  onChange={(event) => setSupplierName(event.target.value)}
                  placeholder={t("receivingSupplierPlaceholder")}
                />
              </div>
              <div className="hidden space-y-2 lg:block">
                <Label htmlFor="receiving-reference">{t("receivingReference")}</Label>
                <Input
                  id="receiving-reference"
                  value={referenceNumber}
                  onChange={(event) => setReferenceNumber(event.target.value)}
                  placeholder={t("receivingReferencePlaceholder")}
                />
              </div>
              <div className="hidden space-y-2 lg:col-span-2 lg:block">
                <Label htmlFor="receiving-note">{t("receivingNote")}</Label>
                <Textarea
                  id="receiving-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t("notePlaceholder")}
                  rows={3}
                />
              </div>
            </div>
          </section>

          <section className="rounded-md border border-border bg-card p-4">
            <div className="mb-4">
              <h3 className="text-base font-semibold text-foreground">
                {t("receivingSearchTitle")}
              </h3>
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
                placeholder={t("receivingSearchPlaceholderShort")}
                disabled={!storeId}
                className="pl-9"
                autoComplete="off"
              />
            </div>
            <div className="mt-3 max-h-72 overflow-y-auto border border-border bg-background">
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
                    <button
                      key={key}
                      type="button"
                      className="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => addSearchResult(result, "manual")}
                      disabled={!storeId}
                    >
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden bg-muted/30">
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
                        <span className="block text-xs text-muted-foreground lg:hidden">
                          {t("onHand")}: {formatNumber(result.snapshot.onHand, locale)}
                        </span>
                        <span className="hidden truncate text-xs text-muted-foreground lg:block">
                          {t("onHand")}: {formatNumber(result.snapshot.onHand, locale)}
                          {result.unitCostKgs !== null
                            ? ` • ${t("unitCost")}: ${formatMoney(result.unitCostKgs)}`
                            : ""}
                          {result.priceKgs !== null
                            ? ` • ${t("price")}: ${formatMoney(result.priceKgs)}`
                            : ""}
                        </span>
                      </span>
                      {added ? <Badge variant="success">{t("receivingAdded")}</Badge> : null}
                    </button>
                  );
                })
              ) : (
                <div className="px-3 py-3 text-sm text-muted-foreground">
                  {storeId ? t("productSearchEmpty") : t("receivingValidationNoStore")}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-md border border-border bg-card p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-foreground">
                {t("receivingTableTitle")}
              </h3>
              <Badge variant={validationMessage ? "warning" : "success"}>
                {validationMessage || t("receivingValidationReady")}
              </Badge>
            </div>

            {lines.length ? (
              <>
                <div className="hidden overflow-x-auto lg:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tCommon("product")}</TableHead>
                        <TableHead className="w-32">{t("receiveQty")}</TableHead>
                        <TableHead className="w-40">{t("unitCost")}</TableHead>
                        <TableHead>{t("receivingLineTotal")}</TableHead>
                        <TableHead>{t("receivingNewStock")}</TableHead>
                        <TableHead className="w-14 text-right">{tCommon("actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lines.map((line) => {
                        const metric = metricByKey.get(line.key);
                        return (
                          <TableRow key={line.key}>
                            <TableCell>
                              <div className="flex min-w-64 items-center gap-3">
                                {renderProductImage(line)}
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-foreground">
                                    {line.variantName
                                      ? `${line.productName} • ${line.variantName}`
                                      : line.productName}
                                  </p>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {[
                                      enableSku ? line.sku : "",
                                      enableBarcode ? line.barcode : "",
                                    ]
                                      .filter(Boolean)
                                      .join(" • ") ||
                                      tCommon("notAvailable")}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {t("onHand")}: {formatNumber(line.currentStock, locale)}
                                  </p>
                                  {line.duplicateHint ? (
                                    <p className="text-xs text-warning">
                                      {t("receivingDuplicateHint")}
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Input
                                ref={(node) => {
                                  if (node) {
                                    quantityRefs.current.set(`${line.key}:desktop`, node);
                                  } else {
                                    quantityRefs.current.delete(`${line.key}:desktop`);
                                  }
                                }}
                                value={line.quantityInput}
                                onChange={(event) =>
                                  updateLine(line.key, { quantityInput: event.target.value })
                                }
                                type="number"
                                inputMode="numeric"
                                min={1}
                                step={1}
                                className={cn(!metric?.quantityValid && "border-danger/60")}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                value={line.unitCostInput}
                                onChange={(event) =>
                                  updateLine(line.key, { unitCostInput: event.target.value })
                                }
                                type="number"
                                inputMode="decimal"
                                min={0}
                                step="0.01"
                                className={cn(!metric?.unitCostValid && "border-danger/60")}
                              />
                            </TableCell>
                            <TableCell>{formatMoney(metric?.lineTotal ?? 0)}</TableCell>
                            <TableCell>
                              {formatNumber(metric?.newStock ?? line.currentStock, locale)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={t("receivingRemoveLine")}
                                onClick={() => removeLine(line.key)}
                              >
                                <DeleteIcon className="h-4 w-4" aria-hidden />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="space-y-3 lg:hidden">
                  {lines.map((line) => {
                    const metric = metricByKey.get(line.key);
                    return (
                      <div key={line.key} className="rounded-md border border-border bg-background p-3">
                        <div className="flex items-start gap-3">
                          {renderProductImage(line)}
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-foreground">
                              {line.variantName
                                ? `${line.productName} • ${line.variantName}`
                                : line.productName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {[enableSku ? line.sku : "", enableBarcode ? line.barcode : ""]
                                .filter(Boolean)
                                .join(" • ") ||
                                tCommon("notAvailable")}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {t("onHand")}: {formatNumber(line.currentStock, locale)}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t("receivingRemoveLine")}
                            onClick={() => removeLine(line.key)}
                          >
                            <DeleteIcon className="h-4 w-4" aria-hidden />
                          </Button>
                        </div>
                        {line.duplicateHint ? (
                          <p className="mt-2 text-xs text-warning">{t("receivingDuplicateHint")}</p>
                        ) : null}
                        <div className="mt-3 grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label>{t("receiveQty")}</Label>
                            <Input
                              ref={(node) => {
                                if (node) {
                                  quantityRefs.current.set(`${line.key}:mobile`, node);
                                } else {
                                  quantityRefs.current.delete(`${line.key}:mobile`);
                                }
                              }}
                              value={line.quantityInput}
                              onChange={(event) =>
                                updateLine(line.key, { quantityInput: event.target.value })
                              }
                              type="number"
                              inputMode="numeric"
                              min={1}
                              step={1}
                              className={cn(!metric?.quantityValid && "border-danger/60")}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label>{t("unitCost")}</Label>
                            <Input
                              value={line.unitCostInput}
                              onChange={(event) =>
                                updateLine(line.key, { unitCostInput: event.target.value })
                              }
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step="0.01"
                              className={cn(!metric?.unitCostValid && "border-danger/60")}
                            />
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <p className="text-xs text-muted-foreground">
                              {t("receivingLineTotal")}
                            </p>
                            <p className="font-medium text-foreground">
                              {formatMoney(metric?.lineTotal ?? 0)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">
                              {t("receivingNewStock")}
                            </p>
                            <p className="font-medium text-foreground">
                              {formatNumber(metric?.newStock ?? line.currentStock, locale)}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="border border-dashed border-border bg-background p-8 text-center text-sm text-muted-foreground">
                <EmptyIcon className="mx-auto mb-3 h-8 w-8" aria-hidden />
                {t("receivingEmptyState")}
              </div>
            )}
          </section>
        </div>

        <aside className="hidden md:block xl:sticky xl:top-4 xl:self-start">
          <div className="rounded-md border border-border bg-card p-4">
            <h3 className="text-base font-semibold text-foreground">
              {t("receivingSummaryTitle")}
            </h3>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{tCommon("store")}</dt>
                <dd className="text-right font-medium text-foreground">
                  {selectedStore?.name ?? tCommon("notAvailable")}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{t("receivingProductsCount")}</dt>
                <dd className="font-medium text-foreground">
                  {formatNumber(summary.products, locale)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{t("receivingTotalQuantity")}</dt>
                <dd className="font-medium text-foreground">
                  {formatNumber(summary.totalQuantity, locale)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{t("receivingTotalCost")}</dt>
                <dd className="font-medium text-foreground">{formatMoney(summary.totalCost)}</dd>
              </div>
            </dl>
            <div
              className={cn(
                "mt-4 flex items-start gap-2 border px-3 py-2 text-sm",
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
              <span>{validationMessage || t("receivingValidationReady")}</span>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <Button asChild variant="secondary">
                <Link href="/inventory">{tCommon("cancel")}</Link>
              </Button>
              <Button
                type="button"
                onClick={handlePost}
                disabled={postMutation.isLoading || Boolean(validationMessage)}
              >
                {postMutation.isLoading ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <ReceiveIcon className="h-4 w-4" aria-hidden />
                )}
                {postMutation.isLoading ? tCommon("saving") : t("receivingPost")}
              </Button>
            </div>
          </div>
        </aside>
      </div>
      <div className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-40 border-t border-border bg-card p-2.5 shadow-2xl md:hidden">
        <div className="mx-auto max-w-screen-sm space-y-2 pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <div className="min-w-0">
              <span className="font-semibold text-foreground">
                {formatNumber(summary.products, locale)}
              </span>{" "}
              {t("receivingProductsCountShort")}
              <span className="px-1 text-muted-foreground/60">·</span>
              <span className="font-semibold text-foreground">
                {formatNumber(summary.totalQuantity, locale)}
              </span>{" "}
              {t("receivingTotalQuantityShort")}
            </div>
            <div className="shrink-0 text-sm font-semibold text-foreground">
              {formatMoney(summary.totalCost)}
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
              disabled={postMutation.isLoading || Boolean(validationMessage)}
            >
              {postMutation.isLoading ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <ReceiveIcon className="h-4 w-4" aria-hidden />
              )}
              <span className="sm:hidden">
                {postMutation.isLoading ? tCommon("saving") : t("receivingPostShort")}
              </span>
              <span className="hidden sm:inline">
                {postMutation.isLoading ? tCommon("saving") : t("receivingPost")}
              </span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InventoryReceivingPage;

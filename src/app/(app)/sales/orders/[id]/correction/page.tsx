"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { PosPaymentMethod } from "@prisma/client";

import { DeleteIcon, EmptyIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { ProductSearchResultItem } from "@/components/product-search-result-item";
import { QueryErrorState } from "@/components/query-error-state";
import { ScanInput } from "@/components/ScanInput";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PriceInput } from "@/components/ui/price-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  validateCorrectionDraft,
  type CorrectionAdditionQtyError,
  type CorrectionAdditionPriceError,
  type CorrectionReturnError,
} from "@/lib/correctionDraftValidation";
import { formatKgsMoney, currencySourceWithFallback } from "@/lib/currencyDisplay";
import { parseQuantity, roundQuantity } from "@/lib/quantity";
import { resolveSafeReturnTo } from "@/lib/safeReturnTo";
import { salesOrderPriceInput } from "@/lib/salesOrderPriceInput";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { useDebouncedValue } from "@/lib/use-debounced-value";

type AdditionState = {
  key: string;
  productId: string;
  variantId: string | null;
  name: string;
  sku: string;
  qtyInput: string;
  priceInput: string;
  priceEdited: boolean;
  onHand: number | null;
};

const money = (
  value: number,
  locale: string,
  currency: ReturnType<typeof currencySourceWithFallback>,
) =>
  formatKgsMoney(value, locale, currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function SalesOrderCorrectionPage() {
  const t = useTranslations("salesOrders");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const orderId = String(params.id ?? "");
  const returnTo = resolveSafeReturnTo(searchParams.get("returnTo"), `/sales/orders/${orderId}`);
  const utils = trpc.useUtils();

  const orderQuery = trpc.salesOrders.getById.useQuery(
    { customerOrderId: orderId },
    { retry: false },
  );
  const [returnQty, setReturnQty] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [additions, setAdditions] = useState<AdditionState[]>([]);
  const additionsRef = useRef(additions);
  additionsRef.current = additions;
  const priceModeRevisionRef = useRef(0);
  const [priceModeRepricing, setPriceModeRepricing] = useState(false);
  const [priceModeError, setPriceModeError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>(PosPaymentMethod.CASH);
  const [priceMode, setPriceMode] = useState<"RETAIL" | "WHOLESALE" | null>(null);
  const initializedOrderRef = useRef<string | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim(), 250);
  const [pendingQty, setPendingQty] = useState("1");
  const [adding, setAdding] = useState(false);
  const idempotencyRef = useRef<{ payload: string; key: string } | null>(null);
  const order = orderQuery.data;
  const effectivePriceMode: "RETAIL" | "WHOLESALE" =
    priceMode ?? (order?.priceMode === "WHOLESALE" ? "WHOLESALE" : "RETAIL");
  const currency = order ? currencySourceWithFallback(order, order.store) : undefined;

  const validation = useMemo(
    () =>
      validateCorrectionDraft({
        returns:
          order?.lines.map((line) => {
            const returned = line.saleReturnLines?.reduce((sum, row) => sum + row.qty, 0) ?? 0;
            return {
              lineId: line.id,
              qtyInput: returnQty[line.id] ?? "",
              availableQty: roundQuantity(line.qty - returned),
              restock: restock[line.id] !== false,
            };
          }) ?? [],
        additions: additions.map((line) => ({
          key: line.key,
          productId: line.productId,
          variantId: line.variantId,
          qtyInput: line.qtyInput,
          priceInput: line.priceInput,
          priceEdited: line.priceEdited,
        })),
        currency,
      }),
    [order, returnQty, restock, additions, currency],
  );
  const { returnLines, additionLines, returnErrors, additionErrors, hasErrors } = validation;
  const [retailWholesaleEnabled, setRetailWholesaleEnabled] = useState<boolean | null>(null);

  const quoteQuery = trpc.salesOrders.correctionQuote.useQuery(
    {
      originalOrderId: orderId,
      priceMode: effectivePriceMode,
      returns: returnLines,
      additions: additionLines,
    },
    { enabled: Boolean(order) && !hasErrors, keepPreviousData: true, retry: false },
  );
  const quote = quoteQuery.data;

  useEffect(() => {
    if (quote) setRetailWholesaleEnabled(quote.retailWholesaleEnabled);
  }, [quote]);

  useEffect(() => {
    if (!order || initializedOrderRef.current === order.id) return;
    initializedOrderRef.current = order.id;
    setPriceMode(order.priceMode === "WHOLESALE" ? "WHOLESALE" : "RETAIL");
  }, [order]);

  const productSearch = trpc.products.searchQuick.useQuery(
    { q: debouncedSearch, storeId: order?.storeId, limit: 30 },
    { enabled: Boolean(order?.storeId) && debouncedSearch.length >= 1 },
  );

  const addProduct = async (product: { id: string; name: string; sku: string }) => {
    if (!order || adding || priceModeRepricing) return;
    const qty = parseQuantity(pendingQty) ?? 0;
    if (qty <= 0) {
      toast({ variant: "error", description: t("qtyPositive") });
      return;
    }
    setAdding(true);
    try {
      const price = await utils.salesOrders.linePrice.fetch({
        storeId: order.storeId,
        productId: product.id,
        priceMode: effectivePriceMode,
      });
      setAdditions((current) => [
        ...current,
        {
          key: `${product.id}:${Date.now()}`,
          productId: product.id,
          variantId: null,
          name: product.name,
          sku: product.sku,
          qtyInput: String(qty),
          priceInput: price.hasConfiguredPrice
            ? salesOrderPriceInput(price.unitPriceKgs, currency)
            : "",
          priceEdited: false,
          onHand: null,
        },
      ]);
      setSearch("");
      setPendingQty("1");
    } catch (error) {
      toast({
        variant: "error",
        description: translateError(tErrors, error as Parameters<typeof translateError>[1]),
      });
    } finally {
      setAdding(false);
    }
  };

  const changeCorrectionPriceMode = async (next: "RETAIL" | "WHOLESALE") => {
    if (next === effectivePriceMode || adding) return;
    const previousMode = effectivePriceMode;
    setPriceMode(next);
    setPriceModeError(null);
    if (!order || !additionsRef.current.length) {
      setPriceModeRepricing(false);
      return;
    }
    const revision = ++priceModeRevisionRef.current;
    const snapshot = additionsRef.current.filter((line) => !line.priceEdited);
    setPriceModeRepricing(true);
    try {
      const refreshed = await Promise.all(
        snapshot.map(async (line) => {
          const price = await utils.salesOrders.linePrice.fetch({
            storeId: order.storeId,
            productId: line.productId,
            priceMode: next,
          });
          return {
            key: line.key,
            priceInput: price.hasConfiguredPrice
              ? salesOrderPriceInput(price.unitPriceKgs, currency)
              : "",
          };
        }),
      );
      // A later mode switch owns the UI now. Discard this stale response.
      if (revision !== priceModeRevisionRef.current) return;
      const byKey = new Map(refreshed.map((item) => [item.key, item]));
      setAdditions((current) =>
        current.map((line) => {
          if (line.priceEdited) return line;
          const updated = byKey.get(line.key);
          return updated ? { ...line, priceInput: updated.priceInput } : line;
        }),
      );
    } catch (error) {
      if (revision !== priceModeRevisionRef.current) return;
      // Do not leave an old price set silently under the new mode.
      setPriceMode(previousMode);
      setPriceModeError(t("correctionPage.priceModeError"));
    } finally {
      if (revision === priceModeRevisionRef.current) setPriceModeRepricing(false);
    }
  };

  const updateReturn = (lineId: string, value: string) => {
    // Keep the raw draft. Validation reports an error instead of silently
    // clamping or clearing what the user typed.
    setReturnQty((current) => ({ ...current, [lineId]: value }));
  };

  const correctMutation = trpc.salesOrders.correct.useMutation({
    onSuccess: (result) => {
      idempotencyRef.current = null;
      toast({
        variant: "success",
        description: t("correctionPage.success", { number: result.correctionNumber }),
      });
      if (result.manualRefundRequired) {
        toast({ variant: "info", description: t("correctionPage.manualRefund") });
      }
      router.push(`/sales/orders/${orderId}?returnTo=${encodeURIComponent(returnTo)}`);
      void utils.salesOrders.getById.invalidate({ customerOrderId: orderId });
      void utils.salesOrders.list.invalidate();
    },
    onError: (error) => {
      if (error.message.includes("salesOrderCorrectionChanged")) {
        void quoteQuery.refetch();
        toast({ variant: "error", description: t("correctionPage.changed") });
        return;
      }
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const returnErrorText = (error: CorrectionReturnError, available: number) =>
    error === "qtyExceedsAvailable"
      ? t("correctionPage.qtyExceedsAvailable", { available })
      : t(`correctionPage.${error}`);

  const additionQtyErrorText = (error: CorrectionAdditionQtyError) => t(`correctionPage.${error}`);

  const additionPriceErrorText = (error: CorrectionAdditionPriceError) =>
    t(`correctionPage.${error}`);

  const firstErrorInputId = () => {
    const returnLine = order?.lines.find((line) => returnErrors[line.id]);
    if (returnLine) return `return-${returnLine.id}`;
    const additionQty = additions.find((line) => additionErrors[line.key]?.qty);
    if (additionQty) return `addition-qty-${additionQty.key}`;
    const additionPrice = additions.find((line) => additionErrors[line.key]?.price);
    if (additionPrice) return `addition-price-${additionPrice.key}`;
    return null;
  };

  const submit = async () => {
    if (!order) return;
    if (hasErrors) {
      toast({ variant: "error", description: t("correctionPage.fixErrors") });
      const errorInput = firstErrorInputId();
      if (errorInput) document.getElementById(errorInput)?.focus();
      return;
    }
    if (!quote) return;
    if (!returnLines.length && !additionLines.length) {
      toast({ variant: "error", description: t("correctionPage.empty") });
      return;
    }
    if (!reason.trim()) {
      toast({ variant: "error", description: t("correctionPage.reasonRequired") });
      return;
    }
    if (!shiftId) {
      toast({ variant: "error", description: t("correctionPage.noShift") });
      return;
    }
    const pendingPayout = quote.refundKgs > 0 && paymentMethod === PosPaymentMethod.TRANSFER;
    const difference =
      quote.refundKgs > 0
        ? pendingPayout
          ? t("correctionPage.toRefundPending")
          : t("correctionPage.toRefund")
        : quote.chargeKgs > 0
          ? t("correctionPage.toPay")
          : t("correctionPage.noDifference");
    const differenceText = `${difference}: ${money(Math.max(quote.refundKgs, quote.chargeKgs), locale, currency)}`;
    const confirmed = await confirm({
      title: t("correctionPage.confirmTitle"),
      description: pendingPayout
        ? t("correctionPage.confirmDescriptionPending", { difference: differenceText })
        : t("correctionPage.confirmDescription", { difference: differenceText }),
      confirmLabel: t("correctionPage.confirm"),
    });
    if (!confirmed) return;
    const payload = {
      originalOrderId: orderId,
      expectedFingerprint: quote.fingerprint,
      reason: reason.trim(),
      notes: notes.trim() || null,
      priceMode: effectivePriceMode,
      returns: returnLines,
      additions: additionLines,
      shiftId,
      paymentMethod,
    };
    const serialized = JSON.stringify(payload);
    const key =
      idempotencyRef.current?.payload === serialized
        ? idempotencyRef.current.key
        : crypto.randomUUID();
    idempotencyRef.current = { payload: serialized, key };
    await correctMutation.mutateAsync({ ...payload, idempotencyKey: key }).catch(() => {});
  };

  if (orderQuery.isLoading) {
    return (
      <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Spinner className="h-4 w-4" />
        {tCommon("loading")}
      </div>
    );
  }
  if (orderQuery.error || !order) {
    return <QueryErrorState error={orderQuery.error} onRetry={() => void orderQuery.refetch()} />;
  }
  if (order.status !== "COMPLETED") {
    return (
      <p role="alert" className="mt-4 rounded-md border border-danger/30 p-4 text-sm text-danger">
        {t("correctionPage.requiresCompleted")}
      </p>
    );
  }
  if (session?.user?.role !== "ADMIN" && session?.user?.role !== "MANAGER") {
    return (
      <p role="alert" className="mt-4 rounded-md border border-danger/30 p-4 text-sm text-danger">
        {t("correctionPage.forbidden")}
      </p>
    );
  }

  const maxDifference = Math.max(quote?.refundKgs ?? 0, quote?.chargeKgs ?? 0);
  const exchangeOffsetKgs = Math.min(quote?.returnedKgs ?? 0, quote?.addedKgs ?? 0);
  const pendingPayout =
    Boolean(quote && quote.refundKgs > 0) && paymentMethod === PosPaymentMethod.TRANSFER;

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title={t("correctionPage.title", { number: order.number })}
        subtitle={t("correctionPage.subtitle")}
        action={
          <Button variant="secondary" onClick={() => router.push(returnTo)}>
            {tCommon("back")}
          </Button>
        }
      />

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("correctionPage.returnsTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">{t("correctionPage.restockHint")}</p>
              {order.lines.map((line) => {
                const returned = line.saleReturnLines?.reduce((sum, row) => sum + row.qty, 0) ?? 0;
                const available = roundQuantity(line.qty - returned);
                const value = returnQty[line.id] ?? "";
                const selectedQty = parseQuantity(value) ?? 0;
                const qtyError = returnErrors[line.id];
                const errorId = `return-error-${line.id}`;
                return (
                  <div
                    key={line.id}
                    className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-[minmax(0,1fr)_6rem_auto] md:items-center"
                    data-testid="correction-return-line"
                  >
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium">{line.product.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {line.product.sku} · {t("correctionPage.available")}: {available}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {money(Number(line.unitPriceKgs), locale, currency)} × {line.qty}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`return-${line.id}`} className="text-xs">
                        {t("correctionPage.returnQty")}
                      </Label>
                      <Input
                        id={`return-${line.id}`}
                        inputMode="decimal"
                        value={value}
                        disabled={available <= 0}
                        aria-invalid={Boolean(qtyError)}
                        aria-describedby={qtyError ? errorId : undefined}
                        onChange={(event) => updateReturn(line.id, event.target.value)}
                        className="h-10"
                      />
                      {qtyError ? (
                        <p id={errorId} role="alert" className="text-xs text-danger">
                          {returnErrorText(qtyError, available)}
                        </p>
                      ) : null}
                    </div>
                    <label className="flex min-h-10 items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={selectedQty > 0 && restock[line.id] !== false}
                        disabled={available <= 0 || selectedQty <= 0}
                        onChange={(event) =>
                          setRestock((current) => ({ ...current, [line.id]: event.target.checked }))
                        }
                      />
                      {t("correctionPage.restock")}
                    </label>
                  </div>
                );
              })}
              {!order.lines.length ? (
                <div className="bazaar-admin-empty">
                  <EmptyIcon className="h-4 w-4" aria-hidden />
                  {t("correctionPage.noReturns")}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("correctionPage.additionsTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_auto]">
                <div className="space-y-1">
                  <Label htmlFor="correction-product-search">
                    {t("correctionPage.addProduct")}
                  </Label>
                  <ScanInput
                    context="linePicker"
                    storeId={order.storeId}
                    value={search}
                    onValueChange={setSearch}
                    placeholder={t("correctionPage.addProductPlaceholder")}
                    ariaLabel={t("correctionPage.addProductPlaceholder")}
                    showDropdown={false}
                    enableProductSearch={false}
                    disabled={priceModeRepricing}
                    onResolved={(resolved) => {
                      if (resolved.kind === "exact") {
                        void addProduct(resolved.item);
                        return true;
                      }
                      if (resolved.kind === "notFound") {
                        toast({ variant: "info", description: tCommon("nothingFound") });
                      }
                      return false;
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="correction-add-qty">{t("qty")}</Label>
                  <Input
                    id="correction-add-qty"
                    inputMode="decimal"
                    value={pendingQty}
                    disabled={priceModeRepricing}
                    onChange={(event) => setPendingQty(event.target.value)}
                  />
                </div>
              </div>
              {retailWholesaleEnabled === null ? null : retailWholesaleEnabled ? (
                <div className="space-y-1" data-testid="correction-price-mode">
                  <Label htmlFor="correction-price-mode">{t("correctionPage.priceMode")}</Label>
                  <Select
                    value={effectivePriceMode}
                    disabled={adding || priceModeRepricing}
                    onValueChange={(value) =>
                      void changeCorrectionPriceMode(value === "WHOLESALE" ? "WHOLESALE" : "RETAIL")
                    }
                  >
                    <SelectTrigger id="correction-price-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="RETAIL">{t("priceMode.retail")}</SelectItem>
                      <SelectItem value="WHOLESALE">{t("priceMode.wholesale")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {t("correctionPage.priceModeHint")}
                  </p>
                  {priceModeRepricing ? (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                      <Spinner className="h-3.5 w-3.5" />
                      {t("correctionPage.priceModeRepricing")}
                    </p>
                  ) : null}
                  {priceModeError ? (
                    <p
                      className="text-xs text-danger"
                      role="alert"
                      data-testid="correction-price-mode-error"
                    >
                      {priceModeError}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="correction-price-mode-disabled"
                >
                  {t("correctionPage.priceModeUnavailable")}
                </p>
              )}
              {search.trim().length >= 1 ? (
                <div className="max-h-64 overflow-y-auto rounded-md border border-border">
                  {productSearch.isLoading ? (
                    <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                      <Spinner className="h-4 w-4" />
                      {tCommon("loading")}
                    </div>
                  ) : productSearch.data?.length ? (
                    productSearch.data.map((product) => (
                      <ProductSearchResultItem
                        key={product.id}
                        product={product}
                        currencySource={currency}
                        wrapName
                        onMouseDown={(event) => event.preventDefault()}
                        disabled={adding || priceModeRepricing}
                        onClick={() => void addProduct(product)}
                      />
                    ))
                  ) : (
                    <p className="p-3 text-sm text-muted-foreground">{tCommon("nothingFound")}</p>
                  )}
                </div>
              ) : null}
              {additions.length ? (
                <div className="space-y-2">
                  {additions.map((line) => {
                    const errors = additionErrors[line.key] ?? {};
                    const qtyErrorId = `addition-qty-error-${line.key}`;
                    const priceErrorId = `addition-price-error-${line.key}`;
                    return (
                      <div
                        key={line.key}
                        className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-[minmax(0,1fr)_7rem_7rem_2.5rem] md:items-end"
                        data-testid="correction-addition-line"
                      >
                        <div className="min-w-0">
                          <p className="break-words text-sm font-medium">{line.name}</p>
                          <p className="text-xs text-muted-foreground">{line.sku}</p>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`addition-qty-${line.key}`} className="text-xs">
                            {t("qty")}
                          </Label>
                          <Input
                            id={`addition-qty-${line.key}`}
                            inputMode="decimal"
                            value={line.qtyInput}
                            aria-invalid={Boolean(errors.qty)}
                            aria-describedby={errors.qty ? qtyErrorId : undefined}
                            onChange={(event) =>
                              setAdditions((current) =>
                                current.map((row) =>
                                  row.key === line.key
                                    ? { ...row, qtyInput: event.target.value }
                                    : row,
                                ),
                              )
                            }
                          />
                          {errors.qty ? (
                            <p id={qtyErrorId} role="alert" className="text-xs text-danger">
                              {additionQtyErrorText(errors.qty)}
                            </p>
                          ) : null}
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`addition-price-${line.key}`} className="text-xs">
                            {t("correctionPage.price")}
                          </Label>
                          <PriceInput
                            id={`addition-price-${line.key}`}
                            value={line.priceInput}
                            aria-invalid={Boolean(errors.price)}
                            aria-describedby={errors.price ? priceErrorId : undefined}
                            onChange={(event) =>
                              setAdditions((current) =>
                                current.map((row) =>
                                  row.key === line.key
                                    ? {
                                        ...row,
                                        priceInput: event.target.value,
                                        priceEdited: true,
                                      }
                                    : row,
                                ),
                              )
                            }
                          />
                          {errors.price ? (
                            <p id={priceErrorId} role="alert" className="text-xs text-danger">
                              {additionPriceErrorText(errors.price)}
                            </p>
                          ) : null}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t("correctionPage.remove")}
                          onClick={() =>
                            setAdditions((current) => current.filter((row) => row.key !== line.key))
                          }
                        >
                          <DeleteIcon className="h-4 w-4 text-danger" aria-hidden />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                  {t("correctionPage.noAdditions")}
                </p>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="correction-reason">{t("correctionPage.reason")}</Label>
                  <Input
                    id="correction-reason"
                    value={reason}
                    maxLength={500}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder={t("correctionPage.reasonPlaceholder")}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="correction-notes">{t("correctionPage.notes")}</Label>
                  <Textarea
                    id="correction-notes"
                    value={notes}
                    rows={2}
                    maxLength={2000}
                    onChange={(event) => setNotes(event.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-4 xl:sticky xl:top-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("correctionPage.preview")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {quoteQuery.error ? (
                <QueryErrorState
                  error={quoteQuery.error}
                  onRetry={() => void quoteQuery.refetch()}
                />
              ) : null}
              {quoteQuery.isFetching && !quote ? (
                <div
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                  role="status"
                >
                  <Spinner className="h-4 w-4" />
                  {t("correctionPage.loadingPreview")}
                </div>
              ) : null}
              {hasErrors ? (
                <p
                  role="alert"
                  className="rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-danger"
                  data-testid="correction-preview-incomplete"
                >
                  {t("correctionPage.previewIncomplete")}
                </p>
              ) : (
                <>
                  <div className="space-y-1 text-sm">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t("correctionPage.previousOnOrder")}
                    </p>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{t("correctionPage.paid")}</span>
                      <span className="tabular-nums">
                        {money(quote?.money.paidKgs ?? 0, locale, currency)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">
                        {t("correctionPage.returnedPreviously")}
                      </span>
                      <span className="tabular-nums">
                        {money(quote?.money.returnedKgs ?? 0, locale, currency)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">
                        {t("correctionPage.actualRefunded")}
                      </span>
                      <span className="tabular-nums">
                        {money(quote?.money.actualRefundedKgs ?? 0, locale, currency)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">
                        {t("correctionPage.pendingPayout")}
                      </span>
                      <span
                        className={
                          (quote?.money.pendingRefundKgs ?? 0) > 0
                            ? "font-medium tabular-nums text-warning"
                            : "tabular-nums"
                        }
                      >
                        {money(quote?.money.pendingRefundKgs ?? 0, locale, currency)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">
                        {t("correctionPage.offsetApplied")}
                      </span>
                      <span className="tabular-nums">
                        {money(quote?.money.offsetKgs ?? 0, locale, currency)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{t("correctionPage.remaining")}</span>
                      <span className="tabular-nums">
                        {money(quote?.money.netPaidKgs ?? 0, locale, currency)}
                      </span>
                    </div>
                    <p className="border-t border-border pt-2 text-xs font-medium text-muted-foreground">
                      {t("correctionPage.thisCorrection")}
                    </p>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">
                        {t("correctionPage.returnedTotal")}
                      </span>
                      <span className="tabular-nums">
                        {money(quote?.returnedKgs ?? 0, locale, currency)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">
                        {t("correctionPage.addedTotal")}
                      </span>
                      <span className="tabular-nums">
                        {money(quote?.addedKgs ?? 0, locale, currency)}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">
                      {t("correctionPage.difference")}
                    </p>
                    <p className="text-lg font-semibold tabular-nums">
                      {quote?.refundKgs
                        ? pendingPayout
                          ? t("correctionPage.toRefundPending")
                          : t("correctionPage.toRefund")
                        : quote?.chargeKgs
                          ? t("correctionPage.toPay")
                          : t("correctionPage.noDifference")}
                      {maxDifference > 0 ? `: ${money(maxDifference, locale, currency)}` : ""}
                    </p>
                    {pendingPayout ? (
                      <p className="mt-1 text-xs text-warning">
                        {t("correctionPage.pendingPayoutHint")}
                      </p>
                    ) : null}
                    {exchangeOffsetKgs > 0 ? (
                      <p
                        className="mt-1 text-xs text-muted-foreground"
                        data-testid="correction-exchange-offset"
                      >
                        {t("correctionPage.currentExchangeOffset", {
                          amount: money(exchangeOffsetKgs, locale, currency),
                        })}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t("correctionPage.stockImpact")}
                    </p>
                    <div className="text-xs">
                      {quote && quote.returns.length === 0 && quote.additions.length === 0 ? (
                        <p className="text-muted-foreground">
                          {t("correctionPage.noStockChanges")}
                        </p>
                      ) : null}
                      {quote?.returns.map((line) => (
                        <span key={line.lineId} className="block">
                          {line.restock
                            ? t("correctionPage.stockReturn", { qty: line.selectedQty })
                            : t("correctionPage.stockNoReturn", { qty: line.selectedQty })}{" "}
                          · {line.productName}
                        </span>
                      ))}
                      {quote?.additions.map((line) => (
                        <span
                          key={`${line.productId}:${line.variantId ?? "BASE"}`}
                          className="block"
                        >
                          {t("correctionPage.stockSale", { qty: line.qty })} · {line.productName}
                        </span>
                      ))}
                    </div>
                  </div>
                  {quote && (!quote.retailWholesaleEnabled || !quote.openShifts.length) ? (
                    <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
                      {!quote.retailWholesaleEnabled ? (
                        <p>{t("correctionPage.priceModeUnavailable")}</p>
                      ) : null}
                      {!quote.openShifts.length ? <p>{t("correctionPage.noShift")}</p> : null}
                    </div>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>

          <Card data-testid="correction-settlement">
            <CardHeader>
              <CardTitle>{t("correctionPage.settlement")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="correction-shift">{t("correctionPage.shift")}</Label>
                <Select value={shiftId} onValueChange={setShiftId}>
                  <SelectTrigger id="correction-shift">
                    <SelectValue placeholder={t("correctionPage.shiftPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(quote?.openShifts ?? []).map((shift) => (
                      <SelectItem key={shift.id} value={shift.id}>
                        {shift.registerName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {quote && !quote.openShifts.length ? (
                  <p className="text-xs text-danger">{t("correctionPage.noShift")}</p>
                ) : null}
              </div>
              <div className="space-y-1">
                <Label htmlFor="correction-payment">{t("correctionPage.paymentMethod")}</Label>
                <Select
                  value={paymentMethod}
                  onValueChange={(value) => setPaymentMethod(value as PosPaymentMethod)}
                >
                  <SelectTrigger id="correction-payment">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">{t("correctionPage.paymentCash")}</SelectItem>
                    <SelectItem value="CARD">{t("correctionPage.paymentCard")}</SelectItem>
                    <SelectItem value="TRANSFER">{t("correctionPage.paymentTransfer")}</SelectItem>
                    <SelectItem value="OTHER">{t("correctionPage.paymentOther")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                className="w-full"
                disabled={
                  correctMutation.isLoading ||
                  hasErrors ||
                  priceModeRepricing ||
                  Boolean(priceModeError) ||
                  !quote ||
                  !shiftId ||
                  (!returnLines.length && !additionLines.length)
                }
                onClick={() => void submit()}
                data-testid="correction-confirm"
              >
                {correctMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                {t("correctionPage.confirm")}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}

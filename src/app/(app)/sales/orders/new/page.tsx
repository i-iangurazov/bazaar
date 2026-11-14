"use client";
import { parseQuantity, roundQuantity } from "@/lib/quantity";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";

import { AddIcon, DeleteIcon } from "@/components/icons";
import { FormGrid } from "@/components/form-layout";
import { resolveSafeReturnTo } from "@/lib/safeReturnTo";
import { PageHeader } from "@/components/page-header";
import { ProductSearchResultItem } from "@/components/product-search-result-item";
import { SalesOrderReturnRedirect } from "@/components/sales-order-return-redirect";
import {
  SalesOrderCustomerSelect,
  type SalesOrderCustomerOption,
} from "@/components/sales-order-customer-select";
import { QueryErrorState } from "@/components/query-error-state";
import { ScanInput } from "@/components/ScanInput";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PriceInput } from "@/components/ui/price-input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { formatKgsMoney, resolveCurrency } from "@/lib/currencyDisplay";
import {
  parseSalesOrderPriceInput,
  salesOrderLineTotal,
  salesOrderPriceInput,
} from "@/lib/salesOrderPriceInput";
import {
  isValidOptionalCustomerAddress,
  isValidOptionalCustomerPhone,
} from "@/lib/customerContact";
import { translateError } from "@/lib/translateError";
import { trpc } from "@/lib/trpc";
import type { ScanResolvedResult } from "@/lib/scanning/scanRouter";
import { resolveLegacySalesReturnRedirect } from "@/lib/salesOrderReturnRoute";

type ProductSearchResult = {
  id: string;
  name: string;
  sku: string;
  isBundle?: boolean;
};

type DraftLine = {
  productId: string;
  productName: string;
  productSku: string;
  qty: number;
  qtyInput: string;
  isBundle: boolean;
  unitPriceKgs: number | null;
  lineTotalKgs: number | null;
  priceInput: string;
  priceEdited: boolean;
};

const toLineTotal = salesOrderLineTotal;

const NewSalesOrderPage = () => {
  const t = useTranslations("salesOrders");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session } = useSession();
  const canSetPrice = ["ADMIN", "MANAGER", "STAFF", "CASHIER"].includes(session?.user?.role ?? "");
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedStoreId = searchParams.get("storeId");
  const returnTo = resolveSafeReturnTo(searchParams.get("returnTo"), "/sales/orders");
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const legacyReturnRedirect = resolveLegacySalesReturnRedirect(searchParams);

  const storesQuery = trpc.stores.list.useQuery();
  const [storeId, setStoreId] = useState<string>("");
  const [selectedCustomer, setSelectedCustomer] = useState<SalesOrderCustomerOption | null>(null);
  const [customerSelectionTouched, setCustomerSelectionTouched] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [lineSearch, setLineSearch] = useState("");
  const [showLineSearchResults, setShowLineSearchResults] = useState(false);
  const [pendingQty, setPendingQty] = useState("1");
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const draftLinesRef = useRef(draftLines);
  draftLinesRef.current = draftLines;
  const [pricingRevision, setPricingRevision] = useState(0);
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);
  const [pricingFailed, setPricingFailed] = useState(false);
  const [isAddingLine, setIsAddingLine] = useState(false);
  const createAttemptRef = useRef<{ payload: string; idempotencyKey: string } | null>(null);

  useEffect(() => {
    if (!storeId && storesQuery.data?.[0]) {
      const available = requestedStoreId
        ? storesQuery.data.find((store) => store.id === requestedStoreId)
        : storesQuery.data[0];
      if (available) setStoreId(available.id);
    }
  }, [storeId, storesQuery.data, requestedStoreId]);

  const selectedStore = storesQuery.data?.find((store) => store.id === storeId) ?? null;
  const currencyCode = resolveCurrency(selectedStore).currencyCode;

  // Changing the selling store refreshes suggested prices without discarding negotiated prices.
  useEffect(() => {
    const currentLines = draftLinesRef.current;
    const store = storesQuery.data?.find((item) => item.id === storeId);
    if (!store || !currentLines.length) return;
    let active = true;
    setIsRefreshingPrices(true);
    setPricingFailed(false);
    void Promise.all(
      currentLines.map(async (line) => ({
        productId: line.productId,
        price: line.priceEdited
          ? line.unitPriceKgs
          : (await utils.salesOrders.linePrice.fetch({ productId: line.productId, storeId }))
              .unitPriceKgs,
      })),
    )
      .then((prices) => {
        if (!active) return;
        setDraftLines((current) =>
          current.map((line) => {
            const refreshed = prices.find((item) => item.productId === line.productId);
            if (!refreshed) return line;
            const price = line.priceEdited ? line.unitPriceKgs : refreshed.price;
            return {
              ...line,
              unitPriceKgs: price,
              priceInput: price === null ? line.priceInput : salesOrderPriceInput(price, store),
              lineTotalKgs: line.qty > 0 ? toLineTotal(line.qty, price) : null,
            };
          }),
        );
      })
      .catch(() => {
        if (active) setPricingFailed(true);
      })
      .finally(() => {
        if (active) setIsRefreshingPrices(false);
      });
    return () => {
      active = false;
    };
  }, [storeId, pricingRevision, storesQuery.data, utils]);

  const chooseCustomer = (customer: SalesOrderCustomerOption | null) => {
    setCustomerSelectionTouched(true);
    setSelectedCustomer(customer);
    setCustomerName(customer?.name ?? "");
    setCustomerEmail(customer?.email ?? "");
    setCustomerPhone(customer?.phone ?? "");
    setCustomerAddress(customer?.address ?? "");
  };

  const productSearchQuery = trpc.products.searchQuick.useQuery(
    { q: lineSearch.trim(), storeId: storeId || undefined, limit: 25 },
    { enabled: lineSearch.trim().length >= 1 },
  );

  const createMutation = trpc.salesOrders.createDraft.useMutation({
    onSuccess: (order) => {
      createAttemptRef.current = null;
      toast({ variant: "success", description: t("createSuccess") });
      router.push(`/sales/orders/${order.id}?returnTo=${encodeURIComponent(returnTo)}`);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const addDraftLine = async (product: ProductSearchResult): Promise<boolean> => {
    if (isAddingLine || isRefreshingPrices || createMutation.isLoading) return false;
    if (!storeId) {
      toast({ variant: "error", description: t("storeRequired") });
      return false;
    }

    const rawQty = pendingQty.trim();
    const qty = parseQuantity(rawQty);
    if (!rawQty || qty === null || qty <= 0) {
      toast({ variant: "error", description: t("qtyPositive") });
      return false;
    }
    const normalizedQty = qty;

    let unitPriceKgs: number | null = null;
    setIsAddingLine(true);
    try {
      const pricing = await utils.salesOrders.linePrice.fetch({
        productId: product.id,
        storeId,
      });
      unitPriceKgs = pricing.unitPriceKgs;
    } catch (error) {
      toast({ variant: "error", description: tErrors("genericMessage") });
      return false;
    } finally {
      setIsAddingLine(false);
    }

    if (unitPriceKgs === null) {
      toast({ variant: "info", description: t("priceNotSet") });
    }

    setDraftLines((current) => {
      const index = current.findIndex((line) => line.productId === product.id);
      if (index === -1) {
        return [
          ...current,
          {
            productId: product.id,
            productName: product.name,
            productSku: product.sku,
            qty: normalizedQty,
            qtyInput: String(normalizedQty),
            isBundle: Boolean(product.isBundle),
            unitPriceKgs,
            lineTotalKgs: toLineTotal(normalizedQty, unitPriceKgs),
            priceInput:
              unitPriceKgs === null ? "" : salesOrderPriceInput(unitPriceKgs, selectedStore),
            priceEdited: false,
          },
        ];
      }

      const next = [...current];
      const nextQty = roundQuantity(next[index].qty + normalizedQty);
      const currentPrice = next[index].priceEdited
        ? next[index].unitPriceKgs
        : (next[index].unitPriceKgs ?? unitPriceKgs);
      next[index] = {
        ...next[index],
        qty: nextQty,
        qtyInput: String(nextQty),
        unitPriceKgs: currentPrice,
        priceInput: next[index].priceEdited
          ? next[index].priceInput
          : currentPrice === null
            ? ""
            : salesOrderPriceInput(currentPrice, selectedStore),
        lineTotalKgs: toLineTotal(nextQty, currentPrice),
      };
      return next;
    });
    setLineSearch("");
    setPendingQty("1");
    setShowLineSearchResults(false);
    return true;
  };

  const handleLineScanResolved = async (result: ScanResolvedResult): Promise<boolean> => {
    if (result.kind === "notFound") {
      toast({ variant: "info", description: tCommon("nothingFound") });
      return false;
    }
    if (result.kind === "multiple") {
      setShowLineSearchResults(true);
      return true;
    }
    return addDraftLine({
      id: result.item.id,
      name: result.item.name,
      sku: result.item.sku,
      isBundle: result.item.type === "bundle",
    });
  };

  const updateDraftLineQty = (productId: string, rawValue: string) => {
    setDraftLines((current) =>
      current.map((line) =>
        line.productId === productId
          ? {
              ...line,
              qty:
                rawValue.trim().length > 0 && parseQuantity(rawValue) !== null
                  ? (parseQuantity(rawValue) ?? 0)
                  : 0,
              qtyInput: rawValue,
              lineTotalKgs:
                rawValue.trim().length > 0 && parseQuantity(rawValue) !== null
                  ? toLineTotal(parseQuantity(rawValue) ?? 0, line.unitPriceKgs)
                  : null,
            }
          : line,
      ),
    );
  };

  const removeDraftLine = (productId: string) => {
    setDraftLines((current) => current.filter((line) => line.productId !== productId));
  };

  const updateDraftLinePrice = (productId: string, rawValue: string) => {
    const price = parseSalesOrderPriceInput(rawValue, selectedStore);
    setDraftLines((current) =>
      current.map((line) =>
        line.productId === productId
          ? {
              ...line,
              priceInput: rawValue,
              priceEdited: true,
              unitPriceKgs: price,
              lineTotalKgs: line.qty > 0 ? toLineTotal(line.qty, price) : null,
            }
          : line,
      ),
    );
  };

  const handleCreate = async () => {
    if (!storeId) {
      toast({ variant: "error", description: t("storeRequired") });
      return;
    }

    if (isRefreshingPrices || isAddingLine || pricingFailed) return;
    if (draftLines.some((line) => line.qty <= 0 || !Number.isFinite(line.qty))) {
      toast({ variant: "error", description: t("qtyPositive") });
      return;
    }

    if (draftLines.some((line) => line.unitPriceKgs === null)) {
      toast({
        variant: "error",
        description: t(
          draftLines.some((line) => line.priceEdited && line.unitPriceKgs === null)
            ? "unitPriceInvalid"
            : "priceNotSetBlocking",
        ),
      });
      return;
    }
    if (
      !isValidOptionalCustomerPhone(customerPhone) &&
      customerPhone.trim() !== (selectedCustomer?.phone?.trim() ?? "")
    ) {
      toast({ variant: "error", description: tErrors("customerPhoneInvalid") });
      return;
    }
    if (
      !isValidOptionalCustomerAddress(customerAddress) &&
      customerAddress.trim() !== (selectedCustomer?.address?.trim() ?? "")
    ) {
      toast({ variant: "error", description: tErrors("customerAddressInvalid") });
      return;
    }

    const payload = {
      storeId,
      ...(customerSelectionTouched ? { customerId: selectedCustomer?.id ?? null } : {}),
      customerName: customerName.trim() || null,
      customerEmail: customerEmail.trim() || null,
      customerPhone: customerPhone.trim() || null,
      customerAddress: customerAddress.trim() || null,
      notes: notes.trim() || null,
      lines: draftLines.map((line) => ({
        productId: line.productId,
        variantId: null,
        qty: line.qty,
        ...(line.priceEdited && line.unitPriceKgs !== null
          ? { unitPriceKgs: line.unitPriceKgs }
          : {}),
      })),
    };
    const serializedPayload = JSON.stringify(payload);
    const existingAttempt = createAttemptRef.current;
    const idempotencyKey =
      existingAttempt?.payload === serializedPayload
        ? existingAttempt.idempotencyKey
        : crypto.randomUUID();
    createAttemptRef.current = { payload: serializedPayload, idempotencyKey };

    await createMutation.mutateAsync({ ...payload, idempotencyKey });
  };

  const orderTotalKgs = useMemo(
    () =>
      draftLines.reduce((total, line) => {
        return total + (line.lineTotalKgs ?? 0);
      }, 0),
    [draftLines],
  );

  if (legacyReturnRedirect) {
    return <SalesOrderReturnRedirect href={legacyReturnRedirect} label={tCommon("loading")} />;
  }

  return (
    <div>
      <PageHeader title={t("new")} subtitle={t("newSubtitle")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("detailsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormGrid>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t("store")}</p>
              <Select
                value={storeId}
                onValueChange={setStoreId}
                disabled={isAddingLine || isRefreshingPrices || createMutation.isLoading}
              >
                <SelectTrigger aria-label={t("store")}>
                  <SelectValue placeholder={tCommon("selectStore")} />
                </SelectTrigger>
                <SelectContent>
                  {(storesQuery.data ?? []).map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">
                {t("customerCard")} ({tCommon("optional")})
              </p>
              <SalesOrderCustomerSelect
                storeId={storeId}
                customerId={selectedCustomer?.id ?? null}
                customerName={selectedCustomer?.name ?? ""}
                onSelect={chooseCustomer}
                disabled={createMutation.isLoading}
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">
                {t("customerName")} ({tCommon("optional")})
              </p>
              <Input
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                placeholder={t("customerNamePlaceholder")}
                maxLength={180}
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">
                {t("customerEmail")} ({tCommon("optional")})
              </p>
              <Input
                type="email"
                value={customerEmail}
                onChange={(event) => setCustomerEmail(event.target.value)}
                placeholder={t("customerEmailPlaceholder")}
                maxLength={254}
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">
                {t("customerPhone")} ({tCommon("optional")})
              </p>
              <Input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={customerPhone}
                onChange={(event) => setCustomerPhone(event.target.value)}
                placeholder={t("customerPhonePlaceholder")}
                maxLength={64}
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <p className="text-sm font-medium">
                {t("customerAddress")} ({tCommon("optional")})
              </p>
              <Input
                value={customerAddress}
                onChange={(event) => setCustomerAddress(event.target.value)}
                placeholder={t("customerAddressPlaceholder")}
                maxLength={512}
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <p className="text-sm font-medium">{t("notes")}</p>
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder={t("notesPlaceholder")}
                maxLength={2000}
                rows={4}
              />
            </div>
          </FormGrid>

          <div className="space-y-3 rounded-md border border-border p-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">{t("linesTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("lineDialogSubtitle")}</p>
            </div>

            <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
              <div className="relative">
                <ScanInput
                  context="linePicker"
                  value={lineSearch}
                  onValueChange={(nextValue) => {
                    setLineSearch(nextValue);
                    setShowLineSearchResults(true);
                  }}
                  onFocus={() => setShowLineSearchResults(true)}
                  onBlur={() => {
                    window.setTimeout(() => setShowLineSearchResults(false), 150);
                  }}
                  placeholder={t("productSearchPlaceholder")}
                  ariaLabel={t("productSearchPlaceholder")}
                  supportsTabSubmit
                  showDropdown={false}
                  onResolved={handleLineScanResolved}
                />
                {showLineSearchResults && lineSearch.trim().length > 0 ? (
                  <div className="absolute z-[90] mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-background shadow-lg">
                    {productSearchQuery.isLoading ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        {tCommon("loading")}
                      </div>
                    ) : productSearchQuery.data?.length ? (
                      productSearchQuery.data.map((product) => (
                        <ProductSearchResultItem
                          key={product.id}
                          product={product}
                          currencySource={selectedStore}
                          rightSlot={
                            <AddIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
                          }
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            void addDraftLine(product as ProductSearchResult);
                          }}
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

              <Input
                type="text"
                inputMode="decimal"
                value={pendingQty}
                onChange={(event) => setPendingQty(event.target.value)}
                className="sm:max-w-[120px]"
                aria-label={t("qty")}
                disabled={isAddingLine || isRefreshingPrices || createMutation.isLoading}
              />
            </div>

            {draftLines.length ? (
              <div className="space-y-2">
                {draftLines.map((line) => (
                  <div
                    key={line.productId}
                    className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{line.productName}</p>
                        {line.isBundle ? (
                          <Badge variant="muted">{t("bundleProductLabel")}</Badge>
                        ) : null}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{line.productSku}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          {t("lineTotal")}:{" "}
                          {line.lineTotalKgs === null
                            ? t("priceNotSet")
                            : formatKgsMoney(line.lineTotalKgs, locale, selectedStore)}
                        </span>
                      </div>
                    </div>
                    <div className="flex w-full items-end gap-2 sm:w-auto sm:shrink-0">
                      <label className="min-w-0 flex-1 space-y-1 text-xs text-muted-foreground sm:w-24 sm:flex-none">
                        <span>{t("qty")}</span>
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={line.qtyInput}
                          onChange={(event) =>
                            updateDraftLineQty(line.productId, event.target.value)
                          }
                          className="h-9 w-full"
                          disabled={isRefreshingPrices || createMutation.isLoading}
                        />
                      </label>
                      <label className="min-w-0 flex-1 space-y-1 text-xs text-muted-foreground sm:w-36 sm:flex-none">
                        <span>
                          {t("unitPrice")} · {currencyCode}
                        </span>
                        <PriceInput
                          value={line.priceInput}
                          onChange={(event) =>
                            updateDraftLinePrice(line.productId, event.target.value)
                          }
                          placeholder={t("priceNotSet")}
                          className="h-9 w-full"
                          aria-invalid={line.priceEdited && line.unitPriceKgs === null}
                          disabled={!canSetPrice || isRefreshingPrices || createMutation.isLoading}
                        />
                      </label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="secondary"
                            size="icon"
                            onClick={() => removeDraftLine(line.productId)}
                            aria-label={t("removeLine")}
                            disabled={isRefreshingPrices || createMutation.isLoading}
                          >
                            <DeleteIcon className="h-4 w-4" aria-hidden />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("removeLine")}</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noLines")}</p>
            )}
            {isRefreshingPrices ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                <Spinner className="h-4 w-4" />
                {tCommon("loading")}
              </div>
            ) : null}
            {pricingFailed ? (
              <QueryErrorState onRetry={() => setPricingRevision((value) => value + 1)} />
            ) : null}
            {draftLines.length ? (
              <p className="text-xs text-muted-foreground">{t("documentPriceHint")}</p>
            ) : null}
          </div>

          <p className="text-xs text-muted-foreground">{t("orderWithoutShift")}</p>

          <div className="rounded-md border border-border p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-muted-foreground">{t("total")}</span>
              <span className="font-semibold text-foreground">
                {formatKgsMoney(orderTotalKgs, locale, selectedStore)}
              </span>
            </div>
            {draftLines.some((line) => line.unitPriceKgs === null) ? (
              <p className="mt-2 text-xs text-danger">{t("priceNotSetBlocking")}</p>
            ) : null}
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              className="w-full sm:w-auto"
              onClick={() => router.push(returnTo)}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={() => void handleCreate()}
              disabled={
                createMutation.isLoading || isRefreshingPrices || isAddingLine || pricingFailed
              }
            >
              {createMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
              {t("create")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default NewSalesOrderPage;

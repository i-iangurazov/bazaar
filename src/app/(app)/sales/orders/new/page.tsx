"use client";
import { parseQuantity, roundQuantity } from "@/lib/quantity";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { z } from "zod";

import { AddIcon, CheckIcon, ChevronDownIcon, DeleteIcon } from "@/components/icons";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
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
import { useDebouncedValue } from "@/lib/use-debounced-value";
import {
  clearPendingSalesOrderSale,
  isSafeSalesOrderFailure,
  readPendingSalesOrderSale,
  writePendingSalesOrderSale,
  type PendingSalesOrderSale,
} from "@/lib/salesOrderPendingSale";
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
  const ownerRef = useRef<{ userId: string; organizationId: string } | null>(null);
  ownerRef.current =
    session?.user?.id && session.user.organizationId
      ? { userId: session.user.id, organizationId: session.user.organizationId }
      : null;
  const canSetPrice = ["ADMIN", "MANAGER", "STAFF", "CASHIER"].includes(session?.user?.role ?? "");
  const canPostSale = session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedStoreId = searchParams.get("storeId");
  const returnTo = resolveSafeReturnTo(searchParams.get("returnTo"), "/sales/orders");
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
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
  const [showCustomerDetails, setShowCustomerDetails] = useState(false);
  const [lineSearch, setLineSearch] = useState("");
  const debouncedLineSearch = useDebouncedValue(lineSearch.trim(), 250);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lineInputsRef = useRef(new Map<string, HTMLInputElement>());
  const [pendingQty, setPendingQty] = useState("1");
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const draftLinesRef = useRef(draftLines);
  draftLinesRef.current = draftLines;
  const [pricingRevision, setPricingRevision] = useState(0);
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);
  const [pricingFailed, setPricingFailed] = useState(false);
  const [isAddingLine, setIsAddingLine] = useState(false);
  const addingLineRef = useRef(false);
  const submissionRef = useRef(false);
  const [pendingSale, setPendingSale] = useState<PendingSalesOrderSale | null>(null);
  const pendingSaleRef = useRef<PendingSalesOrderSale | null>(null);
  const [recoveryLoaded, setRecoveryLoaded] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const createAttemptRef = useRef<{
    payload: string;
    idempotencyKey: string;
    ownerKey: string;
  } | null>(null);
  const currentOwnerKey = () => (ownerRef.current ? JSON.stringify(ownerRef.current) : "");

  useEffect(() => {
    const owner = ownerRef.current;
    setRecoveryLoaded(false);
    setStorageFailed(false);
    pendingSaleRef.current = null;
    setPendingSale(null);
    createAttemptRef.current = null;
    setDraftLines([]);
    setStoreId("");
    setSelectedCustomer(null);
    setCustomerSelectionTouched(false);
    setCustomerName("");
    setCustomerEmail("");
    setCustomerPhone("");
    setCustomerAddress("");
    setNotes("");
    setLineSearch("");
    setPendingQty("1");
    if (!owner) return;
    try {
      const pending = readPendingSalesOrderSale(window.sessionStorage, owner);
      pendingSaleRef.current = pending;
      setPendingSale(pending);
    } catch {
      setStorageFailed(true);
    } finally {
      setRecoveryLoaded(true);
    }
  }, [session?.user?.id, session?.user?.organizationId]);

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
          : await (async () => {
              const resolved = await utils.salesOrders.linePrice.fetch({
                productId: line.productId,
                storeId,
              });
              return resolved.hasConfiguredPrice === false ? null : resolved.unitPriceKgs;
            })(),
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
              priceInput:
                price === null
                  ? line.priceEdited
                    ? line.priceInput
                    : ""
                  : salesOrderPriceInput(price, store),
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
    { q: debouncedLineSearch, storeId: storeId || undefined, limit: 50 },
    { enabled: Boolean(storeId) && debouncedLineSearch.length >= 1, keepPreviousData: false },
  );

  const createMutation = trpc.salesOrders.createDraft.useMutation({
    onSuccess: (order, variables) => {
      const attempt = createAttemptRef.current;
      if (
        !attempt ||
        attempt.idempotencyKey !== variables.idempotencyKey ||
        attempt.ownerKey !== currentOwnerKey()
      )
        return;
      createAttemptRef.current = null;
      toast({ variant: "success", description: t("createSuccess") });
      router.push(`/sales/orders/${order.id}?returnTo=${encodeURIComponent(returnTo)}`);
    },
    onError: (error, variables) => {
      const attempt = createAttemptRef.current;
      if (
        !attempt ||
        attempt.idempotencyKey !== variables.idempotencyKey ||
        attempt.ownerKey !== currentOwnerKey()
      )
        return;
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const saleMutation = trpc.salesOrders.createSale.useMutation({
    onSuccess: (order, variables) => {
      const pending = pendingSaleRef.current;
      const owner = ownerRef.current;
      if (
        !pending ||
        !owner ||
        pending.userId !== owner.userId ||
        pending.organizationId !== owner.organizationId ||
        pending.input.idempotencyKey !== variables.idempotencyKey
      )
        return;
      try {
        clearPendingSalesOrderSale(window.sessionStorage, pending);
      } catch {
        /* Replaying the same key is still safe. */
      }
      pendingSaleRef.current = null;
      setPendingSale(null);
      createAttemptRef.current = null;
      toast({ variant: "success", description: t("completeSuccess") });
      router.push(`/sales/orders/${order.id}?returnTo=${encodeURIComponent(returnTo)}`);
    },
    onError: (error, variables) => {
      const pending = pendingSaleRef.current;
      const owner = ownerRef.current;
      if (
        !pending ||
        !owner ||
        pending.userId !== owner.userId ||
        pending.organizationId !== owner.organizationId ||
        pending.input.idempotencyKey !== variables.idempotencyKey
      )
        return;
      if (pending && isSafeSalesOrderFailure(error)) {
        try {
          clearPendingSalesOrderSale(window.sessionStorage, pending);
          pendingSaleRef.current = null;
          setPendingSale(null);
        } catch {
          setStorageFailed(true);
        }
      }
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const isSaving =
    createMutation.isLoading ||
    saleMutation.isLoading ||
    Boolean(pendingSale) ||
    !recoveryLoaded ||
    storageFailed;

  const addDraftLine = async (product: ProductSearchResult): Promise<boolean> => {
    if (addingLineRef.current || isRefreshingPrices || isSaving || submissionRef.current)
      return false;
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
    addingLineRef.current = true;
    setIsAddingLine(true);
    try {
      const pricing = await utils.salesOrders.linePrice.fetch({
        productId: product.id,
        storeId,
      });
      unitPriceKgs = pricing.hasConfiguredPrice === false ? null : pricing.unitPriceKgs;
    } catch (error) {
      toast({ variant: "error", description: tErrors("genericMessage") });
      return false;
    } finally {
      addingLineRef.current = false;
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
    setPendingQty("1");
    return true;
  };

  const handleLineScanResolved = async (result: ScanResolvedResult): Promise<boolean> => {
    if (result.kind === "notFound") {
      toast({ variant: "info", description: tCommon("nothingFound") });
      return false;
    }
    if (result.kind === "multiple") {
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

  const handleCreate = async (postSale = false) => {
    if (submissionRef.current || isSaving) return;
    const attemptOwner = ownerRef.current;
    if (!attemptOwner) return;
    const attemptOwnerKey = JSON.stringify(attemptOwner);
    if (!storeId) {
      toast({ variant: "error", description: t("storeRequired") });
      return;
    }

    if (isRefreshingPrices || isAddingLine || pricingFailed) return;
    if (postSale && !draftLines.length) {
      toast({ variant: "error", description: tErrors("salesOrderEmpty") });
      return;
    }
    if (draftLines.some((line) => line.qty <= 0 || !Number.isFinite(line.qty))) {
      toast({ variant: "error", description: t("qtyPositive") });
      return;
    }
    if (orderTotalKgs > 9_999_999_999.99) {
      toast({ variant: "error", description: tErrors("invalidInput") });
      return;
    }
    if (
      customerEmail.trim() &&
      !z.string().email().max(254).safeParse(customerEmail.trim()).success
    ) {
      toast({ variant: "error", description: tErrors("customerEmailInvalid") });
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
    submissionRef.current = true;
    try {
      if (
        postSale &&
        !(await confirm({
          title: t("workspace.postSale"),
          description: t("workspace.postConfirmation", {
            store: selectedStore?.name ?? "",
            total: formatKgsMoney(orderTotalKgs, locale, selectedStore),
          }),
          confirmLabel: t("workspace.postSale"),
        }))
      )
        return;
      if (currentOwnerKey() !== attemptOwnerKey) return;
      const serializedPayload = JSON.stringify({ ...payload, postSale });
      const existingAttempt = createAttemptRef.current;
      const idempotencyKey =
        existingAttempt?.payload === serializedPayload
          ? existingAttempt.idempotencyKey
          : crypto.randomUUID();
      createAttemptRef.current = {
        payload: serializedPayload,
        idempotencyKey,
        ownerKey: attemptOwnerKey,
      };

      if (postSale) {
        const pending: PendingSalesOrderSale = {
          version: 1,
          ...attemptOwner,
          input: { ...payload, idempotencyKey },
          storeName: selectedStore?.name ?? "",
          totalLabel: formatKgsMoney(orderTotalKgs, locale, selectedStore),
        };
        try {
          writePendingSalesOrderSale(window.sessionStorage, pending);
        } catch {
          setStorageFailed(true);
          toast({ variant: "error", description: t("workspace.storageFailed") });
          return;
        }
        pendingSaleRef.current = pending;
        setPendingSale(pending);
        await saleMutation.mutateAsync(pending.input);
      } else await createMutation.mutateAsync({ ...payload, idempotencyKey });
    } catch {
      // The mutation shows its translated error. Keep the draft and retry key.
    } finally {
      submissionRef.current = false;
    }
  };

  const orderTotalKgs = useMemo(
    () =>
      draftLines.reduce((cents, line) => cents + Math.round((line.lineTotalKgs ?? 0) * 100), 0) /
      100,
    [draftLines],
  );

  const focusNextLine = (
    event: KeyboardEvent<HTMLInputElement>,
    index: number,
    field: "qty" | "price",
  ) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const line = draftLines[index];
    if (!line || (field === "qty" ? line.qty <= 0 : line.unitPriceKgs === null)) return;
    const next = draftLines[index + 1];
    const input = next
      ? lineInputsRef.current.get(`${next.productId}:${field}`)
      : searchInputRef.current;
    input?.focus();
    input?.select();
  };

  if (legacyReturnRedirect) {
    return <SalesOrderReturnRedirect href={legacyReturnRedirect} label={tCommon("loading")} />;
  }

  return (
    <div className="space-y-4 pb-4">
      <PageHeader title={t("workspace.title")} subtitle={t("workspace.subtitle")} />

      {pendingSale ? (
        <section className="bazaar-doc-surface space-y-3 border-warning/40 p-4" role="status">
          <h2 className="text-sm font-semibold">{t("workspace.recoveryTitle")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("workspace.recoveryHint", {
              store: pendingSale.storeName,
              total: pendingSale.totalLabel,
            })}
          </p>
          <Button
            type="button"
            disabled={saleMutation.isLoading}
            onClick={() => void saleMutation.mutateAsync(pendingSale.input).catch(() => {})}
          >
            {saleMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
            {t("workspace.recoveryRetry")}
          </Button>
        </section>
      ) : null}
      {storageFailed ? (
        <p role="alert" className="rounded-md border border-danger/30 p-4 text-sm text-danger">
          {t("workspace.storageFailed")}
        </p>
      ) : null}

      <section className="bazaar-doc-surface space-y-4 p-4" aria-label={t("detailsTitle")}>
        {storesQuery.error ? (
          <QueryErrorState error={storesQuery.error} onRetry={() => void storesQuery.refetch()} />
        ) : null}
        <FormGrid>
          <div className="space-y-1.5">
            <Label>{t("store")}</Label>
            <Select
              value={storeId}
              onValueChange={setStoreId}
              disabled={isAddingLine || isRefreshingPrices || isSaving}
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
            <Label>{t("customerCard")}</Label>
            <SalesOrderCustomerSelect
              storeId={storeId}
              customerId={selectedCustomer?.id ?? null}
              customerName={selectedCustomer?.name ?? ""}
              onSelect={chooseCustomer}
              disabled={isSaving}
            />
          </div>
        </FormGrid>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={showCustomerDetails}
          aria-controls="sales-customer-details"
          onClick={() => setShowCustomerDetails((value) => !value)}
        >
          <ChevronDownIcon
            className={`h-4 w-4 transition-transform ${showCustomerDetails ? "rotate-180" : ""}`}
            aria-hidden
          />
          {t("workspace.customerDetails")}
        </Button>
        {showCustomerDetails ? (
          <div id="sales-customer-details">
            <FormGrid className="border-t border-border pt-4">
              <div className="space-y-1.5">
                <Label htmlFor="sales-customer-name">{t("customerName")}</Label>
                <Input
                  id="sales-customer-name"
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  placeholder={t("customerNamePlaceholder")}
                  maxLength={180}
                  disabled={isSaving}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sales-customer-email">{t("customerEmail")}</Label>
                <Input
                  id="sales-customer-email"
                  type="email"
                  value={customerEmail}
                  onChange={(event) => setCustomerEmail(event.target.value)}
                  placeholder={t("customerEmailPlaceholder")}
                  maxLength={254}
                  disabled={isSaving}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sales-customer-phone">{t("customerPhone")}</Label>
                <Input
                  id="sales-customer-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={customerPhone}
                  onChange={(event) => setCustomerPhone(event.target.value)}
                  placeholder={t("customerPhonePlaceholder")}
                  maxLength={64}
                  disabled={isSaving}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sales-customer-address">{t("customerAddress")}</Label>
                <Input
                  id="sales-customer-address"
                  value={customerAddress}
                  onChange={(event) => setCustomerAddress(event.target.value)}
                  placeholder={t("customerAddressPlaceholder")}
                  maxLength={512}
                  disabled={isSaving}
                />
              </div>
            </FormGrid>
          </div>
        ) : null}
      </section>

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className="bazaar-doc-surface min-w-0 p-4" aria-label={t("workspace.searchTitle")}>
          <h2 className="mb-3 text-base font-semibold">{t("workspace.searchTitle")}</h2>
          <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-end gap-2">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="sales-product-search">{tCommon("search")}</Label>
              <ScanInput
                ref={searchInputRef}
                context="linePicker"
                storeId={storeId || undefined}
                value={lineSearch}
                onValueChange={setLineSearch}
                placeholder={t("productSearchPlaceholder")}
                ariaLabel={t("productSearchPlaceholder")}
                supportsTabSubmit
                showDropdown={false}
                enableProductSearch={false}
                onResolved={handleLineScanResolved}
                disabled={!storeId || isSaving}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sales-add-qty">{t("qty")}</Label>
              <Input
                id="sales-add-qty"
                type="text"
                inputMode="decimal"
                value={pendingQty}
                onChange={(event) => setPendingQty(event.target.value)}
                disabled={isAddingLine || isRefreshingPrices || isSaving}
              />
            </div>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {t("workspace.searchHint")}
          </p>
          <div className="bazaar-doc-search-list mt-3" aria-live="polite">
            {lineSearch.trim().length < 1 ? (
              <p className="px-3 py-6 text-sm text-muted-foreground">
                {t("workspace.searchEmpty")}
              </p>
            ) : lineSearch.trim() !== debouncedLineSearch || productSearchQuery.isLoading ? (
              <div
                className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground"
                role="status"
              >
                <Spinner className="h-4 w-4" />
                {tCommon("loading")}
              </div>
            ) : productSearchQuery.error ? (
              <QueryErrorState
                error={productSearchQuery.error}
                onRetry={() => void productSearchQuery.refetch()}
              />
            ) : productSearchQuery.data?.length ? (
              productSearchQuery.data.map((product) => (
                <ProductSearchResultItem
                  key={product.id}
                  product={product}
                  currencySource={selectedStore}
                  wrapName
                  selected={draftLines.some((line) => line.productId === product.id)}
                  rightSlot={
                    draftLines.some((line) => line.productId === product.id) ? (
                      <CheckIcon className="h-4 w-4 text-primary" aria-hidden />
                    ) : (
                      <AddIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
                    )
                  }
                  onMouseDown={(event) => event.preventDefault()}
                  disabled={isAddingLine || isRefreshingPrices || isSaving}
                  onClick={() => void addDraftLine(product as ProductSearchResult)}
                />
              ))
            ) : (
              <p className="px-3 py-6 text-sm text-muted-foreground">{tCommon("nothingFound")}</p>
            )}
          </div>
        </section>

        <section className="bazaar-doc-surface min-w-0 space-y-4 p-4" aria-label={t("linesTitle")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">{t("linesTitle")}</h2>
            <Badge variant="muted">
              {t("workspace.positionCount", { count: draftLines.length })}
            </Badge>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">{t("workspace.keyboardHint")}</p>
          {draftLines.length ? (
            <div className="space-y-2">
              {draftLines.map((line, index) => (
                <div
                  key={line.productId}
                  className="bazaar-doc-line-row grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_5rem_6.25rem_2.25rem] md:items-end md:gap-2"
                  data-sales-draft-line
                >
                  <div className="min-w-0 space-y-1 md:self-center">
                    <p className="break-words text-sm font-medium [overflow-wrap:anywhere]">
                      {line.productName}
                    </p>
                    <p className="break-words text-xs text-muted-foreground">{line.productSku}</p>
                    {line.isBundle ? (
                      <Badge variant="muted">{t("bundleProductLabel")}</Badge>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {t("lineTotal")}:{" "}
                      <span className="font-medium text-foreground">
                        {line.lineTotalKgs === null
                          ? t("priceNotSet")
                          : formatKgsMoney(line.lineTotalKgs, locale, selectedStore)}
                      </span>
                    </p>
                  </div>
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_2.25rem] items-end gap-2 md:contents">
                    <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                      <span>{t("qty")}</span>
                      <Input
                        ref={(node) => {
                          if (node) lineInputsRef.current.set(`${line.productId}:qty`, node);
                          else lineInputsRef.current.delete(`${line.productId}:qty`);
                        }}
                        type="text"
                        inputMode="decimal"
                        value={line.qtyInput}
                        aria-label={`${t("qty")} · ${line.productName}`}
                        aria-invalid={line.qty <= 0}
                        onChange={(event) => updateDraftLineQty(line.productId, event.target.value)}
                        onKeyDown={(event) => focusNextLine(event, index, "qty")}
                        className="h-10 w-full"
                        disabled={isRefreshingPrices || isSaving}
                      />
                    </label>
                    <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                      <span>
                        {t("unitPrice")} · {currencyCode}
                      </span>
                      <PriceInput
                        ref={(node) => {
                          if (node) lineInputsRef.current.set(`${line.productId}:price`, node);
                          else lineInputsRef.current.delete(`${line.productId}:price`);
                        }}
                        value={line.priceInput}
                        onChange={(event) =>
                          updateDraftLinePrice(line.productId, event.target.value)
                        }
                        onKeyDown={(event) => focusNextLine(event, index, "price")}
                        placeholder={t("priceNotSet")}
                        aria-label={`${t("unitPrice")} · ${line.productName}`}
                        aria-invalid={line.priceEdited && line.unitPriceKgs === null}
                        className="h-10 w-full"
                        disabled={!canSetPrice || isRefreshingPrices || isSaving}
                      />
                    </label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-10 w-9"
                          onClick={() => removeDraftLine(line.productId)}
                          aria-label={`${t("removeLine")} · ${line.productName}`}
                          disabled={isRefreshingPrices || isSaving}
                        >
                          <DeleteIcon className="h-4 w-4 text-danger" aria-hidden />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("removeLine")}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
              {t("noLines")}
            </p>
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
          <div className="space-y-1.5">
            <Label htmlFor="sales-notes">{t("notes")}</Label>
            <Textarea
              id="sales-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={t("notesPlaceholder")}
              maxLength={2000}
              rows={2}
              disabled={isSaving}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
            <span className="text-sm text-muted-foreground">{t("total")}</span>
            <strong className="text-xl">
              {formatKgsMoney(orderTotalKgs, locale, selectedStore)}
            </strong>
          </div>
          {draftLines.some((line) => line.unitPriceKgs === null) ? (
            <p className="text-xs text-danger" role="alert">
              {t("priceNotSetBlocking")}
            </p>
          ) : null}
          <p className="text-xs leading-5 text-muted-foreground">{t("workspace.postHint")}</p>
          <div className="flex flex-wrap gap-2">
            {canPostSale ? (
              <Button
                type="button"
                className="min-h-10 flex-1"
                onClick={() => void handleCreate(true)}
                disabled={
                  isSaving ||
                  isRefreshingPrices ||
                  isAddingLine ||
                  pricingFailed ||
                  !storeId ||
                  !draftLines.length
                }
              >
                {saleMutation.isLoading ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <CheckIcon className="h-4 w-4" aria-hidden />
                )}
                {t("workspace.postSale")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant={canPostSale ? "secondary" : "primary"}
              className="min-h-10 flex-1"
              onClick={() => void handleCreate(false)}
              disabled={isSaving || isRefreshingPrices || isAddingLine || pricingFailed || !storeId}
            >
              {createMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
              {t("workspace.saveDraft")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push(returnTo)}
              disabled={isSaving}
            >
              {tCommon("cancel")}
            </Button>
          </div>
        </section>
      </div>
      {confirmDialog}
    </div>
  );
};

export default NewSalesOrderPage;

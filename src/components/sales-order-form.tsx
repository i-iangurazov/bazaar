"use client";
import { parseQuantity, roundQuantity } from "@/lib/quantity";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { CustomerOrderStatus } from "@prisma/client";
import { z } from "zod";

import { AddIcon, CheckIcon, ChevronDownIcon, DeleteIcon, StatusWarningIcon } from "@/components/icons";
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
  salesOrderDocumentCurrencySource,
  salesOrderLineTotal,
  salesOrderPriceInput,
} from "@/lib/salesOrderPriceInput";
import { serializeSalesOrderUpdateLines } from "@/lib/salesOrderUpdateLines";
import {
  isValidOptionalCustomerAddress,
  isValidOptionalCustomerPhone,
} from "@/lib/customerContact";
import { translateError } from "@/lib/translateError";
import { trpc } from "@/lib/trpc";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import {
  clearSalesOrderDraft,
  readSalesOrderDraft,
  writeSalesOrderDraft,
  type SalesOrderDraft,
  type SalesOrderDraftLine as DraftLine,
} from "@/lib/salesOrderDraftRecovery";
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

const toLineTotal = salesOrderLineTotal;

const draftLineKey = (line: {
  lineId?: string | null;
  productId: string;
  variantId?: string | null;
}) => line.lineId ?? `${line.productId}:${line.variantId ?? "BASE"}`;

export const SalesOrderForm = ({
  mode = "create",
  orderId,
}: {
  mode?: "create" | "edit";
  orderId?: string;
}) => {
  const isEdit = mode === "edit" && Boolean(orderId);
  const t = useTranslations("salesOrders");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session, status: sessionStatus } = useSession();
  const userId = session?.user?.id;
  const organizationId = session?.user?.organizationId;
  const owner = useMemo(
    () => userId && organizationId ? { userId, organizationId } : null,
    [userId, organizationId],
  );
  const ownerRef = useRef<{ userId: string; organizationId: string } | null>(null);
  ownerRef.current = owner;
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

  const orderQuery = trpc.salesOrders.getById.useQuery(
    { customerOrderId: orderId ?? "" },
    { enabled: isEdit, retry: false },
  );
  const isCompletedEdit = isEdit && orderQuery.data?.status === CustomerOrderStatus.COMPLETED;
  const paymentInfoQuery = trpc.salesOrders.paymentInfo.useQuery(
    { customerOrderId: orderId ?? "" },
    { enabled: isCompletedEdit && canPostSale, retry: false },
  );
  const canAmendCompleted = isCompletedEdit && canPostSale &&
    !paymentInfoQuery.isError && paymentInfoQuery.data?.canAppendUnpaidLine === true;
  const [priceMode, setPriceMode] = useState<"RETAIL" | "WHOLESALE">("RETAIL");
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | null>(null);
  const [orderLoaded, setOrderLoaded] = useState(false);
  const [missingPriceLineIds, setMissingPriceLineIds] = useState<string[]>([]);
  const [missingPriceLabels, setMissingPriceLabels] = useState<string[]>([]);
  const [staleConflict, setStaleConflict] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const updateAttemptRef = useRef<{ payload: string; idempotencyKey: string } | null>(null);
  const [initialEditSnapshot, setInitialEditSnapshot] = useState<string | null>(null);

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
  const [recoveryOwner, setRecoveryOwner] = useState("");
  const [storageFailed, setStorageFailed] = useState(false);
  const [draftStorageFailed, setDraftStorageFailed] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const draftIdRef = useRef<string | null>(null);
  const createAttemptRef = useRef<{
    payload: string;
    idempotencyKey: string;
    ownerKey: string;
  } | null>(null);
  const currentOwnerKey = () => (ownerRef.current ? JSON.stringify(ownerRef.current) : "");
  const ownerKey = currentOwnerKey();
  const recoveryLoaded = isEdit || Boolean(ownerKey && recoveryOwner === ownerKey);

  const fillNewOrder = useCallback((draft: SalesOrderDraft | null) => {
    setDraftLines(draft?.lines ?? []);
    setStoreId(draft?.storeId ?? "");
    setPriceMode(draft?.priceMode ?? "RETAIL");
    setSelectedCustomer(draft?.selectedCustomer ?? null);
    setCustomerSelectionTouched(draft?.customerSelectionTouched ?? false);
    setCustomerName(draft?.customerName ?? "");
    setCustomerEmail(draft?.customerEmail ?? "");
    setCustomerPhone(draft?.customerPhone ?? "");
    setCustomerAddress(draft?.customerAddress ?? "");
    setNotes(draft?.notes ?? "");
    setLineSearch(draft?.lineSearch ?? "");
    setPendingQty(draft?.pendingQty ?? "1");
    setShowCustomerDetails(false);
    setIsRefreshingPrices(false);
    setPricingFailed(false);
    setMissingPriceLineIds([]);
    setMissingPriceLabels([]);
  }, []);

  useEffect(() => {
    if (isEdit) return;
    setStorageFailed(false);
    setDraftStorageFailed(false);
    pendingSaleRef.current = null;
    setPendingSale(null);
    createAttemptRef.current = null;
    let draft: SalesOrderDraft | null = null;
    if (owner) {
      try {
        const pending = readPendingSalesOrderSale(window.sessionStorage, owner);
        pendingSaleRef.current = pending;
        setPendingSale(pending);
      } catch {
        setStorageFailed(true);
      }
      try {
        draft = readSalesOrderDraft(window.sessionStorage, owner);
        if (draft?.saveAttempt) createAttemptRef.current = { ...draft.saveAttempt, ownerKey };
      } catch {
        setDraftStorageFailed(true);
      }
    }
    // While replaying a pending sale, keep the token that belongs to it.
    draftIdRef.current = pendingSaleRef.current && draft ? draft.id : crypto.randomUUID();
    fillNewOrder(draft);
    setDraftRestored(Boolean(draft));
    setRecoveryOwner(ownerKey);
  }, [isEdit, owner, ownerKey, fillNewOrder]);

  useEffect(() => {
    if (isEdit || !recoveryLoaded) return;
    if (!storeId && storesQuery.data?.[0]) {
      const available = requestedStoreId
        ? storesQuery.data.find((store) => store.id === requestedStoreId)
        : storesQuery.data[0];
      if (available) setStoreId(available.id);
    }
  }, [isEdit, recoveryLoaded, storeId, storesQuery.data, requestedStoreId]);

  const selectedStore = storesQuery.data?.find((store) => store.id === storeId) ?? null;
  const needsDraftStore = !isEdit && Boolean(storeId && storesQuery.data && !selectedStore);
  const hasLocalDraft = Boolean(
    draftLines.length || selectedCustomer || customerName || customerEmail || customerPhone ||
    customerAddress || notes || lineSearch || pendingQty !== "1" || priceMode !== "RETAIL",
  );

  const persistNewOrder = useCallback(() => {
    const draftId = draftIdRef.current;
    if (
      isEdit || !recoveryLoaded || !owner || ownerRef.current !== owner ||
      !draftId || pendingSaleRef.current
    ) return;
    const attempt = createAttemptRef.current;
    try {
      if (hasLocalDraft || attempt) {
        writeSalesOrderDraft(window.sessionStorage, owner, {
          id: draftId,
          storeId,
          priceMode,
          selectedCustomer,
          customerSelectionTouched,
          customerName,
          customerEmail,
          customerPhone,
          customerAddress,
          notes,
          lineSearch,
          pendingQty,
          lines: draftLines,
          saveAttempt: attempt && {
            payload: attempt.payload,
            idempotencyKey: attempt.idempotencyKey,
          },
        });
        setDraftStorageFailed(false);
      } else {
        clearSalesOrderDraft(window.sessionStorage, owner, draftId);
      }
    } catch {
      setDraftStorageFailed(true);
    }
  }, [
    isEdit, recoveryLoaded, owner, hasLocalDraft, storeId, priceMode, selectedCustomer,
    customerSelectionTouched, customerName, customerEmail, customerPhone, customerAddress,
    notes, lineSearch, pendingQty, draftLines,
  ]);

  useEffect(() => {
    persistNewOrder();
  }, [persistNewOrder]);

  const forgetNewOrder = () => {
    const owner = ownerRef.current;
    const draftId = draftIdRef.current;
    if (!owner || !draftId) return;
    try {
      clearSalesOrderDraft(window.sessionStorage, owner, draftId);
      setDraftStorageFailed(false);
    } catch {
      setDraftStorageFailed(true);
    }
    draftIdRef.current = null;
  };
  // Edit mode keeps the document currency snapshot: the store rate may change
  // later without silently reinterpreting saved KGS line values.
  const documentCurrencySource = salesOrderDocumentCurrencySource({
    isEdit,
    order: orderQuery.data,
    store: selectedStore,
  });
  const currencyCode = resolveCurrency(documentCurrencySource).currencyCode;
  const priceTypesEnabled = Boolean(selectedStore?.organization?.retailWholesaleEnabled);
  const manualLineCount = draftLines.filter(
    (line) => line.priceEdited || line.priceSource === "MANUAL",
  ).length;

  useEffect(() => {
    if (!isEdit || !orderQuery.data || orderLoaded) return;
    const order = orderQuery.data;
    const orderCurrency = salesOrderDocumentCurrencySource({
      isEdit: true,
      order,
      store: order.store,
    });
    setStoreId(order.storeId);
    setPriceMode(order.priceMode === "WHOLESALE" ? "WHOLESALE" : "RETAIL");
    setExpectedUpdatedAt(new Date(order.updatedAt).toISOString());
    setCustomerSelectionTouched(true);
    setSelectedCustomer(
      order.customerId
        ? {
            id: order.customerId,
            name: order.customerName ?? "",
            email: order.customerEmail ?? null,
            phone: order.customerPhone ?? null,
            address: order.customerAddress ?? null,
          }
        : null,
    );
    setCustomerName(order.customerName ?? "");
    setCustomerEmail(order.customerEmail ?? "");
    setCustomerPhone(order.customerPhone ?? "");
    setCustomerAddress(order.customerAddress ?? "");
    setNotes(order.notes ?? "");
    const lines: DraftLine[] = order.lines.map((line) => {
      const price = Number(line.unitPriceKgs);
      const manual =
        line.manualPrice || line.priceSource === "MANUAL" || line.priceSource === "LEGACY";
      const missing = line.priceSource === "MISSING";
      return {
        lineId: line.id,
        productId: line.productId,
        variantId: line.variantId ?? null,
        productName: line.product.name,
        productSku: line.product.sku,
        qty: line.qty,
        qtyInput: String(line.qty),
        isBundle: Boolean(line.product.isBundle),
        unitPriceKgs: missing ? null : price,
        lineTotalKgs: missing ? null : Number(line.lineTotalKgs),
        priceInput: missing ? "" : salesOrderPriceInput(price, orderCurrency),
        priceEdited: manual,
        priceTouched: false,
        priceSource: missing
          ? "MISSING"
          : manual
            ? "MANUAL"
            : line.priceSource === "WHOLESALE"
              ? "WHOLESALE"
              : line.priceSource === "RETAIL"
                ? "RETAIL"
                : "STANDARD",
        repriced: false,
      };
    });
    setDraftLines(lines);
    setOrderLoaded(true);
    setInitialEditSnapshot(
      JSON.stringify({
        storeId: order.storeId,
        priceMode: order.priceMode,
        customerId: order.customerId,
        customerName: order.customerName ?? "",
        customerEmail: order.customerEmail ?? "",
        customerPhone: order.customerPhone ?? "",
        customerAddress: order.customerAddress ?? "",
        notes: order.notes ?? "",
        lines: lines.map((line) => ({
          id: line.lineId,
          productId: line.productId,
          qty: line.qty,
          price: line.unitPriceKgs,
          manual: line.priceEdited,
        })),
      }),
    );
  }, [isEdit, orderLoaded, orderQuery.data]);

  const currentEditSnapshot = useMemo(
    () =>
      JSON.stringify({
        storeId,
        priceMode,
        customerId: selectedCustomer?.id ?? null,
        customerName,
        customerEmail,
        customerPhone,
        customerAddress,
        notes,
        lines: draftLines.map((line) => ({
          id: line.lineId ?? null,
          productId: line.productId,
          qty: line.qty,
          price: line.unitPriceKgs,
          manual: line.priceEdited,
        })),
      }),
    [
      storeId,
      priceMode,
      selectedCustomer?.id,
      customerName,
      customerEmail,
      customerPhone,
      customerAddress,
      notes,
      draftLines,
    ],
  );
  const editDirty = isEdit && initialEditSnapshot !== null && initialEditSnapshot !== currentEditSnapshot;

  useEffect(() => {
    if (!editDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [editDirty]);

  // Changing the selling store refreshes suggested prices without discarding negotiated prices.
  useEffect(() => {
    if (isEdit || !recoveryLoaded || pendingSaleRef.current) return;
    const currentLines = draftLinesRef.current;
    const store = storesQuery.data?.find((item) => item.id === storeId);
    if (!store || !currentLines.length) {
      setIsRefreshingPrices(false);
      setPricingFailed(false);
      return;
    }
    let active = true;
    setIsRefreshingPrices(true);
    setPricingFailed(false);
    void Promise.all(
      currentLines.map(async (line) => {
        if (line.priceEdited) {
          return {
            productId: line.productId,
            price: line.unitPriceKgs,
            priceSource: "MANUAL" as DraftLine["priceSource"],
          };
        }
        const resolved = await utils.salesOrders.linePrice.fetch({
          productId: line.productId,
          storeId,
          priceMode,
        });
        return {
          productId: line.productId,
          price: resolved.hasConfiguredPrice === false ? null : resolved.unitPriceKgs,
          priceSource: resolved.priceSource as DraftLine["priceSource"],
        };
      }),
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
              priceSource: line.priceEdited ? "MANUAL" : refreshed.priceSource,
              priceInput:
                line.priceEdited && parseSalesOrderPriceInput(line.priceInput, store) === price
                  ? line.priceInput
                  : price === null ? "" : salesOrderPriceInput(price, store),
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
  }, [isEdit, recoveryLoaded, storeId, priceMode, pricingRevision, storesQuery.data, utils]);

  const chooseCustomer = (customer: SalesOrderCustomerOption | null) => {
    setCustomerSelectionTouched(true);
    setSelectedCustomer(customer);
    setCustomerName(customer?.name ?? "");
    setCustomerEmail(customer?.email ?? "");
    setCustomerPhone(customer?.phone ?? "");
    setCustomerAddress(customer?.address ?? "");
  };

  const quotePriceModeMutation = trpc.salesOrders.quotePriceMode.useMutation();

  const productSearchQuery = trpc.products.searchQuick.useQuery(
    { q: debouncedLineSearch, storeId: storeId || undefined, limit: 50 },
    {
      enabled:
        recoveryLoaded && Boolean(isEdit ? storeId : selectedStore) && debouncedLineSearch.length >= 1,
      keepPreviousData: false,
    },
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
      forgetNewOrder();
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
      forgetNewOrder();
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
  const updateMutation = trpc.salesOrders.update.useMutation({
    onSuccess: async (order) => {
      updateAttemptRef.current = null;
      setStaleConflict(false);
      await Promise.all([
        utils.salesOrders.list.invalidate(),
        utils.salesOrders.getById.invalidate({ customerOrderId: order.id }),
        ...(isCompletedEdit ? [utils.salesOrders.paymentInfo.invalidate({ customerOrderId: order.id })] : []),
      ]);
      toast({ variant: "success", description: t("workspace.updateSuccess") });
      router.push(`/sales/orders/${order.id}?returnTo=${encodeURIComponent(returnTo)}`);
    },
    onError: (error) => {
      const stale = error.message.includes("salesOrderStale") || error.message.includes("salesOrderAmendmentStale");
      if (stale) setStaleConflict(true);
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const isSaving =
    createMutation.isLoading ||
    saleMutation.isLoading ||
    updateMutation.isLoading ||
    savingEdit ||
    (isEdit && (!orderLoaded || orderQuery.isLoading)) ||
    Boolean(pendingSale) ||
    !recoveryLoaded ||
    storageFailed;

  const addDraftLine = async (product: ProductSearchResult): Promise<boolean> => {
    if (addingLineRef.current || isRefreshingPrices || isSaving || submissionRef.current)
      return false;
    if (!storeId || (!isEdit && !selectedStore)) {
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
    let resolvedSource: DraftLine["priceSource"] = "STANDARD";
    const requestOwner = currentOwnerKey();
    const requestDraftId = draftIdRef.current;
    addingLineRef.current = true;
    setIsAddingLine(true);
    try {
      const pricing = await utils.salesOrders.linePrice.fetch({
        productId: product.id,
        storeId,
        priceMode,
      });
      if (currentOwnerKey() !== requestOwner || draftIdRef.current !== requestDraftId) {
        return false;
      }
      unitPriceKgs = pricing.hasConfiguredPrice === false ? null : pricing.unitPriceKgs;
      resolvedSource = pricing.priceSource as DraftLine["priceSource"];
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
      const index = current.findIndex(
        (line) => line.productId === product.id && (line.variantId ?? null) === null,
      );
      if (index === -1) {
        return [
          ...current,
          {
            productId: product.id,
            variantId: null,
            productName: product.name,
            productSku: product.sku,
            qty: normalizedQty,
            qtyInput: String(normalizedQty),
            isBundle: Boolean(product.isBundle),
            unitPriceKgs,
            lineTotalKgs: toLineTotal(normalizedQty, unitPriceKgs),
            priceInput:
              unitPriceKgs === null ? "" : salesOrderPriceInput(unitPriceKgs, documentCurrencySource),
            priceEdited: false,
            priceTouched: false,
            priceSource: unitPriceKgs === null ? "MISSING" : resolvedSource,
            repriced: false,
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
            : salesOrderPriceInput(currentPrice, documentCurrencySource),
        lineTotalKgs: toLineTotal(nextQty, currentPrice),
      };
      return next;
    });
    setPendingQty("1");
    setMissingPriceLineIds([]);
    setMissingPriceLabels([]);
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

  const updateDraftLineQty = (key: string, rawValue: string) => {
    setDraftLines((current) =>
      current.map((line) =>
        draftLineKey(line) === key
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

  const removeDraftLine = (key: string) => {
    setMissingPriceLineIds([]);
    setMissingPriceLabels([]);
    setDraftLines((current) => current.filter((line) => draftLineKey(line) !== key));
    if (pricingFailed) setPricingRevision((revision) => revision + 1);
  };

  const updateDraftLinePrice = (key: string, rawValue: string) => {
    if (!isEdit && !selectedStore) return;
    const price = parseSalesOrderPriceInput(rawValue, documentCurrencySource);
    setMissingPriceLineIds([]);
    setMissingPriceLabels([]);
    setDraftLines((current) =>
      current.map((line) =>
        draftLineKey(line) === key
          ? {
              ...line,
              priceInput: rawValue,
              priceEdited: true,
              priceTouched: true,
              priceSource: "MANUAL",
              repriced: true,
              unitPriceKgs: price,
              lineTotalKgs: line.qty > 0 ? toLineTotal(line.qty, price) : null,
            }
          : line,
      ),
    );
  };

  const changePriceMode = async (nextMode: "RETAIL" | "WHOLESALE") => {
    if (nextMode === priceMode || isSaving || isRefreshingPrices) return;
    const requestOwner = currentOwnerKey();
    const requestDraftId = draftIdRef.current;
    const isCurrentDraft = () =>
      currentOwnerKey() === requestOwner && draftIdRef.current === requestDraftId;
    if (!selectedStore?.organization?.retailWholesaleEnabled) {
      setPriceMode(nextMode);
      return;
    }
    if (!draftLines.length) {
      setPriceMode(nextMode);
      return;
    }
    const manualLines = draftLines.filter(
      (line) => line.priceEdited || line.priceSource === "MANUAL",
    );
    let applyToManual = false;
    if (manualLines.length) {
      applyToManual = await confirm({
        title: t("priceModeConfirmTitle"),
        description: t("priceModeConfirmDescription", { count: manualLines.length }),
        confirmLabel: t("priceModeReplaceAll"),
        cancelLabel: t("priceModeKeepManual"),
        confirmVariant: "danger",
      });
    }
    if (!isCurrentDraft()) return;
    setIsRefreshingPrices(true);
    setPricingFailed(false);
    try {
      const quote = await quotePriceModeMutation.mutateAsync({
        storeId,
        priceMode: nextMode,
        lines: draftLines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId ?? null,
        })),
      });
      if (!isCurrentDraft()) return;
      const byKey = new Map(
        quote.items.map((item) => [`${item.productId}:${item.variantId ?? "BASE"}`, item]),
      );
      const missingLines = draftLines.filter((line) => {
        const item = byKey.get(`${line.productId}:${line.variantId ?? "BASE"}`);
        if (!item) return false;
        if ((line.priceEdited || line.priceSource === "MANUAL") && !applyToManual) return false;
        return !item.hasConfiguredPrice;
      });
      const missing = missingLines.map((line) => line.lineId ?? line.productId);
      setMissingPriceLabels(missingLines.map((line) => line.productName));
      setDraftLines((current) =>
        current.map((line) => {
          const item = byKey.get(`${line.productId}:${line.variantId ?? "BASE"}`);
          if (!item) return line;
          if ((line.priceEdited || line.priceSource === "MANUAL") && !applyToManual) return line;
          if (!item.hasConfiguredPrice) {
            return {
              ...line,
              unitPriceKgs: null,
              lineTotalKgs: null,
              priceInput: "",
              priceEdited: false,
              priceTouched: false,
              priceSource: "MISSING" as const,
              repriced: true,
            };
          }
          return {
            ...line,
            unitPriceKgs: item.unitPriceKgs,
            lineTotalKgs: toLineTotal(line.qty, item.unitPriceKgs),
            priceInput: salesOrderPriceInput(item.unitPriceKgs, documentCurrencySource),
            priceEdited: false,
            priceTouched: false,
            priceSource: item.priceSource as DraftLine["priceSource"],
            repriced: true,
          };
        }),
      );
      setMissingPriceLineIds(missing);
      setPriceMode(nextMode);
    } catch (error) {
      if (isCurrentDraft()) {
        toast({
          variant: "error",
          description: translateError(tErrors, error as Parameters<typeof translateError>[1]),
        });
      }
    } finally {
      if (isCurrentDraft()) setIsRefreshingPrices(false);
    }
  };

  const handleCreate = async (postSale = false) => {
    if (submissionRef.current || isSaving) return;
    const attemptOwner = ownerRef.current;
    if (!attemptOwner) return;
    const attemptOwnerKey = JSON.stringify(attemptOwner);
    if (!selectedStore) {
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

    if (draftLines.some((line) => line.priceEdited && line.unitPriceKgs === null)) {
      toast({ variant: "error", description: t("unitPriceInvalid") });
      return;
    }
    // BZR-03: a draft may be saved while a loaded line is still missing its
    // price; only posting requires every line to have a price.
    if (postSale && draftLines.some((line) => line.unitPriceKgs === null)) {
      toast({ variant: "error", description: t("priceNotSetBlocking") });
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
      priceMode,
      ...(customerSelectionTouched ? { customerId: selectedCustomer?.id ?? null } : {}),
      customerName: customerName.trim() || null,
      customerEmail: customerEmail.trim() || null,
      customerPhone: customerPhone.trim() || null,
      customerAddress: customerAddress.trim() || null,
      notes: notes.trim() || null,
      lines: draftLines.map((line) => ({
        productId: line.productId,
        variantId: line.variantId ?? null,
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
            total: formatKgsMoney(orderTotalKgs, locale, documentCurrencySource),
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
        persistNewOrder();
        const pending: PendingSalesOrderSale = {
          version: 1,
          ...attemptOwner,
          input: { ...payload, idempotencyKey },
          storeName: selectedStore?.name ?? "",
          totalLabel: formatKgsMoney(orderTotalKgs, locale, documentCurrencySource),
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
      } else {
        persistNewOrder();
        await createMutation.mutateAsync({ ...payload, idempotencyKey });
      }
    } catch {
      // The mutation shows its translated error. Keep the draft and retry key.
    } finally {
      submissionRef.current = false;
    }
  };

  const handleUpdate = async () => {
    if (!isEdit || !orderId || !expectedUpdatedAt) return;
    if (submissionRef.current || isSaving) return;
    if (isCompletedEdit && (!canAmendCompleted || !draftLines.length)) return;
    if (!storeId) {
      toast({ variant: "error", description: t("storeRequired") });
      return;
    }
    if (isRefreshingPrices || isAddingLine || pricingFailed) return;
    if (
      draftLines.some(
        (line) => line.qty <= 0 || !Number.isFinite(line.qty),
      )
    ) {
      toast({ variant: "error", description: t("qtyPositive") });
      return;
    }
    if (draftLines.some((line) => line.priceEdited && line.unitPriceKgs === null)) {
      toast({ variant: "error", description: t("unitPriceInvalid") });
      return;
    }
    if (
      customerEmail.trim() &&
      !z.string().email().max(254).safeParse(customerEmail.trim()).success
    ) {
      toast({ variant: "error", description: tErrors("customerEmailInvalid") });
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
      customerOrderId: orderId,
      expectedUpdatedAt,
      ...(isCompletedEdit ? { amendCompleted: true as const } : {}),
      storeId,
      priceMode,
      customerId: selectedCustomer?.id ?? null,
      customerName: customerName.trim() || null,
      customerEmail: customerEmail.trim() || null,
      customerPhone: customerPhone.trim() || null,
      customerAddress: customerAddress.trim() || null,
      notes: notes.trim() || null,
      lines: serializeSalesOrderUpdateLines(draftLines),
    };
    const serialized = JSON.stringify(payload);
    const idempotencyKey =
      updateAttemptRef.current?.payload === serialized
        ? updateAttemptRef.current.idempotencyKey
        : crypto.randomUUID();
    updateAttemptRef.current = { payload: serialized, idempotencyKey };
    submissionRef.current = true;
    setSavingEdit(true);
    try {
      await updateMutation.mutateAsync({ ...payload, idempotencyKey });
    } catch {
      // The mutation keeps the entered values and reports the conflict.
    } finally {
      setSavingEdit(false);
      submissionRef.current = false;
    }
  };

  const handleSubmit = async (postSale = false) => {
    if (isEdit) {
      await handleUpdate();
      return;
    }
    await handleCreate(postSale);
  };

  const discardNewOrder = async () => {
    const discardOwner = ownerKey;
    if (!(await confirm({
      description: t("workspace.discardLocalDraftHint"),
      confirmLabel: t("workspace.discardLocalDraft"),
      confirmVariant: "danger",
    }))) return;
    if (currentOwnerKey() !== discardOwner || submissionRef.current || pendingSaleRef.current) return;
    forgetNewOrder();
    draftIdRef.current = crypto.randomUUID();
    createAttemptRef.current = null;
    fillNewOrder(null);
    setDraftRestored(false);
  };

  const orderTotalKgs = useMemo(
    () =>
      draftLines.reduce((cents, line) => cents + Math.round((line.lineTotalKgs ?? 0) * 100), 0) /
      100,
    [draftLines],
  );
  const unresolvedPriceLineNames = useMemo(
    () => [
      ...new Set(
        draftLines.filter((line) => line.unitPriceKgs === null).map((line) => line.productName),
      ),
    ],
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
      ? lineInputsRef.current.get(`${draftLineKey(next)}:${field}`)
      : searchInputRef.current;
    input?.focus();
    input?.select();
  };

  if (isEdit && orderQuery.isLoading) {
    return (
      <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Spinner className="h-4 w-4" />
        {tCommon("loading")}
      </div>
    );
  }
  if (isEdit && orderQuery.error) {
    return (
      <QueryErrorState error={orderQuery.error} onRetry={() => void orderQuery.refetch()} />
    );
  }
  if (isCompletedEdit && (sessionStatus === "loading" || (canPostSale && paymentInfoQuery.isLoading))) {
    return (
      <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Spinner className="h-4 w-4" />
        {tCommon("loading")}
      </div>
    );
  }
  if (isCompletedEdit && paymentInfoQuery.error) {
    return (
      <QueryErrorState error={paymentInfoQuery.error} onRetry={() => void paymentInfoQuery.refetch()} />
    );
  }
  if (
    isEdit &&
    orderQuery.data &&
    orderQuery.data.status !== CustomerOrderStatus.DRAFT &&
    orderQuery.data.status !== CustomerOrderStatus.CONFIRMED &&
    !canAmendCompleted
  ) {
    return (
      <div className="mt-4 space-y-3">
        <p role="alert" className="rounded-md border border-danger/30 p-4 text-sm text-danger">
          {t("workspace.notEditable")}
        </p>
        <Button
          variant="secondary"
          type="button"
          onClick={() => router.push(`/sales/orders/${encodeURIComponent(orderId ?? "")}?returnTo=${encodeURIComponent(returnTo)}`)}
        >
          {tCommon("back")}
        </Button>
      </div>
    );
  }

  if (legacyReturnRedirect) {
    return <SalesOrderReturnRedirect href={legacyReturnRedirect} label={tCommon("loading")} />;
  }
  if (!recoveryLoaded) {
    return (
      <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Spinner className="h-4 w-4" />
        {tCommon("loading")}
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-4">
      <PageHeader
        title={
          isEdit
            ? t("workspace.editTitle", { number: orderQuery.data?.number ?? "" })
            : t("workspace.title")
        }
        subtitle={t(isCompletedEdit ? "workspace.editUnpaidSubtitle" : isEdit ? "workspace.editSubtitle" : "workspace.subtitle")}
        action={
          isEdit ? (
            <Button
              variant="secondary"
              onClick={async () => {
                if (
                  editDirty &&
                  !(await confirm({
                    description: t("workspace.discardConfirm"),
                    confirmLabel: t("workspace.discardConfirmAction"),
                    confirmVariant: "danger",
                  }))
                ) {
                  return;
                }
                router.push(
                  `/sales/orders/${encodeURIComponent(orderId ?? "")}?returnTo=${encodeURIComponent(returnTo)}`,
                );
              }}
            >
              {tCommon("back")}
            </Button>
          ) : undefined
        }
      />

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
      {!isEdit && !pendingSale && (hasLocalDraft || draftStorageFailed) ? (
        <div className="bazaar-doc-surface flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
          <p
            role={draftStorageFailed ? "alert" : "status"}
            className={`text-sm ${draftStorageFailed ? "text-danger" : "text-muted-foreground"}`}
          >
            {t(draftStorageFailed
              ? "workspace.localDraftStorageFailed"
              : draftRestored ? "workspace.localDraftRestored" : "workspace.localDraftSaved")}
          </p>
          {hasLocalDraft ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={discardNewOrder}
              disabled={isSaving || isAddingLine || isRefreshingPrices}
            >
              {t("workspace.discardLocalDraft")}
            </Button>
          ) : null}
        </div>
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
              disabled={isAddingLine || isRefreshingPrices || isSaving || isEdit}
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
            {isEdit ? (
              <p className="text-xs text-muted-foreground">{t("workspace.storeLockedHint")}</p>
            ) : null}
            {needsDraftStore ? (
              <p role="alert" className="text-xs text-danger">{t("workspace.localDraftStoreUnavailable")}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label>{t("customerCard")}</Label>
            <SalesOrderCustomerSelect
              storeId={storeId}
              customerId={selectedCustomer?.id ?? null}
              customerName={selectedCustomer?.name ?? ""}
              onSelect={chooseCustomer}
              disabled={isSaving || (!isEdit && !selectedStore)}
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
                disabled={!storeId || isSaving || (!isEdit && !selectedStore)}
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
                  currencySource={documentCurrencySource}
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
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold">{t("linesTitle")}</h2>
              <Badge variant="muted">
                {t("workspace.positionCount", { count: draftLines.length })}
              </Badge>
            </div>
            {priceTypesEnabled ? (
              <div className="flex items-center gap-2">
                <Label htmlFor="sales-order-price-mode" className="text-xs text-muted-foreground">
                  {t("priceMode.Label")}
                </Label>
                <Select
                  value={priceMode}
                  onValueChange={(value) =>
                    void changePriceMode(value === "WHOLESALE" ? "WHOLESALE" : "RETAIL")
                  }
                  disabled={isRefreshingPrices || isSaving}
                >
                  <SelectTrigger
                    id="sales-order-price-mode"
                    className="h-9 w-[130px]"
                    data-testid="sales-order-price-mode"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RETAIL">{t("priceMode.retail")}</SelectItem>
                    <SelectItem value="WHOLESALE">{t("priceMode.wholesale")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
          {priceTypesEnabled && manualLineCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("priceMode.manualKept", { count: manualLineCount })}
            </p>
          ) : null}
          {missingPriceLineIds.length > 0 ? (
            <div
              role="alert"
              className="flex gap-2 rounded-md border border-danger/40 bg-danger/10 p-2 text-sm text-danger"
              data-testid="price-mode-missing"
            >
              <StatusWarningIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div className="space-y-1">
                <p>{t("priceMode.missingInline", { count: missingPriceLineIds.length })}</p>
                {missingPriceLabels.length ? (
                  <p className="text-xs">{missingPriceLabels.join(", ")}</p>
                ) : null}
              </div>
            </div>
          ) : null}
          <p className="text-xs leading-5 text-muted-foreground">{t("workspace.keyboardHint")}</p>
          {draftLines.length ? (
            <div className="space-y-2">
              {draftLines.map((line, index) => (
                <div
                  key={line.lineId ?? `${line.productId}:${line.variantId ?? "BASE"}`}
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
                          : formatKgsMoney(line.lineTotalKgs, locale, documentCurrencySource)}
                      </span>
                    </p>
                    {line.priceSource === "MISSING" ? (
                      <p className="text-xs font-medium text-danger">
                        {t("priceMode.missingLine", {
                          mode:
                            priceMode === "WHOLESALE"
                              ? t("priceMode.wholesale")
                              : t("priceMode.retail"),
                        })}
                      </p>
                    ) : null}
                  </div>
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_2.25rem] items-end gap-2 md:contents">
                    <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                      <span>{t("qty")}</span>
                      <Input
                        ref={(node) => {
                          if (node) lineInputsRef.current.set(`${draftLineKey(line)}:qty`, node);
                          else lineInputsRef.current.delete(`${draftLineKey(line)}:qty`);
                        }}
                        type="text"
                        inputMode="decimal"
                        value={line.qtyInput}
                        aria-label={`${t("qty")} · ${line.productName}`}
                        aria-invalid={line.qty <= 0}
                        onChange={(event) => updateDraftLineQty(draftLineKey(line), event.target.value)}
                        onKeyDown={(event) => focusNextLine(event, index, "qty")}
                        className="h-10 w-full"
                        disabled={isRefreshingPrices || isSaving}
                      />
                    </label>
                    <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                      <span className="whitespace-nowrap">
                        {t("unitPriceShort")} · {currencyCode}
                      </span>
                      <PriceInput
                        ref={(node) => {
                          if (node) lineInputsRef.current.set(`${draftLineKey(line)}:price`, node);
                          else lineInputsRef.current.delete(`${draftLineKey(line)}:price`);
                        }}
                        value={line.priceInput}
                        onChange={(event) =>
                          updateDraftLinePrice(draftLineKey(line), event.target.value)
                        }
                        onKeyDown={(event) => focusNextLine(event, index, "price")}
                        placeholder={t("priceNotSetShort")}
                        aria-label={`${t("unitPrice")} · ${line.productName}`}
                        aria-invalid={line.priceEdited && line.unitPriceKgs === null}
                        className="h-10 w-full"
                        disabled={
                          !canSetPrice || isRefreshingPrices || isSaving || (!isEdit && !selectedStore)
                        }
                      />
                    </label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-10 w-9"
                          onClick={() => removeDraftLine(draftLineKey(line))}
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
              {formatKgsMoney(orderTotalKgs, locale, documentCurrencySource)}
            </strong>
          </div>
          {unresolvedPriceLineNames.length ? (
            <div className="space-y-1 text-xs text-danger" role="alert">
              <p>{t("priceNotSetBlocking")}</p>
              <p>{unresolvedPriceLineNames.join(", ")}</p>
            </div>
          ) : null}
          {staleConflict ? (
            <div role="alert" className="rounded-md border border-danger/30 p-3 text-sm text-danger">
              <p>{t("workspace.staleConflict")}</p>
              <p className="mt-1 text-xs">{t("workspace.staleConflictHint")}</p>
            </div>
          ) : null}
          {!isEdit ? (
            <p className="text-xs leading-5 text-muted-foreground">{t("workspace.postHint")}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {canPostSale && !isEdit ? (
              <Button
                type="button"
                className="min-h-10 flex-1"
                onClick={() => void handleSubmit(true)}
                disabled={
                  isSaving ||
                  isRefreshingPrices ||
                  isAddingLine ||
                  pricingFailed ||
                  !selectedStore ||
                  !draftLines.length ||
                  draftLines.some((line) => line.unitPriceKgs === null)
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
              variant={canPostSale && !isEdit ? "secondary" : "primary"}
              className="min-h-10 flex-1"
              onClick={() => void handleSubmit(false)}
              disabled={
                isSaving || isRefreshingPrices || isAddingLine || pricingFailed ||
                (isEdit ? !storeId : !selectedStore) || (isCompletedEdit && !draftLines.length)
              }
              data-testid="sales-order-save"
            >
              {createMutation.isLoading || updateMutation.isLoading ? (
                <Spinner className="h-4 w-4" />
              ) : null}
              {isEdit ? t("workspace.saveChanges") : t("workspace.saveDraft")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={async () => {
                if (
                  editDirty &&
                  !(await confirm({
                    description: t("workspace.discardConfirm"),
                    confirmLabel: t("workspace.discardConfirmAction"),
                    confirmVariant: "danger",
                  }))
                ) {
                  return;
                }
                router.push(returnTo);
              }}
              disabled={isSaving}
            >
              {isEdit ? tCommon("cancel") : tCommon("back")}
            </Button>
          </div>
        </section>
      </div>
      {confirmDialog}
    </div>
  );
};

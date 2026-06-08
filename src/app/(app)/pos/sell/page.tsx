"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PosPaymentMethod } from "@prisma/client";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import {
  BackIcon,
  AddIcon,
  ChevronDownIcon,
  CloseIcon,
  DeleteIcon,
  DownloadIcon,
  EmptyIcon,
  PrintIcon,
  SearchIcon,
  StatusWarningIcon,
  TagIcon,
} from "@/components/icons";
import { ScanInput } from "@/components/ScanInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PopoverSurface } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import {
  currencySourceWithFallback,
  displayMoneyFromKgs,
  displayMoneyToKgs,
  formatKgsMoney,
  resolveCurrency,
} from "@/lib/currencyDisplay";
import { formatNumber } from "@/lib/i18nFormat";
import { getQzTrayBinding, printPdfBlobViaQzTray, qzTrayErrorMessageKey } from "@/lib/qzTrayPrint";
import { downloadPdfBlob, fetchPdfBlob, printPdfBlob } from "@/lib/pdfClient";
import {
  createDefaultPosPaymentDraft,
  type PosPaymentAutoFillState,
  type PosPaymentDraft,
  reconcilePosPaymentDraftsForSaleTotal,
} from "@/lib/posPaymentDrafts";
import { normalizeScanValue } from "@/lib/scanning/normalize";
import { useSse } from "@/lib/useSse";
import {
  resolveScanResult,
  shouldSubmitFromKey,
  type ScanResolvedResult,
} from "@/lib/scanning/scanRouter";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const selectedRegisterKey = "pos:selected-register";
const keyboardScanResetMs = 300;
const keyboardScanMaxLength = 128;

const isEditableElement = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  if (target.closest("[contenteditable='true']")) {
    return true;
  }
  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
};

const createIdempotencyKey = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `pos-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const useDebouncedValue = (value: string, delayMs: number) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
};

const hasTouchKeyboard = () => {
  if (typeof window === "undefined") {
    return false;
  }
  return (
    (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches) ||
    (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0)
  );
};

type PosCustomerSelection = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

const PosSellPage = () => {
  const t = useTranslations("pos");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const trpcUtils = trpc.useUtils();
  const { toast } = useToast();

  const [registerId, setRegisterId] = useState(searchParams.get("registerId") ?? "");
  const [saleId, setSaleId] = useState<string | null>(null);
  const [lineSearch, setLineSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [markingInput, setMarkingInput] = useState<Record<string, string>>({});
  const [payments, setPayments] = useState<PosPaymentDraft[]>([createDefaultPosPaymentDraft()]);
  const [discountDraft, setDiscountDraft] = useState("");
  const [discountEditorOpen, setDiscountEditorOpen] = useState(false);
  const [sellInDebt, setSellInDebt] = useState(false);
  const [debtFullName, setDebtFullName] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<PosCustomerSelection | null>(null);
  const [customerSelectorOpen, setCustomerSelectorOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerCreateOpen, setCustomerCreateOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [newCustomerEmail, setNewCustomerEmail] = useState("");
  const [lastCompletedSale, setLastCompletedSale] = useState<{
    id: string;
    number: string;
    kkmStatus: "NOT_SENT" | "SENT" | "FAILED";
  } | null>(null);
  const [receiptAction, setReceiptAction] = useState<{
    mode: "download" | "print";
    kind: "precheck" | "fiscal";
  } | null>(null);
  const [autoReceiptStatus, setAutoReceiptStatus] = useState<
    "idle" | "printing" | "ready" | "blocked" | "failed"
  >("idle");
  const [mobileCheckoutOpen, setMobileCheckoutOpen] = useState(false);
  const [isPhoneScreen, setIsPhoneScreen] = useState<boolean | null>(null);
  const lineSearchInputRef = useRef<HTMLInputElement | null>(null);
  const paymentsSectionRef = useRef<HTMLDivElement | null>(null);
  const firstPaymentAmountRef = useRef<HTMLInputElement | null>(null);
  const keyboardScanBufferRef = useRef("");
  const keyboardScanResetTimerRef = useRef<number | null>(null);
  const keyboardScanSubmittingRef = useRef(false);
  const autoPrintedSaleIdRef = useRef<string | null>(null);
  const paymentAutoFillRef = useRef<PosPaymentAutoFillState>({
    saleId: null,
    totalKgs: null,
  });

  const registersQuery = trpc.pos.registers.list.useQuery();
  const selectedRegister = (registersQuery.data ?? []).find((item) => item.id === registerId);
  const enableSku = selectedRegister?.store.enableSku ?? true;
  const enableBarcode = selectedRegister?.store.enableBarcode ?? true;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (registerId) {
      window.localStorage.setItem(selectedRegisterKey, registerId);
      return;
    }
    const saved = window.localStorage.getItem(selectedRegisterKey);
    if (saved) {
      setRegisterId(saved);
    }
  }, [registerId]);

  useEffect(() => {
    if (registerId || !registersQuery.data?.[0]) {
      return;
    }
    setRegisterId(registersQuery.data[0].id);
  }, [registerId, registersQuery.data]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      setIsPhoneScreen(false);
      return;
    }

    const phoneQuery = window.matchMedia("(max-width: 767px)");
    const updatePhoneScreen = () => setIsPhoneScreen(phoneQuery.matches);

    updatePhoneScreen();
    phoneQuery.addEventListener("change", updatePhoneScreen);

    return () => {
      phoneQuery.removeEventListener("change", updatePhoneScreen);
    };
  }, []);

  const shiftQuery = trpc.pos.shifts.current.useQuery(
    { registerId },
    { enabled: Boolean(registerId), refetchOnWindowFocus: true },
  );

  const saleQuery = trpc.pos.sales.get.useQuery(
    { saleId: saleId ?? "" },
    { enabled: Boolean(saleId), refetchOnWindowFocus: true },
  );
  const activeDraftQuery = trpc.pos.sales.activeDraft.useQuery(
    { registerId },
    { enabled: Boolean(registerId && shiftQuery.data?.id), refetchOnWindowFocus: true },
  );

  const focusLineSearchInput = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.requestAnimationFrame(() => {
      if (hasTouchKeyboard()) {
        lineSearchInputRef.current?.blur();
        return;
      }
      lineSearchInputRef.current?.focus();
      lineSearchInputRef.current?.select();
    });
  }, []);

  const blurLineSearchInput = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.requestAnimationFrame(() => {
      lineSearchInputRef.current?.blur();
    });
  }, []);

  const focusPaymentsInput = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.requestAnimationFrame(() => {
      paymentsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      firstPaymentAmountRef.current?.focus();
      firstPaymentAmountRef.current?.select();
    });
  }, []);

  const debouncedLineSearch = useDebouncedValue(lineSearch.trim(), 180);
  const debouncedCustomerSearch = useDebouncedValue(customerSearch.trim(), 200);
  const searchTerm = debouncedLineSearch;
  const hasSearchTerm = lineSearch.trim().length >= 1;
  const activeStoreId = shiftQuery.data?.store.id;
  const receiptPrintSettingsQuery = trpc.stores.hardware.useQuery(
    { storeId: activeStoreId ?? "" },
    { enabled: Boolean(activeStoreId), staleTime: 60_000 },
  );
  const receiptPrintSettings = receiptPrintSettingsQuery.data?.settings;
  const productsBootstrapQuery = trpc.products.bootstrap.useQuery(
    { storeId: activeStoreId, page: 1, pageSize: 1 },
    { enabled: Boolean(activeStoreId), staleTime: 60_000 },
  );
  const catalogProductsQuery = trpc.products.list.useQuery(
    {
      search: searchTerm || undefined,
      category: selectedCategory || undefined,
      storeId: activeStoreId,
      page: 1,
      pageSize: 80,
      sortKey: "name",
      sortDirection: "asc",
    },
    { enabled: Boolean(activeStoreId) },
  );
  const customerSearchQuery = trpc.pos.customers.search.useQuery(
    {
      storeId: activeStoreId ?? "",
      search: debouncedCustomerSearch || undefined,
      pageSize: 20,
    },
    {
      enabled: customerSelectorOpen && Boolean(activeStoreId),
      staleTime: 15_000,
    },
  );

  const createDraftMutation = trpc.pos.sales.createDraft.useMutation({
    onSuccess: (sale) => {
      setSaleId(sale.id);
      setPayments([createDefaultPosPaymentDraft()]);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const addLineMutation = trpc.pos.sales.addLine.useMutation({
    onSuccess: () => {
      setLineSearch("");
      focusLineSearchInput();
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const updateLineMutation = trpc.pos.sales.updateLine.useMutation({
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const removeLineMutation = trpc.pos.sales.removeLine.useMutation({
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const updateDiscountMutation = trpc.pos.sales.updateDiscount.useMutation({
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const upsertMarkingCodesMutation = trpc.pos.sales.upsertMarkingCodes.useMutation({
    onSuccess: (result) => {
      setMarkingInput((current) => ({
        ...current,
        [result.lineId]: result.codes.join(", "),
      }));
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const cancelDraftMutation = trpc.pos.sales.cancelDraft.useMutation({
    onSuccess: async () => {
      setSaleId(null);
      setLineSearch("");
      setPayments([createDefaultPosPaymentDraft()]);
      setDiscountDraft("");
      setDiscountEditorOpen(false);
      setSellInDebt(false);
      setDebtFullName("");
      setSelectedCustomer(null);
      setCustomerSelectorOpen(false);
      setCustomerSearch("");
      setCustomerCreateOpen(false);
      setMobileCheckoutOpen(true);
      paymentAutoFillRef.current = { saleId: null, totalKgs: null };
      await Promise.all([activeDraftQuery.refetch(), trpcUtils.pos.sales.list.invalidate()]);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const updateCustomerMutation = trpc.pos.sales.updateCustomer.useMutation({
    onSuccess: async (result) => {
      setSelectedCustomer(
        result.customerName || result.customerEmail || result.customerPhone
          ? {
              id: "",
              name: result.customerName ?? result.customerEmail ?? result.customerPhone ?? "",
              email: result.customerEmail,
              phone: result.customerPhone,
            }
          : null,
      );
      await Promise.all([
        saleId ? trpcUtils.pos.sales.get.invalidate({ saleId }) : Promise.resolve(),
        activeDraftQuery.refetch(),
      ]);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const createCustomerMutation = trpc.pos.customers.create.useMutation({
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const completeMutation = trpc.pos.sales.complete.useMutation({
    onSuccess: async (result) => {
      setLastCompletedSale({
        id: result.id,
        number: result.number,
        kkmStatus: result.kkmStatus,
      });
      setAutoReceiptStatus("idle");
      setSaleId(null);
      setPayments([createDefaultPosPaymentDraft()]);
      setDiscountDraft("");
      setDiscountEditorOpen(false);
      setSellInDebt(false);
      setDebtFullName("");
      setSelectedCustomer(null);
      setCustomerSelectorOpen(false);
      setCustomerSearch("");
      setCustomerCreateOpen(false);
      setMobileCheckoutOpen(true);
      paymentAutoFillRef.current = { saleId: null, totalKgs: null };
      await Promise.all([
        shiftQuery.refetch(),
        activeDraftQuery.refetch(),
        trpcUtils.pos.sales.list.invalidate(),
      ]);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const sale = saleQuery.data;
  const activeDraft = activeDraftQuery.data;
  const currencySource = currencySourceWithFallback(
    sale,
    currencySourceWithFallback(
      shiftQuery.data,
      shiftQuery.data?.store ?? selectedRegister?.store ?? null,
    ),
  );
  const saleIdForPaymentInit = saleQuery.data?.id;
  const saleTotalForPaymentInit = saleQuery.data?.totalKgs;
  const saleCustomerName = sale?.customerName ?? null;
  const saleCustomerEmail = sale?.customerEmail ?? null;
  const saleCustomerPhone = sale?.customerPhone ?? null;
  const saleMarkingEnabled = sale?.store.complianceProfile?.enableMarking ?? false;
  const saleMarkingMode = sale?.store.complianceProfile?.markingMode;

  useSse({
    "shift.opened": () => {
      void Promise.all([
        shiftQuery.refetch(),
        registersQuery.refetch(),
        activeDraftQuery.refetch(),
      ]);
    },
    "shift.closed": () => {
      void Promise.all([
        shiftQuery.refetch(),
        registersQuery.refetch(),
        activeDraftQuery.refetch(),
      ]);
    },
    "sale.completed": () => {
      void Promise.all([activeDraftQuery.refetch(), trpcUtils.pos.sales.list.invalidate()]);
    },
    "debt.settled": () => {
      void Promise.all([shiftQuery.refetch(), trpcUtils.pos.sales.list.invalidate()]);
    },
  });

  useEffect(() => {
    if (!saleIdForPaymentInit || saleTotalForPaymentInit === undefined) {
      return;
    }
    if (sellInDebt) {
      return;
    }
    const previousAutoFill = paymentAutoFillRef.current;
    setPayments((currentPayments) => {
      const next = reconcilePosPaymentDraftsForSaleTotal({
        currentPayments,
        saleId: saleIdForPaymentInit,
        totalKgs: saleTotalForPaymentInit,
        displayTotal: roundMoney(displayMoneyFromKgs(saleTotalForPaymentInit, currencySource)),
        previousAutoFill,
      });
      return next.payments;
    });
    paymentAutoFillRef.current = {
      saleId: saleIdForPaymentInit,
      totalKgs: saleTotalForPaymentInit,
    };
  }, [currencySource, saleIdForPaymentInit, saleTotalForPaymentInit, sellInDebt]);

  useEffect(() => {
    if (!sale) {
      setDiscountDraft("");
      return;
    }
    setDiscountDraft(String(displayMoneyFromKgs(sale.discountKgs ?? 0, currencySource)));
  }, [currencySource, sale?.discountKgs, sale?.id, sale]);

  useEffect(() => {
    setSaleId(null);
    setLineSearch("");
    setPayments([createDefaultPosPaymentDraft()]);
    setDiscountDraft("");
    setDiscountEditorOpen(false);
    setSellInDebt(false);
    setDebtFullName("");
    setSelectedCustomer(null);
    setCustomerSelectorOpen(false);
    setCustomerSearch("");
    setCustomerCreateOpen(false);
    paymentAutoFillRef.current = { saleId: null, totalKgs: null };
    setLastCompletedSale(null);
    setAutoReceiptStatus("idle");
    setMobileCheckoutOpen(false);
    autoPrintedSaleIdRef.current = null;
  }, [registerId]);

  useEffect(() => {
    if (!saleId) {
      return;
    }
    if (!saleQuery.isFetched || saleQuery.isLoading || saleQuery.isFetching) {
      return;
    }
    if (saleQuery.data !== null) {
      return;
    }
    setSaleId(null);
    setPayments([createDefaultPosPaymentDraft()]);
    paymentAutoFillRef.current = { saleId: null, totalKgs: null };
    setMarkingInput({});
    setSelectedCustomer(null);
    setCustomerCreateOpen(false);
  }, [saleId, saleQuery.data, saleQuery.isFetched, saleQuery.isFetching, saleQuery.isLoading]);

  useEffect(() => {
    if (!sale?.id) {
      return;
    }
    if (saleCustomerName || saleCustomerEmail || saleCustomerPhone) {
      setSelectedCustomer({
        id: "",
        name: saleCustomerName ?? saleCustomerEmail ?? saleCustomerPhone ?? "",
        email: saleCustomerEmail,
        phone: saleCustomerPhone,
      });
      return;
    }
    setSelectedCustomer(null);
  }, [sale?.id, saleCustomerEmail, saleCustomerName, saleCustomerPhone]);

  useEffect(() => {
    if (!sale?.lines?.length) {
      setMarkingInput({});
      return;
    }
    setMarkingInput(
      Object.fromEntries(sale.lines.map((line) => [line.id, (line.markingCodes ?? []).join(", ")])),
    );
  }, [sale?.id, sale?.lines]);

  const hasOpenShift = Boolean(shiftQuery.data?.id);
  const isLineBusy =
    createDraftMutation.isLoading ||
    addLineMutation.isLoading ||
    updateLineMutation.isLoading ||
    removeLineMutation.isLoading ||
    updateDiscountMutation.isLoading ||
    updateCustomerMutation.isLoading ||
    upsertMarkingCodesMutation.isLoading ||
    cancelDraftMutation.isLoading;
  const totalPayment = roundMoney(
    payments.reduce((sum, payment) => {
      const amount = Number(payment.amount);
      if (!Number.isFinite(amount)) {
        return sum;
      }
      return sum + amount;
    }, 0),
  );
  const totalPaymentKgs = roundMoney(displayMoneyToKgs(totalPayment, currencySource));

  const handleAddLine = useCallback(
    async (productId: string): Promise<boolean> => {
      if (!registerId) {
        return false;
      }

      try {
        let targetSaleId = saleId ?? activeDraft?.id ?? null;
        if (!targetSaleId) {
          const draft = await createDraftMutation.mutateAsync({
            registerId,
            customerId: selectedCustomer?.id || undefined,
            customerName:
              selectedCustomer && !selectedCustomer.id ? selectedCustomer.name : undefined,
            customerEmail:
              selectedCustomer && !selectedCustomer.id ? selectedCustomer.email : undefined,
            customerPhone:
              selectedCustomer && !selectedCustomer.id ? selectedCustomer.phone : undefined,
          });
          targetSaleId = draft.id;
        }
        setSaleId(targetSaleId);

        await addLineMutation.mutateAsync({
          saleId: targetSaleId,
          productId,
          qty: 1,
        });
        setLastCompletedSale(null);
        setAutoReceiptStatus("idle");
        setMobileCheckoutOpen(true);

        // UI refresh should not turn a successful add into a failed scan flow.
        void Promise.allSettled([
          trpcUtils.pos.sales.get.invalidate({ saleId: targetSaleId }),
          trpcUtils.pos.sales.list.invalidate(),
          activeDraftQuery.refetch(),
        ]);

        focusLineSearchInput();
        return true;
      } catch {
        // handled by mutation onError
        return false;
      }
    },
    [
      activeDraft?.id,
      activeDraftQuery,
      addLineMutation,
      createDraftMutation,
      focusLineSearchInput,
      registerId,
      saleId,
      selectedCustomer,
      trpcUtils.pos.sales.get,
      trpcUtils.pos.sales.list,
    ],
  );

  useEffect(() => {
    if (!hasOpenShift) {
      return;
    }
    focusLineSearchInput();
  }, [focusLineSearchInput, hasOpenShift, saleId]);

  const handleScanResolved = useCallback(
    async (result: ScanResolvedResult): Promise<boolean> => {
      if (result.kind === "notFound") {
        toast({ variant: "info", description: t("sell.noSearchResults") });
        return false;
      }
      if (result.kind === "multiple") {
        return true;
      }
      return handleAddLine(result.item.id);
    },
    [handleAddLine, t, toast],
  );

  useEffect(() => {
    return () => {
      if (keyboardScanResetTimerRef.current !== null) {
        window.clearTimeout(keyboardScanResetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!hasOpenShift || typeof window === "undefined") {
      return;
    }

    const resetKeyboardScanBuffer = () => {
      keyboardScanBufferRef.current = "";
      if (keyboardScanResetTimerRef.current !== null) {
        window.clearTimeout(keyboardScanResetTimerRef.current);
        keyboardScanResetTimerRef.current = null;
      }
    };

    const scheduleKeyboardScanReset = () => {
      if (keyboardScanResetTimerRef.current !== null) {
        window.clearTimeout(keyboardScanResetTimerRef.current);
      }
      keyboardScanResetTimerRef.current = window.setTimeout(() => {
        keyboardScanBufferRef.current = "";
        keyboardScanResetTimerRef.current = null;
      }, keyboardScanResetMs);
    };

    const handleGlobalScannerInput = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (document.activeElement === lineSearchInputRef.current) {
        return;
      }
      if (isEditableElement(event.target)) {
        return;
      }

      if (event.key.length === 1) {
        keyboardScanBufferRef.current = `${keyboardScanBufferRef.current}${event.key}`.slice(
          -keyboardScanMaxLength,
        );
        scheduleKeyboardScanReset();
        return;
      }

      if (event.key === "Backspace") {
        keyboardScanBufferRef.current = keyboardScanBufferRef.current.slice(0, -1);
        scheduleKeyboardScanReset();
        return;
      }

      const trigger = shouldSubmitFromKey({
        key: event.key,
        supportsTabSubmit: true,
        tabSubmitMinLength: 1,
        normalizedValue: normalizeScanValue(keyboardScanBufferRef.current),
      });

      if (!trigger) {
        if (event.key === "Escape") {
          resetKeyboardScanBuffer();
        }
        return;
      }

      const rawScanValue = keyboardScanBufferRef.current;
      const normalizedScanValue = normalizeScanValue(rawScanValue);
      if (!normalizedScanValue || keyboardScanSubmittingRef.current) {
        resetKeyboardScanBuffer();
        return;
      }

      event.preventDefault();
      keyboardScanSubmittingRef.current = true;
      setLineSearch(rawScanValue);

      void (async () => {
        try {
          const lookup = await trpcUtils.products.lookupScan.fetch({ q: normalizedScanValue });
          const resolved = resolveScanResult({
            context: "pos",
            trigger,
            query: normalizedScanValue,
            lookup,
          });
          await handleScanResolved(resolved);
        } catch {
          toast({ variant: "error", description: tErrors("unexpectedError") });
        } finally {
          keyboardScanSubmittingRef.current = false;
          resetKeyboardScanBuffer();
        }
      })();
    };

    window.addEventListener("keydown", handleGlobalScannerInput);
    return () => {
      window.removeEventListener("keydown", handleGlobalScannerInput);
      resetKeyboardScanBuffer();
    };
  }, [hasOpenShift, handleScanResolved, tErrors, toast, trpcUtils.products.lookupScan]);

  const handleUpdateQty = async (lineId: string, raw: string) => {
    const qty = Math.trunc(Number(raw));
    if (!Number.isFinite(qty) || qty <= 0) {
      return;
    }
    try {
      await updateLineMutation.mutateAsync({ lineId, qty });
      if (saleId) {
        await trpcUtils.pos.sales.get.invalidate({ saleId });
      }
    } catch {
      // handled by mutation onError
    }
  };

  const formatSaleMoneyDraft = (amountKgs: number) => {
    const amount = displayMoneyFromKgs(amountKgs, currencySource);
    return Number.isFinite(amount) ? Number(amount.toFixed(6)).toString() : "";
  };

  const parseSaleMoneyDraft = (raw: string) => {
    const normalized = raw.replace(/\s+/g, "").replace(",", ".");
    if (!normalized.length) {
      return null;
    }
    const amount = Number(normalized);
    return Number.isFinite(amount) && amount >= 0 ? amount : null;
  };

  const handleUpdateLinePrice = async (
    lineId: string,
    raw: string,
    currentUnitPriceKgs: number,
  ) => {
    const amount = parseSaleMoneyDraft(raw);
    if (amount === null) {
      toast({ variant: "error", description: t("sell.invalidAmount") });
      return;
    }

    const unitPriceKgs = roundMoney(displayMoneyToKgs(amount, currencySource));
    if (unitPriceKgs === roundMoney(currentUnitPriceKgs)) {
      return;
    }

    try {
      await updateLineMutation.mutateAsync({ lineId, unitPriceKgs });
      if (saleId) {
        await trpcUtils.pos.sales.get.invalidate({ saleId });
      }
    } catch {
      // handled by mutation onError
    }
  };

  const handleRemoveLine = async (lineId: string) => {
    try {
      await removeLineMutation.mutateAsync({ lineId });
      if (saleId) {
        await trpcUtils.pos.sales.get.invalidate({ saleId });
      }
    } catch {
      // handled by mutation onError
    }
  };

  const handleUpdateDiscount = async () => {
    if (!saleId || !sale) {
      return;
    }
    const raw = discountDraft.trim();
    const amount = raw.length ? Number(raw.replace(/\s+/g, "").replace(",", ".")) : 0;
    if (!Number.isFinite(amount) || amount < 0) {
      toast({ variant: "error", description: t("sell.discountInvalid") });
      return;
    }
    const discountKgs = roundMoney(displayMoneyToKgs(amount, currencySource));
    if (discountKgs > sale.subtotalKgs) {
      toast({ variant: "error", description: t("sell.discountTooLarge") });
      return;
    }
    if (Math.abs(discountKgs - (sale.discountKgs ?? 0)) < 0.009) {
      return;
    }
    try {
      await updateDiscountMutation.mutateAsync({ saleId, discountKgs });
      await trpcUtils.pos.sales.get.invalidate({ saleId });
    } catch {
      // handled by mutation onError
    }
  };

  const handleSaveMarkingCodes = async (lineId: string) => {
    if (!saleId) {
      return;
    }
    const value = markingInput[lineId] ?? "";
    const codes = value
      .split(/[\n,;]+/g)
      .map((item) => item.trim())
      .filter(Boolean);
    try {
      await upsertMarkingCodesMutation.mutateAsync({
        saleId,
        lineId,
        codes,
      });
      await trpcUtils.pos.sales.get.invalidate({ saleId });
    } catch {
      // handled by mutation onError
    }
  };

  const handleSelectCustomer = async (customer: PosCustomerSelection) => {
    const previousCustomer = selectedCustomer;
    setSelectedCustomer(customer);
    setCustomerSelectorOpen(false);
    setCustomerSearch("");
    setCustomerCreateOpen(false);

    const targetSaleId = saleId ?? activeDraft?.id ?? null;
    if (!targetSaleId) {
      return;
    }

    try {
      await updateCustomerMutation.mutateAsync({
        saleId: targetSaleId,
        customerId: customer.id,
      });
    } catch {
      setSelectedCustomer(previousCustomer);
    }
  };

  const handleClearCustomer = async () => {
    const previousCustomer = selectedCustomer;
    setSelectedCustomer(null);
    setCustomerSelectorOpen(false);
    setCustomerSearch("");
    setCustomerCreateOpen(false);

    const targetSaleId = saleId ?? activeDraft?.id ?? null;
    if (!targetSaleId) {
      return;
    }

    try {
      await updateCustomerMutation.mutateAsync({
        saleId: targetSaleId,
        customerId: null,
      });
    } catch {
      setSelectedCustomer(previousCustomer);
    }
  };

  const handleCreateCustomer = async () => {
    if (!activeStoreId || createCustomerMutation.isLoading) {
      return;
    }
    const name = newCustomerName.trim().replace(/\s+/g, " ");
    const phone = newCustomerPhone.trim();
    const email = newCustomerEmail.trim();
    if (!name) {
      toast({ variant: "error", description: t("sell.customerNameRequired") });
      return;
    }
    if (!phone && !email) {
      toast({ variant: "error", description: t("sell.customerContactRequired") });
      return;
    }

    try {
      const result = await createCustomerMutation.mutateAsync({
        storeId: activeStoreId,
        name,
        phone: phone || null,
        email: email || null,
      });
      const customer = result.customer;
      setNewCustomerName("");
      setNewCustomerPhone("");
      setNewCustomerEmail("");
      setCustomerCreateOpen(false);
      await trpcUtils.pos.customers.search.invalidate();
      await handleSelectCustomer({
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
      });
    } catch {
      // handled by mutation onError
    }
  };

  const handleComplete = async () => {
    if (!saleId || !sale) {
      return;
    }

    if (sellInDebt) {
      const normalizedDebtName = debtFullName.trim().replace(/\s+/g, " ");
      if (normalizedDebtName.length < 2) {
        toast({ variant: "error", description: t("sell.debtNameRequired") });
        return;
      }
      try {
        await completeMutation.mutateAsync({
          saleId,
          idempotencyKey: createIdempotencyKey(),
          debtCustomerName: normalizedDebtName,
          payments: [],
        });
      } catch {
        // handled by mutation onError
      }
      return;
    }

    const normalized = payments
      .map((payment) => ({
        method: payment.method,
        amountKgs: roundMoney(displayMoneyToKgs(Number(payment.amount), currencySource)),
        providerRef: payment.providerRef.trim() || null,
      }))
      .filter((payment) => Number.isFinite(payment.amountKgs) && payment.amountKgs > 0);

    if (!normalized.length) {
      toast({ variant: "error", description: t("sell.paymentRequired") });
      focusPaymentsInput();
      return;
    }

    if (Math.abs(roundMoney(totalPaymentKgs - sale.totalKgs)) > 0.009) {
      toast({ variant: "error", description: t("sell.paymentMismatch") });
      focusPaymentsInput();
      return;
    }

    try {
      await completeMutation.mutateAsync({
        saleId,
        idempotencyKey: createIdempotencyKey(),
        debtCustomerName: null,
        payments: normalized,
      });
    } catch {
      // handled by mutation onError
    }
  };

  const formatSaleMoney = (amountKgs: number) => formatKgsMoney(amountKgs, locale, currencySource);

  const addPaymentRow = () => {
    setPayments((current) => [...current, createDefaultPosPaymentDraft()]);
  };

  const removePaymentRow = (index: number) => {
    setPayments((current) =>
      current.length <= 1 ? current : current.filter((_, i) => i !== index),
    );
  };

  const handleSellInDebtChange = (checked: boolean) => {
    setSellInDebt(checked);
    if (checked) {
      setPayments([createDefaultPosPaymentDraft()]);
      paymentAutoFillRef.current = { saleId: saleIdForPaymentInit ?? null, totalKgs: null };
    }
  };

  const handleDiscardSale = async () => {
    if (!saleId) {
      return;
    }
    try {
      await cancelDraftMutation.mutateAsync({ saleId });
    } catch {
      // handled by mutation onError
    }
  };

  const handleResumeActiveDraft = () => {
    if (!activeDraft?.id) {
      return;
    }
    setLastCompletedSale(null);
    setAutoReceiptStatus("idle");
    setMobileCheckoutOpen(true);
    setDiscountEditorOpen(false);
    setCustomerSelectorOpen(false);
    setCustomerSearch("");
    setCustomerCreateOpen(false);
    setSelectedCustomer(
      activeDraft.customerName || activeDraft.customerEmail || activeDraft.customerPhone
        ? {
            id: "",
            name:
              activeDraft.customerName ??
              activeDraft.customerEmail ??
              activeDraft.customerPhone ??
              "",
            email: activeDraft.customerEmail,
            phone: activeDraft.customerPhone,
          }
        : null,
    );
    setSaleId(activeDraft.id);
  };

  const handleStartNewSale = () => {
    setLastCompletedSale(null);
    setAutoReceiptStatus("idle");
    setSelectedCustomer(null);
    setDiscountEditorOpen(false);
    setCustomerSelectorOpen(false);
    setCustomerSearch("");
    setCustomerCreateOpen(false);
    autoPrintedSaleIdRef.current = null;
    setMobileCheckoutOpen(false);
    focusLineSearchInput();
  };

  const handleDiscardActiveDraft = async () => {
    if (!activeDraft?.id) {
      return;
    }
    try {
      await cancelDraftMutation.mutateAsync({ saleId: activeDraft.id });
    } catch {
      // handled by mutation onError
    }
  };

  const printReceiptWithConfiguredProvider = useCallback(
    async (
      kind: "precheck" | "fiscal",
      action: "auto_print" | "reprint",
      options: { allowManualFallback: boolean },
    ) => {
      if (!lastCompletedSale || !activeStoreId) {
        throw new Error("receiptPrintNotReady");
      }
      const provider = receiptPrintSettings?.receiptPrintProvider ?? "DISABLED";
      if (
        provider !== "QZ_TRAY" &&
        provider !== "KIOSK_SILENT_PRINT" &&
        !(
          options.allowManualFallback &&
          receiptPrintSettings?.receiptFallbackMode === "MANUAL_BROWSER_PRINT"
        )
      ) {
        throw new Error("receiptAutoPrintSetupRequired");
      }
      const blob = await fetchPdfBlob({
        url: `/api/pos/receipts/${lastCompletedSale.id}/pdf?kind=${kind}&action=${action}`,
      });

      if (provider === "QZ_TRAY") {
        const binding = getQzTrayBinding(activeStoreId);
        const result = await printPdfBlobViaQzTray({
          blob,
          printerName: binding.receiptPrinterName,
        });
        return result.trustStatus === "trusted" ? ("qz" as const) : ("qz_untrusted" as const);
      }

      if (provider === "KIOSK_SILENT_PRINT") {
        const result = await printPdfBlob(blob);
        return result.autoPrintAttempted ? ("kiosk" as const) : ("blocked" as const);
      }

      if (
        options.allowManualFallback &&
        receiptPrintSettings?.receiptFallbackMode === "MANUAL_BROWSER_PRINT"
      ) {
        const result = await printPdfBlob(blob);
        return result.autoPrintAttempted ? ("manual" as const) : ("blocked" as const);
      }

      throw new Error("receiptAutoPrintSetupRequired");
    },
    [activeStoreId, lastCompletedSale, receiptPrintSettings],
  );

  const handleReceiptPdf = async (mode: "download" | "print", kind: "precheck" | "fiscal") => {
    if (!lastCompletedSale || receiptAction) {
      return;
    }
    setReceiptAction({ mode, kind });
    try {
      if (mode === "print") {
        const result = await printReceiptWithConfiguredProvider(kind, "reprint", {
          allowManualFallback: true,
        });
        if (result === "blocked" || result === "manual") {
          toast({ variant: "info", description: t("sell.receiptPrintFallback") });
        } else if (result === "qz_untrusted") {
          toast({ variant: "info", description: t("sell.qzTrustMissing") });
        }
      } else {
        const blob = await fetchPdfBlob({
          url: `/api/pos/receipts/${lastCompletedSale.id}/pdf?kind=${kind}&action=download`,
        });
        downloadPdfBlob(blob, `pos-receipt-${lastCompletedSale.number}-${kind}.pdf`);
      }
    } catch (error) {
      const key = qzTrayErrorMessageKey(error);
      toast({
        variant: "error",
        description: key === "qzPrintFailed" ? t("sell.receiptPdfFailed") : t(`sell.${key}`),
      });
    } finally {
      setReceiptAction(null);
    }
  };

  useEffect(() => {
    if (!lastCompletedSale || autoPrintedSaleIdRef.current === lastCompletedSale.id) {
      return;
    }
    if (receiptPrintSettingsQuery.isLoading) {
      return;
    }

    let active = true;
    autoPrintedSaleIdRef.current = lastCompletedSale.id;

    if (!receiptPrintSettings?.receiptAutoPrintEnabled) {
      setAutoReceiptStatus("idle");
      return;
    }

    void (async () => {
      setAutoReceiptStatus("printing");
      try {
        const result = await printReceiptWithConfiguredProvider("precheck", "auto_print", {
          allowManualFallback: false,
        });
        if (!active) {
          return;
        }
        setAutoReceiptStatus(result === "blocked" ? "blocked" : "ready");
        if (result === "qz_untrusted") {
          toast({ variant: "info", description: t("sell.qzTrustMissing") });
        }
      } catch (error) {
        if (active) {
          const message = error instanceof Error ? error.message : "";
          if (message === "receiptAutoPrintSetupRequired") {
            setAutoReceiptStatus("blocked");
            toast({ variant: "info", description: t("sell.receiptAutoSetupRequired") });
            return;
          }
          setAutoReceiptStatus("failed");
          const key = qzTrayErrorMessageKey(error);
          toast({
            variant: "error",
            description: key === "qzPrintFailed" ? t("sell.receiptAutoFailed") : t(`sell.${key}`),
          });
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [
    lastCompletedSale,
    printReceiptWithConfiguredProvider,
    receiptPrintSettings?.receiptAutoPrintEnabled,
    receiptPrintSettingsQuery.isLoading,
    t,
    toast,
  ]);

  const productResults = activeStoreId ? (catalogProductsQuery.data?.items ?? []) : [];
  const visibleProducts = productResults;
  const productGridLoading = Boolean(activeStoreId && catalogProductsQuery.isFetching);
  const productCategories = productsBootstrapQuery.data?.categories ?? [];
  const lineDiscountById = new Map<string, number>();
  if (sale && sale.lines.length && sale.discountKgs > 0 && sale.subtotalKgs > 0) {
    let remainingDiscount = roundMoney(sale.discountKgs);
    sale.lines.forEach((line, index) => {
      const isLastLine = index === sale.lines.length - 1;
      const lineDiscount = isLastLine
        ? remainingDiscount
        : Math.min(
            line.lineTotalKgs,
            roundMoney((sale.discountKgs * line.lineTotalKgs) / sale.subtotalKgs),
          );
      lineDiscountById.set(line.id, lineDiscount);
      remainingDiscount = roundMoney(remainingDiscount - lineDiscount);
    });
  }
  const selectedRegisterLabel = selectedRegister
    ? `${selectedRegister.store.name} / ${selectedRegister.name}`
    : t("entry.selectRegister");
  const shiftOpenedLabel = shiftQuery.data?.openedAt
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(shiftQuery.data.openedAt))
    : null;
  const paymentTotalLabel = formatKgsMoney(totalPaymentKgs, locale, currencySource);
  const paymentDeltaKgs = sale ? roundMoney(totalPaymentKgs - sale.totalKgs) : 0;
  const showPaymentTotalSummary = Boolean(
    sale && !sellInDebt && (payments.length > 1 || Math.abs(paymentDeltaKgs) > 0.004),
  );
  const discountCurrencyCode = resolveCurrency(currencySource).currencyCode;
  const showDiscountEditor = discountEditorOpen || Boolean(sale && sale.discountKgs > 0);
  const currentCustomer = selectedCustomer;
  const currentCustomerDetails = currentCustomer
    ? [currentCustomer.phone, currentCustomer.email].filter(Boolean).join(" · ")
    : "";
  const currentCustomerLabel = currentCustomer?.name || t("sell.retailCustomer");
  const saleLines = sale?.lines ?? [];
  const hasCartLines = saleLines.length > 0;
  const cartItemCount = saleLines.reduce((sum, line) => sum + line.qty, 0);
  const showCompletedSale = Boolean(lastCompletedSale && !saleId);
  const checkoutPanelTitle = showCompletedSale
    ? t("sell.saleCompletedTitle")
    : sale?.number
      ? `${t("sell.saleTitle")} · ${sale.number}`
      : t("sell.saleTitle");
  const receiptStatusLabel =
    autoReceiptStatus === "printing"
      ? t("sell.receiptAutoPrinting")
      : autoReceiptStatus === "ready"
        ? t("sell.receiptAutoReady")
        : autoReceiptStatus === "blocked"
          ? t("sell.receiptAutoBlocked")
          : autoReceiptStatus === "failed"
            ? t("sell.receiptAutoFailed")
            : t("sell.receiptManualFallback");
  const checkoutSheetSummary = showCompletedSale
    ? t("sell.saleCompletedTitle")
    : hasCartLines
      ? t("sell.cartSummary", {
          count: cartItemCount,
          total: sale ? formatSaleMoney(sale.totalKgs) : formatSaleMoney(0),
        })
      : t("sell.emptyCartTitle");
  const completeDisabled = !sale || completeMutation.isLoading || isLineBusy || !hasCartLines;
  const isDemoCategory = (category: string) =>
    ["test", "tests", "demo", "sample", "samples"].includes(category.trim().toLowerCase());
  const categoryLabel = (category: string) => {
    const normalized = category.trim().toLowerCase();
    if (["beverages", "drinks"].includes(normalized)) return t("sell.categoryBeverages");
    if (normalized === "household") return t("sell.categoryHousehold");
    if (normalized === "snacks") return t("sell.categorySnacks");
    if (normalized === "test") return t("sell.categoryTest");
    return category;
  };
  const visibleProductCategories = productCategories.filter(
    (category) => !isDemoCategory(category),
  );
  const stockMeta = (stockQty: number | null) => {
    if (stockQty === null) {
      return {
        label: tCommon("notAvailable"),
        className: "border-foreground bg-foreground text-background",
        showWarningIcon: false,
      };
    }
    if (stockQty < 0) {
      const absoluteQty = formatNumber(Math.abs(stockQty), locale);
      return {
        label: `−${absoluteQty} ${t("sell.stockUnitShort")}`,
        className: "border-danger bg-danger text-danger-foreground",
        showWarningIcon: true,
      };
    }
    if (stockQty === 0) {
      return {
        label: t("sell.outOfStock"),
        className: "border-danger bg-danger text-danger-foreground",
        showWarningIcon: false,
      };
    }
    if (stockQty <= 5) {
      return {
        label: `${formatNumber(stockQty, locale)} ${t("sell.stockUnitShort")}`,
        className: "border-warning bg-warning text-warning-foreground",
        showWarningIcon: false,
      };
    }
    return {
      label: `${formatNumber(stockQty, locale)} ${t("sell.stockUnitShort")}`,
      className: "border-success bg-success text-success-foreground",
      showWarningIcon: false,
    };
  };

  const CustomerCreatePanel = () => (
    <div className="space-y-2 border-t border-border px-3 py-3">
      <Input
        value={newCustomerName}
        onChange={(event) => setNewCustomerName(event.target.value)}
        placeholder={t("sell.customerNamePlaceholder")}
        autoComplete="name"
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          value={newCustomerPhone}
          onChange={(event) => setNewCustomerPhone(event.target.value)}
          placeholder={t("sell.customerPhonePlaceholder")}
          autoComplete="tel"
        />
        <Input
          value={newCustomerEmail}
          onChange={(event) => setNewCustomerEmail(event.target.value)}
          placeholder={t("sell.customerEmailPlaceholder")}
          autoComplete="email"
        />
      </div>
      <Button
        type="button"
        className="h-10 w-full justify-start"
        onClick={() => void handleCreateCustomer()}
        disabled={createCustomerMutation.isLoading || !activeStoreId}
      >
        {createCustomerMutation.isLoading ? (
          <Spinner className="h-4 w-4" />
        ) : (
          <AddIcon className="h-4 w-4" aria-hidden />
        )}
        {t("sell.createCustomer")}
      </Button>
    </div>
  );

  const DesktopPosSaleView = () => (
    <div className="min-h-screen bg-muted/40 text-foreground">
      <header className="sticky top-0 z-30 flex min-h-16 flex-col border-b border-border bg-background shadow-sm lg:h-16 lg:flex-row">
        <Button
          asChild
          className="h-16 w-full rounded-md bg-primary px-5 text-base font-semibold text-primary-foreground hover:bg-primary/90 lg:w-32"
        >
          <Link href={`/pos${registerId ? `?registerId=${registerId}` : ""}`}>
            <BackIcon className="h-5 w-5" aria-hidden />
            {tCommon("back")}
          </Link>
        </Button>

        <div className="flex min-h-16 flex-1 items-center gap-3 bg-card px-4">
          <SearchIcon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <ScanInput
            ref={lineSearchInputRef}
            context="pos"
            value={lineSearch}
            onValueChange={setLineSearch}
            placeholder={t("sell.searchProduct")}
            ariaLabel={t("sell.searchProduct")}
            onResolved={handleScanResolved}
            supportsTabSubmit
            autoFocus={hasOpenShift}
            showDropdown={false}
            disabled={!hasOpenShift}
            className="w-full"
            inputClassName="h-12 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0"
          />
        </div>

        <div className="grid min-h-12 gap-0 border-t border-border bg-muted/30 lg:w-[520px] lg:border-l lg:border-t-0 2xl:w-[600px]">
          <div className="flex min-w-0 items-center gap-2 px-3 py-2">
            <Badge
              variant={hasOpenShift ? "success" : "warning"}
              className="h-8 shrink-0 px-3 text-xs font-semibold"
            >
              {hasOpenShift ? t("entry.shiftOpen") : t("entry.shiftClosed")}
            </Badge>
            <Select value={registerId} onValueChange={setRegisterId}>
              <SelectTrigger
                aria-label={t("entry.register")}
                className="h-8 min-w-0 flex-1 border-0 bg-transparent px-0 text-left text-sm font-semibold shadow-none focus:ring-0"
              >
                <SelectValue placeholder={selectedRegisterLabel} />
              </SelectTrigger>
              <SelectContent>
                {(registersQuery.data ?? []).map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.store.name} · {item.name} ({item.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative flex min-w-0 max-w-[44%] items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                className="h-8 min-w-0 justify-start gap-1 px-2 text-xs font-medium"
                onClick={() => setCustomerSelectorOpen((current) => !current)}
                disabled={!hasOpenShift || !activeStoreId}
                aria-expanded={customerSelectorOpen}
              >
                <span className="truncate">
                  {currentCustomer
                    ? currentCustomerDetails
                      ? `${currentCustomerLabel} · ${currentCustomerDetails}`
                      : currentCustomerLabel
                    : t("sell.retailCustomer")}
                </span>
                <ChevronDownIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </Button>
              {currentCustomer ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => void handleClearCustomer()}
                  disabled={updateCustomerMutation.isLoading}
                  aria-label={t("sell.clearCustomer")}
                  title={t("sell.clearCustomer")}
                >
                  {updateCustomerMutation.isLoading ? (
                    <Spinner className="h-3.5 w-3.5" />
                  ) : (
                    <CloseIcon className="h-3.5 w-3.5" aria-hidden />
                  )}
                </Button>
              ) : null}
              {customerSelectorOpen ? (
                <PopoverSurface className="absolute left-0 top-full z-50 mt-2 max-h-[70vh] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto p-0 sm:left-auto sm:right-0">
                  <div className="space-y-3 p-3">
                    <div className="flex gap-2">
                      <Input
                        value={customerSearch}
                        onChange={(event) => setCustomerSearch(event.target.value)}
                        placeholder={t("sell.customerSearchPlaceholder")}
                        autoFocus
                      />
                      <Button
                        type="button"
                        variant={customerCreateOpen ? "default" : "secondary"}
                        size="icon"
                        className="h-10 w-10 shrink-0"
                        onClick={() => setCustomerCreateOpen((current) => !current)}
                        aria-label={t("sell.createCustomer")}
                        title={t("sell.createCustomer")}
                      >
                        <AddIcon className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant={currentCustomer ? "secondary" : "default"}
                      className="h-10 w-full justify-start"
                      onClick={() => void handleClearCustomer()}
                      disabled={updateCustomerMutation.isLoading}
                    >
                      {t("sell.selectRetailCustomer")}
                    </Button>
                  </div>

                  {customerCreateOpen ? <CustomerCreatePanel /> : null}

                  {customerSearchQuery.isLoading || customerSearchQuery.isFetching ? (
                    <div className="flex items-center justify-center gap-2 border-t border-border py-5 text-sm text-muted-foreground">
                      <Spinner className="h-4 w-4" />
                      {tCommon("loading")}
                    </div>
                  ) : null}

                  {customerSearchQuery.error ? (
                    <div className="m-3 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                      {translateError(tErrors, customerSearchQuery.error)}
                    </div>
                  ) : null}

                  {!customerSearchQuery.isLoading &&
                  !customerSearchQuery.error &&
                  !(customerSearchQuery.data?.items.length ?? 0) ? (
                    <div className="border-t border-border px-4 py-5 text-center text-sm text-muted-foreground">
                      {t("sell.customerNotFound")}
                    </div>
                  ) : null}

                  {customerSearchQuery.data?.items.length ? (
                    <div className="divide-y divide-border border-t border-border">
                      {customerSearchQuery.data.items.map((customer) => (
                        <button
                          key={customer.id}
                          type="button"
                          className="flex w-full flex-col gap-1 px-4 py-3 text-left transition hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => {
                            void handleSelectCustomer({
                              id: customer.id,
                              name: customer.name,
                              email: customer.email,
                              phone: customer.phone,
                            });
                          }}
                          disabled={updateCustomerMutation.isLoading}
                        >
                          <span className="font-medium text-foreground">{customer.name}</span>
                          <span className="text-sm text-muted-foreground">
                            {[customer.phone, customer.email].filter(Boolean).join(" · ") ||
                              t("sell.customerNoContact")}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </PopoverSurface>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      {!hasOpenShift ? (
        <main className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
          <section className="w-full max-w-xl rounded-md border border-border bg-card p-6 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-lg font-semibold text-foreground">{t("entry.shiftClosed")}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t("sell.openShiftFirst")}</p>
              </div>
              {registerId ? (
                <Button asChild>
                  <Link href={`/pos?registerId=${registerId}`}>{t("sell.openShiftFirst")}</Link>
                </Button>
              ) : null}
            </div>
          </section>
        </main>
      ) : (
        <main className="grid min-h-[calc(100vh-4rem)] pb-20 lg:h-[calc(100vh-4rem)] lg:grid-cols-[minmax(0,1fr)_520px] lg:pb-0 2xl:grid-cols-[minmax(0,1fr)_600px]">
          <section className="flex min-h-0 flex-col bg-muted/40">
            <div className="min-h-14 overflow-x-auto border-b border-border/70 bg-card px-4 py-3 shadow-sm">
              <div className="flex w-max min-w-full items-center justify-center gap-2">
                <Button
                  type="button"
                  variant={selectedCategory ? "secondary" : "default"}
                  className="h-10 shrink-0 rounded-md"
                  onClick={() => {
                    setSelectedCategory("");
                    setLineSearch("");
                  }}
                >
                  <TagIcon className="h-4 w-4" aria-hidden />
                  {t("sell.allProducts")}
                </Button>
                {visibleProductCategories.map((category) => (
                  <Button
                    key={category}
                    type="button"
                    variant={selectedCategory === category ? "default" : "secondary"}
                    className="h-10 shrink-0 rounded-md"
                    onClick={() => setSelectedCategory(category)}
                  >
                    {categoryLabel(category)}
                  </Button>
                ))}
              </div>
            </div>

            {activeDraft && !saleId ? (
              <div className="mx-4 mt-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <p className="font-semibold text-foreground">{t("sell.draftDetectedTitle")}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("sell.draftDetectedHint", { number: activeDraft?.number ?? "" })}
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Button
                    type="button"
                    className="w-full sm:w-auto"
                    onClick={handleResumeActiveDraft}
                    disabled={isLineBusy || completeMutation.isLoading}
                  >
                    {t("sell.resumeDraft")}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full sm:w-auto"
                    onClick={() => void handleDiscardActiveDraft()}
                    disabled={isLineBusy || completeMutation.isLoading}
                  >
                    {cancelDraftMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                    {t("sell.discardSale")}
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              {catalogProductsQuery.error ? (
                <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                  {translateError(tErrors, catalogProductsQuery.error)}
                </div>
              ) : null}

              {productGridLoading ? (
                <div className="flex min-h-[180px] items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Spinner className="h-4 w-4" />
                  {tCommon("loading")}
                </div>
              ) : null}

              {!productGridLoading && !visibleProducts.length ? (
                <div className="grid min-h-[260px] place-items-center rounded-md border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
                  <div>
                    <SearchIcon className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden />
                    <p className="mt-3">
                      {hasSearchTerm || selectedCategory
                        ? t("sell.noSearchResults")
                        : t("sell.catalogEmpty")}
                    </p>
                  </div>
                </div>
              ) : null}

              {visibleProducts.length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4 2xl:grid-cols-5">
                  {visibleProducts.map((product) => {
                    const priceKgs = product.effectivePriceKgs ?? product.basePriceKgs ?? null;
                    const stockQty = product.onHandQty ?? null;
                    const barcode = product.barcodes?.[0]?.value ?? null;
                    const productIdentity = [
                      enableSku ? product.sku : "",
                      enableBarcode && barcode ? barcode : "",
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    const primaryImage = product.images[0]?.url ?? product.photoUrl;
                    const stock = stockMeta(stockQty);
                    const priceMissing = priceKgs === null;
                    const productBlocked = priceMissing;

                    return (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => {
                          if (priceMissing) {
                            toast({
                              variant: "error",
                              description: t("sell.priceMissingCannotSell"),
                            });
                            return;
                          }
                          blurLineSearchInput();
                          void handleAddLine(product.id);
                        }}
                        disabled={isLineBusy || completeMutation.isLoading}
                        aria-disabled={productBlocked}
                        className={`group relative flex min-h-[236px] flex-col overflow-hidden rounded-md border border-border bg-card text-left transition hover:border-primary/50 hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[256px] dark:hover:bg-accent/40 ${
                          productBlocked
                            ? "cursor-not-allowed opacity-75 hover:border-border hover:bg-card"
                            : ""
                        }`}
                      >
                        <div
                          className={`absolute right-2 top-2 z-10 inline-flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold ${stock.className}`}
                        >
                          {stock.showWarningIcon ? (
                            <StatusWarningIcon className="h-3 w-3 shrink-0" aria-hidden />
                          ) : null}
                          <span className="truncate">{stock.label}</span>
                        </div>
                        <div className="flex h-28 items-center justify-center bg-muted/30 px-3 py-3 sm:h-32">
                          {primaryImage ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={primaryImage}
                              alt={product.name}
                              className="max-h-full max-w-full rounded-md object-contain"
                            />
                          ) : (
                            <span className="grid h-20 w-20 place-items-center rounded-md border border-dashed border-border bg-muted/40 text-muted-foreground">
                              <EmptyIcon className="h-6 w-6" aria-hidden />
                            </span>
                          )}
                        </div>
                        <div className="flex flex-1 flex-col justify-between gap-3 px-3 pb-3 pt-3 sm:px-4 sm:pb-4">
                          <div>
                            <p className="line-clamp-2 min-h-10 text-sm font-medium text-foreground">
                              {product.name}
                            </p>
                            {productIdentity ? (
                              <p className="mt-1 truncate text-[11px] text-muted-foreground sm:text-xs">
                                {productIdentity}
                              </p>
                            ) : null}
                          </div>
                          <div className="border-t border-border/70 pt-3">
                            <p
                              className={
                                priceMissing
                                  ? "text-sm font-medium text-muted-foreground"
                                  : "text-base font-bold text-foreground"
                              }
                            >
                              {priceMissing ? t("sell.priceMissing") : formatSaleMoney(priceKgs)}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <footer className="grid min-h-12 grid-cols-[1fr_auto_1fr] items-center border-t border-border bg-card px-4 py-2 text-sm text-muted-foreground">
              <span aria-hidden />
              <div className="max-w-full truncate text-center">
                {selectedRegisterLabel}
                {shiftOpenedLabel ? ` / ${shiftOpenedLabel}` : ""}
              </div>
              <span className="h-3 w-3 justify-self-end rounded-md bg-success" aria-hidden />
            </footer>
          </section>

          <aside
            className={`fixed inset-x-0 bottom-0 z-40 flex max-h-[88vh] min-h-[76px] flex-col rounded-t-md border border-border bg-card shadow-2xl transition-transform duration-200 lg:static lg:z-auto lg:max-h-none lg:min-h-0 lg:translate-y-0 lg:rounded-md lg:border-y-0 lg:border-l lg:border-r-0 lg:shadow-none ${
              mobileCheckoutOpen ? "translate-y-0" : "translate-y-[calc(100%-76px)]"
            }`}
          >
            <button
              type="button"
              className="flex h-[76px] shrink-0 items-center justify-between gap-3 border-b border-border px-4 text-left lg:hidden"
              onClick={() => setMobileCheckoutOpen((current) => !current)}
              aria-expanded={mobileCheckoutOpen}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{checkoutPanelTitle}</p>
                <p className="truncate text-xs text-muted-foreground">{checkoutSheetSummary}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-base font-bold text-foreground">
                  {sale
                    ? formatSaleMoney(sale.totalKgs)
                    : showCompletedSale
                      ? t("sell.done")
                      : formatSaleMoney(0)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {mobileCheckoutOpen ? t("sell.hideCart") : t("sell.openCart")}
                </p>
              </div>
            </button>

            {showCompletedSale && lastCompletedSale ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="border-b border-border px-5 py-5">
                  <Badge variant={autoReceiptStatus === "failed" ? "danger" : "success"}>
                    {t("sell.saleCompletedTitle")}
                  </Badge>
                  <h2 className="mt-4 text-xl font-semibold text-foreground">
                    {t("sell.completeSuccess", { number: lastCompletedSale.number })}
                  </h2>
                  <p
                    className={`mt-2 text-sm ${
                      autoReceiptStatus === "failed" ? "text-danger" : "text-muted-foreground"
                    }`}
                  >
                    {receiptStatusLabel}
                  </p>
                </div>
                <div className="flex min-h-0 flex-1 flex-col justify-between gap-5 overflow-y-auto p-5">
                  <div className="space-y-3">
                    <Button type="button" className="h-12 w-full" onClick={handleStartNewSale}>
                      {t("sell.newSale")}
                    </Button>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          void handleReceiptPdf("print", "precheck");
                        }}
                        disabled={Boolean(receiptAction)}
                      >
                        {receiptAction?.mode === "print" && receiptAction.kind === "precheck" ? (
                          <Spinner className="h-4 w-4" />
                        ) : (
                          <PrintIcon className="h-4 w-4" aria-hidden />
                        )}
                        {t("sell.printPrecheck")}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          void handleReceiptPdf("download", "precheck");
                        }}
                        disabled={Boolean(receiptAction)}
                      >
                        {receiptAction?.mode === "download" && receiptAction.kind === "precheck" ? (
                          <Spinner className="h-4 w-4" />
                        ) : (
                          <DownloadIcon className="h-4 w-4" aria-hidden />
                        )}
                        {t("sell.downloadPrecheck")}
                      </Button>
                    </div>
                    {lastCompletedSale.kkmStatus === "SENT" ? (
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => {
                            void handleReceiptPdf("print", "fiscal");
                          }}
                          disabled={Boolean(receiptAction)}
                        >
                          {receiptAction?.mode === "print" && receiptAction.kind === "fiscal" ? (
                            <Spinner className="h-4 w-4" />
                          ) : (
                            <PrintIcon className="h-4 w-4" aria-hidden />
                          )}
                          {t("sell.printFiscalReceipt")}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            void handleReceiptPdf("download", "fiscal");
                          }}
                          disabled={Boolean(receiptAction)}
                        >
                          {receiptAction?.mode === "download" && receiptAction.kind === "fiscal" ? (
                            <Spinner className="h-4 w-4" />
                          ) : (
                            <DownloadIcon className="h-4 w-4" aria-hidden />
                          )}
                          {t("sell.downloadFiscalReceipt")}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <p className="text-center text-xs text-muted-foreground">
                    {t("sell.receiptActionsHint")}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {checkoutPanelTitle}
                      </p>
                      {shiftOpenedLabel ? (
                        <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                          {shiftOpenedLabel}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground">
                      {selectedRegisterLabel}
                    </p>
                  </div>
                  {saleId ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-8 shrink-0 px-3 text-xs"
                      onClick={handleDiscardSale}
                      disabled={isLineBusy || completeMutation.isLoading}
                    >
                      {cancelDraftMutation.isLoading ? <Spinner className="h-3.5 w-3.5" /> : null}
                      {t("sell.discardSale")}
                    </Button>
                  ) : null}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                  {saleId && saleQuery.error ? (
                    <div className="m-4 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                      {translateError(tErrors, saleQuery.error)}
                    </div>
                  ) : null}

                  {saleId && saleQuery.isLoading ? (
                    <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                      <Spinner className="h-4 w-4" />
                      {tCommon("loading")}
                    </div>
                  ) : null}

                  {!saleId || (!hasCartLines && !saleQuery.isLoading && !saleQuery.error) ? (
                    <div className="grid min-h-[300px] place-items-center p-6 text-center">
                      <div>
                        <div className="mx-auto grid h-12 w-12 place-items-center rounded-md border border-dashed border-border bg-muted/30 text-muted-foreground">
                          <EmptyIcon className="h-5 w-5" aria-hidden />
                        </div>
                        <p className="mt-4 text-sm font-medium text-foreground">
                          {t("sell.emptyCartTitle")}
                        </p>
                        <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                          {t("sell.emptyCartHint")}
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {hasCartLines ? (
                    <div className="divide-y divide-border">
                      {saleLines.map((line) => {
                        const lineDiscountKgs = lineDiscountById.get(line.id) ?? 0;
                        const lineNetTotalKgs = roundMoney(
                          Math.max(0, line.lineTotalKgs - lineDiscountKgs),
                        );

                        return (
                          <div key={line.id} className="px-3 py-2">
                            <div className="flex gap-2.5">
                              {line.product.primaryImage ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={line.product.primaryImage}
                                  alt={line.product.name}
                                  className="h-12 w-12 shrink-0 rounded-md border border-border object-cover"
                                />
                              ) : (
                                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md border border-dashed border-border bg-muted/40 text-muted-foreground">
                                  <EmptyIcon className="h-4 w-4" aria-hidden />
                                </span>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="line-clamp-1 text-sm font-medium leading-5 text-foreground">
                                      {line.product.name}
                                      {line.product.isBundle ? ` · ${t("sell.bundle")}` : ""}
                                    </p>
                                    {enableSku ? (
                                      <p className="truncate text-[11px] leading-4 text-muted-foreground">
                                        {line.product.sku}
                                      </p>
                                    ) : null}
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                                    onClick={() => handleRemoveLine(line.id)}
                                    disabled={isLineBusy || completeMutation.isLoading}
                                    aria-label={tCommon("delete")}
                                  >
                                    <DeleteIcon className="h-4 w-4" aria-hidden />
                                  </Button>
                                </div>
                                <div className="mt-1.5 grid grid-cols-[1fr_auto] items-center gap-2">
                                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <div className="flex min-w-0 items-center gap-1.5">
                                      <Input
                                        key={`${line.id}:price:${line.unitPriceKgs}`}
                                        defaultValue={formatSaleMoneyDraft(line.unitPriceKgs)}
                                        aria-label={t("sell.unitPrice")}
                                        title={t("sell.unitPrice")}
                                        inputMode="decimal"
                                        className="h-8 w-24 rounded-md px-2 text-[12px] font-medium text-foreground shadow-none focus-visible:ring-1"
                                        onFocus={(event) => event.currentTarget.select()}
                                        onBlur={(event) =>
                                          handleUpdateLinePrice(
                                            line.id,
                                            event.currentTarget.value,
                                            line.unitPriceKgs,
                                          )
                                        }
                                        onKeyDown={(event) => {
                                          if (event.key === "Enter") {
                                            event.currentTarget.blur();
                                          }
                                          if (event.key === "Escape") {
                                            event.currentTarget.value = formatSaleMoneyDraft(
                                              line.unitPriceKgs,
                                            );
                                            event.currentTarget.blur();
                                          }
                                        }}
                                        disabled={isLineBusy || completeMutation.isLoading}
                                      />
                                      {lineDiscountKgs > 0 ? (
                                        <span className="truncate text-[11px] leading-4 text-muted-foreground">
                                          {t("sell.discount")} {formatSaleMoney(lineDiscountKgs)}
                                        </span>
                                      ) : null}
                                    </div>
                                    <div className="inline-flex items-center overflow-hidden rounded-md border border-border bg-background">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 rounded-md text-sm"
                                        onClick={() =>
                                          handleUpdateQty(
                                            line.id,
                                            String(Math.max(1, line.qty - 1)),
                                          )
                                        }
                                        disabled={
                                          line.qty <= 1 || isLineBusy || completeMutation.isLoading
                                        }
                                        aria-label={t("sell.decreaseQty")}
                                      >
                                        -
                                      </Button>
                                      <Input
                                        key={`${line.id}:${line.qty}`}
                                        defaultValue={String(line.qty)}
                                        onBlur={(event) =>
                                          handleUpdateQty(line.id, event.target.value)
                                        }
                                        className="h-8 w-11 rounded-md border-y-0 px-1 text-center text-sm shadow-none focus-visible:ring-0"
                                        inputMode="numeric"
                                        disabled={isLineBusy || completeMutation.isLoading}
                                      />
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 rounded-md text-sm"
                                        onClick={() =>
                                          handleUpdateQty(line.id, String(line.qty + 1))
                                        }
                                        disabled={isLineBusy || completeMutation.isLoading}
                                        aria-label={t("sell.increaseQty")}
                                      >
                                        +
                                      </Button>
                                    </div>
                                  </div>
                                  <p className="text-right text-sm font-semibold leading-none text-foreground">
                                    {formatSaleMoney(lineNetTotalKgs)}
                                  </p>
                                </div>
                              </div>
                            </div>
                            {saleMarkingEnabled && line.product.complianceFlags?.requiresMarking ? (
                              <div className="mt-2 space-y-1.5 rounded-md border border-border bg-muted/20 p-2">
                                <p className="text-[11px] text-muted-foreground">
                                  {t("sell.markingLabel")}
                                  {saleMarkingMode === "REQUIRED_ON_SALE"
                                    ? ` · ${t("sell.markingRequired")}`
                                    : ""}
                                </p>
                                <Input
                                  value={markingInput[line.id] ?? ""}
                                  onChange={(event) =>
                                    setMarkingInput((current) => ({
                                      ...current,
                                      [line.id]: event.target.value,
                                    }))
                                  }
                                  placeholder={t("sell.markingPlaceholder")}
                                  className="h-8 px-2 text-sm"
                                />
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-[11px] text-muted-foreground">
                                    {t("sell.markingCapturedCount", {
                                      count: line.markingCodes.length,
                                    })}
                                  </p>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    className="h-8 px-3 text-xs"
                                    onClick={() => handleSaveMarkingCodes(line.id)}
                                    disabled={isLineBusy || completeMutation.isLoading}
                                  >
                                    {t("sell.markingSave")}
                                  </Button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>

                {saleId && sale && hasCartLines ? (
                  <div ref={paymentsSectionRef} className="border-t border-border bg-card">
                    <div className="space-y-2 px-4 py-2">
                      <div className="px-1">
                        <div className="space-y-1 text-[11px] leading-4">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">{t("sell.subtotal")}</span>
                            <span className="font-medium text-muted-foreground">
                              {formatSaleMoney(sale.subtotalKgs)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">{t("sell.discount")}</span>
                            <div className="flex items-center gap-2">
                              {!showDiscountEditor ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-1.5 text-[11px] text-muted-foreground"
                                  onClick={() => setDiscountEditorOpen(true)}
                                  disabled={isLineBusy || completeMutation.isLoading}
                                >
                                  + {t("sell.addDiscount")}
                                </Button>
                              ) : null}
                              <span className="font-medium text-muted-foreground">
                                {formatSaleMoney(sale.discountKgs ?? 0)}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-1.5 flex items-end justify-between gap-3">
                          <span className="text-sm font-semibold leading-none text-foreground">
                            {t("sell.amountDue")}
                          </span>
                          <span className="text-xl font-bold leading-none text-foreground">
                            {formatSaleMoney(sale.totalKgs)}
                          </span>
                        </div>
                      </div>

                      {showDiscountEditor ? (
                        <div className="rounded-md border border-border/60 bg-muted/5 p-2">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs font-medium text-foreground">
                              {t("sell.saleDiscount")}
                            </p>
                            <Badge variant="muted" className="h-6 shrink-0 px-2 text-[11px]">
                              {t("sell.discountAmountMode")}
                            </Badge>
                          </div>
                          <div className="mt-1.5 grid gap-1.5 sm:grid-cols-[1fr_64px_auto]">
                            <Input
                              value={discountDraft}
                              onChange={(event) => setDiscountDraft(event.target.value)}
                              onBlur={() => void handleUpdateDiscount()}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  event.currentTarget.blur();
                                }
                              }}
                              aria-label={t("sell.saleDiscount")}
                              placeholder={t("sell.discountPlaceholder")}
                              inputMode="decimal"
                              disabled={isLineBusy || completeMutation.isLoading}
                              className="h-8 px-2 text-sm"
                            />
                            <div className="flex h-8 items-center justify-center rounded-md border border-input bg-muted/20 px-2 text-[11px] font-medium text-muted-foreground">
                              {discountCurrencyCode}
                            </div>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="h-8 px-2.5 text-xs"
                              onClick={() => void handleUpdateDiscount()}
                              disabled={isLineBusy || completeMutation.isLoading}
                            >
                              {updateDiscountMutation.isLoading ? (
                                <Spinner className="h-3.5 w-3.5" />
                              ) : null}
                              {t("sell.applyDiscount")}
                            </Button>
                          </div>
                        </div>
                      ) : null}

                      <div className="rounded-md border border-border/60 bg-muted/5 p-2">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium leading-none text-foreground">
                              {t("sell.paymentsTitle")}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 rounded-md px-1">
                            <span className="text-xs leading-none text-muted-foreground">
                              {t("sell.sellInDebt")}
                            </span>
                            <Switch checked={sellInDebt} onCheckedChange={handleSellInDebtChange} />
                          </div>
                        </div>

                        {sellInDebt ? (
                          <div className="mt-2 space-y-1.5 rounded-md border border-warning/25 bg-warning/10 p-2">
                            <p className="text-xs leading-4 text-muted-foreground">
                              {t("sell.sellInDebtHint")}
                            </p>
                            <label className="text-xs font-medium text-foreground">
                              {t("sell.debtFullName")}
                            </label>
                            <Input
                              value={debtFullName}
                              onChange={(event) => setDebtFullName(event.target.value)}
                              placeholder={t("sell.debtFullNamePlaceholder")}
                              disabled={isLineBusy || completeMutation.isLoading}
                              className="h-8 px-2 text-sm"
                            />
                          </div>
                        ) : null}

                        {!sellInDebt ? (
                          <div className="mt-2 space-y-1.5">
                            {payments.map((payment, index) => (
                              <div
                                key={`${index}-${payment.method}`}
                                className="grid grid-cols-[116px_1fr_32px] gap-1.5"
                              >
                                <Select
                                  value={payment.method}
                                  onValueChange={(value) =>
                                    setPayments((current) =>
                                      current.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? { ...item, method: value as PosPaymentMethod }
                                          : item,
                                      ),
                                    )
                                  }
                                >
                                  <SelectTrigger
                                    aria-label={t("sell.paymentMethod")}
                                    className="h-8 px-2 text-sm"
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value={PosPaymentMethod.CASH}>
                                      {t("payments.cash")}
                                    </SelectItem>
                                    <SelectItem value={PosPaymentMethod.CARD}>
                                      {t("payments.card")}
                                    </SelectItem>
                                    <SelectItem value={PosPaymentMethod.TRANSFER}>
                                      {t("payments.transfer")}
                                    </SelectItem>
                                    <SelectItem value={PosPaymentMethod.OTHER}>
                                      {t("payments.other")}
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                                <Input
                                  ref={index === 0 ? firstPaymentAmountRef : undefined}
                                  value={payment.amount}
                                  onChange={(event) =>
                                    setPayments((current) =>
                                      current.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? { ...item, amount: event.target.value }
                                          : item,
                                      ),
                                    )
                                  }
                                  placeholder={t("sell.paymentAmount")}
                                  inputMode="decimal"
                                  className="h-8 px-2 text-sm"
                                />
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => removePaymentRow(index)}
                                  disabled={
                                    payments.length <= 1 || isLineBusy || completeMutation.isLoading
                                  }
                                  aria-label={tCommon("delete")}
                                >
                                  <DeleteIcon className="h-4 w-4" aria-hidden />
                                </Button>
                              </div>
                            ))}
                            <div className="flex items-center justify-between gap-3">
                              <Button
                                variant="secondary"
                                size="sm"
                                className="h-8 px-3 text-xs"
                                onClick={addPaymentRow}
                                disabled={isLineBusy || completeMutation.isLoading}
                              >
                                {t("sell.addPayment")}
                              </Button>
                              {showPaymentTotalSummary ? (
                                <p className="text-xs text-muted-foreground">
                                  {t("sell.paymentTotal")}: {paymentTotalLabel}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <Button
                        className="h-9 w-full rounded-md bg-success px-4 text-sm font-semibold text-success-foreground hover:bg-success/90 disabled:bg-success/40 disabled:text-success-foreground/70"
                        onClick={handleComplete}
                        disabled={completeDisabled}
                      >
                        <span className="flex items-center justify-center gap-2">
                          {completeMutation.isLoading ? <Spinner className="h-5 w-5" /> : null}
                          {sellInDebt ? t("sell.completeDebtSale") : t("sell.completeSale")}
                        </span>
                      </Button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </aside>
        </main>
      )}
    </div>
  );

  const MobileCustomerSheet = () => {
    if (!customerSelectorOpen) {
      return null;
    }

    return (
      <div className="fixed inset-0 z-[70] md:hidden">
        <button
          type="button"
          className="absolute inset-0 bg-black/35"
          onClick={() => setCustomerSelectorOpen(false)}
          aria-label={tCommon("close")}
        />
        <section
          role="dialog"
          aria-modal="true"
          aria-label={t("sell.customerSelectorTitle")}
          className="absolute inset-x-0 bottom-0 max-h-[86dvh] overflow-y-auto border-t border-border bg-background p-4 shadow-2xl"
          style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {t("sell.customerSelectorTitle")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("sell.customerSelectorSubtitle")}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={() => setCustomerSelectorOpen(false)}
              aria-label={tCommon("close")}
            >
              <CloseIcon className="h-4 w-4" aria-hidden />
            </Button>
          </div>

          <div className="mt-4 space-y-3">
            <div className="flex gap-2">
              <Input
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                placeholder={t("sell.customerSearchPlaceholder")}
                autoFocus
                className="h-12"
              />
              <Button
                type="button"
                variant={customerCreateOpen ? "default" : "secondary"}
                size="icon"
                className="h-12 w-12 shrink-0"
                onClick={() => setCustomerCreateOpen((current) => !current)}
                aria-label={t("sell.createCustomer")}
                title={t("sell.createCustomer")}
              >
                <AddIcon className="h-4 w-4" aria-hidden />
              </Button>
            </div>
            <Button
              type="button"
              variant={currentCustomer ? "secondary" : "default"}
              className="h-12 w-full justify-start"
              onClick={() => void handleClearCustomer()}
              disabled={updateCustomerMutation.isLoading}
            >
              {t("sell.selectRetailCustomer")}
            </Button>
          </div>

          {customerCreateOpen ? <CustomerCreatePanel /> : null}

          {customerSearchQuery.isLoading || customerSearchQuery.isFetching ? (
            <div className="mt-4 flex items-center justify-center gap-2 border border-border bg-card py-5 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : null}

          {customerSearchQuery.error ? (
            <div className="mt-4 border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
              {translateError(tErrors, customerSearchQuery.error)}
            </div>
          ) : null}

          {!customerSearchQuery.isLoading &&
          !customerSearchQuery.error &&
          !(customerSearchQuery.data?.items.length ?? 0) ? (
            <div className="mt-4 border border-border bg-card px-4 py-5 text-center text-sm text-muted-foreground">
              {t("sell.customerNotFound")}
            </div>
          ) : null}

          {customerSearchQuery.data?.items.length ? (
            <div className="mt-4 divide-y divide-border border border-border bg-card">
              {customerSearchQuery.data.items.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  className="flex min-h-14 w-full flex-col gap-1 px-4 py-3 text-left transition hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    void handleSelectCustomer({
                      id: customer.id,
                      name: customer.name,
                      email: customer.email,
                      phone: customer.phone,
                    });
                  }}
                  disabled={updateCustomerMutation.isLoading}
                >
                  <span className="font-medium text-foreground">{customer.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {[customer.phone, customer.email].filter(Boolean).join(" · ") ||
                      t("sell.customerNoContact")}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    );
  };

  const MobilePosView = () => {
    const cartSheetOpen = mobileCheckoutOpen || showCompletedSale;
    const showMobileRegisterPanel = !hasOpenShift || (registersQuery.data?.length ?? 0) > 1;

    return (
      <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
        <header className="sticky top-0 z-30 border-b border-border bg-background/95 px-3 py-3 shadow-sm backdrop-blur md:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {selectedRegister?.store.name ?? t("entry.register")}
              </p>
              <div className="mt-1 flex min-w-0 items-center gap-2">
                <h1 className="truncate text-lg font-semibold text-foreground">
                  {t("sell.title")}
                </h1>
                <Badge variant={hasOpenShift ? "success" : "warning"} className="shrink-0">
                  {hasOpenShift ? t("entry.shiftOpen") : t("entry.shiftClosed")}
                </Badge>
              </div>
            </div>
            <Button
              asChild
              type="button"
              variant="secondary"
              size="icon"
              className="h-11 w-11 shrink-0"
              aria-label={tCommon("back")}
            >
              <Link href={`/pos${registerId ? `?registerId=${registerId}` : ""}`}>
                <BackIcon className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </div>

          <div className="mt-3 flex min-h-12 items-center gap-2 border border-input bg-card px-3">
            <SearchIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <ScanInput
              ref={lineSearchInputRef}
              context="pos"
              value={lineSearch}
              onValueChange={setLineSearch}
              placeholder={t("sell.searchProduct")}
              ariaLabel={t("sell.searchProduct")}
              onResolved={handleScanResolved}
              supportsTabSubmit
              showDropdown={false}
              disabled={!hasOpenShift}
              className="min-w-0 flex-1"
              inputClassName="h-11 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0"
            />
          </div>
        </header>

        <main className="mx-auto w-full max-w-md space-y-4 px-3 pb-[calc(11rem+env(safe-area-inset-bottom))] pt-4 md:hidden">
          {showMobileRegisterPanel ? (
            <section className="rounded-md border border-border bg-card p-3 shadow-sm">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">{t("entry.register")}</label>
                <Select value={registerId} onValueChange={setRegisterId}>
                  <SelectTrigger aria-label={t("entry.register")} className="h-11">
                    <SelectValue placeholder={t("entry.selectRegister")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(registersQuery.data ?? []).map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.store.name} · {item.name} ({item.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {shiftOpenedLabel ? <span>{shiftOpenedLabel}</span> : null}
                {!hasOpenShift && registerId ? (
                  <Button asChild variant="secondary" className="h-10 w-full">
                    <Link href={`/pos?registerId=${registerId}`}>{t("sell.openShiftFirst")}</Link>
                  </Button>
                ) : null}
              </div>
            </section>
          ) : null}

          {activeDraft && !saleId ? (
            <section className="border border-warning/40 bg-warning/10 p-3 text-sm">
              <p className="font-semibold text-foreground">{t("sell.draftDetectedTitle")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("sell.draftDetectedHint", { number: activeDraft.number })}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  className="h-11"
                  onClick={handleResumeActiveDraft}
                  disabled={isLineBusy || completeMutation.isLoading}
                >
                  {t("sell.resumeDraft")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11"
                  onClick={() => void handleDiscardActiveDraft()}
                  disabled={isLineBusy || completeMutation.isLoading}
                >
                  {cancelDraftMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                  {t("sell.discardSale")}
                </Button>
              </div>
            </section>
          ) : null}

          <section className="space-y-3">
            <div className="scrollbar-none -mx-3 overflow-x-auto px-3">
              <div className="flex w-max min-w-full gap-2">
                <Button
                  type="button"
                  variant={selectedCategory ? "secondary" : "default"}
                  className="h-10 shrink-0"
                  onClick={() => {
                    setSelectedCategory("");
                    setLineSearch("");
                  }}
                >
                  {t("sell.allProducts")}
                </Button>
                {visibleProductCategories.map((category) => (
                  <Button
                    key={category}
                    type="button"
                    variant={selectedCategory === category ? "default" : "secondary"}
                    className="h-10 shrink-0"
                    onClick={() => setSelectedCategory(category)}
                  >
                    {categoryLabel(category)}
                  </Button>
                ))}
              </div>
            </div>

            {catalogProductsQuery.error ? (
              <div className="border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                {translateError(tErrors, catalogProductsQuery.error)}
              </div>
            ) : null}

            {productGridLoading ? (
              <div className="flex min-h-28 items-center justify-center gap-2 border border-border bg-card text-sm text-muted-foreground">
                <Spinner className="h-4 w-4" />
                {tCommon("loading")}
              </div>
            ) : null}

            {!productGridLoading && !visibleProducts.length ? (
              <div className="grid min-h-44 place-items-center border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
                <div>
                  <SearchIcon className="mx-auto h-6 w-6" aria-hidden />
                  <p className="mt-3">
                    {hasSearchTerm || selectedCategory
                      ? t("sell.noSearchResults")
                      : t("sell.catalogEmpty")}
                  </p>
                </div>
              </div>
            ) : null}

            {visibleProducts.length ? (
              <div className="grid gap-2">
                {visibleProducts.map((product) => {
                  const priceKgs = product.effectivePriceKgs ?? product.basePriceKgs ?? null;
                  const stockQty = product.onHandQty ?? null;
                  const barcode = product.barcodes?.[0]?.value ?? null;
                  const primaryImage = product.images[0]?.url ?? product.photoUrl;
                  const stock = stockMeta(stockQty);
                  const productIdentity = [
                    enableSku ? product.sku : "",
                    enableBarcode && barcode ? barcode : "",
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  const priceMissing = priceKgs === null;

                  return (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => {
                        if (priceMissing) {
                          toast({
                            variant: "error",
                            description: t("sell.priceMissingCannotSell"),
                          });
                          return;
                        }
                        blurLineSearchInput();
                        void handleAddLine(product.id);
                      }}
                      disabled={!hasOpenShift || isLineBusy || completeMutation.isLoading}
                      className="grid min-h-20 w-full grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 border border-border bg-card p-2 text-left shadow-sm transition hover:border-primary/40 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="grid h-16 w-16 place-items-center overflow-hidden border border-border bg-muted/30">
                        {primaryImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={primaryImage}
                            alt={product.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <EmptyIcon className="h-5 w-5 text-muted-foreground" aria-hidden />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="line-clamp-2 text-sm font-semibold text-foreground">
                          {product.name}
                        </span>
                        {productIdentity ? (
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {productIdentity}
                          </span>
                        ) : null}
                        <span
                          className={`mt-1 inline-flex max-w-full items-center gap-1 border px-1.5 py-0.5 text-[11px] font-semibold ${stock.className}`}
                        >
                          {stock.showWarningIcon ? (
                            <StatusWarningIcon className="h-3 w-3 shrink-0" aria-hidden />
                          ) : null}
                          <span className="truncate">{stock.label}</span>
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-sm font-semibold text-foreground">
                        {priceMissing ? t("sell.priceMissing") : formatSaleMoney(priceKgs)}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </section>
        </main>

        {!cartSheetOpen ? (
          <button
            type="button"
            className="fixed inset-x-3 z-40 flex min-h-14 items-center justify-between gap-3 border border-border bg-primary px-4 py-3 text-left text-primary-foreground shadow-xl md:hidden"
            style={{ bottom: "calc(5.75rem + env(safe-area-inset-bottom))" }}
            onClick={() => setMobileCheckoutOpen(true)}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{checkoutSheetSummary}</span>
              <span className="block truncate text-xs text-primary-foreground/80">
                {selectedRegisterLabel}
              </span>
            </span>
            <span className="shrink-0 text-sm font-semibold">{t("sell.openCart")}</span>
          </button>
        ) : null}

        {cartSheetOpen ? (
          <div className="fixed inset-0 z-[60] md:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-black/35"
              onClick={() => {
                if (!showCompletedSale) {
                  setMobileCheckoutOpen(false);
                }
              }}
              aria-label={tCommon("close")}
            />
            <section
              role="dialog"
              aria-modal="true"
              aria-label={checkoutPanelTitle}
              className="absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col overflow-hidden border-t border-border bg-background shadow-2xl"
              style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            >
              {showCompletedSale && lastCompletedSale ? (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="border-b border-border p-4">
                    <Badge variant={autoReceiptStatus === "failed" ? "danger" : "success"}>
                      {t("sell.saleCompletedTitle")}
                    </Badge>
                    <h2 className="mt-4 text-xl font-semibold text-foreground">
                      {t("sell.completeSuccess", { number: lastCompletedSale.number })}
                    </h2>
                    <p
                      className={`mt-2 text-sm ${
                        autoReceiptStatus === "failed" ? "text-danger" : "text-muted-foreground"
                      }`}
                    >
                      {receiptStatusLabel}
                    </p>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    <div className="grid gap-2">
                      <Button type="button" className="h-12 w-full" onClick={handleStartNewSale}>
                        {t("sell.newSale")}
                      </Button>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          variant="secondary"
                          className="h-11"
                          onClick={() => {
                            void handleReceiptPdf("print", "precheck");
                          }}
                          disabled={Boolean(receiptAction)}
                        >
                          {receiptAction?.mode === "print" && receiptAction.kind === "precheck" ? (
                            <Spinner className="h-4 w-4" />
                          ) : (
                            <PrintIcon className="h-4 w-4" aria-hidden />
                          )}
                          {t("sell.printPrecheck")}
                        </Button>
                        <Button
                          variant="secondary"
                          className="h-11"
                          onClick={() => {
                            void handleReceiptPdf("download", "precheck");
                          }}
                          disabled={Boolean(receiptAction)}
                        >
                          {receiptAction?.mode === "download" &&
                          receiptAction.kind === "precheck" ? (
                            <Spinner className="h-4 w-4" />
                          ) : (
                            <DownloadIcon className="h-4 w-4" aria-hidden />
                          )}
                          {t("sell.downloadPrecheck")}
                        </Button>
                      </div>
                      {lastCompletedSale.kkmStatus === "SENT" ? (
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            variant="secondary"
                            className="h-11"
                            onClick={() => {
                              void handleReceiptPdf("print", "fiscal");
                            }}
                            disabled={Boolean(receiptAction)}
                          >
                            {receiptAction?.mode === "print" && receiptAction.kind === "fiscal" ? (
                              <Spinner className="h-4 w-4" />
                            ) : (
                              <PrintIcon className="h-4 w-4" aria-hidden />
                            )}
                            {t("sell.printFiscalReceipt")}
                          </Button>
                          <Button
                            variant="secondary"
                            className="h-11"
                            onClick={() => {
                              void handleReceiptPdf("download", "fiscal");
                            }}
                            disabled={Boolean(receiptAction)}
                          >
                            {receiptAction?.mode === "download" &&
                            receiptAction.kind === "fiscal" ? (
                              <Spinner className="h-4 w-4" />
                            ) : (
                              <DownloadIcon className="h-4 w-4" aria-hidden />
                            )}
                            {t("sell.downloadFiscalReceipt")}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    <p className="mt-4 text-center text-xs text-muted-foreground">
                      {t("sell.receiptActionsHint")}
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex min-h-16 items-center justify-between gap-3 border-b border-border px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-foreground">
                        {checkoutPanelTitle}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {checkoutSheetSummary}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className="h-11 w-11 shrink-0"
                      onClick={() => setMobileCheckoutOpen(false)}
                      aria-label={tCommon("close")}
                    >
                      <CloseIcon className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    {saleId && saleQuery.error ? (
                      <div className="mb-3 border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                        {translateError(tErrors, saleQuery.error)}
                      </div>
                    ) : null}

                    <div className="mb-4 border border-border bg-card p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {t("sell.customer")}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          className="min-h-11 min-w-0 flex-1 border border-border bg-background px-3 py-2 text-left"
                          onClick={() => setCustomerSelectorOpen(true)}
                          disabled={!activeStoreId}
                        >
                          <span className="block truncate text-sm font-semibold text-foreground">
                            {currentCustomerLabel}
                          </span>
                          {currentCustomerDetails ? (
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {currentCustomerDetails}
                            </span>
                          ) : null}
                        </button>
                        {currentCustomer ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="icon"
                            className="h-11 w-11 shrink-0"
                            onClick={() => void handleClearCustomer()}
                            disabled={updateCustomerMutation.isLoading}
                            aria-label={t("sell.clearCustomer")}
                          >
                            {updateCustomerMutation.isLoading ? (
                              <Spinner className="h-4 w-4" />
                            ) : (
                              <CloseIcon className="h-4 w-4" aria-hidden />
                            )}
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    {!saleId || (!hasCartLines && !saleQuery.isLoading && !saleQuery.error) ? (
                      <div className="grid min-h-40 place-items-center border border-dashed border-border bg-card p-6 text-center">
                        <div>
                          <EmptyIcon
                            className="mx-auto h-6 w-6 text-muted-foreground"
                            aria-hidden
                          />
                          <p className="mt-3 text-sm font-semibold text-foreground">
                            {t("sell.emptyCartTitle")}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {t("sell.emptyCartHint")}
                          </p>
                        </div>
                      </div>
                    ) : null}

                    {saleId && saleQuery.isLoading ? (
                      <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                        <Spinner className="h-4 w-4" />
                        {tCommon("loading")}
                      </div>
                    ) : null}

                    {hasCartLines ? (
                      <div className="space-y-3">
                        {saleLines.map((line) => {
                          const lineDiscountKgs = lineDiscountById.get(line.id) ?? 0;
                          const lineNetTotalKgs = roundMoney(
                            Math.max(0, line.lineTotalKgs - lineDiscountKgs),
                          );

                          return (
                            <div key={line.id} className="rounded-md border border-border bg-card p-3">
                              <div className="flex gap-3">
                                {line.product.primaryImage ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={line.product.primaryImage}
                                    alt={line.product.name}
                                    className="h-14 w-14 shrink-0 border border-border object-cover"
                                  />
                                ) : (
                                  <span className="grid h-14 w-14 shrink-0 place-items-center border border-dashed border-border bg-muted/40 text-muted-foreground">
                                    <EmptyIcon className="h-4 w-4" aria-hidden />
                                  </span>
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="line-clamp-2 text-sm font-semibold text-foreground">
                                        {line.product.name}
                                        {line.product.isBundle ? ` · ${t("sell.bundle")}` : ""}
                                      </p>
                                      {enableSku ? (
                                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                          {line.product.sku}
                                        </p>
                                      ) : null}
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive"
                                      onClick={() => handleRemoveLine(line.id)}
                                      disabled={isLineBusy || completeMutation.isLoading}
                                      aria-label={tCommon("delete")}
                                    >
                                      <DeleteIcon className="h-4 w-4" aria-hidden />
                                    </Button>
                                  </div>

                                  <div className="mt-3 grid grid-cols-[minmax(0,1fr)_132px] gap-2">
                                    <Input
                                      key={`${line.id}:mobile-price:${line.unitPriceKgs}`}
                                      defaultValue={formatSaleMoneyDraft(line.unitPriceKgs)}
                                      aria-label={t("sell.unitPrice")}
                                      inputMode="decimal"
                                      className="h-11 text-right"
                                      onFocus={(event) => event.currentTarget.select()}
                                      onBlur={(event) =>
                                        handleUpdateLinePrice(
                                          line.id,
                                          event.currentTarget.value,
                                          line.unitPriceKgs,
                                        )
                                      }
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                          event.currentTarget.blur();
                                        }
                                        if (event.key === "Escape") {
                                          event.currentTarget.value = formatSaleMoneyDraft(
                                            line.unitPriceKgs,
                                          );
                                          event.currentTarget.blur();
                                        }
                                      }}
                                      disabled={isLineBusy || completeMutation.isLoading}
                                    />
                                    <div className="inline-flex h-11 w-[132px] items-center overflow-hidden border border-border bg-background">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-11 w-11 rounded-md text-base"
                                        onClick={() =>
                                          handleUpdateQty(
                                            line.id,
                                            String(Math.max(1, line.qty - 1)),
                                          )
                                        }
                                        disabled={
                                          line.qty <= 1 || isLineBusy || completeMutation.isLoading
                                        }
                                        aria-label={t("sell.decreaseQty")}
                                      >
                                        -
                                      </Button>
                                      <Input
                                        key={`${line.id}:mobile-qty:${line.qty}`}
                                        defaultValue={String(line.qty)}
                                        onBlur={(event) =>
                                          handleUpdateQty(line.id, event.target.value)
                                        }
                                        className="h-11 w-11 rounded-md border-y-0 px-1 text-center shadow-none focus-visible:ring-0"
                                        inputMode="numeric"
                                        disabled={isLineBusy || completeMutation.isLoading}
                                      />
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-11 w-11 rounded-md text-base"
                                        onClick={() =>
                                          handleUpdateQty(line.id, String(line.qty + 1))
                                        }
                                        disabled={isLineBusy || completeMutation.isLoading}
                                        aria-label={t("sell.increaseQty")}
                                      >
                                        +
                                      </Button>
                                    </div>
                                  </div>

                                  <div className="mt-3 flex items-end justify-between gap-3">
                                    <div className="min-w-0">
                                      {lineDiscountKgs > 0 ? (
                                        <p className="truncate text-xs text-muted-foreground">
                                          {t("sell.discount")}: {formatSaleMoney(lineDiscountKgs)}
                                        </p>
                                      ) : null}
                                    </div>
                                    <p className="text-right text-base font-semibold text-foreground">
                                      {formatSaleMoney(lineNetTotalKgs)}
                                    </p>
                                  </div>
                                </div>
                              </div>

                              {saleMarkingEnabled &&
                              line.product.complianceFlags?.requiresMarking ? (
                                <div className="mt-3 space-y-2 border border-border bg-muted/20 p-2">
                                  <p className="text-xs text-muted-foreground">
                                    {t("sell.markingLabel")}
                                    {saleMarkingMode === "REQUIRED_ON_SALE"
                                      ? ` · ${t("sell.markingRequired")}`
                                      : ""}
                                  </p>
                                  <Input
                                    value={markingInput[line.id] ?? ""}
                                    onChange={(event) =>
                                      setMarkingInput((current) => ({
                                        ...current,
                                        [line.id]: event.target.value,
                                      }))
                                    }
                                    placeholder={t("sell.markingPlaceholder")}
                                    className="h-10"
                                  />
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    className="h-9 w-full"
                                    onClick={() => handleSaveMarkingCodes(line.id)}
                                    disabled={isLineBusy || completeMutation.isLoading}
                                  >
                                    {t("sell.markingSave")}
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    {saleId && sale && hasCartLines ? (
                      <div className="mt-4 space-y-3">
                        <div className="rounded-md border border-border bg-card p-3">
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="text-muted-foreground">{t("sell.subtotal")}</span>
                            <span className="font-medium text-foreground">
                              {formatSaleMoney(sale.subtotalKgs)}
                            </span>
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                            <span className="text-muted-foreground">{t("sell.discount")}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-xs"
                              onClick={() => setDiscountEditorOpen((current) => !current)}
                              disabled={isLineBusy || completeMutation.isLoading}
                            >
                              {sale.discountKgs > 0
                                ? formatSaleMoney(sale.discountKgs)
                                : `+ ${t("sell.addDiscount")}`}
                            </Button>
                          </div>
                          {showDiscountEditor ? (
                            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_72px] gap-2">
                              <Input
                                value={discountDraft}
                                onChange={(event) => setDiscountDraft(event.target.value)}
                                onBlur={() => void handleUpdateDiscount()}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    event.currentTarget.blur();
                                  }
                                }}
                                aria-label={t("sell.saleDiscount")}
                                placeholder={t("sell.discountPlaceholder")}
                                inputMode="decimal"
                                disabled={isLineBusy || completeMutation.isLoading}
                                className="h-11 text-right"
                              />
                              <span className="flex h-11 items-center justify-center border border-input bg-muted/20 px-2 text-xs font-medium text-muted-foreground">
                                {discountCurrencyCode}
                              </span>
                            </div>
                          ) : null}
                          <div className="mt-3 flex items-end justify-between gap-3">
                            <span className="text-sm font-semibold text-foreground">
                              {t("sell.amountDue")}
                            </span>
                            <span className="text-xl font-bold text-foreground">
                              {formatSaleMoney(sale.totalKgs)}
                            </span>
                          </div>
                        </div>

                        <div ref={paymentsSectionRef} className="rounded-md border border-border bg-card p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-foreground">
                              {t("sell.paymentsTitle")}
                            </p>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">
                                {t("sell.sellInDebt")}
                              </span>
                              <Switch
                                checked={sellInDebt}
                                onCheckedChange={handleSellInDebtChange}
                              />
                            </div>
                          </div>

                          {sellInDebt ? (
                            <div className="mt-3 space-y-2 border border-warning/30 bg-warning/10 p-2">
                              <p className="text-xs text-muted-foreground">
                                {t("sell.sellInDebtHint")}
                              </p>
                              <Input
                                value={debtFullName}
                                onChange={(event) => setDebtFullName(event.target.value)}
                                placeholder={t("sell.debtFullNamePlaceholder")}
                                disabled={isLineBusy || completeMutation.isLoading}
                                className="h-11"
                              />
                            </div>
                          ) : null}

                          {!sellInDebt ? (
                            <div className="mt-3 space-y-2">
                              {payments.map((payment, index) => (
                                <div
                                  key={`${index}-${payment.method}`}
                                  className="grid grid-cols-[1fr_1fr_44px] gap-2"
                                >
                                  <Select
                                    value={payment.method}
                                    onValueChange={(value) =>
                                      setPayments((current) =>
                                        current.map((item, itemIndex) =>
                                          itemIndex === index
                                            ? { ...item, method: value as PosPaymentMethod }
                                            : item,
                                        ),
                                      )
                                    }
                                  >
                                    <SelectTrigger
                                      aria-label={t("sell.paymentMethod")}
                                      className="h-11"
                                    >
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value={PosPaymentMethod.CASH}>
                                        {t("payments.cash")}
                                      </SelectItem>
                                      <SelectItem value={PosPaymentMethod.CARD}>
                                        {t("payments.card")}
                                      </SelectItem>
                                      <SelectItem value={PosPaymentMethod.TRANSFER}>
                                        {t("payments.transfer")}
                                      </SelectItem>
                                      <SelectItem value={PosPaymentMethod.OTHER}>
                                        {t("payments.other")}
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <Input
                                    ref={index === 0 ? firstPaymentAmountRef : undefined}
                                    value={payment.amount}
                                    onChange={(event) =>
                                      setPayments((current) =>
                                        current.map((item, itemIndex) =>
                                          itemIndex === index
                                            ? { ...item, amount: event.target.value }
                                            : item,
                                        ),
                                      )
                                    }
                                    placeholder={t("sell.paymentAmount")}
                                    inputMode="decimal"
                                    className="h-11"
                                  />
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="icon"
                                    className="h-11 w-11"
                                    onClick={() => removePaymentRow(index)}
                                    disabled={
                                      payments.length <= 1 ||
                                      isLineBusy ||
                                      completeMutation.isLoading
                                    }
                                    aria-label={tCommon("delete")}
                                  >
                                    <DeleteIcon className="h-4 w-4" aria-hidden />
                                  </Button>
                                </div>
                              ))}
                              <div className="flex items-center justify-between gap-3">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  className="h-10"
                                  onClick={addPaymentRow}
                                  disabled={isLineBusy || completeMutation.isLoading}
                                >
                                  {t("sell.addPayment")}
                                </Button>
                                {showPaymentTotalSummary ? (
                                  <p className="text-sm text-muted-foreground">
                                    {t("sell.paymentTotal")}: {paymentTotalLabel}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {saleId && sale && hasCartLines ? (
                    <div className="border-t border-border bg-background p-4">
                      <Button
                        className="h-12 w-full bg-success text-base font-semibold text-success-foreground hover:bg-success/90 disabled:bg-success/40 disabled:text-success-foreground/70"
                        onClick={handleComplete}
                        disabled={completeDisabled}
                      >
                        {completeMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                        {sellInDebt ? t("sell.completeDebtSale") : t("sell.completeSale")}
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </section>
          </div>
        ) : null}

        <MobileCustomerSheet />
      </div>
    );
  };

  if (isPhoneScreen === null) {
    return <div className="min-h-screen bg-background" />;
  }

  return isPhoneScreen ? MobilePosView() : DesktopPosSaleView();
};

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export default PosSellPage;

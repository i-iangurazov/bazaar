"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PosPaymentMethod } from "@prisma/client";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import {
  BackIcon,
  DeleteIcon,
  DownloadIcon,
  EmptyIcon,
  PrintIcon,
  SearchIcon,
  TagIcon,
} from "@/components/icons";
import { ScanInput } from "@/components/ScanInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
} from "@/lib/currencyDisplay";
import { formatNumber } from "@/lib/i18nFormat";
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

const hasTouchKeyboard = () => {
  if (typeof window === "undefined") {
    return false;
  }
  return (
    (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches) ||
    (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0)
  );
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
  const [sellInDebt, setSellInDebt] = useState(false);
  const [debtFullName, setDebtFullName] = useState("");
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

  const searchTerm = lineSearch.trim();
  const hasSearchTerm = searchTerm.length >= 1;
  const activeStoreId = shiftQuery.data?.store.id;
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
      pageSize: 200,
      sortKey: "name",
      sortDirection: "asc",
    },
    { enabled: Boolean(activeStoreId) },
  );

  const createDraftMutation = trpc.pos.sales.createDraft.useMutation({
    onSuccess: (sale) => {
      setSaleId(sale.id);
      setPayments([createDefaultPosPaymentDraft()]);
      toast({ variant: "success", description: t("sell.saleCreated") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const addLineMutation = trpc.pos.sales.addLine.useMutation({
    onSuccess: (result) => {
      setLineSearch("");
      if (result.lineAction === "created") {
        toast({ variant: "success", description: t("sell.lineAdded") });
      }
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
      toast({ variant: "success", description: t("sell.markingSaved") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const cancelDraftMutation = trpc.pos.sales.cancelDraft.useMutation({
    onSuccess: async () => {
      toast({ variant: "success", description: t("sell.saleDiscarded") });
      setSaleId(null);
      setLineSearch("");
      setPayments([createDefaultPosPaymentDraft()]);
      setDiscountDraft("");
      setSellInDebt(false);
      setDebtFullName("");
      paymentAutoFillRef.current = { saleId: null, totalKgs: null };
      await Promise.all([activeDraftQuery.refetch(), trpcUtils.pos.sales.list.invalidate()]);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const completeMutation = trpc.pos.sales.complete.useMutation({
    onSuccess: async (result) => {
      toast({
        variant: "success",
        description: t("sell.completeSuccess", { number: result.number }),
      });
      setLastCompletedSale({
        id: result.id,
        number: result.number,
        kkmStatus: result.kkmStatus,
      });
      setAutoReceiptStatus("printing");
      setSaleId(null);
      setPayments([createDefaultPosPaymentDraft()]);
      setDiscountDraft("");
      setSellInDebt(false);
      setDebtFullName("");
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
    setSellInDebt(false);
    setDebtFullName("");
    paymentAutoFillRef.current = { saleId: null, totalKgs: null };
    setLastCompletedSale(null);
    setAutoReceiptStatus("idle");
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
  }, [saleId, saleQuery.data, saleQuery.isFetched, saleQuery.isFetching, saleQuery.isLoading]);

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
          });
          targetSaleId = draft.id;
        }
        setSaleId(targetSaleId);

        await addLineMutation.mutateAsync({
          saleId: targetSaleId,
          productId,
          qty: 1,
        });

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
    setSaleId(activeDraft.id);
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

  const handleReceiptPdf = async (mode: "download" | "print", kind: "precheck" | "fiscal") => {
    if (!lastCompletedSale || receiptAction) {
      return;
    }
    setReceiptAction({ mode, kind });
    try {
      const blob = await fetchPdfBlob({
        url: `/api/pos/receipts/${lastCompletedSale.id}/pdf?kind=${kind}&action=${mode === "print" ? "reprint" : "download"}`,
      });
      if (mode === "print") {
        const result = await printPdfBlob(blob);
        if (!result.autoPrintAttempted) {
          toast({ variant: "info", description: t("sell.receiptPrintFallback") });
        }
      } else {
        downloadPdfBlob(blob, `pos-receipt-${lastCompletedSale.number}-${kind}.pdf`);
      }
    } catch {
      toast({ variant: "error", description: t("sell.receiptPdfFailed") });
    } finally {
      setReceiptAction(null);
    }
  };

  useEffect(() => {
    if (!lastCompletedSale || autoPrintedSaleIdRef.current === lastCompletedSale.id) {
      return;
    }

    let active = true;
    autoPrintedSaleIdRef.current = lastCompletedSale.id;
    setAutoReceiptStatus("printing");

    void (async () => {
      try {
        const blob = await fetchPdfBlob({
          url: `/api/pos/receipts/${lastCompletedSale.id}/pdf?kind=precheck&action=auto_print`,
        });
        const result = await printPdfBlob(blob);
        if (!active) {
          return;
        }
        setAutoReceiptStatus(result.autoPrintAttempted ? "ready" : "blocked");
      } catch {
        if (active) {
          setAutoReceiptStatus("failed");
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [lastCompletedSale]);

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

  return (
    <div className="min-h-screen bg-muted/40 text-foreground">
      <header className="sticky top-0 z-30 flex min-h-16 flex-col border-b border-border bg-background shadow-sm lg:h-16 lg:flex-row">
        <Button
          asChild
          className="h-16 w-full rounded-none bg-primary px-5 text-base font-semibold text-primary-foreground hover:bg-primary/90 lg:w-32"
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

        <div className="grid min-h-16 gap-0 border-t border-border bg-muted/30 lg:w-[600px] lg:border-l lg:border-t-0 2xl:w-[680px]">
          <div className="flex min-w-0 flex-col justify-center gap-1 px-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant={hasOpenShift ? "success" : "warning"}>
                {hasOpenShift ? t("entry.shiftOpen") : t("entry.shiftClosed")}
              </Badge>
              <span className="truncate">{t("sell.retailCustomer")}</span>
            </div>
            <Select value={registerId} onValueChange={setRegisterId}>
              <SelectTrigger
                aria-label={t("entry.register")}
                className="h-7 border-0 bg-transparent px-0 text-left font-semibold shadow-none focus:ring-0"
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
        <main className="grid min-h-[calc(100vh-4rem)] lg:h-[calc(100vh-4rem)] lg:grid-cols-[minmax(0,1fr)_600px] 2xl:grid-cols-[minmax(0,1fr)_680px]">
          <section className="flex min-h-0 flex-col bg-muted/40">
            <div className="min-h-14 overflow-x-auto border-b border-border/70 bg-card px-4 py-3 shadow-sm">
              <div className="flex w-max min-w-full items-center justify-center gap-2">
                <Button
                  type="button"
                  variant={selectedCategory ? "secondary" : "default"}
                  className="h-10 shrink-0 rounded-sm"
                  onClick={() => {
                    setSelectedCategory("");
                    setLineSearch("");
                  }}
                >
                  <TagIcon className="h-4 w-4" aria-hidden />
                  {t("sell.allProducts")}
                </Button>
                {productCategories.map((category) => (
                  <Button
                    key={category}
                    type="button"
                    variant={selectedCategory === category ? "default" : "secondary"}
                    className="h-10 shrink-0 rounded-sm"
                    onClick={() => setSelectedCategory(category)}
                  >
                    {category}
                  </Button>
                ))}
              </div>
            </div>

            {activeDraft && !saleId ? (
              <div className="mx-4 mt-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <p className="font-semibold text-foreground">{t("sell.draftDetectedTitle")}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("sell.draftDetectedHint", { number: activeDraft.number })}
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
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:gap-5 xl:grid-cols-4 2xl:grid-cols-5">
                  {visibleProducts.map((product) => {
                    const priceKgs = product.effectivePriceKgs ?? product.basePriceKgs ?? null;
                    const stockQty = product.onHandQty ?? null;
                    const barcode = product.barcodes?.[0]?.value ?? null;
                    const primaryImage = product.images[0]?.url ?? product.photoUrl;

                    return (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => {
                          blurLineSearchInput();
                          void handleAddLine(product.id);
                        }}
                        disabled={isLineBusy || completeMutation.isLoading}
                        className="group relative flex min-h-[270px] flex-col rounded-md border border-border bg-card text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/60 hover:bg-accent/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 dark:shadow-none dark:hover:bg-accent/40"
                      >
                        <div className="absolute right-3 top-3 z-10 rounded-full border border-border bg-card/95 px-2.5 py-1 text-xs font-semibold text-muted-foreground shadow-sm">
                          {stockQty === null
                            ? tCommon("notAvailable")
                            : `${formatNumber(stockQty, locale)} ${t("sell.stockUnitShort")}`}
                        </div>
                        <div className="flex h-36 items-center justify-center rounded-t-md bg-muted/40 px-4 py-4">
                          {primaryImage ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={primaryImage}
                              alt={product.name}
                              className="max-h-full max-w-full rounded-sm object-contain"
                            />
                          ) : (
                            <span className="grid h-20 w-20 place-items-center rounded-sm border border-dashed border-border bg-muted/40 text-muted-foreground">
                              <EmptyIcon className="h-6 w-6" aria-hidden />
                            </span>
                          )}
                        </div>
                        <div className="flex flex-1 flex-col justify-between gap-3 px-4 pb-4 pt-3">
                          <div>
                            <p className="line-clamp-2 min-h-10 text-sm font-medium text-foreground">
                              {product.name}
                            </p>
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              {barcode ?? product.sku}
                            </p>
                          </div>
                          <div className="border-t border-border pt-3">
                            <p className="text-base font-bold text-foreground">
                              {priceKgs === null
                                ? tCommon("notAvailable")
                                : formatSaleMoney(priceKgs)}
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
              <span className="h-3 w-3 justify-self-end rounded-full bg-success" aria-hidden />
            </footer>
          </section>

          <aside className="flex min-h-[620px] flex-col border-l border-border bg-card lg:min-h-0">
            {lastCompletedSale ? (
              <div className="border-b border-border bg-success/10 px-4 py-3">
                <p className="text-sm font-semibold text-foreground">
                  {t("sell.lastReceiptTitle", { number: lastCompletedSale.number })}
                </p>
                <p className="mt-1 text-xs text-success">
                  {autoReceiptStatus === "printing"
                    ? t("sell.receiptAutoPrinting")
                    : autoReceiptStatus === "ready"
                      ? t("sell.receiptAutoReady")
                      : autoReceiptStatus === "blocked"
                        ? t("sell.receiptAutoBlocked")
                        : autoReceiptStatus === "failed"
                          ? t("sell.receiptAutoFailed")
                          : t("sell.receiptManualFallback")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
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
                  <Button
                    size="sm"
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
                  {lastCompletedSale.kkmStatus === "SENT" ? (
                    <>
                      <Button
                        size="sm"
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
                      <Button
                        size="sm"
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
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-foreground">{t("sell.saleTitle")}</p>
                <p className="text-xs text-muted-foreground">
                  {sale?.number
                    ? `${t("sell.saleNumber")}: ${sale.number}`
                    : t("sell.startByAddingProduct")}
                </p>
              </div>
              {saleId ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleDiscardSale}
                  disabled={isLineBusy || completeMutation.isLoading}
                >
                  {cancelDraftMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                  {t("sell.discardSale")}
                </Button>
              ) : null}
            </div>

            <div className="overflow-hidden border-b border-border bg-muted/30">
              <div className="grid grid-cols-[minmax(120px,1fr)_78px_72px_78px_88px_32px] gap-2 px-3 py-2 text-[11px] font-semibold text-foreground sm:text-xs 2xl:grid-cols-[minmax(180px,1fr)_96px_86px_96px_110px_36px]">
                <span>{t("sell.cartName")}</span>
                <span className="text-right">{t("sell.cartPrice")}</span>
                <span className="text-right">{t("sell.cartQty")}</span>
                <span className="text-right">{t("sell.cartDiscount")}</span>
                <span className="text-right">{t("sell.cartTotal")}</span>
                <span />
              </div>
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

              {!saleId ? (
                <div className="grid min-h-[260px] place-items-center p-6 text-center text-sm text-muted-foreground">
                  {t("sell.startByAddingProduct")}
                </div>
              ) : null}

              {saleId && !(sale?.lines ?? []).length && !saleQuery.isLoading && !saleQuery.error ? (
                <div className="grid min-h-[260px] place-items-center p-6 text-center text-sm text-muted-foreground">
                  {t("sell.noLinesYet")}
                </div>
              ) : null}

              {(sale?.lines ?? []).map((line) =>
                (() => {
                  const lineDiscountKgs = lineDiscountById.get(line.id) ?? 0;
                  const lineNetTotalKgs = roundMoney(
                    Math.max(0, line.lineTotalKgs - lineDiscountKgs),
                  );

                  return (
                    <div
                      key={line.id}
                      className="grid grid-cols-[minmax(120px,1fr)_78px_72px_78px_88px_32px] items-start gap-2 border-b border-border px-3 py-4 text-xs sm:text-sm 2xl:grid-cols-[minmax(180px,1fr)_96px_86px_96px_110px_36px]"
                    >
                      <div className="min-w-0">
                        <div className="flex min-w-0 gap-2 2xl:gap-3">
                          {line.product.primaryImage ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={line.product.primaryImage}
                              alt={line.product.name}
                              className="h-12 w-12 shrink-0 rounded-sm border border-border object-cover 2xl:h-14 2xl:w-14"
                            />
                          ) : (
                            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-sm border border-dashed border-border bg-muted/40 text-muted-foreground 2xl:h-14 2xl:w-14">
                              <EmptyIcon className="h-5 w-5" aria-hidden />
                            </span>
                          )}
                          <div className="min-w-0">
                            <p className="font-medium leading-snug text-foreground">
                              {line.product.name}
                              {line.product.isBundle ? ` · ${t("sell.bundle")}` : ""}
                            </p>
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              {line.product.sku}
                            </p>
                          </div>
                        </div>
                        {saleMarkingEnabled && line.product.complianceFlags?.requiresMarking ? (
                          <div className="mt-2 space-y-2 rounded-md border border-border bg-muted/20 p-2">
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
                              className="h-8"
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
                                onClick={() => handleSaveMarkingCodes(line.id)}
                                disabled={isLineBusy || completeMutation.isLoading}
                              >
                                {t("sell.markingSave")}
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <span className="break-words text-right leading-tight text-muted-foreground">
                        {formatSaleMoney(line.unitPriceKgs)}
                      </span>
                      <Input
                        key={`${line.id}:${line.qty}`}
                        defaultValue={String(line.qty)}
                        onBlur={(event) => handleUpdateQty(line.id, event.target.value)}
                        className="ml-auto h-8 w-14 bg-warning/10 text-right 2xl:w-16"
                        inputMode="numeric"
                        disabled={isLineBusy || completeMutation.isLoading}
                      />
                      <span className="break-words text-right leading-tight text-muted-foreground">
                        {formatSaleMoney(lineDiscountKgs)}
                      </span>
                      <span className="break-words text-right font-medium leading-tight text-foreground">
                        {formatSaleMoney(lineNetTotalKgs)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-auto h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemoveLine(line.id)}
                        disabled={isLineBusy || completeMutation.isLoading}
                        aria-label={tCommon("delete")}
                      >
                        <DeleteIcon className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  );
                })(),
              )}
            </div>

            <div ref={paymentsSectionRef} className="border-t border-border bg-card">
              {saleId && sale ? (
                <div className="space-y-3 px-4 py-3">
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">{t("sell.subtotal")}</span>
                      <span className="font-medium">{formatSaleMoney(sale.subtotalKgs)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">{t("sell.discount")}</span>
                      <span className="font-medium">{formatSaleMoney(sale.discountKgs ?? 0)}</span>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
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
                      placeholder={t("sell.discountPlaceholder")}
                      inputMode="decimal"
                      disabled={isLineBusy || completeMutation.isLoading}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void handleUpdateDiscount()}
                      disabled={isLineBusy || completeMutation.isLoading}
                    >
                      {updateDiscountMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                      {t("sell.applyDiscount")}
                    </Button>
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t border-border pt-2">
                    <span className="text-sm font-semibold text-foreground">
                      {t("sell.orderTotal")}
                    </span>
                    <span className="text-xl font-bold text-foreground">
                      {formatSaleMoney(sale.totalKgs)}
                    </span>
                  </div>

                  <div className="rounded-md border border-border bg-muted/20 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {t("sell.sellInDebt")}
                        </p>
                        <p className="text-xs text-muted-foreground">{t("sell.sellInDebtHint")}</p>
                      </div>
                      <Switch checked={sellInDebt} onCheckedChange={handleSellInDebtChange} />
                    </div>
                    {sellInDebt ? (
                      <div className="mt-3 space-y-2">
                        <label className="text-sm font-medium text-foreground">
                          {t("sell.debtFullName")}
                        </label>
                        <Input
                          value={debtFullName}
                          onChange={(event) => setDebtFullName(event.target.value)}
                          placeholder={t("sell.debtFullNamePlaceholder")}
                          disabled={isLineBusy || completeMutation.isLoading}
                        />
                      </div>
                    ) : null}
                  </div>

                  {!sellInDebt ? (
                    <div className="space-y-2">
                      {payments.map((payment, index) => (
                        <div
                          key={`${index}-${payment.method}`}
                          className="grid grid-cols-[130px_1fr_40px] gap-2"
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
                            <SelectTrigger aria-label={t("sell.paymentMethod")}>
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
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            size="icon"
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
                          onClick={addPaymentRow}
                          disabled={isLineBusy || completeMutation.isLoading}
                        >
                          {t("sell.addPayment")}
                        </Button>
                        <p className="text-sm text-muted-foreground">
                          {t("sell.paymentTotal")}: {paymentTotalLabel}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t("sell.debtTotal")}: {formatSaleMoney(sale.totalKgs)}
                    </p>
                  )}
                </div>
              ) : null}

              <div className="grid grid-cols-[92px_1fr]">
                <Button
                  type="button"
                  variant="destructive"
                  className="h-16 rounded-none"
                  onClick={saleId ? handleDiscardSale : undefined}
                  disabled={!saleId || isLineBusy || completeMutation.isLoading}
                  aria-label={t("sell.discardSale")}
                >
                  {cancelDraftMutation.isLoading ? (
                    <Spinner className="h-5 w-5" />
                  ) : (
                    <DeleteIcon className="h-5 w-5" aria-hidden />
                  )}
                </Button>
                <Button
                  className="h-16 justify-between rounded-none bg-success px-5 text-lg font-bold uppercase text-success-foreground hover:bg-success/90 disabled:bg-success/40 disabled:text-success-foreground/70"
                  onClick={handleComplete}
                  disabled={!sale || completeMutation.isLoading || isLineBusy || !sale.lines.length}
                >
                  <span className="flex items-center gap-2">
                    {completeMutation.isLoading ? <Spinner className="h-5 w-5" /> : null}
                    {sellInDebt ? t("sell.completeDebtSale") : t("sell.completeSale")}
                  </span>
                  <span>{sale ? formatSaleMoney(sale.totalKgs) : formatSaleMoney(0)}</span>
                </Button>
              </div>
            </div>
          </aside>
        </main>
      )}
    </div>
  );
};

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export default PosSellPage;

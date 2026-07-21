"use client";

import { useEffect, useMemo, useState } from "react";
import { CustomerOrderStatus, PosPaymentMethod } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { CloseIcon, DownloadIcon, PrintIcon, ShareIcon, ViewIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import {
  currencySourceWithFallback,
  formatKgsMoney,
  type CurrencySource,
} from "@/lib/currencyDisplay";
import { formatDateTime } from "@/lib/i18nFormat";
import { mergeMobilePosReceiptHistory } from "@/lib/mobilePosState";
import { downloadPdfBlob, fetchPdfBlob, printPdfBlob } from "@/lib/pdfClient";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { usePosRegisterSelection } from "@/lib/usePosRegisterSelection";

const formatDateInput = (value: Date) => value.toISOString().slice(0, 10);

const createIdempotencyKey = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `pos-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const PosHistoryPage = () => {
  const t = useTranslations("pos");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const trpcUtils = trpc.useUtils();
  const { data: session } = useSession();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<CustomerOrderStatus | "ALL">(
    CustomerOrderStatus.COMPLETED,
  );
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<PosPaymentMethod | "ALL">("ALL");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [isPhoneScreen, setIsPhoneScreen] = useState<boolean | null>(null);
  const [resumeConflictOpen, setResumeConflictOpen] = useState(false);
  const [detailSaleId, setDetailSaleId] = useState<string | null>(null);
  const [returnSaleId, setReturnSaleId] = useState<string | null>(null);
  const [returnQtyByLine, setReturnQtyByLine] = useState<Record<string, string>>({});
  const [refundMethod, setRefundMethod] = useState<PosPaymentMethod>(PosPaymentMethod.CASH);
  const [receiptAction, setReceiptAction] = useState<{
    saleId: string;
    mode: "download" | "print" | "share";
    kind: "precheck" | "fiscal";
  } | null>(null);

  const registersQuery = trpc.pos.registers.list.useQuery({ status: "all" });
  const {
    registerId,
    selectRegister,
    issue: registerSelectionIssue,
  } = usePosRegisterSelection({
    registers: registersQuery.data ?? [],
    registersReady: registersQuery.data !== undefined,
  });
  const selectedRegister = (registersQuery.data ?? []).find((item) => item.id === registerId);
  const registerExists = (registersQuery.data ?? []).some((item) => item.id === registerId);
  const canLoadRegisterScopedData = Boolean(registerId) && registerExists;
  const canLoadCurrentShift = canLoadRegisterScopedData && Boolean(selectedRegister?.isActive);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      setIsPhoneScreen(false);
      return;
    }
    const phoneQuery = window.matchMedia("(max-width: 767px)");
    const updatePhoneScreen = () => setIsPhoneScreen(phoneQuery.matches);
    updatePhoneScreen();
    phoneQuery.addEventListener("change", updatePhoneScreen);
    return () => phoneQuery.removeEventListener("change", updatePhoneScreen);
  }, []);

  useEffect(() => {
    if (!registerSelectionIssue) {
      return;
    }
    toast({ description: t("entry.registerUnavailable") });
  }, [registerSelectionIssue, t, toast]);

  const currentShiftQuery = trpc.pos.shifts.current.useQuery(
    { registerId },
    { enabled: canLoadCurrentShift, refetchOnWindowFocus: true },
  );

  const salesQuery = trpc.pos.sales.list.useQuery(
    {
      registerId: registerId || undefined,
      statuses: statusFilter === "ALL" ? undefined : [statusFilter],
      search: search.trim() || undefined,
      dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00`) : undefined,
      dateTo: dateTo ? new Date(`${dateTo}T23:59:59`) : undefined,
      page: 1,
      pageSize: 30,
    },
    { enabled: canLoadRegisterScopedData, refetchOnWindowFocus: true },
  );

  const heldSalesQuery = trpc.pos.sales.list.useQuery(
    {
      registerId: registerId || undefined,
      statuses: [CustomerOrderStatus.DRAFT],
      heldState: "held",
      search: search.trim() || undefined,
      dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00`) : undefined,
      dateTo: dateTo ? new Date(`${dateTo}T23:59:59`) : undefined,
      page: 1,
      pageSize: 30,
    },
    {
      enabled:
        isPhoneScreen === true &&
        canLoadRegisterScopedData &&
        statusFilter === CustomerOrderStatus.COMPLETED,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
    },
  );

  const saleDetailQuery = trpc.pos.sales.get.useQuery(
    { saleId: returnSaleId ?? "" },
    { enabled: Boolean(returnSaleId), refetchOnWindowFocus: true },
  );

  const mobileSaleDetailQuery = trpc.pos.sales.get.useQuery(
    { saleId: detailSaleId ?? "" },
    { enabled: Boolean(detailSaleId), refetchOnWindowFocus: true },
  );

  const returnsQuery = trpc.pos.returns.list.useQuery(
    {
      shiftId: currentShiftQuery.data?.id ?? undefined,
      registerId: registerId || undefined,
      page: 1,
      pageSize: 20,
    },
    { enabled: canLoadRegisterScopedData, refetchOnWindowFocus: true },
  );

  const createReturnMutation = trpc.pos.returns.createDraft.useMutation();
  const addReturnLineMutation = trpc.pos.returns.addLine.useMutation();
  const completeReturnMutation = trpc.pos.returns.complete.useMutation();
  const retryKkmMutation = trpc.pos.sales.retryKkm.useMutation({
    onSuccess: async (result) => {
      if (result.kkmStatus === "SENT") {
        toast({ variant: "success", description: t("history.kkmRetrySuccess") });
      } else {
        toast({
          variant: "error",
          description: result.errorMessage
            ? t("history.kkmRetryFailedWithReason", { reason: result.errorMessage })
            : t("history.kkmRetryFailed"),
        });
      }
      await Promise.all([salesQuery.refetch(), saleDetailQuery.refetch()]);
    },
    onError: (error) => {
      if (error.message === "posActiveDraftExists") {
        setResumeConflictOpen(true);
        return;
      }
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const resumeHeldDraftMutation = trpc.pos.sales.resumeHeldDraft.useMutation({
    onSuccess: async (result) => {
      setDetailSaleId(null);
      await Promise.all([
        trpcUtils.pos.sales.list.invalidate(),
        trpcUtils.pos.sales.activeDraft.invalidate({ registerId }),
        trpcUtils.pos.sales.get.invalidate({ saleId: result.id }),
      ]);
      toast({
        variant: "success",
        description: t("sell.resumeHeldReceiptSuccess", { number: result.number }),
      });
      router.push(`/pos/sell?registerId=${encodeURIComponent(registerId)}`);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const selectedSale = saleDetailQuery.data;
  const detailSale = mobileSaleDetailQuery.data;
  const selectedSaleCurrencySource = currencySourceWithFallback(
    selectedSale,
    selectedSale?.store ?? selectedRegister?.store ?? null,
  );
  const detailSaleCurrencySource = currencySourceWithFallback(
    detailSale,
    detailSale?.store ?? selectedRegister?.store ?? null,
  );
  const selectedSaleIdForReturn = saleDetailQuery.data?.id;
  const selectedSaleLinesForReturn = saleDetailQuery.data?.lines;
  const isReturnMutationBusy =
    createReturnMutation.isLoading ||
    addReturnLineMutation.isLoading ||
    completeReturnMutation.isLoading;
  const canRetryKkm = session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";

  const paymentMethodLabel = (method: PosPaymentMethod) => {
    switch (method) {
      case PosPaymentMethod.CARD:
        return t("payments.card");
      case PosPaymentMethod.TRANSFER:
        return t("payments.transfer");
      case PosPaymentMethod.OTHER:
        return t("payments.other");
      default:
        return t("payments.cash");
    }
  };

  const statusLabel = (status: CustomerOrderStatus) => {
    switch (status) {
      case CustomerOrderStatus.COMPLETED:
        return t("history.statusCompleted");
      case CustomerOrderStatus.CANCELED:
        return t("history.statusCanceled");
      default:
        return t("history.statusDraft");
    }
  };

  const statusBadgeVariant = (
    status: CustomerOrderStatus,
  ): "default" | "success" | "warning" | "danger" => {
    switch (status) {
      case CustomerOrderStatus.COMPLETED:
        return "success";
      case CustomerOrderStatus.CANCELED:
        return "danger";
      default:
        return "warning";
    }
  };

  const salePaymentSummary = (
    sale: { payments?: Array<{ method: PosPaymentMethod; amountKgs: number }> },
    currencySource: CurrencySource,
  ) => {
    const parts = (sale.payments ?? [])
      .filter((payment) => payment.amountKgs > 0)
      .map(
        (payment) =>
          `${paymentMethodLabel(payment.method)} ${formatKgsMoney(
            payment.amountKgs,
            locale,
            currencySource,
          )}`,
      );
    return parts.join(" · ") || tCommon("notAvailable");
  };

  const mobileHistorySales = useMemo(
    () =>
      isPhoneScreen === true && statusFilter === CustomerOrderStatus.COMPLETED
        ? mergeMobilePosReceiptHistory(
            salesQuery.data?.items ?? [],
            heldSalesQuery.data?.items ?? [],
          )
        : (salesQuery.data?.items ?? []),
    [heldSalesQuery.data?.items, isPhoneScreen, salesQuery.data?.items, statusFilter],
  );

  const visibleSales = useMemo(
    () =>
      mobileHistorySales.filter(
        (sale) =>
          paymentMethodFilter === "ALL" ||
          (sale.payments ?? []).some((payment) => payment.method === paymentMethodFilter),
      ),
    [mobileHistorySales, paymentMethodFilter],
  );
  const mobileHistoryLoading =
    salesQuery.isLoading ||
    (isPhoneScreen === true &&
      statusFilter === CustomerOrderStatus.COMPLETED &&
      heldSalesQuery.isLoading);

  const handleResumeHeldReceipt = (saleId: string) => {
    if (!registerId || resumeHeldDraftMutation.isLoading) {
      return;
    }
    resumeHeldDraftMutation.mutate({ saleId, registerId });
  };

  const setTodayFilter = () => {
    const today = formatDateInput(new Date());
    setDateFrom(today);
    setDateTo(today);
  };

  const clearMobileFilters = () => {
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setStatusFilter(CustomerOrderStatus.COMPLETED);
    setPaymentMethodFilter("ALL");
  };

  const activeMobileFilterCount = [
    search.trim(),
    dateFrom || dateTo,
    statusFilter !== CustomerOrderStatus.COMPLETED ? String(statusFilter) : "",
    paymentMethodFilter !== "ALL" ? String(paymentMethodFilter) : "",
  ].filter(Boolean).length;

  const kkmStatusLabel = (status: "NOT_SENT" | "SENT" | "FAILED") => {
    switch (status) {
      case "SENT":
        return t("history.kkmStatusSent");
      case "FAILED":
        return t("history.kkmStatusFailed");
      default:
        return t("history.kkmStatusNotSent");
    }
  };

  const kkmStatusClassName = (status: "NOT_SENT" | "SENT" | "FAILED") => {
    if (status === "SENT") {
      return "border border-success/20 bg-success/10 text-success";
    }
    if (status === "FAILED") {
      return "border border-danger/20 bg-danger/10 text-danger";
    }
    return "border border-warning/25 bg-warning/10 text-warning";
  };

  const alreadyReturnedByLine = useMemo(() => {
    const map: Record<string, number> = {};
    for (const saleReturn of selectedSale?.saleReturns ?? []) {
      if (saleReturn.status !== "COMPLETED") {
        continue;
      }
      for (const line of saleReturn.lines) {
        map[line.customerOrderLineId] = (map[line.customerOrderLineId] ?? 0) + line.qty;
      }
    }
    return map;
  }, [selectedSale?.saleReturns]);

  useEffect(() => {
    if (!selectedSaleIdForReturn || !selectedSaleLinesForReturn) {
      setReturnQtyByLine({});
      return;
    }
    setReturnQtyByLine(
      Object.fromEntries(selectedSaleLinesForReturn.map((line) => [line.id, "0"])),
    );
  }, [selectedSaleIdForReturn, selectedSaleLinesForReturn]);

  const returnTotal = useMemo(() => {
    if (!selectedSale) {
      return 0;
    }
    return selectedSale.lines.reduce((total, line) => {
      const availableQty = Math.max(0, line.qty - (alreadyReturnedByLine[line.id] ?? 0));
      const qty = Math.trunc(Number(returnQtyByLine[line.id] ?? 0));
      if (!Number.isFinite(qty) || qty <= 0 || availableQty <= 0) {
        return total;
      }
      return total + line.unitPriceKgs * Math.min(qty, availableQty);
    }, 0);
  }, [alreadyReturnedByLine, selectedSale, returnQtyByLine]);

  const handleStartReturn = async () => {
    const shift = currentShiftQuery.data;
    const sale = selectedSale;
    if (!shift || !sale) {
      toast({ variant: "error", description: t("history.openShiftRequired") });
      return;
    }

    const selectedLines = sale.lines
      .map((line) => ({
        lineId: line.id,
        maxQty: Math.max(0, line.qty - (alreadyReturnedByLine[line.id] ?? 0)),
        qty: Math.trunc(Number(returnQtyByLine[line.id] ?? 0)),
      }))
      .filter((line) => Number.isFinite(line.qty) && line.qty > 0 && line.maxQty > 0)
      .map((line) => ({
        lineId: line.lineId,
        qty: Math.min(line.qty, line.maxQty),
      }));

    if (!selectedLines.length || returnTotal <= 0) {
      toast({ variant: "error", description: t("history.returnQtyRequired") });
      return;
    }

    try {
      const draft = await createReturnMutation.mutateAsync({
        shiftId: shift.id,
        originalSaleId: sale.id,
        notes: null,
      });

      for (const selected of selectedLines) {
        await addReturnLineMutation.mutateAsync({
          saleReturnId: draft.id,
          customerOrderLineId: selected.lineId,
          qty: selected.qty,
        });
      }

      const completion = await completeReturnMutation.mutateAsync({
        saleReturnId: draft.id,
        idempotencyKey: createIdempotencyKey(),
        payments: [
          {
            method: refundMethod,
            amountKgs: Math.round(returnTotal * 100) / 100,
          },
        ],
      });

      if (completion.manualRequired) {
        toast({
          variant: "info",
          description: t("history.manualRefundRequired", {
            requestId: completion.refundRequestId ?? "-",
          }),
        });
      } else {
        toast({ variant: "success", description: t("history.returnSuccess") });
      }
      setReturnSaleId(null);
      await Promise.all([salesQuery.refetch(), returnsQuery.refetch()]);
    } catch (error) {
      toast({ variant: "error", description: translateError(tErrors, error as never) });
    }
  };

  const handleReceiptPdf = async (
    saleId: string,
    mode: "download" | "print",
    kind: "precheck" | "fiscal",
  ) => {
    if (receiptAction) {
      return;
    }
    setReceiptAction({ saleId, mode, kind });
    try {
      const blob = await fetchPdfBlob({
        url: `/api/pos/receipts/${saleId}/pdf?kind=${kind}&action=${mode === "print" ? "reprint" : "download"}`,
      });
      if (mode === "print") {
        const result = await printPdfBlob(blob);
        if (!result.autoPrintAttempted) {
          toast({ variant: "info", description: t("sell.receiptPrintFallback") });
        }
      } else {
        downloadPdfBlob(blob, `pos-receipt-${saleId}-${kind}.pdf`);
      }
    } catch {
      toast({ variant: "error", description: t("history.receiptPdfFailed") });
    } finally {
      setReceiptAction(null);
    }
  };

  const handleShareReceiptPdf = async (
    saleId: string,
    number: string,
    kind: "precheck" | "fiscal",
  ) => {
    if (receiptAction) {
      return;
    }
    setReceiptAction({ saleId, mode: "share", kind });
    try {
      const blob = await fetchPdfBlob({
        url: `/api/pos/receipts/${saleId}/pdf?kind=${kind}&action=download`,
      });
      const file = new File([blob], `pos-receipt-${number}-${kind}.pdf`, {
        type: "application/pdf",
      });
      const shareNavigator = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
      };
      if (
        typeof shareNavigator.share === "function" &&
        (!shareNavigator.canShare || shareNavigator.canShare({ files: [file] }))
      ) {
        await shareNavigator.share({
          title: t("history.shareReceiptTitle", { number }),
          text: t("history.shareReceiptText", { number }),
          files: [file],
        });
      } else {
        downloadPdfBlob(blob, `pos-receipt-${number}-${kind}.pdf`);
        toast({ variant: "info", description: t("history.shareUnavailable") });
      }
    } catch {
      toast({ variant: "error", description: t("history.receiptPdfFailed") });
    } finally {
      setReceiptAction(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="hidden md:block">
        <PageHeader title={t("history.title")} subtitle={t("history.subtitle")} />
      </div>

      <div className="space-y-4 md:hidden">
        <section className="space-y-1">
          <h1 className="text-xl font-semibold text-foreground">{t("history.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("history.subtitle")}</p>
        </section>

        <section className="space-y-3 border border-border bg-card p-3 shadow-sm">
          <Select value={registerId} onValueChange={selectRegister}>
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

          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("history.search")}
            className="h-11"
          />

          <div className="scrollbar-none flex gap-2 overflow-x-auto pb-1">
            <Button
              type="button"
              size="sm"
              variant={dateFrom && dateFrom === dateTo ? "default" : "secondary"}
              className="h-10 shrink-0"
              onClick={setTodayFilter}
            >
              {t("history.today")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={paymentMethodFilter === "ALL" ? "secondary" : "default"}
              className="h-10 shrink-0"
              onClick={() => setMobileFiltersOpen(true)}
            >
              {t("history.filtersButton", { count: activeMobileFilterCount })}
            </Button>
            {activeMobileFilterCount ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-10 shrink-0"
                onClick={clearMobileFilters}
              >
                {t("history.clearFilters")}
              </Button>
            ) : null}
          </div>
        </section>

        <section className="space-y-3">
          {!canLoadRegisterScopedData ? (
            <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
              {(registersQuery.data ?? []).length
                ? t("entry.selectRegisterFirst")
                : t("entry.noRegisters")}
            </div>
          ) : null}

          {canLoadRegisterScopedData && mobileHistoryLoading ? (
            <div className="flex min-h-24 items-center justify-center gap-2 border border-border bg-card text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : null}

          {!mobileHistoryLoading
            ? visibleSales.map((sale) => {
                const saleCurrencySource = currencySourceWithFallback(sale, sale.store);
                const paymentSummary = salePaymentSummary(sale, saleCurrencySource);
                const isHeldReceipt = sale.status === CustomerOrderStatus.DRAFT && sale.isHeld;
                const canReturn =
                  sale.status === CustomerOrderStatus.COMPLETED &&
                  !(
                    (sale.returnedTotalKgs ?? 0) > 0 &&
                    sale.returnedTotalKgs >= sale.totalKgs - 0.009
                  );

                return (
                  <article
                    key={sale.id}
                    className="rounded-md border border-border bg-card p-3 shadow-sm"
                  >
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() =>
                        isHeldReceipt ? handleResumeHeldReceipt(sale.id) : setDetailSaleId(sale.id)
                      }
                      disabled={isHeldReceipt && resumeHeldDraftMutation.isLoading}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-base font-semibold text-foreground">
                            {sale.number}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatDateTime(sale.createdAt, locale)}
                          </p>
                        </div>
                        <p className="shrink-0 text-base font-semibold text-foreground">
                          {formatKgsMoney(sale.totalKgs, locale, saleCurrencySource)}
                        </p>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <p className="text-muted-foreground">{t("history.customer")}</p>
                          <p className="truncate font-medium text-foreground">
                            {sale.customerName ?? t("history.walkInCustomer")}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{t("history.paymentMethod")}</p>
                          <p className="truncate font-medium text-foreground">{paymentSummary}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{t("history.store")}</p>
                          <p className="truncate font-medium text-foreground">{sale.store.name}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{t("history.register")}</p>
                          <p className="truncate font-medium text-foreground">
                            {sale.register?.name ?? tCommon("notAvailable")}
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Badge variant={statusBadgeVariant(sale.status)}>
                          {isHeldReceipt ? t("sell.heldReceipt") : statusLabel(sale.status)}
                        </Badge>
                        {!isHeldReceipt ? (
                          <span
                            className={`inline-flex items-center px-2.5 py-1 text-xs font-semibold ${kkmStatusClassName(
                              sale.kkmStatus,
                            )}`}
                          >
                            {kkmStatusLabel(sale.kkmStatus)}
                          </span>
                        ) : null}
                      </div>
                    </button>

                    {isHeldReceipt ? (
                      <Button
                        type="button"
                        className="mt-3 h-11 w-full"
                        onClick={() => handleResumeHeldReceipt(sale.id)}
                        disabled={resumeHeldDraftMutation.isLoading}
                      >
                        {resumeHeldDraftMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                        {t("sell.resumeHeldReceipt")}
                      </Button>
                    ) : (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          className="h-10"
                          onClick={() => setDetailSaleId(sale.id)}
                        >
                          <ViewIcon className="h-4 w-4" aria-hidden />
                          {t("history.openDetails")}
                        </Button>
                        <Button
                          type="button"
                          className="h-10"
                          onClick={() => {
                            void handleReceiptPdf(sale.id, "print", "precheck");
                          }}
                          disabled={Boolean(receiptAction)}
                        >
                          {receiptAction?.saleId === sale.id &&
                          receiptAction.mode === "print" &&
                          receiptAction.kind === "precheck" ? (
                            <Spinner className="h-4 w-4" />
                          ) : (
                            <PrintIcon className="h-4 w-4" aria-hidden />
                          )}
                          {t("history.printReceipt")}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          className="col-span-2 h-10"
                          onClick={() => setReturnSaleId(sale.id)}
                          disabled={!canReturn}
                        >
                          {t("history.return")}
                        </Button>
                      </div>
                    )}
                  </article>
                );
              })
            : null}

          {canLoadRegisterScopedData && !mobileHistoryLoading && !visibleSales.length ? (
            <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
              {t("history.empty")}
            </div>
          ) : null}
        </section>
      </div>

      <div className="hidden space-y-6 md:block">
        <Card>
          <CardHeader>
            <CardTitle>{t("entry.register")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Select value={registerId} onValueChange={selectRegister}>
              <SelectTrigger aria-label={t("entry.register")}>
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
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("history.search")}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("history.salesTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!canLoadRegisterScopedData ? (
              <p className="text-sm text-muted-foreground">
                {(registersQuery.data ?? []).length
                  ? t("entry.selectRegisterFirst")
                  : t("entry.noRegisters")}
              </p>
            ) : null}

            {canLoadRegisterScopedData && salesQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="h-4 w-4" />
                {tCommon("loading")}
              </div>
            ) : null}

            {(salesQuery.data?.items ?? []).map((sale) => (
              <div
                key={sale.id}
                className="flex flex-col gap-3 rounded-md border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-semibold text-foreground">{sale.number}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(sale.createdAt, locale)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {sale.customerName ?? t("history.walkInCustomer")}
                  </p>
                  {sale.returnedTotalKgs > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {t("history.returnedTotal")}:{" "}
                      {formatKgsMoney(
                        sale.returnedTotalKgs,
                        locale,
                        currencySourceWithFallback(sale, sale.store),
                      )}
                    </p>
                  ) : null}
                  {sale.kkmStatus !== "NOT_SENT" ? (
                    <div className="mt-1">
                      <span
                        className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold ${kkmStatusClassName(
                          sale.kkmStatus,
                        )}`}
                      >
                        {t("history.kkmStatusLabel")}: {kkmStatusLabel(sale.kkmStatus)}
                      </span>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <p className="text-sm font-semibold text-foreground">
                    {formatKgsMoney(
                      sale.totalKgs,
                      locale,
                      currencySourceWithFallback(sale, sale.store),
                    )}
                  </p>
                  <Button
                    variant="secondary"
                    onClick={() => setReturnSaleId(sale.id)}
                    disabled={
                      sale.status !== "COMPLETED" ||
                      ((sale.returnedTotalKgs ?? 0) > 0 &&
                        sale.returnedTotalKgs >= sale.totalKgs - 0.009)
                    }
                  >
                    {t("history.return")}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      void handleReceiptPdf(sale.id, "download", "precheck");
                    }}
                    disabled={Boolean(receiptAction)}
                  >
                    {receiptAction?.saleId === sale.id &&
                    receiptAction.mode === "download" &&
                    receiptAction.kind === "precheck" ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      <DownloadIcon className="h-4 w-4" aria-hidden />
                    )}
                    {t("history.downloadPrecheck")}
                  </Button>
                  <Button
                    onClick={() => {
                      void handleReceiptPdf(sale.id, "print", "precheck");
                    }}
                    disabled={Boolean(receiptAction)}
                  >
                    {receiptAction?.saleId === sale.id &&
                    receiptAction.mode === "print" &&
                    receiptAction.kind === "precheck" ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      <PrintIcon className="h-4 w-4" aria-hidden />
                    )}
                    {t("history.printPrecheck")}
                  </Button>
                  {sale.kkmStatus === "SENT" ? (
                    <>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          void handleReceiptPdf(sale.id, "download", "fiscal");
                        }}
                        disabled={Boolean(receiptAction)}
                      >
                        {receiptAction?.saleId === sale.id &&
                        receiptAction.mode === "download" &&
                        receiptAction.kind === "fiscal" ? (
                          <Spinner className="h-4 w-4" />
                        ) : (
                          <DownloadIcon className="h-4 w-4" aria-hidden />
                        )}
                        {t("history.downloadFiscalReceipt")}
                      </Button>
                      <Button
                        onClick={() => {
                          void handleReceiptPdf(sale.id, "print", "fiscal");
                        }}
                        disabled={Boolean(receiptAction)}
                      >
                        {receiptAction?.saleId === sale.id &&
                        receiptAction.mode === "print" &&
                        receiptAction.kind === "fiscal" ? (
                          <Spinner className="h-4 w-4" />
                        ) : (
                          <PrintIcon className="h-4 w-4" aria-hidden />
                        )}
                        {t("history.printFiscalReceipt")}
                      </Button>
                    </>
                  ) : null}
                  {canRetryKkm && sale.kkmStatus === "FAILED" ? (
                    <Button
                      variant="secondary"
                      onClick={() => retryKkmMutation.mutate({ saleId: sale.id })}
                      disabled={retryKkmMutation.isLoading}
                    >
                      {retryKkmMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                      {t("history.retryKkm")}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}

            {canLoadRegisterScopedData &&
            !salesQuery.isLoading &&
            !(salesQuery.data?.items ?? []).length ? (
              <p className="text-sm text-muted-foreground">{t("history.empty")}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("history.returnsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!canLoadRegisterScopedData ? (
              <p className="text-sm text-muted-foreground">
                {(registersQuery.data ?? []).length
                  ? t("entry.selectRegisterFirst")
                  : t("entry.noRegisters")}
              </p>
            ) : null}

            {(returnsQuery.data?.items ?? []).map((item) => (
              <div key={item.id} className="rounded-md border border-border bg-card p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-foreground">{item.number}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.originalSale.number} ·{" "}
                      {formatKgsMoney(
                        item.totalKgs,
                        locale,
                        currencySourceWithFallback(item, item.store),
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.completedAt
                        ? formatDateTime(item.completedAt, locale)
                        : formatDateTime(item.createdAt, locale)}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold ${
                      item.status === "COMPLETED"
                        ? "border border-success/20 bg-success/10 text-success"
                        : item.status === "CANCELED"
                          ? "border border-danger/20 bg-danger/10 text-danger"
                          : "border border-warning/25 bg-warning/10 text-warning"
                    }`}
                  >
                    {item.status === "COMPLETED"
                      ? t("history.statusCompleted")
                      : item.status === "CANCELED"
                        ? t("history.statusCanceled")
                        : t("history.statusDraft")}
                  </span>
                </div>
              </div>
            ))}
            {canLoadRegisterScopedData && returnsQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="h-4 w-4" />
                {tCommon("loading")}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {mobileFiltersOpen ? (
        <div className="fixed inset-0 z-[70] md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/35"
            onClick={() => setMobileFiltersOpen(false)}
            aria-label={tCommon("close")}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-label={t("history.mobileFiltersTitle")}
            className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto border-t border-border bg-background p-4 shadow-2xl"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  {t("history.mobileFiltersTitle")}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("history.subtitle")}</p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="h-11 w-11 shrink-0"
                onClick={() => setMobileFiltersOpen(false)}
                aria-label={tCommon("close")}
              >
                <CloseIcon className="h-4 w-4" aria-hidden />
              </Button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1.5">
                  <span className="text-sm font-medium text-foreground">
                    {t("history.dateFrom")}
                  </span>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(event) => setDateFrom(event.target.value)}
                    className="h-11"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-sm font-medium text-foreground">{t("history.dateTo")}</span>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(event) => setDateTo(event.target.value)}
                    className="h-11"
                  />
                </label>
              </div>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-foreground">
                  {t("history.saleStatus")}
                </span>
                <Select
                  value={statusFilter}
                  onValueChange={(value) => setStatusFilter(value as CustomerOrderStatus | "ALL")}
                >
                  <SelectTrigger className="h-11" aria-label={t("history.saleStatus")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">{t("history.statusAll")}</SelectItem>
                    <SelectItem value={CustomerOrderStatus.COMPLETED}>
                      {t("history.statusCompleted")}
                    </SelectItem>
                    <SelectItem value={CustomerOrderStatus.CANCELED}>
                      {t("history.statusCanceled")}
                    </SelectItem>
                    <SelectItem value={CustomerOrderStatus.DRAFT}>
                      {t("history.statusDraft")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-foreground">
                  {t("history.paymentMethod")}
                </span>
                <Select
                  value={paymentMethodFilter}
                  onValueChange={(value) =>
                    setPaymentMethodFilter(value as PosPaymentMethod | "ALL")
                  }
                >
                  <SelectTrigger className="h-11" aria-label={t("history.paymentMethod")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">{t("history.paymentMethodAll")}</SelectItem>
                    <SelectItem value={PosPaymentMethod.CASH}>{t("payments.cash")}</SelectItem>
                    <SelectItem value={PosPaymentMethod.CARD}>{t("payments.card")}</SelectItem>
                    <SelectItem value={PosPaymentMethod.TRANSFER}>
                      {t("payments.transfer")}
                    </SelectItem>
                    <SelectItem value={PosPaymentMethod.OTHER}>{t("payments.other")}</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="secondary"
                className="h-11"
                onClick={clearMobileFilters}
              >
                {t("history.clearFilters")}
              </Button>
              <Button type="button" className="h-11" onClick={() => setMobileFiltersOpen(false)}>
                {t("history.applyFilters")}
              </Button>
            </div>
          </section>
        </div>
      ) : null}

      <Modal
        open={resumeConflictOpen}
        onOpenChange={setResumeConflictOpen}
        title={t("sell.draftDetectedTitle")}
        subtitle={tErrors("posActiveDraftExists")}
        mobileSheet
      >
        <ModalFooter>
          <Button type="button" variant="secondary" onClick={() => setResumeConflictOpen(false)}>
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => {
              setResumeConflictOpen(false);
              router.push(`/pos/sell?registerId=${encodeURIComponent(registerId)}`);
            }}
          >
            {t("sell.resumeDraft")}
          </Button>
        </ModalFooter>
      </Modal>

      {detailSaleId ? (
        <div className="fixed inset-0 z-[65] md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/35"
            onClick={() => setDetailSaleId(null)}
            aria-label={tCommon("close")}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-label={t("history.detailsTitle")}
            className="absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col overflow-hidden border-t border-border bg-background shadow-2xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border p-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("history.detailsTitle")}
                </p>
                <h2 className="mt-1 truncate text-xl font-semibold text-foreground">
                  {detailSale?.number ?? tCommon("loading")}
                </h2>
                {detailSale ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant={statusBadgeVariant(detailSale.status)}>
                      {statusLabel(detailSale.status)}
                    </Badge>
                    <span
                      className={`inline-flex items-center px-2.5 py-1 text-xs font-semibold ${kkmStatusClassName(
                        detailSale.kkmStatus,
                      )}`}
                    >
                      {kkmStatusLabel(detailSale.kkmStatus)}
                    </span>
                  </div>
                ) : null}
              </div>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="h-11 w-11 shrink-0"
                onClick={() => setDetailSaleId(null)}
                aria-label={tCommon("close")}
              >
                <CloseIcon className="h-4 w-4" aria-hidden />
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {mobileSaleDetailQuery.isLoading ? (
                <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Spinner className="h-4 w-4" />
                  {tCommon("loading")}
                </div>
              ) : null}

              {mobileSaleDetailQuery.error ? (
                <p className="text-sm text-danger">
                  {translateError(tErrors, mobileSaleDetailQuery.error)}
                </p>
              ) : null}

              {detailSale ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 border border-border bg-card p-3 text-xs">
                    <div>
                      <p className="text-muted-foreground">{t("history.customer")}</p>
                      <p className="font-medium text-foreground">
                        {detailSale.customerName ?? t("history.walkInCustomer")}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t("history.store")}</p>
                      <p className="font-medium text-foreground">{detailSale.store.name}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t("history.register")}</p>
                      <p className="font-medium text-foreground">
                        {detailSale.register?.name ?? tCommon("notAvailable")}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t("history.dateTime")}</p>
                      <p className="font-medium text-foreground">
                        {formatDateTime(detailSale.createdAt, locale)}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-foreground">
                      {t("history.itemsTitle")}
                    </h3>
                    {detailSale.lines.map((line) => (
                      <div key={line.id} className="rounded-md border border-border bg-card p-3">
                        <div className="flex gap-3">
                          <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden border border-border bg-muted/30">
                            {line.product.primaryImage ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={line.product.primaryImage}
                                alt={line.product.name}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <span className="text-xs font-semibold text-muted-foreground">
                                {line.product.name.trim().charAt(0).toUpperCase() || "#"}
                              </span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-sm font-medium text-foreground">
                              {line.product.name}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {line.variant?.name ?? line.product.sku}
                            </p>
                            <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                              <span className="text-muted-foreground">
                                {line.qty} ×{" "}
                                {formatKgsMoney(
                                  line.unitPriceKgs,
                                  locale,
                                  detailSaleCurrencySource,
                                )}
                              </span>
                              <span className="font-semibold text-foreground">
                                {formatKgsMoney(
                                  line.lineTotalKgs,
                                  locale,
                                  detailSaleCurrencySource,
                                )}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2 border border-border bg-card p-3">
                    <h3 className="text-sm font-semibold text-foreground">
                      {t("history.totalsTitle")}
                    </h3>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t("sell.subtotal")}</span>
                      <span className="font-medium text-foreground">
                        {formatKgsMoney(detailSale.subtotalKgs, locale, detailSaleCurrencySource)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t("sell.discount")}</span>
                      <span className="font-medium text-foreground">
                        {formatKgsMoney(detailSale.discountKgs, locale, detailSaleCurrencySource)}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
                      <span>{t("sell.orderTotal")}</span>
                      <span>
                        {formatKgsMoney(detailSale.totalKgs, locale, detailSaleCurrencySource)}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2 border border-border bg-card p-3">
                    <h3 className="text-sm font-semibold text-foreground">
                      {t("history.paymentsTitle")}
                    </h3>
                    {detailSale.payments.length ? (
                      detailSale.payments.map((payment) => (
                        <div key={payment.id} className="flex justify-between gap-3 text-sm">
                          <span className="text-muted-foreground">
                            {paymentMethodLabel(payment.method)}
                          </span>
                          <span className="font-medium text-foreground">
                            {formatKgsMoney(payment.amountKgs, locale, detailSaleCurrencySource)}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">{tCommon("notAvailable")}</p>
                    )}
                  </div>

                  <div className="space-y-2 border border-border bg-card p-3">
                    <h3 className="text-sm font-semibold text-foreground">
                      {t("history.receiptActions")}
                    </h3>
                    <div className="grid gap-2">
                      <Button
                        type="button"
                        className="h-11 justify-start"
                        onClick={() => {
                          void handleReceiptPdf(detailSale.id, "print", "precheck");
                        }}
                        disabled={Boolean(receiptAction)}
                      >
                        {receiptAction?.saleId === detailSale.id &&
                        receiptAction.mode === "print" &&
                        receiptAction.kind === "precheck" ? (
                          <Spinner className="h-4 w-4" />
                        ) : (
                          <PrintIcon className="h-4 w-4" aria-hidden />
                        )}
                        {t("history.printReceipt")}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-11 justify-start"
                        onClick={() => {
                          void handleReceiptPdf(detailSale.id, "download", "precheck");
                        }}
                        disabled={Boolean(receiptAction)}
                      >
                        {receiptAction?.saleId === detailSale.id &&
                        receiptAction.mode === "download" &&
                        receiptAction.kind === "precheck" ? (
                          <Spinner className="h-4 w-4" />
                        ) : (
                          <ShareIcon className="h-4 w-4" aria-hidden />
                        )}
                        {t("history.downloadReceipt")}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-11 justify-start"
                        onClick={() => {
                          void handleShareReceiptPdf(detailSale.id, detailSale.number, "precheck");
                        }}
                        disabled={Boolean(receiptAction)}
                      >
                        {receiptAction?.saleId === detailSale.id &&
                        receiptAction.mode === "share" &&
                        receiptAction.kind === "precheck" ? (
                          <Spinner className="h-4 w-4" />
                        ) : (
                          <DownloadIcon className="h-4 w-4" aria-hidden />
                        )}
                        {t("history.shareReceipt")}
                      </Button>
                      {detailSale.kkmStatus === "SENT" ? (
                        <>
                          <Button
                            type="button"
                            variant="secondary"
                            className="h-11 justify-start"
                            onClick={() => {
                              void handleReceiptPdf(detailSale.id, "download", "fiscal");
                            }}
                            disabled={Boolean(receiptAction)}
                          >
                            <DownloadIcon className="h-4 w-4" aria-hidden />
                            {t("history.downloadFiscalReceipt")}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            className="h-11 justify-start"
                            onClick={() => {
                              void handleReceiptPdf(detailSale.id, "print", "fiscal");
                            }}
                            disabled={Boolean(receiptAction)}
                          >
                            <PrintIcon className="h-4 w-4" aria-hidden />
                            {t("history.printFiscalReceipt")}
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      <Modal
        open={Boolean(returnSaleId)}
        onOpenChange={(open) => {
          if (!open) {
            setReturnSaleId(null);
          }
        }}
        title={t("history.returnDialogTitle")}
        subtitle={
          selectedSale ? t("history.returnDialogDescription", { number: selectedSale.number }) : ""
        }
      >
        <div className="space-y-4">
          {(selectedSale?.lines ?? []).map((line) => (
            <div key={line.id} className="rounded-md border border-border bg-card p-3">
              <p className="text-sm font-medium text-foreground">{line.product.name}</p>
              <p className="text-xs text-muted-foreground">
                {line.qty} × {formatKgsMoney(line.unitPriceKgs, locale, selectedSaleCurrencySource)}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("history.availableQty")}:{" "}
                {Math.max(0, line.qty - (alreadyReturnedByLine[line.id] ?? 0))}
              </p>
              <Input
                value={returnQtyByLine[line.id] ?? "0"}
                onChange={(event) => {
                  const raw = event.target.value.replace(/[^\d]/g, "");
                  const parsed = raw ? Math.trunc(Number(raw)) : 0;
                  const maxQty = Math.max(0, line.qty - (alreadyReturnedByLine[line.id] ?? 0));
                  setReturnQtyByLine((current) => ({
                    ...current,
                    [line.id]: String(Math.min(parsed, maxQty)),
                  }));
                }}
                inputMode="numeric"
                className="mt-2"
              />
            </div>
          ))}

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">{t("history.refundMethod")}</p>
            <Select
              value={refundMethod}
              onValueChange={(value) => setRefundMethod(value as PosPaymentMethod)}
            >
              <SelectTrigger aria-label={t("history.refundMethod")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PosPaymentMethod.CASH}>{t("payments.cash")}</SelectItem>
                <SelectItem value={PosPaymentMethod.CARD}>{t("payments.card")}</SelectItem>
                <SelectItem value={PosPaymentMethod.TRANSFER}>{t("payments.transfer")}</SelectItem>
                <SelectItem value={PosPaymentMethod.OTHER}>{t("payments.other")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <p className="text-sm font-semibold text-foreground">
            {t("history.returnTotal")}:{" "}
            {formatKgsMoney(returnTotal, locale, selectedSaleCurrencySource)}
          </p>

          <ModalFooter>
            <Button
              variant="secondary"
              onClick={() => setReturnSaleId(null)}
              disabled={isReturnMutationBusy}
            >
              {tCommon("cancel")}
            </Button>
            <Button onClick={handleStartReturn} disabled={isReturnMutationBusy}>
              {isReturnMutationBusy ? <Spinner className="h-4 w-4" /> : null}
              {t("history.completeReturn")}
            </Button>
          </ModalFooter>
        </div>
      </Modal>
    </div>
  );
};

export default PosHistoryPage;

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CashDrawerMovementType } from "@prisma/client";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import {
  currencySourceWithFallback,
  displayMoneyFromKgs,
  displayMoneyToKgs,
  formatKgsMoney,
} from "@/lib/currencyDisplay";
import { formatDateTime } from "@/lib/i18nFormat";
import { buildHeldReceiptResumeHref } from "@/lib/mobilePosState";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const selectedRegisterKey = "pos:selected-register";

const createIdempotencyKey = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `pos-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const PosShiftsPage = () => {
  const t = useTranslations("pos");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const [registerId, setRegisterId] = useState(searchParams.get("registerId") ?? "");
  const [countedCash, setCountedCash] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [closeConfirmed, setCloseConfirmed] = useState(false);
  const [cashAmount, setCashAmount] = useState("");
  const [cashReason, setCashReason] = useState("");
  const [cashComment, setCashComment] = useState("");
  const [cashOutReason, setCashOutReason] = useState("collection");
  const [cashType, setCashType] = useState<CashDrawerMovementType>(CashDrawerMovementType.PAY_IN);

  const registersQuery = trpc.pos.registers.list.useQuery({ status: "all" });
  const selectedRegister = (registersQuery.data ?? []).find((item) => item.id === registerId);
  const registerExists = (registersQuery.data ?? []).some((item) => item.id === registerId);
  const canLoadRegisterScopedData = Boolean(registerId) && registerExists;
  const canOpenNewShift = canLoadRegisterScopedData && Boolean(selectedRegister?.isActive);

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
    if (!registerId || !registersQuery.data?.length) {
      return;
    }
    if (registerExists) {
      return;
    }
    setRegisterId("");
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(selectedRegisterKey);
    }
  }, [registerExists, registerId, registersQuery.data]);

  const currentShiftQuery = trpc.pos.shifts.current.useQuery(
    { registerId },
    { enabled: canLoadRegisterScopedData, refetchOnWindowFocus: true },
  );

  const reportQuery = trpc.pos.shifts.xReport.useQuery(
    { shiftId: currentShiftQuery.data?.id ?? "" },
    { enabled: Boolean(currentShiftQuery.data?.id), refetchOnWindowFocus: true },
  );

  const historyQuery = trpc.pos.shifts.list.useQuery(
    { registerId: registerId || undefined, page: 1, pageSize: 20 },
    { enabled: canLoadRegisterScopedData, refetchOnWindowFocus: true },
  );

  const closeShiftMutation = trpc.pos.shifts.close.useMutation({
    onSuccess: async () => {
      setCountedCash("");
      setCloseNote("");
      setCloseConfirmed(false);
      toast({ variant: "success", description: t("shifts.closedSuccess") });
      await Promise.all([
        currentShiftQuery.refetch(),
        historyQuery.refetch(),
        reportQuery.refetch(),
      ]);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const cashMovementMutation = trpc.pos.cash.record.useMutation({
    onSuccess: async () => {
      setCashAmount("");
      setCashReason("");
      setCashComment("");
      toast({ variant: "success", description: t("shifts.cashMovementSuccess") });
      await reportQuery.refetch();
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const currentShift = currentShiftQuery.data;
  const currentShiftCurrencySource = currencySourceWithFallback(
    currentShift,
    currentShift?.store ?? null,
  );
  const report = reportQuery.data;
  const heldReceipts = currentShift?.heldReceipts ?? [];
  const heldReceiptCount = currentShift?.heldReceiptCount ?? heldReceipts.length;
  const expectedCash = report?.summary.expectedCashKgs ?? 0;
  const overWithdrawalKgs =
    report?.summary.overWithdrawalKgs ?? Math.round(Math.max(0, -expectedCash) * 100) / 100;
  const countableCashKgs =
    report?.summary.countableCashKgs ?? Math.round(Math.max(0, expectedCash) * 100) / 100;
  const countedCashNumber = Number(countedCash);
  const countedCashKgs = displayMoneyToKgs(countedCashNumber, currentShiftCurrencySource);
  const countedCashValid =
    Number.isFinite(countedCashNumber) && countedCashNumber >= 0 && Number.isFinite(countedCashKgs);
  const cashDifference = countedCashValid
    ? Math.round((countedCashKgs - expectedCash) * 100) / 100
    : null;
  const cashDifferenceStatus =
    cashDifference === null
      ? null
      : cashDifference > 0.009
        ? "surplus"
        : cashDifference < -0.009
          ? "shortage"
          : "balanced";
  const closeNoteRequired = cashDifference !== null && Math.abs(cashDifference) > 0.009;
  const closeNoteValid = !closeNoteRequired || closeNote.trim().length > 0;
  const closeBlockingMessage =
    countedCashNumber < 0 ? t("shifts.countedCashNegative") : null;
  const closeWarningMessage =
    report && overWithdrawalKgs > 0.009
      ? t("shifts.overWithdrawalWarning", {
          amount: formatKgsMoney(overWithdrawalKgs, locale, currentShiftCurrencySource),
        })
      : null;
  const paymentBreakdown = report
    ? [
        { method: "CASH" as const, label: t("payments.cash") },
        { method: "CARD" as const, label: t("payments.card") },
        { method: "TRANSFER" as const, label: t("payments.transfer") },
        { method: "OTHER" as const, label: t("payments.other") },
      ].map((entry) => ({
        ...entry,
        ...report.paymentsByMethod[entry.method],
      }))
    : [];
  const cashOutReasonOptions = [
    { value: "collection", label: t("shifts.cashOutReasonCollection") },
    { value: "expense", label: t("shifts.cashOutReasonExpense") },
    { value: "correction", label: t("shifts.cashOutReasonCorrection") },
    { value: "other", label: t("shifts.cashOutReasonOther") },
  ];

  useEffect(() => {
    if (!report) {
      return;
    }
    if (!countedCash) {
      setCountedCash(
        String(
          displayMoneyFromKgs(
            Math.max(0, report.summary.expectedCashKgs),
            currentShiftCurrencySource,
          ),
        ),
      );
    }
  }, [currentShiftCurrencySource, report, countedCash]);

  const handleCloseShift = async () => {
    if (!currentShift) {
      return;
    }
    if (heldReceiptCount > 0) {
      toast({ variant: "error", description: t("shifts.heldReceiptsBlockClose") });
      return;
    }
    const amount = Number(countedCash);
    const amountKgs = displayMoneyToKgs(amount, currentShiftCurrencySource);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(amountKgs)) {
      toast({
        variant: "error",
        description: amount < 0 ? t("shifts.countedCashNegative") : t("shifts.invalidAmount"),
      });
      return;
    }
    if (!closeConfirmed) {
      toast({ variant: "error", description: t("shifts.confirmCloseRequired") });
      return;
    }
    if (!closeNoteValid) {
      toast({ variant: "error", description: t("shifts.differenceNoteRequired") });
      return;
    }

    try {
      await closeShiftMutation.mutateAsync({
        shiftId: currentShift.id,
        closingCashCountedKgs: amountKgs,
        notes: closeNote.trim() || null,
        idempotencyKey: createIdempotencyKey(),
      });
    } catch {
      // handled by mutation onError
    }
  };

  const handleCashMovement = async () => {
    if (!currentShift) {
      return;
    }
    const amount = Number(cashAmount);
    const amountKgs = displayMoneyToKgs(amount, currentShiftCurrencySource);
    const selectedCashOutReason =
      cashOutReasonOptions.find((option) => option.value === cashOutReason)?.label ??
      t("shifts.cashOutReasonOther");
    const reason =
      cashType === CashDrawerMovementType.PAY_OUT
        ? [selectedCashOutReason, cashComment.trim()].filter(Boolean).join(": ")
        : cashReason.trim();
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !Number.isFinite(amountKgs) ||
      reason.length < 2
    ) {
      toast({ variant: "error", description: t("shifts.cashMovementInvalid") });
      return;
    }
    if (
      cashType === CashDrawerMovementType.PAY_OUT &&
      report &&
      expectedCash - amountKgs < -0.009
    ) {
      toast({ variant: "error", description: t("shifts.cashOutExceedsExpectedCash") });
      return;
    }

    await cashMovementMutation.mutateAsync({
      shiftId: currentShift.id,
      type: cashType,
      amountKgs,
      reason,
      idempotencyKey: createIdempotencyKey(),
    });
  };

  const historyItems = historyQuery.data?.items ?? [];
  const formatCurrentShiftMoney = (amountKgs: number) =>
    formatKgsMoney(amountKgs, locale, currentShiftCurrencySource);

  return (
    <div className="space-y-6">
      <PageHeader title={t("shifts.title")} subtitle={t("shifts.subtitle")} />

      <Card className="bazaar-admin-surface">
        <CardHeader className="bazaar-admin-section-header">
          <CardTitle>{t("entry.register")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={registerId} onValueChange={setRegisterId}>
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
        </CardContent>
      </Card>

      <Card className="bazaar-admin-surface">
        <CardHeader className="bazaar-admin-section-header">
          <CardTitle>{t("shifts.current")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canLoadRegisterScopedData ? (
            <p className="text-sm text-muted-foreground">
              {(registersQuery.data ?? []).length
                ? t("entry.selectRegisterFirst")
                : t("entry.noRegisters")}
            </p>
          ) : null}

          {canLoadRegisterScopedData && currentShiftQuery.isLoading ? (
            <div className="bazaar-admin-empty min-h-[8rem] gap-2">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : null}

          {canOpenNewShift && !currentShiftQuery.isLoading && !currentShift ? (
            <div className="bazaar-admin-notice flex flex-wrap items-center gap-2">
              {t("entry.shiftClosed")}
              <Button variant="secondary" asChild>
                <Link href={`/pos?registerId=${registerId}`}>{t("entry.openShift")}</Link>
              </Button>
            </div>
          ) : null}

          {canLoadRegisterScopedData &&
          selectedRegister &&
          !selectedRegister.isActive &&
          !currentShift ? (
            <p className="bazaar-admin-notice">{t("registers.inactiveNoNewSessions")}</p>
          ) : null}

          {currentShift ? (
            <>
              <div className="flex items-center gap-2">
                <Badge variant="success">{t("entry.shiftOpen")}</Badge>
                <p className="text-sm text-muted-foreground">
                  {formatDateTime(currentShift.openedAt, locale)}
                </p>
              </div>

              {report ? (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Card className="bazaar-admin-status-tile">
                      <CardContent className="pt-4">
                        <p className="text-xs text-muted-foreground">{t("shifts.cashSales")}</p>
                        <p className="text-sm font-semibold text-foreground">
                          {formatCurrentShiftMoney(report.summary.cashSalesKgs)}
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="bazaar-admin-status-tile">
                      <CardContent className="pt-4">
                        <p className="text-xs text-muted-foreground">{t("shifts.nonCashSales")}</p>
                        <p className="text-sm font-semibold text-foreground">
                          {formatCurrentShiftMoney(report.summary.nonCashSalesKgs)}
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="bazaar-admin-status-tile">
                      <CardContent className="pt-4">
                        <p className="text-xs text-muted-foreground">{t("shifts.totalSales")}</p>
                        <p className="text-sm font-semibold text-foreground">
                          {formatCurrentShiftMoney(report.summary.totalSalesKgs)}
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="bazaar-admin-status-tile">
                      <CardContent className="pt-4">
                        <p className="text-xs text-muted-foreground">{t("shifts.returnsTotal")}</p>
                        <p className="text-sm font-semibold text-foreground">
                          {formatCurrentShiftMoney(report.summary.totalRefundsKgs)}
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
                    <div className="bazaar-admin-status-tile">
                      <p className="text-xs font-semibold uppercase text-muted-foreground">
                        {t("shifts.salesSummary")}
                      </p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        <div className="bazaar-admin-info-tile px-3 py-2">
                          <p className="text-xs text-muted-foreground">{t("shifts.cashSales")}</p>
                          <p className="text-sm font-semibold text-foreground">
                            {formatCurrentShiftMoney(report.summary.cashSalesKgs)}
                          </p>
                        </div>
                        <div className="bazaar-admin-info-tile px-3 py-2">
                          <p className="text-xs text-muted-foreground">
                            {t("shifts.nonCashSales")}
                          </p>
                          <p className="text-sm font-semibold text-foreground">
                            {formatCurrentShiftMoney(report.summary.nonCashSalesKgs)}
                          </p>
                        </div>
                        <div className="bazaar-admin-info-tile px-3 py-2">
                          <p className="text-xs text-muted-foreground">{t("shifts.totalSales")}</p>
                          <p className="text-sm font-semibold text-foreground">
                            {formatCurrentShiftMoney(report.summary.totalSalesKgs)}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="bazaar-admin-status-tile">
                      <p className="text-xs font-semibold uppercase text-muted-foreground">
                        {t("shifts.cashDrawerSummary")}
                      </p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        <div className="bazaar-admin-info-tile px-3 py-2">
                          <p className="text-xs text-muted-foreground">
                            {t("shifts.calculatedCash")}
                          </p>
                          <p className="text-sm font-semibold text-foreground">
                            {formatCurrentShiftMoney(report.summary.expectedCashKgs)}
                          </p>
                        </div>
                        {report.summary.overWithdrawalKgs > 0.009 ? (
                          <div className="bazaar-admin-info-tile px-3 py-2">
                            <p className="text-xs text-muted-foreground">
                              {t("shifts.overWithdrawal")}
                            </p>
                            <p className="text-sm font-semibold text-warning">
                              {formatCurrentShiftMoney(report.summary.overWithdrawalKgs)}
                            </p>
                          </div>
                        ) : null}
                        <div className="bazaar-admin-info-tile px-3 py-2">
                          <p className="text-xs text-muted-foreground">
                            {t("shifts.countableCash")}
                          </p>
                          <p className="text-sm font-semibold text-foreground">
                            {formatCurrentShiftMoney(report.summary.countableCashKgs)}
                          </p>
                        </div>
                        <div className="bazaar-admin-info-tile px-3 py-2">
                          <p className="text-xs text-muted-foreground">{t("shifts.cashIn")}</p>
                          <p className="text-sm font-semibold text-foreground">
                            {formatCurrentShiftMoney(report.summary.payInKgs)}
                          </p>
                        </div>
                        <div className="bazaar-admin-info-tile px-3 py-2">
                          <p className="text-xs text-muted-foreground">{t("shifts.cashOut")}</p>
                          <p className="text-sm font-semibold text-foreground">
                            {formatCurrentShiftMoney(report.summary.payOutKgs)}
                          </p>
                        </div>
                        <div className="bazaar-admin-info-tile px-3 py-2">
                          <p className="text-xs text-muted-foreground">
                            {t("shifts.nonCashTotal")}
                          </p>
                          <p className="text-sm font-semibold text-foreground">
                            {formatCurrentShiftMoney(report.summary.nonCashNetKgs)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bazaar-admin-status-tile">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">
                      {t("shifts.paymentBreakdown")}
                    </p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      {paymentBreakdown.map((entry) => (
                        <div
                          key={entry.method}
                          className="bazaar-admin-info-tile px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium text-foreground">{entry.label}</p>
                            <p className="text-sm font-semibold text-foreground">
                              {formatCurrentShiftMoney(entry.netKgs)}
                            </p>
                          </div>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {t("shifts.salesNetBreakdown", {
                              sales: formatCurrentShiftMoney(entry.salesKgs),
                              refunds: formatCurrentShiftMoney(entry.refundsKgs),
                            })}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="bazaar-admin-toolbar grid gap-3 md:grid-cols-[180px_160px_1fr_auto]">
                <Select
                  value={cashType}
                  onValueChange={(value) => setCashType(value as CashDrawerMovementType)}
                >
                  <SelectTrigger aria-label={t("shifts.cashMovementType")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={CashDrawerMovementType.PAY_IN}>
                      {t("shifts.payIn")}
                    </SelectItem>
                    <SelectItem value={CashDrawerMovementType.PAY_OUT}>
                      {t("shifts.payOut")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    value={cashAmount}
                    onChange={(event) => setCashAmount(event.target.value)}
                    placeholder={t("shifts.amount")}
                    inputMode="decimal"
                  />
                </div>
                {cashType === CashDrawerMovementType.PAY_OUT ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Select value={cashOutReason} onValueChange={setCashOutReason}>
                      <SelectTrigger aria-label={t("shifts.cashOutReason")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {cashOutReasonOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={cashComment}
                      onChange={(event) => setCashComment(event.target.value)}
                      placeholder={t("shifts.comment")}
                    />
                  </div>
                ) : (
                  <Input
                    value={cashReason}
                    onChange={(event) => setCashReason(event.target.value)}
                    placeholder={t("shifts.reason")}
                  />
                )}
                <Button onClick={handleCashMovement} disabled={cashMovementMutation.isLoading}>
                  {cashMovementMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                  {t("shifts.record")}
                </Button>
              </div>

              <div className="bazaar-admin-surface space-y-3 p-3">
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="bazaar-admin-info-tile">
                    <p className="text-xs text-muted-foreground">{t("entry.openingCash")}</p>
                    <p className="text-sm font-semibold text-foreground">
                      {formatCurrentShiftMoney(currentShift.openingCashKgs)}
                    </p>
                  </div>
                  <div className="bazaar-admin-info-tile">
                    <p className="text-xs text-muted-foreground">{t("shifts.calculatedCash")}</p>
                    <p className="text-sm font-semibold text-foreground">
                      {formatCurrentShiftMoney(expectedCash)}
                    </p>
                  </div>
                  {overWithdrawalKgs > 0.009 ? (
                    <div className="bazaar-admin-info-tile">
                      <p className="text-xs text-muted-foreground">{t("shifts.overWithdrawal")}</p>
                      <p className="text-sm font-semibold text-warning">
                        {formatCurrentShiftMoney(overWithdrawalKgs)}
                      </p>
                    </div>
                  ) : null}
                  <div className="bazaar-admin-info-tile">
                    <p className="text-xs text-muted-foreground">{t("shifts.countableCash")}</p>
                    <p className="text-sm font-semibold text-foreground">
                      {formatCurrentShiftMoney(countableCashKgs)}
                    </p>
                  </div>
                  <div className="bazaar-admin-info-tile">
                    <p className="text-xs text-muted-foreground">{t("shifts.difference")}</p>
                    <p
                      className={
                        cashDifferenceStatus === "surplus"
                          ? "text-sm font-semibold text-success"
                          : cashDifferenceStatus === "shortage"
                            ? "text-sm font-semibold text-danger"
                            : "text-sm font-semibold text-foreground"
                      }
                    >
                      {cashDifference === null
                        ? tCommon("notAvailable")
                        : `${cashDifferenceStatus ? t(`shifts.${cashDifferenceStatus}`) : ""} · ${formatCurrentShiftMoney(Math.abs(cashDifference))}`}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-[220px_1fr]">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">
                      {t("shifts.countedCash")}
                    </label>
                    <Input
                      value={countedCash}
                      onChange={(event) => setCountedCash(event.target.value)}
                      placeholder={t("shifts.countedCash")}
                      inputMode="decimal"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">
                      {t("shifts.closingNote")}
                    </label>
                    <Textarea
                      value={closeNote}
                      onChange={(event) => setCloseNote(event.target.value)}
                      placeholder={t("shifts.closingNotePlaceholder")}
                      rows={3}
                    />
                    {closeNoteRequired ? (
                      <p className="text-xs text-muted-foreground">
                        {t("shifts.differenceNoteRequired")}
                      </p>
                    ) : null}
                  </div>
                </div>

                {heldReceiptCount > 0 ? (
                  <div className="bazaar-admin-status-tile-warning">
                    <p className="text-sm font-semibold text-foreground">
                      {t("shifts.heldReceiptsBlockClose")}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("shifts.heldReceiptsBlockCloseCount", { count: heldReceiptCount })}
                    </p>
                    {heldReceipts.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {heldReceipts.map((receipt) => (
                          <Link
                            key={receipt.id}
                            href={buildHeldReceiptResumeHref(registerId, receipt.id)}
                            aria-label={`${t("sell.resumeHeldReceipt")} ${receipt.number}`}
                            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          >
                            <Badge
                              variant="warning"
                              className="cursor-pointer transition-colors hover:bg-warning/25"
                            >
                              {receipt.number}
                            </Badge>
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {closeBlockingMessage ? (
                  <div className="bazaar-admin-status-tile-warning">
                    <p className="text-sm font-semibold text-foreground">{closeBlockingMessage}</p>
                  </div>
                ) : null}

                {closeWarningMessage ? (
                  <div className="bazaar-admin-status-tile-warning">
                    <p className="text-sm font-semibold text-foreground">{closeWarningMessage}</p>
                  </div>
                ) : null}

                <label className="bazaar-admin-notice flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded-md border-border bg-background text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    checked={closeConfirmed}
                    onChange={(event) => setCloseConfirmed(event.target.checked)}
                  />
                  <span className="text-muted-foreground">{t("shifts.confirmClose")}</span>
                </label>

                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button variant="secondary" asChild>
                    <Link href={`/pos/sell?registerId=${registerId}`}>{t("entry.sell")}</Link>
                  </Button>
                  <Button
                    onClick={handleCloseShift}
                    disabled={
                      closeShiftMutation.isLoading ||
                      !countedCashValid ||
                      Boolean(closeBlockingMessage) ||
                      !closeConfirmed ||
                      !closeNoteValid ||
                      heldReceiptCount > 0
                    }
                  >
                    {closeShiftMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                    {t("shifts.closeShift")}
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card className="bazaar-admin-surface">
        <CardHeader className="bazaar-admin-section-header">
          <CardTitle>{t("shifts.historyTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!canLoadRegisterScopedData ? (
            <p className="text-sm text-muted-foreground">
              {(registersQuery.data ?? []).length
                ? t("entry.selectRegisterFirst")
                : t("entry.noRegisters")}
            </p>
          ) : null}

          {(historyItems ?? []).map((shift) => {
            const historyCurrencySource = currencySourceWithFallback(shift, shift.store);
            const difference =
              shift.expectedCashKgs !== null && shift.closingCashCountedKgs !== null
                ? Math.round((shift.closingCashCountedKgs - shift.expectedCashKgs) * 100) / 100
                : null;
            const differenceStatus =
              difference === null
                ? null
                : difference > 0.009
                  ? "surplus"
                  : difference < -0.009
                    ? "shortage"
                    : "balanced";
            return (
              <div key={shift.id} className="bazaar-admin-mobile-card p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">
                        {shift.register.name} ({shift.register.code})
                      </p>
                      <Badge variant={shift.status === "OPEN" ? "success" : "muted"}>
                        {shift.status === "OPEN" ? t("shifts.opened") : t("shifts.closed")}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("shifts.openedBy")}: {shift.openedBy.name} ·{" "}
                      {formatDateTime(shift.openedAt, locale)}
                    </p>
                    {shift.closedAt ? (
                      <p className="text-xs text-muted-foreground">
                        {t("shifts.closedBy")}: {shift.closedBy?.name ?? tCommon("notAvailable")} ·{" "}
                        {formatDateTime(shift.closedAt, locale)}
                      </p>
                    ) : null}
                  </div>
                  <div className="grid gap-x-5 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2 sm:text-right">
                    <p>
                      {t("shifts.cashSales")}:{" "}
                      {formatKgsMoney(
                        shift.summary.cashSalesKgs,
                        locale,
                        historyCurrencySource,
                      )}
                    </p>
                    <p>
                      {t("shifts.nonCashSales")}:{" "}
                      {formatKgsMoney(
                        shift.summary.nonCashSalesKgs,
                        locale,
                        historyCurrencySource,
                      )}
                    </p>
                    <p>
                      {t("shifts.totalSales")}:{" "}
                      {formatKgsMoney(
                        shift.summary.totalSalesKgs,
                        locale,
                        historyCurrencySource,
                      )}
                    </p>
                    <p>
                      {t("shifts.returnsTotal")}:{" "}
                      {formatKgsMoney(
                        shift.summary.totalRefundsKgs,
                        locale,
                        historyCurrencySource,
                      )}
                    </p>
                    <p>
                      {t("entry.openingCash")}:{" "}
                      {formatKgsMoney(shift.openingCashKgs, locale, historyCurrencySource)}
                    </p>
                    <p>
                      {t("shifts.calculatedCash")}:{" "}
                      {formatKgsMoney(shift.expectedCashKgs ?? 0, locale, historyCurrencySource)}
                    </p>
                    {shift.overWithdrawalKgs > 0.009 ? (
                      <p className="text-warning">
                        {t("shifts.overWithdrawal")}:{" "}
                        {formatKgsMoney(shift.overWithdrawalKgs, locale, historyCurrencySource)}
                      </p>
                    ) : null}
                    <p>
                      {t("shifts.countableCash")}:{" "}
                      {formatKgsMoney(shift.countableCashKgs ?? 0, locale, historyCurrencySource)}
                    </p>
                    <p>
                      {t("shifts.countedCash")}:{" "}
                      {shift.closingCashCountedKgs === null
                        ? tCommon("notAvailable")
                        : formatKgsMoney(shift.closingCashCountedKgs, locale, historyCurrencySource)}
                    </p>
                    <p
                      className={
                        differenceStatus === "surplus"
                          ? "text-success"
                          : differenceStatus === "shortage"
                            ? "text-danger"
                            : "text-muted-foreground"
                      }
                    >
                      {t("shifts.difference")}:{" "}
                      {difference === null
                        ? tCommon("notAvailable")
                        : `${differenceStatus ? t(`shifts.${differenceStatus}`) : ""} · ${formatKgsMoney(
                            Math.abs(difference),
                            locale,
                            historyCurrencySource,
                          )}`}
                    </p>
                  </div>
                </div>
                {shift.notes ? (
                  <p className="mt-2 rounded-lg bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
                    {t("shifts.notes")}: {shift.notes}
                  </p>
                ) : null}
              </div>
            );
          })}

          {canLoadRegisterScopedData && historyQuery.isLoading ? (
            <div className="bazaar-admin-empty min-h-[8rem] gap-2">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : null}
          {canLoadRegisterScopedData && !historyQuery.isLoading && !historyItems.length ? (
            <p className="bazaar-admin-empty">{t("shifts.noHistory")}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};

export default PosShiftsPage;

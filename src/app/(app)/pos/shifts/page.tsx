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
import { formatCurrencyKGS, formatDateTime } from "@/lib/i18nFormat";
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
  const [cashType, setCashType] = useState<CashDrawerMovementType>(CashDrawerMovementType.PAY_IN);

  const registersQuery = trpc.pos.registers.list.useQuery();
  const registerExists = (registersQuery.data ?? []).some((item) => item.id === registerId);
  const canLoadRegisterScopedData = Boolean(registerId) && registerExists;

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
      await Promise.all([currentShiftQuery.refetch(), historyQuery.refetch(), reportQuery.refetch()]);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const cashMovementMutation = trpc.pos.cash.record.useMutation({
    onSuccess: async () => {
      setCashAmount("");
      setCashReason("");
      toast({ variant: "success", description: t("shifts.cashMovementSuccess") });
      await reportQuery.refetch();
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const currentShift = currentShiftQuery.data;
  const report = reportQuery.data;
  const expectedCash = report?.summary.expectedCashKgs ?? 0;
  const countedCashNumber = Number(countedCash);
  const countedCashValid = Number.isFinite(countedCashNumber) && countedCashNumber >= 0;
  const cashDifference = countedCashValid
    ? Math.round((countedCashNumber - expectedCash) * 100) / 100
    : null;
  const cashDifferenceStatus =
    cashDifference === null
      ? null
      : cashDifference > 0.009
        ? "surplus"
        : cashDifference < -0.009
          ? "shortage"
          : "balanced";

  useEffect(() => {
    if (!report) {
      return;
    }
    if (!countedCash) {
      setCountedCash(String(report.summary.expectedCashKgs));
    }
  }, [report, countedCash]);

  const handleCloseShift = async () => {
    if (!currentShift) {
      return;
    }
    const amount = Number(countedCash);
    if (!Number.isFinite(amount) || amount < 0) {
      toast({ variant: "error", description: t("shifts.invalidAmount") });
      return;
    }
    if (!closeConfirmed) {
      toast({ variant: "error", description: t("shifts.confirmCloseRequired") });
      return;
    }

    await closeShiftMutation.mutateAsync({
      shiftId: currentShift.id,
      closingCashCountedKgs: amount,
      notes: closeNote.trim() || null,
      idempotencyKey: createIdempotencyKey(),
    });
  };

  const handleCashMovement = async () => {
    if (!currentShift) {
      return;
    }
    const amount = Number(cashAmount);
    if (!Number.isFinite(amount) || amount <= 0 || cashReason.trim().length < 2) {
      toast({ variant: "error", description: t("shifts.cashMovementInvalid") });
      return;
    }

    await cashMovementMutation.mutateAsync({
      shiftId: currentShift.id,
      type: cashType,
      amountKgs: amount,
      reason: cashReason.trim(),
      idempotencyKey: createIdempotencyKey(),
    });
  };

  const historyItems = historyQuery.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title={t("shifts.title")} subtitle={t("shifts.subtitle")} />

      <Card>
        <CardHeader>
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

      <Card>
        <CardHeader>
          <CardTitle>{t("shifts.current")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canLoadRegisterScopedData ? (
            <p className="text-sm text-muted-foreground">
              {(registersQuery.data ?? []).length ? t("entry.selectRegisterFirst") : t("entry.noRegisters")}
            </p>
          ) : null}

          {canLoadRegisterScopedData && currentShiftQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : null}

          {canLoadRegisterScopedData && !currentShiftQuery.isLoading && !currentShift ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {t("entry.shiftClosed")}
              <Button variant="secondary" asChild>
                <Link href={`/pos?registerId=${registerId}`}>{t("entry.openShift")}</Link>
              </Button>
            </div>
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
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Card className="shadow-none">
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground">{t("shifts.salesTotal")}</p>
                      <p className="text-sm font-semibold text-foreground">
                        {formatCurrencyKGS(report.summary.salesTotalKgs, locale)}
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="shadow-none">
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground">{t("shifts.returnsTotal")}</p>
                      <p className="text-sm font-semibold text-foreground">
                        {formatCurrencyKGS(report.summary.returnsTotalKgs, locale)}
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="shadow-none">
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground">{t("shifts.expectedCash")}</p>
                      <p className="text-sm font-semibold text-foreground">
                        {formatCurrencyKGS(report.summary.expectedCashKgs, locale)}
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="shadow-none">
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground">{t("shifts.cashInOut")}</p>
                      <p className="text-sm font-semibold text-foreground">
                        +{formatCurrencyKGS(report.summary.payInKgs, locale)} / -
                        {formatCurrencyKGS(report.summary.payOutKgs, locale)}
                      </p>
                    </CardContent>
                  </Card>
                </div>
              ) : null}

              <div className="grid gap-3 rounded-md border border-border bg-card p-3 md:grid-cols-[180px_1fr_auto]">
                <Select value={cashType} onValueChange={(value) => setCashType(value as CashDrawerMovementType)}>
                  <SelectTrigger aria-label={t("shifts.cashMovementType")}> 
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={CashDrawerMovementType.PAY_IN}>{t("shifts.payIn")}</SelectItem>
                    <SelectItem value={CashDrawerMovementType.PAY_OUT}>{t("shifts.payOut")}</SelectItem>
                  </SelectContent>
                </Select>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    value={cashAmount}
                    onChange={(event) => setCashAmount(event.target.value)}
                    placeholder={t("shifts.amount")}
                    inputMode="decimal"
                  />
                  <Input
                    value={cashReason}
                    onChange={(event) => setCashReason(event.target.value)}
                    placeholder={t("shifts.reason")}
                  />
                </div>
                <Button onClick={handleCashMovement} disabled={cashMovementMutation.isLoading}>
                  {cashMovementMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                  {t("shifts.record")}
                </Button>
              </div>

              <div className="space-y-3 rounded-md border border-border bg-card p-3">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-md border border-border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">{t("entry.openingCash")}</p>
                    <p className="text-sm font-semibold text-foreground">
                      {formatCurrencyKGS(currentShift.openingCashKgs, locale)}
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">{t("shifts.expectedCash")}</p>
                    <p className="text-sm font-semibold text-foreground">
                      {formatCurrencyKGS(expectedCash, locale)}
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-muted/20 p-3">
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
                        : `${cashDifferenceStatus ? t(`shifts.${cashDifferenceStatus}`) : ""} · ${formatCurrencyKGS(Math.abs(cashDifference), locale)}`}
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
                  </div>
                </div>

                <label className="flex items-start gap-2 rounded-md border border-border/70 bg-muted/20 p-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-border bg-background text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
                    disabled={closeShiftMutation.isLoading || !countedCashValid || !closeConfirmed}
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

      <Card>
        <CardHeader>
          <CardTitle>{t("shifts.historyTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!canLoadRegisterScopedData ? (
            <p className="text-sm text-muted-foreground">
              {(registersQuery.data ?? []).length ? t("entry.selectRegisterFirst") : t("entry.noRegisters")}
            </p>
          ) : null}

          {(historyItems ?? []).map((shift) => {
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
            <div
              key={shift.id}
              className="rounded-md border border-border bg-card p-3"
            >
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
                    {t("shifts.openedBy")}: {shift.openedBy.name} · {formatDateTime(shift.openedAt, locale)}
                  </p>
                  {shift.closedAt ? (
                    <p className="text-xs text-muted-foreground">
                      {t("shifts.closedBy")}: {shift.closedBy?.name ?? tCommon("notAvailable")} · {formatDateTime(shift.closedAt, locale)}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-x-5 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2 sm:text-right">
                  <p>
                    {t("entry.openingCash")}: {formatCurrencyKGS(shift.openingCashKgs, locale)}
                  </p>
                  <p>
                    {t("shifts.expectedCash")}: {formatCurrencyKGS(shift.expectedCashKgs ?? 0, locale)}
                  </p>
                  <p>
                    {t("shifts.countedCash")}: {shift.closingCashCountedKgs === null ? tCommon("notAvailable") : formatCurrencyKGS(shift.closingCashCountedKgs, locale)}
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
                      : `${differenceStatus ? t(`shifts.${differenceStatus}`) : ""} · ${formatCurrencyKGS(Math.abs(difference), locale)}`}
                  </p>
                </div>
              </div>
              {shift.notes ? (
                <p className="mt-2 rounded-md bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
                  {t("shifts.notes")}: {shift.notes}
                </p>
              ) : null}
            </div>
            );
          })}

          {canLoadRegisterScopedData && historyQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : null}
          {canLoadRegisterScopedData && !historyQuery.isLoading && !historyItems.length ? (
            <p className="text-sm text-muted-foreground">{t("shifts.noHistory")}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};

export default PosShiftsPage;

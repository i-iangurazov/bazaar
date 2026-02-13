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
  const [cashAmount, setCashAmount] = useState("");
  const [cashReason, setCashReason] = useState("");
  const [cashType, setCashType] = useState<CashDrawerMovementType>(CashDrawerMovementType.PAY_IN);

  const registersQuery = trpc.pos.registers.list.useQuery();

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

  const currentShiftQuery = trpc.pos.shifts.current.useQuery(
    { registerId },
    { enabled: Boolean(registerId), refetchOnWindowFocus: true },
  );

  const reportQuery = trpc.pos.shifts.xReport.useQuery(
    { shiftId: currentShiftQuery.data?.id ?? "" },
    { enabled: Boolean(currentShiftQuery.data?.id), refetchOnWindowFocus: true },
  );

  const historyQuery = trpc.pos.shifts.list.useQuery(
    { registerId: registerId || undefined, page: 1, pageSize: 20 },
    { enabled: Boolean(registerId), refetchOnWindowFocus: true },
  );

  const closeShiftMutation = trpc.pos.shifts.close.useMutation({
    onSuccess: async () => {
      setCountedCash("");
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

  useEffect(() => {
    if (!report?.summary.expectedCashKgs) {
      return;
    }
    if (!countedCash) {
      setCountedCash(String(report.summary.expectedCashKgs));
    }
  }, [report?.summary.expectedCashKgs, countedCash]);

  const handleCloseShift = async () => {
    if (!currentShift) {
      return;
    }
    const amount = Number(countedCash);
    if (!Number.isFinite(amount) || amount < 0) {
      toast({ variant: "error", description: t("shifts.invalidAmount") });
      return;
    }

    await closeShiftMutation.mutateAsync({
      shiftId: currentShift.id,
      closingCashCountedKgs: amount,
      notes: null,
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
          {currentShiftQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : null}

          {!currentShiftQuery.isLoading && !currentShift ? (
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

              <div className="grid gap-3 rounded-md border border-border bg-card p-3 md:grid-cols-[1fr_auto_auto]">
                <Input
                  value={countedCash}
                  onChange={(event) => setCountedCash(event.target.value)}
                  placeholder={t("shifts.countedCash")}
                  inputMode="decimal"
                />
                <Button onClick={handleCloseShift} disabled={closeShiftMutation.isLoading}>
                  {closeShiftMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                  {t("shifts.closeShift")}
                </Button>
                <Button variant="secondary" asChild>
                  <Link href={`/pos/sell?registerId=${registerId}`}>{t("entry.sell")}</Link>
                </Button>
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
          {(historyItems ?? []).map((shift) => (
            <div
              key={shift.id}
              className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {shift.register.name} ({shift.register.code})
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(shift.openedAt, locale)}
                </p>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <p>
                  {t("shifts.expectedCash")}: {formatCurrencyKGS(shift.expectedCashKgs ?? 0, locale)}
                </p>
                <p>
                  {t("shifts.countedCash")}: {formatCurrencyKGS(shift.closingCashCountedKgs ?? 0, locale)}
                </p>
              </div>
            </div>
          ))}

          {historyQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};

export default PosShiftsPage;

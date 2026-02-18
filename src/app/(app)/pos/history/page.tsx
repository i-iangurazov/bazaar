"use client";

import { useEffect, useMemo, useState } from "react";
import { PosPaymentMethod } from "@prisma/client";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
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

const PosHistoryPage = () => {
  const t = useTranslations("pos");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const { toast } = useToast();

  const [registerId, setRegisterId] = useState(searchParams.get("registerId") ?? "");
  const [search, setSearch] = useState("");
  const [returnSaleId, setReturnSaleId] = useState<string | null>(null);
  const [returnQtyByLine, setReturnQtyByLine] = useState<Record<string, string>>({});
  const [refundMethod, setRefundMethod] = useState<PosPaymentMethod>(PosPaymentMethod.CASH);

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

  const salesQuery = trpc.pos.sales.list.useQuery(
    {
      registerId: registerId || undefined,
      statuses: ["COMPLETED"],
      search: search.trim() || undefined,
      page: 1,
      pageSize: 30,
    },
    { enabled: canLoadRegisterScopedData, refetchOnWindowFocus: true },
  );

  const saleDetailQuery = trpc.pos.sales.get.useQuery(
    { saleId: returnSaleId ?? "" },
    { enabled: Boolean(returnSaleId), refetchOnWindowFocus: true },
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
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const selectedSale = saleDetailQuery.data;
  const selectedSaleIdForReturn = saleDetailQuery.data?.id;
  const selectedSaleLinesForReturn = saleDetailQuery.data?.lines;
  const isReturnMutationBusy =
    createReturnMutation.isLoading ||
    addReturnLineMutation.isLoading ||
    completeReturnMutation.isLoading;
  const canRetryKkm = session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";

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
      return "bg-success text-success-foreground";
    }
    if (status === "FAILED") {
      return "bg-danger text-danger-foreground";
    }
    return "bg-warning text-warning-foreground";
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

  return (
    <div className="space-y-6">
      <PageHeader title={t("history.title")} subtitle={t("history.subtitle")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("entry.register")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
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
              {(registersQuery.data ?? []).length ? t("entry.selectRegisterFirst") : t("entry.noRegisters")}
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
                    {t("history.returnedTotal")}: {formatCurrencyKGS(sale.returnedTotalKgs, locale)}
                  </p>
                ) : null}
                <div className="mt-1">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${kkmStatusClassName(
                      sale.kkmStatus,
                    )}`}
                  >
                    {t("history.kkmStatusLabel")}: {kkmStatusLabel(sale.kkmStatus)}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <p className="text-sm font-semibold text-foreground">
                  {formatCurrencyKGS(sale.totalKgs, locale)}
                </p>
                <Button
                  variant="secondary"
                  onClick={() => setReturnSaleId(sale.id)}
                  disabled={
                    sale.status !== "COMPLETED" ||
                    ((sale.returnedTotalKgs ?? 0) > 0 && sale.returnedTotalKgs >= sale.totalKgs - 0.009)
                  }
                >
                  {t("history.return")}
                </Button>
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

          {canLoadRegisterScopedData && !salesQuery.isLoading && !(salesQuery.data?.items ?? []).length ? (
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
              {(registersQuery.data ?? []).length ? t("entry.selectRegisterFirst") : t("entry.noRegisters")}
            </p>
          ) : null}

          {(returnsQuery.data?.items ?? []).map((item) => (
            <div key={item.id} className="rounded-md border border-border bg-card p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-foreground">{item.number}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.originalSale.number} · {formatCurrencyKGS(item.totalKgs, locale)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.completedAt
                      ? formatDateTime(item.completedAt, locale)
                      : formatDateTime(item.createdAt, locale)}
                  </p>
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                    item.status === "COMPLETED"
                      ? "bg-success text-success-foreground"
                      : item.status === "CANCELED"
                        ? "bg-danger text-danger-foreground"
                        : "bg-warning text-warning-foreground"
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

      <Modal
        open={Boolean(returnSaleId)}
        onOpenChange={(open) => {
          if (!open) {
            setReturnSaleId(null);
          }
        }}
        title={t("history.returnDialogTitle")}
        subtitle={selectedSale ? t("history.returnDialogDescription", { number: selectedSale.number }) : ""}
      >
        <div className="space-y-4">
          {(selectedSale?.lines ?? []).map((line) => (
            <div key={line.id} className="rounded-md border border-border bg-card p-3">
              <p className="text-sm font-medium text-foreground">{line.product.name}</p>
              <p className="text-xs text-muted-foreground">
                {line.qty} × {formatCurrencyKGS(line.unitPriceKgs, locale)}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("history.availableQty")}: {Math.max(0, line.qty - (alreadyReturnedByLine[line.id] ?? 0))}
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
            <Select value={refundMethod} onValueChange={(value) => setRefundMethod(value as PosPaymentMethod)}>
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
            {t("history.returnTotal")}: {formatCurrencyKGS(returnTotal, locale)}
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => setReturnSaleId(null)}
              disabled={isReturnMutationBusy}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              onClick={handleStartReturn}
              disabled={isReturnMutationBusy}
            >
              {isReturnMutationBusy ? <Spinner className="h-4 w-4" /> : null}
              {t("history.completeReturn")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default PosHistoryPage;

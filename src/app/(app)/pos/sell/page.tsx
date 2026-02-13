"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PosPaymentMethod } from "@prisma/client";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { AddIcon, DeleteIcon } from "@/components/icons";
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
import { formatCurrencyKGS } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const selectedRegisterKey = "pos:selected-register";

const createIdempotencyKey = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `pos-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

type PaymentDraft = {
  method: PosPaymentMethod;
  amount: string;
  providerRef: string;
};

const defaultPayment = (amount = ""): PaymentDraft => ({
  method: PosPaymentMethod.CASH,
  amount,
  providerRef: "",
});

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
  const [qtyInput, setQtyInput] = useState("1");
  const [payments, setPayments] = useState<PaymentDraft[]>([defaultPayment()]);

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

  const searchTerm = lineSearch.trim();
  const hasSearchTerm = searchTerm.length >= 1;
  const productSearchQuery = trpc.products.searchQuick.useQuery(
    { q: searchTerm },
    { enabled: hasSearchTerm },
  );

  const createDraftMutation = trpc.pos.sales.createDraft.useMutation({
    onSuccess: (sale) => {
      setSaleId(sale.id);
      setPayments([defaultPayment()]);
      toast({ variant: "success", description: t("sell.saleCreated") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const addLineMutation = trpc.pos.sales.addLine.useMutation({
    onSuccess: () => {
      setLineSearch("");
      setQtyInput("1");
      toast({ variant: "success", description: t("sell.lineAdded") });
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

  const cancelDraftMutation = trpc.pos.sales.cancelDraft.useMutation({
    onSuccess: async () => {
      toast({ variant: "success", description: t("sell.saleDiscarded") });
      setSaleId(null);
      setLineSearch("");
      setQtyInput("1");
      setPayments([defaultPayment()]);
      await Promise.all([activeDraftQuery.refetch(), trpcUtils.pos.sales.list.invalidate()]);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const completeMutation = trpc.pos.sales.complete.useMutation({
    onSuccess: async (result) => {
      toast({ variant: "success", description: t("sell.completeSuccess", { number: result.number }) });
      setSaleId(null);
      setPayments([defaultPayment()]);
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
  const saleIdForPaymentInit = saleQuery.data?.id;
  const saleTotalForPaymentInit = saleQuery.data?.totalKgs;

  useEffect(() => {
    if (!saleIdForPaymentInit || saleTotalForPaymentInit === undefined) {
      return;
    }
    setPayments([defaultPayment(String(saleTotalForPaymentInit))]);
  }, [saleIdForPaymentInit, saleTotalForPaymentInit]);

  useEffect(() => {
    setSaleId(null);
    setLineSearch("");
    setQtyInput("1");
    setPayments([defaultPayment()]);
  }, [registerId]);

  useEffect(() => {
    if (!saleId || saleQuery.isLoading || saleQuery.data !== null) {
      return;
    }
    setSaleId(null);
    setPayments([defaultPayment()]);
  }, [saleId, saleQuery.data, saleQuery.isLoading]);

  const hasOpenShift = Boolean(shiftQuery.data?.id);
  const isLineBusy =
    createDraftMutation.isLoading ||
    addLineMutation.isLoading ||
    updateLineMutation.isLoading ||
    removeLineMutation.isLoading ||
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

  const handleAddLine = async (productId: string) => {
    if (!registerId) {
      return;
    }
    const qty = Math.trunc(Number(qtyInput));
    if (!Number.isFinite(qty) || qty <= 0) {
      toast({ variant: "error", description: t("sell.qtyPositive") });
      return;
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
        qty,
      });
      await trpcUtils.pos.sales.get.invalidate({ saleId: targetSaleId });
      await trpcUtils.pos.sales.list.invalidate();
    } catch {
      // handled by mutation onError
    }
  };

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

  const handleComplete = async () => {
    if (!saleId || !sale) {
      return;
    }

    const normalized = payments
      .map((payment) => ({
        method: payment.method,
        amountKgs: roundMoney(Number(payment.amount)),
        providerRef: payment.providerRef.trim() || null,
      }))
      .filter((payment) => Number.isFinite(payment.amountKgs) && payment.amountKgs > 0);

    if (!normalized.length) {
      toast({ variant: "error", description: t("sell.paymentRequired") });
      return;
    }

    if (Math.abs(roundMoney(totalPayment - sale.totalKgs)) > 0.009) {
      toast({ variant: "error", description: t("sell.paymentMismatch") });
      return;
    }

    try {
      await completeMutation.mutateAsync({
        saleId,
        idempotencyKey: createIdempotencyKey(),
        payments: normalized,
      });
    } catch {
      // handled by mutation onError
    }
  };

  const addPaymentRow = () => {
    setPayments((current) => [...current, defaultPayment()]);
  };

  const removePaymentRow = (index: number) => {
    setPayments((current) => (current.length <= 1 ? current : current.filter((_, i) => i !== index)));
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

  return (
    <div className="space-y-6">
      <PageHeader title={t("sell.title")} subtitle={t("sell.subtitle")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("sell.registerAndShift")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t("entry.register")}</p>
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
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={hasOpenShift ? "success" : "warning"}>
              {hasOpenShift ? t("entry.shiftOpen") : t("entry.shiftClosed")}
            </Badge>
            {!hasOpenShift && registerId ? (
              <Button variant="secondary" asChild>
                <Link href={`/pos?registerId=${registerId}`}>{t("sell.openShiftFirst")}</Link>
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {!hasOpenShift ? null : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t("sell.saleTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {saleId ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/20 p-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">{t("sell.saleNumber")}: </span>
                    <span className="font-semibold text-foreground">{sale?.number}</span>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleDiscardSale}
                    disabled={isLineBusy || completeMutation.isLoading}
                  >
                    {cancelDraftMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                    {t("sell.discardSale")}
                  </Button>
                </div>
              ) : (
                <>
                  {activeDraft ? (
                    <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
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
                  ) : (
                    <div className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                      {t("sell.startByAddingProduct")}
                    </div>
                  )}
                </>
              )}

              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">{t("sell.addItem")}</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={lineSearch}
                    onChange={(event) => setLineSearch(event.target.value)}
                    placeholder={t("sell.searchProduct")}
                  />
                  <Input
                    value={qtyInput}
                    onChange={(event) => setQtyInput(event.target.value)}
                    inputMode="numeric"
                    className="w-full sm:w-24"
                  />
                </div>

                {!hasSearchTerm ? (
                  <p className="text-xs text-muted-foreground">{t("sell.searchHint")}</p>
                ) : null}
                {hasSearchTerm && productSearchQuery.isFetching ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner className="h-4 w-4" />
                    {tCommon("loading")}
                  </div>
                ) : null}
                {hasSearchTerm &&
                !productSearchQuery.isFetching &&
                !(productSearchQuery.data ?? []).length ? (
                  <p className="text-xs text-muted-foreground">{t("sell.noSearchResults")}</p>
                ) : null}
                {(productSearchQuery.data ?? []).slice(0, 8).map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => handleAddLine(product.id)}
                    disabled={isLineBusy || completeMutation.isLoading}
                    className="flex w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-left text-sm transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span>
                      {product.name} <span className="text-muted-foreground">({product.sku})</span>
                    </span>
                    {isLineBusy ? <Spinner className="h-4 w-4" /> : <AddIcon className="h-4 w-4" aria-hidden />}
                  </button>
                ))}
              </div>

              {saleId ? (
                <>
                  {saleQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Spinner className="h-4 w-4" />
                      {tCommon("loading")}
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">{t("sell.lines")}</p>
                    {(sale?.lines ?? []).map((line) => (
                      <div
                        key={line.id}
                        className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {line.product.name}
                            {line.product.isBundle ? ` · ${t("sell.bundle")}` : ""}
                          </p>
                          <p className="text-xs text-muted-foreground">{line.product.sku}</p>
                          <p className="text-xs text-muted-foreground">
                            {t("sell.unitPrice")}: {formatCurrencyKGS(line.unitPriceKgs, locale)}
                          </p>
                        </div>
                        <div className="flex w-full items-center gap-2 sm:w-auto">
                          <Input
                            defaultValue={String(line.qty)}
                            onBlur={(event) => handleUpdateQty(line.id, event.target.value)}
                            className="h-9 w-full sm:w-20"
                            inputMode="numeric"
                            disabled={isLineBusy || completeMutation.isLoading}
                          />
                          <p className="sm:min-w-[100px] sm:text-right text-sm font-medium text-foreground">
                            {formatCurrencyKGS(line.lineTotalKgs, locale)}
                          </p>
                          <Button
                            variant="secondary"
                            size="icon"
                            onClick={() => handleRemoveLine(line.id)}
                            disabled={isLineBusy || completeMutation.isLoading}
                            aria-label={tCommon("delete")}
                          >
                            <DeleteIcon className="h-4 w-4" aria-hidden />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {!saleQuery.isLoading && !(sale?.lines ?? []).length ? (
                      <p className="text-xs text-muted-foreground">{t("sell.noLinesYet")}</p>
                    ) : null}
                  </div>

                  <div className="rounded-md border border-border bg-muted/20 p-3 text-sm font-semibold text-foreground">
                    {t("sell.orderTotal")}: {formatCurrencyKGS(sale?.totalKgs ?? 0, locale)}
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>

          {saleId && sale ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("sell.paymentsTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {payments.map((payment, index) => (
                  <div key={`${index}-${payment.method}`} className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
                    <Select
                      value={payment.method}
                      onValueChange={(value) =>
                        setPayments((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, method: value as PosPaymentMethod } : item,
                          ),
                        )
                      }
                    >
                      <SelectTrigger aria-label={t("sell.paymentMethod")}> 
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={PosPaymentMethod.CASH}>{t("payments.cash")}</SelectItem>
                        <SelectItem value={PosPaymentMethod.CARD}>{t("payments.card")}</SelectItem>
                        <SelectItem value={PosPaymentMethod.TRANSFER}>{t("payments.transfer")}</SelectItem>
                        <SelectItem value={PosPaymentMethod.OTHER}>{t("payments.other")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={payment.amount}
                      onChange={(event) =>
                        setPayments((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, amount: event.target.value } : item,
                          ),
                        )
                      }
                      placeholder={t("sell.paymentAmount")}
                      inputMode="decimal"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full sm:w-auto"
                      onClick={() => removePaymentRow(index)}
                      disabled={payments.length <= 1 || isLineBusy || completeMutation.isLoading}
                    >
                      {tCommon("delete")}
                    </Button>
                  </div>
                ))}

                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <Button
                    variant="secondary"
                    className="w-full sm:w-auto"
                    onClick={addPaymentRow}
                    disabled={isLineBusy || completeMutation.isLoading}
                  >
                    {t("sell.addPayment")}
                  </Button>
                  <Button
                    className="w-full sm:w-auto"
                    onClick={handleComplete}
                    disabled={completeMutation.isLoading || isLineBusy || !sale.lines.length}
                  >
                    {completeMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                    {t("sell.completeSale")}
                  </Button>
                </div>

                <p className="text-sm text-muted-foreground">
                  {t("sell.paymentTotal")}: {formatCurrencyKGS(totalPayment, locale)}
                </p>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
};

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export default PosSellPage;

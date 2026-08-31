"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PosPaymentMethod } from "@prisma/client";
import { useLocale, useTranslations } from "next-intl";

import { AddIcon, DeleteIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import {
  currencySourceWithFallback,
  displayMoneyFromKgs,
  displayMoneyToKgs,
  formatKgsMoney,
} from "@/lib/currencyDisplay";
import { formatDateTime } from "@/lib/i18nFormat";
import { parseMoneyInput } from "@/lib/moneyInput";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const paymentMethods = [
  PosPaymentMethod.CASH,
  PosPaymentMethod.CARD,
  PosPaymentMethod.TRANSFER,
  PosPaymentMethod.OTHER,
] as const;

type PaymentRow = {
  id: string;
  method: PosPaymentMethod;
  amount: string;
  providerRef: string;
};

const createIdempotencyKey = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `pos-payment-correction-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const createRowId = () => createIdempotencyKey().replace(/[^a-zA-Z0-9_-]/g, "");

export const PosPaymentCorrectionModal = ({
  saleId,
  onOpenChange,
  onCorrected,
}: {
  saleId: string | null;
  onOpenChange: (open: boolean) => void;
  onCorrected?: (saleId: string) => void | Promise<void>;
}) => {
  const t = useTranslations("pos");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { toast } = useToast();
  const trpcUtils = trpc.useUtils();
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [reason, setReason] = useState("");
  const hydratedSaleIdRef = useRef<string | null>(null);
  const idempotencyKeyRef = useRef(createIdempotencyKey());
  const submitInFlightRef = useRef(false);

  const saleQuery = trpc.pos.sales.get.useQuery(
    { saleId: saleId ?? "" },
    { enabled: Boolean(saleId), refetchOnWindowFocus: true },
  );
  const sale = saleQuery.data;
  const currencySource = currencySourceWithFallback(sale, sale?.store ?? null);

  useEffect(() => {
    if (!saleId) {
      hydratedSaleIdRef.current = null;
      setRows([]);
      setReason("");
      return;
    }
    if (!sale || sale.id !== saleId || hydratedSaleIdRef.current === saleId) {
      return;
    }
    hydratedSaleIdRef.current = saleId;
    idempotencyKeyRef.current = createIdempotencyKey();
    setReason("");
    setRows(
      sale.effectivePayments.map((payment) => ({
        id: createRowId(),
        method: payment.method,
        amount: String(displayMoneyFromKgs(payment.amountKgs, currencySource)),
        providerRef: "",
      })),
    );
  }, [currencySource, sale, saleId]);

  const correctionMutation = trpc.pos.sales.correctPayments.useMutation({
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const paymentTotalKgs = useMemo(
    () =>
      rows.reduce((sum, row) => {
        const displayAmount = parseMoneyInput(row.amount);
        if (displayAmount === null) {
          return sum;
        }
        return sum + displayMoneyToKgs(displayAmount, currencySource);
      }, 0),
    [currencySource, rows],
  );
  const totalMatches = sale
    ? Math.round(paymentTotalKgs * 100) === Math.round(sale.totalKgs * 100)
    : false;
  const methodsUnique = new Set(rows.map((row) => row.method)).size === rows.length;
  const allAmountsValid = rows.every((row) => {
    const value = parseMoneyInput(row.amount);
    return value !== null && value > 0;
  });
  const canSubmit = Boolean(
    sale?.paymentCorrectionEligibility.eligible &&
    rows.length > 0 &&
    methodsUnique &&
    allAmountsValid &&
    totalMatches &&
    reason.trim().length >= 3 &&
    !correctionMutation.isLoading,
  );

  const paymentMethodLabel = (method: PosPaymentMethod) => t(`payments.${method.toLowerCase()}`);
  const correctionSnapshot = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {
        payments: [] as Array<{ method: PosPaymentMethod; amountKgs: number }>,
        reason: null,
      };
    }
    const record = value as Record<string, unknown>;
    const source = Array.isArray(record.effectivePayments)
      ? record.effectivePayments
      : Array.isArray(record.payments)
        ? record.payments
        : [];
    const payments = source.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return [];
      }
      const payment = entry as Record<string, unknown>;
      if (
        !paymentMethods.includes(payment.method as PosPaymentMethod) ||
        typeof payment.amountKgs !== "number"
      ) {
        return [];
      }
      return [{ method: payment.method as PosPaymentMethod, amountKgs: payment.amountKgs }];
    });
    return {
      payments,
      reason: typeof record.reason === "string" ? record.reason : null,
    };
  };
  const correctionPaymentSummary = (value: unknown) => {
    const snapshot = correctionSnapshot(value);
    return snapshot.payments
      .map(
        (payment) =>
          `${paymentMethodLabel(payment.method)} ${formatKgsMoney(
            payment.amountKgs,
            locale,
            currencySource,
          )}`,
      )
      .join(" + ");
  };
  const eligibilityReason = sale?.paymentCorrectionEligibility.reason ?? "SALE_NOT_COMPLETED";

  const addPayment = () => {
    const used = new Set(rows.map((row) => row.method));
    const nextMethod = paymentMethods.find((method) => !used.has(method));
    if (!nextMethod) {
      return;
    }
    setRows((current) => [
      ...current,
      { id: createRowId(), method: nextMethod, amount: "", providerRef: "" },
    ]);
  };

  const submit = async () => {
    if (!saleId || !sale || !canSubmit || submitInFlightRef.current) {
      return;
    }
    submitInFlightRef.current = true;
    try {
      const payments = rows.map((row) => ({
        method: row.method,
        amountKgs: displayMoneyToKgs(parseMoneyInput(row.amount) ?? 0, currencySource),
        providerRef: row.providerRef.trim() || null,
      }));
      await correctionMutation.mutateAsync({
        saleId,
        payments,
        reason: reason.trim(),
        idempotencyKey: idempotencyKeyRef.current,
      });
      await Promise.all([
        trpcUtils.pos.sales.get.invalidate({ saleId }),
        trpcUtils.pos.sales.list.invalidate(),
        trpcUtils.pos.shifts.invalidate(),
      ]);
      await onCorrected?.(saleId);
      toast({ variant: "success", description: t("sell.paymentCorrection.saved") });
      onOpenChange(false);
    } finally {
      submitInFlightRef.current = false;
    }
  };

  return (
    <Modal
      open={Boolean(saleId)}
      onOpenChange={onOpenChange}
      title={t("sell.paymentCorrection.title")}
      subtitle={sale ? t("sell.paymentCorrection.subtitle", { number: sale.number }) : ""}
      className="max-w-2xl"
      mobileSheet
    >
      {saleQuery.isLoading ? (
        <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {tCommon("loading")}
        </div>
      ) : saleQuery.error ? (
        <div role="alert" className="bazaar-admin-error">
          {translateError(tErrors, saleQuery.error)}
        </div>
      ) : sale ? (
        <div className="space-y-4" data-testid="pos-payment-correction-dialog">
          <div className="grid gap-3 border border-border bg-muted/25 p-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-muted-foreground">{t("sell.paymentCorrection.receipt")}</p>
              <p className="font-semibold text-foreground">{sale.number}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t("sell.paymentCorrection.completedAt")}</p>
              <p
                className="font-semibold text-foreground"
                data-testid="pos-payment-correction-completed-at"
              >
                {formatDateTime(sale.completedAt ?? sale.createdAt, locale)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">{t("sell.paymentCorrection.total")}</p>
              <p className="font-semibold text-foreground">
                {formatKgsMoney(sale.totalKgs, locale, currencySource)}
              </p>
            </div>
          </div>

          {!sale.paymentCorrectionEligibility.eligible ? (
            <div role="alert" className="border border-warning/40 bg-warning/10 p-3 text-sm">
              <p className="font-semibold text-foreground">
                {t(`sell.paymentCorrection.reasons.${eligibilityReason}`)}
              </p>
              {eligibilityReason === "FISCAL_CORRECTION_REQUIRED" ? (
                <p className="mt-1 text-muted-foreground">
                  {t("sell.paymentCorrection.fiscalInstruction")}
                </p>
              ) : null}
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {rows.map((row, index) => {
                  const methodLabelId = `payment-correction-method-${row.id}`;
                  return (
                    <div
                      key={row.id}
                      className="grid gap-3 border border-border p-3 sm:grid-cols-[1fr_1fr_auto]"
                    >
                      <div className="space-y-1.5">
                        <span id={methodLabelId} className="text-sm font-medium text-foreground">
                          {t("sell.paymentCorrection.method", { index: index + 1 })}
                        </span>
                        <Select
                          value={row.method}
                          onValueChange={(value) =>
                            setRows((current) =>
                              current.map((item) =>
                                item.id === row.id
                                  ? { ...item, method: value as PosPaymentMethod }
                                  : item,
                              ),
                            )
                          }
                          disabled={correctionMutation.isLoading}
                        >
                          <SelectTrigger aria-labelledby={methodLabelId}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {paymentMethods.map((method) => (
                              <SelectItem
                                key={method}
                                value={method}
                                disabled={rows.some(
                                  (item) => item.id !== row.id && item.method === method,
                                )}
                              >
                                {paymentMethodLabel(method)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <label className="space-y-1.5 text-sm font-medium text-foreground">
                        <span>{t("sell.paymentCorrection.amount", { index: index + 1 })}</span>
                        <Input
                          value={row.amount}
                          onChange={(event) =>
                            setRows((current) =>
                              current.map((item) =>
                                item.id === row.id ? { ...item, amount: event.target.value } : item,
                              ),
                            )
                          }
                          inputMode="decimal"
                          disabled={correctionMutation.isLoading}
                        />
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="self-end"
                        aria-label={t("sell.paymentCorrection.removePayment", { index: index + 1 })}
                        onClick={() =>
                          setRows((current) => current.filter((item) => item.id !== row.id))
                        }
                        disabled={rows.length <= 1 || correctionMutation.isLoading}
                      >
                        <DeleteIcon className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  );
                })}
              </div>

              <Button
                type="button"
                variant="secondary"
                onClick={addPayment}
                disabled={rows.length >= paymentMethods.length || correctionMutation.isLoading}
              >
                <AddIcon className="h-4 w-4" aria-hidden />
                {t("sell.paymentCorrection.addPayment")}
              </Button>

              <label className="space-y-1.5 text-sm font-medium text-foreground">
                <span>{t("sell.paymentCorrection.reason")}</span>
                <Textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={t("sell.paymentCorrection.reasonPlaceholder")}
                  disabled={correctionMutation.isLoading}
                  required
                />
              </label>

              <div className="flex flex-wrap items-center justify-between gap-2 border border-border bg-muted/25 p-3 text-sm">
                <span className="text-muted-foreground">
                  {t("sell.paymentCorrection.paymentTotal")}
                </span>
                <span
                  className={
                    totalMatches ? "font-semibold text-success" : "font-semibold text-danger"
                  }
                >
                  {formatKgsMoney(paymentTotalKgs, locale, currencySource)} /{" "}
                  {formatKgsMoney(sale.totalKgs, locale, currencySource)}
                </span>
              </div>

              {!methodsUnique ? (
                <p role="alert" className="text-sm text-danger">
                  {t("sell.paymentCorrection.duplicateMethod")}
                </p>
              ) : null}
            </>
          )}

          {sale.paymentCorrections.length ? (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-sm font-semibold text-foreground">
                {t("sell.paymentCorrection.history")}
              </p>
              {sale.paymentCorrections.slice(0, 5).map((correction) => {
                const after = correctionSnapshot(correction.after);
                return (
                  <div
                    key={correction.id}
                    className="space-y-1 border border-border bg-muted/20 p-2 text-xs text-muted-foreground"
                  >
                    <p>
                      {formatDateTime(correction.createdAt, locale)} ·{" "}
                      {correction.actor?.name ?? correction.actor?.email ?? tCommon("notAvailable")}
                    </p>
                    <p className="text-foreground">
                      {correctionPaymentSummary(correction.before)} →{" "}
                      {correctionPaymentSummary(correction.after)}
                    </p>
                    {after.reason ? <p>{after.reason}</p> : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={correctionMutation.isLoading}
            >
              {tCommon("cancel")}
            </Button>
            {sale.paymentCorrectionEligibility.eligible ? (
              <Button
                type="button"
                onClick={() => void submit()}
                disabled={!canSubmit}
                data-testid="pos-payment-correction-submit"
              >
                {correctionMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                {t("sell.paymentCorrection.submit")}
              </Button>
            ) : null}
          </ModalFooter>
        </div>
      ) : null}
    </Modal>
  );
};

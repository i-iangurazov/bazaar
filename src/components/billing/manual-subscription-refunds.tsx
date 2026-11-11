"use client";

import { useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc";
import { formatCurrencyKGS, formatDate, formatDateTime } from "@/lib/i18nFormat";
import { businessDateKey } from "@/lib/timezone";
import { toPlanCode } from "@/lib/billing/plans";
import { translateError } from "@/lib/translateError";
import {
  manualRefundBankDateValid,
  manualRefundBankOperationValid,
  parseManualRefundAmountMinor,
} from "@/lib/billing/manualRefundInput";
import type { ManualSubscriptionRefundInvoiceSummary } from "@/server/billing/manualSubscriptionRefunds";
import { AddIcon, SearchIcon } from "@/components/icons";
import { QueryErrorState } from "@/components/query-error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { PriceInput } from "@/components/ui/price-input";
import { Textarea } from "@/components/ui/textarea";

type RefundAttempt = {
  invoiceId: string;
  amountMinor: number;
  bankOperationId: string;
  bankTransferredOn: string;
  reason: string;
  idempotencyKey: string;
  confirmed: true;
};

export function ManualSubscriptionRefunds({
  enabled,
  onRecorded,
}: {
  enabled: boolean;
  onRecorded?: () => void;
}) {
  const t = useTranslations("platformOwner.manualRefunds");
  const common = useTranslations("common");
  const errors = useTranslations("errors");
  const plans = useTranslations("platformOwner.plans");
  const locale = useLocale();
  const utils = trpc.useUtils();
  const [orderDraft, setOrderDraft] = useState("");
  const [searched, setSearched] = useState("");
  const [selected, setSelected] = useState<ManualSubscriptionRefundInvoiceSummary | null>(null);
  const [amount, setAmount] = useState("");
  const [bankOperationId, setBankOperationId] = useState("");
  const [bankTransferredOn, setBankTransferredOn] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [locked, setLocked] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const operationKey = useRef("");
  const attempt = useRef<RefundAttempt | null>(null);
  const inFlight = useRef(false);
  const query = trpc.platformOwner.refundInvoice.useQuery(
    { orderId: searched },
    {
      enabled: Boolean(enabled && searched),
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  );
  const record = trpc.platformOwner.recordManualRefund.useMutation({
    onSuccess: (invoice) => {
      inFlight.current = false;
      utils.platformOwner.refundInvoice.setData({ orderId: invoice.orderId }, invoice);
      setSelected(null);
      operationKey.current = "";
      attempt.current = null;
      setLocked(false);
      setNotice(t("recorded"));
      void query.refetch();
      onRecorded?.();
    },
    onError: (error) => {
      inFlight.current = false;
      setFormError(translateError(errors, error));
    },
  });
  const invoice = query.data;
  const money = (minor: number) => formatCurrencyKGS(minor / 100, locale);
  const amountMinor = parseManualRefundAmountMinor(amount);
  const amountValid =
    amountMinor !== null &&
    Boolean(selected) &&
    amountMinor <= (selected?.remainingRefundableMinor ?? 0);
  const dateValid =
    Boolean(selected) && manualRefundBankDateValid(bankTransferredOn, selected?.paidAt ?? "");
  const bankValid = manualRefundBankOperationValid(bankOperationId);
  const reasonValid = reason.trim().length >= 10 && reason.trim().length <= 500;
  const close = () => {
    if (record.isLoading || inFlight.current) return;
    setSelected(null);
    operationKey.current = "";
    attempt.current = null;
    setLocked(false);
    setConfirmed(false);
    setFormError("");
    record.reset();
  };
  const open = () => {
    if (!invoice || query.isFetching || invoice.remainingRefundableMinor <= 0) return;
    try {
      operationKey.current = crypto.randomUUID();
    } catch {
      setNotice(errors("billingManualRefundIdempotencyInvalid"));
      return;
    }
    setSelected(invoice);
    setAmount("");
    setBankOperationId("");
    setBankTransferredOn("");
    setReason("");
    setConfirmed(false);
    setLocked(false);
    setFormError("");
    setNotice("");
    attempt.current = null;
    record.reset();
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!enabled || !selected || !confirmed || inFlight.current || record.isLoading) return;
    if (!attempt.current) {
      const issue = !amountValid
        ? "billingManualRefundAmountInvalid"
        : !bankValid
          ? "billingManualRefundBankOperationInvalid"
          : !dateValid
            ? "billingManualRefundDateInvalid"
            : !reasonValid
              ? "billingManualRefundReasonInvalid"
              : null;
      if (issue || amountMinor === null) {
        setFormError(errors(issue ?? "billingManualRefundAmountInvalid"));
        return;
      }
      attempt.current = {
        invoiceId: selected.invoiceId,
        amountMinor,
        bankOperationId: bankOperationId.trim(),
        bankTransferredOn,
        reason: reason.trim(),
        idempotencyKey: operationKey.current,
        confirmed: true,
      };
      setLocked(true);
    }
    setFormError("");
    inFlight.current = true;
    record.mutate(attempt.current);
  };
  if (!enabled) return null;
  return (
    <Card data-manual-subscription-refunds>
      <CardHeader className="gap-2">
        <CardTitle>{t("title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = orderDraft.trim();
            if (!value || query.isFetching) return;
            setNotice("");
            if (value === searched) void query.refetch();
            else setSearched(value);
          }}
        >
          <Label htmlFor="manual-refund-order">{t("orderId")}</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="manual-refund-order"
              value={orderDraft}
              onChange={(event) => setOrderDraft(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              maxLength={128}
              required
              className="min-w-0 flex-1 font-mono"
            />
            <Button
              type="submit"
              variant="secondary"
              disabled={!orderDraft.trim() || query.isFetching}
            >
              <SearchIcon className="h-4 w-4" aria-hidden />
              {common("search")}
            </Button>
          </div>
        </form>
        {notice ? (
          <p role="status" className="text-sm">
            {notice}
          </p>
        ) : null}
        {!searched ? (
          <p className="text-sm text-muted-foreground">{t("searchHint")}</p>
        ) : query.isFetching ? (
          <p role="status" className="text-sm">
            {common("loading")}
          </p>
        ) : query.error ? (
          <QueryErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : invoice ? (
          <section
            className="min-w-0 space-y-4 rounded-md border border-input p-3"
            aria-label={t("invoiceTitle")}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="break-words font-semibold">{invoice.organization.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {plans(`${toPlanCode(invoice.plan).toLowerCase()}.name`)}
                </p>
              </div>
              {invoice.refundedMinor > 0 ? (
                <Badge variant="warning">
                  {t(invoice.remainingRefundableMinor === 0 ? "full" : "partial")}
                </Badge>
              ) : null}
            </div>
            <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">{t("paidAmount")}</dt>
                <dd className="font-semibold">{money(invoice.amountMinor)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("refundedAmount")}</dt>
                <dd className="font-semibold">{money(invoice.refundedMinor)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("remainingAmount")}</dt>
                <dd className="font-semibold">{money(invoice.remainingRefundableMinor)}</dd>
              </div>
              <div className="min-w-0 sm:col-span-3">
                <dt className="text-muted-foreground">{t("orderId")}</dt>
                <dd className="break-all font-mono">{invoice.orderId}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("paidAt")}</dt>
                <dd>{formatDateTime(invoice.paidAt, locale)}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">{t("period")}</dt>
                <dd>
                  {formatDate(invoice.period.startsAt, locale)} —{" "}
                  {formatDate(invoice.period.endsAt, locale)}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">{t("accessUnchanged")}</p>
            <Button
              type="button"
              variant="secondary"
              onClick={open}
              disabled={invoice.remainingRefundableMinor <= 0}
            >
              <AddIcon className="h-4 w-4" aria-hidden />
              {t("recordAction")}
            </Button>
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">{t("history")}</h4>
              {invoice.refunds.length ? (
                <ul className="space-y-2">
                  {invoice.refunds.map((refund) => (
                    <li
                      key={refund.id}
                      className="min-w-0 space-y-2 rounded-md border border-input p-3 text-sm"
                    >
                      <p className="font-medium">
                        {money(refund.amountMinor)} ·{" "}
                        {formatDate(`${refund.bankTransferredOn}T00:00:00.000Z`, locale)}
                      </p>
                      <p className="break-all">
                        <span className="text-muted-foreground">{t("bankOperationId")}: </span>
                        {refund.bankOperationId}
                      </p>
                      <p className="whitespace-pre-wrap break-words">{refund.reason}</p>
                      <p className="break-all text-xs text-muted-foreground">
                        {t("recordedBy", {
                          actor: refund.recordedById,
                          date: formatDateTime(refund.createdAt, locale),
                        })}
                      </p>
                      <p className="text-xs text-muted-foreground">{t("proofType")}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("empty")}</p>
              )}
            </div>
          </section>
        ) : (
          <p className="text-sm text-muted-foreground">{t("notFound")}</p>
        )}
        <Modal
          open={Boolean(selected)}
          onOpenChange={(isOpen) => {
            if (!isOpen) close();
          }}
          title={t("recordAction")}
          subtitle={t("modalHint")}
          className="sm:max-w-xl"
          bodyClassName="min-w-0"
        >
          {selected ? (
            <form onSubmit={submit} className="min-w-0 space-y-4">
              <p className="break-words text-sm font-medium">{selected.organization.name}</p>
              <p className="break-all font-mono text-xs">{selected.orderId}</p>
              <div className="space-y-2">
                <Label htmlFor="manual-refund-amount">{t("amount")}</Label>
                <PriceInput
                  id="manual-refund-amount"
                  value={amount}
                  maxLength={32}
                  required
                  disabled={locked || record.isLoading}
                  aria-describedby="manual-refund-amount-hint"
                  aria-invalid={amount !== "" && !amountValid}
                  onChange={(event) => setAmount(event.target.value)}
                />
                <p id="manual-refund-amount-hint" className="text-xs text-muted-foreground">
                  {t("amountHint", { amount: money(selected.remainingRefundableMinor) })}
                </p>
                {amount !== "" && !amountValid ? (
                  <p className="text-xs text-danger">
                    {errors("billingManualRefundAmountInvalid")}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="manual-refund-bank-operation">{t("bankOperationId")}</Label>
                <Input
                  id="manual-refund-bank-operation"
                  value={bankOperationId}
                  minLength={3}
                  maxLength={120}
                  required
                  disabled={locked || record.isLoading}
                  autoComplete="off"
                  onChange={(event) => setBankOperationId(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="manual-refund-bank-day">{t("bankTransferredOn")}</Label>
                <Input
                  id="manual-refund-bank-day"
                  type="date"
                  value={bankTransferredOn}
                  required
                  min={businessDateKey(new Date(selected.paidAt))}
                  max={businessDateKey(new Date())}
                  disabled={locked || record.isLoading}
                  className="min-w-0"
                  onChange={(event) => setBankTransferredOn(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("bankDateHint")}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="manual-refund-reason">{t("reason")}</Label>
                <Textarea
                  id="manual-refund-reason"
                  value={reason}
                  minLength={10}
                  maxLength={500}
                  required
                  disabled={locked || record.isLoading}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
              <div className="flex items-start gap-3">
                <Checkbox
                  id="manual-refund-confirmed"
                  checked={confirmed}
                  disabled={locked || record.isLoading}
                  onCheckedChange={(value) => setConfirmed(value === true)}
                />
                <Label htmlFor="manual-refund-confirmed" className="text-sm text-foreground">
                  {t("confirm")}
                </Label>
              </div>
              {locked ? <p className="text-xs text-muted-foreground">{t("retryHint")}</p> : null}
              {formError ? (
                <p role="alert" className="break-words text-sm text-danger">
                  {formError}
                </p>
              ) : null}
              <ModalFooter className="sticky bottom-0 z-10 bg-card">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={close}
                  disabled={record.isLoading}
                >
                  {common("cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={
                    record.isLoading ||
                    !confirmed ||
                    (!locked && (!amountValid || !dateValid || !bankValid || !reasonValid))
                  }
                >
                  {record.isLoading
                    ? common("loading")
                    : t(locked ? "retryRecord" : "recordAction")}
                </Button>
              </ModalFooter>
            </form>
          ) : null}
        </Modal>
      </CardContent>
    </Card>
  );
}

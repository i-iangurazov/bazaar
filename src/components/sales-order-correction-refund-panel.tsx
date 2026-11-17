"use client";

import { useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { formatKgsMoney } from "@/lib/currencyDisplay";
import type { currencySourceWithFallback } from "@/lib/currencyDisplay";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

type CurrencySource = ReturnType<typeof currencySourceWithFallback>;

export type CorrectionRefundQueueRequest = {
  id: string;
  status: "OPEN" | "RESOLVED" | "CANCELED";
  amountKgs: unknown;
  reviewedAt?: string | Date | null;
  reviewedBy?: { id: string; name: string } | null;
  payment?: {
    id: string;
    settlementStatus: "ACTUAL" | "OFFSET" | "PENDING" | "VOID";
    amountKgs: unknown;
    shiftId: string | null;
  } | null;
};

const createIdempotencyKey = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `correction-refund-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export function CorrectionRefundQueuePanel({
  customerOrderId,
  request,
  actualRefundedKgs,
  pendingRefundKgs,
  shifts,
  canManage,
  currency,
}: {
  customerOrderId: string;
  request: CorrectionRefundQueueRequest | null;
  actualRefundedKgs: number;
  pendingRefundKgs: number;
  shifts: Array<{ id: string; name: string }>;
  canManage: boolean;
  currency: CurrencySource;
}) {
  const t = useTranslations("salesOrders");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [shiftId, setShiftId] = useState(shifts[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"RESOLVED" | null>(null);
  const shiftSelectId = useId();
  const idempotencyRef = useRef<{ fingerprint: string; key: string } | null>(null);

  const money = (value: number) =>
    formatKgsMoney(value, locale, currency, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const mutation = trpc.salesOrders.resolveCorrectionRefund.useMutation({
    onSuccess: async (result) => {
      setError(null);
      toast({
        variant: "success",
        description:
          result.status === "RESOLVED"
            ? t("correctionRefundResolvedToast")
            : t("correctionRefundCanceledToast"),
      });
      await Promise.all([
        utils.salesOrders.getById.invalidate({ customerOrderId }),
        utils.salesOrders.paymentInfo.invalidate({ customerOrderId }),
      ]);
    },
    onError: (mutationError) => {
      setError(translateError(tErrors, mutationError));
      // A lost response may have committed the payout. Refetch the authoritative
      // state while preserving the idempotency key for an exactly-once retry.
      void Promise.all([
        utils.salesOrders.getById.invalidate({ customerOrderId }),
        utils.salesOrders.paymentInfo.invalidate({ customerOrderId }),
      ]);
    },
    onSettled: () => setPendingAction(null),
  });

  if (!request) return null;

  const selectedShiftId = shiftId || shifts[0]?.id || "";
  const isOpen = request.status === "OPEN";
  const hasPayableObligation =
    !isOpen ||
    Boolean(
      request.payment &&
        request.payment.settlementStatus === "PENDING" &&
        Math.abs(Number(request.payment.amountKgs) - Number(request.amountKgs)) < 0.005,
    );
  const statusLabel =
    request.status === "OPEN"
      ? t("correctionRefundStatusOpen")
      : request.status === "RESOLVED"
        ? t("correctionRefundStatusResolved")
        : t("correctionRefundStatusCanceled");

  const resolve = async () => {
    if (!selectedShiftId) return;
    const accepted = await confirm({
      title: t("correctionRefundConfirmTitle"),
      description: t("correctionRefundConfirmDescription", {
        amount: money(pendingRefundKgs),
      }),
      confirmLabel: t("correctionRefundConfirm"),
      cancelLabel: tCommon("cancel"),
      confirmVariant: "primary",
    });
    if (!accepted) return;
    setPendingAction("RESOLVED");
    setError(null);
    const fingerprint = `${request.id}:RESOLVED:${selectedShiftId}`;
    const idempotencyKey =
      idempotencyRef.current?.fingerprint === fingerprint
        ? idempotencyRef.current.key
        : createIdempotencyKey();
    idempotencyRef.current = { fingerprint, key: idempotencyKey };
    try {
      await mutation.mutateAsync({
        refundRequestId: request.id,
        action: "RESOLVED",
        shiftId: selectedShiftId,
        idempotencyKey,
      });
    } catch {
      // The mutation's onError renders the translated message below.
    }
  };

  return (
    <div
      className="mt-2 rounded-md border border-dashed border-border bg-secondary/30 p-2 text-xs"
      data-testid="sales-order-correction-refund"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-foreground">{statusLabel}</p>
        {request.reviewedAt && request.reviewedBy ? (
          <span className="text-muted-foreground">
            {t("correctionRefundReviewed", { name: request.reviewedBy.name })}
          </span>
        ) : null}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div>
          <p className="text-muted-foreground">{t("correctionRefundActual")}</p>
          <p className="font-medium tabular-nums">{money(actualRefundedKgs)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">{t("correctionRefundPendingAmount")}</p>
          <p className="font-medium tabular-nums">{money(pendingRefundKgs)}</p>
        </div>
      </div>
      {isOpen && canManage && hasPayableObligation ? (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1">
            <Label htmlFor={shiftSelectId} className="mb-1 text-muted-foreground">
              {t("correctionRefundShift")}
            </Label>
            <Select value={selectedShiftId} onValueChange={setShiftId}>
              <SelectTrigger id={shiftSelectId} className="h-8 text-xs">
                <SelectValue placeholder={t("correctionRefundShiftPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {shifts.map((shift) => (
                  <SelectItem key={shift.id} value={shift.id}>
                    {shift.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {shifts.length ? null : (
              <p className="mt-1 text-muted-foreground">{t("correctionRefundNoShift")}</p>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            disabled={mutation.isPending || !selectedShiftId}
            onClick={() => void resolve()}
          >
            {pendingAction === "RESOLVED"
              ? t("correctionRefundConfirming")
              : t("correctionRefundConfirm")}
          </Button>

        </div>
      ) : null}
      {isOpen && canManage && hasPayableObligation ? (
        <p className="mt-2 text-muted-foreground">{t("correctionRefundCannotCancel")}</p>
      ) : null}
      {isOpen && !canManage ? (
        <p className="mt-2 text-muted-foreground">{t("correctionRefundManagerOnly")}</p>
      ) : null}
      {isOpen && !hasPayableObligation ? (
        <p className="mt-2 text-warning" data-testid="correction-refund-unavailable">
          {t("correctionRefundUnavailable")}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {confirmDialog}
    </div>
  );
}

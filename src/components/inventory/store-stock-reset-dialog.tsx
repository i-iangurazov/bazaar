"use client";

import { useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { FormActions } from "@/components/form-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { formatNumber } from "@/lib/i18nFormat";
import { translateError } from "@/lib/translateError";
import { trpc } from "@/lib/trpc";

export function StoreStockResetDialog({
  store,
  onClose,
}: {
  store: { id: string; name: string };
  onClose: () => void;
}) {
  const t = useTranslations("inventory");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const reasonId = useId();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [reason, setReason] = useState("");
  const [confirmedToken, setConfirmedToken] = useState<string | null>(null);
  const operationRef = useRef<{ token: string; reason: string; key: string } | null>(null);
  const submitting = useRef(false);
  const preview = trpc.inventory.previewStoreStockReset.useQuery({ storeId: store.id }, {
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false,
  });
  const reset = trpc.inventory.resetStoreStock.useMutation({ retry: false });
  const data = preview.data;
  const previewStale = reset.error?.message === "inventoryStoreResetPreviewStale";
  const ready = Boolean(data && data.storeId === store.id && !preview.isError && !preview.isFetching);
  const confirmed = Boolean(!previewStale && data && confirmedToken === data.previewToken);
  const busy = reset.isLoading;

  const handleReset = async () => {
    const trimmedReason = reason.trim();
    if (!ready || !data || !confirmed || previewStale || submitting.current || trimmedReason.length < 3) return;

    const previous = operationRef.current;
    const key = previous?.token === data.previewToken && previous.reason === trimmedReason
      ? previous.key
      : crypto.randomUUID();
    operationRef.current = { token: data.previewToken, reason: trimmedReason, key };
    submitting.current = true;
    try {
      const result = await reset.mutateAsync({
        storeId: store.id,
        reason: trimmedReason,
        previewToken: data.previewToken,
        idempotencyKey: key,
      });
      toast({
        variant: "success",
        description: t("storeResetSuccess", { store: store.name, count: result.updatedCount }),
      });
      onClose();
      void Promise.all([
        utils.inventory.invalidate(),
        utils.products.bootstrap.invalidate(),
        utils.stockLots.expiringSoon.invalidate(),
      ]);
    } catch {
      // Display the error beside the confirmation and retain the operation for retry.
    } finally {
      submitting.current = false;
    }
  };

  const refreshPreview = () => {
    setConfirmedToken(null);
    reset.reset();
    void preview.refetch();
  };

  return (
    <Modal
      open
      onOpenChange={(open) => { if (!open && !submitting.current) onClose(); }}
      title={t("storeResetTitle")}
      subtitle={t("storeResetStore", { store: store.name })}
      mobileSheet
    >
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void handleReset(); }}>
        <p className="text-sm leading-5 text-muted-foreground">{t("storeResetScope")}</p>
        {preview.isFetching ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" />
            {tCommon("loading")}
          </p>
        ) : ready && data ? (
          <dl className="space-y-2 rounded-lg border border-border bg-muted/20 p-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt>{t("storeResetBalances")}</dt>
              <dd className="font-semibold tabular-nums">{formatNumber(data.nonZeroCount, locale)}</dd>
            </div>
            {data.hiddenNonZeroCount > 0 ? (
              <div className="flex items-baseline justify-between gap-3 text-muted-foreground">
                <dt>{t("storeResetHiddenBalances")}</dt>
                <dd className="tabular-nums">{formatNumber(data.hiddenNonZeroCount, locale)}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        <p className="text-sm leading-5 text-muted-foreground">
          {data?.nonZeroCount === 0 ? t("storeResetEmpty") : t("storeResetCounts")}
        </p>

        {preview.error || reset.error ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-danger">
              {translateError(tErrors, preview.error ?? reset.error)}
            </p>
            {preview.error || previewStale ? (
              <Button type="button" variant="secondary" size="sm" onClick={refreshPreview}>
                {t("storeResetRefresh")}
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-2">
          <label htmlFor={reasonId} className="text-sm font-medium">{t("reason")}</label>
          <Input
            id={reasonId}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("bulkOnHandReasonPlaceholder")}
            minLength={3}
            maxLength={500}
            required
            disabled={busy}
          />
        </div>
        <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm leading-5">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmedToken(event.target.checked ? data?.previewToken ?? null : null)}
            disabled={!ready || previewStale || busy}
            className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
          />
          {t("storeResetConfirm", { store: store.name })}
        </label>
        <FormActions>
          <Button type="button" variant="secondary" className="w-full sm:w-auto" disabled={busy} onClick={onClose}>
            {tCommon("cancel")}
          </Button>
          <Button
            type="submit"
            variant="danger"
            className="w-full sm:w-auto"
            disabled={!ready || !confirmed || previewStale || busy || reason.trim().length < 3}
          >
            {busy ? <Spinner className="h-4 w-4" /> : null}
            {busy ? tCommon("loading") : t("storeResetSubmit")}
          </Button>
        </FormActions>
      </form>
    </Modal>
  );
}

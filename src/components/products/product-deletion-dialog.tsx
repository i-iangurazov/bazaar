"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { QueryErrorState } from "@/components/query-error-state";

/** Global deletion is deliberately separate from hiding a product in one store. */
export function ProductDeletionDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  onDeleted: () => void;
}) {
  const t = useTranslations("productDeletion"),
    common = useTranslations("common"),
    errors = useTranslations("errors");
  const utils = trpc.useUtils();
  const preview = trpc.products.deletionPreview.useQuery(
    { productId: props.productId },
    { enabled: props.open, retry: false, refetchOnWindowFocus: false },
  );
  const mutation = trpc.products.deletePermanent.useMutation();
  const [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState<{
    productId: string;
    reviewToken: string;
    idempotencyKey: string;
  } | null>(null);
  useEffect(() => {
    if (props.open) {
      setConfirmed(false);
      setError(null);
      setAttempt(null);
    }
  }, [props.open, props.productId]);
  async function remove() {
    if (!preview.data?.canDelete || !confirmed) return;
    const request = attempt ?? {
      productId: props.productId,
      reviewToken: preview.data.token,
      idempotencyKey: crypto.randomUUID(),
    };
    setAttempt(request);
    setError(null);
    try {
      await mutation.mutateAsync(request);
      props.onDeleted();
      props.onOpenChange(false);
      await Promise.allSettled([utils.products.invalidate(), utils.inventory.invalidate()]);
    } catch (e) {
      setError(e);
      if (
        e instanceof Error &&
        ["productDeletionStale", "productDeleteBlockedByHistory", "priceBookProductInUse"].includes(
          e.message,
        )
      ) {
        setAttempt(null);
        setConfirmed(false);
        await preview.refetch();
      }
    }
  }
  return (
    <Modal
      open={props.open}
      onOpenChange={(open) => {
        if (!mutation.isLoading) props.onOpenChange(open);
      }}
      title={t("title")}
      subtitle={preview.data ? `${preview.data.productName} · ${preview.data.sku}` : undefined}
    >
      <div className="space-y-4">
        {preview.isLoading ? (
          <div role="status" className="flex items-center gap-2">
            <Spinner />
            {common("loading")}
          </div>
        ) : preview.error ? (
          <QueryErrorState onRetry={() => void preview.refetch()} />
        ) : preview.data ? (
          <>
            <p className="text-sm">{t("globalHint")}</p>
            <div className="rounded-md border border-border p-3 text-sm">
              <p className="font-medium">{t("stores")}</p>
              <p className="mt-1 break-words text-muted-foreground">
                {preview.data.stores.map((s) => s.name).join(", ") || t("noStores")}
              </p>
            </div>
            {!preview.data.canDelete ? (
              <div
                role="status"
                className="space-y-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm"
              >
                <p className="font-medium">{t("blocked")}</p>
                <ul className="list-inside list-disc">
                  {preview.data.reasons.map((r) => (
                    <li key={r.key}>
                      {t(`reason.${r.key}`)}: {r.count}
                    </li>
                  ))}
                </ul>
                <p>{t("blockedHint")}</p>
              </div>
            ) : (
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={confirmed}
                  disabled={mutation.isLoading}
                  onCheckedChange={(checked) => setConfirmed(Boolean(checked))}
                />
                <span>{t("confirm")}</span>
              </label>
            )}
          </>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {translateError(errors, error as Parameters<typeof translateError>[1])}
          </p>
        ) : null}
        <ModalFooter>
          <Button
            variant="secondary"
            disabled={mutation.isLoading}
            onClick={() => props.onOpenChange(false)}
          >
            {common("cancel")}
          </Button>
          {preview.data?.canDelete ? (
            <Button
              variant="danger"
              disabled={!confirmed || mutation.isLoading || preview.isFetching}
              onClick={() => void remove()}
            >
              {mutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
              {t(attempt && error ? "retry" : "action")}
            </Button>
          ) : null}
        </ModalFooter>
      </div>
    </Modal>
  );
}

"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc";
import { formatCurrencyKGS, formatDateTime } from "@/lib/i18nFormat";
import { translateError } from "@/lib/translateError";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { QueryErrorState } from "@/components/query-error-state";

export function PaymentReviews({ enabled }: { enabled: boolean }) {
  const t = useTranslations("platformOwner.paymentReviews");
  const common = useTranslations("common");
  const errors = useTranslations("errors");
  const locale = useLocale();
  const query = trpc.platformOwner.paymentReviews.useQuery(undefined, { enabled });
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const recheck = trpc.platformOwner.recheckPayment.useMutation({
    onSuccess: () => void query.refetch(),
    onError: (e) => setError(translateError(errors, e)),
  });
  const resolve = trpc.platformOwner.resolvePaymentReview.useMutation({
    onSuccess: () => {
      setSelected(null);
      void query.refetch();
    },
    onError: (e) => setError(translateError(errors, e)),
  });
  if (!enabled) return null;
  return (
    <Card data-payment-reviews>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        {query.isLoading ? (
          <p>{common("loading")}</p>
        ) : query.isError ? (
          <QueryErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : query.data?.length ? (
          <ul className="space-y-3">
            {query.data.map((invoice) => (
              <li key={invoice.id} className="space-y-2 rounded-md border border-input p-3">
                <p className="break-words font-medium">
                  {invoice.organization.name} ·{" "}
                  {formatCurrencyKGS(invoice.amountMinor / 100, locale)}
                </p>
                <p className="break-all font-mono text-xs">{invoice.id}</p>
                <p className="text-sm text-muted-foreground">
                  {formatDateTime(invoice.createdAt, locale)} ·{" "}
                  {t(
                    invoice.reason === "REFUND_REVIEW"
                      ? "refund"
                      : invoice.reason === "PLAN_CHANGED"
                        ? "planChanged"
                        : "accessChanged",
                  )}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={recheck.isLoading}
                    onClick={() => {
                      setError("");
                      recheck.mutate({
                        organizationId: invoice.organization.id,
                        invoiceId: invoice.id,
                      });
                    }}
                  >
                    {t("recheck")}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSelected(invoice.id);
                      setNote("");
                      setConfirmed(false);
                      setError("");
                    }}
                  >
                    {t("resolve")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        )}
        <p role="status" className="text-sm text-danger">
          {error}
        </p>
        <Modal
          open={Boolean(selected)}
          onOpenChange={(open) => {
            if (!open && !resolve.isLoading) setSelected(null);
          }}
          title={t("resolveTitle")}
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (selected && confirmed && note.trim().length >= 10 && !resolve.isLoading)
                resolve.mutate({ invoiceId: selected, note, confirmed: true });
            }}
          >
            <p className="text-sm text-muted-foreground">{t("resolveHint")}</p>
            <label className="block text-sm" htmlFor="payment-review-note">
              {t("note")}
            </label>
            <Textarea
              id="payment-review-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              minLength={10}
              maxLength={500}
              required
              disabled={resolve.isLoading}
            />
            <div className="flex items-start gap-3">
              <Checkbox
                id="payment-review-confirm"
                checked={confirmed}
                disabled={resolve.isLoading}
                onCheckedChange={(v) => setConfirmed(v === true)}
              />
              <label htmlFor="payment-review-confirm" className="text-sm">
                {t("confirm")}
              </label>
            </div>
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            <ModalFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={resolve.isLoading}
                onClick={() => setSelected(null)}
              >
                {common("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={!confirmed || note.trim().length < 10 || resolve.isLoading}
              >
                {resolve.isLoading ? common("loading") : t("resolve")}
              </Button>
            </ModalFooter>
          </form>
        </Modal>
      </CardContent>
    </Card>
  );
}

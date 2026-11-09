"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { trpc } from "@/lib/trpc";
import type { PlanCode } from "@/lib/billing/plans";
import { Button } from "@/components/ui/button";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { QueryErrorState } from "@/components/query-error-state";
import { formatCurrencyKGS } from "@/lib/i18nFormat";
import { translateError } from "@/lib/translateError";

export function TrialPreparation({ plan, onPrepared }: { plan: PlanCode; onPrepared: () => void }) {
  const t = useTranslations("billing.trialPreparation");
  const common = useTranslations("common");
  const errors = useTranslations("errors");
  const plans = useTranslations("billing.plans");
  const locale = useLocale();
  const utils = trpc.useUtils();
  const preview = trpc.billing.payments.trialPreparation.useQuery({ plan }, { retry: false });
  const [frozen, setFrozen] = useState<typeof preview.data>(undefined);
  const [frozenPlan, setFrozenPlan] = useState(plan);
  const [accepted, setAccepted] = useState(false);
  const [issue, setIssue] = useState("");
  const prepare = trpc.billing.payments.prepareTrial.useMutation({
    onSuccess: () => { setFrozen(undefined); setAccepted(false); void utils.invalidate(); onPrepared(); },
    onError: error => {
      setFrozen(undefined); setAccepted(false); setIssue(translateError(errors, error)); void preview.refetch();
    },
  });
  if (preview.isLoading) return <p role="status" className="text-sm text-muted-foreground">{common("loading")}</p>;
  if (preview.isError) return <QueryErrorState error={preview.error} onRetry={() => void preview.refetch()} />;
  return <div className="space-y-3">
    {issue ? <p role="alert" className="text-sm text-danger">{issue}</p> : null}
    <Button variant="secondary" disabled={!preview.data || prepare.isLoading} onClick={() => {
      setIssue(""); setAccepted(false); setFrozenPlan(plan); setFrozen(preview.data);
    }}>{t("action")}</Button>
    <Modal title={t("title")} open={Boolean(frozen)} onOpenChange={open => { if (!open && !prepare.isLoading) setFrozen(undefined); }}>
      {frozen ? <div className="space-y-4">
        <p className="text-sm font-medium">{plans(`${frozenPlan.toLowerCase()}.name`)}</p>
        <p className="text-sm">{t("description")}</p>
        <ul className="space-y-2 text-sm">
          <li>{t("stores", { count: frozen.counts.stores })}</li>
          <li>{t("bundles", { count: frozen.counts.bundles })}</li>
          <li>{t("loyalty", { count: frozen.counts.loyaltyPrograms })}</li>
          <li>{t("drafts", { count: frozen.counts.draftOrders })}</li>
          <li>{t("reservations", { count: frozen.counts.reservations })}</li>
        </ul>
        {frozen.draftChanges.length ? <div className="space-y-2 rounded-md border border-warning/40 p-3 text-sm">
          <p className="font-medium">{t("draftWarning")}</p>
          {frozen.draftChanges.map(order => <p key={order.orderId}>{order.number}: {formatCurrencyKGS(Number(order.beforeTotalKgs), locale)} → {formatCurrencyKGS(Number(order.afterTotalKgs), locale)}</p>)}
        </div> : null}
        <p className="text-sm text-muted-foreground">{t("preserved")}</p>
        <label className="flex items-start gap-3 text-sm">
          <Checkbox checked={accepted} onCheckedChange={value => setAccepted(value === true)} disabled={prepare.isLoading} />
          <span>{t("confirm")}</span>
        </label>
        <ModalFooter>
          <Button variant="secondary" disabled={prepare.isLoading} onClick={() => setFrozen(undefined)}>{common("cancel")}</Button>
          <Button disabled={!accepted || prepare.isLoading} onClick={() => prepare.mutate({ plan: frozenPlan, confirmationToken: frozen.confirmationToken, confirmed: true })}>
            {prepare.isLoading ? common("loading") : t("action")}
          </Button>
        </ModalFooter>
      </div> : null}
    </Modal>
  </div>;
}

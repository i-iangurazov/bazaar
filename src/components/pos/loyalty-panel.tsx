"use client";

import { useTranslations } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/routers/_app";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { reportError } from "@/lib/reporting";

export type PosLoyaltySummary = inferRouterOutputs<AppRouter>["loyalty"]["orderSummary"];

export function LoyaltyButton({ disabled, onOpen }: { disabled?: boolean; onOpen: () => void }) {
  const t = useTranslations("loyalty");
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className="ml-auto h-8 shrink-0 px-3 text-xs"
      data-testid="pos-loyalty-open"
      disabled={disabled}
      onClick={onOpen}
    >
      {t("posOpen")}
    </Button>
  );
}

export function CompletedLoyaltySummary({ saleId }: { saleId: string }) {
  const t = useTranslations("loyalty");
  const errors = useTranslations("errors");
  const summary = trpc.loyalty.orderSummary.useQuery({ customerOrderId: saleId }, { retry: false });
  if (summary.error)
    return (
      <p role="alert" className="text-sm text-danger">
        {reportError(errors, summary.error)}
      </p>
    );
  if (!summary.data || summary.data.status !== "CONFIRMED") return null;
  return (
    <section
      className="rounded-lg border border-border bg-muted/20 p-3 text-sm"
      data-testid="pos-loyalty-completed"
    >
      <p className="font-semibold">
        {t("posTitle")} · {summary.data.member?.displayName ?? t("member")}
      </p>
      <p className="mt-1">
        {t("posCompletedSummary", {
          spent: summary.data.pointsSpent,
          earned: summary.data.pointsEarned,
        })}
      </p>
      {summary.data.plannedPoints > 0 && !summary.data.hasEarned ? (
        <p className="mt-1 text-muted-foreground">{t("posAwaitingPayment")}</p>
      ) : null}
      <p className="mt-1 text-muted-foreground">
        {t("availablePoints")}: {summary.data.availablePoints}
      </p>
    </section>
  );
}

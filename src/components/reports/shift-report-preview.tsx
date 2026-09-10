"use client";
import { useLocale, useTranslations } from "next-intl";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { trpc } from "@/lib/trpc";
import { formatDateTime } from "@/lib/i18nFormat";
import { baseAccountingCurrency, formatKgsMoney } from "@/lib/currencyDisplay";

export function ShiftReportPreview({ shiftId, onClose }: { shiftId: string; onClose: () => void }) {
  const t = useTranslations("reporting"),
    locale = useLocale();
  const query = trpc.pos.shifts.xReport.useQuery({ shiftId }, { staleTime: 0, retry: false });
  const data = query.data;
  const money = (value: number | null) =>
    value === null ? "—" : formatKgsMoney(value, locale, baseAccountingCurrency);
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("shifts")}
    >
      {query.isLoading && <Skeleton className="h-64" />}
      {query.error && <QueryErrorState onRetry={() => void query.refetch()} />}
      {data && (
        <div className="space-y-4">
          <p className="font-medium">
            {data.shift.store.name} · {data.shift.register.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(data.shift.openedAt, locale)} —{" "}
            {data.shift.closedAt ? formatDateTime(data.shift.closedAt, locale) : t("shiftOpen")}
          </p>
          <dl className="divide-y divide-border">
            {[
              [t("cashOpening"), money(data.shift.openingCashKgs)],
              [t("grossSales"), money(data.summary.totalSalesKgs)],
              [t("returns"), money(data.summary.totalRefundsKgs)],
              [t("kinds.PAY_IN"), money(data.summary.payInKgs)],
              [t("kinds.PAY_OUT"), money(data.summary.payOutKgs)],
              [t("expectedCash"), money(data.summary.expectedCashKgs)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4 py-3 text-sm">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs leading-5 text-muted-foreground">{t("shiftScope")}</p>
        </div>
      )}
    </Modal>
  );
}

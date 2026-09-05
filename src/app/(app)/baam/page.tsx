"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatDateTime, formatNumber } from "@/lib/i18nFormat";
import { addBusinessDays, businessDateKey } from "@/lib/timezone";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

export default function BaamPage() {
  const t = useTranslations("baam");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session, status } = useSession();
  const canView = status === "authenticated" && ["ADMIN", "MANAGER"].includes(session?.user.role ?? "");
  const initial = useMemo(() => {
    const today = businessDateKey(new Date());
    return { dateFrom: addBusinessDays(today, -6), dateTo: today, storeId: undefined as string | undefined };
  }, []);
  const [draft, setDraft] = useState(initial);
  const [applied, setApplied] = useState(initial);
  const [inputError, setInputError] = useState(false);
  const query = trpc.baam.overview.useQuery(applied, {
    enabled: canView, retry: false, staleTime: 0, cacheTime: 0,
    refetchOnMount: "always", refetchOnWindowFocus: true, refetchOnReconnect: true,
  });
  const matchesAudience = query.data?.audience.actorId === session?.user.id &&
    query.data?.scope.organizationId === session?.user.organizationId;
  const availableStores = matchesAudience ? query.data?.scope.availableStores ?? [] : [];
  // Do not keep another account's cached figures or old figures during a fresh
  // permission check. Failed refreshes have a visible error, never zero totals.
  const data = canView && matchesAudience && !query.isFetching && !query.error ? query.data : undefined;
  const money = (value: number) => `${formatNumber(value, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KGS`;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.dateFrom || !draft.dateTo || draft.dateFrom > draft.dateTo) {
      setInputError(true);
      return;
    }
    setInputError(false);
    if (JSON.stringify(draft) === JSON.stringify(applied)) void query.refetch();
    else setApplied({ ...draft });
  };

  if (status === "loading") return <div role="status" className="flex min-h-80 items-center justify-center gap-2"><Spinner />{t("loading")}</div>;
  if (!canView) return <div role="alert" className="rounded-xl border p-6">{tErrors("forbidden")}</div>;

  return <div className="min-w-0 space-y-6" data-testid="baam-page">
    <PageHeader title={t("title")} subtitle={t("subtitle")} action={
      <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>{t("refresh")}</Button>
    } />
    <form onSubmit={submit} className="grid min-w-0 gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto]">
      <label className="min-w-0 space-y-1 text-sm" htmlFor="baam-from"><span>{t("dateFrom")}</span>
        <Input id="baam-from" type="date" required value={draft.dateFrom} onChange={event => setDraft({ ...draft, dateFrom: event.target.value })} />
      </label>
      <label className="min-w-0 space-y-1 text-sm" htmlFor="baam-to"><span>{t("dateTo")}</span>
        <Input id="baam-to" type="date" required value={draft.dateTo} onChange={event => setDraft({ ...draft, dateTo: event.target.value })} />
      </label>
      <label className="min-w-0 space-y-1 text-sm" htmlFor="baam-store"><span>{t("store")}</span>
        <select id="baam-store" className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm" value={draft.storeId ?? ""} onChange={event => setDraft({ ...draft, storeId: event.target.value || undefined })}>
          <option value="">{t("allStores")}</option>
          {availableStores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
        </select>
      </label>
      <Button type="submit" className="self-end" disabled={query.isFetching}>{t("apply")}</Button>
      {inputError ? <p role="alert" className="text-sm text-destructive sm:col-span-2">{tErrors("invalidInput")}</p> : null}
    </form>
    {query.error ? <div role="alert" className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-5">
      <p>{translateError(tErrors, query.error)}</p><Button variant="outline" onClick={() => void query.refetch()}>{t("retry")}</Button>
    </div> : query.isFetching || !data ? <div role="status" className="flex min-h-80 items-center justify-center gap-2"><Spinner />{t("loading")}</div> : <>
      <Card>
        <CardHeader><CardTitle>{t("briefTitle")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm font-medium">{t("appliedScope", {
            from: data.period.dateFrom, to: data.period.dateTo,
            stores: data.scope.availableStores.filter(store => data.scope.storeIds.includes(store.id)).map(store => store.name).join(", ") || t("noStoresShort"),
          })}</p>
          <p className="text-base leading-7">{data.quality.emptyAccessibleStoreSet ? t("noStores") : data.quality.qualifyingRecords === 0 ? t("empty") : t("brief", {
            from: data.period.dateFrom, to: data.period.dateTo, stores: data.scope.storeIds.length,
            sales: money(data.totals.salesBeforeReturnsKgs), returns: money(data.totals.returnsKgs),
            net: money(data.totals.netSalesKgs), receipts: data.totals.receiptCount, returnCount: data.totals.returnCount,
          })}</p>
          <p className="text-sm text-muted-foreground">{t("completeness")}</p>
          {!data.quality.paymentsReconcile ? <p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{t("paymentMismatch", { sales: money(data.quality.salesDifferenceKgs), returns: money(data.quality.refundsDifferenceKgs) })}</p> : <p className="text-sm text-muted-foreground">{t("paymentsMatch")}</p>}
        </CardContent>
      </Card>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[
          ["net", money(data.totals.netSalesKgs)], ["sales", money(data.totals.salesBeforeReturnsKgs)],
          ["returns", money(data.totals.returnsKgs)], ["receipts", formatNumber(data.totals.receiptCount, locale)],
          ["average", data.totals.averageReceiptKgs === null ? t("notAvailable") : money(data.totals.averageReceiptKgs)],
          ["discounts", money(data.totals.recordedDiscountKgs)],
        ].map(([key, value]) => <Card key={key} className="min-w-0" data-testid={`baam-metric-${key}`}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{t(key)}</CardTitle></CardHeader>
          <CardContent><p className="break-words text-2xl font-semibold tabular-nums">{value}</p></CardContent>
        </Card>)}
      </div>
      <Card className="min-w-0">
        <CardHeader><CardTitle>{t("daysTitle")}</CardTitle></CardHeader>
        <CardContent><div className="max-w-full overflow-x-auto">
          <table className="w-full text-sm" aria-label={t("daysTitle")}>
            <thead><tr className="border-b text-left text-muted-foreground">
              {["date", "sales", "returns", "net", "receipts"].map(key => <th key={key} scope="col" className="whitespace-nowrap px-3 py-3 font-medium">{t(key)}</th>)}
            </tr></thead>
            <tbody>{data.days.map(day => <tr key={day.date} className="border-b last:border-0">
              <th scope="row" className="whitespace-nowrap px-3 py-3 text-left font-normal">{day.date}</th>
              {[money(day.salesBeforeReturnsKgs), money(day.returnsKgs), money(day.netSalesKgs), formatNumber(day.receiptCount, locale)].map((value, index) => <td key={index} className="whitespace-nowrap px-3 py-3 tabular-nums">{value}</td>)}
            </tr>)}</tbody>
          </table>
        </div></CardContent>
      </Card>
      <Card><CardHeader><CardTitle>{t("policyTitle")}</CardTitle></CardHeader><CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
        <p>{t("policy")}</p><p>{t("exclusions")}</p>
        <p>{t("source")}</p><p>{t("version", { version: data.version })}</p>
        <p>{t("queriedAt", { time: formatDateTime(data.freshness.queriedAt, locale) })}</p>
        <p>{t("timeZone", { zone: data.period.timeZone })}</p>
      </CardContent></Card>
    </>}
  </div>;
}

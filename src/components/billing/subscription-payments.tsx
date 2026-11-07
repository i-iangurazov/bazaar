"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc";
import { toPlanCode, type PlanCode } from "@/lib/billing/plans";
import { formatCurrencyKGS, formatDateTime } from "@/lib/i18nFormat";
import { translateError } from "@/lib/translateError";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { ADDITIONAL_STORE_CAPS, CURRENT_CATALOG_VERSION, EMPTY_SUBSCRIPTION_EXTRAS, type SubscriptionExtras, type SubscriptionMonths } from "@/lib/billing/subscriptionPricing";
import { QueryErrorState } from "@/components/query-error-state";
import { SubscriptionAddons } from "@/components/billing/subscription-addons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function SubscriptionPayments({ onUpdated }: { onUpdated: () => void }) {
  const t = useTranslations("billing.payments");
  const billing = useTranslations("billing");
  const plans = useTranslations("billing.plans");
  const errors = useTranslations("errors");
  const common = useTranslations("common");
  const locale = useLocale();
  const settings = trpc.billing.payments.get.useQuery();
  const history = trpc.billing.payments.invoices.useInfiniteQuery(
    {},
    { getNextPageParam: (page) => page.nextCursor },
  );
  const [selected, setSelected] = useState<PlanCode | null>(null);
  const [months, setMonths] = useState<SubscriptionMonths>(1);
  const [extras, setExtras] = useState<SubscriptionExtras | null>(null);
  const [action, setAction] = useState<"RENEW" | "CHANGE">("RENEW");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [consent, setConsent] = useState<{
    plan: PlanCode;
    months: SubscriptionMonths;
    extras: SubscriptionExtras;
    action: "RENEW" | "CHANGE";
    quoteToken: string;
    startsAt: string;
    endsAt: string;
    creditMinor: number;
    amount: number;
    termsVersion: string;
    termsUrl: string;
    sellerName: string;
  } | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [notice, setNotice] = useState("");
  const requestKey = useRef("");
  const returnChecked = useRef(false);
  const refresh = () => {
    void settings.refetch();
    void history.refetch();
    onUpdated();
  };
  const checkout = trpc.billing.payments.checkout.useMutation({
    onSuccess: (invoice) => {
      requestKey.current = "";
      setConfirmOpen(false);
      setAccepted(false);
      setNotice("");
      refresh();
      if (invoice.status === "PENDING" && invoice.checkoutUrl)
        window.location.assign(invoice.checkoutUrl);
      else setNotice(t(invoice.status === "FAILED" ? "creationFailed" : "pendingHint"));
    },
    onError: (error) => {
      setNotice(translateError(errors, error));
      refresh();
    },
  });
  const check = trpc.billing.payments.check.useMutation({
    onSuccess: (invoice) => {
      refresh();
      setNotice(
        t(
          invoice.syncDelayed
            ? "checkDelayed"
            : invoice.status === "PAID"
              ? "confirmed"
              : invoice.status === "REVIEW"
                ? "reviewHint"
                : "checked",
        ),
      );
    },
    onError: (error) => setNotice(translateError(errors, error)),
  });
  const checkRef = useRef(check.mutate);
  const checking = useRef(check.isLoading);
  checkRef.current = check.mutate;
  checking.current = check.isLoading;
  const pending = settings.data?.pendingInvoice;
  const pendingId = pending?.id;
  const pendingStatus = pending?.status;
  useEffect(() => {
    if (!settings.data || returnChecked.current) return;
    const id = new URL(window.location.href).searchParams.get("invoice");
    returnChecked.current = true;
    if (id && /^[a-zA-Z0-9_-]{1,50}$/.test(id)) checkRef.current({ invoiceId: id });
  }, [settings.data]);
  useEffect(() => {
    if (!pendingId || !["CREATING", "PENDING"].includes(pendingStatus ?? "")) return;
    const timer = window.setInterval(() => {
      if (!document.hidden && !checking.current) checkRef.current({ invoiceId: pendingId });
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [pendingId, pendingStatus]);
  const plan = selected ?? toPlanCode(settings.data?.currentPlan ?? "STARTER");
  const selectedExtras = extras ?? settings.data?.currentExtras ?? EMPTY_SUBSCRIPTION_EXTRAS;
  const selectedMonths = action === "CHANGE" ? settings.data?.currentMonths ?? 1 : months;
  const quote = trpc.billing.payments.quote.useQuery(
    { plan, months: selectedMonths, extras: selectedExtras, action },
    { enabled: Boolean(settings.data?.canPurchase), retry: false, staleTime: 30_000 },
  );
  const amount = quote.data?.amountMinor ?? 0;
  const money = (minor: number) => formatCurrencyKGS(minor / 100, locale);
  const name = (code: string) => plans(`${toPlanCode(code).toLowerCase()}.name`);
  const records = history.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Card data-subscription-payments>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {settings.isLoading ? (
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {common("loading")}
          </p>
        ) : settings.isError ? (
          <QueryErrorState error={settings.error} onRetry={() => void settings.refetch()} />
        ) : settings.data ? (
          <>
            {settings.data.mode === "sandbox" && settings.data.available ? (
              <p
                role="status"
                className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
              >
                {t("sandbox")}
              </p>
            ) : null}
            {settings.data.lifetimeAccess || settings.data.billingMode === "MANUAL" ? (
              <p className="text-sm text-muted-foreground">{t(settings.data.lifetimeAccess ? "lifetimeAccess" : "manualAccess")}</p>
            ) : settings.data.accountPaused ? (
              <p className="text-sm text-muted-foreground">{t("accountPaused")}</p>
            ) : !settings.data.available ? (
              <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
            ) : null}
            {settings.data.catalogVersion !== CURRENT_CATALOG_VERSION ? (
              <p className="rounded-md bg-secondary p-3 text-sm text-muted-foreground">
                {t("legacyExtras")}
              </p>
            ) : null}
            <SubscriptionAddons t={billing} locale={locale} />
            {!settings.data.canPurchase && !settings.data.lifetimeAccess && !pending ? (
              <Button asChild variant="secondary">
                <a href="https://wa.me/996709911300" target="_blank" rel="noreferrer">{t("support")}</a>
              </Button>
            ) : null}
            {settings.data.canPurchase ? <p className="text-sm text-muted-foreground">{t("configureExtrasHint")}</p> : null}
            {pending ? (
              <div className="space-y-3 rounded-md border border-input p-4" data-pending-invoice>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>
                    {name(pending.plan)} · {money(pending.amountMinor)}
                  </strong>
                  <Badge variant={pending.status === "REVIEW" ? "warning" : "muted"}>
                    {t(`statuses.${pending.status}`)}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t(pending.status === "REVIEW" ? "reviewHint" : "pendingHint")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("expiresAt", { date: formatDateTime(pending.expiresAt, locale) })}
                </p>
                <div className="flex flex-wrap gap-2">
                  {pending.checkoutUrl ? (
                    <Button asChild>
                      <a href={pending.checkoutUrl}>{t("continue")}</a>
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    disabled={check.isLoading}
                    onClick={() => check.mutate({ invoiceId: pending.id })}
                  >
                    {check.isLoading ? common("loading") : t("check")}
                  </Button>
                  {pending.status === "REVIEW" ? (
                    <Button asChild variant="secondary">
                      <a href="https://wa.me/996709911300" target="_blank" rel="noreferrer">
                        {t("support")}
                      </a>
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : settings.data.canPurchase ? (
              <div className="space-y-3" data-checkout-form>
                <p className="text-sm text-muted-foreground">{t("description")}</p>
                {settings.data.canChange ? (
                  <div className="max-w-sm space-y-2">
                    <label htmlFor="subscription-action" className="block text-sm font-medium">{t("purchaseAction")}</label>
                    <Select value={action} onValueChange={(value) => { setAction(value as "RENEW" | "CHANGE"); requestKey.current = ""; }}>
                      <SelectTrigger id="subscription-action"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="RENEW">{t("renewAction")}</SelectItem>
                        <SelectItem value="CHANGE">{t("changeAction")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <label htmlFor="subscription-plan" className="block text-sm font-medium">
                  {t("plan")}
                </label>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="w-full sm:max-w-xs">
                    <Select
                      value={plan}
                      onValueChange={(value) => {
                        setSelected(value as PlanCode);
                        setExtras({ ...selectedExtras, stores: Math.min(selectedExtras.stores,
                          ADDITIONAL_STORE_CAPS[value as PlanCode]) });
                        requestKey.current = "";
                      }}
                    >
                      <SelectTrigger id="subscription-plan">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {settings.data.catalog.map((item) => (
                          <SelectItem
                            key={item.plan}
                            value={item.plan}
                          >
                            {name(item.plan)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    disabled={!quote.data || quote.isFetching || quote.isError}
                    onClick={() => {
                      if (!settings.data || !quote.data) return;
                      if (
                        !requestKey.current ||
                        (consent && consent.quoteToken !== quote.data.quoteToken)
                      )
                        requestKey.current = crypto.randomUUID();
                      setConsent({
                        plan,
                        months: quote.data.months,
                        extras: quote.data.extras,
                        action,
                        quoteToken: quote.data.quoteToken,
                        startsAt: quote.data.startsAt,
                        endsAt: quote.data.endsAt,
                        creditMinor: quote.data.creditMinor,
                        amount,
                        termsVersion: settings.data.termsVersion,
                        termsUrl: settings.data.termsUrl,
                        sellerName: settings.data.sellerName,
                      });
                      setNotice("");
                      setAccepted(false);
                      setConfirmOpen(true);
                    }}
                  >
                    {quote.isFetching ? common("loading") : t("pay", { amount: money(amount) })}
                  </Button>
                </div>
                <div className="space-y-2 sm:max-w-xs">
                  <label htmlFor="subscription-months" className="block text-sm font-medium">{t("term")}</label>
                  <Select value={String(selectedMonths)} disabled={action === "CHANGE"} onValueChange={(value) => { setMonths(Number(value) as SubscriptionMonths); requestKey.current = ""; }}>
                    <SelectTrigger id="subscription-months"><SelectValue /></SelectTrigger>
                    <SelectContent>{([1, 6, 12] as const).map((term) => <SelectItem key={term} value={String(term)}>{t(`term${term}`)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {settings.data.catalogVersion === CURRENT_CATALOG_VERSION ? <fieldset className="space-y-3">
                  <legend className="text-sm font-medium">{t("extrasTitle")}</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label htmlFor="subscription-extra-stores" className="block text-sm">{t("extrastores")}</label>
                      {ADDITIONAL_STORE_CAPS[plan] > 0 ? <Select value={String(selectedExtras.stores)}
                        onValueChange={(value) => { setExtras({ ...selectedExtras, stores: Number(value) }); requestKey.current = ""; }}>
                        <SelectTrigger id="subscription-extra-stores"><SelectValue /></SelectTrigger>
                        <SelectContent>{Array.from({ length: ADDITIONAL_STORE_CAPS[plan] + 1 }, (_, count) =>
                          <SelectItem key={count} value={String(count)}>{t("extraStoreCount", { count })}</SelectItem>)}</SelectContent>
                      </Select> : <p className="text-sm text-muted-foreground">{t("starterOneStore")}</p>}
                    </div>
                    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-input p-3">
                      <Checkbox checked={selectedExtras.productPacks === 1}
                        onCheckedChange={(checked) => { setExtras({ ...selectedExtras, productPacks: checked === true ? 1 : 0 }); requestKey.current = ""; }} />
                      <span className="text-sm">{t("extraproductPacks")}</span>
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground">{t("extrasHint")}</p>
                </fieldset> : null}
                {quote.isError ? <QueryErrorState error={quote.error} onRetry={() => void quote.refetch()} /> : quote.data ? (
                  <div className="space-y-2 rounded-md border border-input p-4" aria-live="polite" data-subscription-quote>
                    <p className="font-semibold">{t("total", { amount: money(quote.data.amountMinor) })}</p>
                    <p className="text-sm text-muted-foreground">{t(quote.data.kind === "UPGRADE" ? "upgradeDates" : "renewDates", { start: formatDateTime(quote.data.startsAt, locale), end: formatDateTime(quote.data.endsAt, locale) })}</p>
                    {quote.data.kind === "UPGRADE" ? <p className="text-sm">{t("credit", { amount: money(quote.data.creditMinor) })}</p> : <p className="text-sm">{t("discount", { percent: quote.data.discountBps / 100 })}</p>}
                    <p className="text-xs text-muted-foreground">{t("oneTimePayment")}</p>
                  </div>
                ) : null}
                <p className="text-xs text-muted-foreground">{t("planChangeHint")}</p>
              </div>
            ) : null}
            <p
              aria-live="polite"
              role={notice ? "status" : undefined}
              className="text-sm text-muted-foreground"
            >
              {notice}
            </p>
            <section className="space-y-3" aria-label={t("history")}>
              <h3 className="text-sm font-semibold">{t("history")}</h3>
              {history.isLoading ? (
                <p className="text-sm text-muted-foreground">{common("loading")}</p>
              ) : history.isError ? (
                <QueryErrorState error={history.error} onRetry={() => void history.refetch()} />
              ) : records.length ? (
                <ul className="space-y-2">
                  {records.map((invoice) => (
                    <li
                      key={invoice.id}
                      className="rounded-md border border-input px-3 py-2"
                      data-subscription-invoice={invoice.id}
                    >
                      <details>
                        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
                          <span className="min-w-0">
                            {name(invoice.plan)} · {money(invoice.amountMinor)}
                          </span>
                          <Badge
                            variant={
                              invoice.status === "PAID"
                                ? "success"
                                : invoice.status === "REVIEW"
                                  ? "warning"
                                  : "muted"
                            }
                          >
                            {t(`statuses.${invoice.status}`)}
                          </Badge>
                        </summary>
                        <dl className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                          <div>
                            <dt>{t("invoice")}</dt>
                            <dd className="break-all font-mono">{invoice.id}</dd>
                          </div>
                          <div>
                            <dt>{t("created")}</dt>
                            <dd>{formatDateTime(invoice.createdAt, locale)}</dd>
                          </div>
                          {invoice.paidAt ? (
                            <div>
                              <dt>{t("paid")}</dt>
                              <dd>{formatDateTime(invoice.paidAt, locale)}</dd>
                            </div>
                          ) : null}
                          {invoice.period ? (
                            <div>
                              <dt>{t("period")}</dt>
                              <dd>
                                {formatDateTime(invoice.period.startsAt, locale)} —{" "}
                                {formatDateTime(invoice.period.endsAt, locale)}
                              </dd>
                            </div>
                          ) : null}
                          <div>
                            <dt>{t("term")}</dt>
                            <dd>{t(`term${invoice.purchase?.months ?? 1}`)}</dd>
                          </div>
                          {invoice.purchase ? <div>
                            <dt>{t("extrasTitle")}</dt>
                            <dd>{t("extrasSummary", { stores: invoice.purchase.extras.stores, products: invoice.purchase.extras.productPacks * 1000, users: invoice.purchase.catalogVersion === CURRENT_CATALOG_VERSION ? invoice.purchase.extras.productPacks * 2 : invoice.purchase.extras.userPacks * 5 })}</dd>
                          </div> : null}
                          <div>
                            <dt>{t("seller")}</dt>
                            <dd>{invoice.sellerName}</dd>
                          </div>
                          <div>
                            <dt>{t("termsVersion")}</dt>
                            <dd>
                              <a
                                className="underline"
                                href={invoice.termsUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {invoice.termsVersion}
                              </a>
                            </dd>
                          </div>
                        </dl>
                      </details>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("empty")}</p>
              )}
              {history.hasNextPage ? (
                <Button
                  variant="secondary"
                  disabled={history.isFetchingNextPage}
                  onClick={() => void history.fetchNextPage()}
                >
                  {history.isFetchingNextPage ? common("loading") : t("more")}
                </Button>
              ) : null}
            </section>
            <Modal
              open={confirmOpen}
              onOpenChange={(open) => {
                if (!checkout.isLoading) setConfirmOpen(open);
              }}
              title={t("confirmTitle")}
            >
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!accepted || !consent || checkout.isLoading) return;
                  checkout.mutate({
                    expectedAmountMinor: consent.amount,
                    plan: consent.plan,
                    months: consent.months,
                    extras: consent.extras,
                    action: consent.action,
                    quoteToken: consent.quoteToken,
                    idempotencyKey: requestKey.current,
                    termsVersion: consent.termsVersion,
                    acceptedTerms: true,
                    locale: locale as "ru" | "kg" | "en",
                  });
                }}
              >
                <p className="text-sm">
                  {t("confirmDescription", {
                    plan: name(consent?.plan ?? plan),
                    amount: money(consent?.amount ?? amount),
                  })}
                </p>
                <p className="text-sm">{t(`term${consent?.months ?? selectedMonths}`)}</p>
                <p className="text-sm">{t("extrasSummary", { stores: consent?.extras.stores ?? 0, products: (consent?.extras.productPacks ?? 0) * 1000, users: settings.data?.catalogVersion === CURRENT_CATALOG_VERSION ? (consent?.extras.productPacks ?? 0) * 2 : (consent?.extras.userPacks ?? 0) * 5 })}</p>
                {consent ? <p className="text-sm">{t(consent.action === "CHANGE" ? "upgradeDates" : "renewDates", { start: formatDateTime(consent.startsAt, locale), end: formatDateTime(consent.endsAt, locale) })}</p> : null}
                {consent?.creditMinor ? <p className="text-sm">{t("credit", { amount: money(consent.creditMinor) })}</p> : null}
                <p className="text-sm text-muted-foreground">{t("renewalPolicy")}</p>
                <p className="text-xs text-muted-foreground">{consent?.sellerName}</p>
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="subscription-terms"
                    checked={accepted}
                    disabled={checkout.isLoading}
                    onCheckedChange={(value) => setAccepted(value === true)}
                  />
                  <label htmlFor="subscription-terms" className="text-sm">
                    {t("acceptTerms")}{" "}
                    <a
                      className="underline"
                      href={consent?.termsUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("termsLink")}
                    </a>
                  </label>
                </div>
                {notice ? (
                  <p role="alert" className="text-sm text-danger">
                    {notice}
                  </p>
                ) : null}
                <ModalFooter>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={checkout.isLoading}
                    onClick={() => setConfirmOpen(false)}
                  >
                    {common("cancel")}
                  </Button>
                  <Button type="submit" disabled={!accepted || checkout.isLoading}>
                    {checkout.isLoading ? common("loading") : t("goToPayment")}
                  </Button>
                </ModalFooter>
              </form>
            </Modal>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

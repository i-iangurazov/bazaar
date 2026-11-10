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
import { IconButton } from "@/components/ui/icon-button";
import { RestoreIcon } from "@/components/icons";
import {
  ADDITIONAL_STORE_CAPS,
  CURRENT_CATALOG_VERSION,
  EMPTY_SUBSCRIPTION_EXTRAS,
  type SubscriptionExtras,
  type SubscriptionMonths,
} from "@/lib/billing/subscriptionPricing";
import { QueryErrorState } from "@/components/query-error-state";
import { SubscriptionPreparationNotice } from "@/components/billing/subscription-preparation-notice";
import { TrialPreparation } from "@/components/billing/trial-preparation";
import { SubscriptionAddons } from "@/components/billing/subscription-addons";
import {
  SubscriptionQuoteSummary,
  type SubscriptionQuote,
} from "@/components/billing/subscription-quote-summary";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function SubscriptionPayments({
  onUpdated,
  selectedPlan,
  onPlanSelected,
}: {
  onUpdated: () => void;
  selectedPlan?: PlanCode | null;
  onPlanSelected?: (plan: PlanCode) => void;
}) {
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
    provider: "GOPAY" | "FREEDOMPAY";
    isTest: boolean;
    quote: SubscriptionQuote;
  } | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [notice, setNotice] = useState("");
  const [staleConsent, setStaleConsent] = useState(false);
  const requestKey = useRef("");
  const returnChecked = useRef(false);
  const checkoutInFlight = useRef(false);
  const checking = useRef(false);
  const checkSource = useRef<"manual" | "return" | "poll">("manual");
  const refresh = () => {
    void settings.refetch();
    void history.refetch();
    onUpdated();
  };
  const checkout = trpc.billing.payments.checkout.useMutation({
    onSuccess: (invoice) => {
      checkoutInFlight.current = false;
      requestKey.current = "";
      setConfirmOpen(false);
      setAccepted(false);
      setNotice("");
      refresh();
      if (invoice.status === "PENDING" && invoice.checkoutUrl)
        window.location.assign(invoice.checkoutUrl);
      else
        setNotice(
          t(
            invoice.status === "PAID"
              ? invoice.isTest
                ? "testConfirmed"
                : "confirmed"
              : invoice.status === "FAILED"
                ? "creationFailed"
                : "pendingHint",
          ),
        );
    },
    onError: (error) => {
      checkoutInFlight.current = false;
      setStaleConsent(error.message === "billingQuoteChanged");
      setNotice(translateError(errors, error));
      refresh();
    },
  });
  const check = trpc.billing.payments.check.useMutation({
    onSuccess: (invoice) => {
      checking.current = false;
      refresh();
      if (
        checkSource.current === "poll" &&
        !invoice.syncDelayed &&
        ["CREATING", "PENDING"].includes(invoice.status)
      )
        return;
      setNotice(
        t(
          invoice.syncDelayed
            ? "checkDelayed"
            : invoice.status === "PAID"
              ? invoice.isTest
                ? "testConfirmed"
                : "confirmed"
              : invoice.status === "REVIEW"
                ? "reviewHint"
                : invoice.status === "FAILED"
                  ? "paymentFailed"
                  : invoice.status === "EXPIRED"
                    ? "paymentExpired"
                    : invoice.status === "CREATING"
                      ? "creatingHint"
                      : invoice.status === "PENDING"
                        ? "pendingHint"
                        : "checked",
        ),
      );
    },
    onError: (error) => {
      checking.current = false;
      setNotice(translateError(errors, error));
    },
  });
  const checkInvoice = (invoiceId: string, source: "manual" | "return" | "poll") => {
    if (checking.current) return;
    checking.current = true;
    checkSource.current = source;
    check.mutate({ invoiceId });
  };
  const checkRef = useRef(checkInvoice);
  checkRef.current = checkInvoice;
  const pending = settings.data?.pendingInvoice;
  const pendingId = pending?.id;
  const pendingStatus = pending?.status;
  useEffect(() => {
    if (!settings.data || returnChecked.current) return;
    const id = new URL(window.location.href).searchParams.get("invoice");
    returnChecked.current = true;
    if (id && /^[a-zA-Z0-9_-]{1,50}$/.test(id)) {
      setNotice(t("returnHint"));
      checkRef.current(id, "return");
    }
  }, [settings.data, t]);
  useEffect(() => {
    if (!pendingId) return;
    setConfirmOpen(false);
    setAccepted(false);
  }, [pendingId]);
  useEffect(() => {
    if (!pendingId || !["CREATING", "PENDING"].includes(pendingStatus ?? "")) return;
    const resume = () => {
      if (!document.hidden) checkRef.current(pendingId, "poll");
    };
    const timer = window.setInterval(resume, 20_000);
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [pendingId, pendingStatus]);
  const plan = selectedPlan ?? selected ?? toPlanCode(settings.data?.currentPlan ?? "STARTER");
  const configuredExtras = extras ?? settings.data?.currentExtras ?? EMPTY_SUBSCRIPTION_EXTRAS;
  const selectedExtras = {
    ...configuredExtras,
    stores: Math.min(configuredExtras.stores, ADDITIONAL_STORE_CAPS[plan]),
  };
  const selectedMonths = action === "CHANGE" ? (settings.data?.currentMonths ?? 1) : months;
  const quote = trpc.billing.payments.quote.useQuery(
    { plan, months: selectedMonths, extras: selectedExtras, action },
    { enabled: Boolean(settings.data?.canPurchase), retry: false, staleTime: 30_000 },
  );
  const amount = quote.data?.amountMinor ?? 0;
  const money = (minor: number) => formatCurrencyKGS(minor / 100, locale);
  const name = (code: string) => plans(`${toPlanCode(code).toLowerCase()}.name`);
  const providerName = (provider: string | undefined) =>
    provider === "GOPAY" ? "GoPay" : "FreedomPay";
  const invoiceStatus = (status: string, isTest: boolean) =>
    t(isTest && status === "PAID" ? "testPaid" : `statuses.${status}`);
  const records = history.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Card data-subscription-payments id="subscription-checkout" className="scroll-mt-24">
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
                {t("sandbox", { provider: providerName(settings.data.provider) })}
              </p>
            ) : null}
            {settings.data.lifetimeAccess || settings.data.billingMode === "MANUAL" ? (
              <p className="text-sm text-muted-foreground">
                {t(settings.data.lifetimeAccess ? "lifetimeAccess" : "manualAccess")}
              </p>
            ) : settings.data.accountPaused ? (
              <p className="text-sm text-muted-foreground">{t("accountPaused")}</p>
            ) : !settings.data.available ? (
              <p className="text-sm text-muted-foreground">{billing("trial.paymentUnavailable")}</p>
            ) : null}
            {settings.data.catalogVersion !== CURRENT_CATALOG_VERSION ? (
              <p className="rounded-md bg-secondary p-3 text-sm text-muted-foreground">
                {t("legacyExtras")}
              </p>
            ) : null}
            {settings.data.scheduledSubscription ? (
              <div
                className="space-y-2 rounded-md border border-input p-4"
                data-scheduled-subscription
              >
                <h3 className="text-sm font-semibold">{t("scheduledTitle")}</h3>
                <p className="text-sm">
                  {t("scheduledDescription", {
                    plan: name(settings.data.scheduledSubscription.plan),
                    start: formatDateTime(settings.data.scheduledSubscription.startsAt, locale),
                    end: formatDateTime(settings.data.scheduledSubscription.endsAt, locale),
                  })}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("limitsSummary", {
                    stores: settings.data.scheduledSubscription.entitlements.limits.maxStores,
                    products: settings.data.scheduledSubscription.entitlements.limits.maxProducts,
                    users: settings.data.scheduledSubscription.entitlements.limits.maxActiveUsers,
                  })}
                </p>
              </div>
            ) : null}
            <SubscriptionAddons t={billing} locale={locale} />
            {!settings.data.canPurchase && !settings.data.lifetimeAccess && !pending ? (
              <Button asChild variant="secondary">
                <a href="https://wa.me/996709911300" target="_blank" rel="noreferrer">
                  {t("support")}
                </a>
              </Button>
            ) : null}
            {settings.data.canPurchase ? (
              <p className="text-sm text-muted-foreground">{t("configureExtrasHint")}</p>
            ) : null}
            {pending ? (
              <div className="space-y-3 rounded-md border border-input p-4" data-pending-invoice>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>
                    {name(pending.plan)} · {money(pending.amountMinor)}
                  </strong>
                  <div className="flex flex-wrap items-center gap-2">
                    {pending.isTest ? <Badge variant="warning">{t("testInvoice")}</Badge> : null}
                    <Badge variant={pending.status === "REVIEW" ? "warning" : "muted"}>
                      {invoiceStatus(pending.status, pending.isTest)}
                    </Badge>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("providerDescription", { provider: providerName(pending.provider) })}
                </p>
                {pending.purchase ? (
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <p>{t(`term${pending.purchase.months}`)}</p>
                    <p>
                      {t("renewDates", {
                        start: formatDateTime(pending.purchase.startsAt, locale),
                        end: formatDateTime(pending.purchase.endsAt, locale),
                      })}
                    </p>
                    <p>
                      {t("extrasSummary", {
                        stores: pending.purchase.extras.stores,
                        products: pending.purchase.extras.productPacks * 1000,
                        users:
                          pending.purchase.catalogVersion === CURRENT_CATALOG_VERSION
                            ? pending.purchase.extras.productPacks * 2
                            : pending.purchase.extras.userPacks * 5,
                      })}
                    </p>
                  </div>
                ) : null}
                <p className="text-sm text-muted-foreground">
                  {t(
                    pending.status === "REVIEW"
                      ? "reviewHint"
                      : pending.status === "CREATING"
                        ? "creatingHint"
                        : pending.checkoutUrl
                          ? "pendingHint"
                          : "linkUnavailable",
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{t("checkOnReturn")}</p>
                {pending.checkoutUrl ? (
                  <p className="text-xs text-muted-foreground">
                    {t("expiresAt", { date: formatDateTime(pending.expiresAt, locale) })}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {pending.checkoutUrl ? (
                    <Button asChild>
                      <a href={pending.checkoutUrl}>{t("continue")}</a>
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    disabled={check.isLoading}
                    onClick={() => checkRef.current(pending.id, "manual")}
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
                <p className="text-sm text-muted-foreground">
                  {t("description", { provider: providerName(settings.data.provider) })}
                </p>
                {settings.data.canChange ? (
                  <div className="max-w-sm space-y-2">
                    <label htmlFor="subscription-action" className="block text-sm font-medium">
                      {t("purchaseAction")}
                    </label>
                    <Select
                      value={action}
                      onValueChange={(value) => {
                        setAction(value as "RENEW" | "CHANGE");
                        requestKey.current = "";
                      }}
                    >
                      <SelectTrigger id="subscription-action">
                        <SelectValue />
                      </SelectTrigger>
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
                        onPlanSelected?.(value as PlanCode);
                        setExtras({
                          ...selectedExtras,
                          stores: Math.min(
                            selectedExtras.stores,
                            ADDITIONAL_STORE_CAPS[value as PlanCode],
                          ),
                        });
                        requestKey.current = "";
                      }}
                    >
                      <SelectTrigger id="subscription-plan">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {settings.data.catalog.map((item) => (
                          <SelectItem key={item.plan} value={item.plan}>
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
                        provider: settings.data.provider,
                        isTest: settings.data.mode === "sandbox",
                        quote: quote.data,
                      });
                      setNotice("");
                      setStaleConsent(false);
                      setAccepted(false);
                      setConfirmOpen(true);
                    }}
                  >
                    {quote.isFetching
                      ? common("loading")
                      : quote.data
                        ? t("pay", { amount: money(amount) })
                        : billing("trial.choose")}
                  </Button>
                </div>
                <div className="space-y-2 sm:max-w-xs">
                  <label htmlFor="subscription-months" className="block text-sm font-medium">
                    {t("term")}
                  </label>
                  <Select
                    value={String(selectedMonths)}
                    disabled={action === "CHANGE"}
                    onValueChange={(value) => {
                      setMonths(Number(value) as SubscriptionMonths);
                      requestKey.current = "";
                    }}
                  >
                    <SelectTrigger id="subscription-months">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {([1, 6, 12] as const).map((term) => (
                        <SelectItem key={term} value={String(term)}>
                          {t(`term${term}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {settings.data.catalogVersion === CURRENT_CATALOG_VERSION ? (
                  <fieldset className="space-y-3">
                    <legend className="text-sm font-medium">{t("extrasTitle")}</legend>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <label htmlFor="subscription-extra-stores" className="block text-sm">
                          {t("extrastores")}
                        </label>
                        {ADDITIONAL_STORE_CAPS[plan] > 0 ? (
                          <Select
                            value={String(selectedExtras.stores)}
                            onValueChange={(value) => {
                              setExtras({ ...selectedExtras, stores: Number(value) });
                              requestKey.current = "";
                            }}
                          >
                            <SelectTrigger id="subscription-extra-stores">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Array.from(
                                { length: ADDITIONAL_STORE_CAPS[plan] + 1 },
                                (_, count) => (
                                  <SelectItem key={count} value={String(count)}>
                                    {t("extraStoreCount", { count })}
                                  </SelectItem>
                                ),
                              )}
                            </SelectContent>
                          </Select>
                        ) : (
                          <p className="text-sm text-muted-foreground">{t("starterOneStore")}</p>
                        )}
                      </div>
                      <label className="flex cursor-pointer items-start gap-3 rounded-md border border-input p-3">
                        <Checkbox
                          checked={selectedExtras.productPacks === 1}
                          onCheckedChange={(checked) => {
                            setExtras({
                              ...selectedExtras,
                              productPacks: checked === true ? 1 : 0,
                            });
                            requestKey.current = "";
                          }}
                        />
                        <span className="text-sm">{t("extraproductPacks")}</span>
                      </label>
                    </div>
                    <p className="text-xs text-muted-foreground">{t("extrasHint")}</p>
                  </fieldset>
                ) : null}
                {quote.isFetching ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    {common("loading")}
                  </p>
                ) : quote.isError ? (
                  quote.error.message === "billingDowngradeNeedsPreparation" ? (
                    <div className="space-y-3">
                      <SubscriptionPreparationNotice
                        modules={quote.error.data?.details?.modules}
                        trial={settings.data.trialPreview}
                      />
                      {settings.data.trialPreview ? (
                        <TrialPreparation
                          plan={plan}
                          onPrepared={() => {
                            requestKey.current = "";
                            setConsent(null);
                            setAccepted(false);
                            void quote.refetch();
                            refresh();
                          }}
                        />
                      ) : null}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <QueryErrorState error={quote.error} onRetry={() => void quote.refetch()} />
                      {quote.error.message === "billingDowngradeNextPeriod" ? (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setAction("RENEW");
                            requestKey.current = "";
                          }}
                        >
                          {t("renewAction")}
                        </Button>
                      ) : null}
                    </div>
                  )
                ) : quote.data ? (
                  <SubscriptionQuoteSummary quote={quote.data} />
                ) : null}
                <p className="text-xs text-muted-foreground">{t("planChangeHint")}</p>
              </div>
            ) : null}
            <p
              aria-live="polite"
              role={notice ? "status" : undefined}
              className="text-sm text-muted-foreground"
            >
              {check.isLoading && checkSource.current === "return" ? t("returnChecking") : notice}
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
                          <span className="flex flex-wrap items-center gap-2">
                            {invoice.isTest ? (
                              <Badge variant="warning">{t("testInvoice")}</Badge>
                            ) : null}
                            <Badge
                              variant={
                                invoice.status === "PAID"
                                  ? "success"
                                  : invoice.status === "REVIEW"
                                    ? "warning"
                                    : "muted"
                              }
                            >
                              {invoiceStatus(invoice.status, invoice.isTest)}
                            </Badge>
                          </span>
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
                          <div>
                            <dt>{t("provider")}</dt>
                            <dd>{providerName(invoice.provider)}</dd>
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
                          {invoice.purchase ? (
                            <div>
                              <dt>{t("extrasTitle")}</dt>
                              <dd>
                                {t("extrasSummary", {
                                  stores: invoice.purchase.extras.stores,
                                  products: invoice.purchase.extras.productPacks * 1000,
                                  users:
                                    invoice.purchase.catalogVersion === CURRENT_CATALOG_VERSION
                                      ? invoice.purchase.extras.productPacks * 2
                                      : invoice.purchase.extras.userPacks * 5,
                                })}
                              </dd>
                            </div>
                          ) : null}
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
                        {!["PAID", "RESOLVED"].includes(invoice.status) &&
                        invoice.id !== pendingId ? (
                          <div className="mt-3 flex justify-end">
                            <IconButton
                              icon={RestoreIcon}
                              label={t("check")}
                              variant="secondary"
                              disabled={check.isLoading}
                              loading={check.isLoading}
                              onClick={() => checkRef.current(invoice.id, "manual")}
                            />
                          </div>
                        ) : null}
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
                  if (
                    !accepted ||
                    !consent ||
                    staleConsent ||
                    checkout.isLoading ||
                    checkoutInFlight.current
                  )
                    return;
                  checkoutInFlight.current = true;
                  checkout.mutate({
                    expectedAmountMinor: consent.amount,
                    expectedProvider: consent.provider,
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
                {consent?.isTest ? (
                  <p
                    role="status"
                    className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
                  >
                    {t("sandbox", { provider: providerName(consent.provider) })}
                  </p>
                ) : null}
                <p className="text-sm">
                  {t("confirmDescription", {
                    plan: name(consent?.plan ?? plan),
                    amount: money(consent?.amount ?? amount),
                  })}
                </p>
                {consent ? (
                  <SubscriptionQuoteSummary quote={consent.quote} className="border-0 p-0" />
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {t("providerDescription", {
                    provider: providerName(consent?.provider ?? settings.data?.provider),
                  })}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t(consent?.isTest ? "testPaymentPolicy" : "renewalPolicy")}
                </p>
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
                {staleConsent ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      requestKey.current = "";
                      setConsent(null);
                      setAccepted(false);
                      setConfirmOpen(false);
                      setStaleConsent(false);
                      void quote.refetch();
                      refresh();
                    }}
                  >
                    {t("refreshQuote")}
                  </Button>
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
                  <Button type="submit" disabled={!accepted || staleConsent || checkout.isLoading}>
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

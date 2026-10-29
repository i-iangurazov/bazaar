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
import { QueryErrorState } from "@/components/query-error-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function SubscriptionPayments({ onUpdated }: { onUpdated: () => void }) {
  const t = useTranslations("billing.payments");
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [consent, setConsent] = useState<{
    plan: PlanCode;
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
  const amount = settings.data?.catalog.find((item) => item.plan === plan)?.amountMinor ?? 0;
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
            {settings.data.billingMode === "MANUAL" ? (
              <p className="text-sm text-muted-foreground">{t("manualAccess")}</p>
            ) : settings.data.accountPaused ? (
              <p className="text-sm text-muted-foreground">{t("accountPaused")}</p>
            ) : !settings.data.available ? (
              <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
            ) : null}
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
                <label htmlFor="subscription-plan" className="block text-sm font-medium">
                  {t("plan")}
                </label>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="w-full sm:max-w-xs">
                    <Select
                      value={plan}
                      onValueChange={(value) => {
                        setSelected(value as PlanCode);
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
                            disabled={
                              !settings.data?.mayChangePlan &&
                              item.plan !== settings.data.currentPlan
                            }
                          >
                            {name(item.plan)} · {money(item.amountMinor)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    onClick={() => {
                      if (!settings.data) return;
                      if (
                        !requestKey.current ||
                        (consent &&
                          (consent.plan !== plan ||
                            consent.amount !== amount ||
                            consent.termsVersion !== settings.data.termsVersion))
                      )
                        requestKey.current = crypto.randomUUID();
                      setConsent({
                        plan,
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
                    {t("pay", { amount: money(amount) })}
                  </Button>
                </div>
                {!settings.data.mayChangePlan ? (
                  <p className="text-xs text-muted-foreground">{t("planChangeHint")}</p>
                ) : null}
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

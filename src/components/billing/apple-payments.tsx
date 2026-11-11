"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc";
import { PLAN_CODES, type PlanCode } from "@/lib/billing/plans";
import { subscriptionSelectionSchema } from "@/lib/billing/subscriptionPricing";
import { formatDateTime } from "@/lib/i18nFormat";
import { toIntlLocale } from "@/lib/locales";
import { AppleRestoreSession } from "@/lib/native/appleRestoreSession";
import {
  finishAppleTransaction,
  getAppleTransactionHistory,
  getAppleProducts,
  isAppleBillingAvailable,
  purchaseAppleProduct,
  requestAppleRefund,
  restoreApplePurchases,
  showAppleSubscriptionManagement,
} from "@/lib/native/appleBilling";
import { QueryErrorState } from "@/components/query-error-state";
import { RestoreIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { IconButton } from "@/components/ui/icon-button";
import { Modal, ModalFooter } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Products = Awaited<ReturnType<typeof getAppleProducts>>["products"];
type Props = {
  kind: "SUBSCRIPTION" | "WHATSAPP_PACK";
  onUpdated: () => void;
  selectedPlan?: PlanCode | null;
  onPlanSelected?: (plan: PlanCode) => void;
  storeId?: string;
  canPurchase?: boolean;
};

export function ApplePayments({
  kind,
  onUpdated,
  selectedPlan,
  onPlanSelected,
  storeId,
  canPurchase = true,
}: Props) {
  const t = useTranslations("billingApple");
  const common = useTranslations("common");
  const plans = useTranslations("billing.plans");
  const errors = useTranslations("errors");
  const locale = useLocale();
  const catalog = trpc.billing.apple.catalog.useQuery(undefined, { retry: false });
  const intent = trpc.billing.apple.intent.useMutation();
  const confirm = trpc.billing.apple.confirm.useMutation();
  const restoreBatch = trpc.billing.apple.restore.useMutation();
  const cancel = trpc.billing.apple.cancelIntent.useMutation();
  const [products, setProducts] = useState<Products>([]);
  const [productsBusy, setProductsBusy] = useState(false);
  const [productIssue, setProductIssue] = useState(false);
  const [reloadProducts, setReloadProducts] = useState(0);
  const [plan, setPlan] = useState<PlanCode>("STARTER");
  const [months, setMonths] = useState(1);
  const [stores, setStores] = useState(0);
  const [reserve, setReserve] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [action, setAction] = useState<"RENEW" | "CHANGE">("RENEW");
  const [consentOpen, setConsentOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const running = useRef(false);
  const requestKey = useRef<{ selection: string; key: string } | null>(null);
  const nativeReady = isAppleBillingAvailable();
  const restoreSession = useMemo(() => new AppleRestoreSession(catalog.data?.organization.id ?? null), [catalog.data?.organization.id]);
  const restoreRef = useRef(restoreSession);
  restoreRef.current = restoreSession;
  const allOffers = catalog.data?.offers ?? [];
  const offers = allOffers.filter((offer) => offer.kind === kind);
  const selected = offers.find((offer) =>
    offer.kind === "SUBSCRIPTION"
      ? offer.selection?.plan === (selectedPlan ?? plan) &&
        offer.selection.months === months &&
        offer.selection.extras.stores === stores &&
        offer.selection.extras.productPacks === reserve
      : offer.quantity === quantity,
  );
  const product = products.find((item) => item.id === selected?.productId);
  const needsQuote = selected?.kind === "SUBSCRIPTION" && selected.productType === "NON_RENEWING";
  const preview = trpc.billing.apple.preview.useQuery(
    {
      expectedOrganizationId: catalog.data?.organization.id ?? "",
      offerKey: selected?.offerKey ?? "",
      action,
    },
    {
      enabled: Boolean(nativeReady && catalog.data?.ready && selected?.available && needsQuote),
      retry: false,
      staleTime: 30_000,
    },
  );
  const productIds = [
    ...new Set(offers.flatMap((offer) => (offer.productId ? [offer.productId] : []))),
  ]
    .sort()
    .join("\n");
  const selectionKey = `${catalog.data?.organization.id ?? ""}:${selected?.offerKey ?? ""}:${action}:${catalog.data?.termsVersion ?? ""}:${product?.displayPrice ?? ""}:${needsQuote ? (preview.data?.quoteToken ?? "") : ""}`;
  const consentKey = useRef("");
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || !catalog.data) return;
    initialized.current = true;
    setPlan(catalog.data.access.plan as PlanCode);
    setStores(catalog.data.access.extras.stores);
    setReserve(catalog.data.access.extras.productPacks);
  }, [catalog.data]);
  const actionsKey = selected?.availableActions.join(",") ?? "";
  useEffect(() => {
    const actions = actionsKey.split(",");
    if (actionsKey && !actions.includes(action)) setAction(actions[0] as "RENEW" | "CHANGE");
  }, [actionsKey, action]);

  useEffect(() => {
    setAccepted(false);
    setConsentOpen(false);
    // A failed network request keeps its idempotency key until the offer changes.
    if (requestKey.current?.selection !== selectionKey) requestKey.current = null;
  }, [selectionKey]);

  useEffect(() => {
    let active = true;
    setProducts([]);
    setProductIssue(false);
    if (!nativeReady || !productIds) {
      setProductsBusy(false);
      return;
    }
    setProductsBusy(true);
    void getAppleProducts(productIds.split("\n"))
      .then((result) => {
        if (active) {
          setProducts(result.products);
          setProductIssue(result.missingProductIds.length > 0);
        }
      })
      .catch(() => {
        if (active) setProductIssue(true);
      })
      .finally(() => {
        if (active) setProductsBusy(false);
      });
    return () => {
      active = false;
    };
  }, [productIds, nativeReady, reloadProducts]);

  useEffect(() => {
    if (!nativeReady) return;
    let lastRefresh = 0;
    const resume = () => {
      if (busy || document.hidden || navigator.onLine === false || Date.now() - lastRefresh < 10_000) return;
      lastRefresh = Date.now();
      setReloadProducts((value) => value + 1);
    };
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    window.addEventListener("bazaar:apple-retry", resume);
    return () => {
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("bazaar:apple-retry", resume);
    };
  }, [nativeReady, busy]);

  const messageFor = (error: unknown) => {
    const key =
      error &&
      typeof error === "object" &&
      "serverCode" in error &&
      typeof error.serverCode === "string"
        ? error.serverCode
        : error instanceof Error
          ? error.message
          : "";
    return key && errors.has(key) ? errors(key) : t("operationFailed");
  };
  const refresh = async () => {
    await catalog.refetch();
    if (needsQuote && selected?.available && catalog.data?.ready) await preview.refetch();
    onUpdated();
  };
  const run = async (operation: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setNotice("");
    try {
      await operation();
    } catch (error) {
      setNotice(messageFor(error));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const buy = () =>
    run(async () => {
      if (
        !selected?.available ||
        !product ||
        !accepted ||
        consentKey.current !== selectionKey ||
        !catalog.data
      )
        return;
      requestKey.current ??= { selection: selectionKey, key: crypto.randomUUID() };
      const authorization = await intent.mutateAsync({
        offerKey: selected.offerKey,
        action,
        idempotencyKey: requestKey.current.key,
        expectedOrganizationId: catalog.data.organization.id,
        termsVersion: catalog.data.termsVersion,
        ...(needsQuote && preview.data?.quoteToken ? { quoteToken: preview.data.quoteToken } : {}),
        acceptedTerms: true,
        storeId,
      });
      let result;
      try { result = await purchaseAppleProduct(authorization.intentId); }
      catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "APPLE_SUBSCRIPTION_ACCOUNT_CONFLICT") {
          // This native preflight runs before the payment sheet. Generic native
          // errors may conceal a paid transaction and must never cancel here.
          try { await cancel.mutateAsync({ intentId: authorization.intentId }); requestKey.current = null; }
          catch { /* The same intent remains available for cancellation retry. */ }
          await refresh();
        }
        throw error;
      }
      setConsentOpen(false);
      setAccepted(false);
      if (result.status === "cancelled") {
        let acknowledged = result.cancellationAcknowledged;
        let recorded = result.cancellationRecorded;
        if (!acknowledged && !recorded) {
          try {
            const response = await cancel.mutateAsync({ intentId: authorization.intentId });
            acknowledged = response.canceled; recorded = response.recorded;
          } catch { /* Native keeps the terminal cancellation until a durable ACK. */ }
        }
        requestKey.current = null;
        setNotice(t(recorded ? "cancellationRecorded" : acknowledged ? "cancelled" : "cancellationPending"));
        if (!acknowledged || recorded) window.dispatchEvent(new Event("bazaar:apple-retry"));
      } else if (result.status === "pending") {
        setNotice(t("pending"));
      } else {
        const saved = await confirm.mutateAsync({
          signedTransactionInfo: result.transaction.signedTransactionInfo,
          intentId: authorization.intentId,
        });
        requestKey.current = null;
        setNotice(
          t(
            saved.status === "GRANTED"
              ? "confirmed"
              : saved.status === "REVOKED"
                ? "revoked"
                : "review",
          ),
        );
        // Access is already durable even if StoreKit acknowledgment loses its
        // connection. Refresh it before independently retrying native finish.
        await refresh();
        try { await finishAppleTransaction(result.transaction.transactionId); }
        catch {
          if (saved.status === "GRANTED") setNotice(t("confirmedRecoveryPending"));
          window.dispatchEvent(new Event("bazaar:apple-retry"));
        }
        return;
      }
      await refresh();
    });
  const restore = () =>
    run(async () => {
      let result;
      try {
        result = await restoreSession.resume({
          begin: restoreApplePurchases,
          next: getAppleTransactionHistory,
          record: (signedTransactions) => restoreBatch.mutateAsync({ signedTransactions }),
          finish: finishAppleTransaction,
          progress: (count) => setNotice(t("restoring", { count })),
          isCurrent: () => restoreRef.current === restoreSession,
        });
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "data" in error &&
          (error.data as { code?: string } | undefined)?.code === "TOO_MANY_REQUESTS"
        ) {
          setNotice(t("restoreWait"));
          return;
        }
        throw error;
      } finally {
        await refresh();
      }
      setNotice(t(result.review ? "review" : "restored"));
    });

  const access = catalog.data?.access;
  const scheduledOffer = access?.appleScheduledChange?.offer;
  const scheduledSelection = subscriptionSelectionSchema.safeParse(
    scheduledOffer && typeof scheduledOffer === "object" && !Array.isArray(scheduledOffer) && "selection" in scheduledOffer
      ? scheduledOffer.selection
      : undefined,
  );
  const period = product?.subscriptionPeriod;
  const productMatches = Boolean(
    product &&
    selected?.productType === product.type &&
    (product.type !== "AUTO_RENEWABLE" ||
      (period &&
        ((period.unit === "month" && period.value === months) ||
          (period.unit === "year" && period.value * 12 === months)))),
  );
  const actionAllowed = selected?.availableActions.includes(action) ?? false;
  const blocked =
    !nativeReady ||
    !catalog.data?.ready ||
    !selected?.available ||
    !actionAllowed ||
    (needsQuote && (!preview.data?.quoteToken || preview.isFetching || preview.isError)) ||
    !productMatches ||
    productsBusy ||
    busy ||
    !canPurchase;
  const subscriptions = allOffers.filter((offer) => offer.kind === "SUBSCRIPTION");
  const planOffers = subscriptions.filter(
    (offer) => offer.selection?.plan === (selectedPlan ?? plan),
  );
  const storeOptions = [
    ...new Set(planOffers.map((offer) => offer.selection?.extras.stores ?? 0)),
  ].sort((a, b) => a - b);
  const reserveOptions = [
    ...new Set(planOffers.map((offer) => offer.selection?.extras.productPacks ?? 0)),
  ].sort((a, b) => a - b);
  const dates = (date: Date | string) => formatDateTime(date, locale);

  return (
    <Card
      id={kind === "SUBSCRIPTION" ? "subscription-checkout" : undefined}
      data-apple-payments={kind}
      className="scroll-mt-24"
    >
      <CardHeader className="gap-1">
        <CardTitle>{t(kind === "SUBSCRIPTION" ? "title" : "whatsappTitle")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("organizationAccess")}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        {catalog.isLoading ? (
          <p role="status">{common("loading")}</p>
        ) : catalog.isError ? (
          <QueryErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />
        ) : catalog.data ? (
          <>
            {kind === "SUBSCRIPTION" && access ? (
              <div
                className="space-y-2 rounded-md border border-border p-3 text-sm"
                data-apple-shared-access
              >
                <p>{t(access.lifetimeAccess ? "lifetime" : "existingAccess")}</p>
                <p className="font-medium">{catalog.data.organization.name}</p>
                <p>{t("source", { provider: t(`providers.${access.source}`) })}</p>
                <p>
                  {t("currentSelection", {
                    plan: plans(`${String(access.plan).toLowerCase()}.name`),
                    stores: access.extras.stores,
                    reserve: access.extras.productPacks,
                  })}
                </p>
                {access.paidUntil ? (
                  <p>{t("paidUntil", { date: dates(access.paidUntil) })}</p>
                ) : null}
                {access.trialUntil ? (
                  <p>{t("trialUntil", { date: dates(access.trialUntil) })}</p>
                ) : null}
                <p>{t("noRepurchase")}</p>
                {access.appleAutoRenew ? <p>{t("autoRenewActive")}</p> : null}
                {access.appleScheduledChange ? (
                  <div className="space-y-1 border-t border-border pt-2" data-apple-scheduled-change>
                    <p className="font-medium">{t("scheduledChange")}</p>
                    {scheduledSelection.success ? (
                      <>
                        <p>{t("currentSelection", {
                          plan: plans(`${scheduledSelection.data.plan.toLowerCase()}.name`),
                          stores: scheduledSelection.data.extras.stores,
                          reserve: scheduledSelection.data.extras.productPacks,
                        })}</p>
                        <p>{t("monthCount", { count: scheduledSelection.data.months })}</p>
                      </>
                    ) : <p>{t("scheduledChangeDetails")}</p>}
                    {access.appleScheduledChange.startsAt ? (
                      <p>{t("scheduledChangeStarts", { date: dates(access.appleScheduledChange.startsAt) })}</p>
                    ) : null}
                    <p>{t("scheduledChangeHint")}</p>
                  </div>
                ) : null}
                {access.appleIssue ? (
                  <p role="status" className="rounded-md bg-warning/10 p-2" data-apple-access-issue>
                    {errors.has(access.appleIssue) ? errors(access.appleIssue) : t("review")}
                  </p>
                ) : null}
              </div>
            ) : null}
            {!nativeReady || !catalog.data.ready ? (
              <p role="status" className="rounded-md bg-muted p-3 text-sm">
                {t("unavailable")}
              </p>
            ) : null}
            {catalog.data.environment === "Sandbox" ? (
              <Badge variant="warning">{t("sandbox")}</Badge>
            ) : null}
            {catalog.data.pendingIntent ? (
              <p role="status" className="rounded-md bg-warning/10 p-3 text-sm">
                {t("pending")}
              </p>
            ) : null}
            {kind === "SUBSCRIPTION" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <AppleChoice
                  label={t("plan")}
                  value={selectedPlan ?? plan}
                  onChange={(value) => {
                    const next = value as PlanCode;
                    setPlan(next);
                    onPlanSelected?.(next);
                    setStores(0);
                    setReserve(0);
                  }}
                  options={PLAN_CODES.map((code) => ({
                    value: code,
                    label: plans(`${code.toLowerCase()}.name`),
                  }))}
                  disabled={busy}
                />
                <AppleChoice
                  label={t("months")}
                  value={String(months)}
                  onChange={(value) => setMonths(Number(value))}
                  options={[1, 6, 12].map((value) => ({
                    value: String(value),
                    label: t("monthCount", { count: value }),
                  }))}
                  disabled={busy}
                />
                <AppleChoice
                  label={t("additionalStores")}
                  value={String(stores)}
                  onChange={(value) => setStores(Number(value))}
                  options={storeOptions.map((value) => ({
                    value: String(value),
                    label: String(value),
                  }))}
                  disabled={busy}
                />
                <AppleChoice
                  label={t("reserve")}
                  value={String(reserve)}
                  onChange={(value) => setReserve(Number(value))}
                  options={reserveOptions.map((value) => ({
                    value: String(value),
                    label: t(value ? "reserveIncluded" : "withoutReserve"),
                  }))}
                  disabled={busy}
                />
                <AppleChoice
                  label={t("action")}
                  value={action}
                  onChange={(value) => setAction(value as "RENEW" | "CHANGE")}
                  options={[
                    { value: "RENEW", label: t("renew") },
                    { value: "CHANGE", label: t("change") },
                  ]}
                  disabled={busy}
                />
              </div>
            ) : (
              <AppleChoice
                label={t("messages")}
                value={String(quantity)}
                onChange={(value) => setQuantity(Number(value))}
                options={offers.flatMap((offer) =>
                  offer.kind === "WHATSAPP_PACK"
                    ? [
                        {
                          value: String(offer.quantity),
                          label: t("messageCount", { count: offer.messages }),
                        },
                      ]
                    : [],
                )}
                disabled={busy}
              />
            )}
            <div className="space-y-2 rounded-md bg-muted/50 p-4" data-apple-price>
              {productsBusy ? (
                <p role="status">{common("loading")}</p>
              ) : product ? (
                <>
                  <p className="font-semibold">{product.displayName}</p>
                  <p className="text-xl font-semibold tabular-nums">{product.displayPrice}</p>
                  <p className="text-sm text-muted-foreground">{product.description}</p>
                  <p className="text-sm">
                    {t(
                      product.type === "AUTO_RENEWABLE"
                        ? "recurringTerms"
                        : kind === "WHATSAPP_PACK"
                          ? "creditTerms"
                          : "prepaidTerms",
                      { count: months },
                    )}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t("priceUnavailable")}</p>
              )}
              {selected?.kind === "SUBSCRIPTION" && selected.entitlements ? (
                <p className="text-sm" data-apple-limits>
                  {t("limits", {
                    stores: selected.entitlements.limits.maxStores,
                    products: selected.entitlements.limits.maxProducts,
                    users: selected.entitlements.limits.maxActiveUsers,
                  })}
                </p>
              ) : null}
              {selected?.unavailableReason && errors.has(selected.unavailableReason) ? (
                <p className="text-sm">{errors(selected.unavailableReason)}</p>
              ) : null}
              {!actionAllowed &&
              selected &&
              (action === "CHANGE"
                ? selected.changeUnavailableReason
                : selected.renewUnavailableReason) ? (
                <p className="text-sm">
                  {messageFor(
                    new Error(
                      (action === "CHANGE"
                        ? selected.changeUnavailableReason
                        : selected.renewUnavailableReason)!,
                    ),
                  )}
                </p>
              ) : null}
              {product && !productMatches ? (
                <p role="alert" className="text-sm text-danger">
                  {t("productMismatch")}
                </p>
              ) : null}
              {action === "CHANGE" && kind === "SUBSCRIPTION" ? (
                <p className="text-sm">{t("changeTiming")}</p>
              ) : null}
              {needsQuote && preview.data?.timing ? (
                <p className="text-sm" data-apple-period>
                  {t("period", {
                    start: dates(preview.data.timing.startsAt),
                    end: dates(preview.data.timing.endsAt),
                  })}
                </p>
              ) : null}
              {needsQuote && preview.isError ? (
                <QueryErrorState error={preview.error} onRetry={() => void preview.refetch()} />
              ) : null}
            </div>
            <Button
              disabled={blocked}
              onClick={() => {
                consentKey.current = selectionKey;
                setAccepted(false);
                setConsentOpen(true);
              }}
            >
              {t("buy", { price: product?.displayPrice ?? "—" })}
            </Button>
            {productIssue ? (
              <p role="status" className="text-sm text-muted-foreground">
                {t("someProductsUnavailable")}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={busy || !nativeReady}
                onClick={() => void restore()}
              >
                {t(restoreSession.pending ? "resumeRestore" : "restore")}
              </Button>
              <Button
                variant="secondary"
                disabled={busy || !nativeReady}
                onClick={() =>
                  void run(async () => {
                    await showAppleSubscriptionManagement();
                    await refresh();
                  })
                }
              >
                {t("manage")}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  window.dispatchEvent(new Event("bazaar:apple-retry"));
                  setReloadProducts((value) => value + 1);
                  void refresh();
                }}
              >
                {t("retry")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("restoreOrganization")}</p>
            <div className="flex flex-wrap gap-4 text-xs text-primary underline">
              <a href={catalog.data.termsUrl} target="_blank" rel="noopener noreferrer">
                {t("terms")}
              </a>
              <a href="https://www.bazaar.kg/privacy" target="_blank" rel="noopener noreferrer">
                {t("privacy")}
              </a>
            </div>
            <details className="rounded-md border border-border p-3" data-apple-history>
              <summary className="cursor-pointer text-sm font-medium">{t("history")}</summary>
              <div className="mt-3 divide-y">
                {catalog.data.recentTransactions.length ? (
                  catalog.data.recentTransactions.map((transaction) => (
                    <div
                      key={transaction.transactionId}
                      className="flex items-start justify-between gap-3 py-3 text-sm"
                    >
                      <div className="space-y-1">
                        <p>
                          {t("paidAmount", {
                            amount:
                              applePaidAmount(
                                transaction.priceMillis,
                                transaction.currency,
                                locale,
                              ) ?? t("amountUnavailable"),
                          })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {dates(transaction.purchaseDate)} · {t(`statuses.${transaction.status}`)}
                        </p>
                        {transaction.expiresDate ? (
                          <p className="text-xs text-muted-foreground">
                            {t("paidUntil", { date: dates(transaction.expiresDate) })}
                          </p>
                        ) : null}
                        {transaction.environment === "Sandbox" ? (
                          <Badge variant="warning">{t("sandbox")}</Badge>
                        ) : null}
                      </div>
                      {transaction.refundable ? (
                        <IconButton
                          icon={RestoreIcon}
                          label={t("refund")}
                          variant="ghost"
                          disabled={busy || !nativeReady}
                          onClick={() =>
                            void run(async () => {
                              const result = await requestAppleRefund(transaction.transactionId);
                              setNotice(
                                t(
                                  result.status === "submitted"
                                    ? "refundSubmitted"
                                    : "refundCancelled",
                                ),
                              );
                              await refresh();
                            })
                          }
                        />
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="py-2 text-sm text-muted-foreground">{t("historyEmpty")}</p>
                )}
              </div>
            </details>
            {notice ? (
              <p role="status" className="rounded-md border border-border p-3 text-sm">
                {notice}
              </p>
            ) : null}
          </>
        ) : null}
        <Modal
          open={consentOpen}
          onOpenChange={(open) => {
            if (!busy) setConsentOpen(open);
          }}
          title={t("confirmTitle")}
        >
          <div className="space-y-4">
            <p className="font-semibold">
              {product?.displayName} · {product?.displayPrice}
            </p>
            <p className="font-medium">{catalog.data?.organization.name}</p>
            {needsQuote && preview.data?.timing ? (
              <p className="text-sm">
                {t("period", {
                  start: dates(preview.data.timing.startsAt),
                  end: dates(preview.data.timing.endsAt),
                })}
              </p>
            ) : null}
            <p className="text-sm">
              {t(
                product?.type === "AUTO_RENEWABLE"
                  ? "recurringTerms"
                  : kind === "WHATSAPP_PACK"
                    ? "creditTerms"
                    : "prepaidTerms",
                { count: months },
              )}
            </p>
            <p className="text-sm">{t("organizationBinding")}</p>
            <div className="flex items-start gap-3">
              <Checkbox
                id={`apple-terms-${kind}`}
                checked={accepted}
                onCheckedChange={(value) => setAccepted(value === true)}
                disabled={busy}
              />
              <label htmlFor={`apple-terms-${kind}`} className="text-sm leading-5">
                {t("acceptTerms")}{" "}
                {catalog.data?.termsUrl ? (
                  <a
                    href={catalog.data.termsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    {t("terms")}
                  </a>
                ) : null}
              </label>
            </div>
            {notice ? (
              <p role="alert" className="text-sm text-danger">
                {notice}
              </p>
            ) : null}
            <ModalFooter>
              <Button variant="secondary" disabled={busy} onClick={() => setConsentOpen(false)}>
                {common("cancel")}
              </Button>
              <Button disabled={blocked || !accepted} onClick={() => void buy()}>
                {busy ? common("loading") : t("confirmPurchase")}
              </Button>
            </ModalFooter>
          </div>
        </Modal>
      </CardContent>
    </Card>
  );
}

function applePaidAmount(millis: string | null, currency: string | null, locale: string) {
  if (millis === null || !currency || !/^[A-Z]{3}$/.test(currency)) return null;
  try {
    const amount = BigInt(millis);
    if (amount < 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return new Intl.NumberFormat(toIntlLocale(locale), { style: "currency", currency }).format(
      Number(amount) / 1000,
    );
  } catch {
    return null;
  }
}

function AppleChoice({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <Select aria-label={label} value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

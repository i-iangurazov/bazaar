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
  getAppleStorefront,
  isAppleBillingAvailable,
  purchaseAppleProduct,
  requestAppleRefund,
  restoreApplePurchases,
  showAppleSubscriptionManagement,
  type AppleStorefront,
} from "@/lib/native/appleBilling";
import { AppleTemporaryUpgradeDetails, AppleTemporaryUpgradeHistory } from "@/components/billing/apple-temporary-upgrade";
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
  const nativeReady = isAppleBillingAvailable();
  const catalog = trpc.billing.apple.catalog.useQuery(undefined, { retry: false });
  const temporaryCatalog = trpc.billing.apple.temporaryUpgradeCatalog.useQuery(undefined, {
    enabled: nativeReady && kind === "SUBSCRIPTION", retry: false,
  });
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
  const [storefront, setStorefront] = useState<AppleStorefront | null>(null);
  const [storefrontBusy, setStorefrontBusy] = useState(false);
  const [storefrontIssue, setStorefrontIssue] = useState(false);
  const [quoteExpired, setQuoteExpired] = useState(false);
  const actionSelected = useRef(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const running = useRef(false);
  const requestKey = useRef<{ selection: string; key: string } | null>(null);
  const restoreSession = useMemo(() => new AppleRestoreSession(catalog.data?.organization.id ?? null), [catalog.data?.organization.id]);
  const restoreRef = useRef(restoreSession);
  restoreRef.current = restoreSession;
  const allOffers = catalog.data?.offers ?? [];
  const offers = allOffers.filter((offer) => offer.kind === kind);
  const managedApple = Boolean(catalog.data?.access.appleAutoRenew || catalog.data?.access.appleCoverageUntil);
  const temporaryChange = kind === "SUBSCRIPTION" && action === "CHANGE" && !managedApple;
  const selected = offers.find((offer) =>
    offer.kind === "SUBSCRIPTION"
      ? offer.selection?.plan === (selectedPlan ?? plan) &&
        offer.selection.months === months &&
        offer.selection.extras.stores === stores &&
        offer.selection.extras.productPacks === reserve
      : offer.quantity === quantity,
  );
  const needsQuote = !temporaryChange && selected?.kind === "SUBSCRIPTION" && selected.productType === "NON_RENEWING";
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
  const temporaryProductIds = (temporaryCatalog.data?.products ?? []).map((entry) => entry.productId).sort().join("\n");
  const currencyProduct = products.find((item) => item.storefrontId === storefront?.id &&
    temporaryProductIds.split("\n").includes(item.id) && item.type === "NON_RENEWING");
  const temporaryCurrency = currencyProduct?.currencyCode ?? "";
  const supportedMarket = Boolean(storefront && temporaryCatalog.data?.markets.some((market) =>
    market.storefrontId === storefront.id && market.currency === temporaryCurrency));
  const temporaryPreview = trpc.billing.apple.previewTemporaryUpgrade.useQuery({
    expectedOrganizationId: catalog.data?.organization.id ?? "",
    selection: { plan: selectedPlan ?? plan, months: 1, extras: { stores, productPacks: reserve, userPacks: 0 } },
    storefrontId: storefront?.id ?? "",
    currency: temporaryCurrency,
  }, {
    enabled: Boolean(temporaryChange && nativeReady && temporaryCatalog.data?.ready && supportedMarket && !productsBusy && !storefrontBusy),
    retry: false, staleTime: 30_000,
  });
  const temporaryQuote = temporaryChange ? temporaryPreview.data : undefined;
  const product = products.find((item) => item.id === (temporaryChange ? temporaryQuote?.productId : selected?.productId));
  const constraint = temporaryQuote?.priceConstraint;
  const temporaryProductMatches = Boolean(product && constraint && product.id === temporaryQuote?.productId && product.type === "NON_RENEWING" &&
    product.priceMillis === constraint.priceMillis && product.currencyCode === constraint.currency &&
    product.storefrontId === constraint.storefrontId && storefront?.id === constraint.storefrontId && supportedMarket);
  const temporarySelectionMatches = Boolean(temporaryQuote && temporaryQuote.organization.id === catalog.data?.organization.id &&
    temporaryCatalog.data?.organization.id === catalog.data?.organization.id && temporaryQuote.selection.plan === (selectedPlan ?? plan) &&
    temporaryQuote.selection.extras.stores === stores && temporaryQuote.selection.extras.productPacks === reserve &&
    temporaryQuote.selection.extras.userPacks === 0);
  const productIds = [
    ...new Set(temporaryChange ? (temporaryCatalog.data?.ready ? temporaryCatalog.data.products.map((entry) => entry.productId) : [])
      : offers.flatMap((offer) => (offer.productId ? [offer.productId] : []))),
  ]
    .sort()
    .join("\n");
  const selectionKey = JSON.stringify([catalog.data?.organization.id, temporaryChange ? temporaryQuote?.offerKey : selected?.offerKey,
    action, selectedPlan ?? plan, temporaryChange ? null : months, stores, reserve, catalog.data?.termsVersion,
    product?.id, product?.displayPrice, product?.priceMillis, product?.currencyCode, product?.storefrontId,
    temporaryChange ? temporaryQuote?.quoteToken : needsQuote ? preview.data?.quoteToken : null,
    temporaryChange ? temporaryCatalog.data?.policyVersion : null,
    temporaryChange ? [temporaryCatalog.data?.ready, temporaryCatalog.isError, temporaryPreview.isError, storefront?.id] : null,
    temporaryChange ? [temporaryQuote?.timing, temporaryQuote?.source, temporaryQuote?.target, constraint] : null]);
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
    // Keep automatic same-group initialization. A chosen temporary CHANGE must
    // never silently become a full next-period purchase when eligibility changes.
    if (!actionSelected.current && managedApple && actionsKey && !actions.includes(action)) setAction(actions[0] as "RENEW" | "CHANGE");
  }, [actionsKey, action, managedApple]);

  useEffect(() => {
    let active = true;
    setStorefront(null);
    setStorefrontIssue(false);
    if (!temporaryChange || !nativeReady || !temporaryCatalog.data?.ready) {
      setStorefrontBusy(false);
      return;
    }
    setStorefrontBusy(true);
    void getAppleStorefront().then((value) => {
      if (active) {
        if (/^[0-9]+$/.test(value.id)) setStorefront(value);
        else setStorefrontIssue(true);
      }
    }).catch(() => { if (active) setStorefrontIssue(true); })
      .finally(() => { if (active) setStorefrontBusy(false); });
    return () => { active = false; };
  }, [temporaryChange, nativeReady, temporaryCatalog.data?.ready, catalog.data?.organization.id, reloadProducts]);

  const temporaryValidUntil = temporaryQuote?.timing.validUntil;
  useEffect(() => {
    if (!temporaryChange || !temporaryValidUntil) { setQuoteExpired(false); return; }
    const delay = new Date(temporaryValidUntil).getTime() - Date.now();
    if (!Number.isFinite(delay) || delay <= 0) { setQuoteExpired(true); return; }
    setQuoteExpired(false);
    const timer = window.setTimeout(() => { setQuoteExpired(true); setAccepted(false); setConsentOpen(false); }, Math.min(delay, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [temporaryChange, temporaryValidUntil, temporaryQuote?.quoteToken]);

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
    const nativeCode = error && typeof error === "object" && "code" in error ? error.code : null;
    if (nativeCode === "APPLE_STOREFRONT_UNAVAILABLE") return t("storefrontUnavailable");
    if (nativeCode === "APPLE_STOREFRONT_CHANGED") return t("storefrontChanged");
    if (nativeCode === "APPLE_PRICE_CHANGED") return t("priceChanged");
    const key =
      error &&
      typeof error === "object" &&
      "serverCode" in error &&
      typeof error.serverCode === "string"
        ? error.serverCode
        : error instanceof Error
          ? error.message
          : error && typeof error === "object" && "code" in error && typeof error.code === "string"
            ? error.code
            : "";
    return key && errors.has(key) ? errors(key) : t("operationFailed");
  };
  const refresh = async () => {
    await catalog.refetch();
    if (temporaryChange) {
      await temporaryCatalog.refetch();
      if (supportedMarket && temporaryCatalog.data?.ready) await temporaryPreview.refetch();
    } else if (needsQuote && selected?.available && catalog.data?.ready) await preview.refetch();
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
      const offerKey = temporaryChange ? temporaryQuote?.offerKey : selected?.offerKey;
      if (temporaryChange && temporaryQuote && new Date(temporaryQuote.timing.validUntil).getTime() <= Date.now()) {
        setQuoteExpired(true); setAccepted(false); setConsentOpen(false); setNotice(t("temporaryQuoteExpired")); return;
      }
      if (
        !offerKey ||
        (temporaryChange ? !temporaryQuote || !temporaryCatalog.data?.ready || quoteExpired || temporaryPreview.isFetching || temporaryPreview.isError ||
          !temporaryProductMatches || !temporarySelectionMatches
          : !selected?.available) ||
        !product ||
        !accepted ||
        consentKey.current !== selectionKey ||
        !catalog.data
      )
        return;
      requestKey.current ??= { selection: selectionKey, key: crypto.randomUUID() };
      const authorization = await intent.mutateAsync({
        offerKey,
        action,
        idempotencyKey: requestKey.current.key,
        expectedOrganizationId: catalog.data.organization.id,
        termsVersion: catalog.data.termsVersion,
        ...(temporaryChange && temporaryQuote ? { quoteToken: temporaryQuote.quoteToken }
          : needsQuote && preview.data?.quoteToken ? { quoteToken: preview.data.quoteToken } : {}),
        acceptedTerms: true,
        storeId,
      });
      if (temporaryChange && authorization.productId !== product.id) {
        // This fresh intent has not been handed to native. The server's soft
        // cancellation still refuses any already-authorized winning attempt.
        try { await cancel.mutateAsync({ intentId: authorization.intentId }); } catch { /* Reconciliation remains server-owned. */ }
        requestKey.current = null;
        await refresh();
        throw new Error("appleTemporaryUpgradePriceChanged");
      }
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
      if (result.status === "cancelled" || result.status === "not_started") {
        const acknowledged = result.cancellationAcknowledged;
        const recorded = result.cancellationRecorded;
        // Authorized cancellations belong to the native attempt. The website
        // cannot use a generic RPC to cancel a different device's live attempt.
        requestKey.current = null;
        setNotice(recorded ? t("cancellationRecorded") : result.status === "not_started"
          ? t(acknowledged ? "purchaseNotStarted" : "purchaseNotStartedPending", { reason: messageFor(result.error) })
          : t(acknowledged ? "cancelled" : "cancellationPending"));
        if (!acknowledged || recorded) window.dispatchEvent(new Event("bazaar:apple-retry"));
      } else if (result.status === "pending") {
        setNotice(t("pending"));
      } else {
        let saved;
        try {
          saved = await confirm.mutateAsync({
            signedTransactionInfo: result.transaction.signedTransactionInfo,
            intentId: authorization.intentId,
          });
        } catch (error) {
          if (!temporaryChange) throw error;
          setNotice(t("temporaryConfirmationPending", { reason: messageFor(error) }));
          window.dispatchEvent(new Event("bazaar:apple-retry"));
          // A paid outcome may already be durable despite a lost response. Keep
          // the same intent key and let signed-receipt recovery decide access.
          try { await refresh(); } catch { /* The recovery notice remains visible offline. */ }
          return;
        }
        requestKey.current = null;
        setNotice(
          t(
            saved.status === "GRANTED"
              ? temporaryChange ? "temporaryRecorded" : "confirmed"
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
          if (saved.status === "GRANTED") setNotice(t(temporaryChange ? "temporaryRecoveryPending" : "confirmedRecoveryPending"));
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
  const productMatches = temporaryChange ? temporaryProductMatches : Boolean(
    product &&
    selected?.productType === product.type &&
    (product.type !== "AUTO_RENEWABLE" ||
      (period &&
        ((period.unit === "month" && period.value === months) ||
          (period.unit === "year" && period.value * 12 === months)))),
  );
  const actionAllowed = temporaryChange ? Boolean(temporaryCatalog.data?.ready) : selected?.availableActions.includes(action) ?? false;
  const visibleEntitlements = temporaryChange ? temporaryQuote?.target.entitlements
    : selected?.kind === "SUBSCRIPTION" ? selected.entitlements : undefined;
  const blocked =
    !nativeReady ||
    !(temporaryChange ? temporaryCatalog.data?.ready : catalog.data?.ready) ||
    !(temporaryChange ? temporaryQuote : selected?.available) ||
    !actionAllowed ||
    (temporaryChange && catalog.data?.pendingIntent?.scope === "SUBSCRIPTION") ||
    (needsQuote && (!preview.data?.quoteToken || preview.isFetching || preview.isError)) ||
    (temporaryChange && (!temporaryQuote || !temporarySelectionMatches || temporaryPreview.isFetching || temporaryPreview.isError || quoteExpired || storefrontBusy || storefrontIssue)) ||
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
            {kind === "SUBSCRIPTION" ? <AppleTemporaryUpgradeHistory upgrades={catalog.data.temporaryUpgrades ?? []} /> : null}
            {!nativeReady || !(temporaryChange ? temporaryCatalog.data?.ready : catalog.data.ready) ? (
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
                    if (!temporaryChange) { setStores(0); setReserve(0); }
                  }}
                  options={PLAN_CODES.map((code) => ({
                    value: code,
                    label: plans(`${code.toLowerCase()}.name`),
                  }))}
                  disabled={busy}
                />
                {!temporaryChange ? <AppleChoice
                  label={t("months")}
                  value={String(months)}
                  onChange={(value) => setMonths(Number(value))}
                  options={[1, 6, 12].map((value) => ({
                    value: String(value),
                    label: t("monthCount", { count: value }),
                  }))}
                  disabled={busy}
                /> : null}
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
                  onChange={(value) => { actionSelected.current = true; setAction(value as "RENEW" | "CHANGE"); }}
                  options={[
                    { value: "RENEW", label: t("renew") },
                    { value: "CHANGE", label: t(managedApple ? "change" : "temporaryChange") },
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
              {productsBusy || (temporaryChange && (temporaryCatalog.isLoading || storefrontBusy || temporaryPreview.isFetching)) ? (
                <p role="status">{common("loading")}</p>
              ) : product ? (
                <>
                  <p className="font-semibold">{product.displayName}</p>
                  <p className="text-xl font-semibold tabular-nums">{product.displayPrice}</p>
                  <p className="text-sm text-muted-foreground">{product.description}</p>
                  <p className="text-sm">
                    {temporaryChange ? t("temporaryTerms") : t(
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
              {visibleEntitlements ? (
                <p className="text-sm" data-apple-limits>
                  {t("limits", {
                    stores: visibleEntitlements.limits.maxStores,
                    products: visibleEntitlements.limits.maxProducts,
                    users: visibleEntitlements.limits.maxActiveUsers,
                  })}
                </p>
              ) : null}
              {!temporaryChange && selected?.unavailableReason && errors.has(selected.unavailableReason) ? (
                <p className="text-sm">{errors(selected.unavailableReason)}</p>
              ) : null}
              {!temporaryChange && !actionAllowed &&
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
              {action === "CHANGE" && kind === "SUBSCRIPTION" && !temporaryChange ? (
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
              {temporaryChange ? (
                <div className="space-y-2" data-apple-temporary-checkout>
                  {temporaryQuote ? <AppleTemporaryUpgradeDetails quote={temporaryQuote} /> : null}
                  {temporaryCatalog.isError ? <QueryErrorState error={temporaryCatalog.error} onRetry={() => void temporaryCatalog.refetch()} /> : null}
                  {temporaryCatalog.data && !temporaryCatalog.data.ready ? (
                    <p role="status">{messageFor(new Error(temporaryCatalog.data.unavailableReason ?? "appleTemporaryUpgradePolicyUnavailable"))}</p>
                  ) : null}
                  {storefrontIssue ? <p role="status">{t("storefrontUnavailable")}</p> : null}
                  {temporaryCatalog.data?.ready && storefront && !productsBusy && !storefrontBusy && !supportedMarket ? (
                    <p role="status">{t("temporaryMarketUnavailable")}</p>
                  ) : null}
                  {temporaryPreview.isError ? <QueryErrorState error={temporaryPreview.error} onRetry={() => void temporaryPreview.refetch()} /> : null}
                  {quoteExpired ? <p role="status">{t("temporaryQuoteExpired")}</p> : null}
                </div>
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
              <a href="/privacy" target="_blank" rel="noopener noreferrer">
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
            {temporaryQuote ? <AppleTemporaryUpgradeDetails quote={temporaryQuote} /> : null}
            <p className="text-sm">
              {temporaryChange ? t("temporaryTerms") : t(
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

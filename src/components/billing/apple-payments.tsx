"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  retryAppleCompletions,
  showAppleSubscriptionManagement,
  type AppleStorefront,
} from "@/lib/native/appleBilling";
import { AppleTemporaryUpgradeDetails, AppleTemporaryUpgradeHistory } from "@/components/billing/apple-temporary-upgrade";
import { AppleConsumptionConsent } from "@/components/billing/apple-consumption-consent";
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
const purchaseDiagnosticCodes = new Set([
  "APPLE_NETWORK_ERROR", "APPLE_SERVER_ERROR", "APPLE_STORE_ERROR", "APPLE_PURCHASE_FAILED",
  "APPLE_UNKNOWN_PURCHASE_RESULT", "APPLE_UNVERIFIED_TRANSACTION", "APPLE_ENVIRONMENT_MISMATCH",
]);
const preSheetPurchaseCodes = new Set([
  "APPLE_PRICE_CHANGED", "APPLE_STOREFRONT_CHANGED", "APPLE_STOREFRONT_UNAVAILABLE",
  "APPLE_PRODUCT_UNAVAILABLE", "APPLE_PRODUCT_UNSUPPORTED", "APPLE_PAYMENTS_NOT_ALLOWED",
  "APPLE_BILLING_UNAVAILABLE", "APPLE_STORE_BUSY", "APPLE_INVALID_ARGUMENT",
]);
type RecoveringPurchase = {
  organizationId: string;
  environment: string;
  intentId: string;
  productId: string;
  requestKey: string;
  temporary: boolean;
  pending: boolean;
  diagnosticCode?: string;
};
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
  const refetchCatalog = catalog.refetch;
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
  const [recoveringPurchase, setRecoveringPurchase] = useState<RecoveringPurchase | null>(null);
  const [checkingPurchase, setCheckingPurchase] = useState(false);
  const recoveringRef = useRef<RecoveringPurchase | null>(null);
  const currentScope = useRef({ organizationId: catalog.data?.organization.id, environment: catalog.data?.environment });
  currentScope.current = { organizationId: catalog.data?.organization.id, environment: catalog.data?.environment };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const running = useRef(false);
  const requestKey = useRef<{ selection: string; key: string } | null>(null);
  const submittedIntents = useRef(new Set<string>());
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
  const storeKitConsent = product && typeof product.storefrontId === "string" && /^[0-9]{1,40}$/.test(product.storefrontId) &&
    typeof product.priceMillis === "string" && /^[A-Z]{3}$/.test(product.currencyCode) && /^(0|[1-9][0-9]{0,15})$/.test(product.priceMillis) &&
    BigInt(product.priceMillis) <= BigInt(Number.MAX_SAFE_INTEGER) && product.displayPrice.trim() && product.displayPrice.length <= 160
    ? { storefrontId: product.storefrontId, currency: product.currencyCode, priceMillis: product.priceMillis, displayPrice: product.displayPrice }
    : null;
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
  const recoveryForCurrentOrganization = recoveringPurchase?.organizationId === catalog.data?.organization.id &&
    recoveringPurchase?.environment === catalog.data?.environment ? recoveringPurchase : null;
  // Existing access, an old receipt and a matching SKU do not prove this attempt.
  // Only the server's exact intent/tenant/environment/product binding can resolve it.
  const recoveredTransaction = recoveryForCurrentOrganization ? catalog.data?.recentTransactions.find((entry) =>
    entry.intentId === recoveryForCurrentOrganization.intentId && entry.productId === recoveryForCurrentOrganization.productId &&
    entry.environment === recoveryForCurrentOrganization.environment) : undefined;
  const purchaseUnresolved = Boolean(recoveryForCurrentOrganization && (!recoveredTransaction || recoveredTransaction.status === "REVIEW"));
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
    if (requestKey.current?.selection !== selectionKey &&
      !(recoveringRef.current?.organizationId === catalog.data?.organization.id && purchaseUnresolved)) requestKey.current = null;
  }, [selectionKey, catalog.data?.organization.id, purchaseUnresolved]);

  useEffect(() => {
    setNotice(""); setConsentOpen(false); setAccepted(false);
  }, [catalog.data?.organization.id]);

  useEffect(() => {
    if (recoveredTransaction && recoveredTransaction.status !== "REVIEW" &&
      requestKey.current?.key === recoveryForCurrentOrganization?.requestKey) requestKey.current = null;
  }, [recoveredTransaction, recoveryForCurrentOrganization?.requestKey]);

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
    if (nativeCode === "APPLE_COMPLETION_STORAGE_FAILED") return t("completionStorageFailed");
    if (nativeCode === "APPLE_COMPLETION_KEY_UNAVAILABLE") return t("completionKeyUnavailable");
    if (nativeCode === "APPLE_DEFERRED_OUTCOME_UNRESOLVED") return t("deferredPending");
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
  const refresh = async (scope?: Pick<RecoveringPurchase, "organizationId" | "environment">) => {
    await refetchCatalog();
    if (scope && !isCurrentPurchase(scope)) return;
    if (temporaryChange) {
      await temporaryCatalog.refetch();
      if (scope && !isCurrentPurchase(scope)) return;
      if (supportedMarket && temporaryCatalog.data?.ready) await temporaryPreview.refetch();
    } else if (needsQuote && selected?.available && catalog.data?.ready) await preview.refetch();
    if (!scope || isCurrentPurchase(scope)) onUpdated();
  };
  const checkingRef = useRef(false);
  const isCurrentPurchase = (purchase: Pick<RecoveringPurchase, "organizationId" | "environment">) => mounted.current &&
    currentScope.current.organizationId === purchase.organizationId && currentScope.current.environment === purchase.environment;
  const checkRecoveringPurchase = useCallback(async (purchase: RecoveringPurchase) => {
    if (!mounted.current || currentScope.current.organizationId !== purchase.organizationId ||
      currentScope.current.environment !== purchase.environment || checkingRef.current || document.hidden || navigator.onLine === false) return;
    checkingRef.current = true;
    setCheckingPurchase(true);
    // This drains StoreKit.unfinished; it never opens a payment/login sheet.
    window.dispatchEvent(new Event("bazaar:apple-retry"));
    try {
      const result = await refetchCatalog();
      if (mounted.current && currentScope.current.organizationId === purchase.organizationId &&
        currentScope.current.environment === purchase.environment && result.data?.organization.id === purchase.organizationId &&
        result.data.environment === purchase.environment) onUpdated();
    } catch { /* Keep the same intent and the explicit recovery action while offline. */ }
    finally {
      checkingRef.current = false;
      if (mounted.current) setCheckingPurchase(false);
    }
  }, [refetchCatalog, onUpdated]);
  useEffect(() => {
    if (!recoveryForCurrentOrganization || !purchaseUnresolved) return;
    const resume = () => { void checkRecoveringPurchase(recoveryForCurrentOrganization); };
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [recoveryForCurrentOrganization, purchaseUnresolved, checkRecoveringPurchase]);
  const run = async (operation: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setNotice("");
    const scope = { ...currentScope.current };
    try {
      await operation();
    } catch (error) {
      if (mounted.current && currentScope.current.organizationId === scope.organizationId &&
        currentScope.current.environment === scope.environment) setNotice(messageFor(error));
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
        purchaseUnresolved || !offerKey ||
        (temporaryChange ? !temporaryQuote || !temporaryCatalog.data?.ready || quoteExpired || temporaryPreview.isFetching || temporaryPreview.isError ||
          !temporaryProductMatches || !temporarySelectionMatches
          : !selected?.available) ||
        !product || (!temporaryChange && !storeKitConsent) ||
        !accepted ||
        consentKey.current !== selectionKey ||
        !catalog.data
      )
        return;
      recoveringRef.current = null;
      setRecoveringPurchase(null);
      requestKey.current ??= { selection: selectionKey, key: crypto.randomUUID() };
      const purchaseScope = { organizationId: catalog.data.organization.id, environment: catalog.data.environment };
      const purchaseRequestKey = requestKey.current.key;
      const authorization = await intent.mutateAsync({
        offerKey,
        action,
        idempotencyKey: requestKey.current.key,
        expectedOrganizationId: catalog.data.organization.id,
        termsVersion: catalog.data.termsVersion,
        ...(temporaryChange && temporaryQuote ? { quoteToken: temporaryQuote.quoteToken }
          : needsQuote && preview.data?.quoteToken ? { quoteToken: preview.data.quoteToken } : {}),
        acceptedTerms: true,
        ...(!temporaryChange && storeKitConsent ? { storeKitConsent } : {}),
        storeId,
      });
      if (!isCurrentPurchase(purchaseScope)) return;
      const recovery: RecoveringPurchase = { ...purchaseScope, intentId: authorization.intentId, productId: product.id,
        requestKey: purchaseRequestKey, temporary: temporaryChange, pending: false };
      if (authorization.productId !== product.id) {
        setAccepted(false); setConsentOpen(false);
        // Only an intent this component has never handed to native is eligible
        // for soft cancellation. The server independently refuses paid/authorized ones.
        if (!submittedIntents.current.has(authorization.intentId)) {
          try { await cancel.mutateAsync({ intentId: authorization.intentId }); } catch { /* Reconciliation remains server-owned. */ }
          if (!isCurrentPurchase(purchaseScope)) return;
          requestKey.current = null;
        }
        try { await refresh(purchaseScope); } catch { /* Keep the actionable mismatch notice. */ }
        if (isCurrentPurchase(purchaseScope)) setNotice(temporaryChange ? errors("appleTemporaryUpgradePriceChanged") : t("productMismatch"));
        return;
      }
      let result;
      submittedIntents.current.add(authorization.intentId);
      try { result = await purchaseAppleProduct(authorization.intentId); }
      catch (error) {
        if (!isCurrentPurchase(purchaseScope)) return;
        const nativeCode = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
        if (error && typeof error === "object" && "code" in error && error.code === "APPLE_SUBSCRIPTION_ACCOUNT_CONFLICT") {
          // This native preflight runs before the payment sheet. Generic native
          // errors may conceal a paid transaction and must never cancel here.
          try { await cancel.mutateAsync({ intentId: authorization.intentId }); requestKey.current = null; }
          catch { /* The same intent remains available for cancellation retry. */ }
          await refresh(purchaseScope);
        } else if (!nativeCode || !preSheetPurchaseCodes.has(nativeCode)) {
          // Unknown errors cannot prove that StoreKit did not charge. Only the
          // diagnostic label is allowlisted; recovery never trusts an error as money.
          const attempt = { ...recovery, diagnosticCode: nativeCode && purchaseDiagnosticCodes.has(nativeCode) ? nativeCode : undefined };
          recoveringRef.current = attempt;
          setRecoveringPurchase(attempt);
          setConsentOpen(false);
          setAccepted(false);
          await checkRecoveringPurchase(attempt);
          return;
        }
        throw error;
      }
      if (!isCurrentPurchase(purchaseScope)) return;
      setConsentOpen(false);
      setAccepted(false);
      if (result.status === "deferred") {
        requestKey.current = null;
        setNotice(t(result.completionRecorded ? "deferredMoneyRecorded" : result.completionAcknowledged ? "deferredRecorded" : "deferredPending"));
        // The current/scheduled plan comes only from the refreshed catalog. Do
        // not confirm or finish the old SKU as a newly purchased target plan.
        window.dispatchEvent(new Event("bazaar:apple-retry"));
      } else if (result.status === "cancelled" || result.status === "not_started") {
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
        const attempt = { ...recovery, pending: true };
        recoveringRef.current = attempt;
        setRecoveringPurchase(attempt);
        setNotice(t("pending"));
        await checkRecoveringPurchase(attempt);
        return;
      } else {
        if (action === "CHANGE" && product.type === "AUTO_RENEWABLE" && result.transaction.productId !== product.id) {
          // Older native builds lack exact deferred-outcome recovery. An old
          // receipt cannot be presented as a newly purchased target plan.
          setNotice(t("deferredPending"));
          window.dispatchEvent(new Event("bazaar:apple-retry"));
          await refresh(purchaseScope);
          return;
        }
        let saved;
        try {
          saved = await confirm.mutateAsync({
            signedTransactionInfo: result.transaction.signedTransactionInfo,
            intentId: authorization.intentId,
          });
        } catch (error) {
          if (!isCurrentPurchase(purchaseScope)) return;
          recoveringRef.current = recovery;
          setRecoveringPurchase(recovery);
          if (temporaryChange) setNotice(t("temporaryConfirmationPending", { reason: messageFor(error) }));
          // A paid outcome may already be durable despite a lost response. Keep
          // the same intent key and let signed-receipt recovery decide access.
          await checkRecoveringPurchase(recovery);
          return;
        }
        if (!isCurrentPurchase(purchaseScope)) return;
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
        try { await refresh(purchaseScope); }
        catch {
          if (isCurrentPurchase(purchaseScope)) {
            if (saved.status === "GRANTED") setNotice(t(temporaryChange ? "temporaryRecoveryPending" : "confirmedRecoveryPending"));
            window.dispatchEvent(new Event("bazaar:apple-retry"));
          }
          return;
        }
        if (!isCurrentPurchase(purchaseScope)) return;
        try { await finishAppleTransaction(result.transaction.transactionId); }
        catch {
          if (!isCurrentPurchase(purchaseScope)) return;
          if (saved.status === "GRANTED") setNotice(t(temporaryChange ? "temporaryRecoveryPending" : "confirmedRecoveryPending"));
          window.dispatchEvent(new Event("bazaar:apple-retry"));
        }
        return;
      }
      await refresh(purchaseScope);
    });
  const restore = () =>
    run(async () => {
      let result;
      let completionPending = false;
      try {
        try { completionPending = (await retryAppleCompletions()).pendingCount > 0; }
        catch { completionPending = true; }
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
      setNotice(t(result.review ? "review" : completionPending ? "completionPending" : "restored"));
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
    (!temporaryChange && !storeKitConsent) ||
    productsBusy ||
    busy ||
    purchaseUnresolved ||
    !canPurchase;
  const visibleNotice = recoveryForCurrentOrganization ? recoveredTransaction
    ? t(recoveredTransaction.status === "GRANTED" ? recoveryForCurrentOrganization.temporary ? "temporaryRecorded" : "confirmed"
      : recoveredTransaction.status === "REVOKED" ? "revoked" : "review")
    : recoveryForCurrentOrganization.pending ? t("pending") : recoveryForCurrentOrganization.temporary && notice ? notice : t("purchaseRecoveryPending") : notice;
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
              {product && !temporaryChange && !storeKitConsent ? (
                <p role="alert" className="text-sm text-danger">{errors("applePriceConsentRequired")}</p>
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
                  {temporaryQuote ? <AppleTemporaryUpgradeDetails quote={temporaryQuote} displayPrice={temporaryProductMatches ? product?.displayPrice : undefined} /> : null}
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
            <div className="space-y-3" data-apple-purchase-actions>
              {visibleNotice ? (
                <div className="space-y-2 rounded-md border border-border p-3 text-sm" data-apple-attempt-recovery={recoveryForCurrentOrganization ? "true" : undefined}>
                  <p role="status">{visibleNotice}</p>
                  {recoveryForCurrentOrganization?.diagnosticCode && !recoveredTransaction ? (
                    <p className="text-xs text-muted-foreground">{t("purchaseRecoveryDiagnostic", { code: recoveryForCurrentOrganization.diagnosticCode })}</p>
                  ) : null}
                  {purchaseUnresolved && recoveryForCurrentOrganization ? (
                    <Button variant="secondary" disabled={checkingPurchase || busy} onClick={() => void checkRecoveringPurchase(recoveryForCurrentOrganization)}>
                      {checkingPurchase ? common("loading") : t("purchaseRecoveryRetry")}
                    </Button>
                  ) : null}
                </div>
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
                      <div className="min-w-0 flex-1 space-y-1">
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
                        <AppleConsumptionConsent
                          key={`${catalog.data.organization.id}:${transaction.environment}:${transaction.transactionId}`}
                          organizationId={catalog.data.organization.id}
                          organizationName={catalog.data.organization.name}
                          transactionId={transaction.transactionId}
                          environment={transaction.environment}
                          state={transaction.consumptionConsent}
                          onUpdated={() => catalog.refetch()}
                        />
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
            {temporaryQuote ? <AppleTemporaryUpgradeDetails quote={temporaryQuote} displayPrice={temporaryProductMatches ? product?.displayPrice : undefined} /> : null}
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
            {visibleNotice ? (
              <p role="alert" className="text-sm text-danger">
                {visibleNotice}
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

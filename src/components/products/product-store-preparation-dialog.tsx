"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/routers/_app";
import type { ProductStorePreparation } from "@/lib/productStorePreparation";
import {
  productPreparationPendingKey,
  readProductPreparationPending,
  saveProductPreparationPending,
  type PendingProductPreparation,
} from "@/lib/productPreparationPending";
import { trpc } from "@/lib/trpc";
import { formatKgsMoney } from "@/lib/currencyDisplay";
import { translateError } from "@/lib/translateError";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { QueryErrorState } from "@/components/query-error-state";

type Preview = inferRouterOutputs<AppRouter>["products"]["previewStorePreparation"];
export function ProductStorePreparationDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName: string;
  productSku?: string;
  sourceStoreId?: string;
  targetStoreIds?: string[];
  addToAssortment?: boolean;
  useExisting?: boolean;
  onPrepared?: (storeIds: string[]) => void;
}) {
  const t = useTranslations("productPreparation"),
    common = useTranslations("common"),
    errors = useTranslations("errors"),
    locale = useLocale();
  const { data: session } = useSession();
  const stores = trpc.stores.list.useQuery(undefined, { enabled: props.open });
  const utils = trpc.useUtils();
  const [targets, setTargets] = useState<string[]>([]),
    [source, setSource] = useState("");
  const [prices, setPrices] = useState<ProductStorePreparation["prices"]>("NONE");
  const priceSources = trpc.products.storePricing.useQuery(
    { productId: props.productId },
    {
      enabled: props.open && prices !== "NONE" && !props.sourceStoreId,
    },
  );
  const [add, setAdd] = useState(false);
  const [approval, setApproval] = useState<{
    preview: Preview;
    change: ProductStorePreparation;
    key: string;
  } | null>(null);
  const [error, setError] = useState<unknown>(null),
    [done, setDone] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [pending, setPending] = useState<PendingProductPreparation | null>(null);
  const [notice, setNotice] = useState("");
  const pendingKey =
    session?.user?.organizationId && session.user.id
      ? productPreparationPendingKey(session.user.organizationId, session.user.id, props.productId)
      : "";
  const generation = useRef(0);
  const previewMutation = trpc.products.previewStorePreparation.useMutation();
  const applyMutation = trpc.products.applyStorePreparation.useMutation();
  const reconcileMutation = trpc.products.reconcileStorePreparation.useMutation();
  const busy = previewMutation.isLoading || applyMutation.isLoading || reconcileMutation.isLoading;
  useEffect(() => {
    if (!props.open) return;
    generation.current++;
    setTargets(props.targetStoreIds ?? []);
    setSource(props.sourceStoreId ?? "");
    setPrices("NONE");
    setAdd(props.addToAssortment ?? false);
    setApproval(null);
    setError(null);
    setDone(false);
    setUncertain(false);
    setPending(null);
    setNotice("");
    try {
      const restored = pendingKey
        ? readProductPreparationPending(sessionStorage, pendingKey, props.productId)
        : null;
      if (restored) {
        setPending(restored);
        setUncertain(true);
        setTargets(restored.change.targetStoreIds);
        setSource(restored.change.sourceStoreId ?? "");
        setAdd(restored.change.addToAssortment);
        setPrices(restored.change.prices);
      }
    } catch {
      setError(new Error("productPreparationStorageUnavailable"));
    }
    // Reset only when opening for a card, never when query data refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.productId, pendingKey]);
  function changed() {
    generation.current++;
    setApproval(null);
    setError(null);
  }
  async function preview() {
    const id = ++generation.current;
    setError(null);
    setApproval(null);
    const change: ProductStorePreparation = {
      productId: props.productId,
      sourceStoreId: source || undefined,
      targetStoreIds: targets,
      addToAssortment: add,
      prices,
    };
    try {
      const result = await previewMutation.mutateAsync(change);
      if (id === generation.current)
        setApproval({ preview: result, change, key: crypto.randomUUID() });
    } catch (e) {
      if (id === generation.current) setError(e);
    }
  }
  async function apply() {
    if (!approval || !pendingKey) return;
    setError(null);
    const request = {
      change: approval.change,
      token: approval.preview.token,
      idempotencyKey: approval.key,
    };
    try {
      saveProductPreparationPending(sessionStorage, pendingKey, request);
    } catch {
      setError(new Error("productPreparationStorageUnavailable"));
      return;
    }
    setPending(request);
    try {
      await applyMutation.mutateAsync(request);
      try {
        sessionStorage.removeItem(pendingKey);
      } catch {
        /* The key is safe to reconcile again. */
      }
      setPending(null);
      setUncertain(false);
      setDone(true);
      await Promise.allSettled([utils.products.invalidate(), utils.inventory.invalidate()]);
      props.onPrepared?.(approval.change.targetStoreIds);
    } catch (e) {
      setError(e);
      if (
        e instanceof Error &&
        [
          "productPreparationStale",
          "assortmentUseSourceEditor",
          "forbidden",
          "productAccessDenied",
          "storeAccessDenied",
        ].includes(e.message)
      ) {
        setApproval(null);
        setUncertain(false);
        setPending(null);
        try {
          sessionStorage.removeItem(pendingKey);
        } catch {
          /* Original request was rejected. */
        }
      } else {
        const code =
          e && typeof e === "object" && "data" in e
            ? (e.data as { code?: string } | undefined)?.code
            : undefined;
        if (code && code !== "INTERNAL_SERVER_ERROR") {
          setApproval(null);
          setUncertain(false);
          setPending(null);
          try {
            sessionStorage.removeItem(pendingKey);
          } catch {
            /* Original request was rejected. */
          }
        } else setUncertain(true);
      }
    }
  }
  async function reconcile() {
    if (!pending) return;
    setError(null);
    try {
      const result = await reconcileMutation.mutateAsync(pending);
      try {
        sessionStorage.removeItem(pendingKey);
      } catch {
        /* Reconciliation is idempotent. */
      }
      setPending(null);
      setUncertain(false);
      setApproval(null);
      if (result.status === "APPLIED") {
        setDone(true);
        await Promise.allSettled([utils.products.invalidate(), utils.inventory.invalidate()]);
        props.onPrepared?.(pending.change.targetStoreIds);
      } else setNotice(t("canceled"));
    } catch (e) {
      setError(e);
    }
  }
  const canConfigure = session?.user?.role === "ADMIN" || session?.user?.isOrgOwner;
  return (
    <Modal
      open={props.open}
      onOpenChange={(open) => {
        if (!busy) props.onOpenChange(open);
      }}
      title={t("title")}
      subtitle={[props.productName, props.productSku].filter(Boolean).join(" · ")}
      className="sm:max-w-2xl"
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("identityHint")}</p>
        {stores.isLoading ? (
          <div role="status" className="flex items-center gap-2">
            <Spinner />
            {common("loading")}
          </div>
        ) : stores.error ? (
          <QueryErrorState onRetry={() => void stores.refetch()} />
        ) : done ? (
          <div role="status" className="space-y-3">
            <p>{t("success")}</p>
            <Button onClick={() => props.onOpenChange(false)}>{common("close")}</Button>
          </div>
        ) : (
          <>
            {source ? (
              <p className="text-sm">
                {t("source")}:{" "}
                <strong>{stores.data?.find((s) => s.id === source)?.name ?? ""}</strong>
              </p>
            ) : null}
            <fieldset disabled={busy || uncertain} className="space-y-3">
              <legend className="mb-2 text-sm font-medium">{t("targets")}</legend>
              <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-border p-3">
                {(stores.data ?? [])
                  .filter((s) => s.id !== source)
                  .map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={targets.includes(s.id)}
                        onCheckedChange={(checked) => {
                          changed();
                          setTargets(
                            checked ? [...targets, s.id] : targets.filter((id) => id !== s.id),
                          );
                        }}
                      />
                      {s.name}
                    </label>
                  ))}
                {!stores.data?.some((s) => s.id !== source) ? (
                  <p className="text-sm text-muted-foreground">{t("noTargets")}</p>
                ) : null}
              </div>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={add}
                  onCheckedChange={(checked) => {
                    changed();
                    setAdd(Boolean(checked));
                  }}
                />
                {t("add")}
              </label>
              {add ? <p className="text-xs text-muted-foreground">{t("addHint")}</p> : null}
              <div className="space-y-2">
                <label id="prepare-price-label" className="text-sm font-medium">
                  {t("prices")}
                </label>
                <Select
                  value={prices}
                  onValueChange={(value) => {
                    changed();
                    setPrices(value as ProductStorePreparation["prices"]);
                  }}
                  disabled={busy || uncertain}
                >
                  <SelectTrigger aria-labelledby="prepare-price-label">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">{t("none")}</SelectItem>
                    <SelectItem value="MISSING">{t("missing")}</SelectItem>
                    <SelectItem value="REPLACE">{t("replace")}</SelectItem>
                  </SelectContent>
                </Select>
                {prices !== "NONE" && !props.sourceStoreId ? (
                  <Select
                    value={source}
                    onValueChange={(value) => {
                      changed();
                      setSource(value);
                      setTargets(targets.filter((id) => id !== value));
                    }}
                    disabled={busy || uncertain || priceSources.isLoading}
                  >
                    <SelectTrigger aria-label={t("source")}>
                      <SelectValue placeholder={t("chooseSource")} />
                    </SelectTrigger>
                    <SelectContent>
                      {priceSources.data?.stores.map((s) => (
                        <SelectItem key={s.storeId} value={s.storeId}>
                          {s.storeName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                {prices !== "NONE" && !props.sourceStoreId && priceSources.error ? (
                  <QueryErrorState onRetry={() => void priceSources.refetch()} />
                ) : null}
                {prices !== "NONE" && !props.sourceStoreId && priceSources.isLoading ? (
                  <p role="status" className="text-xs text-muted-foreground">
                    {common("loading")}
                  </p>
                ) : null}
                {prices !== "NONE" &&
                !props.sourceStoreId &&
                priceSources.isSuccess &&
                !priceSources.data.stores.length ? (
                  <p className="text-xs text-muted-foreground">{t("noPriceSources")}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {t(prices === "REPLACE" ? "replaceHint" : "pricesHint")}
                </p>
                {canConfigure ? (
                  <Link
                    href="/settings/price-lists"
                    target="_blank"
                    className="text-sm text-primary underline"
                  >
                    {t("sharedPrices")}
                  </Link>
                ) : null}
              </div>
            </fieldset>
            {approval ? (
              <section
                className="space-y-3 rounded-lg border border-border p-3"
                aria-label={t("preview")}
              >
                <p className="text-sm font-medium">
                  {t("summary", {
                    additions: approval.preview.additions,
                    prices: approval.preview.priceChanges,
                  })}
                </p>
                <div className="max-h-64 space-y-3 overflow-y-auto">
                  {approval.preview.rows.map((row) => (
                    <div key={row.storeId} className="space-y-1 text-sm">
                      <p className="font-medium">
                        {row.storeName} ·{" "}
                        {t(row.blocked ? "blocked" : row.add ? "willAdd" : "available")}
                      </p>
                      {row.blocked ? (
                        <p className="text-xs text-warning">
                          {t(
                            row.blocked === "hidden"
                              ? "hiddenHint"
                              : row.blocked === "absent"
                                ? "addRequiredHint"
                                : "catalogHint",
                          )}{" "}
                          {row.blocked === "hidden" ? (
                            <Link
                              target="_blank"
                              href={`/products?storeId=${encodeURIComponent(row.storeId)}&archived=true&q=${encodeURIComponent(props.productName)}`}
                              className="text-primary underline"
                            >
                              {t("hiddenProducts")}
                            </Link>
                          ) : row.blocked === "catalog" && canConfigure ? (
                            <Link
                              target="_blank"
                              href={`/settings/store-groups?storeId=${encodeURIComponent(row.storeId)}&productId=${encodeURIComponent(props.productId)}`}
                              className="text-primary underline"
                            >
                              {t("configure")}
                            </Link>
                          ) : null}
                        </p>
                      ) : null}
                      {row.prices
                        .filter(
                          (p) =>
                            p.before.retail !== p.after.retail ||
                            p.before.wholesale !== p.after.wholesale,
                        )
                        .map((p) => {
                          const store = stores.data?.find((s) => s.id === row.storeId);
                          const money = (v: number | null) =>
                            v == null ? t("absent") : formatKgsMoney(v, locale, store);
                          return (
                            <div
                              key={p.variantId ?? "BASE"}
                              className="rounded-md bg-muted p-2 text-xs"
                            >
                              <p className="font-medium">{p.label}</p>
                              {p.before.retail !== p.after.retail ? (
                                <p>
                                  {t("retail")}: {money(p.before.retail)} → {money(p.after.retail)}
                                </p>
                              ) : null}
                              {p.before.wholesale !== p.after.wholesale ? (
                                <p>
                                  {t("wholesale")}: {money(p.before.wholesale)} →{" "}
                                  {money(p.after.wholesale)}
                                </p>
                              ) : null}
                            </div>
                          );
                        })}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{t("preserved")}</p>
              </section>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {translateError(errors, error as Parameters<typeof translateError>[1])}
              </p>
            ) : null}
            {notice ? (
              <p role="status" className="text-sm">
                {notice}
              </p>
            ) : null}
            {uncertain ? (
              <p role="status" className="text-sm text-warning">
                {t("uncertain")}
              </p>
            ) : null}
            {approval?.preview.canApply &&
            approval.preview.additions + approval.preview.priceChanges === 0 ? (
              <p role="status" className="text-sm text-muted-foreground">
                {t("noChanges")}
              </p>
            ) : null}
            <div className="sticky -bottom-4 -mx-4 grid grid-cols-2 gap-2 border-t border-border bg-card px-4 py-3 sm:-bottom-5 sm:-mx-5 sm:flex sm:flex-wrap sm:justify-end sm:px-5">
              {approval?.preview.canApply &&
              approval.preview.additions + approval.preview.priceChanges === 0 &&
              props.useExisting &&
              props.onPrepared ? (
                <Button
                  className="order-1 col-span-2 sm:order-none"
                  disabled={busy}
                  onClick={() => props.onPrepared?.(approval.change.targetStoreIds)}
                >
                  {t("use")}
                </Button>
              ) : null}
              <Button
                className="order-2 sm:order-none"
                variant="secondary"
                disabled={busy}
                onClick={() => props.onOpenChange(false)}
              >
                {common("close")}
              </Button>
              {uncertain && pending ? (
                <Button
                  className="order-1 col-span-2 sm:order-none"
                  disabled={busy}
                  onClick={() => void reconcile()}
                >
                  {busy ? <Spinner className="mr-2 h-4 w-4" /> : null}
                  {t("retry")}
                </Button>
              ) : approval ? (
                approval.preview.additions + approval.preview.priceChanges > 0 ? (
                  <Button
                    className="order-1 col-span-2 sm:order-none"
                    disabled={
                      busy ||
                      !pendingKey ||
                      !approval.preview.canApply ||
                      approval.preview.additions + approval.preview.priceChanges === 0
                    }
                    onClick={() => void apply()}
                  >
                    {busy ? <Spinner className="mr-2 h-4 w-4" /> : null}
                    {t(uncertain ? "retry" : "apply")}
                  </Button>
                ) : null
              ) : (
                <Button
                  className="order-1 col-span-2 sm:order-none"
                  disabled={busy || !targets.length || (prices !== "NONE" && !source)}
                  onClick={() => void preview()}
                >
                  {busy ? <Spinner className="mr-2 h-4 w-4" /> : null}
                  {t("preview")}
                </Button>
              )}
              {approval && !uncertain ? (
                <Button
                  className="order-3 sm:order-none"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void preview()}
                >
                  {t("refresh")}
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

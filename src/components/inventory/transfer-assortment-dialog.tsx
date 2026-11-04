"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  transferPreparationPendingKey,
  readTransferPreparationPending,
  saveTransferPreparationPending,
  type PendingTransferPreparation,
} from "@/lib/transferPreparationPending";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/routers/_app";
import type { TransferAssortmentPreparation } from "@/lib/transferAssortmentPreparation";
import { formatKgsMoney } from "@/lib/currencyDisplay";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { QueryErrorState } from "@/components/query-error-state";
import { Spinner } from "@/components/ui/spinner";

type Outputs = inferRouterOutputs<AppRouter>;
type Options = Outputs["inventory"]["transferAssortmentOptions"];
type Preview = Outputs["inventory"]["previewTransferAssortment"];

export function TransferAssortmentDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  fromStoreId: string;
  lines: TransferAssortmentPreparation["lines"];
  productIds: string[];
  onApplied: () => void;
}) {
  const t = useTranslations("inventory.transferSafety"),
    common = useTranslations("common"),
    errors = useTranslations("errors"),
    locale = useLocale();
  const utils = trpc.useUtils();
  const { data: session } = useSession();
  const pendingKey =
    session?.user?.organizationId && session.user.id
      ? transferPreparationPendingKey(
          session.user.organizationId,
          session.user.id,
          props.fromStoreId,
          props.storeId,
        )
      : "";
  const [pending, setPending] = useState<PendingTransferPreparation | null>(null);
  const optionsMutation = trpc.inventory.transferAssortmentOptions.useMutation();
  const previewMutation = trpc.inventory.previewTransferAssortment.useMutation();
  const saveMutation = trpc.inventory.applyTransferAssortment.useMutation();
  const reconcileMutation = trpc.inventory.reconcileTransferAssortment.useMutation();
  const [prices, setPrices] = useState<TransferAssortmentPreparation["prices"]>("MISSING");
  const [options, setOptions] = useState<Options>();
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [approval, setApproval] = useState<{
    preview: Preview;
    change: TransferAssortmentPreparation;
    key: string;
  }>();
  const [error, setError] = useState<unknown>();
  const [uncertain, setUncertain] = useState(false),
    [done, setDone] = useState(false);
  const generation = useRef(0);
  const signature = JSON.stringify([
    props.fromStoreId,
    props.storeId,
    [...new Set(props.productIds)].sort(),
    props.lines,
  ]);
  const busy =
    optionsMutation.isLoading ||
    previewMutation.isLoading ||
    saveMutation.isLoading ||
    reconcileMutation.isLoading;
  const { mutateAsync: loadOptions } = optionsMutation;
  useEffect(() => {
    if (!props.open) return;
    const id = ++generation.current;
    let active = true;
    setOptions(undefined);
    setSelection({});
    setApproval(undefined);
    setError(undefined);
    setDone(false);
    setUncertain(false);
    setPending(null);
    try {
      const restored = pendingKey
        ? readTransferPreparationPending(
            sessionStorage,
            pendingKey,
            props.fromStoreId,
            props.storeId,
          )
        : null;
      if (restored) {
        setPending(restored);
        setUncertain(true);
      }
    } catch {
      setError(new Error("productPreparationStorageUnavailable"));
    }
    const [fromStoreId, toStoreId, productIds] = JSON.parse(signature) as [
      string,
      string,
      string[],
    ];
    void loadOptions({ fromStoreId, toStoreId, productIds })
      .then((rows) => {
        if (!active || id !== generation.current) return;
        setOptions(rows);
        setPrices(rows.pricingAllowed ? "MISSING" : "NONE");
        setSelection(
          Object.fromEntries(
            rows.products
              .filter((row) => !row.hidden && !row.available && row.sources.length === 1)
              .map((row) => [row.id, row.sources[0].key]),
          ),
        );
      })
      .catch((e) => {
        if (active && id === generation.current) setError(e);
      });
    return () => {
      active = false;
    };
  }, [props.open, signature, loadOptions, pendingKey, props.fromStoreId, props.storeId]);
  function clearPending() {
    try {
      if (pendingKey) sessionStorage.removeItem(pendingKey);
    } catch {
      /* A retained key is safe to reconcile again. */
    }
    setPending(null);
  }
  async function completed() {
    clearPending();
    setDone(true);
    setUncertain(false);
    await Promise.allSettled([
      utils.inventory.invalidate(),
      utils.products.invalidate(),
      utils.stores.invalidate(),
    ]);
    props.onApplied();
  }
  async function reload() {
    const id = generation.current;
    setError(undefined);
    try {
      if (uncertain && pending) {
        const result = await reconcileMutation.mutateAsync({
          ...pending,
        });
        if (id !== generation.current) return;
        if (result.status === "APPLIED") {
          await completed();
          return;
        }
        clearPending();
        setUncertain(false);
        setApproval(undefined);
      }
      const rows = await loadOptions({
        fromStoreId: props.fromStoreId,
        toStoreId: props.storeId,
        productIds: [...new Set(props.productIds)],
      });
      if (id === generation.current) setOptions(rows);
    } catch (e) {
      if (id === generation.current) setError(e);
    }
  }
  async function preview() {
    const id = generation.current;
    setError(undefined);
    try {
      const selections = Object.entries(selection)
        .filter(
          ([id, value]) =>
            value && options?.products.some((o) => o.id === id && !o.available && !o.hidden),
        )
        .map(([productId, sourceKey]) => ({ productId, sourceKey }));
      const change: TransferAssortmentPreparation = {
        fromStoreId: props.fromStoreId,
        toStoreId: props.storeId,
        selections,
        lines: props.lines.filter((line) => selections.some((s) => s.productId === line.productId)),
        prices,
      };
      const result = await previewMutation.mutateAsync(change);
      if (id === generation.current)
        setApproval({ preview: result, change, key: crypto.randomUUID() });
    } catch (e) {
      if (id === generation.current) setError(e);
    }
  }
  async function apply() {
    if (!approval) return;
    const id = generation.current;
    setError(undefined);
    const request = {
      change: approval.change,
      token: approval.preview.token,
      idempotencyKey: approval.key,
    };
    try {
      if (!pendingKey) throw new Error("productPreparationStorageUnavailable");
      saveTransferPreparationPending(sessionStorage, pendingKey, request);
    } catch {
      setError(new Error("productPreparationStorageUnavailable"));
      return;
    }
    setPending(request);
    try {
      await saveMutation.mutateAsync({
        change: approval.change,
        token: approval.preview.token,
        idempotencyKey: approval.key,
      });
      if (id === generation.current) await completed();
    } catch (e) {
      if (id !== generation.current) return;
      setError(e);
      const code = (e as { data?: { code?: string } })?.data?.code;
      if (
        !code ||
        code === "INTERNAL_SERVER_ERROR" ||
        (e as { message?: string }).message === "requestInProgress"
      )
        setUncertain(true);
      else {
        clearPending();
        setUncertain(false);
        setApproval(undefined);
      }
    }
  }
  const money = (value: string | null) =>
    value === null ? t("priceMissing") : formatKgsMoney(Number(value), locale, undefined);
  return (
    <Modal
      open={props.open}
      onOpenChange={(open) => {
        if (!busy) props.onOpenChange(open);
      }}
      title={t("connectTitle")}
      className="sm:max-w-2xl"
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("preparationHint")}</p>
        {error ? (
          <div role="alert" className="space-y-2 text-sm text-danger">
            {translateError(errors, error as Parameters<typeof translateError>[1])}
            <QueryErrorState
              onRetry={() => void (uncertain ? reload() : options ? preview() : reload())}
            />
          </div>
        ) : null}
        {!options && !error ? (
          <p role="status" className="flex items-center gap-2 text-sm">
            <Spinner className="h-4 w-4" />
            {common("loading")}
          </p>
        ) : null}
        {done ? (
          <p role="status" className="text-sm text-success">
            {t("connected")}
          </p>
        ) : (
          <>
            {options?.pricingAllowed ? (
              <div className="rounded-md border border-border p-3">
                <Label className="flex items-start gap-2">
                  <Checkbox
                    checked={prices === "MISSING"}
                    disabled={busy || uncertain}
                    onCheckedChange={(checked) => {
                      setPrices(checked ? "MISSING" : "NONE");
                      setApproval(undefined);
                    }}
                  />
                  <span>{t("copyMissingPrices", { source: options.sourceName })}</span>
                </Label>
                <p className="mt-2 text-xs text-muted-foreground">{t("priceSafetyHint")}</p>
              </div>
            ) : options ? (
              <p className="text-sm text-muted-foreground">{t("pricePlanHint")}</p>
            ) : null}
            <div className="max-h-[35vh] space-y-3 overflow-y-auto">
              {options?.products.map((row) => (
                <div key={row.id} className="space-y-2 rounded-md border border-border p-3">
                  <Label className="flex items-start gap-2">
                    <Checkbox
                      checked={Boolean(selection[row.id])}
                      disabled={
                        busy || uncertain || row.available || row.hidden || !row.sources.length
                      }
                      onCheckedChange={(checked) => {
                        setApproval(undefined);
                        setSelection((current) => ({
                          ...current,
                          [row.id]: checked ? (row.sources[0]?.key ?? "") : "",
                        }));
                      }}
                    />
                    <span className="min-w-0 break-words">
                      {row.name}
                      <span className="block text-xs text-muted-foreground">{row.sku}</span>
                    </span>
                  </Label>
                  {row.available ? (
                    <p className="text-xs text-muted-foreground">{t("available")}</p>
                  ) : row.hidden ? (
                    <p className="text-xs text-warning">{t("hiddenHint")}</p>
                  ) : !row.sources.length ? (
                    <p className="text-xs text-warning">{t("noSource")}</p>
                  ) : (
                    <Select
                      value={selection[row.id] || ""}
                      disabled={busy || uncertain || !selection[row.id]}
                      onValueChange={(value) => {
                        setApproval(undefined);
                        setSelection((current) => ({ ...current, [row.id]: value }));
                      }}
                    >
                      <SelectTrigger aria-label={t("sourceFor", { name: row.name })}>
                        <SelectValue placeholder={t("source")} />
                      </SelectTrigger>
                      <SelectContent>
                        {row.sources.map((s) => (
                          <SelectItem key={s.key} value={s.key}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              ))}
            </div>
            {approval ? (
              <div className="space-y-3 rounded-md bg-muted p-3 text-sm">
                <p role="status">
                  {t("preparationPreview", {
                    count: approval.preview.added,
                    prices: approval.preview.priceChanges,
                  })}
                </p>
                {approval.preview.rows.length ? (
                  <div
                    className="max-h-[30vh] space-y-3 overflow-y-auto"
                    aria-label={t("priceReview")}
                  >
                    {approval.preview.rows.map((row) => (
                      <div
                        key={`${row.productId}:${row.variantKey}`}
                        className="rounded-md border border-border bg-background p-3"
                      >
                        <p className="break-words font-medium">
                          {row.name}
                          {row.variantName ? ` · ${row.variantName}` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">{row.sku}</p>
                        {(
                          [
                            "retail",
                            ...(approval.preview.retailWholesaleEnabled
                              ? ["wholesale" as const]
                              : []),
                          ] as const
                        ).map((kind) => (
                          <div key={kind} className="mt-2 space-y-1">
                            <p>
                              {t(kind)}:{" "}
                              <span className="tabular-nums">
                                {money(row.before[kind])} → {money(row.after[kind])}
                              </span>
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {t("priceSource", { price: money(row.source[kind]) })} ·{" "}
                              {t(`priceReason.${row.reasons[kind]}`)}
                            </p>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {uncertain ? (
              <p role="alert" className="text-sm text-warning">
                {t("uncertain")}
              </p>
            ) : null}
          </>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => props.onOpenChange(false)}>
            {common(done || uncertain ? "close" : "cancel")}
          </Button>
          {done ? null : uncertain ? (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => void reload()}>
                {t("check")}
              </Button>
            </>
          ) : approval ? (
            <Button disabled={busy} onClick={() => void apply()}>
              {busy ? <Spinner className="h-4 w-4" /> : null}
              {t("connect")}
            </Button>
          ) : (
            <Button
              disabled={busy || !Object.values(selection).some(Boolean)}
              onClick={() => void preview()}
            >
              {t("preview")}
            </Button>
          )}
        </div>
        <Link
          className="text-sm text-primary underline"
          href={`/settings/store-groups?storeId=${encodeURIComponent(props.storeId)}`}
          target="_blank"
        >
          {t("settings")}
        </Link>
      </div>
    </Modal>
  );
}

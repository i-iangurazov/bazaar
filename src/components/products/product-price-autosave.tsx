"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc";
import {
  convertFromKgs,
  convertToKgs,
  normalizeCurrencyCode,
  normalizeCurrencyRateKgsPerUnit,
} from "@/lib/currency";
import { translateError } from "@/lib/translateError";
import { parsePriceInput } from "@/lib/priceInput";
import { PriceAutosaveQueue, type PriceSaveState } from "@/lib/priceAutosaveQueue";
import {
  priceAutosavePendingKey,
  readPriceAutosavePending,
  savePriceAutosavePending,
  type ProductPricePatch,
} from "@/lib/productPriceAutosave";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
export type PriceAutosaveHandle = {
  edited: (path: string) => void;
  blur: (path: string) => void;
  flush: () => Promise<boolean>;
  flushManual: () => Promise<boolean>;
};
export type ProductPriceAutosaveConfig = {
  organizationId: string;
  userId: string;
  storeId: string;
  version: string;
  controlRef: React.MutableRefObject<PriceAutosaveHandle | null>;
  onSaved: (version: string) => void;
  onState: (state: { blocked: boolean; pending: boolean }) => void;
};
type Variant = { id?: string; retailPriceKgs?: unknown; wholesalePriceKgs?: unknown };
const kinds = ["retailPriceKgs", "wholesalePriceKgs"] as const;
const text = (v: unknown) => (v == null ? "" : String(v));
export const ProductPriceAutosave = forwardRef<
  PriceAutosaveHandle,
  {
    productId: string;
    config: ProductPriceAutosaveConfig;
    unitId: string;
    currencyCode?: string | null;
    currencyRateKgsPerUnit?: number | string | null;
    onChecking: (checking: boolean) => void;
  }
>(function ProductPriceAutosave(props, ref) {
  const form = useFormContext(),
    values = useWatch(),
    t = useTranslations("products.priceAutosave"),
    errors = useTranslations("errors");
  const utils = trpc.useUtils();
  const { mutateAsync: save } = trpc.storePrices.autosave.useMutation();
  const { mutateAsync: reconcile } = trpc.storePrices.reconcileAutosave.useMutation();
  const [state, setState] = useState<PriceSaveState>({ status: "idle", pending: false });
  const queue = useRef<PriceAutosaveQueue | undefined>(undefined);
  const settled = useRef(new Set<string>());
  const currency = normalizeCurrencyCode(props.currencyCode),
    rate = normalizeCurrencyRateKgsPerUnit(props.currencyRateKgsPerUnit, currency);
  const context = useRef({
    unitId: props.unitId,
    currencyCode: currency,
    currencyRateKgsPerUnit: rate,
  });
  const current = useRef(props);
  current.current = props;
  const callbacks = useRef({ save, reconcile });
  callbacks.current = { save, reconcile };
  const descriptors = () => {
    const base = kinds.map((kind) => ({
      path: kind as string,
      kind,
      variantId: null as string | null,
    }));
    const variants = (form.getValues("variants") ?? []) as Variant[];
    return [
      ...base,
      ...variants.flatMap((v, i) =>
        v.id
          ? kinds.map((kind) => ({ path: `variants.${i}.${kind}`, kind, variantId: v.id! }))
          : [],
      ),
    ];
  };
  const dirty = () => descriptors().filter((d) => form.getFieldState(d.path).isDirty);
  const pathFor = (variantId: string | null | undefined, kind: (typeof kinds)[number]) =>
    descriptors().find((d) => d.variantId === (variantId ?? null) && d.kind === kind)?.path;
  const fromKgs = (value: number | null | undefined) =>
    value == null
      ? ""
      : convertFromKgs(value, context.current.currencyRateKgsPerUnit, context.current.currencyCode);
  const applyValues = (
    prices: ProductPricePatch[],
    restore = false,
    requests?: ProductPricePatch[],
  ) => {
    for (const p of prices)
      for (const kind of kinds) {
        if (p[kind] === undefined) continue;
        const path = pathFor(p.variantId, kind);
        if (!path) continue;
        if (restore) {
          if (form.getFieldState(path).isDirty) continue;
          form.setValue(path, fromKgs(p[kind]), { shouldDirty: true });
          settled.current.add(path);
          continue;
        }
        const raw = form.getValues(path),
          sent = requests?.find((r) => (r.variantId ?? null) === (p.variantId ?? null))?.[kind];
        const rawAmount = parsePriceInput(raw);
        const same =
          !requests ||
          (text(raw).trim() === ""
            ? sent === null
            : rawAmount !== null && rawAmount === parsePriceInput(fromKgs(sent)));
        form.resetField(path, { defaultValue: fromKgs(p[kind]) });
        if (!same) form.setValue(path, raw, { shouldDirty: true });
        else settled.current.delete(path);
      }
  };
  const key = priceAutosavePendingKey(
    props.config.organizationId,
    props.config.userId,
    props.productId,
    props.config.storeId,
  );
  const helpers = useRef({ descriptors, dirty, applyValues });
  helpers.current = { descriptors, dirty, applyValues };
  const scope = JSON.stringify([
    props.config.organizationId,
    props.config.userId,
    props.productId,
    props.config.storeId,
  ]);
  useEffect(() => {
    const p = current.current;
    let active = true;
    context.current = {
      unitId: p.unitId,
      currencyCode: normalizeCurrencyCode(p.currencyCode),
      currencyRateKgsPerUnit: normalizeCurrencyRateKgsPerUnit(
        p.currencyRateKgsPerUnit,
        normalizeCurrencyCode(p.currencyCode),
      ),
    };
    const controller = new PriceAutosaveQueue({
      productId: p.productId,
      storeId: p.config.storeId,
      version: p.config.version,
      context: () => context.current,
      hasDirty: () => helpers.current.dirty().length > 0,
      collect: () => {
        if (form.getValues("baseUnitId") !== context.current.unitId)
          throw new Error("priceAutosaveUnitPending");
        const fields = helpers.current.dirty().filter((d) => settled.current.has(d.path));
        if (!fields.length) return [];
        const retail = form.getValues("retailPriceKgs");
        const retailAmount = parsePriceInput(retail);
        if (retailAmount === null || retailAmount < 0) throw new Error("retailPriceRequired");
        const entries = new Map<string, ProductPricePatch>();
        for (const d of fields) {
          const value = form.getValues(d.path);
          const raw = text(value).trim();
          const amount = parsePriceInput(value);
          if (raw !== "" && (amount === null || amount < 0))
            throw new Error("priceAutosaveInvalid");
          if (d.kind === "retailPriceKgs" && !d.variantId && raw === "")
            throw new Error("retailPriceRequired");
          const id = d.variantId ?? "BASE",
            entry = entries.get(id) ?? { variantId: d.variantId };
          entry[d.kind] =
            raw === ""
              ? null
              : convertToKgs(
                  amount!,
                  context.current.currencyRateKgsPerUnit,
                  context.current.currencyCode,
                );
          entries.set(id, entry);
        }
        return [...entries.values()];
      },
      save: (r) => callbacks.current.save(r),
      reconcile: (r) => callbacks.current.reconcile(r),
      persist: (r) => {
        if (r) savePriceAutosavePending(sessionStorage, key, r);
        else sessionStorage.removeItem(key);
      },
      acknowledge: (requested, receipt) => {
        utils.products.storePricing.setData({ productId: p.productId }, (data) =>
          data
            ? {
                ...data,
                stores: data.stores.map((row) => {
                  if (row.storeId !== p.config.storeId) return row;
                  const base = receipt.stored?.find((v) => !v.variantId);
                  return {
                    ...row,
                    ...(base
                      ? {
                          retailPriceKgs: base.retailPriceKgs,
                          wholesalePriceKgs: base.wholesalePriceKgs,
                          overridePriceKgs: base.overridePriceKgs,
                          priceOverridden: base.overridePriceKgs !== null,
                          effectivePriceKgs:
                            base.retailPriceKgs ?? base.overridePriceKgs ?? data.basePriceKgs,
                        }
                      : {}),
                    priceVersion: receipt.version,
                    variants: row.variants.map((v) => {
                      const stored = receipt.stored?.find((r) => r.variantId === v.variantId);
                      return stored
                        ? {
                            ...v,
                            retailPriceKgs: stored.retailPriceKgs,
                            wholesalePriceKgs: stored.wholesalePriceKgs,
                            overridePriceKgs: stored.overridePriceKgs,
                          }
                        : v;
                    }),
                  };
                }),
              }
            : data,
        );
        helpers.current.applyValues(receipt.prices, false, requested);
      },
      restore: (prices) => helpers.current.applyValues(prices, true),
      refresh: async () => {
        await utils.products.storePricing.invalidate({ productId: p.productId });
        const data = await utils.products.storePricing.fetch({ productId: p.productId });
        if (!active) throw new Error("priceAutosaveScopeChanged");
        const row = data.stores.find((s) => s.storeId === p.config.storeId);
        if (!row) throw new Error("storeAccessDenied");
        context.current = {
          unitId: current.current.unitId,
          currencyCode: normalizeCurrencyCode(row.currencyCode),
          currencyRateKgsPerUnit: normalizeCurrencyRateKgsPerUnit(
            row.currencyRateKgsPerUnit,
            normalizeCurrencyCode(row.currencyCode),
          ),
        };
        const prices: ProductPricePatch[] = [
          {
            variantId: null,
            retailPriceKgs: row.retailPriceKgs ?? row.overridePriceKgs ?? data.basePriceKgs ?? null,
            wholesalePriceKgs: row.wholesalePriceKgs,
          },
          ...row.variants.map((v) => ({
            variantId: v.variantId,
            retailPriceKgs: v.retailPriceKgs ?? v.overridePriceKgs ?? null,
            wholesalePriceKgs: v.wholesalePriceKgs,
          })),
        ];
        helpers.current.applyValues(prices);
        return row.priceVersion;
      },
      onSaved: (version) => {
        if (!active) return;
        current.current.config.onSaved(version);
        void Promise.allSettled([
          utils.products.getById.invalidate({ productId: p.productId }),
          utils.products.pricing.invalidate({ productId: p.productId }),
          utils.products.list.invalidate(),
          utils.products.bootstrap.invalidate(),
          utils.products.storePricing.invalidate({ productId: p.productId }),
        ]);
      },
      onState: (s) => {
        if (active) {
          setState(s);
          current.current.onChecking(s.status === "checking");
          current.current.config.onState({
            blocked: s.pending || ["saving", "checking", "error", "conflict"].includes(s.status),
            pending: s.pending || s.status === "saving" || s.status === "checking",
          });
        }
      },
    });
    queue.current = controller;
    try {
      const pending = readPriceAutosavePending(sessionStorage, key, p.productId, p.config.storeId);
      if (pending) void controller.recover(pending);
    } catch {
      setState({
        status: "error",
        pending: false,
        error: new Error("productPreparationStorageUnavailable"),
      });
    }
    return () => {
      active = false;
      controller.dispose();
      if (queue.current === controller) queue.current = undefined;
    };
    // A store/product change creates a new writer; live query refreshes never reset a dirty version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  useEffect(() => {
    const next = { unitId: props.unitId, currencyCode: currency, currencyRateKgsPerUnit: rate };
    if (JSON.stringify(next) !== JSON.stringify(context.current)) {
      if (dirty().length || queue.current?.unresolved)
        queue.current?.invalidate(new Error("priceAutosaveConflict"));
      else context.current = next;
    }
    queue.current?.syncVersion(props.config.version);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.config.version, props.unitId, currency, rate, values]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (helpers.current.dirty().length || queue.current?.unresolved) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  useImperativeHandle(ref, () => ({
    edited: (path) => {
      settled.current.delete(path);
      queue.current?.edited();
    },
    blur: (path) => {
      if (!helpers.current.descriptors().some((d) => d.path === path)) return;
      settled.current.add(path);
      void queue.current?.save();
    },
    flush: () => {
      for (const d of helpers.current.dirty()) settled.current.add(d.path);
      return queue.current?.save() ?? Promise.resolve(false);
    },
    flushManual: () => queue.current?.flushManual() ?? Promise.resolve(true),
  }));
  const changed = dirty().length > 0;
  const status =
    state.status === "error" && state.pending
      ? "uncertain"
      : state.status === "saved" && changed
        ? "changed"
        : state.status;
  return (
    <div
      className="col-span-full space-y-2 rounded-md border border-border bg-muted/20 p-3 text-xs"
      data-price-autosave
    >
      <p role="status" aria-live="polite" className="flex items-center gap-2">
        {state.status === "saving" || state.status === "checking" ? (
          <Spinner className="h-3 w-3" />
        ) : null}
        {t(status)}
      </p>
      <p className="text-muted-foreground">{t("hint")}</p>
      {state.error ? (
        <p role="alert" className="text-danger">
          {translateError(errors, state.error as Parameters<typeof translateError>[1])}
        </p>
      ) : null}
      {state.status === "error" ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            for (const d of helpers.current.dirty()) settled.current.add(d.path);
            void queue.current?.save();
          }}
        >
          {t(state.pending ? "checkRetry" : "retry")}
        </Button>
      ) : null}
      {state.status === "conflict" ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={state.pending}
          onClick={() => void queue.current?.reload()}
        >
          {t("reload")}
        </Button>
      ) : null}
    </div>
  );
});

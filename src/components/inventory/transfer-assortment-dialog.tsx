"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/routers/_app";
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
type Options = Outputs["stores"]["catalogProductOptions"];
type Preview = Outputs["stores"]["previewSelectedCatalogProducts"];

export function TransferAssortmentDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  productIds: string[];
  onApplied: () => void;
}) {
  const t = useTranslations("inventory.transferSafety"),
    common = useTranslations("common"),
    errors = useTranslations("errors");
  const utils = trpc.useUtils();
  const optionsMutation = trpc.stores.catalogProductOptions.useMutation();
  const previewMutation = trpc.stores.previewSelectedCatalogProducts.useMutation();
  const saveMutation = trpc.stores.saveCatalogSettings.useMutation();
  const [options, setOptions] = useState<Options>();
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [approval, setApproval] = useState<{ preview: Preview; key: string }>();
  const [error, setError] = useState<unknown>();
  const [uncertain, setUncertain] = useState(false),
    [done, setDone] = useState(false);
  const generation = useRef(0);
  const signature = JSON.stringify([props.storeId, [...new Set(props.productIds)].sort()]);
  const busy = optionsMutation.isLoading || previewMutation.isLoading || saveMutation.isLoading;
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
    const [storeId, productIds] = JSON.parse(signature) as [string, string[]];
    void loadOptions({ storeId, productIds })
      .then((rows) => {
        if (!active || id !== generation.current) return;
        setOptions(rows);
        setSelection(
          Object.fromEntries(
            rows
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
  }, [props.open, signature, loadOptions]);
  async function reload() {
    setError(undefined);
    try {
      const rows = await loadOptions({
        storeId: props.storeId,
        productIds: [...new Set(props.productIds)],
      });
      setOptions(rows);
      if (uncertain && approval) {
        const selected = approval.preview.change.connections
          .filter((c) => c.enabled && c.scope === "SELECTED")
          .flatMap((c) => c.productIds);
        if (rows.filter((r) => selected.includes(r.id)).every((r) => r.available)) {
          setDone(true);
          setUncertain(false);
          props.onApplied();
        }
      }
    } catch (e) {
      setError(e);
    }
  }
  async function preview() {
    setError(undefined);
    try {
      const result = await previewMutation.mutateAsync({
        storeId: props.storeId,
        selections: Object.entries(selection)
          .filter(
            ([id, key]) => key && options?.some((o) => o.id === id && !o.available && !o.hidden),
          )
          .map(([productId, sourceKey]) => ({ productId, sourceKey })),
      });
      setApproval({ preview: result, key: crypto.randomUUID() });
    } catch (e) {
      setError(e);
    }
  }
  async function apply() {
    if (!approval) return;
    setError(undefined);
    try {
      await saveMutation.mutateAsync({
        change: approval.preview.change,
        token: approval.preview.token,
        idempotencyKey: approval.key,
      });
      setDone(true);
      setUncertain(false);
      await Promise.allSettled([
        utils.inventory.invalidate(),
        utils.products.invalidate(),
        utils.stores.invalidate(),
      ]);
      props.onApplied();
    } catch (e) {
      setError(e);
      const code = (e as { data?: { code?: string } })?.data?.code;
      if (!code || code === "INTERNAL_SERVER_ERROR") setUncertain(true);
      else {
        setUncertain(false);
        setApproval(undefined);
      }
    }
  }
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
        <p className="text-sm text-muted-foreground">{t("connectHint")}</p>
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
            <div className="max-h-[50vh] space-y-3 overflow-y-auto">
              {options?.map((row) => (
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
              <p role="status" className="rounded-md bg-muted p-3 text-sm">
                {t("connectPreview", { count: approval.preview.added })}
              </p>
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
            {common(done ? "close" : "cancel")}
          </Button>
          {done ? null : uncertain ? (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => void reload()}>
                {t("check")}
              </Button>
              <Button disabled={busy} onClick={() => void apply()}>
                {common("tryAgain")}
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

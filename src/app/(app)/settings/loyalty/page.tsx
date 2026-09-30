"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { QueryErrorState } from "@/components/query-error-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc";
import { reportError } from "@/lib/reporting";

type Draft = {
  enabled: boolean;
  memberDiscountPercent: number;
  earnPercent: number;
  maxSpendPercent: number;
  minRedeemPoints: number;
  reservationTtlMinutes: number;
  excludePromoItems: boolean;
  combinePromoDiscount: boolean;
  storeIds: string[];
};

const DEFAULTS: Draft = {
  enabled: false,
  memberDiscountPercent: 5,
  earnPercent: 5,
  maxSpendPercent: 50,
  minRedeemPoints: 0,
  reservationTtlMinutes: 30,
  excludePromoItems: true,
  combinePromoDiscount: false,
  storeIds: [],
};

export default function LoyaltySettingsPage() {
  const t = useTranslations("loyalty");
  const errors = useTranslations("errors");
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const query = trpc.loyalty.settings.useQuery(undefined, { retry: false });
  const stores = trpc.stores.list.useQuery(undefined, { retry: false });
  const [draft, setDraft] = useState<Draft>(DEFAULTS);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    if (!query.data) return;
    const program = query.data.program;
    setDraft({
      enabled: program?.enabled ?? false,
      memberDiscountPercent: program ? Number(program.memberDiscountPercent) : 5,
      earnPercent: program ? Number(program.earnPercent) : 5,
      maxSpendPercent: program ? Number(program.maxSpendPercent) : 50,
      minRedeemPoints: program?.minRedeemPoints ?? 0,
      reservationTtlMinutes: program?.reservationTtlMinutes ?? 30,
      excludePromoItems: program?.excludePromoItems ?? true,
      combinePromoDiscount: program?.combinePromoDiscount ?? false,
      storeIds: query.data.storeIds,
    });
  }, [query.data]);

  const save = trpc.loyalty.updateSettings.useMutation({
    onSuccess: async () => {
      setError(null);
      toast({ description: t("saved"), variant: "success" });
      await utils.loyalty.settings.invalidate();
    },
    onError: (caught) => setError(reportError(errors, caught)),
  });

  const number = (value: number, patch: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const links = useMemo(() => new Map(query.data?.links.map((link) => [link.storeId, link.slug]) ?? []), [query.data]);
  const joinUrl = (storeId: string) => {
    const slug = links.get(storeId);
    return slug && origin ? `${origin}/loyalty/join/${slug}` : "";
  };
  const copy = async (storeId: string) => {
    const url = joinUrl(storeId);
    if (!url) return;
    await navigator.clipboard.writeText(url).catch(() => undefined);
    setCopied(storeId);
    window.setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        title={t("settingsTitle")}
        subtitle={t("settingsSubtitle")}
        action={
          <Button asChild variant="secondary">
            <Link href="/settings">{t("backToSettings")}</Link>
          </Button>
        }
      />
      {query.error ? (
        <QueryErrorState onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <section className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">{t("enableTitle")}</h2>
                <p className="text-xs text-muted-foreground">{t("enableNote")}</p>
              </div>
              <Switch
                checked={draft.enabled}
                onCheckedChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
              />
            </div>
            {draft.enabled && draft.storeIds.length === 0 && (
              <p role="status" className="text-sm text-warning">
                {t("needStore")}
              </p>
            )}
          </section>

          <section className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 sm:p-5">
            {(
              [
                ["memberDiscountPercent", t("memberDiscount")],
                ["earnPercent", t("earnPercent")],
                ["maxSpendPercent", t("maxSpend")],
                ["minRedeemPoints", t("minRedeem")],
                ["reservationTtlMinutes", t("reservationTtl")],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="space-y-1.5 text-sm">
                <span className="font-medium">{label}</span>
                <Input
                  type="number"
                  min={0}
                  step={key === "minRedeemPoints" || key === "reservationTtlMinutes" ? 1 : 0.5}
                  value={draft[key]}
                  onChange={(event) => number(Number(event.target.value), { [key]: Number(event.target.value) })}
                />
              </label>
            ))}
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">{t("excludePromo")}</span>
              <Switch
                checked={draft.excludePromoItems}
                onCheckedChange={(excludePromoItems) => setDraft((current) => ({ ...current, excludePromoItems }))}
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">{t("combinePromo")}</span>
              <Switch
                checked={draft.combinePromoDiscount}
                onCheckedChange={(combinePromoDiscount) => setDraft((current) => ({ ...current, combinePromoDiscount }))}
              />
            </label>
          </section>

          <section className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5">
            <h2 className="font-semibold">{t("storesTitle")}</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {(stores.data ?? []).map((store) => (
                <label key={store.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                  <span className="min-w-0 font-medium">{store.name}</span>
                  <Switch
                    checked={draft.storeIds.includes(store.id)}
                    onCheckedChange={(checked) =>
                      setDraft((current) => ({
                        ...current,
                        storeIds: checked
                          ? [...new Set([...current.storeIds, store.id])]
                          : current.storeIds.filter((id) => id !== store.id),
                      }))
                    }
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
            <div>
              <h2 className="font-semibold">{t("qrRegistrationTitle")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{t("qrRegistrationNote")}</p>
            </div>
            {draft.storeIds.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("needStore")}</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {draft.storeIds.map((storeId) => {
                  const store = stores.data?.find((item) => item.id === storeId);
                  const url = joinUrl(storeId);
                  return (
                    <div key={storeId} className="flex flex-col items-center gap-3 rounded-lg border border-border p-4">
                      <p className="text-sm font-medium">{store?.name ?? storeId}</p>
                      {links.get(storeId) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/loyalty/qr/store/${links.get(storeId)}`}
                          alt={t("qrAltStore")}
                          className="h-40 w-40"
                        />
                      ) : (
                        <Skeleton className="h-40 w-40" />
                      )}
                      <div className="flex w-full flex-col gap-2">
                        <Button asChild variant="secondary" size="sm" disabled={!url}>
                          <a href={url} target="_blank" rel="noreferrer">
                            {t("openPage")}
                          </a>
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => void copy(storeId)}
                          disabled={!url}
                        >
                          {copied === storeId ? t("copied") : t("copyLink")}
                        </Button>
                        <Button asChild variant="secondary" size="sm" disabled={!links.get(storeId)}>
                          <a
                            href={`/api/loyalty/qr/store/${links.get(storeId)}`}
                            download={`loyalty-${storeId}.png`}
                          >
                            {t("downloadQr")}
                          </a>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <p className="rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm text-muted-foreground">
            {t("rulesText")}
          </p>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button onClick={() => save.mutate(draft)} disabled={save.isLoading}>
              {t("save")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

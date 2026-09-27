"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/routers/_app";
import type { AssortmentChange } from "@/server/services/storeAssortments";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { translateError } from "@/lib/translateError";
import { trpc } from "@/lib/trpc";

type Preview = inferRouterOutputs<AppRouter>["stores"]["previewAssortmentShare"];

export default function StoreGroupsPage() {
  const t = useTranslations("assortments"),
    common = useTranslations("common"),
    errors = useTranslations("errors");
  const utils = trpc.useUtils();
  const overview = trpc.stores.assortmentOverview.useQuery();
  const stores = overview.data?.stores ?? [];
  const [source, setSource] = useState("");
  const [targets, setTargets] = useState<string[]>([]);
  const [scope, setScope] = useState<"ALL" | "SELECTED">("ALL");
  const [future, setFuture] = useState(true);
  const [mutual, setMutual] = useState(false);
  const [label, setLabel] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [showHistory, setShowHistory] = useState(false);
  const [approval, setApproval] = useState<{ preview: Preview; key: string } | null>(null);
  const revision = useRef(0);
  const editor = useRef<HTMLDivElement>(null);
  const products = trpc.stores.assortmentSourceProducts.useQuery(
    { storeId: source, search: search || undefined, page },
    { enabled: !!source && scope === "SELECTED", keepPreviousData: true },
  );
  const history = trpc.stores.assortmentHistory.useQuery(
    { page: historyPage },
    { enabled: showHistory },
  );
  const previewMutation = trpc.stores.previewAssortmentShare.useMutation();
  const applyMutation = trpc.stores.applyAssortmentShare.useMutation({
    onSuccess: async () => {
      clearPreview();
      await utils.invalidate();
    },
  });
  const clearPreview = () => {
    revision.current++;
    setApproval(null);
    previewMutation.reset();
    applyMutation.reset();
  };
  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? id;
  const toggle = (values: string[], id: string) =>
    values.includes(id) ? values.filter((v) => v !== id) : [...values, id];
  async function preview(change: AssortmentChange) {
    clearPreview();
    const current = revision.current;
    try {
      const result = await previewMutation.mutateAsync(change);
      if (current === revision.current) setApproval({ preview: result, key: crypto.randomUUID() });
    } catch {
      /* Visible mutation error below. */
    }
  }
  function editStore(storeId: string) {
    clearPreview();
    setSource(storeId);
    setTargets([]);
    setSelected([]);
    setPage(1);
    setSearch("");
    editor.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const error = overview.error ?? products.error ?? previewMutation.error ?? applyMutation.error;
  const impact = approval?.preview;
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <p className="text-sm text-muted-foreground">{t("customerNote")}</p>
      {error ? (
        <div role="alert" className="bazaar-admin-error">
          {translateError(errors, error)}{" "}
          <Button variant="secondary" onClick={() => void overview.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : null}
      {overview.isLoading ? (
        <div role="status">
          <Spinner />
          {common("loading")}
        </div>
      ) : null}
      {!overview.isLoading && !stores.length ? <p>{t("empty")}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {stores.map((store) => (
          <Card key={store.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>{store.name}</CardTitle>
                <Badge variant="muted">{t(`modes.${store.mode}`)}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">
                <strong>{t("receives")}: </strong>
                {store.incoming.map((r) => storeName(r.sourceStoreId)).join(", ") || t("none")}
              </p>
              <p className="text-sm">
                <strong>{t("shares")}: </strong>
                {store.outgoing.map((r) => storeName(r.targetStoreId)).join(", ") || t("none")}
              </p>
              {store.legacyPeers.length ? (
                <p className="text-sm text-warning">
                  {t("legacyPeers", { stores: store.legacyPeers.map((s) => s.name).join(", ") })}
                </p>
              ) : null}
              <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                {(["direct", "historical", "received", "total"] as const).map((key) => (
                  <div key={key}>
                    <dt className="text-muted-foreground">{t(key)}</dt>
                    <dd className="font-semibold tabular-nums">{store.counts[key]}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" asChild>
                  <Link href={`/products?storeId=${encodeURIComponent(store.id)}`}>
                    {t("products")}
                  </Link>
                </Button>
                <Button variant="secondary" onClick={() => editStore(store.id)}>
                  {t("manage")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowHistory(true);
                    setHistoryPage(1);
                  }}
                >
                  {t("history")}
                </Button>
                {!store.directedAssortment ? (
                  <Button
                    variant="ghost"
                    disabled={applyMutation.isLoading}
                    onClick={() => void preview({ action: "CONVERT", storeIds: [store.id] })}
                  >
                    {t("makeIndependent")}
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {overview.data?.rules.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("rules")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {overview.data.rules.map((rule) => (
              <div
                key={rule.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div className="text-sm">
                  <strong>
                    {storeName(rule.sourceStoreId)} → {storeName(rule.targetStoreId)}
                  </strong>
                  <p>
                    {rule.label} · {t(rule.active ? "active" : "paused")} ·{" "}
                    {t(rule.scope === "ALL" ? "allEligible" : "selection")} ·{" "}
                    {t(rule.includeFuture ? "futureOn" : "futureOff")}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      editStore(rule.sourceStoreId);
                      setTargets([rule.targetStoreId]);
                      setScope(rule.scope as "ALL" | "SELECTED");
                      setSelected(rule.scope === "SELECTED" ? rule.selectedProductIds : []);
                      setFuture(rule.includeFuture);
                      setLabel(rule.label ?? "");
                      setMutual(false);
                    }}
                  >
                    {t("edit")}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={applyMutation.isLoading}
                    onClick={() =>
                      void preview({ action: rule.active ? "PAUSE" : "RESUME", ruleIds: [rule.id] })
                    }
                  >
                    {t(rule.active ? "pause" : "resume")}
                  </Button>
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">{t("retention")}</p>
          </CardContent>
        </Card>
      ) : null}

      <div ref={editor}>
        <Card>
          <CardHeader>
            <CardTitle>{t("editor")}</CardTitle>
          </CardHeader>
          <CardContent>
            <fieldset disabled={applyMutation.isLoading} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t("source")}</Label>
                  <Select
                    value={source}
                    onValueChange={(value) => {
                      clearPreview();
                      setSource(value);
                      setTargets(targets.filter((id) => id !== value));
                      setSelected([]);
                      setPage(1);
                    }}
                  >
                    <SelectTrigger aria-label={t("source")}>
                      <SelectValue placeholder={t("source")} />
                    </SelectTrigger>
                    <SelectContent>
                      {stores.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="assortment-label">{t("label")}</Label>
                  <Input
                    id="assortment-label"
                    maxLength={120}
                    value={label}
                    onChange={(e) => {
                      clearPreview();
                      setLabel(e.target.value);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">{t("labelHint")}</p>
                </div>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{t("targets")}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {stores
                    .filter((s) => s.id !== source)
                    .map((s) => (
                      <label key={s.id} className="flex items-center gap-2 rounded-lg border p-3">
                        <input
                          type="checkbox"
                          checked={targets.includes(s.id)}
                          onChange={() => {
                            clearPreview();
                            setTargets(toggle(targets, s.id));
                          }}
                        />
                        {s.name}
                      </label>
                    ))}
                </div>
              </fieldset>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={mutual}
                  onChange={(e) => {
                    clearPreview();
                    setMutual(e.target.checked);
                  }}
                />
                {t("mutual")}
              </label>
              <p className="text-sm text-muted-foreground">
                {t(mutual ? "mutualHint" : "oneWayHint")}
              </p>
              <Select
                value={scope}
                onValueChange={(value) => {
                  clearPreview();
                  setScope(value as "ALL" | "SELECTED");
                }}
              >
                <SelectTrigger aria-label={t("scope")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{t("allEligible")}</SelectItem>
                  <SelectItem value="SELECTED">{t("selection")}</SelectItem>
                </SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={scope === "SELECTED"}
                  checked={scope === "ALL" && future}
                  onChange={(e) => {
                    clearPreview();
                    setFuture(e.target.checked);
                  }}
                />
                {t("futureOn")}
              </label>
              <p className="text-xs text-muted-foreground">
                {t(scope === "SELECTED" || !future ? "futureOffHint" : "futureHint")}
              </p>
              <p className="text-sm text-warning">{t("provenanceHint")}</p>
              {scope === "SELECTED" && source ? (
                <div className="space-y-3 rounded-lg border p-3">
                  <Input
                    aria-label={t("search")}
                    placeholder={t("search")}
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                  />
                  <p className="text-sm">{t("selected", { count: selected.length })}</p>
                  {products.isLoading ? <Spinner /> : null}
                  {products.data?.items.map((row) => (
                    <label
                      key={row.product.id}
                      className="flex items-start gap-3 border-b py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selected.includes(row.product.id)}
                        onChange={() => {
                          clearPreview();
                          setSelected(toggle(selected, row.product.id));
                        }}
                      />
                      <span>
                        {row.product.name}{" "}
                        <span className="text-muted-foreground">
                          {row.product.sku} ·{" "}
                          {t(
                            row.isDirect ? "direct" : row.isHistorical ? "historical" : "received",
                          )}
                        </span>
                      </span>
                    </label>
                  ))}
                  {products.data?.total === 0 ? <p>{t("noProducts")}</p> : null}
                  <div className="flex items-center gap-3">
                    <Button
                      variant="secondary"
                      disabled={page <= 1 || products.isFetching}
                      onClick={() => setPage(page - 1)}
                    >
                      {t("previous")}
                    </Button>
                    <span>{page}</span>
                    <Button
                      variant="secondary"
                      disabled={products.isFetching || page * 25 >= (products.data?.total ?? 0)}
                      onClick={() => setPage(page + 1)}
                    >
                      {t("next")}
                    </Button>
                  </div>
                </div>
              ) : null}
              <p className="font-medium">
                {source ? storeName(source) : t("source")} {mutual ? "↔" : "→"}{" "}
                {targets.map(storeName).join(", ") || t("targets")}
              </p>
              <Button
                disabled={
                  !source ||
                  !targets.length ||
                  (scope === "SELECTED" && !selected.length) ||
                  previewMutation.isLoading
                }
                onClick={() =>
                  void preview({
                    action: "SHARE",
                    sourceStoreId: source,
                    targetStoreIds: targets,
                    scope,
                    includeFuture: scope === "ALL" && future,
                    productIds: selected,
                    mutual,
                    label: label || undefined,
                  })
                }
              >
                {previewMutation.isLoading ? <Spinner /> : null}
                {t("preview")}
              </Button>
            </fieldset>
          </CardContent>
        </Card>
      </div>

      {impact ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("impact")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4" aria-live="polite">
            {impact.directions.map((edge, i) => (
              <div key={i}>
                <p className="font-medium">
                  {storeName(edge.sourceStoreId)} → {storeName(edge.targetStoreId)} ·{" "}
                  {t("productCount", { count: edge.productCount })}
                </p>
                <p className="text-sm">{t(edge.includeFuture ? "futureOn" : "futureOff")}</p>
              </div>
            ))}
            {impact.change.action === "SHARE" && !impact.change.mutual ? (
              <p>
                {t("oneWayGuarantee", {
                  source: storeName(impact.change.sourceStoreId),
                  targets: impact.change.targetStoreIds.map(storeName).join(", "),
                })}
              </p>
            ) : null}
            <p className="text-sm">{t("integrity")}</p>
            <p className="text-sm">{t("pricing")}</p>
            <p className="text-sm text-muted-foreground">{t("retention")}</p>
            {impact.impacts.map((row) => (
              <div key={row.storeId} className="rounded-lg border p-3 text-sm">
                <h3 className="font-semibold">{row.storeName}</h3>
                <p>
                  {t("counts", {
                    current: row.currentTotal,
                    added: row.newlyVisible,
                    overlap: row.alreadyVisible,
                    total: row.resultingTotal,
                  })}
                </p>
                <p>
                  {t("retained", {
                    direct: row.retainedDirect,
                    historical: row.retainedHistorical,
                    received: row.retainedReceived,
                  })}
                </p>
                {row.barcodeConflictCount ? (
                  <p className="text-warning">
                    {t("collisions", { count: row.barcodeConflictCount })}:{" "}
                    {row.barcodeConflicts.map((c) => c.barcode).join(", ")}
                  </p>
                ) : null}
              </div>
            ))}
            {impact.sourceReview.map((row) => (
              <p key={row.storeId} className="text-sm">
                {t("sourceReview", {
                  name: row.storeName,
                  eligible: row.eligible,
                  unresolved: row.unresolved,
                  reviewed: row.reviewedHistorical + row.reviewedReceived,
                })}
              </p>
            ))}
            {impact.legacyExits.map((row) => (
              <p key={row.id} className="text-sm text-warning">
                {t("legacyExit", {
                  name: row.name,
                  group: row.group ?? t("none"),
                  peers: row.peers.join(", ") || t("none"),
                })}
              </p>
            ))}
            {impact.affectedRules.length ? (
              <div className="text-sm">
                <p className="font-semibold">{t("existingRules")}</p>
                {impact.affectedRules.map((r) => (
                  <p key={r.id}>
                    {storeName(r.sourceStoreId)} → {storeName(r.targetStoreId)} ·{" "}
                    {t(r.active ? "active" : "paused")}
                  </p>
                ))}
              </div>
            ) : null}
            {impact.change.action === "PAUSE" ? <p>{t("pauseHint")}</p> : null}
            <Button
              disabled={applyMutation.isLoading}
              onClick={() =>
                approval &&
                applyMutation.mutate({
                  change: approval.preview.change,
                  previewToken: approval.preview.previewToken,
                  idempotencyKey: approval.key,
                })
              }
            >
              {applyMutation.isLoading ? <Spinner /> : null}
              {t("apply")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {showHistory ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("history")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {history.isLoading ? <Spinner /> : null}
            {history.error ? <p role="alert">{translateError(errors, history.error)}</p> : null}
            {history.data?.total === 0 ? <p>{t("noHistory")}</p> : null}
            {history.data?.items.map((item) => (
              <details key={item.id} className="rounded-lg border p-3 text-sm">
                <summary>
                  {new Date(item.createdAt).toLocaleString()} ·{" "}
                  {item.actor?.name ?? t("unknownActor")} ·{" "}
                  {t(`actions.${item.action.replace("ASSORTMENT_", "")}`)}
                </summary>
                <div className="mt-3 space-y-2">
                  {item.previousRules.length ? (
                    <div>
                      <p className="font-medium">{t("previous")}</p>
                      {item.previousRules.map((rule, i) => (
                        <p key={i}>
                          {storeName(rule.sourceStoreId)} → {storeName(rule.targetStoreId)} ·{" "}
                          {t(rule.active ? "active" : "paused")} ·{" "}
                          {t(rule.includeFuture ? "futureOn" : "futureOff")}
                          {rule.label ? ` · ${rule.label}` : ""}
                        </p>
                      ))}
                    </div>
                  ) : null}
                  {item.impact?.directions.map((rule, i) => (
                    <p key={i}>
                      {storeName(rule.sourceStoreId)} → {storeName(rule.targetStoreId)} ·{" "}
                      {t("productCount", { count: rule.productCount })} ·{" "}
                      {t(rule.includeFuture ? "futureOn" : "futureOff")}
                      {rule.label ? ` · ${rule.label}` : ""}
                    </p>
                  ))}
                  {item.impact?.impacts.map((row) => (
                    <p key={row.storeId}>
                      <strong>{row.storeName}</strong> ·{" "}
                      {t("counts", {
                        current: row.currentTotal,
                        added: row.newlyVisible,
                        overlap: row.alreadyVisible,
                        total: row.resultingTotal,
                      })}
                    </p>
                  ))}
                  {item.impact?.legacyExits.map((row) => (
                    <p key={row.id}>
                      {t("legacyExit", {
                        name: row.name,
                        group: row.group ?? t("none"),
                        peers: row.peers.join(", ") || t("none"),
                      })}
                    </p>
                  ))}
                  <p className="text-muted-foreground">{t("integrity")}</p>
                </div>
              </details>
            ))}
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={historyPage === 1}
                onClick={() => setHistoryPage(historyPage - 1)}
              >
                {t("previous")}
              </Button>
              <Button
                variant="secondary"
                disabled={historyPage * 20 >= (history.data?.total ?? 0)}
                onClick={() => setHistoryPage(historyPage + 1)}
              >
                {t("next")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/routers/_app";
import type { CatalogSettings } from "@/server/services/catalogSources";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { QueryErrorState } from "@/components/query-error-state";
import { trpc } from "@/lib/trpc";
import { useSse } from "@/lib/useSse";
import { translateError } from "@/lib/translateError";
import { formatDateTime } from "@/lib/i18nFormat";

type Output = inferRouterOutputs<AppRouter>;
type Preview = Output["stores"]["previewCatalogSettings"];
type Source = Output["stores"]["catalogSettings"]["sources"][number];
type Connection = CatalogSettings["connections"][number];

export default function StoreGroupsPage() {
  const t = useTranslations("catalogSources"),
    common = useTranslations("common"),
    errors = useTranslations("errors"),
    locale = useLocale();
  const utils = trpc.useUtils();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selected = searchParams.get("storeId") || undefined;
  const setSelected = (id: string) =>
    router.replace(`/settings/store-groups?storeId=${encodeURIComponent(id)}`, { scroll: false });
  const overview = trpc.stores.catalogSettings.useQuery({ storeId: selected });
  useSse({ "assortment.updated": () => overview.refetch() });
  const data = overview.data,
    store = data?.store;
  const [draft, setDraft] = useState<CatalogSettings | null>(null);
  const [approval, setApproval] = useState<{
    preview: Preview;
    changeKey: string;
    idempotencyKey: string;
  } | null>(null);
  const [error, setError] = useState<unknown>(null),
    [previewLoading, setPreviewLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [storeSearch, setStoreSearch] = useState("");
  const [pendingStore, setPendingStore] = useState<string | null>(null);
  const [detail, setDetail] = useState<Source | null>(null),
    [detailMode, setDetailMode] = useState<"view" | "selection" | "ownership">("view");
  const [search, setSearch] = useState(""),
    [debouncedSearch, setDebouncedSearch] = useState(""),
    [page, setPage] = useState(1);
  const [ownership, setOwnership] = useState<string[]>([]),
    [bulkLoading, setBulkLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false),
    [historyPage, setHistoryPage] = useState(1);
  const current = draft ?? data?.settings;
  const revision = useRef(0);
  const previewMutation = trpc.stores.previewCatalogSettings.useMutation();
  const saveMutation = trpc.stores.saveCatalogSettings.useMutation();
  const products = trpc.stores.catalogProducts.useQuery(
    {
      storeId: store?.id ?? "",
      key: detail?.key ?? "",
      search: debouncedSearch || undefined,
      page,
    },
    { enabled: !!store && !!detail, keepPreviousData: true },
  );
  const history = trpc.stores.catalogSettingsHistory.useQuery(
    { storeId: store?.id ?? "", page: historyPage },
    { enabled: historyOpen && !!store },
  );
  const { mutateAsync: requestPreview } = previewMutation;
  const draftKey = JSON.stringify(draft);
  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [search]);
  useEffect(() => {
    if (!draft) return;
    const id = ++revision.current;
    let active = true;
    setPreviewLoading(true);
    const timer = setTimeout(() => {
      void requestPreview(draft)
        .then((preview) => {
          if (active && id === revision.current) {
            setApproval({ preview, changeKey: draftKey, idempotencyKey: crypto.randomUUID() });
            setError(null);
          }
        })
        .catch((e) => {
          if (active && id === revision.current) setError(e);
        })
        .finally(() => {
          if (active && id === revision.current) setPreviewLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      active = false;
    };
  }, [draft, draftKey, requestPreview]);
  useEffect(() => {
    if (!draft) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft]);
  function edit(next: CatalogSettings) {
    revision.current++;
    setApproval(null);
    setError(null);
    setNotice("");
    setDraft(next);
  }
  function update(key: string, patch: Partial<Connection>) {
    if (!current) return;
    const found = current.connections.find((c) => c.key === key);
    const changed = {
      key,
      enabled: true,
      scope: "ALL" as const,
      productIds: [],
      ...found,
      ...patch,
    };
    edit({
      ...current,
      connections: found
        ? current.connections.map((c) => (c.key === key ? changed : c))
        : [...current.connections, changed],
    });
  }
  function cancel() {
    revision.current++;
    setDraft(null);
    setApproval(null);
    setError(null);
    setNotice("");
    setPreviewLoading(false);
  }
  function selectStore(id: string) {
    if (id === store?.id) return;
    if (draft) {
      setPendingStore(id);
      return;
    }
    cancel();
    setSelected(id);
    setDetail(null);
  }
  async function save(switchAfter?: string) {
    if (!draft || !approval || approval.changeKey !== draftKey || saveMutation.isLoading) return;
    try {
      await saveMutation.mutateAsync({
        change: draft,
        token: approval.preview.token,
        idempotencyKey: approval.idempotencyKey,
      });
      await utils.invalidate();
      await overview.refetch();
      cancel();
      setNotice(t("saved"));
      if (switchAfter) {
        setPendingStore(null);
        setSelected(switchAfter);
      }
    } catch (e) {
      setError(e);
      if (e instanceof Error && e.message === "assortmentPreviewStale") {
        setApproval(null);
        setNotice(t("stale"));
        setDraft({ ...draft });
      }
    }
  }
  function openDetail(source: Source, mode: "view" | "selection" | "ownership" = "view") {
    setDetail(source);
    setDetailMode(mode);
    setSearch("");
    setPage(1);
    setOwnership([]);
    if (mode === "selection") update(source.key, { scope: "SELECTED" });
  }
  const connection = detail ? current?.connections.find((c) => c.key === detail.key) : undefined;
  const selectedIds = detailMode === "ownership" ? ownership : (connection?.productIds ?? []);
  function setSelection(ids: string[]) {
    if (!detail) return;
    if (detailMode === "ownership") setOwnership(ids);
    else update(detail.key, { scope: "SELECTED", productIds: ids });
  }
  function toggleProduct(id: string) {
    setSelection(
      selectedIds.includes(id) ? selectedIds.filter((p) => p !== id) : [...selectedIds, id],
    );
  }
  async function selectAllMatches() {
    if (!store || !detail) return;
    setBulkLoading(true);
    try {
      const r = await utils.stores.catalogProducts.fetch({
        storeId: store.id,
        key: detail.key,
        search: debouncedSearch || undefined,
        page: 1,
        allIds: true,
      });
      setSelection([
        ...new Set([
          ...selectedIds,
          ...r.items.filter((p) => detailMode !== "ownership" || p.available).map((p) => p.id),
        ]),
      ]);
    } catch (e) {
      setError(e);
    } finally {
      setBulkLoading(false);
    }
  }
  const sourceByKey = (key: string) => data?.sources.find((s) => s.key === key);
  const own = data?.sources.find((s) => s.key === `store:${store?.id}`);
  const canSave =
    !!draft &&
    !!approval &&
    approval.changeKey === draftKey &&
    !previewLoading &&
    !saveMutation.isLoading;
  const sourceRows = (data?.sources ?? []).filter(
    (s) =>
      s.key !== own?.key &&
      !s.key.startsWith("baseline:") &&
      ((s.key.startsWith("store:") && s.total > 0) ||
        current?.connections.some((c) => c.key === s.key)),
  );
  const displayName = (source: Source) =>
    source.sourceName ?? `${t("sharedSource")} · ${source.name}`;
  function sourceRow(source: Source, c?: Connection) {
    return (
      <div
        key={source.key}
        className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 border-t border-border py-4 md:grid-cols-[minmax(0,1fr)_110px_130px] md:items-center"
        data-source-key={source.key}
      >
        <div className="min-w-0">
          <p className="break-words font-medium">{c ? displayName(source) : store?.name}</p>
          {c?.scope === "SELECTED" ? (
            <p className="text-xs text-muted-foreground">
              {t("partial", {
                selected: c.productIds.filter((id) => !source.unavailableSelectedIds.includes(id))
                  .length,
                total: source.total,
              })}
            </p>
          ) : null}
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0 py-1"
            onClick={() => openDetail(source)}
          >
            {t("details")}
          </Button>
        </div>
        <Button
          variant="link"
          size="sm"
          className="order-3 justify-start px-0 md:order-none"
          onClick={() => openDetail(source)}
          aria-label={t("viewCatalog", { name: source.name })}
        >
          {source.total.toLocaleString(locale)}
        </Button>
        {c ? (
          <label className="order-2 flex items-center gap-2 self-start pt-1 text-sm md:order-none md:self-auto md:pt-0">
            <Switch
              aria-label={t("accessLabel", { name: source.name })}
              checked={c.enabled}
              disabled={saveMutation.isLoading}
              onCheckedChange={(enabled) => update(c.key, { enabled })}
            />
            <span>{t(c.enabled ? "enabled" : "disabled")}</span>
          </label>
        ) : (
          <span className="order-2 text-sm text-muted-foreground md:order-none">
            {t("thisStore")}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <PageHeader title={t("title")} />
      {overview.isLoading ? (
        <div role="status" className="flex gap-2">
          <Spinner />
          {common("loading")}
        </div>
      ) : overview.error ? (
        <QueryErrorState onRetry={() => void overview.refetch()} />
      ) : !store ? (
        <p>{t("noStores")}</p>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="rounded-xl border border-border bg-card p-3">
            <label
              htmlFor="assortment-store-mobile"
              className="mb-2 block text-sm font-medium lg:hidden"
            >
              {t("store")}
            </label>
            <select
              id="assortment-store-mobile"
              className="h-10 w-full rounded-md border border-input bg-background px-3 lg:hidden"
              value={store.id}
              disabled={saveMutation.isLoading}
              onChange={(e) => selectStore(e.target.value)}
            >
              {data!.stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.hasBaseline ? s.baseCount : s.availableCount}
                </option>
              ))}
            </select>
            <div className="hidden lg:block">
              {data!.stores.length > 12 ? (
                <Input
                  aria-label={t("searchStores")}
                  placeholder={t("searchStores")}
                  value={storeSearch}
                  onChange={(e) => setStoreSearch(e.target.value)}
                  className="mb-2"
                />
              ) : null}
              <nav aria-label={t("store")} className="max-h-[70vh] space-y-1 overflow-y-auto">
                {data!.stores
                  .filter((s) =>
                    `${s.name} ${s.code}`
                      .toLocaleLowerCase()
                      .includes(storeSearch.toLocaleLowerCase()),
                  )
                  .map((s) => (
                    <button
                      type="button"
                      key={s.id}
                      aria-current={s.id === store.id ? "page" : undefined}
                      disabled={saveMutation.isLoading}
                      onClick={() => selectStore(s.id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${s.id === store.id ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted"}`}
                    >
                      <span className="truncate" title={s.name}>
                        {s.name}
                      </span>
                      <span
                        className="shrink-0 text-xs tabular-nums text-muted-foreground"
                        aria-label={
                          s.hasBaseline
                            ? `${t("ownCatalog")}: ${s.baseCount}`
                            : t("storeCount", { count: s.availableCount })
                        }
                      >
                        {(s.hasBaseline ? s.baseCount : s.availableCount).toLocaleString(locale)}
                      </span>
                    </button>
                  ))}
              </nav>
            </div>
          </aside>
          <Card>
            <CardContent className="p-4 sm:p-6">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">{store.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setHistoryPage(1);
                    setHistoryOpen(true);
                  }}
                >
                  {t("history")}
                </Button>
              </div>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <strong className="text-2xl tabular-nums" data-testid="assortment-total">
                    {data!.total.toLocaleString(locale)}
                  </strong>
                  <span className="ml-2 text-sm text-muted-foreground">
                    {t("distinctProducts")}
                  </span>
                  <Link
                    className="ml-3 text-sm text-primary underline"
                    href={`/products?storeId=${encodeURIComponent(store.id)}`}
                  >
                    {t("viewProducts")}
                  </Link>
                </div>
              </div>
              <div
                className="hidden grid-cols-[minmax(0,1fr)_110px_130px] gap-3 pb-2 text-xs font-medium text-muted-foreground md:grid"
                aria-hidden="true"
              >
                <span>{t("store")}</span>
                <span>{t("products")}</span>
                <span>{t("access")}</span>
              </div>
              {own && data!.ownCount > 0 ? sourceRow(own) : null}
              {sourceRows.map((source) =>
                sourceRow(
                  source,
                  current?.connections.find((c) => c.key === source.key) ?? {
                    key: source.key,
                    enabled: false,
                    scope: "ALL",
                    productIds: [],
                  },
                ),
              )}
              {!data!.ownCount && !sourceRows.length ? (
                <p className="border-t py-6 text-sm text-muted-foreground">{t("empty")}</p>
              ) : null}
              {notice ? (
                <p role="status" className="mt-4 text-sm">
                  {notice}
                </p>
              ) : null}
              {error ? (
                <div
                  role="alert"
                  className="mt-4 rounded-md border border-destructive/30 p-3 text-sm text-destructive"
                >
                  {translateError(errors, error as Parameters<typeof translateError>[1])}
                  {draft && !saveMutation.isLoading ? (
                    <Button variant="link" size="sm" onClick={() => setDraft({ ...draft })}>
                      {t("retry")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {draft ? (
                <section
                  aria-label={t("preview")}
                  className="mt-5 space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4"
                >
                  {previewLoading ? (
                    <p role="status" className="flex items-center gap-2 text-sm">
                      <Spinner />
                      {t("calculating")}
                    </p>
                  ) : approval ? (
                    <>
                      <p role="status" className="text-sm font-medium">
                        {t("impact", {
                          current: approval.preview.current,
                          result: approval.preview.result,
                          added: approval.preview.added,
                          hidden: approval.preview.hidden,
                        })}
                      </p>
                      <p className="text-xs text-muted-foreground">{t("preserved")}</p>
                      {approval.preview.stockPositions > 0 ? (
                        <p className="text-sm">
                          {t("stockImpact", { count: approval.preview.stockPositions })}{" "}
                          <Link
                            className="text-primary underline"
                            href={`/inventory?storeId=${store.id}&stockFilter=notInAssortment`}
                          >
                            {t("warehouse")}
                          </Link>
                        </p>
                      ) : null}
                      {approval.preview.legacyExit ? (
                        <p className="text-sm">
                          {t("legacyExit")}
                          {approval.preview.legacyPeers.length
                            ? ` ${t("otherStores", { names: approval.preview.legacyPeers.join(", ") })}`
                            : ""}
                        </p>
                      ) : null}
                      {approval.preview.confirmed > 0 ? (
                        <p className="text-sm">
                          {t("confirmedImpact", { count: approval.preview.confirmed })}
                        </p>
                      ) : null}
                      {approval.preview.otherImpacts.map((i) => (
                        <p key={i.storeId} className="text-sm">
                          {t("otherImpact", { name: i.name, count: i.added })}
                        </p>
                      ))}
                      {approval.preview.barcodeConflicts > 0 ? (
                        <p className="text-sm">
                          {t("barcodeConflicts", { count: approval.preview.barcodeConflicts })}
                        </p>
                      ) : null}
                      {approval.preview.documents.length ? (
                        <details className="text-sm">
                          <summary className="cursor-pointer">
                            {t("documents", { count: approval.preview.documents.length })}
                          </summary>
                          <p className="my-2 text-muted-foreground">{t("documentsPolicy")}</p>
                          <ul className="max-h-40 list-inside list-disc overflow-y-auto">
                            {approval.preview.documents.map((d) => (
                              <li key={d.id}>
                                {d.number} · {d.isPosSale ? t("receipt") : t("order")}
                                {d.isHeld ? ` · ${t("held")}` : ""}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={!canSave} onClick={() => void save()}>
                      {saveMutation.isLoading ? common("loading") : t("save")}
                    </Button>
                    <Button variant="secondary" disabled={saveMutation.isLoading} onClick={cancel}>
                      {t("cancel")}
                    </Button>
                  </div>
                </section>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}
      <Modal
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        title={detail?.name ?? t("catalog")}
        className="sm:max-w-3xl"
      >
        <div className="space-y-4">
          {detail ? (
            <>
              <p className="text-sm text-muted-foreground">
                {t("source")}: {detail.sourceName ?? t("sharedSource")}
              </p>
              {detailMode === "view" ? (
                <div className="flex flex-wrap gap-2">
                  {connection && !connection.key.startsWith("baseline:") ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setDetailMode("selection");
                        update(detail.key, { scope: "SELECTED" });
                      }}
                    >
                      {t("chooseProducts")}
                    </Button>
                  ) : null}
                  {connection?.scope === "SELECTED" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => update(detail.key, { scope: "ALL", productIds: [] })}
                    >
                      {t("fullCatalog")}
                    </Button>
                  ) : null}
                  {detail.shared &&
                  current?.connections.some((c) => c.key === detail.key && c.enabled) ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setDetailMode("ownership");
                        setOwnership([]);
                      }}
                    >
                      {t("configure")}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm">
                  {t(detailMode === "ownership" ? "ownershipHelp" : "selectionHelp")}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {t(connection?.scope === "SELECTED" ? "fixedHelp" : "futureHelp")}
              </p>
              {detail.unavailableSelectedIds.length ? (
                <p className="text-xs text-muted-foreground">
                  {t("archivedSelection", { count: detail.unavailableSelectedIds.length })}
                </p>
              ) : null}
              <Input
                aria-label={t("searchProducts")}
                placeholder={t("searchProducts")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {detailMode !== "view" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={bulkLoading || products.isFetching}
                    onClick={() => void selectAllMatches()}
                  >
                    {t("selectAllMatches")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelection([])}>
                    {t("clearSelection")}
                  </Button>
                  <span className="text-sm">
                    {t("selectedCount", { count: selectedIds.length })}
                  </span>
                </div>
              ) : null}
              {products.isLoading ? (
                <Spinner />
              ) : products.error ? (
                <QueryErrorState onRetry={() => void products.refetch()} />
              ) : (
                <div className="divide-y rounded-md border">
                  {products.data?.items.length ? (
                    products.data.items.map((p) => (
                      <div key={p.id} className="flex items-start gap-3 p-3">
                        {detailMode !== "view" ? (
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 shrink-0 accent-primary"
                            aria-label={t("selectProduct", { name: p.name })}
                            checked={selectedIds.includes(p.id)}
                            disabled={
                              products.isPreviousData ||
                              (detailMode === "ownership" && !p.available)
                            }
                            onChange={() => toggleProduct(p.id)}
                          />
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm">{p.name}</p>
                          <p className="text-xs text-muted-foreground">{p.sku ?? p.id}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {p.available ? t("available") : t("unavailable")}
                            {p.reasons.length
                              ? ` · ${p.reasons.map((r) => (r === "OWN" ? t("ownCatalog") : (sourceByKey(r)?.name ?? r))).join(", ")}`
                              : ""}
                          </p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="p-4 text-sm text-muted-foreground">{t("noProducts")}</p>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page === 1 || products.isFetching}
                  onClick={() => setPage((p) => p - 1)}
                >
                  {t("previous")}
                </Button>
                <span className="text-xs">
                  {page} / {Math.max(1, Math.ceil((products.data?.total ?? 0) / 50))}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page * 50 >= (products.data?.total ?? 0) || products.isFetching}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t("next")}
                </Button>
              </div>
              {detailMode === "ownership" ? (
                <Button
                  disabled={!ownership.length || !current}
                  onClick={() => {
                    if (current)
                      edit({
                        ...current,
                        confirmProductIds: [
                          ...new Set([...current.confirmProductIds, ...ownership]),
                        ],
                      });
                    setDetail(null);
                  }}
                >
                  {t("confirmOwn", { count: ownership.length })}
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setDetail(null)}>
                  {t("done")}
                </Button>
              )}
            </>
          ) : null}
        </div>
      </Modal>
      <Modal
        open={!!pendingStore}
        onOpenChange={(open) => {
          if (!open) setPendingStore(null);
        }}
        title={t("unsavedTitle")}
      >
        <p className="mb-4 text-sm">{t("unsavedHelp")}</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!canSave} onClick={() => void save(pendingStore!)}>
            {t("save")}
          </Button>
          <Button
            variant="secondary"
            disabled={saveMutation.isLoading}
            onClick={() => {
              cancel();
              setSelected(pendingStore!);
              setPendingStore(null);
            }}
          >
            {t("discard")}
          </Button>
          <Button variant="ghost" onClick={() => setPendingStore(null)}>
            {t("stay")}
          </Button>
        </div>
      </Modal>
      <Modal open={historyOpen} onOpenChange={setHistoryOpen} title={t("history")}>
        <div className="space-y-3">
          {history.isLoading ? (
            <Spinner />
          ) : history.error ? (
            <QueryErrorState onRetry={() => void history.refetch()} />
          ) : history.data?.items.length ? (
            history.data.items.map((item) => {
              const after = item.after as {
                summary?: { added?: number; hidden?: number; confirmed?: number };
                settings?: CatalogSettings;
              } | null;
              const before = item.before as CatalogSettings | null;
              const changed =
                after?.settings?.connections.filter((c) => {
                  const old = before?.connections.find((p) => p.key === c.key);
                  return (
                    !old ||
                    old.enabled !== c.enabled ||
                    old.scope !== c.scope ||
                    JSON.stringify(old.productIds) !== JSON.stringify(c.productIds)
                  );
                }) ?? [];
              return (
                <div key={item.id} className="border-b pb-3 text-sm">
                  <p>
                    {item.actor?.name ?? t("unknownActor")} ·{" "}
                    {formatDateTime(item.createdAt, locale)}
                  </p>
                  <p className="text-muted-foreground">
                    {t("historyImpact", {
                      added: after?.summary?.added ?? 0,
                      hidden: after?.summary?.hidden ?? 0,
                    })}
                  </p>
                  {after?.summary?.confirmed ? (
                    <p className="text-xs">
                      {t("confirmedImpact", { count: after.summary.confirmed })}
                    </p>
                  ) : null}
                  {changed.map((c) => (
                    <p key={c.key} className="text-xs">
                      {sourceByKey(c.key)?.name ?? t("catalog")}:{" "}
                      {t(c.enabled ? "enabled" : "disabled")}
                      {c.scope === "SELECTED"
                        ? ` · ${t("selectedCount", { count: c.productIds.length })}`
                        : ""}
                    </p>
                  ))}
                </div>
              );
            })
          ) : (
            <p className="text-sm">{t("emptyHistory")}</p>
          )}
          <div className="flex justify-between">
            <Button
              size="sm"
              variant="secondary"
              disabled={historyPage === 1}
              onClick={() => setHistoryPage((p) => p - 1)}
            >
              {t("previous")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={historyPage * 20 >= (history.data?.total ?? 0)}
              onClick={() => setHistoryPage((p) => p + 1)}
            >
              {t("next")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

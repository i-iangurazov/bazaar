"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/routers/_app";
import { priceBookEntrySchema, type PriceBookChangeInput } from "@/lib/priceBookContract";
import {
  priceBookPendingKey,
  readPriceBookPending,
  savePriceBookPending,
} from "@/lib/priceBookPending";
import { trpc } from "@/lib/trpc";
import { useSse } from "@/lib/useSse";
import { PriceBookPositionList } from "@/components/products/price-book-position-list";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { IconButton } from "@/components/ui/icon-button";
import { QueryErrorState } from "@/components/query-error-state";
import { Spinner } from "@/components/ui/spinner";
import { RestoreIcon, CloseIcon, DeleteIcon } from "@/components/icons";

type Output = inferRouterOutputs<AppRouter>;
type Preview = Output["priceBooks"]["preview"];
type Approval = {
  bookId: string;
  change: PriceBookChangeInput;
  preview: Preview;
  idempotencyKey: string;
};
type Entry = Extract<PriceBookChangeInput, { kind: "PRICES" }>["entries"][number];
const selectClass =
  "h-[var(--control-height)] min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm";
const ek = (p: string, v?: string | null) => `${p}:${v ?? "BASE"}`;
const parse = (s: string) => Number(s.trim().replace(",", "."));

export default function PriceListsPage() {
  const t = useTranslations("priceBooks"),
    common = useTranslations("common"),
    errors = useTranslations("errors"),
    locale = useLocale();
  const utils = trpc.useUtils();
  const overview = trpc.priceBooks.list.useQuery();
  const [bookId, setBookId] = useState("");
  const activeBook = bookId || overview.data?.books[0]?.id || "";
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  const [storeId, setStoreId] = useState("");
  const detail = trpc.priceBooks.detail.useQuery(
    { bookId: activeBook, search: query || undefined, page, storeId: storeId || undefined },
    { enabled: !!activeBook, keepPreviousData: true },
  );
  const [draft, setDraft] = useState<Entry[]>([]),
    [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  const [newOpen, setNewOpen] = useState(false),
    [name, setName] = useState("");
  const [connectOpen, setConnectOpen] = useState(false),
    [stores, setStores] = useState<string[]>([]),
    [preserve, setPreserve] = useState(true);
  const [prepareOpen, setPrepareOpen] = useState(false),
    [source, setSource] = useState(""),
    [replace, setReplace] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false),
    [bulkKind, setBulkKind] = useState<"RETAIL" | "WHOLESALE">("RETAIL"),
    [bulkMode, setBulkMode] = useState<"SET" | "PERCENT" | "AMOUNT">("PERCENT"),
    [bulkValue, setBulkValue] = useState("");
  const [edit, setEdit] = useState<{
    productId: string;
    variantId: string | null;
    label: string;
    retail: string;
    wholesale: string;
    retailShared: boolean;
    wholesaleShared: boolean;
  } | null>(null);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const preview = trpc.priceBooks.preview.useMutation(),
    publish = trpc.priceBooks.publish.useMutation(),
    create = trpc.priceBooks.create.useMutation(),
    prepare = trpc.priceBooks.prepareFromStore.useMutation(),
    bulk = trpc.priceBooks.prepareBulk.useMutation();
  const reconcile = trpc.priceBooks.reconcile.useMutation();
  const pendingKey = overview.data
    ? priceBookPendingKey(overview.data.organizationId, overview.data.actorId)
    : "";
  const restoredKey = useRef("");
  useEffect(() => {
    if (!pendingKey || restoredKey.current === pendingKey) return;
    restoredKey.current = pendingKey;
    try {
      const pending = readPriceBookPending<Approval>(sessionStorage, pendingKey);
      if (pending) {
        setBookId(pending.bookId);
        setApproval(pending);
        setUncertain(true);
      }
    } catch {
      /* Read failure is surfaced before any new publication. */
    }
  }, [pendingKey]);
  function clearPending() {
    try {
      if (pendingKey) sessionStorage.removeItem(pendingKey);
    } catch {}
  }
  const busy =
    reconcile.isLoading ||
    preview.isLoading ||
    publish.isLoading ||
    create.isLoading ||
    prepare.isLoading ||
    bulk.isLoading;
  const [compareOpen, setCompareOpen] = useState(false),
    [target, setTarget] = useState(""),
    [comparePage, setComparePage] = useState(1),
    [onlyDifferences, setOnlyDifferences] = useState(true);
  const comparison = trpc.priceBooks.compare.useQuery(
    {
      sourceId: source,
      targetId: target,
      search: query || undefined,
      onlyDifferences,
      page: comparePage,
    },
    { enabled: compareOpen && !!source && !!target && source !== target, keepPreviousData: true },
  );
  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(search);
      setPage(1);
      setComparePage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [search]);
  useEffect(() => {
    if (!draft.length && !uncertain && !publish.isLoading) return;
    const listener = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [draft.length, uncertain, publish.isLoading]);
  useSse({
    "pricing.updated": () => {
      void utils.priceBooks.invalidate();
    },
  });
  const money = (v: unknown) =>
    v == null ? "—" : new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Number(v));
  const fail = (e: unknown) => {
    const message = e instanceof Error ? e.message.replace(/^errors\./, "") : "genericMessage";
    setError(errors.has(message) ? errors(message) : errors("genericMessage"));
    setNotice("");
  };
  async function request(change: PriceBookChangeInput) {
    if (draft.length && change.kind !== "PRICES") {
      setNotice(t("discardFirst"));
      return;
    }
    setError(null);
    setNotice("");
    try {
      const p = await preview.mutateAsync({ bookId: activeBook, change });
      setEdit(null);
      setConnectOpen(false);
      setPrepareOpen(false);
      setBulkOpen(false);
      setUncertain(false);
      setApproval({ bookId: activeBook, change, preview: p, idempotencyKey: crypto.randomUUID() });
    } catch (e) {
      fail(e);
    }
  }
  async function apply() {
    if (!approval || publish.isLoading) return;
    setError(null);
    try {
      if (!pendingKey) throw new Error("priceBookStorageUnavailable");
      savePriceBookPending(sessionStorage, pendingKey, approval);
    } catch {
      fail(new Error("priceBookStorageUnavailable"));
      return;
    }
    try {
      await publish.mutateAsync({
        bookId: approval.bookId,
        change: approval.change,
        token: approval.preview.token,
        idempotencyKey: approval.idempotencyKey,
      });
      clearPending();
      setApproval(null);
      setUncertain(false);
      setDraft([]);
      setSelected([]);
      setNotice(t("saved"));
      await Promise.allSettled([utils.priceBooks.invalidate(), utils.products.invalidate()]);
    } catch (e) {
      fail(e);
      const code = (e as { data?: { code?: string } })?.data?.code;
      if (
        code &&
        ["CONFLICT", "BAD_REQUEST", "FORBIDDEN", "NOT_FOUND", "UNAUTHORIZED"].includes(code)
      ) {
        if (!uncertain) {
          clearPending();
          setUncertain(false);
        }
      } else setUncertain(true);
    }
  }
  async function checkResult() {
    if (!approval || busy) return;
    setError(null);
    try {
      const r = await reconcile.mutateAsync({
        bookId: approval.bookId,
        change: approval.change,
        token: approval.preview.token,
        idempotencyKey: approval.idempotencyKey,
      });
      clearPending();
      setApproval(null);
      setUncertain(false);
      if (r.status === "POSTED") {
        setDraft([]);
        setSelected([]);
        setNotice(t("saved"));
      } else {
        if (approval.change.kind === "PRICES") setDraft(approval.change.entries);
        setNotice(t("attemptCanceled"));
      }
      await Promise.allSettled([utils.priceBooks.invalidate(), utils.products.invalidate()]);
    } catch (e) {
      fail(e);
    }
  }
  const storeOptions = overview.data?.stores ?? [];
  const connected = detail.data?.bindings ?? [];
  if (overview.isLoading)
    return (
      <div className="p-6">
        <Spinner />
      </div>
    );
  if (overview.error)
    return <QueryErrorState error={overview.error} onRetry={() => void overview.refetch()} />;
  const book = detail.data?.book;
  const entryMap = new Map(
    detail.data?.entries.map((e) => [
      ek(e.productId, e.variantKey === "BASE" ? null : e.variantKey),
      e,
    ]) ?? [],
  );
  const draftMap = new Map(draft.map((e) => [ek(e.productId, e.variantId), e]));
  const itemMap = new Map(
    detail.data?.items.map((e) => [
      ek(e.productId, e.variantKey === "BASE" ? null : e.variantKey),
      e,
    ]) ?? [],
  );
  function openEditor(productId: string, variantId: string | null, label: string) {
    const e = draftMap.get(ek(productId, variantId)) ?? entryMap.get(ek(productId, variantId)),
      item = itemMap.get(ek(productId, variantId));
    setEdit({
      productId,
      variantId,
      label,
      retail: e?.retailPriceKgs?.toString() ?? "",
      wholesale: e?.wholesalePriceKgs?.toString() ?? "",
      retailShared: item?.retailShared ?? false,
      wholesaleShared: item?.wholesaleShared ?? false,
    });
    setError(null);
  }
  function stageEntry() {
    if (
      !edit ||
      !edit.retail.trim() ||
      !Number.isFinite(parse(edit.retail)) ||
      parse(edit.retail) < 0 ||
      (edit.wholesale.trim() &&
        (!Number.isFinite(parse(edit.wholesale)) || parse(edit.wholesale) < 0))
    ) {
      fail(new Error("priceBookAmountInvalid"));
      return;
    }
    const e: Entry = {
      productId: edit.productId,
      variantId: edit.variantId,
      retailPriceKgs: parse(edit.retail),
      wholesalePriceKgs: edit.wholesale.trim() ? parse(edit.wholesale) : null,
    };
    if (!priceBookEntrySchema.safeParse(e).success) {
      fail(new Error("priceBookAmountInvalid"));
      return;
    }
    setDraft((old) => [
      ...old.filter((x) => ek(x.productId, x.variantId) !== ek(e.productId, e.variantId)),
      e,
    ]);
    setEdit(null);
    setError(null);
  }
  return (
    <div className="min-w-0 space-y-5">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="flex flex-wrap gap-2">
        <Button
          variant={compareOpen ? "secondary" : "primary"}
          onClick={() => setCompareOpen(false)}
        >
          {t("lists")}
        </Button>
        <Button
          variant={compareOpen ? "primary" : "secondary"}
          onClick={() => setCompareOpen(true)}
        >
          {t("comparison")}
        </Button>
      </div>
      {notice && (
        <p role="status" className="rounded-lg border bg-secondary p-3 text-sm">
          {notice}
        </p>
      )}
      {error && !approval && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Input
        aria-label={common("search")}
        placeholder={common("search")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-lg"
      />
      {compareOpen ? (
        <section className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("comparisonHelp")}</p>
          <div className="flex flex-wrap gap-3">
            <label className="grid gap-1 text-sm">
              {t("source")}
              <select
                className={selectClass}
                aria-label={t("source")}
                value={source}
                onChange={(e) => {
                  setSource(e.target.value);
                  setComparePage(1);
                }}
              >
                <option value="">{t("chooseStore")}</option>
                {storeOptions.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              {t("target")}
              <select
                className={selectClass}
                aria-label={t("target")}
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  setComparePage(1);
                }}
              >
                <option value="">{t("chooseStore")}</option>
                {storeOptions
                  .filter((s) => s.id !== source)
                  .map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 p-0 accent-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                checked={onlyDifferences}
                onChange={(e) => {
                  setOnlyDifferences(e.target.checked);
                  setComparePage(1);
                }}
              />
              {t("onlyDifferences")}
            </label>
          </div>
          {comparison.isFetching && <Spinner />}
          {comparison.error && (
            <QueryErrorState error={comparison.error} onRetry={() => void comparison.refetch()} />
          )}
          {comparison.data && (
            <>
              <p className="text-sm">{t("compareCounts", comparison.data.counts)}</p>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-secondary text-left">
                      <th className="p-3">{t("product")}</th>
                      <th className="p-3">{t("sourcePrices")}</th>
                      <th className="p-3">{t("targetPrices")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.data.rows.map((r) => (
                      <tr key={ek(r.productId, r.variantKey)} className="border-t">
                        <td className="p-3 font-medium">
                          {r.name}
                          {r.variantName && ` — ${r.variantName}`}
                          <div className="text-xs text-muted-foreground">{r.sku}</div>
                        </td>
                        <td className="p-3">
                          {t("retail")}: {money(r.sourceRetail)}
                          <br />
                          {t("wholesale")}: {money(r.sourceWholesale)}
                          {!r.sourceAvailable && (
                            <div className="text-xs text-muted-foreground">
                              {t("outsideAssortment")}
                            </div>
                          )}
                        </td>
                        <td className="p-3">
                          {t("retail")}: {money(r.targetRetail)}
                          <br />
                          {t("wholesale")}: {money(r.targetWholesale)}
                          {r.targetExplicitRetail == null && (
                            <div className="text-xs text-muted-foreground">
                              {t("noIndividualRetail")}
                            </div>
                          )}
                          {!r.targetAvailable && (
                            <div className="text-xs text-muted-foreground">
                              {t("outsideAssortment")}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!comparison.data.rows.length && <p>{t("noDifferences")}</p>}
              <div className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  disabled={comparePage === 1}
                  onClick={() => setComparePage((p) => p - 1)}
                >
                  {t("previous")}
                </Button>
                <span>
                  {comparePage} / {Math.max(1, Math.ceil(comparison.data.total / 50))}
                </span>
                <Button
                  variant="secondary"
                  disabled={comparePage * 50 >= comparison.data.total}
                  onClick={() => setComparePage((p) => p + 1)}
                >
                  {t("next")}
                </Button>
              </div>
            </>
          )}
        </section>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid min-w-0 gap-1 text-sm">
              {t("list")}
              <select
                className={selectClass}
                aria-label={t("list")}
                value={activeBook}
                onChange={(e) => {
                  if (draft.length) {
                    setNotice(t("discardFirst"));
                    return;
                  }
                  setBookId(e.target.value);
                  setPage(1);
                  setStoreId("");
                  setSelected([]);
                }}
              >
                <option value="" disabled>
                  {t("chooseList")}
                </option>
                {overview.data?.books.map((b) => (
                  <option value={b.id} key={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="secondary"
              disabled={busy || !!draft.length}
              title={draft.length ? t("discardFirst") : undefined}
              onClick={() => {
                setNewOpen(true);
                setName("");
              }}
            >
              {t("create")}
            </Button>
            {activeBook && (
              <>
                <Button
                  variant="secondary"
                  disabled={busy || !!draft.length}
                  onClick={() => {
                    setStores([]);
                    setPreserve(true);
                    setConnectOpen(true);
                  }}
                >
                  {t("connect")}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || !!draft.length}
                  onClick={() => {
                    setReplace(false);
                    setPrepareOpen(true);
                  }}
                >
                  {t("prepareFromStore")}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || !!draft.length}
                  onClick={() => setBulkOpen(true)}
                >
                  {t("bulk")}
                </Button>
              </>
            )}
          </div>
          {!activeBook && (
            <p className="rounded-lg border p-5 text-muted-foreground">{t("empty")}</p>
          )}
          {detail.error && (
            <QueryErrorState error={detail.error} onRetry={() => void detail.refetch()} />
          )}
          {activeBook && detail.isLoading && <Spinner />}
          {book && (
            <>
              <div className="space-y-3 rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">{t("rules")}</p>
                {!detail.data?.retailWholesaleEnabled && (
                  <p className="text-sm">{t("wholesaleDisabled")}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {connected.map((b) => (
                    <div
                      className="flex max-w-full items-center gap-1 rounded-md bg-secondary pl-3 text-sm"
                      key={b.storeId}
                    >
                      <span className="truncate">
                        {storeOptions.find((s) => s.id === b.storeId)?.name}
                      </span>
                      <IconButton
                        icon={CloseIcon}
                        label={t("disconnect")}
                        variant="ghost"
                        disabled={busy || !!draft.length}
                        onClick={() => void request({ kind: "DISCONNECT", storeIds: [b.storeId] })}
                      />
                    </div>
                  ))}
                  {!connected.length && (
                    <span className="text-sm text-muted-foreground">{t("noStores")}</span>
                  )}
                </div>
                <label className="grid max-w-sm gap-1 text-sm">
                  {t("inspectStore")}
                  <select
                    className={selectClass}
                    aria-label={t("inspectStore")}
                    value={storeId}
                    onChange={(e) => setStoreId(e.target.value)}
                  >
                    <option value="">{t("listOnly")}</option>
                    {connected.map((b) => (
                      <option key={b.storeId} value={b.storeId}>
                        {storeOptions.find((s) => s.id === b.storeId)?.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {draft.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <span>{t("draftCount", { count: draft.length })}</span>
                  <Button
                    disabled={busy}
                    onClick={() => void request({ kind: "PRICES", entries: draft })}
                  >
                    {t("preview")}
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => setDraft([])}>
                    {t("discard")}
                  </Button>
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                {t("selectedCount", { count: selected.length })}
              </p>
              <PriceBookPositionList
                rows={
                  detail.data?.products.flatMap((p) =>
                    [
                      { variantId: null as string | null, label: p.name },
                      ...p.variants.map((v) => ({
                        variantId: v.id,
                        label: `${p.name} — ${v.name || v.sku || v.id.slice(0, 8)}`,
                      })),
                    ].map((v) => {
                      const e =
                          draftMap.get(ek(p.id, v.variantId)) ??
                          entryMap.get(ek(p.id, v.variantId)),
                        item = itemMap.get(ek(p.id, v.variantId));
                      return {
                        productId: p.id,
                        variantId: v.variantId,
                        label: v.label,
                        sku: p.sku,
                        unit:
                          locale === "kg"
                            ? p.baseUnit.labelKg
                            : locale === "ru"
                              ? p.baseUnit.labelRu
                              : p.baseUnit.code,
                        retail: money(e?.retailPriceKgs),
                        wholesale: money(e?.wholesalePriceKgs),
                        draft: draftMap.has(ek(p.id, v.variantId)),
                        selected: selected.includes(p.id),
                        sources: storeId
                          ? {
                              retail: t(item?.retailShared ? "shared" : "individual"),
                              wholesale: t(item?.wholesaleShared ? "shared" : "individual"),
                            }
                          : undefined,
                      };
                    }),
                  ) ?? []
                }
                allSelected={
                  !!detail.data?.products.length &&
                  detail.data.products.every((p) => selected.includes(p.id))
                }
                onSelectPage={(checked) =>
                  setSelected((old) =>
                    checked
                      ? [...new Set([...old, ...detail.data!.products.map((p) => p.id)])]
                      : old.filter((id) => !detail.data!.products.some((p) => p.id === id)),
                  )
                }
                onSelect={(id, checked) =>
                  setSelected((old) =>
                    checked ? [...new Set([...old, id])] : old.filter((x) => x !== id),
                  )
                }
                onEdit={(r) => openEditor(r.productId, r.variantId, r.label)}
              />
              {!detail.data?.products.length && <p>{t("noProducts")}</p>}
              <div className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  {t("previous")}
                </Button>
                <span>
                  {page} / {Math.max(1, Math.ceil((detail.data?.total ?? 0) / 50))}
                </span>
                <Button
                  variant="secondary"
                  disabled={page * 50 >= (detail.data?.total ?? 0)}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t("next")}
                </Button>
              </div>
              <section className="space-y-3">
                <h2 className="font-semibold">{t("history")}</h2>
                {!detail.data?.history.length && (
                  <p className="text-sm text-muted-foreground">{t("noHistory")}</p>
                )}
                {detail.data?.history.map((h) => (
                  <div
                    key={h.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="text-sm">
                      <span className="font-medium">{t(`kind${h.kind}`)}</span>
                      <div className="text-xs text-muted-foreground">
                        {new Intl.DateTimeFormat(locale, {
                          dateStyle: "short",
                          timeStyle: "short",
                          timeZone: "Asia/Bishkek",
                        }).format(new Date(h.createdAt))}{" "}
                        · {h.actorName} · {t("version", { version: h.version })}
                      </div>
                    </div>
                    <IconButton
                      icon={RestoreIcon}
                      label={t("rollback")}
                      variant="ghost"
                      disabled={
                        busy ||
                        !!draft.length ||
                        h.version !== book.version ||
                        h.kind === "ROLLBACK"
                      }
                      onClick={() => void request({ kind: "ROLLBACK", changeId: h.id })}
                    />
                  </div>
                ))}
              </section>
            </>
          )}
        </>
      )}
      <Modal open={newOpen} onOpenChange={(v) => !busy && setNewOpen(v)} title={t("create")}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || draft.length) return;
            try {
              const b = await create.mutateAsync({ name });
              setBookId(b.id);
              setNewOpen(false);
              setDraft([]);
              setSelected([]);
              setPage(1);
              setStoreId("");
              await overview.refetch();
            } catch (err) {
              fail(err);
            }
          }}
        >
          <label className="grid gap-1 text-sm">
            {t("name")}
            <Input
              aria-label={t("name")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required
            />
          </label>
          <Button disabled={busy || !name.trim()}>{t("create")}</Button>
        </form>
      </Modal>
      <Modal
        open={connectOpen}
        onOpenChange={(v) => !busy && setConnectOpen(v)}
        subtitle={error ?? undefined}
        title={t("connect")}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("connectHelp")}</p>
          {storeOptions
            .filter((s) => !overview.data?.bindings.some((b) => b.storeId === s.id))
            .map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 p-0 accent-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  checked={stores.includes(s.id)}
                  onChange={(e) =>
                    setStores((old) =>
                      e.target.checked ? [...old, s.id] : old.filter((id) => id !== s.id),
                    )
                  }
                />
                {s.name}
              </label>
            ))}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 p-0 accent-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              checked={preserve}
              onChange={(e) => setPreserve(e.target.checked)}
            />
            {t("preserveLocal")}
          </label>
          {!preserve && <p className="text-sm text-danger">{t("replaceWarning")}</p>}
          <Button
            disabled={busy || !stores.length}
            onClick={() =>
              void request({ kind: "CONNECT", storeIds: stores, preserveLocal: preserve })
            }
          >
            {t("preview")}
          </Button>
        </div>
      </Modal>
      <Modal
        open={prepareOpen}
        onOpenChange={(v) => !busy && setPrepareOpen(v)}
        subtitle={error ?? undefined}
        title={t("prepareFromStore")}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("prepareHelp")}</p>
          <label className="grid gap-1 text-sm">
            {t("source")}
            <select
              className={selectClass}
              aria-label={t("source")}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="">{t("chooseStore")}</option>
              {storeOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 p-0 accent-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              checked={replace}
              onChange={(e) => setReplace(e.target.checked)}
            />
            {t("replaceExisting")}
          </label>
          <Button
            disabled={busy || !source}
            onClick={async () => {
              try {
                const p = await prepare.mutateAsync({
                  bookId: activeBook,
                  sourceId: source,
                  replaceExisting: replace,
                });
                await request(p.change);
                setNotice(t("preparedCounts", { missing: p.missing, retained: p.retained }));
              } catch (e) {
                fail(e);
              }
            }}
          >
            {t("preview")}
          </Button>
        </div>
      </Modal>
      <Modal open={bulkOpen} onOpenChange={(v) => !busy && setBulkOpen(v)} title={t("bulk")}>
        <div className="space-y-4">
          <p className="text-sm">
            {selected.length ? t("bulkSelected", { count: selected.length }) : t("bulkAll")}
          </p>
          <label className="grid gap-1 text-sm">
            {t("priceKind")}
            <select
              className={selectClass}
              value={bulkKind}
              onChange={(e) => setBulkKind(e.target.value as typeof bulkKind)}
            >
              <option value="RETAIL">{t("retail")}</option>
              <option value="WHOLESALE">{t("wholesale")}</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            {t("method")}
            <select
              className={selectClass}
              value={bulkMode}
              onChange={(e) => setBulkMode(e.target.value as typeof bulkMode)}
            >
              <option value="PERCENT">{t("percent")}</option>
              <option value="AMOUNT">{t("amount")}</option>
              <option value="SET">{t("set")}</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            {t("value")}
            <Input
              aria-label={t("value")}
              inputMode="decimal"
              value={bulkValue}
              onChange={(e) => setBulkValue(e.target.value)}
            />
          </label>
          <Button
            disabled={busy || !bulkValue.trim() || !Number.isFinite(parse(bulkValue))}
            onClick={async () => {
              try {
                const p = await bulk.mutateAsync({
                  bookId: activeBook,
                  kind: bulkKind,
                  mode: bulkMode,
                  value: parse(bulkValue),
                  productIds: selected.length ? selected : undefined,
                });
                await request(p);
              } catch (e) {
                fail(e);
              }
            }}
          >
            {t("preview")}
          </Button>
        </div>
      </Modal>
      <Modal
        open={!!edit}
        onOpenChange={(v) => !busy && !v && setEdit(null)}
        subtitle={error ?? undefined}
        title={edit?.label ?? t("edit")}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("editHelp")}</p>
          <label className="grid gap-1 text-sm">
            {t("retail")} · KGS
            <Input
              aria-label={t("retail")}
              inputMode="decimal"
              value={edit?.retail ?? ""}
              onChange={(e) => setEdit((old) => old && { ...old, retail: e.target.value })}
            />
          </label>
          <label className="grid gap-1 text-sm">
            {t("wholesale")} · KGS
            <Input
              aria-label={t("wholesale")}
              inputMode="decimal"
              value={edit?.wholesale ?? ""}
              onChange={(e) => setEdit((old) => old && { ...old, wholesale: e.target.value })}
            />
          </label>
          <Button disabled={busy} onClick={stageEntry}>
            {t("stage")}
          </Button>
          {edit && entryMap.has(ek(edit.productId, edit.variantId)) && (
            <IconButton
              icon={DeleteIcon}
              label={t("removeEntry")}
              variant="ghost"
              disabled={busy || !!draft.length}
              onClick={() =>
                void request({
                  kind: "REMOVE",
                  entries: [{ productId: edit.productId, variantId: edit.variantId }],
                })
              }
            />
          )}
          <p className="text-xs text-muted-foreground">{t("clearWholesaleHelp")}</p>
          {storeId && entryMap.has(ek(edit?.productId ?? "", edit?.variantId)) && (
            <div className="space-y-3 border-t pt-4">
              <p className="text-sm">{t("storeSourceHelp")}</p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 p-0 accent-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  checked={edit?.retailShared ?? false}
                  onChange={(e) =>
                    setEdit((old) => old && { ...old, retailShared: e.target.checked })
                  }
                />
                {t("inheritRetail")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 p-0 accent-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  checked={edit?.wholesaleShared ?? false}
                  onChange={(e) =>
                    setEdit((old) => old && { ...old, wholesaleShared: e.target.checked })
                  }
                />
                {t("inheritWholesale")}
              </label>
              <Button
                variant="secondary"
                disabled={busy || !!draft.length || !edit}
                onClick={() =>
                  edit &&
                  void request({
                    kind: "SOURCE",
                    storeIds: [storeId],
                    productId: edit.productId,
                    variantId: edit.variantId,
                    retailShared: edit.retailShared,
                    wholesaleShared: edit.wholesaleShared,
                  })
                }
              >
                {t("previewSource")}
              </Button>
            </div>
          )}
        </div>
      </Modal>
      <Modal
        open={!!approval}
        onOpenChange={(v) => !busy && !uncertain && !v && setApproval(null)}
        title={t("confirmTitle")}
        className="sm:max-w-2xl"
      >
        <div className="space-y-4">
          {approval && (
            <>
              {notice && <p className="text-sm">{notice}</p>}
              <p className="font-medium">
                {t(`kind${approval.change.kind}`)} ·{" "}
                {overview.data?.books.find((b) => b.id === approval.bookId)?.name}
              </p>
              <p className="text-sm">
                {t("previewCounts", {
                  changed: approval.preview.changedPositions,
                  preserved: approval.preview.preservedKinds,
                  positions: approval.preview.listPositions,
                  stores: approval.preview.connectedStores,
                })}
              </p>
              {approval.change.kind === "DISCONNECT" && (
                <p className="text-sm">{t("disconnectHelp")}</p>
              )}
              {approval.preview.stores.map((s) => (
                <div className="flex justify-between gap-3 text-sm" key={s.id}>
                  <span>{s.name}</span>
                  <span>{s.changedPositions}</span>
                </div>
              ))}
              <p className="text-sm text-muted-foreground">{t("documentsPreserved")}</p>
              <p className="text-sm">
                {t("listChangeCount", { count: approval.preview.listChangedPositions })}
              </p>
              {approval.preview.listSample.length > 0 && (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-xs">
                    <caption className="p-2 text-left font-medium">
                      {t("commonSampleTitle")}
                    </caption>
                    <thead>
                      <tr className="bg-secondary text-left">
                        <th className="p-2">{t("product")}</th>
                        <th className="p-2">{t("retail")}</th>
                        <th className="p-2">{t("wholesale")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {approval.preview.listSample.map((r) => (
                        <tr key={ek(r.productId, r.variantKey)} className="border-t">
                          <td className="p-2">{r.name}</td>
                          <td className="p-2">
                            {money(r.beforeRetail)} → {money(r.retail)}
                          </td>
                          <td className="p-2">
                            {money(r.beforeWholesale)} → {money(r.wholesale)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {approval.preview.sample.length > 0 && (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-secondary text-left">
                        <th className="p-2">{t("product")}</th>
                        <th className="p-2">{t("retail")}</th>
                        <th className="p-2">{t("wholesale")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {approval.preview.sample.map((r) => (
                        <tr key={itemKeyForUi(r)} className="border-t">
                          <td className="p-2">
                            {r.name}
                            <div className="text-muted-foreground">
                              {storeOptions.find((s) => s.id === r.storeId)?.name}
                            </div>
                          </td>
                          <td className="p-2">
                            {money(r.beforeRetail)} →{" "}
                            {r.retail === null
                              ? t(approval.change.kind === "ROLLBACK" ? "absent" : "unchanged")
                              : money(r.retail)}
                          </td>
                          <td className="p-2">
                            {money(r.beforeWholesale)} →{" "}
                            {r.wholesale === null
                              ? t(approval.change.kind === "ROLLBACK" ? "absent" : "unchanged")
                              : money(r.wholesale)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-xs text-muted-foreground">{t("sampleHelp")}</p>
              {error && (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              )}
              {uncertain && (
                <p role="status" className="text-sm">
                  {t("uncertain")}
                </p>
              )}
              <div className="flex flex-wrap gap-3">
                {uncertain && (
                  <Button variant="secondary" disabled={busy} onClick={() => void checkResult()}>
                    {t("checkResult")}
                  </Button>
                )}
                <Button disabled={busy} onClick={() => void apply()}>
                  {publish.isLoading ? t("applying") : uncertain ? t("retrySame") : t("confirm")}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || uncertain}
                  onClick={() => {
                    setApproval(null);
                    setError(null);
                  }}
                >
                  {common("cancel")}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
function itemKeyForUi(r: { storeId: string; productId: string; variantKey: string }) {
  return `${r.storeId}:${r.productId}:${r.variantKey}`;
}

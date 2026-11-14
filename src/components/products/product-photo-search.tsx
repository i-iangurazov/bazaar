"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { ArrowLeft, Camera, Check, Crop, ImageOff, Info, ScanLine, Upload, X } from "lucide-react";
import { ViewIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import styles from "./product-photo-search.module.css";
import { Alert } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { prepareManagedProductImageForUpload } from "@/lib/productImageClientUpload";
import { productPhotoAccept } from "@/lib/productImageUpload";
import { productPhotoSearchMaxBytes, type ProductPhotoProgress, type ProductPhotoSearchResult, type ProductPhotoRegion } from "@/lib/productPhotoSearch";
const ProductPhotoRegionEditor = dynamic(() => import("./product-photo-region-editor").then((module) => module.ProductPhotoRegionEditor), { ssr: false });
import { convertFromKgs, normalizeCurrencyCode } from "@/lib/currency";
import { formatCurrency, formatNumber } from "@/lib/i18nFormat";

type Props = { identityKey: string; storeId: string; stores: { id: string; name: string }[]; disabled?: boolean; selectionMode?: "card" | "preview";
  iconOnly?: boolean; loadingStores?: boolean; storeError?: boolean; onRetryStores?: () => void };

function Photo({ src, alt, className, onDimensions }: { src: string | null; alt: string; className: string; onDimensions?: (size: { width: number; height: number }) => void }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && !failed ? <img src={src} alt={alt} className={className} referrerPolicy="no-referrer" onError={() => setFailed(true)}
    onLoad={(event) => onDimensions?.({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} /> :
    <div className={`${className} flex items-center justify-center bg-secondary`} role="img" aria-label={alt}><ImageOff className="h-6 w-6 text-muted-foreground" aria-hidden /></div>;
}

async function requestJson(url: string, init: RequestInit, signal: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
  try {
    if (signal.aborted) controller.abort();
    const response = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message ?? "photoSearchUnavailable");
    return body;
  } catch (error) {
    if (timedOut) throw new Error("photoSearchTimeout");
    throw error;
  } finally { clearTimeout(timeout); signal.removeEventListener("abort", abort); }
}

function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 2000);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function ProductPhotoSearchButton(props: Props) {
  // An organization/user/store switch destroys photos, results and pending responses.
  return <Workspace key={`${props.identityKey}:${props.storeId}`} {...props} />;
}

function Workspace({ storeId, stores, disabled, selectionMode = "card", iconOnly, loadingStores, storeError, onRetryStores }: Props) {
  const t = useTranslations("productPhotoSearch");
  const common = useTranslations("common");
  const errors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedStore, setSelectedStore] = useState(storeId);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewDimensions, setPreviewDimensions] = useState<{ width: number; height: number } | null>(null);
  const [manualRegion, setManualRegion] = useState<ProductPhotoRegion | null>(null);
  const [automaticRegion, setAutomaticRegion] = useState(true);
  const [editingRegion, setEditingRegion] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "unconfigured" | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"photo" | "catalog" | "search" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProductPhotoProgress | null>(null);
  const [result, setResult] = useState<ProductPhotoSearchResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const useReady = useRef(false);
  const currentStore = stores.find((store) => store.id === selectedStore);
  const cancel = () => { epoch.current += 1; controller.current?.abort(); setBusy(false); setPhase(null); };

  useEffect(() => () => { epoch.current += 1; controller.current?.abort(); }, []);
  useEffect(() => {
    setPreviewDimensions(null);
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    epoch.current += 1;
    controller.current?.abort();
    setBusy(false); setPhase(null);
    setError(null);
    setProgress(null);
    setResult(null); setSelectedId(null);
    if (!open || !selectedStore) { setStatus(null); return; }
    const active = new AbortController();
    controller.current = active;
    const sequence = epoch.current;
    setStatus("loading");
    void requestJson(`/api/products/photo-search?storeId=${encodeURIComponent(selectedStore)}`, {}, active.signal)
      .then((body) => {
        if (active.signal.aborted || sequence !== epoch.current) return;
        setStatus(body.configured ? "ready" : "unconfigured");
        setProgress(body.progress);
      }).catch((cause) => {
        if (!active.signal.aborted && sequence === epoch.current) { setStatus(null); setError(cause instanceof Error ? cause.message : "photoSearchUnavailable"); }
      });
    return () => active.abort();
  }, [open, selectedStore, reload]);

  const changeOpen = (value: boolean) => {
    if (!value) { cancel(); setFile(null); setResult(null); setSelectedId(null); setProgress(null); setError(null); setManualRegion(null); setAutomaticRegion(true); setEditingRegion(false); }
    setOpen(value);
  };
  const chooseFile = (value?: File) => {
    if (!value) return;
    setFile(value); setResult(null); setSelectedId(null); setError(null); setManualRegion(null); setAutomaticRegion(true); setEditingRegion(false);
  };
  const search = async (retryFailed = false, partial = false) => {
    if (!file || !selectedStore || busy || status !== "ready") return;
    cancel();
    const active = new AbortController();
    controller.current = active;
    const sequence = epoch.current;
    const valid = () => !active.signal.aborted && sequence === epoch.current;
    useReady.current = partial;
    setBusy(true); setPhase("photo"); setError(null); setResult(null); setSelectedId(null);
    try {
      const prepared = await prepareManagedProductImageForUpload({ file, maxImageBytes: productPhotoSearchMaxBytes,
        maxInputImageBytes: 32 * 1024 * 1024, serverConversionMaxBytes: productPhotoSearchMaxBytes });
      if (!prepared.ok) throw new Error(prepared.code);
      if (!valid()) return;
      const deadline = Date.now() + 180_000;
      for (let changed = 0; changed < 3; changed += 1) {
        setPhase("catalog");
        let first = true;
        while (valid()) {
          const body = await requestJson("/api/products/photo-search/prepare", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ storeId: selectedStore, retryFailed: retryFailed && first }),
          }, active.signal);
          if (!valid()) return;
          first = false;
          setProgress(body.progress);
          if (!body.progress.pending || (useReady.current && body.progress.ready > 0)) break;
          if (Date.now() > deadline) throw new Error("photoSearchPreparingLong");
          await pause(active.signal);
        }
        if (!valid()) return;
        setPhase("search");
        const form = new FormData();
        form.append("file", prepared.file);
        form.append("storeId", selectedStore);
        form.append("allowPartial", useReady.current ? "1" : "0");
        if (manualRegion) form.append("region", JSON.stringify(manualRegion));
        if (!automaticRegion) form.append("autoRegion", "0");
        let body: ProductPhotoSearchResult | undefined;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try { body = await requestJson("/api/products/photo-search", { method: "POST", body: form }, active.signal); break; }
          catch (cause) {
            if (cause instanceof Error && cause.message === "photoSearchBusy" && attempt < 2) { await pause(active.signal); continue; }
            if (cause instanceof Error && cause.message === "photoSearchPreparing") break;
            throw cause;
          }
        }
        if (!body) continue;
        if (!valid()) return;
        if (body.storeId !== selectedStore || !Array.isArray(body.items)) throw new Error("photoSearchUnavailable");
        setResult(body); setProgress(body.progress);
        return;
      }
      throw new Error("photoSearchPreparingLong");
    } catch (cause) {
      if (valid()) setError(cause instanceof Error ? cause.message : "photoSearchUnavailable");
    } finally { if (valid()) { setBusy(false); setPhase(null); } }
  };
  const errorText = error ? errors.has(error) ? errors(error) : errors("genericMessage") : null;

  const stageText = phase === "photo" ? t("readingPhoto") :
    phase === "catalog" && progress?.pending ? t("preparing", { ready: progress.ready, total: progress.total }) : t("searching");
  const processed = progress ? progress.ready + progress.failed : 0;
  const hasProgress = busy && phase === "catalog" && progress && progress.total > 0 && progress.pending > 0;
  const shownRegion = manualRegion ?? result?.recognition?.region ?? null;

  return <>
    <Button type="button" variant="secondary" size={iconOnly ? "icon" : "default"}
      className={iconOnly ? "h-11 w-11 shrink-0 md:h-9 md:w-9" : undefined}
      aria-label={t("open")} title={t("open")} aria-haspopup="dialog" aria-expanded={open}
      disabled={disabled || (!stores.length && !loadingStores && !storeError)} onClick={() => setOpen(true)}>
      <Camera className="h-4 w-4" aria-hidden />{!iconOnly ? t("open") : null}
    </Button>
    <Modal open={open} onOpenChange={changeOpen} title={t("title")} subtitle={t("subtitle")}
      className="sm:max-w-4xl sm:data-[state=open]:-translate-y-1/2 sm:data-[state=closed]:-translate-y-1/2" bodyClassName="p-0 sm:p-0" animated mobileSheet>
      {editingRegion && preview && previewDimensions ? <ProductPhotoRegionEditor image={preview} dimensions={previewDimensions} initial={shownRegion}
        onCancel={() => setEditingRegion(false)} onApply={(region) => { cancel(); setManualRegion(region); setAutomaticRegion(true); setEditingRegion(false); setResult(null); setError(null); }} /> :
      <div className={selectedId ? "" : "grid md:grid-cols-[280px_minmax(0,1fr)]"}>
        {!selectedId ? <section className="min-w-0 space-y-4 border-b border-border bg-secondary/25 p-4 sm:p-5 md:border-b-0 md:border-r" aria-label={t("queryPhoto")}>
          <div className="space-y-1.5">
            <label htmlFor="photo-search-store" className="text-xs font-medium text-muted-foreground">{common("store")}</label>
            <Select value={selectedStore} onValueChange={setSelectedStore}>
              <SelectTrigger id="photo-search-store" className="bg-card"><SelectValue placeholder={common("selectStore")} /></SelectTrigger>
              <SelectContent>{stores.map((store) => <SelectItem key={store.id} value={store.id}>{store.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {loadingStores ? <p className="flex items-center gap-2 text-sm" role="status"><Spinner className="h-4 w-4" />{common("loading")}</p> : null}
          {storeError ? <Alert variant="destructive" role="alert"><p>{errors("genericMessage")}</p>
            <Button type="button" variant="secondary" className="mt-2" onClick={onRetryStores}>{common("tryAgain")}</Button>
          </Alert> : null}
          <div className={file ? "flex items-start gap-3 md:block md:space-y-3" : "space-y-3"}>
            <div className={(file ? "h-28 w-28 shrink-0 md:h-auto md:w-full md:aspect-square " : "min-h-36 ") +
              "relative flex items-center justify-center overflow-hidden rounded-xl border border-border bg-card p-3"}>
              {file ? <>
                {shownRegion && previewDimensions && preview ? <svg className="h-full w-full" viewBox={`0 0 ${previewDimensions.width} ${previewDimensions.height}`} role="img" aria-label={t("preview")}>
                  <image href={preview} width={previewDimensions.width} height={previewDimensions.height} />
                  <rect x={shownRegion.x * previewDimensions.width} y={shownRegion.y * previewDimensions.height}
                    width={shownRegion.width * previewDimensions.width} height={shownRegion.height * previewDimensions.height}
                    fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" className="text-primary" />
                </svg> : <Photo src={preview} alt={t("preview")} className="h-full w-full object-contain" onDimensions={setPreviewDimensions} />}
                {busy && phase === "search" ? <div className={styles.scan} aria-hidden /> : null}
              </> : <div className="space-y-2 px-3 py-5 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><ScanLine className="h-6 w-6" aria-hidden /></div>
                <p className="text-sm font-medium">{t("choosePhoto")}</p>
                <p className="text-xs text-muted-foreground">{t("oneProduct")}</p>
              </div>}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              {file ? <div className="flex items-start justify-between gap-1">
                <p className="min-w-0 break-all text-xs text-muted-foreground">{file.name}</p>
                <Button type="button" variant="ghost" size="icon" className="-mt-2 h-8 w-8 shrink-0" disabled={busy}
                  aria-label={t("remove")} title={t("remove")} onClick={() => { setFile(null); setResult(null); setSelectedId(null); setManualRegion(null); setAutomaticRegion(true); }}>
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </div> : null}
              <div className={file ? "grid gap-2" : "grid grid-cols-2 gap-2 md:grid-cols-1"}>
                <Button type="button" variant="secondary" className="h-11 w-full bg-card" disabled={busy} onClick={() => camera.current?.click()}>
                  <Camera className="h-4 w-4" aria-hidden />{t("camera")}
                </Button>
                <Button type="button" variant="outline" className="h-11 w-full bg-card" disabled={busy} onClick={() => upload.current?.click()}>
                  <Upload className="h-4 w-4" aria-hidden />{t("upload")}
                </Button>
              </div>
              <input hidden ref={camera} type="file" accept={productPhotoAccept} capture="environment" aria-label={t("camera")} disabled={busy}
                onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
              <input hidden ref={upload} type="file" accept={productPhotoAccept} aria-label={t("upload")} disabled={busy}
                onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
            </div>
          </div>
          {file ? <div className="space-y-2">
            <Button type="button" variant="outline" className="h-11 w-full" disabled={busy || !previewDimensions} title={!previewDimensions ? t("cropNeedsPreview") : undefined} onClick={() => setEditingRegion(true)}>
              <Crop className="h-4 w-4" aria-hidden />{t("editRegion")}
            </Button>
            {shownRegion ? <p className="text-xs text-muted-foreground">{t(manualRegion ? "regionManual" : "regionAuto")}</p> : null}
            <Button type="button" variant="ghost" className="h-auto min-h-9 w-full whitespace-normal text-xs" disabled={busy}
              onClick={() => { setManualRegion(null); setAutomaticRegion(!automaticRegion); setResult(null); }}>
              {t(automaticRegion ? "wholePhoto" : "automaticRegion")}
            </Button>
          </div> : null}
          <p className="text-xs leading-relaxed text-muted-foreground">{t("photoHelp")}</p>
          {status === "loading" ? <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status"><Spinner className="h-3.5 w-3.5 motion-reduce:animate-none" />{common("loading")}</p> : null}
          <div className="space-y-2">
            <Button type="button" className="h-11 w-full" disabled={!file || !selectedStore || status !== "ready" || busy} onClick={() => void search()}>
              {busy ? <Spinner className="h-4 w-4 text-current motion-reduce:animate-none" /> : <ScanLine className="h-4 w-4" aria-hidden />}
              {busy ? t("searchingShort") : t("search")}
            </Button>
            {busy ? <Button type="button" variant="outline" className="h-11 w-full" onClick={cancel}>{common("cancel")}</Button> : null}
            {progress && progress.pending > 0 && progress.ready > 0 ? <Button type="button" variant="outline" className="h-auto min-h-11 w-full whitespace-normal"
              onClick={() => { if (busy) useReady.current = true; else void search(false, true); }}>{t("useReady")}</Button> : null}
          </div>
          {progress?.withoutPhoto ? <p className="text-xs leading-relaxed text-muted-foreground">{t("withoutPhoto", { count: progress.withoutPhoto })}</p> : null}
        </section> : null}

        <section className="min-w-0 space-y-4 p-4 sm:p-5" aria-label={t("results")} aria-busy={busy}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-1">
              <h3 className="flex items-center gap-2 font-semibold">{selectedId ? t("selected") : t("results")}
                {result && !selectedId ? <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">{result.items.length}</span> : null}
              </h3>
              {currentStore ? <p className="text-xs leading-relaxed text-muted-foreground">{t("scope", { store: currentStore.name })}</p> : null}
            </div>
            {selectedId ? <Button type="button" variant="secondary" size="sm" onClick={() => setSelectedId(null)}>
              <ArrowLeft className="h-4 w-4" aria-hidden />{t("backToResults")}
            </Button> : null}
          </div>

          {status === "unconfigured" ? <Alert variant="warning"><p>{t("notConnected")}</p>
            <Button type="button" variant="secondary" className="mt-2" onClick={() => setReload((value) => value + 1)}>{common("tryAgain")}</Button>
          </Alert> : null}
          {errorText ? <Alert variant="destructive" role="alert"><p>{errorText}</p>
            <Button type="button" variant="secondary" className="mt-2" onClick={() => status === "ready" && file ? void search(true) : setReload((value) => value + 1)}>{common("tryAgain")}</Button>
          </Alert> : null}

          {busy ? <div className={styles.enter + " space-y-4"}>
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4" role="status" aria-live="polite">
              <p className="flex items-center gap-2 text-sm font-medium"><Spinner className="h-4 w-4 text-primary motion-reduce:animate-none" />{stageText}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t("preparingHelp")}</p>
              {hasProgress ? <div className="mt-3 space-y-1.5">
                <div role="progressbar" aria-label={t("catalogProgress")} aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={processed}
                  className="h-1.5 overflow-hidden rounded-full bg-primary/10">
                  <div className="h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none" style={{ width: (processed / progress.total * 100) + "%" }} />
                </div>
                <p className="text-xs text-muted-foreground">{t("progressDetail", { ready: progress.ready, failed: progress.failed, total: progress.total })}</p>
              </div> : null}
            </div>
            <div className="grid grid-cols-2 gap-3" aria-hidden>
              {[0, 1, 2, 3].map((number) => <div key={number} className="space-y-3 rounded-xl border border-border p-3">
                <Skeleton className="aspect-[4/3] motion-reduce:animate-none" />
                <Skeleton className="h-3 w-3/4 motion-reduce:animate-none" /><Skeleton className="h-3 w-1/2 motion-reduce:animate-none" />
              </div>)}
            </div>
          </div> : null}

          {result ? <div className="space-y-3">
            {result.recognition ? <Alert variant={["unmatched", "ambiguous"].includes(result.recognition.labelStatus) ? "warning" : "default"}>
              <p>{t(`label_${result.recognition.labelStatus}`)}</p>
              {result.recognition.text ? <p className="mt-1 break-words text-sm font-medium">{t("readLabel", { text: result.recognition.text })}</p> : null}
              {result.items.some((item) => item.matchSource === "text") ? <p className="mt-1 text-xs">{t("textOnlyHelp")}</p> : null}
            </Alert> : null}
            {result.partial ? <Alert variant="warning"><p>{t("partial", { ready: result.progress.ready, total: result.progress.total, failed: result.progress.failed })}</p>
              {result.progress.failed > 0 ? <Button type="button" variant="secondary" className="mt-2" disabled={busy} onClick={() => void search(true)}>{t("retryImages")}</Button> : null}
            </Alert> : null}
            {!selectedId && result.items.length ? <div className="flex items-start gap-2 rounded-lg bg-secondary/60 p-3 text-xs leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>{result.items.length > 1 ? t("compareVariants") : t("candidatesHelp")}</p>
            </div> : null}
            {result.items.length ? <TooltipProvider>
              <ul className={selectedId ? "mx-auto grid max-w-sm grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}>
                {result.items.filter((item) => !selectedId || item.id === selectedId).map((item, index) =>
                  <li key={item.id} className={styles.card + " flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card"}
                    style={{ animationDelay: Math.min(index, 7) * 25 + "ms" }}>
                    <div className="relative aspect-[4/3] shrink-0 border-b border-border/60 bg-secondary/20">
                      <Photo src={item.imageUrl} alt={item.name} className="absolute inset-0 h-full w-full object-contain p-3" />
                      {selectedId ? <span className="absolute right-2 top-2 rounded-full bg-primary p-1 text-primary-foreground"><Check className="h-4 w-4" aria-hidden /></span> : null}
                    </div>
                    <div className="flex flex-1 flex-col gap-2 p-3">
                      <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium leading-snug">{item.name}</p>
                        {item.labelMatched ? <p className="mt-1 flex items-center gap-1 text-xs font-medium text-primary"><Check className="h-3.5 w-3.5 shrink-0" aria-hidden />{t(item.matchSource === "text" ? "textOnlyBadge" : "labelBadge")}</p> : null}
                        {item.sku ? <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{item.sku}</p> : null}
                      </div>
                      <div className="flex items-end justify-between gap-1">
                        <div className="min-w-0">
                          <p className="break-words text-sm font-semibold">{item.priceKgs === null ? t("noPrice") : formatCurrency(convertFromKgs(item.priceKgs, result.currencyRateKgsPerUnit, normalizeCurrencyCode(result.currencyCode)), locale, normalizeCurrencyCode(result.currencyCode))}</p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">{t("onHand", { count: formatNumber(item.onHand, locale) })}</p>
                        </div>
                        {!selectedId ? <Tooltip><TooltipTrigger asChild><Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0" aria-label={t("choose", { name: item.name })}
                          onClick={() => { if (selectionMode === "preview") { setSelectedId(item.id); return; } const returnTo = window.location.pathname + window.location.search; changeOpen(false); router.push("/products/" + encodeURIComponent(item.id) + "?" + new URLSearchParams({ storeId: selectedStore, returnTo })); }}>
                          <ViewIcon className="h-4 w-4" aria-hidden />
                        </Button></TooltipTrigger><TooltipContent>{t("choose", { name: item.name })}</TooltipContent></Tooltip> : null}
                      </div>
                    </div>
                  </li>)}
              </ul>
            </TooltipProvider> : <div className={styles.enter + " flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-8 text-center"} role="status">
              <ImageOff className="h-8 w-8 text-muted-foreground/60" aria-hidden />
              <p className="text-sm font-medium">{result.progress.total ? t("noMatchesTitle") : t("noPhotosTitle")}</p>
              <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">{result.progress.total ? t("empty") : t("noPhotos")}</p>
            </div>}
          </div> : null}

          {!result && !busy && !error && status !== "unconfigured" ? <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-8 text-center md:min-h-80">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary"><ScanLine className="h-6 w-6 text-muted-foreground" aria-hidden /></div>
            <p className="max-w-xs text-sm font-medium">{t("readyToSearch")}</p>
            <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">{t("resultsHelp")}</p>
          </div> : null}
        </section>
      </div>}
    </Modal>
  </>;
}

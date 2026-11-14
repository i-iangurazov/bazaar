"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Camera, ImageOff, Upload } from "lucide-react";
import { ViewIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { Alert } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { prepareManagedProductImageForUpload } from "@/lib/productImageClientUpload";
import { productPhotoAccept } from "@/lib/productImageUpload";
import { productPhotoSearchMaxBytes, type ProductPhotoProgress, type ProductPhotoSearchResult } from "@/lib/productPhotoSearch";
import { convertFromKgs, normalizeCurrencyCode } from "@/lib/currency";
import { formatCurrency, formatNumber } from "@/lib/i18nFormat";

type Props = { identityKey: string; storeId: string; stores: { id: string; name: string }[]; disabled?: boolean; selectionMode?: "card" | "preview" };

function Photo({ src, alt, className }: { src: string | null; alt: string; className: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && !failed ? <img src={src} alt={alt} className={className} referrerPolicy="no-referrer" onError={() => setFailed(true)} /> :
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

function Workspace({ storeId, stores, disabled, selectionMode = "card" }: Props) {
  const t = useTranslations("productPhotoSearch");
  const common = useTranslations("common");
  const errors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedStore, setSelectedStore] = useState(storeId);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unconfigured" | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
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
  const cancel = () => { epoch.current += 1; controller.current?.abort(); setBusy(false); };

  useEffect(() => () => { epoch.current += 1; controller.current?.abort(); }, []);
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    epoch.current += 1;
    controller.current?.abort();
    setBusy(false);
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
    if (!value) { cancel(); setFile(null); setResult(null); setSelectedId(null); setProgress(null); setError(null); }
    setOpen(value);
  };
  const chooseFile = (value?: File) => {
    if (!value) return;
    setFile(value); setResult(null); setSelectedId(null); setError(null);
  };
  const search = async (retryFailed = false, partial = false) => {
    if (!file || !selectedStore || busy || status !== "ready") return;
    cancel();
    const active = new AbortController();
    controller.current = active;
    const sequence = epoch.current;
    const valid = () => !active.signal.aborted && sequence === epoch.current;
    useReady.current = partial;
    setBusy(true); setError(null); setResult(null); setSelectedId(null);
    try {
      const prepared = await prepareManagedProductImageForUpload({ file, maxImageBytes: productPhotoSearchMaxBytes,
        maxInputImageBytes: 32 * 1024 * 1024, serverConversionMaxBytes: productPhotoSearchMaxBytes });
      if (!prepared.ok) throw new Error(prepared.code);
      if (!valid()) return;
      const deadline = Date.now() + 180_000;
      for (let changed = 0; changed < 3; changed += 1) {
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
        const form = new FormData();
        form.append("file", prepared.file);
        form.append("storeId", selectedStore);
        form.append("allowPartial", useReady.current ? "1" : "0");
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
    } finally { if (valid()) setBusy(false); }
  };
  const errorText = error ? errors.has(error) ? errors(error) : errors("genericMessage") : null;

  return <>
    <Button type="button" variant="secondary" disabled={disabled || !stores.length} onClick={() => setOpen(true)}>
      <Camera className="h-4 w-4" aria-hidden />{t("open")}
    </Button>
    <Modal open={open} onOpenChange={changeOpen} title={t("title")} subtitle={t("subtitle")} className="sm:max-w-2xl">
      <div className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="photo-search-store" className="text-sm font-medium">{common("store")}</label>
          <Select value={selectedStore || undefined} onValueChange={setSelectedStore}>
            <SelectTrigger id="photo-search-store"><SelectValue placeholder={common("selectStore")} /></SelectTrigger>
            <SelectContent>{stores.map((store) => <SelectItem key={store.id} value={store.id}>{store.name}</SelectItem>)}</SelectContent>
          </Select>
          {currentStore ? <p className="text-xs text-muted-foreground">{t("scope", { store: currentStore.name })}</p> : null}
        </div>
        {!selectedId ? <>
        {status === "loading" ? <p role="status">{common("loading")}</p> : null}
        {status === "unconfigured" ? <Alert variant="warning"><p>{t("notConnected")}</p><Button type="button" variant="secondary" className="mt-2" onClick={() => setReload((value) => value + 1)}>{common("tryAgain")}</Button></Alert> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => camera.current?.click()}><Camera className="h-4 w-4" aria-hidden />{t("camera")}</Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => upload.current?.click()}><Upload className="h-4 w-4" aria-hidden />{t("upload")}</Button>
          <input hidden ref={camera} type="file" accept={productPhotoAccept} capture="environment" aria-label={t("camera")} disabled={busy}
            onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
          <input hidden ref={upload} type="file" accept={productPhotoAccept} aria-label={t("upload")} disabled={busy}
            onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
        </div>
        <p className="text-sm text-muted-foreground">{t("photoHelp")}</p>
        {file ? <div className="flex items-center gap-3">
          <Photo src={preview} alt={t("preview")} className="h-28 w-28 shrink-0 rounded-md border border-border object-contain" />
          <div className="min-w-0 space-y-2"><p className="break-all text-sm">{file.name}</p>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => { setFile(null); setResult(null); setSelectedId(null); }}>{t("remove")}</Button></div>
        </div> : null}
        {busy ? <div className="space-y-2" role="status" aria-live="polite">
          <p className="flex items-center gap-2 text-sm"><Spinner className="h-4 w-4" />{progress?.pending ? t("preparing", { ready: progress.ready, total: progress.total }) : t("searching")}</p>
          <p className="text-xs text-muted-foreground">{t("preparingHelp")}</p>
        </div> : null}
        {errorText ? <Alert variant="destructive" role="alert"><p>{errorText}</p>
          <Button type="button" variant="secondary" className="mt-2" onClick={() => status === "ready" && file ? void search(true) : setReload((value) => value + 1)}>{common("tryAgain")}</Button>
        </Alert> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={!file || !selectedStore || status !== "ready" || busy} onClick={() => void search()}>{t("search")}</Button>
          {busy ? <Button type="button" variant="outline" onClick={cancel}>{common("cancel")}</Button> : null}
          {progress && progress.pending > 0 && progress.ready > 0 ? <Button type="button" variant="outline" onClick={() => { if (busy) useReady.current = true; else void search(false, true); }}>{t("useReady")}</Button> : null}
        </div>
        {progress?.withoutPhoto ? <p className="text-xs text-muted-foreground">{t("withoutPhoto", { count: progress.withoutPhoto })}</p> : null}
        </> : null}
        {result ? <div className="space-y-3">
          {result.partial ? <Alert variant="warning"><p>{t("partial", { ready: result.progress.ready, total: result.progress.total, failed: result.progress.failed })}</p>
            {result.progress.failed > 0 ? <Button type="button" variant="secondary" className="mt-2" disabled={busy} onClick={() => void search(true)}>{t("retryImages")}</Button> : null}
          </Alert> : null}
          {!selectedId ? <p className="text-sm text-muted-foreground">{t("candidatesHelp")}</p> : null}
          {result.items.length ? <TooltipProvider><ul className="divide-y divide-border rounded-md border border-border">
            {selectedId ? <li className="space-y-2 p-3"><p role="status" className="font-medium">{t("selected")}</p><Button type="button" variant="secondary" onClick={() => setSelectedId(null)}>{t("backToResults")}</Button></li> : null}
            {result.items.filter((item) => !selectedId || item.id === selectedId).map((item) => <li key={item.id} className="flex items-center gap-3 p-3">
              <Photo src={item.imageUrl} alt={item.name} className="h-16 w-16 shrink-0 rounded object-contain" />
              <div className="min-w-0 flex-1"><p className="break-words font-medium">{item.name}</p>
                {item.sku ? <p className="break-all text-xs text-muted-foreground">{item.sku}</p> : null}
                <p className="text-sm">{item.priceKgs === null ? t("noPrice") : formatCurrency(convertFromKgs(item.priceKgs, result.currencyRateKgsPerUnit, normalizeCurrencyCode(result.currencyCode)), locale, normalizeCurrencyCode(result.currencyCode))}</p>
                <p className="text-xs text-muted-foreground">{t("onHand", { count: formatNumber(item.onHand, locale) })}</p>
              </div>
              <Tooltip><TooltipTrigger asChild><Button type="button" variant="outline" size="icon" aria-label={t("choose", { name: item.name })}
                onClick={() => { if (selectionMode === "preview") { setSelectedId(item.id); return; } const returnTo = window.location.pathname + window.location.search; changeOpen(false); router.push(`/products/${encodeURIComponent(item.id)}?${new URLSearchParams({ storeId: selectedStore, returnTo })}`); }}>
                <ViewIcon className="h-4 w-4" aria-hidden />
              </Button></TooltipTrigger><TooltipContent>{t("choose", { name: item.name })}</TooltipContent></Tooltip>
            </li>)}
          </ul></TooltipProvider> : <p className="rounded-md border border-dashed border-border p-5 text-sm" role="status">{result.progress.total ? t("empty") : t("noPhotos")}</p>}
        </div> : null}
      </div>
    </Modal>
  </>;
}

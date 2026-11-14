"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { Camera, ExternalLink, ImageOff, Search, Upload } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { QueryErrorState } from "@/components/query-error-state";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  imageSearchMaxBytes,
  type ImageSearchMode,
  type ImageSearchResult,
} from "@/lib/chinaImageSearch";
import { prepareManagedProductImageForUpload } from "@/lib/productImageClientUpload";
import {
  fetchProductImageUpload,
  productPhotoAccept,
  ProductImageUploadTimeoutError,
} from "@/lib/productImageUpload";

function SearchImage({
  src,
  alt,
  className,
}: {
  src: string | null;
  alt: string;
  className: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && !failed ? (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <div
      className={`${className} flex items-center justify-center bg-secondary`}
      role="img"
      aria-label={alt}
    >
      <ImageOff className="h-8 w-8 text-muted-foreground" aria-hidden />
    </div>
  );
}

// Parent keys this workspace by the authenticated organization AND user. In-flight
// results from a previous identity are discarded; nothing is persisted in storage.
export function ChinaImageSearchWorkspace() {
  const t = useTranslations("chinaImageSearch");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [mode, setMode] = useState<ImageSearchMode | null>(null);
  const [statusError, setStatusError] = useState<Error | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [reload, setReload] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImageSearchResult | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let active = true;
    setMode(null);
    setStatusError(null);
    void fetch("/api/china-image-search", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? "imageSearchUnavailable");
        if (!["disabled", "demo", "live"].includes(body.mode))
          throw new Error("imageSearchUnavailable");
        if (active) setMode(body.mode);
      })
      .catch((cause) => {
        if (active)
          setStatusError(
            cause instanceof Error && cause.name !== "AbortError"
              ? cause
              : new Error("imageSearchUnavailable"),
          );
      })
      .finally(() => clearTimeout(timer));
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [reload]);
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const selectFile = (selected: File | undefined) => {
    if (!selected) return;
    setError(null);
    setResult(null);
    if (selected.size > 32 * 1024 * 1024) {
      setError(new Error("imageTooLargeInput"));
      return;
    }
    setFile(selected);
  };
  const search = async () => {
    if (!file || busy || !mode || mode === "disabled") return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const prepared = await prepareManagedProductImageForUpload({
        file,
        maxImageBytes: imageSearchMaxBytes,
        maxInputImageBytes: 32 * 1024 * 1024,
        serverConversionMaxBytes: imageSearchMaxBytes,
      });
      if (!prepared.ok) throw new Error(prepared.code);
      if (!mounted.current) return;
      const formData = new FormData();
      formData.append("file", prepared.file);
      formData.append("locale", locale);
      formData.append("consent", consent ? "1" : "0");
      const response = await fetchProductImageUpload({
        url: "/api/china-image-search",
        formData,
        timeoutMs: 45_000,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "imageSearchUnavailable");
      if (!["demo", "live"].includes(body.mode) || !Array.isArray(body.items))
        throw new Error("imageSearchUnavailable");
      if (mounted.current) setResult(body);
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof ProductImageUploadTimeoutError
            ? new Error("imageSearchTimeout")
            : cause instanceof Error
              ? cause
              : new Error("imageSearchUnavailable"),
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const hasAccess = mode === "live" || mode === "demo";
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {statusError ? (
        <QueryErrorState
          error={{ message: statusError.message, shape: undefined, data: undefined }}
          onRetry={() => setReload((value) => value + 1)}
        />
      ) : null}
      {!mode && !statusError ? <p role="status">{tCommon("loading")}</p> : null}
      {mode ? (
        <div
          className="space-y-2 rounded-md border border-border bg-secondary/40 p-4"
          role="status"
        >
          <Badge variant={mode === "demo" ? "warning" : mode === "live" ? "success" : "muted"}>
            {t(mode)}
          </Badge>
          <p className="text-sm text-muted-foreground">{t(`${mode}Help`)}</p>
        </div>
      ) : null}

      {hasAccess ? (
        <Card>
          <CardContent className="space-y-4 p-4 sm:p-6">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => camera.current?.click()}>
                <Camera className="h-4 w-4" aria-hidden />
                {t("camera")}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => upload.current?.click()}>
                <Upload className="h-4 w-4" aria-hidden />
                {t("upload")}
              </Button>
              <input
                ref={camera}
                type="file"
                accept={productPhotoAccept}
                capture="environment"
                hidden
                aria-label={t("camera")}
                disabled={busy}
                onChange={(event) => {
                  selectFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <input
                ref={upload}
                type="file"
                accept={productPhotoAccept}
                hidden
                aria-label={t("upload")}
                disabled={busy}
                onChange={(event) => {
                  selectFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </div>
            <p className="text-sm text-muted-foreground">{t("imageHelp")}</p>
            {file ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <SearchImage
                  src={preview}
                  alt={t("preview")}
                  className="h-40 w-40 rounded-md border border-border object-contain"
                />
                <div className="min-w-0 space-y-3">
                  <p className="break-all text-sm">{file.name}</p>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setFile(null);
                      setResult(null);
                      setError(null);
                    }}
                  >
                    {t("clear")}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="py-6 text-sm text-muted-foreground">{t("chooseImage")}</p>
            )}
            {mode === "live" ? (
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 accent-primary"
                  checked={consent}
                  disabled={busy}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                {t("consent")}
              </label>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={!file || busy || (mode === "live" && !consent)}
                onClick={() => void search()}
              >
                {busy ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <Search className="h-4 w-4" aria-hidden />
                )}
                {t(busy ? "searching" : mode === "demo" ? "searchDemo" : "search")}
              </Button>
              {busy ? (
                <span className="text-sm text-muted-foreground" role="status">
                  {t("waiting")}
                </span>
              ) : null}
            </div>
            {error ? (
              <QueryErrorState
                error={{ message: error.message, shape: undefined, data: undefined }}
                onRetry={() => void search()}
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {result ? (
        <section className="space-y-4" aria-label={t("results")} aria-live="polite">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">
              {t(result.mode === "demo" ? "demoResults" : "results")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t(result.mode === "demo" ? "demoHelp" : "priceHelp")}
            </p>
            {result.mode === "live" ? (
              <p className="text-sm text-muted-foreground">
                {t("firstPage", { count: result.items.length })}
              </p>
            ) : null}
          </div>
          {!result.items.length ? (
            <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
              {t("empty")}
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {result.items.map((item) => (
                <Card key={item.id} className="overflow-hidden">
                  <SearchImage
                    src={item.imageUrl}
                    alt={item.title}
                    className="aspect-square w-full bg-secondary/30 object-contain"
                  />
                  <CardContent className="space-y-3 p-4">
                    {result.mode === "demo" ? <Badge variant="warning">{t("demo")}</Badge> : null}
                    <h3 className="break-words text-sm font-medium">{item.title}</h3>
                    <p className="text-lg font-semibold">
                      {item.price === null
                        ? t("priceUnknown")
                        : new Intl.NumberFormat(locale === "kg" ? "ru" : locale, {
                            style: "currency",
                            currency: "CNY",
                          }).format(item.price)}
                    </p>
                    {item.seller ? (
                      <p className="break-words text-xs text-muted-foreground">{item.seller}</p>
                    ) : null}
                    {item.sourceUrl && result.mode === "live" ? (
                      <a
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                      >
                        <ExternalLink className="h-4 w-4" aria-hidden />
                        {t("openOffer")}
                      </a>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {t(result.mode === "demo" ? "noDemoOffer" : "noOffer")}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

export function ChinaImageSearchPage() {
  const { data: session, status } = useSession();
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  if (status === "loading") return <p role="status">{tCommon("loading")}</p>;
  if (!session?.user?.organizationId || !["ADMIN", "MANAGER"].includes(session.user.role))
    return <p role="alert">{tErrors("forbidden")}</p>;
  return <ChinaImageSearchWorkspace key={`${session.user.organizationId}:${session.user.id}`} />;
}

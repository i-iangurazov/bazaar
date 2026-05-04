"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import {
  ProductImageStudioBackground,
  ProductImageStudioJobStatus,
  ProductImageStudioOutputFormat,
} from "@prisma/client";

import { FormActions, FormGrid } from "@/components/form-layout";
import { PageHeader } from "@/components/page-header";
import { ProductSearchResultItem } from "@/components/product-search-result-item";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/i18nFormat";
import {
  prepareManagedProductImageForUpload,
  resolveClientImageMaxBytes,
  resolveClientImageMaxInputBytes,
} from "@/lib/productImageClientUpload";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const formatFileSize = (value?: number | null) => {
  if (!value || value <= 0) {
    return "-";
  }
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${value} B`;
};

const studioMaxImageBytes = resolveClientImageMaxBytes();
const studioMaxInputImageBytes = resolveClientImageMaxInputBytes(studioMaxImageBytes);
const studioAcceptedFileTypes =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,image/heic-sequence,image/heif-sequence,.jpg,.jpeg,.png,.webp,.heic,.heics,.heif,.heifs,.hif";

const ProductImageThumb = ({ imageUrl, name }: { imageUrl?: string | null; name: string }) => {
  const fallbackLabel = name.trim().charAt(0).toUpperCase() || "#";

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className="h-10 w-10 shrink-0 rounded-none border border-border object-cover"
      />
    );
  }

  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-none border border-dashed border-border bg-secondary/60 text-xs font-medium text-muted-foreground">
      {fallbackLabel}
    </div>
  );
};

const overviewBadgeVariant = (status: "NOT_CONFIGURED" | "READY" | "ERROR") => {
  if (status === "READY") {
    return "success" as const;
  }
  if (status === "ERROR") {
    return "danger" as const;
  }
  return "muted" as const;
};

const jobBadgeVariant = (status: ProductImageStudioJobStatus) => {
  if (status === ProductImageStudioJobStatus.SUCCEEDED) {
    return "success" as const;
  }
  if (status === ProductImageStudioJobStatus.FAILED) {
    return "danger" as const;
  }
  if (status === ProductImageStudioJobStatus.PROCESSING) {
    return "warning" as const;
  }
  return "muted" as const;
};

const formatJobErrorMessage = (
  value: string | null | undefined,
  tErrors: ReturnType<typeof useTranslations>,
) => {
  if (!value) {
    return null;
  }
  return tErrors.has?.(value) ? tErrors(value) : value;
};

type UploadedSource = {
  url: string;
  fileName: string;
  size: number;
  mimeType: string;
};

const ProductImageStudioPage = () => {
  const t = useTranslations("productImageStudioSettings");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session } = useSession();
  const { toast } = useToast();
  const trpcUtils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canEdit = session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";
  const canView = Boolean(session?.user?.organizationId);

  const [sourceImage, setSourceImage] = useState<UploadedSource | null>(null);
  const [uploadingSource, setUploadingSource] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<{
    id: string;
    sku: string;
    name: string;
    imageUrl?: string | null;
  } | null>(null);
  const [backgroundMode, setBackgroundMode] = useState<ProductImageStudioBackground>(
    ProductImageStudioBackground.WHITE,
  );
  const [softShadow, setSoftShadow] = useState(false);
  const [tighterCrop, setTighterCrop] = useState(false);
  const [brighterPresentation, setBrighterPresentation] = useState(false);
  const [saveAsPrimary, setSaveAsPrimary] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const overviewQuery = trpc.productImageStudio.overview.useQuery(undefined, {
    enabled: canView,
    refetchInterval: 10_000,
  });
  const jobsQuery = trpc.productImageStudio.jobs.useQuery(
    { limit: 50 },
    {
      enabled: canView,
      refetchInterval: 5_000,
    },
  );
  const selectedJobQuery = trpc.productImageStudio.job.useQuery(
    { jobId: selectedJobId ?? "" },
    {
      enabled: canView && Boolean(selectedJobId),
      refetchInterval: 3_000,
    },
  );
  const productSearchQuery = trpc.products.searchQuick.useQuery(
    { q: productSearch },
    { enabled: canView && productSearch.trim().length >= 1 },
  );

  useEffect(() => {
    if (!selectedJobId && jobsQuery.data?.length) {
      setSelectedJobId(jobsQuery.data[0]?.id ?? null);
    }
  }, [jobsQuery.data, selectedJobId]);

  const createJobMutation = trpc.productImageStudio.create.useMutation({
    onSuccess: async (result) => {
      setSelectedJobId(result.jobId);
      await Promise.all([
        overviewQuery.refetch(),
        jobsQuery.refetch(),
        selectedJobQuery.refetch(),
      ]);
      toast({
        variant: result.deduplicated ? "info" : "success",
        description: result.deduplicated ? t("jobReused") : t("jobQueuedSuccess"),
      });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const retryJobMutation = trpc.productImageStudio.retry.useMutation({
    onSuccess: async (result) => {
      setSelectedJobId(result.jobId);
      await Promise.all([
        overviewQuery.refetch(),
        jobsQuery.refetch(),
        selectedJobQuery.refetch(),
      ]);
      toast({ variant: "success", description: t("jobRetrySuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const saveToProductMutation = trpc.productImageStudio.saveToProduct.useMutation({
    onSuccess: async () => {
      await Promise.all([
        overviewQuery.refetch(),
        jobsQuery.refetch(),
        selectedJobQuery.refetch(),
        trpcUtils.products.bootstrap.invalidate(),
        trpcUtils.products.list.invalidate(),
      ]);
      toast({ variant: "success", description: t("saveSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const handleSourceUpload = async (file: File | null) => {
    if (!file || !canEdit) {
      return;
    }

    setUploadingSource(true);
    try {
      const prepared = await prepareManagedProductImageForUpload({
        file,
        maxImageBytes: studioMaxImageBytes,
        maxInputImageBytes: studioMaxInputImageBytes,
      });
      if (!prepared.ok) {
        if (prepared.code === "imageTooLargeInput") {
          throw new Error(
            t("input.errors.imageTooLargeInput", {
              size: Math.round(studioMaxInputImageBytes / (1024 * 1024)),
            }),
          );
        }
        if (prepared.code === "imageTooLargeAfterCompression") {
          throw new Error(
            t("input.errors.imageTooLargeAfterCompression", {
              size: Math.round(studioMaxImageBytes / (1024 * 1024)),
            }),
          );
        }
        if (prepared.code === "imageInvalidType") {
          throw new Error(t("input.errors.unsupportedFileType"));
        }
        throw new Error(t("input.errors.imageCompressionFailed"));
      }

      const payload = new FormData();
      payload.set("file", prepared.file);

      const response = await fetch("/api/product-image-studio/upload", {
        method: "POST",
        body: payload,
      });
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        url?: string;
        fileName?: string;
        size?: number;
        mimeType?: string;
      };

      if (!response.ok || !body.url || !body.fileName || !body.mimeType) {
        if (body.message === "imageTooLarge") {
          throw new Error(
            t("input.errors.imageTooLarge", {
              size: Math.round(studioMaxImageBytes / (1024 * 1024)),
            }),
          );
        }
        if (body.message === "imageInvalidType" || body.message === "productImageStudioUnsupportedFileType") {
          throw new Error(t("input.errors.unsupportedFileType"));
        }
        throw new Error(
          body.message && tErrors.has?.(body.message)
            ? tErrors(body.message)
            : tErrors("genericMessage"),
        );
      }

      setSourceImage({
        url: body.url,
        fileName: body.fileName,
        size: body.size ?? prepared.file.size,
        mimeType: body.mimeType,
      });
      toast({ variant: "success", description: t("input.sourceUploadSuccess") });
    } catch (error) {
      toast({
        variant: "error",
        description: error instanceof Error ? error.message : tErrors("genericMessage"),
      });
    } finally {
      setUploadingSource(false);
    }
  };

  const handleGenerate = () => {
    if (!canEdit || providerMissing || !sourceImage?.url) {
      return;
    }

    createJobMutation.mutate({
      sourceImageUrl: sourceImage.url,
      productId: selectedProduct?.id,
      backgroundMode,
      outputFormat: ProductImageStudioOutputFormat.SQUARE,
      centered: true,
      improveVisibility: true,
      softShadow,
      tighterCrop,
      brighterPresentation,
    });
  };

  const selectedJob = selectedJobQuery.data;
  const overview = overviewQuery.data;
  const overviewLoading = overviewQuery.isLoading && !overview;
  const overviewStatus = overview?.status ?? "NOT_CONFIGURED";
  const providerMissing = overview?.configured === false;
  const generateDisabledReason = !canEdit
    ? t("actions.generateDisabledNoAccess")
    : !sourceImage?.url
      ? t("actions.generateDisabledNoSource")
      : providerMissing
        ? t("overview.providerMissing")
        : null;
  const generateDisabled =
    !canEdit || providerMissing || !sourceImage?.url || createJobMutation.isLoading;
  const targetProductId = selectedProduct?.id ?? selectedJob?.product?.id ?? null;
  const isBusy =
    createJobMutation.isLoading || retryJobMutation.isLoading || saveToProductMutation.isLoading;
  const sourcePreviewUrl = selectedJob?.sourcePreviewPath
    ? selectedJob.sourcePreviewPath
    : sourceImage?.url
      ? `/api/product-images/source?url=${encodeURIComponent(sourceImage.url)}`
      : null;

  const productSearchResults = useMemo(
    () => productSearchQuery.data ?? [],
    [productSearchQuery.data],
  );

  return (
    <div>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
      />

      <div className="space-y-6">
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="text-xl">{t("overview.title")}</CardTitle>
                <p className="text-sm text-muted-foreground">{t("overview.subtitle")}</p>
              </div>
              <Badge variant={overviewBadgeVariant(overviewStatus)}>
                {overviewLoading
                  ? tCommon("loading")
                  : overviewStatus === "READY"
                    ? t("overview.status.ready")
                    : overviewStatus === "ERROR"
                      ? t("overview.status.error")
                      : t("overview.status.notConfigured")}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-none border border-border p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t("overview.metrics.totalJobs")}
                </p>
                <p className="mt-2 text-2xl font-semibold">
                  {overview?.totalJobs ?? 0}
                </p>
              </div>
              <div className="rounded-none border border-border p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t("overview.metrics.succeeded")}
                </p>
                <p className="mt-2 text-2xl font-semibold">
                  {overview?.succeededJobs ?? 0}
                </p>
              </div>
              <div className="rounded-none border border-border p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t("overview.metrics.failed")}
                </p>
                <p className="mt-2 text-2xl font-semibold">
                  {overview?.failedJobs ?? 0}
                </p>
              </div>
              <div className="rounded-none border border-border p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t("overview.metrics.lastGenerated")}
                </p>
                <p className="mt-2 text-sm font-medium">
                  {overview?.lastGeneratedAt
                    ? formatDateTime(overview.lastGeneratedAt, locale)
                    : t("overview.never")}
                </p>
              </div>
            </div>
            {providerMissing ? (
              <p className="mt-4 rounded-none border border-dashed border-border bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">
                {t("overview.providerMissing")}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <Card>
            <CardHeader className="space-y-1">
              <CardTitle>{t("input.title")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("input.subtitle")}</p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label>{t("input.uploadLabel")}</Label>
                <button
                  type="button"
                  className="flex w-full flex-col items-center justify-center rounded-none border border-dashed border-border bg-secondary/20 px-6 py-10 text-center"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!canEdit || uploadingSource}
                >
                  {uploadingSource ? (
                    <Spinner className="h-5 w-5" />
                  ) : (
                    <>
                      <span className="text-sm font-medium">{t("input.uploadCta")}</span>
                      <span className="mt-1 text-xs text-muted-foreground">
                        {t("input.uploadHint")}
                      </span>
                    </>
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={studioAcceptedFileTypes}
                  className="hidden"
                  onChange={(event) => {
                    const nextFile = event.target.files?.[0] ?? null;
                    void handleSourceUpload(nextFile);
                    event.currentTarget.value = "";
                  }}
                />
                {sourceImage ? (
                  <div className="flex items-center justify-between gap-3 rounded-none border border-border px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium">{sourceImage.fileName}</p>
                      <p className="text-xs text-muted-foreground">
                        {sourceImage.mimeType} · {formatFileSize(sourceImage.size)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setSourceImage(null)}
                      disabled={isBusy}
                    >
                      {t("input.removeSource")}
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="space-y-3">
                <Label htmlFor="product-search">{t("input.productLabel")}</Label>
                <Input
                  id="product-search"
                  value={productSearch}
                  onChange={(event) => setProductSearch(event.target.value)}
                  placeholder={t("input.productPlaceholder")}
                />
                {selectedProduct ? (
                  <div className="flex items-center justify-between gap-3 rounded-none border border-border px-3 py-2">
                    <div className="flex items-center gap-3">
                      <ProductImageThumb imageUrl={selectedProduct.imageUrl} name={selectedProduct.name} />
                      <div>
                        <p className="text-sm font-medium">{selectedProduct.name}</p>
                        <p className="text-xs text-muted-foreground">{selectedProduct.sku}</p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setSelectedProduct(null)}
                      disabled={isBusy}
                    >
                      {t("input.clearProduct")}
                    </Button>
                  </div>
                ) : null}
                {!selectedProduct && productSearch.trim().length >= 2 ? (
                  <div className="rounded-none border border-border">
                    {productSearchQuery.isLoading ? (
                      <div className="px-3 py-3 text-sm text-muted-foreground">
                        {tCommon("loading")}
                      </div>
                    ) : productSearchResults.length ? (
                      productSearchResults.map((product) => (
                        <ProductSearchResultItem
                          key={product.id}
                          product={product}
                          className="border-b border-border last:border-b-0"
                          onClick={() => {
                            setSelectedProduct({
                              id: product.id,
                              sku: product.sku,
                              name: product.name,
                              imageUrl: product.primaryImage ?? null,
                            });
                            setProductSearch(product.name);
                          }}
                        />
                      ))
                    ) : (
                      <div className="px-3 py-3 text-sm text-muted-foreground">
                        {tCommon("nothingFound")}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              <p className="rounded-none border border-dashed border-border bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
                {t("input.reviewNote")}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-1">
              <CardTitle>{t("presets.title")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("presets.subtitle")}</p>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormGrid>
                <div className="space-y-2">
                  <Label>{t("presets.backgroundLabel")}</Label>
                  <Select
                    value={backgroundMode}
                    onValueChange={(value) =>
                      setBackgroundMode(value as ProductImageStudioBackground)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ProductImageStudioBackground.WHITE}>
                        {t("presets.background.white")}
                      </SelectItem>
                      <SelectItem value={ProductImageStudioBackground.LIGHT_GRAY}>
                        {t("presets.background.lightGray")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("presets.outputLabel")}</Label>
                  <Select value={ProductImageStudioOutputFormat.SQUARE} disabled>
                    <SelectTrigger>
                      <SelectValue placeholder={t("presets.output.square")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ProductImageStudioOutputFormat.SQUARE}>
                        {t("presets.output.square")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </FormGrid>

              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">{t("presets.always.centeredTitle")}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("presets.always.centeredDescription")}
                    </p>
                  </div>
                  <Badge variant="muted">{t("presets.always.on")}</Badge>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">
                      {t("presets.always.improveVisibilityTitle")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("presets.always.improveVisibilityDescription")}
                    </p>
                  </div>
                  <Badge variant="muted">{t("presets.always.on")}</Badge>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">{t("presets.optional.softShadowTitle")}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("presets.optional.softShadowDescription")}
                    </p>
                  </div>
                  <Switch checked={softShadow} onCheckedChange={setSoftShadow} disabled={!canEdit} />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">{t("presets.optional.tighterCropTitle")}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("presets.optional.tighterCropDescription")}
                    </p>
                  </div>
                  <Switch checked={tighterCrop} onCheckedChange={setTighterCrop} disabled={!canEdit} />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">
                      {t("presets.optional.brighterTitle")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("presets.optional.brighterDescription")}
                    </p>
                  </div>
                  <Switch
                    checked={brighterPresentation}
                    onCheckedChange={setBrighterPresentation}
                    disabled={!canEdit}
                  />
                </div>
              </div>

              <FormActions>
                <Button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generateDisabled}
                >
                  {createJobMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                  {t("actions.generate")}
                </Button>
                {generateDisabledReason ? (
                  <p className="text-xs text-muted-foreground">{generateDisabledReason}</p>
                ) : null}
              </FormActions>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle>{t("preview.title")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("preview.subtitle")}</p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <Label>{t("preview.original")}</Label>
                  {sourceImage ? (
                    <span className="text-xs text-muted-foreground">
                      {formatFileSize(sourceImage.size)}
                    </span>
                  ) : null}
                </div>
                <div className="overflow-hidden rounded-none border border-border bg-secondary/20">
                  {sourcePreviewUrl ? (
                    <img
                      src={sourcePreviewUrl}
                      alt={t("preview.originalAlt")}
                      className="h-[320px] w-full object-contain"
                    />
                  ) : (
                    <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
                      {t("preview.emptyOriginal")}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <Label>{t("preview.generated")}</Label>
                  {selectedJob ? (
                    <Badge variant={jobBadgeVariant(selectedJob.status)}>{selectedJob.status}</Badge>
                  ) : null}
                </div>
                <div className="overflow-hidden rounded-none border border-border bg-secondary/20">
                  {selectedJob?.outputPreviewPath ? (
                    <img
                      src={selectedJob.outputPreviewPath}
                      alt={t("preview.generatedAlt")}
                      className="h-[320px] w-full object-contain"
                    />
                  ) : selectedJob?.status === ProductImageStudioJobStatus.PROCESSING ||
                    selectedJob?.status === ProductImageStudioJobStatus.QUEUED ? (
                    <div className="flex h-[320px] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                      <Spinner className="h-5 w-5" />
                      {t("preview.processing")}
                    </div>
                  ) : (
                    <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
                      {t("preview.emptyGenerated")}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {selectedJob?.errorMessage ? (
              <div className="rounded-none border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
                {formatJobErrorMessage(selectedJob.errorMessage, tErrors)}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-3">
                <Switch checked={saveAsPrimary} onCheckedChange={setSaveAsPrimary} disabled={!canEdit} />
                <span className="text-sm text-muted-foreground">{t("preview.setAsPrimary")}</span>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => selectedJob && retryJobMutation.mutate({ jobId: selectedJob.id })}
                disabled={!canEdit || !selectedJob?.canRetry || retryJobMutation.isLoading}
              >
                {retryJobMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                {t("actions.regenerate")}
              </Button>
              <Button
                type="button"
                onClick={() =>
                  selectedJob &&
                  saveToProductMutation.mutate({
                    jobId: selectedJob.id,
                    productId: targetProductId,
                    setAsPrimary: saveAsPrimary,
                  })
                }
                disabled={
                  !canEdit ||
                  !selectedJob?.canSaveToProduct ||
                  !targetProductId ||
                  saveToProductMutation.isLoading
                }
              >
                {saveToProductMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                {t("actions.saveToProduct")}
              </Button>
              {!targetProductId && selectedJob?.canSaveToProduct ? (
                <span className="text-xs text-muted-foreground">{t("preview.productRequired")}</span>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle>{t("history.title")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("history.subtitle")}</p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("history.columns.status")}</TableHead>
                  <TableHead>{t("history.columns.product")}</TableHead>
                  <TableHead>{t("history.columns.createdBy")}</TableHead>
                  <TableHead>{t("history.columns.createdAt")}</TableHead>
                  <TableHead>{t("history.columns.completedAt")}</TableHead>
                  <TableHead>{t("history.columns.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(jobsQuery.data ?? []).map((job) => (
                  <TableRow key={job.id} className={selectedJobId === job.id ? "bg-secondary/30" : undefined}>
                    <TableCell>
                      <Badge variant={jobBadgeVariant(job.status)}>{job.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {job.product ? (
                        <div className="flex items-center gap-3">
                          <ProductImageThumb
                            imageUrl={job.productImageUrl}
                            name={job.product.name}
                          />
                          <div>
                            <p className="text-sm font-medium">{job.product.name}</p>
                            <p className="text-xs text-muted-foreground">{job.product.sku}</p>
                          </div>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">{t("history.unlinkedProduct")}</span>
                      )}
                    </TableCell>
                    <TableCell>{job.createdBy.name}</TableCell>
                    <TableCell>{formatDateTime(job.createdAt, locale)}</TableCell>
                    <TableCell>
                      {job.completedAt ? formatDateTime(job.completedAt, locale) : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setSelectedJobId(job.id)}
                        >
                          {t("actions.preview")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => retryJobMutation.mutate({ jobId: job.id })}
                          disabled={!canEdit || !job.canRetry}
                        >
                          {t("actions.regenerate")}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!jobsQuery.data?.length ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                      {t("history.empty")}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ProductImageStudioPage;

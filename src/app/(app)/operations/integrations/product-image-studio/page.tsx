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
import { QueryErrorState } from "@/components/query-error-state";
import { ProductSearchResultItem } from "@/components/product-search-result-item";
import { StudioCreateProductDialog } from "@/components/products/studio-create-product-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AddIcon, CloseIcon, RestoreIcon, ViewIcon } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
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
  TableContainer,
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
import {
  ProductImageUploadTimeoutError,
  fetchProductImageDirectUploadTarget,
  fetchProductImageUpload,
  putProductImageDirectUpload,
  resolveProductImageProxyUploadMaxBytes,
  type ProductImageDirectUploadTarget,
  productPhotoAccept,
  supportedProductImageUploadMimeTypes,
} from "@/lib/productImageUpload";
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
const studioMaxProxyImageBytes = Math.min(
  studioMaxImageBytes,
  resolveProductImageProxyUploadMaxBytes(process.env.NEXT_PUBLIC_PRODUCT_IMAGE_PROXY_MAX_BYTES),
);
const studioAcceptedFileTypes = productPhotoAccept;
const STUDIO_PHOTO_LIMIT = 10;

const isWorkingStudioJobStatus = (status?: ProductImageStudioJobStatus | null) =>
  status === ProductImageStudioJobStatus.QUEUED ||
  status === ProductImageStudioJobStatus.PROCESSING;

const appendImageCacheBuster = (url: string, value: string) =>
  `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(value)}`;

const ProductImageThumb = ({ imageUrl, name }: { imageUrl?: string | null; name: string }) => {
  const fallbackLabel = name.trim().charAt(0).toUpperCase() || "#";

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        loading="lazy"
        className="h-10 w-10 shrink-0 rounded-md border border-border object-cover"
      />
    );
  }

  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-secondary/60 text-xs font-medium text-muted-foreground">
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
  // Historical jobs may contain raw provider errors, including retired model
  // names. Keep diagnostics out of the operator's workflow as well as new jobs.
  return tErrors.has?.(value) ? tErrors(value) : tErrors("productImageStudioProviderFailed");
};

type UploadedSource = {
  url: string;
  fileName: string;
  size: number;
  mimeType: string;
};

type StudioProductTarget = {
  id: string;
  sku: string;
  name: string;
  imageUrl?: string | null;
};

type StudioPhoto = {
  id: string;
  name: string;
  file: File | null;
  uploadStage: "waiting" | "preparing" | "uploading" | "ready" | "failed";
  source?: UploadedSource;
  error?: string;
  product?: StudioProductTarget | null;
  jobId?: string;
  starting?: boolean;
};

type StudioProductCreation = {
  photoId: string | null;
  historyJobId: string | null;
  attachJobId: string | null;
  setAsPrimary: boolean;
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
  const canView = canEdit;

  const [photos, setPhotos] = useState<StudioPhoto[]>([]);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [historyJobId, setHistoryJobId] = useState<string | null>(null);
  const [historyTargets, setHistoryTargets] = useState<Record<string, StudioProductTarget | null>>({});
  const [draftTarget, setDraftTarget] = useState<StudioProductTarget | null>(null);
  const [productCreation, setProductCreation] = useState<StudioProductCreation | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [startingBatch, setStartingBatch] = useState(false);
  const nextPhotoId = useRef(0);
  const uploading = useRef(false);
  const pendingUploads = useRef<Array<{ id: string; file: File; actor: string }>>([]);
  const studioActor = session?.user ? `${session.user.organizationId}:${session.user.id}` : "";
  const actorRef = useRef(studioActor);

  useEffect(() => {
    if (actorRef.current === studioActor) return;
    actorRef.current = studioActor;
    pendingUploads.current = [];
    setPhotos([]);
    setActivePhotoId(null);
    setHistoryJobId(null);
    setHistoryTargets({});
    setDraftTarget(null);
    setProductCreation(null);
    setProductSearch("");
  }, [studioActor]);

  const activePhoto = photos.find((photo) => photo.id === activePhotoId) ?? null;
  const sourceImage = activePhoto?.source ?? null;
  const selectedJobId = activePhoto ? activePhoto.jobId ?? null : historyJobId;

  const [backgroundMode, setBackgroundMode] = useState<ProductImageStudioBackground>(
    ProductImageStudioBackground.WHITE,
  );
  const [softShadow, setSoftShadow] = useState(false);
  const [tighterCrop, setTighterCrop] = useState(false);
  const [brighterPresentation, setBrighterPresentation] = useState(false);
  const [highQuality, setHighQuality] = useState(false);
  const [clockNow, setClockNow] = useState(Date.now());
  const [saveAsPrimary, setSaveAsPrimary] = useState(false);


  const jobsQuery = trpc.productImageStudio.jobs.useQuery(
    { limit: 50 },
    {
      enabled: canView,
      refetchInterval: (jobs) =>
        jobs?.some((job) => isWorkingStudioJobStatus(job.status)) ||
        photos.some((photo) => photo.jobId && !jobs?.some((job) => job.id === photo.jobId))
          ? 2_000
          : false,
    },
  );
  const activeJobFromList = useMemo(
    () => (jobsQuery.data ?? []).find((job) => isWorkingStudioJobStatus(job.status)) ?? null,
    [jobsQuery.data],
  );
  const selectedJobFromList = useMemo(
    () => (jobsQuery.data ?? []).find((job) => job.id === selectedJobId) ?? null,
    [jobsQuery.data, selectedJobId],
  );
  const overviewQuery = trpc.productImageStudio.overview.useQuery(undefined, {
    enabled: canView,
    refetchInterval: activeJobFromList ? 5_000 : false,
  });
  const selectedJobQuery = trpc.productImageStudio.job.useQuery(
    { jobId: selectedJobId ?? "" },
    {
      enabled: canView && Boolean(selectedJobId),
      // The list can observe completion before this query does. Only this
      // query's own terminal response may stop its polling.
      refetchInterval: (job) => (!job || isWorkingStudioJobStatus(job.status) ? 1_500 : false),
    },
  );
  const productSearchQuery = trpc.products.searchQuick.useQuery(
    { q: productSearch },
    { enabled: canView && productSearch.trim().length >= 2 },
  );

  useEffect(() => {
    if (!activePhoto && !historyJobId && jobsQuery.data?.length) {
      setHistoryJobId(jobsQuery.data[0]?.id ?? null);
    }
  }, [activePhoto, historyJobId, jobsQuery.data]);

  const createJobMutation = trpc.productImageStudio.create.useMutation();
  const retryJobMutation = trpc.productImageStudio.retry.useMutation();

  const saveToProductMutation = trpc.productImageStudio.saveToProduct.useMutation({
    onSuccess: async (_result, variables) => {
      await Promise.all([
        overviewQuery.refetch(),
        jobsQuery.refetch(),
        trpcUtils.productImageStudio.job.invalidate({ jobId: variables.jobId }),
        trpcUtils.products.bootstrap.invalidate(),
        trpcUtils.products.list.invalidate(),
      ]);
      toast({ variant: "success", description: t("saveSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const resolveSourceUploadErrorMessage = (
    code?: string | null,
    sizeBytes = studioMaxImageBytes,
  ) => {
    if (code === "imageTooLargeInput") {
      return t("input.errors.imageTooLargeInput", {
        size: Math.round(studioMaxInputImageBytes / (1024 * 1024)),
      });
    }
    if (code === "imageTooLarge" || code === "imageTooLargeAfterCompression") {
      return t("input.errors.imageTooLargeAfterCompression", {
        size: Math.round(sizeBytes / (1024 * 1024)),
      });
    }
    if (
      code === "imageInvalidType" ||
      code === "productImageStudioUnsupportedFileType" ||
      code === "unsupportedFileType"
    ) {
      return t("input.errors.unsupportedFileType");
    }
    if (code === "imageUploadTimedOut") {
      return tErrors.has?.("imageUploadTimedOut")
        ? tErrors("imageUploadTimedOut")
        : t("input.errors.imageCompressionFailed");
    }
    if (code && tErrors.has?.(code)) {
      return tErrors(code);
    }
    return t("input.errors.imageCompressionFailed");
  };

  const prepareSourceForProxyUpload = async (file: File) => {
    if (file.size <= studioMaxProxyImageBytes) {
      return file;
    }

    const prepared = await prepareManagedProductImageForUpload({
      file,
      maxImageBytes: studioMaxProxyImageBytes,
      maxInputImageBytes: Math.max(studioMaxInputImageBytes, file.size),
    });
    if (!prepared.ok) {
      throw new Error(resolveSourceUploadErrorMessage(prepared.code, studioMaxProxyImageBytes));
    }
    return prepared.file;
  };

  const uploadSourceImageDirectly = async (file: File) => {
    let targetResponse: Response;
    try {
      targetResponse = await fetchProductImageDirectUploadTarget({ file });
    } catch (error) {
      if (error instanceof ProductImageUploadTimeoutError) {
        throw new Error(resolveSourceUploadErrorMessage("imageUploadTimedOut"));
      }
      return { attempted: false, source: null };
    }

    const targetBody = (await targetResponse.json().catch(() => null)) as
      | (Partial<ProductImageDirectUploadTarget> & { message?: string })
      | null;

    if (!targetResponse.ok) {
      const code = targetBody?.message ?? (targetResponse.status === 413 ? "imageTooLarge" : null);
      if (
        code === "directUploadUnavailable" ||
        targetResponse.status === 404 ||
        targetResponse.status >= 500
      ) {
        return { attempted: false, source: null };
      }
      throw new Error(resolveSourceUploadErrorMessage(code));
    }

    if (targetBody?.message === "directUploadUnavailable") {
      return { attempted: false, source: null };
    }
    if (
      targetBody?.method !== "PUT" ||
      typeof targetBody.uploadUrl !== "string" ||
      typeof targetBody.url !== "string"
    ) {
      return { attempted: false, source: null };
    }

    const target: ProductImageDirectUploadTarget = {
      method: "PUT",
      uploadUrl: targetBody.uploadUrl,
      url: targetBody.url,
      headers: targetBody.headers,
      expiresIn: targetBody.expiresIn,
    };

    let uploadResponse: Response;
    try {
      uploadResponse = await putProductImageDirectUpload({ target, file });
    } catch (error) {
      if (error instanceof ProductImageUploadTimeoutError) {
        throw new Error(resolveSourceUploadErrorMessage("imageUploadTimedOut"));
      }
      return { attempted: false, source: null };
    }

    if (!uploadResponse.ok) {
      if (
        uploadResponse.status === 408 ||
        uploadResponse.status === 429 ||
        uploadResponse.status >= 500
      ) {
        return { attempted: false, source: null };
      }
      throw new Error(resolveSourceUploadErrorMessage(null));
    }

    const uploadedUrl = target.url.trim();
    if (!uploadedUrl) {
      return { attempted: false, source: null };
    }

    return {
      attempted: true,
      source: {
        url: uploadedUrl,
        fileName: file.name,
        size: file.size,
        mimeType: file.type,
      } satisfies UploadedSource,
    };
  };

  const uploadSourceImageViaProxy = async (file: File) => {
    const uploadFile = await prepareSourceForProxyUpload(file);
    const payload = new FormData();
    payload.set("file", uploadFile);

    let response: Response;
    try {
      response = await fetchProductImageUpload({
        url: "/api/product-image-studio/upload",
        formData: payload,
      });
    } catch (error) {
      if (error instanceof ProductImageUploadTimeoutError) {
        throw new Error(resolveSourceUploadErrorMessage("imageUploadTimedOut"));
      }
      throw new Error(tErrors("genericMessage"));
    }

    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
      url?: string;
      fileName?: string;
      size?: number;
      mimeType?: string;
    };

    if (!response.ok || !body.url || !body.fileName || !body.mimeType) {
      const code = body.message ?? (response.status === 413 ? "imageTooLarge" : null);
      throw new Error(resolveSourceUploadErrorMessage(code, studioMaxProxyImageBytes));
    }

    return {
      url: body.url,
      fileName: body.fileName,
      size: body.size ?? uploadFile.size,
      mimeType: body.mimeType,
    } satisfies UploadedSource;
  };

  const updatePhoto = (id: string, change: Partial<StudioPhoto>) => {
    setPhotos((current) => current.map((photo) => photo.id === id ? { ...photo, ...change } : photo));
  };

  const uploadNextPhotos = async () => {
    if (uploading.current) return;
    uploading.current = true;
    try {
      let pending = pendingUploads.current.shift();
      while (pending) {
        const { id, file, actor } = pending;
        if (actor === actorRef.current) {
          updatePhoto(id, { uploadStage: "preparing", error: undefined });
          try {
            const prepared = await prepareManagedProductImageForUpload({
              file,
              maxImageBytes: studioMaxImageBytes,
              maxInputImageBytes: studioMaxInputImageBytes,
              serverConversionMaxBytes: studioMaxProxyImageBytes,
            });
            if (!prepared.ok) throw new Error(resolveSourceUploadErrorMessage(prepared.code));
            if (actor === actorRef.current) {
              updatePhoto(id, { uploadStage: "uploading" });
              const direct = supportedProductImageUploadMimeTypes.has(prepared.file.type)
                ? await uploadSourceImageDirectly(prepared.file)
                : { source: null };
              if (actor === actorRef.current) {
                const source = direct.source ?? await uploadSourceImageViaProxy(prepared.file);
                if (actor === actorRef.current) {
                  updatePhoto(id, { source, uploadStage: "ready", file: null });
                }
              }
            }
          } catch (error) {
            if (actor === actorRef.current) {
              updatePhoto(id, {
                uploadStage: "failed",
                error: error instanceof Error ? error.message : tErrors("genericMessage"),
              });
            }
          }
        }
        pending = pendingUploads.current.shift();
      }
    } finally {
      uploading.current = false;
    }
  };

  const addPhotos = (files: File[]) => {
    if (!canEdit || !files.length) return;
    const available = STUDIO_PHOTO_LIMIT - photos.length;
    if (files.length > available) {
      toast({ variant: "info", description: t("input.photoLimit", { count: STUDIO_PHOTO_LIMIT }) });
    }
    const next: StudioPhoto[] = files.slice(0, Math.max(0, available)).map((file, index) => ({
      id: String(++nextPhotoId.current),
      name: file.name,
      file,
      uploadStage: "waiting",
      product: index === 0 && !activePhoto && !historyJobId ? draftTarget : undefined,
    }));
    if (!next.length) return;
    setPhotos((current) => [...current, ...next]);
    if (!activePhoto) setActivePhotoId(next[0]!.id);
    for (const photo of next) {
      if (photo.file) pendingUploads.current.push({ id: photo.id, file: photo.file, actor: studioActor });
    }
    setProductSearch("");
    void uploadNextPhotos();
  };

  const retryUpload = (photo: StudioPhoto) => {
    if (!photo.file || photo.uploadStage !== "failed") return;
    updatePhoto(photo.id, { uploadStage: "waiting", error: undefined });
    pendingUploads.current.push({ id: photo.id, file: photo.file, actor: studioActor });
    void uploadNextPhotos();
  };

  const removePhoto = (photoId: string) => {
    pendingUploads.current = pendingUploads.current.filter(({ id }) => id !== photoId);
    setPhotos((current) => current.filter((photo) => photo.id !== photoId));
    if (activePhotoId === photoId) {
      setActivePhotoId(photos.find((photo) => photo.id !== photoId)?.id ?? null);
      setProductSearch("");
    }
  };

  const refetchStudioJobs = async () => {
    await Promise.all([overviewQuery.refetch(), jobsQuery.refetch()]);
  };

  const generatePhoto = async (photo: StudioPhoto) => {
    if (!photo.source || actorRef.current !== studioActor) return;
    updatePhoto(photo.id, { starting: true, error: undefined });
    try {
      const result = await createJobMutation.mutateAsync({
        sourceImageUrl: photo.source.url,
        productId: photo.product?.id,
        backgroundMode,
        outputFormat: ProductImageStudioOutputFormat.SQUARE,
        centered: true,
        improveVisibility: true,
        softShadow,
        tighterCrop,
        brighterPresentation,
        highQuality,
      });
      updatePhoto(photo.id, { jobId: result.jobId });
    } catch (error) {
      updatePhoto(photo.id, { error: translateError(tErrors, error as Parameters<typeof translateError>[1]) });
    } finally {
      updatePhoto(photo.id, { starting: false });
    }
  };

  const generateSelected = async () => {
    if (!activePhoto || generateDisabled) return;
    await generatePhoto(activePhoto);
    await refetchStudioJobs();
  };

  const generateReady = async () => {
    if (!canEdit || !overview || overviewQuery.error || providerMissing || startingBatch || createJobMutation.isLoading) return;
    setStartingBatch(true);
    try {
      for (const photo of readyPhotos) await generatePhoto(photo);
      await refetchStudioJobs();
    } finally {
      setStartingBatch(false);
    }
  };

  const selectHistoryJob = (jobId: string) => {
    setActivePhotoId(null);
    setHistoryJobId(jobId);
    setProductSearch("");
  };

  const retryStudioJob = async (jobId: string) => {
    if (retryJobMutation.isLoading) return;
    const photo = photos.find((entry) => entry.jobId === jobId);
    if (photo) updatePhoto(photo.id, { starting: true, error: undefined });
    try {
      const result = await retryJobMutation.mutateAsync({ jobId });
      if (photo) updatePhoto(photo.id, { jobId: result.jobId });
      else {
        setHistoryTargets((current) => Object.hasOwn(current, jobId)
          ? { ...current, [result.jobId]: current[jobId]! }
          : current);
        selectHistoryJob(result.jobId);
      }
      await refetchStudioJobs();
    } catch (error) {
      const description = translateError(tErrors, error as Parameters<typeof translateError>[1]);
      if (photo) updatePhoto(photo.id, { error: description });
      else toast({ variant: "error", description });
    } finally {
      if (photo) updatePhoto(photo.id, { starting: false });
    }
  };

  const selectedJob = selectedJobId ? (selectedJobQuery.data ?? selectedJobFromList) : null;
  const overview = overviewQuery.data;
  const overviewLoading = overviewQuery.isLoading && !overview;
  const overviewStatus = overview?.status ?? "NOT_CONFIGURED";
  const providerMissing = overview?.configured === false;
  const generateDisabledReason = !canEdit
    ? t("actions.generateDisabledNoAccess")
    : overviewQuery.error
      ? tCommon("notAvailable")
      : !overview
        ? tCommon("loading")
        : !sourceImage?.url
          ? t("actions.generateDisabledNoSource")
          : providerMissing
            ? t("overview.providerMissing")
            : null;
  const generateDisabled =
    !canEdit ||
    !overview ||
    Boolean(overviewQuery.error) ||
    providerMissing ||
    !sourceImage?.url ||
    createJobMutation.isLoading ||
    startingBatch ||
    Boolean(activePhoto?.starting || (activePhoto?.jobId && !selectedJob)) ||
    isWorkingStudioJobStatus(selectedJob?.status);
  const savedProduct = selectedJob?.product
    ? { ...selectedJob.product, imageUrl: selectedJob.productImageUrl }
    : null;
  const productOverride = activePhoto
    ? activePhoto.product
    : historyJobId
      ? historyTargets[historyJobId]
      : draftTarget;
  const selectedProduct = productOverride === undefined ? savedProduct : productOverride;
  const targetProductId = selectedProduct?.id ?? null;
  const readyPhotos = photos.filter((photo) => photo.uploadStage === "ready" && !photo.starting && !photo.jobId);
  const showBatchAction = startingBatch ||
    readyPhotos.length > 1 ||
    (readyPhotos.length === 1 && readyPhotos[0]?.id !== activePhotoId);
  const setSelectedProduct = (product: StudioProductTarget | null) => {
    if (activePhoto) updatePhoto(activePhoto.id, { product });
    else if (historyJobId) setHistoryTargets((current) => ({ ...current, [historyJobId]: product }));
    else setDraftTarget(product);
  };

  const openProductCreation = () => {
    setProductCreation({
      photoId: activePhoto?.id ?? null,
      historyJobId,
      attachJobId: selectedJob?.canSaveToProduct ? selectedJob.id : null,
      setAsPrimary: saveAsPrimary,
    });
  };
  const handleProductCreated = async (product: StudioProductTarget) => {
    const origin = productCreation;
    if (!origin) return;
    setProductSearch("");
    if (origin.photoId) updatePhoto(origin.photoId, { product });
    else if (origin.historyJobId) setHistoryTargets((current) => ({ ...current, [origin.historyJobId!]: product }));
    else setDraftTarget(product);
    if (origin.attachJobId) {
      await saveToProductMutation.mutateAsync({
        jobId: origin.attachJobId,
        productId: product.id,
        setAsPrimary: origin.setAsPrimary,
      });
    }
    setProductCreation(null);
  };

  const isBusy = saveToProductMutation.isLoading;
  const previewIsWorking = Boolean(activePhoto?.starting || (selectedJobId && !selectedJob && !selectedJobQuery.error))
    || isWorkingStudioJobStatus(selectedJob?.status);
  useEffect(() => {
    if (!previewIsWorking) return;
    setClockNow(Date.now());
    const interval = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [previewIsWorking, selectedJob?.id]);
  const elapsedSeconds = Math.max(
    0,
    Math.floor(
      (clockNow -
        new Date(
          isWorkingStudioJobStatus(selectedJob?.status)
            ? (selectedJob?.createdAt ?? clockNow)
            : clockNow,
        ).getTime()) /
        1000,
    ),
  );
  const sourcePreviewUrl = selectedJob?.sourceImageUrl ?? sourceImage?.url ?? null;
  const generatedPreviewUrl = selectedJob?.outputImageUrl
    ? appendImageCacheBuster(
        selectedJob.outputImageUrl,
        String(selectedJob.completedAt ?? selectedJob.updatedAt ?? selectedJob.id),
      )
    : null;

  const productSearchResults = useMemo(
    () => productSearchQuery.data ?? [],
    [productSearchQuery.data],
  );

  if (!canView) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <p role={session?.user ? "alert" : "status"}>
          {session?.user ? tErrors("forbidden") : tCommon("loading")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <Card className="bazaar-admin-surface">
            <CardHeader className="bazaar-admin-section-header space-y-1">
              <CardTitle>{t("input.title")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("input.subtitle")}</p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <button
                  type="button"
                  className="flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-muted/25 px-4 py-6 text-center transition hover:border-primary/40 hover:bg-primary/[0.035] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!canEdit || photos.length >= STUDIO_PHOTO_LIMIT}
                >
                  <AddIcon className="mb-1 size-5 text-primary" aria-hidden />
                  <span className="text-sm font-semibold">{t("input.addPhotos")}</span>
                  <span className="text-xs text-muted-foreground">
                    {t("input.photoCount", { count: photos.length, limit: STUDIO_PHOTO_LIMIT })}
                  </span>
                </button>
                <p className="text-xs text-muted-foreground">{t("input.uploadHint")}</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  aria-label={t("input.addPhotos")}
                  accept={studioAcceptedFileTypes}
                  className="hidden"
                  onChange={(event) => {
                    addPhotos(Array.from(event.target.files ?? []));
                    event.currentTarget.value = "";
                  }}
                />
                {sourceImage || showBatchAction ? (
                  <FormActions className="border-0 pt-0 sm:justify-start">
                    <Button
                      type="button"
                      variant={showBatchAction ? "outline" : "default"}
                      onClick={() => void generateSelected()}
                      disabled={generateDisabled}
                    >
                      {activePhoto?.starting ? <Spinner className="h-4 w-4" /> : null}
                      {t("actions.generate")}
                    </Button>
                    {showBatchAction ? (
                      <Button
                        type="button"
                        onClick={() => void generateReady()}
                        disabled={!canEdit || Boolean(overviewQuery.error) || !overview || providerMissing || startingBatch || createJobMutation.isLoading}
                      >
                        {startingBatch ? <Spinner className="h-4 w-4" /> : null}
                        {t("actions.generateReady", { count: readyPhotos.length })}
                      </Button>
                    ) : null}
                  </FormActions>
                ) : null}
                {generateDisabledReason && (sourceImage || providerMissing) ? (
                  <p className="text-xs text-muted-foreground">{generateDisabledReason}</p>
                ) : null}
                {photos.length ? (
                  <ul className="max-h-96 space-y-2 overflow-y-auto pr-1" aria-label={t("input.photoQueue")}>
                    {photos.map((photo) => {
                      const job = jobsQuery.data?.find((row) => row.id === photo.jobId);
                      const selected = photo.id === activePhotoId;
                      const working = Boolean(photo.starting || (photo.jobId && !job)) || isWorkingStudioJobStatus(job?.status);
                      const assigned = photo.product === undefined ? job?.product : photo.product;
                      const status = photo.uploadStage !== "ready"
                        ? t(`input.photoStage.${photo.uploadStage}`)
                        : working && !job
                          ? t("status.QUEUED")
                          : job?.processingStage
                            ? t(`preview.${job.processingStage}`)
                            : job?.savedAt && job.productId === assigned?.id
                              ? t("input.photoStage.saved")
                              : job
                                ? t(`status.${job.status}`)
                                : t("input.photoStage.ready");
                      return (
                        <li key={photo.id} className={`min-w-0 rounded-md border bg-card ${selected ? "border-primary/60" : "border-border"}`}>
                          <div className="flex min-w-0 items-center gap-1 p-1">
                            <button
                              type="button"
                              aria-pressed={selected}
                              onClick={() => {
                                setActivePhotoId(photo.id);
                                setProductSearch("");
                              }}
                              className="flex min-w-0 flex-1 items-center gap-2 rounded p-1.5 text-left hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                            >
                              <ProductImageThumb name={photo.name} imageUrl={job?.outputImageUrl ?? photo.source?.url} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-medium" title={photo.name}>{photo.name}</span>
                                <span className="block break-words text-xs text-muted-foreground">
                                  {assigned?.name ?? t("history.unlinkedProduct")}
                                </span>
                                <span className={`block break-words text-xs ${photo.error || job?.status === "FAILED" ? "text-danger" : "text-muted-foreground"}`}>
                                  {photo.error ?? status}
                                </span>
                              </span>
                            </button>
                            {photo.uploadStage === "failed" ? (
                              <IconButton
                                type="button"
                                variant="outline"
                                icon={RestoreIcon}
                                label={t("input.retryUpload", { name: photo.name })}
                                onClick={() => retryUpload(photo)}
                              />
                            ) : job?.status === "FAILED" ? (
                              <IconButton
                                type="button"
                                variant="outline"
                                icon={RestoreIcon}
                                label={t("actions.regenerate")}
                                disabled={retryJobMutation.isLoading}
                                onClick={() => void retryStudioJob(job.id)}
                              />
                            ) : null}
                            <IconButton
                              type="button"
                              variant="outline"
                              icon={CloseIcon}
                              label={t("input.removePhoto", { name: photo.name })}
                              disabled={working || photo.uploadStage === "preparing" || photo.uploadStage === "uploading"}
                              onClick={() => removePhoto(photo.id)}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="product-search">{t("input.productLabel")}</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canEdit || isBusy}
                    onClick={openProductCreation}
                  >
                    <AddIcon className="h-4 w-4" aria-hidden />
                    {selectedJob?.canSaveToProduct ? t("actions.createAndSave") : t("actions.createProduct")}
                  </Button>
                </div>
                <Input
                  id="product-search"
                  value={productSearch}
                  onChange={(event) => {
                    setProductSearch(event.target.value);
                    if (selectedProduct) setSelectedProduct(null);
                  }}
                  placeholder={t("input.productPlaceholder")}
                />
                {selectedProduct ? (
                  <div className="bazaar-admin-info-tile flex items-center justify-between gap-3 px-3 py-2">
                    <div className="flex items-center gap-3">
                      <ProductImageThumb
                        imageUrl={selectedProduct.imageUrl}
                        name={selectedProduct.name}
                      />
                      <div>
                        <p className="text-sm font-medium">{selectedProduct.name}</p>
                        <p className="text-xs text-muted-foreground">{selectedProduct.sku}</p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setSelectedProduct(null);
                        setProductSearch("");
                      }}
                      disabled={isBusy}
                    >
                      {t("input.clearProduct")}
                    </Button>
                  </div>
                ) : null}
                {!selectedProduct && productSearch.trim().length >= 2 ? (
                  <div className="overflow-hidden rounded-lg border border-border bg-card">
                    {productSearchQuery.error ? (
                      <QueryErrorState
                        error={productSearchQuery.error}
                        onRetry={() => void productSearchQuery.refetch()}
                      />
                    ) : productSearchQuery.isLoading ? (
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
                            setProductSearch("");
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

              <p className="bazaar-admin-notice text-sm">{t("input.reviewNote")}</p>
            </CardContent>
          </Card>

          <Card className="bazaar-admin-surface">
            <CardHeader className="bazaar-admin-section-header space-y-1">
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
                    <SelectTrigger aria-label={t("presets.backgroundLabel")}>
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
                    <SelectTrigger aria-label={t("presets.outputLabel")}>
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
                    <p className="text-sm font-medium">{t("presets.highQuality")}</p>
                    <p className="text-xs text-muted-foreground">{t("presets.highQualityHint")}</p>
                  </div>
                  <Switch
                    aria-label={t("presets.highQuality")}
                    checked={highQuality}
                    onCheckedChange={setHighQuality}
                    disabled={!canEdit || isBusy}
                  />
                </div>
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
                  <Switch
                    checked={softShadow}
                    aria-label={t("presets.optional.softShadowTitle")}
                    onCheckedChange={setSoftShadow}
                    disabled={!canEdit}
                  />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">{t("presets.optional.tighterCropTitle")}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("presets.optional.tighterCropDescription")}
                    </p>
                  </div>
                  <Switch
                    checked={tighterCrop}
                    aria-label={t("presets.optional.tighterCropTitle")}
                    onCheckedChange={setTighterCrop}
                    disabled={!canEdit}
                  />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">{t("presets.optional.brighterTitle")}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("presets.optional.brighterDescription")}
                    </p>
                  </div>
                  <Switch
                    checked={brighterPresentation}
                    aria-label={t("presets.optional.brighterTitle")}
                    onCheckedChange={setBrighterPresentation}
                    disabled={!canEdit}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="bazaar-admin-surface">
          <CardHeader className="bazaar-admin-section-header space-y-1">
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
                <div className="bazaar-admin-preview-frame overflow-hidden p-0">
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
                    <Badge variant={jobBadgeVariant(selectedJob.status)}>
                      {t(`status.${selectedJob.status}`)}
                    </Badge>
                  ) : null}
                </div>
                <div className="bazaar-admin-preview-frame overflow-hidden p-0">
                  {previewIsWorking ? (
                    <div className="flex h-[320px] flex-col items-center justify-center gap-4 px-6 text-center text-sm text-muted-foreground">
                      <Spinner className="h-5 w-5" />
                      <div className="w-full max-w-[240px] space-y-2">
                        <p role="status" className="font-medium text-foreground">
                          {selectedJob?.status === "QUEUED"
                            ? t("preview.queued")
                            : t(`preview.${selectedJob?.processingStage ?? "processing"}`)}
                        </p>
                        <p className="font-mono tabular-nums">
                          {t("preview.elapsed", { seconds: elapsedSeconds })}
                        </p>
                        {elapsedSeconds >= 45 ? (
                          <p className="text-xs">{t("preview.slow")}</p>
                        ) : null}
                      </div>
                    </div>
                  ) : generatedPreviewUrl ? (
                    <img
                      src={generatedPreviewUrl}
                      alt={t("preview.generatedAlt")}
                      className="h-[320px] w-full object-contain"
                    />
                  ) : (
                    <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
                      {t("preview.emptyGenerated")}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {selectedJobId && selectedJobQuery.error ? (
              <QueryErrorState error={selectedJobQuery.error} onRetry={() => void selectedJobQuery.refetch()} />
            ) : null}

            {selectedJob?.errorMessage ? (
              <div className="bazaar-admin-error">
                {formatJobErrorMessage(selectedJob.errorMessage, tErrors)}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-3">
                <Switch
                  checked={saveAsPrimary}
                  aria-label={t("preview.setAsPrimary")}
                  onCheckedChange={setSaveAsPrimary}
                  disabled={!canEdit}
                />
                <span className="text-sm text-muted-foreground">{t("preview.setAsPrimary")}</span>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => selectedJob && void retryStudioJob(selectedJob.id)}
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
                <span className="text-xs text-muted-foreground">
                  {t("preview.productRequired")}
                </span>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="bazaar-admin-surface">
          <CardHeader className="bazaar-admin-section-header space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="text-xl">{t("overview.title")}</CardTitle>
                <p className="text-sm text-muted-foreground">{t("overview.subtitle")}</p>
              </div>
              <Badge
                variant={overviewQuery.error ? "danger" : overviewBadgeVariant(overviewStatus)}
              >
                {overviewQuery.error
                  ? tCommon("notAvailable")
                  : overviewLoading
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
            {overviewQuery.error ? (
              <QueryErrorState
                error={overviewQuery.error}
                onRetry={() => void overviewQuery.refetch()}
              />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <div className="bazaar-admin-info-tile p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t("overview.metrics.totalJobs")}
                    </p>
                    <p className="mt-2 text-2xl font-semibold">{overview?.totalJobs ?? 0}</p>
                  </div>
                  <div className="bazaar-admin-info-tile p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t("overview.metrics.succeeded")}
                    </p>
                    <p className="mt-2 text-2xl font-semibold">{overview?.succeededJobs ?? 0}</p>
                  </div>
                  <div className="bazaar-admin-info-tile p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t("overview.metrics.failed")}
                    </p>
                    <p className="mt-2 text-2xl font-semibold">{overview?.failedJobs ?? 0}</p>
                  </div>
                  <div className="bazaar-admin-info-tile p-4">
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
                  <p className="bazaar-admin-notice mt-4 text-sm">
                    {t("overview.providerMissing")}
                  </p>
                ) : null}
                {!providerMissing && overview ? (
                  <details className="mt-4 text-sm text-muted-foreground">
                    <summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {t("overview.processingDetails")}
                    </summary>
                    <p className="mt-2 max-w-2xl leading-relaxed">
                      {overview.analysisProvider === "deepseek"
                        ? t("overview.deepseekAnalysis")
                        : t("overview.presetAnalysis")}{" "}
                      {t("overview.imageRetouching")}
                    </p>
                  </details>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bazaar-admin-surface">
          <CardHeader className="bazaar-admin-section-header space-y-1">
            <CardTitle>{t("history.title")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("history.subtitle")}</p>
          </CardHeader>
          <CardContent>
            {jobsQuery.error ? (
              <QueryErrorState error={jobsQuery.error} onRetry={() => void jobsQuery.refetch()} />
            ) : (
              <TableContainer className="bazaar-admin-table-shell">
                <Table className="min-w-[860px]">
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
                      <TableRow
                        key={job.id}
                        className={selectedJobId === job.id ? "bg-secondary/30" : undefined}
                      >
                        <TableCell>
                          <Badge variant={jobBadgeVariant(job.status)}>
                            {t(`status.${job.status}`)}
                          </Badge>
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
                            <span className="text-sm text-muted-foreground">
                              {t("history.unlinkedProduct")}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>{job.createdBy.name}</TableCell>
                        <TableCell>{formatDateTime(job.createdAt, locale)}</TableCell>
                        <TableCell>
                          {job.completedAt ? formatDateTime(job.completedAt, locale) : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <IconButton
                              type="button"
                              variant="outline"
                              onClick={() => selectHistoryJob(job.id)}
                              icon={ViewIcon}
                              label={t("actions.preview")}
                            />
                            <IconButton
                              type="button"
                              variant="outline"
                              onClick={() => void retryStudioJob(job.id)}
                              disabled={!canEdit || !job.canRetry || retryJobMutation.isLoading}
                              icon={RestoreIcon}
                              label={t("actions.regenerate")}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!jobsQuery.data?.length ? (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="text-center text-sm text-muted-foreground"
                        >
                          {jobsQuery.isLoading ? tCommon("loading") : t("history.empty")}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>
        <StudioCreateProductDialog
          open={Boolean(productCreation)}
          onOpenChange={(open) => { if (!open) setProductCreation(null); }}
          onCreated={handleProductCreated}
        />
      </div>
    </div>
  );
};

export default ProductImageStudioPage;

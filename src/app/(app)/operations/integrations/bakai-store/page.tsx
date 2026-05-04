"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import {
  BakaiStoreConnectionMode,
  BakaiStoreExportJobStatus,
  BakaiStoreJobType,
} from "@prisma/client";

import { PageHeader } from "@/components/page-header";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { SelectionToolbar } from "@/components/selection-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormActions, FormGrid } from "@/components/form-layout";
import { IntegrationsIcon } from "@/components/icons";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { baseAccountingCurrency, formatKgsMoney } from "@/lib/currencyDisplay";
import { formatDateTime } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const ISSUE_CODES = [
  "NO_PRODUCTS_SELECTED",
  "MISSING_API_TOKEN",
  "CONNECTION_TEST_FAILED",
  "TOO_MANY_PRODUCTS_IN_SINGLE_BATCH",
  "MISSING_SKU",
  "DUPLICATE_SKU",
  "INVALID_SKU",
  "MISSING_NAME",
  "INVALID_NAME",
  "INVALID_NAME_LENGTH",
  "MISSING_PRICE",
  "INVALID_PRICE",
  "MISSING_CATEGORY",
  "MISSING_DESCRIPTION",
  "DESCRIPTION_TOO_SHORT",
  "MISSING_IMAGES",
  "NOT_ENOUGH_IMAGES",
  "INVALID_IMAGE_URL",
  "MISSING_STOCK",
  "MISSING_BRANCH_ID",
  "MULTIPLE_BRANCH_MAPPINGS_UNSUPPORTED",
  "INVALID_BRANCH_ID",
  "INVALID_QUANTITY",
  "DISCOUNT_CONFLICT",
  "INVALID_DISCOUNT_PERCENT",
  "INVALID_DISCOUNT_AMOUNT",
  "INVALID_SIMILAR_PRODUCTS",
  "MISSING_SPECS",
  "INVALID_SPECS",
  "MISSING_STOCK_MAPPING",
  "INVALID_STOCK_VALUE",
  "TEMPLATE_RENDER_ERROR",
  "API_PAYLOAD_INVALID",
  "API_REQUEST_FAILED",
  "RATE_LIMITED",
] as const;

type IssueCode = (typeof ISSUE_CODES)[number];

const NONE_STORE_VALUE = "__none__";

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

const ProductImageThumb = ({ imageUrl, name }: { imageUrl?: string | null; name: string }) => {
  const fallbackLabel = name.trim().charAt(0).toUpperCase() || "#";

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
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

const overviewBadgeVariant = (status: "NOT_CONFIGURED" | "DRAFT" | "READY" | "ERROR") => {
  if (status === "READY") {
    return "success" as const;
  }
  if (status === "ERROR") {
    return "danger" as const;
  }
  if (status === "DRAFT") {
    return "warning" as const;
  }
  return "muted" as const;
};

const jobBadgeVariant = (status: BakaiStoreExportJobStatus) => {
  if (status === BakaiStoreExportJobStatus.DONE) {
    return "success" as const;
  }
  if (status === BakaiStoreExportJobStatus.FAILED) {
    return "danger" as const;
  }
  if (status === BakaiStoreExportJobStatus.RUNNING) {
    return "warning" as const;
  }
  return "muted" as const;
};

const jobTypeBadgeVariant = (jobType: BakaiStoreJobType) =>
  jobType === BakaiStoreJobType.API_SYNC ? ("warning" as const) : ("muted" as const);

const productStatusBadgeVariant = (status: "EXCLUDED" | "INCLUDED" | "EXPORTED") => {
  if (status === "EXPORTED") {
    return "success" as const;
  }
  if (status === "INCLUDED") {
    return "warning" as const;
  }
  return "muted" as const;
};

const BakaiStorePage = () => {
  const t = useTranslations("bakaiStoreSettings");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session } = useSession();
  const { toast } = useToast();
  const trpcUtils = trpc.useUtils();
  const templateInputRef = useRef<HTMLInputElement | null>(null);

  const role = session?.user?.role ?? "STAFF";
  const canView = role === "ADMIN" || role === "MANAGER" || role === "STAFF";
  const canEdit = role === "ADMIN" || role === "MANAGER";

  const settingsQuery = trpc.bakaiStore.settings.useQuery(undefined, { enabled: canView });
  const jobsQuery = trpc.bakaiStore.jobs.useQuery(
    { limit: 100 },
    {
      enabled: canView,
      refetchInterval: (data) =>
        data?.some(
          (job) =>
            job.status === BakaiStoreExportJobStatus.QUEUED ||
            job.status === BakaiStoreExportJobStatus.RUNNING,
        )
          ? 5_000
          : false,
    },
  );
  const preflightQuery = trpc.bakaiStore.preflight.useQuery(undefined, {
    enabled: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const [mappingDraft, setMappingDraft] = useState<Record<string, string>>({});
  const [branchMappingDraft, setBranchMappingDraft] = useState<Record<string, string>>({});
  const [connectionMode, setConnectionMode] = useState<BakaiStoreConnectionMode>(
    BakaiStoreConnectionMode.TEMPLATE,
  );
  const [apiToken, setApiToken] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [productSelectionFilter, setProductSelectionFilter] = useState<
    "all" | "included" | "excluded"
  >("all");
  const [productsPage, setProductsPage] = useState(1);
  const [productsPageSize, setProductsPageSize] = useState(10);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [selectingAllProducts, setSelectingAllProducts] = useState(false);
  const [filterSku, setFilterSku] = useState("");
  const [filterIssue, setFilterIssue] = useState<string>("ALL");
  const [preflightFresh, setPreflightFresh] = useState(false);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);

  const hasActiveExportJob =
    jobsQuery.data?.some(
      (job) =>
        job.status === BakaiStoreExportJobStatus.QUEUED ||
        job.status === BakaiStoreExportJobStatus.RUNNING,
    ) ?? false;

  const productsQuery = trpc.bakaiStore.products.useQuery(
    {
      search: productSearch.trim() || undefined,
      selection: productSelectionFilter,
      page: productsPage,
      pageSize: productsPageSize,
    },
    {
      enabled: canView,
      keepPreviousData: true,
      refetchInterval: hasActiveExportJob ? 5_000 : false,
    },
  );

  const saveMappingsMutation = trpc.bakaiStore.saveMappings.useMutation({
    onSuccess: async () => {
      setPreflightFresh(false);
      await settingsQuery.refetch();
      toast({ variant: "success", description: t("settings.saved") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const saveSettingsMutation = trpc.bakaiStore.saveSettings.useMutation({
    onSuccess: async (_result, variables) => {
      setPreflightFresh(false);
      if (variables.clearToken) {
        setApiToken("");
      }
      await settingsQuery.refetch();
      toast({ variant: "success", description: t("settings.connectionSaved") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const saveBranchMappingsMutation = trpc.bakaiStore.saveBranchMappings.useMutation({
    onSuccess: async () => {
      setPreflightFresh(false);
      await settingsQuery.refetch();
      toast({ variant: "success", description: t("settings.branchMappingsSaved") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const testConnectionMutation = trpc.bakaiStore.testConnection.useMutation({
    onSuccess: (result) => {
      toast({
        variant: result.ok ? "success" : "info",
        description: result.ok
          ? t("settings.connectionCheckSuccess", { status: result.status })
          : t("settings.connectionCheckInfo", { status: result.status }),
      });
      void settingsQuery.refetch();
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
      void settingsQuery.refetch();
    },
  });

  const updateProductsMutation = trpc.bakaiStore.updateProducts.useMutation({
    onSuccess: async (result, variables) => {
      setPreflightFresh(false);
      setSelectedProductIds(new Set());
      await productsQuery.refetch();
      toast({
        variant: "success",
        description: variables.included
          ? t("productsSelection.includedSuccess", { count: result.updatedCount })
          : t("productsSelection.excludedSuccess", { count: result.updatedCount }),
      });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const exportMutation = trpc.bakaiStore.exportNow.useMutation({
    onSuccess: async () => {
      toast({ variant: "success", description: t("export.started") });
      await Promise.all([jobsQuery.refetch(), settingsQuery.refetch()]);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const exportReadyMutation = trpc.bakaiStore.exportReadyNow.useMutation({
    onSuccess: async () => {
      toast({ variant: "success", description: t("export.readyStarted") });
      await Promise.all([jobsQuery.refetch(), settingsQuery.refetch()]);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const apiSyncMutation = trpc.bakaiStore.apiSyncNow.useMutation({
    onSuccess: async () => {
      toast({ variant: "success", description: t("export.apiStarted") });
      await Promise.all([jobsQuery.refetch(), settingsQuery.refetch()]);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const apiSyncReadyMutation = trpc.bakaiStore.apiSyncReadyNow.useMutation({
    onSuccess: async () => {
      toast({ variant: "success", description: t("export.apiReadyStarted") });
      await Promise.all([jobsQuery.refetch(), settingsQuery.refetch()]);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  useEffect(() => {
    const mappings = settingsQuery.data?.mappings ?? [];
    const next: Record<string, string> = {};
    for (const mapping of mappings) {
      next[mapping.columnKey] = mapping.storeId;
    }
    setMappingDraft(next);
  }, [settingsQuery.data?.mappings]);

  useEffect(() => {
    const mappings = settingsQuery.data?.branchMappings ?? [];
    const next: Record<string, string> = {};
    for (const mapping of mappings) {
      next[mapping.storeId] = mapping.branchId;
    }
    setBranchMappingDraft(next);
  }, [settingsQuery.data?.branchMappings]);

  useEffect(() => {
    setConnectionMode(
      settingsQuery.data?.integration.connectionMode ?? BakaiStoreConnectionMode.TEMPLATE,
    );
  }, [settingsQuery.data?.integration.connectionMode]);

  useEffect(() => {
    setProductsPage(1);
  }, [productSearch, productSelectionFilter]);

  const handleTemplateUpload = async (file: File | null) => {
    if (!file || !canEdit) {
      return;
    }
    setUploadingTemplate(true);
    try {
      const payload = new FormData();
      payload.set("file", file);
      const response = await fetch("/api/bakai-store/template", {
        method: "POST",
        body: payload,
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        const message =
          body.message && tErrors.has?.(body.message)
            ? tErrors(body.message)
            : tErrors("genericMessage");
        throw new Error(message);
      }
      setPreflightFresh(false);
      await settingsQuery.refetch();
      toast({ variant: "success", description: t("settings.templateUploadSuccess") });
    } catch (error) {
      toast({
        variant: "error",
        description: error instanceof Error ? error.message : tErrors("genericMessage"),
      });
    } finally {
      setUploadingTemplate(false);
    }
  };

  const handleRunPreflight = async () => {
    const result = await preflightQuery.refetch();
    if (result.data) {
      setPreflightFresh(true);
    }
  };

  const handleSaveMappings = () => {
    if (!canEdit || !settingsQuery.data?.mappings) {
      return;
    }
    saveMappingsMutation.mutate({
      mappings: settingsQuery.data.mappings.map((mapping) => ({
        columnKey: mapping.columnKey,
        storeId: mappingDraft[mapping.columnKey] ?? "",
      })),
    });
  };

  const handleSaveSettings = () => {
    if (!canEdit) {
      return;
    }
    saveSettingsMutation.mutate({
      connectionMode,
      apiToken: apiToken.trim() || undefined,
    });
  };

  const handleClearSavedToken = () => {
    if (!canEdit) {
      return;
    }
    saveSettingsMutation.mutate({
      connectionMode,
      clearToken: true,
    });
  };

  const handleSaveBranchMappings = () => {
    if (!canEdit || !settingsQuery.data?.branchMappings) {
      return;
    }
    saveBranchMappingsMutation.mutate({
      mappings: settingsQuery.data.branchMappings.map((mapping) => ({
        storeId: mapping.storeId,
        branchId: branchMappingDraft[mapping.storeId] ?? "",
      })),
    });
  };

  const toggleProductSelection = (productId: string) => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  const toggleSelectAllProductsOnPage = () => {
    const pageIds = (productsQuery.data?.items ?? []).map((product) => product.id);
    if (!pageIds.length) {
      return;
    }
    const allSelected = pageIds.every((id) => selectedProductIds.has(id));
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      for (const id of pageIds) {
        if (allSelected) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }
      return next;
    });
  };

  const clearProductSelection = () => {
    setSelectedProductIds(new Set());
  };

  const handleSelectAllProductResults = async () => {
    setSelectingAllProducts(true);
    try {
      const ids = await trpcUtils.bakaiStore.listIds.fetch({
        search: productSearch.trim() || undefined,
        selection: productSelectionFilter,
      });
      setSelectedProductIds(new Set(ids));
    } catch (error) {
      toast({
        variant: "error",
        description: translateError(tErrors, error as Parameters<typeof translateError>[1]),
      });
    } finally {
      setSelectingAllProducts(false);
    }
  };

  const handleUpdateProducts = (included: boolean, productIds?: string[]) => {
    if (!canEdit) {
      return;
    }
    const targetIds = productIds ?? Array.from(selectedProductIds);
    if (!targetIds.length) {
      return;
    }
    updateProductsMutation.mutate({
      productIds: targetIds,
      included,
    });
  };

  const preflightData = preflightQuery.data;
  const activeMode =
    settingsQuery.data?.integration.connectionMode ?? BakaiStoreConnectionMode.TEMPLATE;
  const isApiMode = activeMode === BakaiStoreConnectionMode.API;
  const hasConfiguredApiEndpoint = Boolean(settingsQuery.data?.integration.importEndpoint);
  const readyProductsCount = preflightData?.summary.productsReady ?? 0;
  const preflightCanExport =
    preflightFresh &&
    Boolean(
      isApiMode ? preflightData?.actionability.canRunAll : preflightData?.actionability.canRunAll,
    );
  const filteredFailedProducts = useMemo(() => {
    const failedProducts = preflightData?.failedProducts ?? [];
    const normalizedSkuFilter = filterSku.trim().toLowerCase();
    const selectedIssue = filterIssue === "ALL" ? null : (filterIssue as IssueCode);

    return failedProducts.filter((row) => {
      if (normalizedSkuFilter) {
        const skuMatch = row.sku.toLowerCase().includes(normalizedSkuFilter);
        const nameMatch = row.name.toLowerCase().includes(normalizedSkuFilter);
        if (!skuMatch && !nameMatch) {
          return false;
        }
      }
      if (selectedIssue && !row.issues.includes(selectedIssue)) {
        return false;
      }
      return true;
    });
  }, [filterIssue, filterSku, preflightData?.failedProducts]);

  const productItems = productsQuery.data?.items ?? [];
  const productSummary = productsQuery.data?.summary;
  const allProductsSelectedOnPage =
    productItems.length > 0 && productItems.every((product) => selectedProductIds.has(product.id));
  const allProductResultsSelected =
    (productsQuery.data?.total ?? 0) > 0 &&
    selectedProductIds.size === (productsQuery.data?.total ?? 0);

  const exportDisabledReason =
    !preflightFresh || !preflightData
      ? t("export.disabledNeedPreflight")
      : !preflightData.actionability.canRunAll
        ? t("export.disabledFailed")
        : hasActiveExportJob
          ? t("export.disabledActiveJob")
          : "";
  const exportReadyDisabledReason =
    !preflightFresh || !preflightData
      ? t("export.disabledNeedPreflight")
      : readyProductsCount === 0
        ? t("export.disabledNoReadyProducts")
        : hasActiveExportJob
          ? t("export.disabledActiveJob")
          : "";
  const apiSyncDisabledReason =
    !hasConfiguredApiEndpoint
      ? t("export.apiEndpointMissing")
      : !preflightFresh || !preflightData
        ? t("export.disabledNeedPreflight")
        : !preflightData.actionability.canRunAll
          ? t("export.disabledFailed")
          : hasActiveExportJob
            ? t("export.disabledActiveJob")
            : "";
  const apiReadyDisabledReason =
    !hasConfiguredApiEndpoint
      ? t("export.apiEndpointMissing")
      : !preflightFresh || !preflightData
        ? t("export.disabledNeedPreflight")
        : !preflightData.actionability.canRunReadyOnly
          ? t("export.apiReadyUnsafe")
          : hasActiveExportJob
            ? t("export.disabledActiveJob")
            : "";

  if (!canView) {
    return null;
  }

  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <IntegrationsIcon className="h-5 w-5 text-primary" aria-hidden />
                {t("overview.title")}
              </CardTitle>
              <p className="text-sm text-muted-foreground">{t("overview.description")}</p>
            </div>
            <Badge
              variant={overviewBadgeVariant(
                settingsQuery.data?.integration.status ?? "NOT_CONFIGURED",
              )}
            >
              {t(
                `status.${(settingsQuery.data?.integration.status ?? "NOT_CONFIGURED").toLowerCase()}`,
              )}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">{t("overview.metrics.mode")}</p>
              <p className="text-sm font-semibold">
                {t(
                  `settings.modeOptions.${(
                    settingsQuery.data?.integration.connectionMode ?? BakaiStoreConnectionMode.TEMPLATE
                  ).toLowerCase()}`,
                )}
              </p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">{t("overview.metrics.token")}</p>
              <p className="text-sm font-semibold">
                {settingsQuery.data?.integration.hasApiToken
                  ? t("overview.tokenSaved")
                  : t("overview.tokenMissing")}
              </p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">{t("overview.metrics.endpoint")}</p>
              <p className="text-sm font-semibold">
                {settingsQuery.data?.integration.importEndpoint
                  ? t("overview.endpointConfigured")
                  : t("overview.endpointMissing")}
              </p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">{t("overview.metrics.lastSync")}</p>
              <p className="text-sm font-semibold">
                {settingsQuery.data?.integration.lastSyncAt
                  ? formatDateTime(settingsQuery.data.integration.lastSyncAt, locale)
                  : "-"}
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">{t("overview.metrics.template")}</p>
              <p className="text-sm font-semibold">
                {settingsQuery.data?.integration.template?.fileName ?? t("overview.notUploaded")}
              </p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">{t("overview.metrics.sheet")}</p>
              <p className="text-sm font-semibold">
                {settingsQuery.data?.integration.template?.sheetName ?? "-"}
              </p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">{t("overview.metrics.stockColumns")}</p>
              <p className="text-sm font-semibold">
                {settingsQuery.data?.integration.template?.stockColumns.join(", ") ?? "pp1"}
              </p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">
                {t("overview.metrics.lastConnectionCheck")}
              </p>
              <p className="text-sm font-semibold">
                {settingsQuery.data?.integration.lastConnectionCheckAt
                  ? formatDateTime(settingsQuery.data.integration.lastConnectionCheckAt, locale)
                  : "-"}
              </p>
            </div>
          </div>

          {settingsQuery.data?.integration.template ? (
            <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
              <p>
                {t("overview.templateMeta", {
                  fileSize: formatFileSize(settingsQuery.data.integration.template.fileSize),
                  row: String((settingsQuery.data.integration.template.dataStartRowIndex ?? 0) + 1),
                })}
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
              {t("overview.uploadHint")}
            </div>
          )}

          {settingsQuery.data?.integration.lastErrorSummary ? (
            <div className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
              {settingsQuery.data.integration.lastErrorSummary}
            </div>
          ) : null}

          {settingsQuery.data?.integration.lastConnectionCheckSummary ? (
            <div className="rounded-md border border-border p-3 text-xs text-muted-foreground">
              {settingsQuery.data.integration.lastConnectionCheckSummary}
            </div>
          ) : null}

          {!canEdit ? <p className="text-xs text-muted-foreground">{t("readOnlyHint")}</p> : null}

          <input
            ref={templateInputRef}
            type="file"
            accept=".xlsx,.xls,.xlsm"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              void handleTemplateUpload(file);
              event.currentTarget.value = "";
            }}
          />

          <FormActions className="justify-start">
            <Button
              type="button"
              variant="outline"
              onClick={() => templateInputRef.current?.click()}
              disabled={!canEdit || uploadingTemplate}
            >
              {uploadingTemplate ? <Spinner className="h-4 w-4" /> : null}
              {t("settings.uploadTemplate")}
            </Button>
            {settingsQuery.data?.integration.hasTemplate ? (
              <Link href="/api/bakai-store/template">
                <Button variant="secondary">{t("settings.downloadTemplate")}</Button>
              </Link>
            ) : null}
          </FormActions>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("settings.connectionTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("settings.connectionSubtitle")}</p>
          <FormGrid>
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("settings.modeLabel")}</p>
              <Select
                value={connectionMode}
                onValueChange={(value) => setConnectionMode(value as BakaiStoreConnectionMode)}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={BakaiStoreConnectionMode.TEMPLATE}>
                    {t("settings.modeOptions.template")}
                  </SelectItem>
                  <SelectItem value={BakaiStoreConnectionMode.API}>
                    {t("settings.modeOptions.api")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("settings.apiTokenLabel")}</p>
              <Input
                type="password"
                value={apiToken}
                onChange={(event) => setApiToken(event.target.value)}
                placeholder={
                  settingsQuery.data?.integration.hasApiToken
                    ? t("settings.apiTokenSavedPlaceholder")
                    : t("settings.apiTokenPlaceholder")
                }
                disabled={!canEdit}
              />
            </div>
          </FormGrid>

          <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
            <p>
              {settingsQuery.data?.integration.importEndpoint
                ? t("settings.endpointConfigured", {
                    endpoint: settingsQuery.data.integration.importEndpoint,
                  })
                : t("settings.endpointPending")}
            </p>
            {isApiMode ? (
              <p className="mt-2 text-xs">{t("settings.apiSubsetWarning")}</p>
            ) : null}
          </div>

          <FormActions className="justify-start">
            <Button
              type="button"
              onClick={handleSaveSettings}
              disabled={!canEdit || saveSettingsMutation.isLoading}
            >
              {saveSettingsMutation.isLoading ? tCommon("loading") : t("settings.saveConnection")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => testConnectionMutation.mutate()}
              disabled={
                !canEdit ||
                testConnectionMutation.isLoading ||
                !settingsQuery.data?.integration.hasApiToken ||
                !settingsQuery.data?.integration.importEndpoint
              }
            >
              {testConnectionMutation.isLoading ? tCommon("loading") : t("settings.testConnection")}
            </Button>
            {settingsQuery.data?.integration.hasApiToken ? (
              <Button
                type="button"
                variant="secondary"
                onClick={handleClearSavedToken}
                disabled={!canEdit || saveSettingsMutation.isLoading}
              >
                {t("settings.clearToken")}
              </Button>
            ) : null}
          </FormActions>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("settings.mappingsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("settings.mappingsSubtitle")}</p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("settings.columns.column")}</TableHead>
                  <TableHead>{t("settings.columns.store")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(settingsQuery.data?.mappings ?? []).map((mapping) => (
                  <TableRow key={mapping.columnKey}>
                    <TableCell className="font-mono text-xs">{mapping.columnKey}</TableCell>
                    <TableCell>
                      <Select
                        value={mappingDraft[mapping.columnKey] || NONE_STORE_VALUE}
                        onValueChange={(value) =>
                          setMappingDraft((prev) => ({
                            ...prev,
                            [mapping.columnKey]: value === NONE_STORE_VALUE ? "" : value,
                          }))
                        }
                        disabled={!canEdit}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE_STORE_VALUE}>
                            {t("settings.unassigned")}
                          </SelectItem>
                          {(settingsQuery.data?.stores ?? []).map((store) => (
                            <SelectItem key={store.storeId} value={store.storeId}>
                              {store.storeName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <FormActions className="justify-start">
            <Button
              type="button"
              onClick={handleSaveMappings}
              disabled={!canEdit || saveMappingsMutation.isLoading}
            >
              {saveMappingsMutation.isLoading ? tCommon("loading") : t("settings.saveMappings")}
            </Button>
          </FormActions>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("settings.branchMappingsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("settings.branchMappingsSubtitle")}</p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("settings.branchColumns.store")}</TableHead>
                  <TableHead>{t("settings.branchColumns.branch")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(settingsQuery.data?.branchMappings ?? []).map((mapping) => (
                  <TableRow key={mapping.storeId}>
                    <TableCell>{mapping.storeName}</TableCell>
                    <TableCell>
                      <Input
                        value={branchMappingDraft[mapping.storeId] ?? ""}
                        onChange={(event) =>
                          setBranchMappingDraft((prev) => ({
                            ...prev,
                            [mapping.storeId]: event.target.value,
                          }))
                        }
                        placeholder={t("settings.branchPlaceholder")}
                        disabled={!canEdit}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <FormActions className="justify-start">
            <Button
              type="button"
              onClick={handleSaveBranchMappings}
              disabled={!canEdit || saveBranchMappingsMutation.isLoading}
            >
              {saveBranchMappingsMutation.isLoading
                ? tCommon("loading")
                : t("settings.saveBranchMappings")}
            </Button>
          </FormActions>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("productsSelection.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("productsSelection.subtitle")}</p>
          <p className="text-xs text-muted-foreground">{t("productsSelection.note")}</p>
          {isApiMode ? (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-foreground">
              {t("productsSelection.apiWarning")}
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">
                {t("productsSelection.metrics.total")}
              </p>
              <p className="text-lg font-semibold">{productSummary?.totalProducts ?? 0}</p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">
                {t("productsSelection.metrics.included")}
              </p>
              <p className="text-lg font-semibold">{productSummary?.includedProducts ?? 0}</p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">
                {t("productsSelection.metrics.excluded")}
              </p>
              <p className="text-lg font-semibold">{productSummary?.excludedProducts ?? 0}</p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_16rem]">
            <Input
              value={productSearch}
              onChange={(event) => setProductSearch(event.target.value)}
              placeholder={t("productsSelection.search")}
            />
            <Select
              value={productSelectionFilter}
              onValueChange={(value) =>
                setProductSelectionFilter(value as "all" | "included" | "excluded")
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("productsSelection.filters.all")}</SelectItem>
                <SelectItem value="included">{t("productsSelection.filters.included")}</SelectItem>
                <SelectItem value="excluded">{t("productsSelection.filters.excluded")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {!canEdit ? <p className="text-xs text-muted-foreground">{t("readOnlyHint")}</p> : null}

          {canEdit && selectedProductIds.size > 0 ? (
            <SelectionToolbar
              count={selectedProductIds.size}
              label={t("productsSelection.selectedLabel", { count: selectedProductIds.size })}
              onClear={clearProductSelection}
              clearLabel={t("productsSelection.clearSelection")}
            >
              {productsQuery.data &&
              productsQuery.data.total > productItems.length &&
              !allProductResultsSelected ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={() => void handleSelectAllProductResults()}
                  disabled={selectingAllProducts}
                >
                  {selectingAllProducts ? <Spinner className="h-4 w-4" /> : null}
                  {selectingAllProducts
                    ? tCommon("loading")
                    : tCommon("selectAllResults", { count: productsQuery.data.total })}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full sm:w-auto"
                onClick={() => handleUpdateProducts(true)}
                disabled={updateProductsMutation.isLoading}
              >
                {t("productsSelection.includeSelected")}
              </Button>
              <Button
                type="button"
                size="sm"
                className="w-full sm:w-auto"
                onClick={() => handleUpdateProducts(false)}
                disabled={updateProductsMutation.isLoading}
              >
                {t("productsSelection.excludeSelected")}
              </Button>
            </SelectionToolbar>
          ) : null}

          {productsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : productsQuery.error ? (
            <p className="text-sm text-danger">{translateError(tErrors, productsQuery.error)}</p>
          ) : (
            <ResponsiveDataList
              items={productItems}
              page={productsPage}
              totalItems={productsQuery.data?.total ?? 0}
              defaultPageSize={10}
              pageSizeOptions={[10]}
              onPageChange={setProductsPage}
              onPageSizeChange={setProductsPageSize}
              scrollToTopOnPageChange
              empty={
                <p className="text-sm text-muted-foreground">{t("productsSelection.empty")}</p>
              }
              renderDesktop={(visibleItems) =>
                visibleItems.length ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {canEdit ? (
                            <TableHead className="w-10">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-border bg-background text-primary accent-primary"
                                checked={allProductsSelectedOnPage}
                                onChange={toggleSelectAllProductsOnPage}
                                aria-label={t("productsSelection.selectAll")}
                              />
                            </TableHead>
                          ) : null}
                          <TableHead>{t("productsSelection.columns.sku")}</TableHead>
                          <TableHead className="w-16">
                            {t("productsSelection.columns.image")}
                          </TableHead>
                          <TableHead>{t("productsSelection.columns.name")}</TableHead>
                          <TableHead>{t("productsSelection.columns.category")}</TableHead>
                          <TableHead>{t("productsSelection.columns.price")}</TableHead>
                          <TableHead>{t("productsSelection.columns.onHand")}</TableHead>
                          <TableHead>{t("productsSelection.columns.status")}</TableHead>
                          {canEdit ? (
                            <TableHead>{t("productsSelection.columns.actions")}</TableHead>
                          ) : null}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleItems.map((product) => (
                          <TableRow key={product.id}>
                            {canEdit ? (
                              <TableCell>
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-border bg-background text-primary accent-primary"
                                  checked={selectedProductIds.has(product.id)}
                                  onChange={() => toggleProductSelection(product.id)}
                                  aria-label={t("productsSelection.selectProduct", {
                                    name: product.name,
                                  })}
                                />
                              </TableCell>
                            ) : null}
                            <TableCell className="font-mono text-xs">{product.sku}</TableCell>
                            <TableCell>
                              <ProductImageThumb imageUrl={product.imageUrl} name={product.name} />
                            </TableCell>
                            <TableCell className="font-medium">{product.name}</TableCell>
                            <TableCell>{product.category ?? "-"}</TableCell>
                            <TableCell>
                              {product.priceKgs === null
                                ? "-"
                                : formatKgsMoney(product.priceKgs, locale, baseAccountingCurrency)}
                            </TableCell>
                            <TableCell>{product.onHandQty}</TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                <Badge variant={productStatusBadgeVariant(product.exportStatus)}>
                                  {product.included
                                    ? t("productsSelection.statusIncluded")
                                    : t("productsSelection.statusExcluded")}
                                </Badge>
                                {product.lastExportedAt ? (
                                  <p className="text-xs text-muted-foreground">
                                    {t("productsSelection.lastExportedAt", {
                                      date: formatDateTime(product.lastExportedAt, locale),
                                    })}
                                  </p>
                                ) : null}
                              </div>
                            </TableCell>
                            {canEdit ? (
                              <TableCell>
                                <Button
                                  type="button"
                                  variant={product.included ? "outline" : "secondary"}
                                  size="sm"
                                  onClick={() =>
                                    handleUpdateProducts(!product.included, [product.id])
                                  }
                                  disabled={updateProductsMutation.isLoading}
                                >
                                  {product.included
                                    ? t("productsSelection.rowExclude")
                                    : t("productsSelection.rowInclude")}
                                </Button>
                              </TableCell>
                            ) : null}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("productsSelection.empty")}</p>
                )
              }
              renderMobile={(product) => (
                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <ProductImageThumb imageUrl={product.imageUrl} name={product.name} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {product.name}
                        </p>
                        <p className="text-xs text-muted-foreground">{product.sku}</p>
                      </div>
                    </div>
                    <Badge variant={productStatusBadgeVariant(product.exportStatus)}>
                      {product.included
                        ? t("productsSelection.statusIncluded")
                        : t("productsSelection.statusExcluded")}
                    </Badge>
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                    <p>
                      {t("productsSelection.columns.category")}: {product.category ?? "-"}
                    </p>
                    <p>
                      {t("productsSelection.columns.price")}:{" "}
                      {product.priceKgs === null
                        ? "-"
                        : formatKgsMoney(product.priceKgs, locale, baseAccountingCurrency)}
                    </p>
                    <p>
                      {t("productsSelection.columns.onHand")}: {product.onHandQty}
                    </p>
                  </div>
                  {canEdit ? (
                    <div className="mt-3 flex items-center gap-2">
                      <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-border bg-background text-primary accent-primary"
                          checked={selectedProductIds.has(product.id)}
                          onChange={() => toggleProductSelection(product.id)}
                          aria-label={t("productsSelection.selectProduct", { name: product.name })}
                        />
                        {t("productsSelection.selectProductShort")}
                      </label>
                      <Button
                        type="button"
                        size="sm"
                        variant={product.included ? "outline" : "secondary"}
                        className="ml-auto"
                        onClick={() => handleUpdateProducts(!product.included, [product.id])}
                        disabled={updateProductsMutation.isLoading}
                      >
                        {product.included
                          ? t("productsSelection.rowExclude")
                          : t("productsSelection.rowInclude")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
              getKey={(product) => product.id}
            />
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("preflight.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {isApiMode ? t("preflight.subtitleApi") : t("preflight.subtitle")}
          </p>
          <FormActions className="justify-start">
            <Button type="button" onClick={handleRunPreflight} disabled={preflightQuery.isFetching}>
              {preflightQuery.isFetching ? tCommon("loading") : t("preflight.run")}
            </Button>
          </FormActions>

          {preflightQuery.isFetching ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : null}

          {preflightData ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-md border border-border p-3">
                  <p className="text-xs text-muted-foreground">
                    {t("preflight.metrics.considered")}
                  </p>
                  <p className="text-lg font-semibold">
                    {preflightData.summary.productsConsidered}
                  </p>
                </div>
                <div className="rounded-md border border-border p-3">
                  <p className="text-xs text-muted-foreground">{t("preflight.metrics.ready")}</p>
                  <p className="text-lg font-semibold">{preflightData.summary.productsReady}</p>
                </div>
                <div className="rounded-md border border-border p-3">
                  <p className="text-xs text-muted-foreground">{t("preflight.metrics.failed")}</p>
                  <p className="text-lg font-semibold">{preflightData.summary.productsFailed}</p>
                </div>
                <div className="rounded-md border border-border p-3">
                  <p className="text-xs text-muted-foreground">{t("preflight.metrics.warnings")}</p>
                  <p className="text-lg font-semibold">{preflightData.warnings.total}</p>
                </div>
              </div>

              <div className="rounded-md border border-border p-3">
                <p className="text-sm font-medium text-foreground">
                  {t("preflight.blockersTitle")}
                </p>
                {preflightData.blockers.total === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">{t("preflight.noBlockers")}</p>
                ) : (
                  <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                    {ISSUE_CODES.filter(
                      (code) => (preflightData.blockers.byCode[code] ?? 0) > 0,
                    ).map((code) => (
                      <p key={code}>
                        {t(`issues.${code}`)}: {preflightData.blockers.byCode[code]}
                      </p>
                    ))}
                  </div>
                )}

                {preflightData.blockers.missingStoreMappings.length ? (
                  <div className="mt-3 text-sm text-danger">
                    <p>{t("preflight.missingMappingsTitle")}</p>
                    {preflightData.blockers.missingStoreMappings.map((mapping) => (
                      <p key={mapping.columnKey ?? mapping.storeId}>
                        {mapping.columnKey ?? mapping.storeName ?? mapping.storeId}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>

              {preflightData.warnings.total > 0 ? (
                <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-foreground">
                  <p className="font-medium">{t("preflight.warningsTitle")}</p>
                  <div className="mt-2 space-y-1">
                    {preflightData.warnings.global.map((warning) => (
                      <p key={warning}>{t(`warnings.${warning}`)}</p>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  value={filterSku}
                  onChange={(event) => setFilterSku(event.target.value)}
                  placeholder={t("preflight.filters.search")}
                />
                <Select value={filterIssue} onValueChange={setFilterIssue}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("preflight.filters.issue")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">{t("preflight.filters.all")}</SelectItem>
                    {ISSUE_CODES.map((code) => (
                      <SelectItem key={code} value={code}>
                        {t(`issues.${code}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {filteredFailedProducts.length ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("preflight.table.sku")}</TableHead>
                        <TableHead>{t("preflight.table.name")}</TableHead>
                        <TableHead>{t("preflight.table.issues")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredFailedProducts.map((row) => (
                        <TableRow key={`${row.productId}-${row.sku}`}>
                          <TableCell className="font-mono text-xs">{row.sku || "-"}</TableCell>
                          <TableCell>{row.name || "-"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {row.issues.map((issue) => t(`issues.${issue}`)).join(", ")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t("preflight.table.empty")}</p>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("export.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {isApiMode ? t("export.ruleApi") : t("export.ruleTemplate")}
          </p>
          <p className="text-sm text-muted-foreground">
            {isApiMode ? t("export.ruleApiReadyOnly") : t("export.ruleReadyOnly")}
          </p>

          {hasActiveExportJob ? <Badge variant="warning">{t("export.activeJob")}</Badge> : null}

          <FormActions className="justify-start">
            {isApiMode ? (
              <>
                <Button
                  type="button"
                  onClick={() => apiSyncMutation.mutate()}
                  disabled={
                    !canEdit ||
                    apiSyncMutation.isLoading ||
                    apiSyncReadyMutation.isLoading ||
                    !preflightFresh ||
                    !preflightData?.actionability.canRunAll ||
                    !hasConfiguredApiEndpoint ||
                    hasActiveExportJob
                  }
                  title={apiSyncDisabledReason}
                >
                  {apiSyncMutation.isLoading ? tCommon("loading") : t("export.runApi")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => apiSyncReadyMutation.mutate()}
                  disabled={
                    !canEdit ||
                    apiSyncMutation.isLoading ||
                    apiSyncReadyMutation.isLoading ||
                    !preflightFresh ||
                    !preflightData?.actionability.canRunReadyOnly ||
                    !hasConfiguredApiEndpoint ||
                    hasActiveExportJob
                  }
                  title={apiReadyDisabledReason}
                >
                  {apiSyncReadyMutation.isLoading
                    ? tCommon("loading")
                    : t("export.runApiReady", { count: readyProductsCount })}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => exportMutation.mutate()}
                  disabled={!canEdit || exportMutation.isLoading || hasActiveExportJob}
                >
                  {exportMutation.isLoading ? tCommon("loading") : t("export.runFallback")}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  onClick={() => exportMutation.mutate()}
                  disabled={
                    !canEdit ||
                    exportMutation.isLoading ||
                    exportReadyMutation.isLoading ||
                    !preflightCanExport ||
                    hasActiveExportJob
                  }
                  title={exportDisabledReason}
                >
                  {exportMutation.isLoading ? tCommon("loading") : t("export.run")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => exportReadyMutation.mutate()}
                  disabled={
                    !canEdit ||
                    exportMutation.isLoading ||
                    exportReadyMutation.isLoading ||
                    !preflightFresh ||
                    readyProductsCount === 0 ||
                    hasActiveExportJob
                  }
                  title={exportReadyDisabledReason}
                >
                  {exportReadyMutation.isLoading
                    ? tCommon("loading")
                    : t("export.runReady", { count: readyProductsCount })}
                </Button>
              </>
            )}
          </FormActions>

          {isApiMode && apiSyncDisabledReason ? (
            <p className="text-xs text-muted-foreground">{apiSyncDisabledReason}</p>
          ) : !preflightCanExport ? (
            <p className="text-xs text-muted-foreground">{exportDisabledReason}</p>
          ) : null}

          {preflightFresh && !preflightCanExport && readyProductsCount > 0 && !isApiMode ? (
            <p className="text-xs text-muted-foreground">
              {t("export.readyAvailableHint", { count: readyProductsCount })}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("history.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {jobsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : jobsQuery.error ? (
            <p className="text-sm text-danger">{translateError(tErrors, jobsQuery.error)}</p>
          ) : jobsQuery.data?.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("history.columns.createdAt")}</TableHead>
                    <TableHead>{t("history.columns.type")}</TableHead>
                    <TableHead>{t("history.columns.status")}</TableHead>
                    <TableHead>{t("history.columns.startedBy")}</TableHead>
                    <TableHead>{t("history.columns.summary")}</TableHead>
                    <TableHead>{t("history.columns.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobsQuery.data.map((job) => {
                    const stats =
                      job.payloadStatsJson &&
                      typeof job.payloadStatsJson === "object" &&
                      !Array.isArray(job.payloadStatsJson)
                        ? (job.payloadStatsJson as Record<string, unknown>)
                        : {};
                    const productCount =
                      typeof stats.productCount === "number" ? stats.productCount : 0;
                    const attempted =
                      typeof job.attemptedCount === "number" ? job.attemptedCount : productCount;
                    const succeeded =
                      typeof job.succeededCount === "number" ? job.succeededCount : 0;
                    const failed = typeof job.failedCount === "number" ? job.failedCount : 0;
                    const skipped = typeof job.skippedCount === "number" ? job.skippedCount : 0;

                    return (
                      <TableRow key={job.id}>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDateTime(job.createdAt, locale)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={jobTypeBadgeVariant(job.jobType)}>
                            {t(`history.types.${job.jobType}`)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={jobBadgeVariant(job.status)}>
                            {t(`history.status.${job.status}`)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {job.requestedBy?.name ?? "-"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {job.jobType === BakaiStoreJobType.API_SYNC
                            ? t("history.apiSummary", {
                                attempted,
                                succeeded,
                                failed,
                                skipped,
                              })
                            : t("history.summary", { products: productCount })}
                        </TableCell>
                        <TableCell className="space-x-3">
                          {job.storagePath ? (
                            <a
                              className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                              href={`/api/bakai-store/jobs/${job.id}/workbook`}
                            >
                              {t("history.downloadWorkbook")}
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {t("history.noWorkbook")}
                            </span>
                          )}
                          {job.errorReportJson ? (
                            <a
                              className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                              href={`/api/bakai-store/jobs/${job.id}/error-report`}
                            >
                              {t("history.downloadError")}
                            </a>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("history.empty")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default BakaiStorePage;

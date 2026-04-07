"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { MMarketEnvironment, MMarketExportJobStatus } from "@prisma/client";

import { PageHeader } from "@/components/page-header";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { SelectionToolbar } from "@/components/selection-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FormActions, FormGrid } from "@/components/form-layout";
import { CopyIcon, HideIcon, IntegrationsIcon, SparklesIcon, ViewIcon } from "@/components/icons";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { formatCurrencyKGS, formatDateTime } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const ISSUE_CODES = [
  "NO_PRODUCTS_SELECTED",
  "MISSING_SKU",
  "DUPLICATE_SKU",
  "INVALID_NAME_LENGTH",
  "MISSING_PRICE",
  "MISSING_CATEGORY",
  "SHORT_DESCRIPTION",
  "INVALID_IMAGES_COUNT",
  "NON_DIRECT_IMAGE_URL",
  "MISSING_STOCK_MAPPING",
  "MISSING_SPECS",
] as const;

type IssueCode = (typeof ISSUE_CODES)[number];

const mMarketBulkProgressBatchSize = 25;

type MMarketBulkProgressState = {
  kind: "descriptions" | "specs";
  status: "running" | "done" | "rateLimited" | "error";
  totalCount: number;
  processedCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  deferredCount: number;
  filledCount: number;
  batchIndex: number;
  batchCount: number;
  startedAt: number;
  errorMessage: string | null;
};

const formatCountdown = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.trunc(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remSeconds).padStart(2, "0")}`;
};

const ProductImageThumb = ({
  imageUrl,
  name,
}: {
  imageUrl?: string | null;
  name: string;
}) => {
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

const statusBadgeVariant = (status: MMarketExportJobStatus) => {
  if (status === MMarketExportJobStatus.DONE) {
    return "success" as const;
  }
  if (status === MMarketExportJobStatus.FAILED || status === MMarketExportJobStatus.RATE_LIMITED) {
    return "danger" as const;
  }
  if (status === MMarketExportJobStatus.RUNNING) {
    return "warning" as const;
  }
  return "muted" as const;
};

const productStatusBadgeVariant = (status: "EXCLUDED" | "INCLUDED" | "EXPORTED") => {
  if (status === "EXPORTED") {
    return "success" as const;
  }
  if (status === "INCLUDED") {
    return "warning" as const;
  }
  return "muted" as const;
};

const MMarketSettingsPage = () => {
  const t = useTranslations("mMarketSettings");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const tProducts = useTranslations("products");
  const locale = useLocale();
  const { data: session } = useSession();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const trpcUtils = trpc.useUtils();

  const role = session?.user?.role ?? "STAFF";
  const isAdmin = role === "ADMIN";
  const canView = role === "ADMIN" || role === "MANAGER" || role === "STAFF";
  const canEdit = role === "ADMIN" || role === "MANAGER";
  const [bulkProgress, setBulkProgress] = useState<MMarketBulkProgressState | null>(null);
  const [bulkElapsedSeconds, setBulkElapsedSeconds] = useState(0);

  const settingsQuery = trpc.mMarket.settings.useQuery(undefined, { enabled: canView });
  const jobsQuery = trpc.mMarket.jobs.useQuery(
    { limit: 100 },
    {
      enabled: canView,
      refetchInterval: (data) =>
        data?.some(
          (job) =>
            job.status === MMarketExportJobStatus.QUEUED ||
            job.status === MMarketExportJobStatus.RUNNING,
        )
          ? 5_000
          : false,
    },
  );
  const preflightQuery = trpc.mMarket.preflight.useQuery(undefined, {
    enabled: false,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const revealTokenQuery = trpc.mMarket.revealToken.useQuery(undefined, {
    enabled: canEdit && Boolean(settingsQuery.data?.integration.hasToken),
    refetchOnWindowFocus: false,
    retry: false,
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const saveConnectionMutation = trpc.mMarket.saveConnection.useMutation({
    onSuccess: async (_result, variables) => {
      setPreflightFresh(false);
      if (variables.clearToken) {
        setApiToken("");
      }
      await Promise.all([settingsQuery.refetch(), jobsQuery.refetch(), revealTokenQuery.refetch()]);
      toast({ variant: "success", description: t("connection.saved") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const saveMappingsMutation = trpc.mMarket.saveBranchMappings.useMutation({
    onSuccess: async () => {
      setPreflightFresh(false);
      await settingsQuery.refetch();
      toast({ variant: "success", description: t("branches.saved") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const validateLocalMutation = trpc.mMarket.validateLocal.useMutation({
    onSuccess: (result) => {
      const missingMappings = Math.max(0, result.totalStores - result.mappedStores);
      const hasMissingMappings = missingMappings > 0;
      const hasToken = result.hasToken;
      let description = t("connection.validateReady");
      if (!result.ready) {
        if (!hasToken && hasMissingMappings) {
          description = t("connection.validateMissingTokenAndMappings", { count: missingMappings });
        } else if (!hasToken) {
          description = t("connection.validateMissingToken");
        } else if (hasMissingMappings) {
          description = t("connection.validateMissingMappings", { count: missingMappings });
        } else {
          description = t("connection.validateNotReady");
        }
      }
      toast({
        variant: result.ready ? "success" : "info",
        description,
      });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const exportMutation = trpc.mMarket.exportNow.useMutation({
    onSuccess: async (result) => {
      if (result.job.status === "RATE_LIMITED") {
        setCooldownRemainingSeconds(result.remainingSeconds);
        toast({ variant: "info", description: t("export.rateLimited") });
      } else {
        toast({ variant: "success", description: t("export.started") });
      }
      await Promise.all([settingsQuery.refetch(), jobsQuery.refetch()]);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const bulkGenerateDescriptionsMutation = trpc.mMarket.bulkGenerateDescriptions.useMutation();
  const bulkAutofillSpecsMutation = trpc.mMarket.bulkAutofillSpecs.useMutation();
  const bulkCreateBaseTemplatesMutation = trpc.mMarket.bulkCreateBaseTemplates.useMutation({
    onSuccess: async (result) => {
      await preflightQuery.refetch();
      if (result.targetedCount === 0) {
        toast({ variant: "info", description: t("preflight.createBaseTemplatesNothingToDo") });
        return;
      }
      toast({
        variant: "success",
        description: t("preflight.createBaseTemplatesSuccess", {
          categories: result.createdCategoryCount,
          createdAttributes: result.createdAttributeCount,
          reactivatedAttributes: result.reactivatedAttributeCount,
        }),
      });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const assignMissingCategoryMutation = trpc.mMarket.assignMissingCategory.useMutation({
    onSuccess: async (result) => {
      await Promise.all([preflightQuery.refetch(), productsQuery.refetch()]);
      if (result.targetedCount === 0) {
        toast({ variant: "info", description: t("preflight.assignMissingCategoryNothingToDo") });
        return;
      }
      toast({
        variant: "success",
        description: t("preflight.assignMissingCategorySuccess", {
          count: result.updatedCount,
          category: result.category,
        }),
      });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const [environment, setEnvironment] = useState<MMarketEnvironment>(MMarketEnvironment.DEV);
  const [apiToken, setApiToken] = useState("");
  const [showApiToken, setShowApiToken] = useState(false);
  const [branchMappings, setBranchMappings] = useState<Record<string, string>>({});
  const [preflightFresh, setPreflightFresh] = useState(false);
  const [filterSku, setFilterSku] = useState("");
  const [filterIssue, setFilterIssue] = useState<string>("ALL");
  const [cooldownRemainingSeconds, setCooldownRemainingSeconds] = useState(0);
  const [productSearch, setProductSearch] = useState("");
  const [productSelectionFilter, setProductSelectionFilter] = useState<
    "all" | "included" | "excluded"
  >("all");
  const [productsPage, setProductsPage] = useState(1);
  const [productsPageSize, setProductsPageSize] = useState(10);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [selectingAllProducts, setSelectingAllProducts] = useState(false);
  const hasActiveExportJob =
    jobsQuery.data?.some(
      (job) =>
        job.status === MMarketExportJobStatus.QUEUED ||
        job.status === MMarketExportJobStatus.RUNNING,
    ) ?? false;

  const productsQuery = trpc.mMarket.products.useQuery(
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
  const updateProductsMutation = trpc.mMarket.updateProducts.useMutation({
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

  useEffect(() => {
    const integration = settingsQuery.data?.integration;
    if (!integration) {
      return;
    }
    setEnvironment(integration.environment);
  }, [settingsQuery.data?.integration]);

  useEffect(() => {
    if (!canEdit) {
      return;
    }
    if (!settingsQuery.data?.integration.hasToken) {
      setApiToken("");
      return;
    }
    const token = revealTokenQuery.data?.apiToken;
    if (typeof token === "string") {
      setApiToken(token);
    }
  }, [canEdit, revealTokenQuery.data?.apiToken, settingsQuery.data?.integration.hasToken]);

  useEffect(() => {
    if (!settingsQuery.data?.stores) {
      return;
    }
    const nextMappings: Record<string, string> = {};
    for (const row of settingsQuery.data.stores) {
      nextMappings[row.storeId] = row.mmarketBranchId;
    }
    setBranchMappings(nextMappings);
  }, [settingsQuery.data?.stores]);

  useEffect(() => {
    const initial = settingsQuery.data?.cooldown.remainingSeconds ?? 0;
    setCooldownRemainingSeconds(initial);
  }, [settingsQuery.data?.cooldown.remainingSeconds]);

  useEffect(() => {
    if (cooldownRemainingSeconds <= 0) {
      return;
    }
    const timer = setInterval(() => {
      setCooldownRemainingSeconds((prev) => Math.max(0, prev - 1));
    }, 1_000);
    return () => clearInterval(timer);
  }, [cooldownRemainingSeconds]);

  useEffect(() => {
    if (!bulkProgress) {
      setBulkElapsedSeconds(0);
      return;
    }
    setBulkElapsedSeconds(Math.max(0, Math.floor((Date.now() - bulkProgress.startedAt) / 1000)));
    if (bulkProgress.status !== "running") {
      return;
    }
    const timer = window.setInterval(() => {
      setBulkElapsedSeconds(Math.max(0, Math.floor((Date.now() - bulkProgress.startedAt) / 1000)));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [bulkProgress]);

  useEffect(() => {
    setProductsPage(1);
  }, [productSearch, productSelectionFilter]);

  const handleRunPreflight = async () => {
    const result = await preflightQuery.refetch();
    if (result.data) {
      setPreflightFresh(true);
    }
  };

  const handleGenerateShortDescriptions = async () => {
    if (!isAdmin || shortDescriptionTargetIds.length <= 0 || bulkProgressRunning) {
      return;
    }
    if (
      !(await confirm({
        description: t("preflight.confirmGenerateDescriptions", {
          count: shortDescriptionTargetIds.length,
        }),
      }))
    ) {
      return;
    }
    const batches = Array.from(
      { length: Math.ceil(shortDescriptionTargetIds.length / mMarketBulkProgressBatchSize) },
      (_value, index) =>
        shortDescriptionTargetIds.slice(
          index * mMarketBulkProgressBatchSize,
          (index + 1) * mMarketBulkProgressBatchSize,
        ),
    ).filter((batch) => batch.length > 0);
    const summary = {
      processedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      deferredCount: 0,
    };

    setBulkProgress({
      kind: "descriptions",
      status: "running",
      totalCount: shortDescriptionTargetIds.length,
      processedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      deferredCount: 0,
      filledCount: 0,
      batchIndex: 0,
      batchCount: batches.length,
      startedAt: Date.now(),
      errorMessage: null,
    });

    try {
      for (const [batchIndex, batch] of batches.entries()) {
        setBulkProgress((current) =>
          current
            ? {
                ...current,
                batchIndex: batchIndex + 1,
              }
            : current,
        );

        const result = await bulkGenerateDescriptionsMutation.mutateAsync({
          locale: locale === "kg" ? "kg" : "ru",
          productIds: batch,
        });
        const handledInBatch = result.updatedCount + result.skippedCount + result.failedCount;
        const remainingAfterBatch = Math.max(
          0,
          shortDescriptionTargetIds.length - (batchIndex + 1) * mMarketBulkProgressBatchSize,
        );

        summary.processedCount += handledInBatch;
        summary.updatedCount += result.updatedCount;
        summary.skippedCount += result.skippedCount;
        summary.failedCount += result.failedCount;

        if (result.rateLimited) {
          summary.deferredCount += result.deferredCount + remainingAfterBatch;
          setBulkProgress((current) =>
            current
              ? {
                  ...current,
                  status: "rateLimited",
                  processedCount: summary.processedCount,
                  updatedCount: summary.updatedCount,
                  skippedCount: summary.skippedCount,
                  failedCount: summary.failedCount,
                  deferredCount: summary.deferredCount,
                  batchIndex: batchIndex + 1,
                }
              : current,
          );
          await preflightQuery.refetch();
          toast({
            variant: "info",
            description: tProducts("bulkGenerateDescriptionsRateLimited", {
              updated: summary.updatedCount,
              skipped: summary.skippedCount,
              failed: summary.failedCount,
              deferred: summary.deferredCount,
            }),
          });
          return;
        }

        setBulkProgress((current) =>
          current
            ? {
                ...current,
                processedCount: summary.processedCount,
                updatedCount: summary.updatedCount,
                skippedCount: summary.skippedCount,
                failedCount: summary.failedCount,
                deferredCount: 0,
                batchIndex: batchIndex + 1,
              }
            : current,
        );
      }

      setBulkProgress((current) =>
        current
          ? {
              ...current,
              status: "done",
              processedCount: summary.processedCount,
              updatedCount: summary.updatedCount,
              skippedCount: summary.skippedCount,
              failedCount: summary.failedCount,
              deferredCount: 0,
              batchIndex: batches.length,
            }
          : current,
      );
      await preflightQuery.refetch();
      if (summary.processedCount === 0) {
        toast({ variant: "info", description: t("preflight.generateDescriptionsNothingToDo") });
        return;
      }
      toast({
        variant: summary.failedCount > 0 ? "info" : "success",
        description:
          summary.failedCount > 0
            ? tProducts("bulkGenerateDescriptionsPartial", {
                updated: summary.updatedCount,
                skipped: summary.skippedCount,
                failed: summary.failedCount,
              })
            : tProducts("bulkGenerateDescriptionsSuccess", {
                updated: summary.updatedCount,
                skipped: summary.skippedCount,
              }),
      });
    } catch (error) {
      await preflightQuery.refetch();
      const errorMessage = translateError(
        tErrors,
        error as Parameters<typeof translateError>[1],
      );
      setBulkProgress((current) =>
        current
          ? {
              ...current,
              status: "error",
              deferredCount: Math.max(0, current.totalCount - current.processedCount),
              errorMessage,
            }
          : current,
      );
      toast({ variant: "error", description: errorMessage });
    }
  };

  const handleAutofillSpecs = async () => {
    if (!isAdmin || actionableMissingSpecsTargetIds.length <= 0 || bulkProgressRunning) {
      return;
    }
    if (
      !(await confirm({
        description: t("preflight.confirmAutofillSpecs", {
          count: actionableMissingSpecsTargetIds.length,
        }),
      }))
    ) {
      return;
    }
    const batches = Array.from(
      { length: Math.ceil(actionableMissingSpecsTargetIds.length / mMarketBulkProgressBatchSize) },
      (_value, index) =>
        actionableMissingSpecsTargetIds.slice(
          index * mMarketBulkProgressBatchSize,
          (index + 1) * mMarketBulkProgressBatchSize,
        ),
    ).filter((batch) => batch.length > 0);
    const summary = {
      processedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      deferredCount: 0,
      filledCount: 0,
      skipReasonCounts: {
        noTemplate: 0,
        noSupportedFields: 0,
        noResolvedValues: 0,
        noCategory: 0,
      },
    };

    setBulkProgress({
      kind: "specs",
      status: "running",
      totalCount: actionableMissingSpecsTargetIds.length,
      processedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      deferredCount: 0,
      filledCount: 0,
      batchIndex: 0,
      batchCount: batches.length,
      startedAt: Date.now(),
      errorMessage: null,
    });

    try {
      for (const [batchIndex, batch] of batches.entries()) {
        setBulkProgress((current) =>
          current
            ? {
                ...current,
                batchIndex: batchIndex + 1,
              }
            : current,
        );

        const result = await bulkAutofillSpecsMutation.mutateAsync({
          productIds: batch,
        });
        const handledInBatch = result.updatedCount + result.skippedCount + result.failedCount;
        const remainingAfterBatch = Math.max(
          0,
          actionableMissingSpecsTargetIds.length -
            (batchIndex + 1) * mMarketBulkProgressBatchSize,
        );

        summary.processedCount += handledInBatch;
        summary.updatedCount += result.updatedCount;
        summary.skippedCount += result.skippedCount;
        summary.failedCount += result.failedCount;
        summary.filledCount += result.filledValueCount;
        summary.skipReasonCounts.noTemplate += result.skipReasonCounts.noTemplate;
        summary.skipReasonCounts.noSupportedFields += result.skipReasonCounts.noSupportedFields;
        summary.skipReasonCounts.noResolvedValues += result.skipReasonCounts.noResolvedValues;
        summary.skipReasonCounts.noCategory += result.skipReasonCounts.noCategory;

        if (result.rateLimited) {
          summary.deferredCount += result.deferredCount + remainingAfterBatch;
          setBulkProgress((current) =>
            current
              ? {
                  ...current,
                  status: "rateLimited",
                  processedCount: summary.processedCount,
                  updatedCount: summary.updatedCount,
                  skippedCount: summary.skippedCount,
                  failedCount: summary.failedCount,
                  deferredCount: summary.deferredCount,
                  filledCount: summary.filledCount,
                  batchIndex: batchIndex + 1,
                }
              : current,
          );
          await preflightQuery.refetch();
          toast({
            variant: "info",
            description: t("preflight.autofillSpecsRateLimited", {
              updated: summary.updatedCount,
              filled: summary.filledCount,
              skipped: summary.skippedCount,
              failed: summary.failedCount,
              deferred: summary.deferredCount,
            }),
          });
          return;
        }

        setBulkProgress((current) =>
          current
            ? {
                ...current,
                processedCount: summary.processedCount,
                updatedCount: summary.updatedCount,
                skippedCount: summary.skippedCount,
                failedCount: summary.failedCount,
                deferredCount: 0,
                filledCount: summary.filledCount,
                batchIndex: batchIndex + 1,
              }
            : current,
        );
      }

      setBulkProgress((current) =>
        current
          ? {
              ...current,
              status: "done",
              processedCount: summary.processedCount,
              updatedCount: summary.updatedCount,
              skippedCount: summary.skippedCount,
              failedCount: summary.failedCount,
              deferredCount: 0,
              filledCount: summary.filledCount,
              batchIndex: batches.length,
            }
          : current,
      );
      await preflightQuery.refetch();
      if (summary.processedCount === 0) {
        toast({ variant: "info", description: t("preflight.autofillSpecsNothingToDo") });
        return;
      }
      if (
        summary.updatedCount === 0 &&
        summary.skippedCount > 0 &&
        summary.failedCount === 0 &&
        summary.deferredCount === 0
      ) {
        toast({
          variant: "info",
          description: t("preflight.autofillSpecsSkippedOnly", {
            noTemplate: summary.skipReasonCounts.noTemplate,
            noSupportedFields: summary.skipReasonCounts.noSupportedFields,
            noResolvedValues: summary.skipReasonCounts.noResolvedValues,
            noCategory: summary.skipReasonCounts.noCategory,
          }),
        });
        return;
      }
      toast({
        variant: summary.failedCount > 0 ? "info" : "success",
        description:
          summary.failedCount > 0
            ? t("preflight.autofillSpecsPartial", {
                updated: summary.updatedCount,
                filled: summary.filledCount,
                skipped: summary.skippedCount,
                failed: summary.failedCount,
              })
            : t("preflight.autofillSpecsSuccess", {
                updated: summary.updatedCount,
                filled: summary.filledCount,
                skipped: summary.skippedCount,
              }),
      });
    } catch (error) {
      await preflightQuery.refetch();
      const errorMessage = translateError(
        tErrors,
        error as Parameters<typeof translateError>[1],
      );
      setBulkProgress((current) =>
        current
          ? {
              ...current,
              status: "error",
              deferredCount: Math.max(0, current.totalCount - current.processedCount),
              errorMessage,
            }
          : current,
      );
      toast({ variant: "error", description: errorMessage });
    }
  };

  const handleCreateBaseTemplates = async () => {
    if (!isAdmin || actionableMissingSpecsCount <= 0) {
      return;
    }
    if (
      !(await confirm({
        description: t("preflight.confirmCreateBaseTemplates"),
      }))
    ) {
      return;
    }
    bulkCreateBaseTemplatesMutation.mutate();
  };

  const handleAssignMissingCategory = async () => {
    if (!isAdmin || missingCategoryCount <= 0) {
      return;
    }
    if (
      !(await confirm({
        description: t("preflight.confirmAssignMissingCategory", {
          count: missingCategoryCount,
          category: "Без категории",
        }),
      }))
    ) {
      return;
    }
    assignMissingCategoryMutation.mutate();
  };

  const handleSaveConnection = () => {
    if (!canEdit) {
      return;
    }
    saveConnectionMutation.mutate({
      environment,
      apiToken: apiToken.trim().length ? apiToken.trim() : undefined,
    });
  };

  const handleClearToken = () => {
    if (!canEdit) {
      return;
    }
    setShowApiToken(false);
    saveConnectionMutation.mutate({
      environment,
      clearToken: true,
    });
  };

  const handleCopyToken = async () => {
    const normalized = apiToken.trim();
    if (!normalized.length) {
      toast({ variant: "info", description: t("connection.copyEmpty") });
      return;
    }
    try {
      await navigator.clipboard.writeText(normalized);
      toast({ variant: "success", description: t("connection.copySuccess") });
    } catch {
      toast({ variant: "error", description: t("connection.copyFailed") });
    }
  };

  const handleSaveMappings = () => {
    if (!canEdit || !settingsQuery.data?.stores) {
      return;
    }
    saveMappingsMutation.mutate({
      mappings: settingsQuery.data.stores.map((store) => ({
        storeId: store.storeId,
        mmarketBranchId: branchMappings[store.storeId] ?? "",
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
      const ids = await trpcUtils.mMarket.listIds.fetch({
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
  const preflightCanExport = preflightFresh && Boolean(preflightData?.canExport);
  const missingCategoryCount = preflightData?.blockers.byCode.MISSING_CATEGORY ?? 0;
  const shortDescriptionTargetIds = useMemo(
    () =>
      Array.from(
        new Set(
          (preflightData?.failedProducts ?? [])
            .filter((row) => row.issues.includes("SHORT_DESCRIPTION"))
            .map((row) => row.productId),
        ),
      ),
    [preflightData?.failedProducts],
  );
  const actionableMissingSpecsTargetIds = useMemo(
    () =>
      Array.from(
        new Set(
          (preflightData?.failedProducts ?? [])
            .filter(
              (row) =>
                row.issues.includes("MISSING_SPECS") && !row.issues.includes("MISSING_CATEGORY"),
            )
            .map((row) => row.productId),
        ),
      ),
    [preflightData?.failedProducts],
  );
  const shortDescriptionCount = shortDescriptionTargetIds.length;
  const actionableMissingSpecsCount = actionableMissingSpecsTargetIds.length;
  const effectiveCooldownSeconds = Math.max(
    cooldownRemainingSeconds,
    preflightData?.cooldown.remainingSeconds ?? 0,
  );
  const bulkProgressPercent = bulkProgress
    ? Math.round((bulkProgress.processedCount / Math.max(1, bulkProgress.totalCount)) * 100)
    : 0;
  const bulkProgressRunning = bulkProgress?.status === "running";
  const bulkProgressTitle = bulkProgress
    ? bulkProgress.kind === "specs"
      ? t("preflight.autofillSpecsProgressTitle")
      : tProducts("bulkGenerateDescriptionsProgressTitle")
    : "";
  const bulkProgressSubtitle = bulkProgress
    ? bulkProgress.kind === "specs"
      ? bulkProgress.status === "running"
        ? t("preflight.autofillSpecsProgressRunning")
        : bulkProgress.status === "rateLimited"
          ? t("preflight.autofillSpecsProgressRateLimited")
          : bulkProgress.status === "error"
            ? t("preflight.autofillSpecsProgressError")
            : bulkProgress.failedCount > 0
              ? t("preflight.autofillSpecsProgressPartial")
              : t("preflight.autofillSpecsProgressDone")
      : bulkProgress.status === "running"
        ? tProducts("bulkGenerateDescriptionsProgressRunning")
        : bulkProgress.status === "rateLimited"
          ? tProducts("bulkGenerateDescriptionsProgressRateLimited")
          : bulkProgress.status === "error"
            ? tProducts("bulkGenerateDescriptionsProgressError")
            : bulkProgress.failedCount > 0
              ? tProducts("bulkGenerateDescriptionsProgressPartial")
              : tProducts("bulkGenerateDescriptionsProgressDone")
    : undefined;
  const productItems = productsQuery.data?.items ?? [];
  const productSummary = productsQuery.data?.summary;
  const allProductsSelectedOnPage =
    productItems.length > 0 && productItems.every((product) => selectedProductIds.has(product.id));
  const allProductResultsSelected =
    (productsQuery.data?.total ?? 0) > 0 &&
    selectedProductIds.size === (productsQuery.data?.total ?? 0);

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
  }, [preflightData?.failedProducts, filterIssue, filterSku]);

  const exportDisabledReason =
    !preflightFresh || !preflightData
      ? t("export.disabledNeedPreflight")
      : !preflightData.canExport
        ? t("export.disabledFailed")
        : effectiveCooldownSeconds > 0
          ? t("export.disabledCooldown", { countdown: formatCountdown(effectiveCooldownSeconds) })
          : "";

  if (!canView) {
    return null;
  }

  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <IntegrationsIcon className="h-5 w-5 text-primary" aria-hidden />
            {t("connection.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormGrid>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{t("connection.environment")}</p>
              <Select
                value={environment}
                onValueChange={(value) => setEnvironment(value as MMarketEnvironment)}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={MMarketEnvironment.DEV}>{t("connection.envDev")}</SelectItem>
                  <SelectItem value={MMarketEnvironment.PROD}>{t("connection.envProd")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{t("connection.token")}</p>
              <div className="flex items-center gap-2">
                <Input
                  type={showApiToken ? "text" : "password"}
                  value={apiToken}
                  onChange={(event) => setApiToken(event.target.value)}
                  placeholder={
                    settingsQuery.data?.integration.hasToken
                      ? t("connection.tokenMasked")
                      : t("connection.tokenPlaceholder")
                  }
                  disabled={!canEdit}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowApiToken((prev) => !prev)}
                  disabled={!canEdit || !apiToken.length}
                  aria-label={showApiToken ? t("connection.hideToken") : t("connection.showToken")}
                >
                  {showApiToken ? (
                    <HideIcon className="h-4 w-4" aria-hidden />
                  ) : (
                    <ViewIcon className="h-4 w-4" aria-hidden />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleCopyToken}
                  disabled={!canEdit || !apiToken.trim().length}
                  aria-label={t("connection.copyToken")}
                >
                  <CopyIcon className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={settingsQuery.data?.integration.hasToken ? "success" : "muted"}>
                  {settingsQuery.data?.integration.hasToken
                    ? t("connection.tokenSaved")
                    : t("connection.tokenMissing")}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{t("connection.tokenRevealHint")}</p>
            </div>
          </FormGrid>

          <p className="text-xs text-muted-foreground">
            {t("connection.endpoint", {
              endpoint: settingsQuery.data?.integration.environment
                ? settingsQuery.data.endpoints[settingsQuery.data.integration.environment]
                : (settingsQuery.data?.endpoints[MMarketEnvironment.DEV] ?? ""),
            })}
          </p>

          {!canEdit ? <p className="text-xs text-muted-foreground">{t("readOnlyHint")}</p> : null}

          <FormActions className="justify-start">
            <Button
              type="button"
              onClick={handleSaveConnection}
              disabled={!canEdit || saveConnectionMutation.isLoading}
            >
              {saveConnectionMutation.isLoading ? tCommon("loading") : t("connection.save")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => validateLocalMutation.mutate()}
              disabled={!canEdit || validateLocalMutation.isLoading}
            >
              {validateLocalMutation.isLoading ? tCommon("loading") : t("connection.validateLocal")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleClearToken}
              disabled={
                !canEdit ||
                !settingsQuery.data?.integration.hasToken ||
                saveConnectionMutation.isLoading
              }
            >
              {t("connection.clearToken")}
            </Button>
          </FormActions>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("branches.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("branches.subtitle")}</p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("branches.columns.store")}</TableHead>
                  <TableHead>{t("branches.columns.branch")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(settingsQuery.data?.stores ?? []).map((row) => (
                  <TableRow key={row.storeId}>
                    <TableCell className="font-medium">{row.storeName}</TableCell>
                    <TableCell>
                      <Input
                        value={branchMappings[row.storeId] ?? ""}
                        onChange={(event) =>
                          setBranchMappings((prev) => ({
                            ...prev,
                            [row.storeId]: event.target.value,
                          }))
                        }
                        placeholder={t("branches.branchPlaceholder")}
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
              onClick={handleSaveMappings}
              disabled={!canEdit || saveMappingsMutation.isLoading}
            >
              {saveMappingsMutation.isLoading ? tCommon("loading") : t("branches.save")}
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

          {canEdit && productItems.length ? (
            <div className="mb-3 sm:hidden">
              <div className="flex flex-wrap items-center gap-2">
                {productsQuery.data &&
                productsQuery.data.total > productItems.length &&
                !allProductResultsSelected ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={() => void handleSelectAllProductResults()}
                    disabled={selectingAllProducts}
                  >
                    {selectingAllProducts ? <Spinner className="h-4 w-4" /> : null}
                    {selectingAllProducts
                      ? tCommon("loading")
                      : tCommon("selectAllResults", { count: productsQuery.data.total })}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

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
                                className="h-4 w-4 rounded border-border bg-background text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
                          <TableHead>{t("productsSelection.columns.exportPrice")}</TableHead>
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
                                  className="h-4 w-4 rounded border-border bg-background text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
                              {product.exportPriceKgs === null
                                ? "-"
                                : formatCurrencyKGS(product.exportPriceKgs, locale)}
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
                    <div className="text-right">
                      <Badge variant={productStatusBadgeVariant(product.exportStatus)}>
                        {product.included
                          ? t("productsSelection.statusIncluded")
                          : t("productsSelection.statusExcluded")}
                      </Badge>
                      {product.lastExportedAt ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("productsSelection.lastExportedAt", {
                            date: formatDateTime(product.lastExportedAt, locale),
                          })}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                    <p>
                      {t("productsSelection.columns.category")}: {product.category ?? "-"}
                    </p>
                    <p>
                      {t("productsSelection.columns.exportPrice")}:{" "}
                      {product.exportPriceKgs === null
                        ? "-"
                        : formatCurrencyKGS(product.exportPriceKgs, locale)}
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
                          className="h-4 w-4 rounded border-border bg-background text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
          <p className="text-sm text-muted-foreground">{t("preflight.subtitle")}</p>

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
                    {(preflightData.blockers.byCode.MISSING_SPECS ?? 0) > 0 ? (
                      <p className="pt-1 text-xs">
                        <Link
                          href="/help#mMarketSpecsSetup"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          {t("preflight.specsHelpLink")}
                        </Link>
                      </p>
                    ) : null}
                  </div>
                )}

                {preflightData.blockers.missingStoreMappings.length ? (
                  <div className="mt-3 text-sm text-danger">
                    <p>{t("preflight.missingMappingsTitle")}</p>
                    {preflightData.blockers.missingStoreMappings.map((store) => (
                      <p key={store.storeId}>{store.storeName}</p>
                    ))}
                  </div>
                ) : null}

                {preflightData.warnings.global.length ? (
                  <div className="mt-3 text-sm text-warning">
                    {preflightData.warnings.global.map((warning) => (
                      <p key={warning}>{t(`warnings.${warning}`)}</p>
                    ))}
                  </div>
                ) : null}

                {isAdmin &&
                (actionableMissingSpecsCount > 0 ||
                  missingCategoryCount > 0 ||
                  shortDescriptionCount > 0) ? (
                  <FormActions className="mt-3 justify-start">
                    {missingCategoryCount > 0 ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void handleAssignMissingCategory()}
                        disabled={assignMissingCategoryMutation.isLoading}
                      >
                        {assignMissingCategoryMutation.isLoading ? (
                          <Spinner className="h-4 w-4" />
                        ) : null}
                        {t("preflight.assignMissingCategory")} ({missingCategoryCount})
                      </Button>
                    ) : null}

                    {actionableMissingSpecsCount > 0 ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void handleCreateBaseTemplates()}
                          disabled={bulkCreateBaseTemplatesMutation.isLoading}
                        >
                          {bulkCreateBaseTemplatesMutation.isLoading ? (
                            <Spinner className="h-4 w-4" />
                          ) : null}
                          {t("preflight.createBaseTemplates")}
                        </Button>
                        <Button
                          type="button"
                          onClick={() => void handleAutofillSpecs()}
                          disabled={bulkProgressRunning || bulkAutofillSpecsMutation.isLoading}
                        >
                          {bulkAutofillSpecsMutation.isLoading ? (
                            <Spinner className="h-4 w-4" />
                          ) : (
                            <SparklesIcon className="h-4 w-4" aria-hidden />
                          )}
                          {t("preflight.autofillSpecs")} ({actionableMissingSpecsCount})
                        </Button>
                      </>
                    ) : null}

                    {shortDescriptionCount > 0 ? (
                      <Button
                        type="button"
                        onClick={() => void handleGenerateShortDescriptions()}
                        disabled={bulkProgressRunning || bulkGenerateDescriptionsMutation.isLoading}
                      >
                        {bulkGenerateDescriptionsMutation.isLoading ? (
                          <Spinner className="h-4 w-4" />
                        ) : (
                          <SparklesIcon className="h-4 w-4" aria-hidden />
                        )}
                        {tProducts("bulkGenerateDescriptions")} ({shortDescriptionCount})
                      </Button>
                    ) : null}
                  </FormActions>
                ) : null}
              </div>

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
                        <TableRow key={`${row.sku}-${row.name}`}>
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
          <p className="text-sm text-muted-foreground">{t("export.ruleRate")}</p>
          <p className="text-sm text-muted-foreground">{t("export.ruleFullSync")}</p>

          {effectiveCooldownSeconds > 0 ? (
            <Badge variant="warning">
              {t("export.cooldown", { countdown: formatCountdown(effectiveCooldownSeconds) })}
            </Badge>
          ) : null}

          <FormActions className="justify-start">
            <Button
              type="button"
              onClick={() => exportMutation.mutate()}
              disabled={
                !canEdit ||
                exportMutation.isLoading ||
                !preflightCanExport ||
                effectiveCooldownSeconds > 0
              }
              title={exportDisabledReason}
            >
              {exportMutation.isLoading ? tCommon("loading") : t("export.run")}
            </Button>
          </FormActions>

          {!preflightCanExport ? (
            <p className="text-xs text-muted-foreground">{exportDisabledReason}</p>
          ) : null}

          <div>
            <p className="mb-2 text-sm font-medium text-foreground">{t("history.title")}</p>
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
                      <TableHead>{t("history.columns.status")}</TableHead>
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

                      return (
                        <TableRow key={job.id}>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDateTime(job.createdAt, locale)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusBadgeVariant(job.status)}>
                              {t(`history.status.${job.status}`)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {t("history.summary", { products: productCount })}
                          </TableCell>
                          <TableCell>
                            {job.errorReportJson ? (
                              <a
                                className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                                href={`/api/m-market/jobs/${job.id}/error-report`}
                              >
                                {t("history.downloadError")}
                              </a>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {t("history.noError")}
                              </span>
                            )}
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
          </div>
        </CardContent>
      </Card>

      <Modal
        open={Boolean(bulkProgress)}
        onOpenChange={(open) => {
          if (!open && !bulkProgressRunning) {
            setBulkProgress(null);
          }
        }}
        title={bulkProgressTitle}
        subtitle={bulkProgressSubtitle}
      >
        {bulkProgress ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex items-center justify-between gap-3 text-sm">
                <p className="font-medium text-foreground">
                  {tProducts("bulkGenerateDescriptionsProgressLabel", {
                    processed: bulkProgress.processedCount,
                    total: bulkProgress.totalCount,
                  })}
                </p>
                <span className="text-sm font-semibold text-foreground">
                  {bulkProgressPercent}%
                </span>
              </div>
              <div className="mt-3 h-2 rounded-full bg-border/70">
                <div
                  className="h-2 rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${bulkProgressPercent}%` }}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>
                  {tProducts("bulkGenerateDescriptionsProgressBatch", {
                    current:
                      bulkProgress.batchCount > 0
                        ? Math.min(
                            bulkProgress.batchCount,
                            Math.max(1, bulkProgress.batchIndex),
                          )
                        : 0,
                    total: bulkProgress.batchCount,
                  })}
                </span>
                <span>
                  {tProducts("bulkGenerateDescriptionsProgressElapsed", {
                    seconds: bulkElapsedSeconds,
                  })}
                </span>
              </div>
            </div>

            <div
              className={
                bulkProgress.kind === "specs"
                  ? "grid grid-cols-2 gap-3 sm:grid-cols-5"
                  : "grid grid-cols-2 gap-3 sm:grid-cols-4"
              }
            >
              <div className="rounded-lg border border-border bg-card p-3">
                <p className="text-xs text-muted-foreground">
                  {tProducts("bulkGenerateDescriptionsProgressUpdated")}
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {bulkProgress.updatedCount}
                </p>
              </div>
              {bulkProgress.kind === "specs" ? (
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="text-xs text-muted-foreground">
                    {t("preflight.bulkProgressFilled")}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-foreground">
                    {bulkProgress.filledCount}
                  </p>
                </div>
              ) : null}
              <div className="rounded-lg border border-border bg-card p-3">
                <p className="text-xs text-muted-foreground">
                  {tProducts("bulkGenerateDescriptionsProgressSkipped")}
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {bulkProgress.skippedCount}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <p className="text-xs text-muted-foreground">
                  {tProducts("bulkGenerateDescriptionsProgressFailed")}
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {bulkProgress.failedCount}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <p className="text-xs text-muted-foreground">
                  {tProducts("bulkGenerateDescriptionsProgressDeferred")}
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {bulkProgress.deferredCount}
                </p>
              </div>
            </div>

            {bulkProgress.errorMessage ? (
              <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
                {bulkProgress.errorMessage}
              </div>
            ) : null}

            {!bulkProgressRunning ? (
              <FormActions>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full sm:w-auto"
                  onClick={() => setBulkProgress(null)}
                >
                  {tCommon("close")}
                </Button>
              </FormActions>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {confirmDialog}
    </div>
  );
};

export default MMarketSettingsPage;

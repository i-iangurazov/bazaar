"use client";

import { useMemo, useState } from "react";
import type { ExportJobStatus, ExportType } from "@prisma/client";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";

import { PageHeader } from "@/components/page-header";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  CopyIcon,
  DownloadIcon,
  ReportsIcon,
  RestoreIcon,
  SpreadsheetIcon,
  StatusDangerIcon,
  StatusPendingIcon,
  StatusSuccessIcon,
  StatusWarningIcon,
} from "@/components/icons";
import { RowActions } from "@/components/row-actions";
import { useToast } from "@/components/ui/toast";
import { Field, FormActions, FormGrid } from "@/components/form-layout";
import { formatDate, formatDateTime } from "@/lib/i18nFormat";
import {
  EXPORT_TYPE_CATEGORIES,
  EXPORT_TYPE_METADATA,
  EXPORT_TYPES,
  type ExportTypeCategory,
} from "@/lib/export-types";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const formatDateInput = (value: Date) => value.toISOString().slice(0, 10);
type ExportFileFormat = "csv" | "xlsx";
type CategoryFilter = ExportTypeCategory | "all";

const statusBadgeVariant = (status: ExportJobStatus) => {
  if (status === "DONE") {
    return "success";
  }
  if (status === "FAILED") {
    return "danger";
  }
  if (status === "RUNNING") {
    return "warning";
  }
  return "muted";
};

const statusIcon = (status: ExportJobStatus) => {
  if (status === "DONE") {
    return StatusSuccessIcon;
  }
  if (status === "FAILED") {
    return StatusDangerIcon;
  }
  if (status === "RUNNING") {
    return StatusWarningIcon;
  }
  return StatusPendingIcon;
};

const formatFileSize = (value?: number | null) => {
  if (!value) {
    return "";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${Math.round(value / 102.4) / 10} KB`;
  }
  return `${Math.round(value / 1024 / 102.4) / 10} MB`;
};

const ExportsPage = () => {
  const t = useTranslations("exports");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session, status } = useSession();
  const canGenerate = session?.user?.role && session.user.role !== "STAFF";
  const { toast } = useToast();

  const storesQuery = trpc.stores.list.useQuery(undefined, { enabled: status === "authenticated" });
  const [storeId, setStoreId] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [exportType, setExportType] = useState<ExportType>("INVENTORY_MOVEMENTS_LEDGER");
  const [format, setFormat] = useState<ExportFileFormat>("csv");

  const now = useMemo(() => new Date(), []);
  const [periodStart, setPeriodStart] = useState(
    formatDateInput(new Date(now.getFullYear(), now.getMonth(), 1)),
  );
  const [periodEnd, setPeriodEnd] = useState(formatDateInput(now));

  const jobsQuery = trpc.exports.list.useQuery(
    { storeId: storeId || undefined, limit: 100 },
    { enabled: status === "authenticated" },
  );

  const createMutation = trpc.exports.create.useMutation({
    onSuccess: () => {
      toast({ variant: "success", description: t("created") });
      jobsQuery.refetch();
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const retryMutation = trpc.exports.retry.useMutation({
    onSuccess: () => {
      toast({ variant: "success", description: t("retrySuccess") });
      jobsQuery.refetch();
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const storeOptions = storesQuery.data ?? [];
  const selectedMetadata = EXPORT_TYPE_METADATA[exportType];
  const typeLabels = useMemo(
    () =>
      Object.fromEntries(
        EXPORT_TYPES.map((type) => [
          type,
          t(`types.${EXPORT_TYPE_METADATA[type].titleKey}`),
        ]),
      ) as Record<ExportType, string>,
    [t],
  );
  const typeDescriptions = useMemo(
    () =>
      Object.fromEntries(
        EXPORT_TYPES.map((type) => [
          type,
          t(`typeDescriptions.${EXPORT_TYPE_METADATA[type].descriptionKey}`),
        ]),
      ) as Record<ExportType, string>,
    [t],
  );
  const filteredTypes = EXPORT_TYPES.filter(
    (type) => categoryFilter === "all" || EXPORT_TYPE_METADATA[type].category === categoryFilter,
  );

  const jobStats = useMemo(() => {
    const jobs = jobsQuery.data ?? [];
    return {
      total: jobs.length,
      done: jobs.filter((job) => job.status === "DONE").length,
      running: jobs.filter((job) => job.status === "RUNNING" || job.status === "QUEUED").length,
      failed: jobs.filter((job) => job.status === "FAILED").length,
    };
  }, [jobsQuery.data]);

  const selectExportType = (type: ExportType) => {
    setExportType(type);
    setFormat(EXPORT_TYPE_METADATA[type].recommendedFormat);
  };

  const handleGenerate = () => {
    if (!storeId) {
      toast({ variant: "error", description: tErrors("storeRequired") });
      return;
    }
    const start = new Date(`${periodStart}T00:00:00`);
    const end = new Date(`${periodEnd}T23:59:59`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      toast({ variant: "error", description: tErrors("invalidInput") });
      return;
    }
    createMutation.mutate({
      storeId,
      type: exportType,
      format,
      periodStart: start,
      periodEnd: end,
    });
  };

  const copyText = async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ variant: "success", description: successMessage });
    } catch {
      toast({ variant: "error", description: tErrors("copyFailed") });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="grid gap-3 md:grid-cols-4">
        <Card variant="subtle">
          <CardContent className="flex items-center gap-3">
            <span className="rounded-xl bg-primary/10 p-2 text-primary">
              <ReportsIcon className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                {t("summary.availableTypes")}
              </p>
              <p className="text-2xl font-bold text-foreground">{EXPORT_TYPES.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card variant="subtle">
          <CardContent>
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              {t("summary.ready")}
            </p>
            <p className="mt-1 text-2xl font-bold text-success">{jobStats.done}</p>
          </CardContent>
        </Card>
        <Card variant="subtle">
          <CardContent>
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              {t("summary.inProgress")}
            </p>
            <p className="mt-1 text-2xl font-bold text-warning">{jobStats.running}</p>
          </CardContent>
        </Card>
        <Card variant="subtle">
          <CardContent>
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              {t("summary.failed")}
            </p>
            <p className="mt-1 text-2xl font-bold text-danger">{jobStats.failed}</p>
          </CardContent>
        </Card>
      </div>

      {canGenerate ? (
        <Card className="overflow-hidden">
          <CardHeader className="bg-muted/35">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <CardTitle>{t("requestTitle")}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">{t("requestDescription")}</p>
              </div>
              <Badge variant="default" className="uppercase">
                {format}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormGrid className="lg:grid-cols-5">
              <Field label={t("storeLabel")}>
                <Select value={storeId} onValueChange={setStoreId}>
                  <SelectTrigger>
                    <SelectValue placeholder={tCommon("selectStore")} />
                  </SelectTrigger>
                  <SelectContent>
                    {storeOptions.map((store) => (
                      <SelectItem key={store.id} value={store.id}>
                        {store.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("typeLabel")} className="lg:col-span-2">
                <Select value={exportType} onValueChange={(value) => selectExportType(value as ExportType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPORT_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {typeLabels[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("formatLabel")}>
                <Select value={format} onValueChange={(value) => setFormat(value as ExportFileFormat)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="csv">{t("formats.csv")}</SelectItem>
                    <SelectItem value="xlsx">{t("formats.xlsx")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("periodStart")}>
                <Input
                  type="date"
                  value={periodStart}
                  onChange={(event) => setPeriodStart(event.target.value)}
                />
              </Field>
              <Field label={t("periodEnd")}>
                <Input
                  type="date"
                  value={periodEnd}
                  onChange={(event) => setPeriodEnd(event.target.value)}
                />
              </Field>
            </FormGrid>

            <Alert variant={selectedMetadata.periodRequired ? "info" : "default"}>
              <AlertTitle>{typeLabels[exportType]}</AlertTitle>
              <AlertDescription>{typeDescriptions[exportType]}</AlertDescription>
            </Alert>

            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={categoryFilter === "all" ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => setCategoryFilter("all")}
                  aria-pressed={categoryFilter === "all"}
                >
                  {t("categories.all")}
                </Button>
                {EXPORT_TYPE_CATEGORIES.map((category) => (
                  <Button
                    key={category}
                    type="button"
                    variant={categoryFilter === category ? "primary" : "secondary"}
                    size="sm"
                    onClick={() => setCategoryFilter(category)}
                    aria-pressed={categoryFilter === category}
                  >
                    {t(`categories.${category}`)}
                  </Button>
                ))}
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filteredTypes.map((type) => {
                  const metadata = EXPORT_TYPE_METADATA[type];
                  const isSelected = exportType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => selectExportType(type)}
                      className={cn(
                        "rounded-xl border bg-card p-4 text-left transition hover:border-primary/40 hover:bg-primary/5",
                        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2",
                        isSelected
                          ? "border-primary/60 bg-primary/10 shadow-sm"
                          : "border-border/70",
                      )}
                      aria-pressed={isSelected}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground">{typeLabels[type]}</p>
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                            {typeDescriptions[type]}
                          </p>
                        </div>
                        <Badge variant={isSelected ? "success" : "muted"}>
                          {metadata.recommendedFormat.toUpperCase()}
                        </Badge>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {!storeOptions.length && !storesQuery.isLoading ? (
              <Alert variant="warning">
                <AlertTitle>{t("noStoresTitle")}</AlertTitle>
                <AlertDescription>{t("noStoresDescription")}</AlertDescription>
              </Alert>
            ) : null}

            <FormActions>
              <Button
                type="button"
                onClick={handleGenerate}
                disabled={createMutation.isLoading || !storeId}
                data-tour="exports-generate"
              >
                <SpreadsheetIcon className="h-4 w-4" aria-hidden />
                {createMutation.isLoading ? tCommon("loading") : t("generate")}
              </Button>
            </FormActions>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="bg-muted/30">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{t("jobsTitle")}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{t("jobsDescription")}</p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => jobsQuery.refetch()}>
              {tCommon("tryAgain")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {jobsQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-14 w-full rounded-xl" />
              ))}
            </div>
          ) : jobsQuery.error ? (
            <Alert variant="destructive">
              <AlertTitle>{t("jobsErrorTitle")}</AlertTitle>
              <AlertDescription>{translateError(tErrors, jobsQuery.error)}</AlertDescription>
            </Alert>
          ) : jobsQuery.data?.length ? (
            <ResponsiveDataList
              items={jobsQuery.data}
              getKey={(job) => job.id}
              paginationKey="exports-jobs"
              empty={
                <EmptyState
                  icon={<SpreadsheetIcon className="h-9 w-9" aria-hidden />}
                  title={t("empty")}
                  description={t("emptyDescription")}
                />
              }
              renderDesktop={(visibleItems) => (
                <div className="overflow-x-auto rounded-xl border border-border/70">
                  <Table className="min-w-[860px]" data-tour="exports-jobs">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("columns.createdAt")}</TableHead>
                        <TableHead>{t("columns.type")}</TableHead>
                        <TableHead>{t("columns.period")}</TableHead>
                        <TableHead>{t("columns.file")}</TableHead>
                        <TableHead>{t("columns.status")}</TableHead>
                        <TableHead className="text-right">{t("columns.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleItems.map((job) => {
                        const StatusIcon = statusIcon(job.status);
                        const actions = [
                          {
                            key: "download",
                            label: tCommon("tooltips.download"),
                            icon: DownloadIcon,
                            href: `/api/exports/${job.id}`,
                            disabled: !job.storagePath || job.status !== "DONE",
                            variant: "primary",
                          },
                          ...(job.status === "FAILED"
                            ? [
                                {
                                  key: "retry",
                                  label: tCommon("tooltips.retry"),
                                  icon: RestoreIcon,
                                  onSelect: () => retryMutation.mutate({ jobId: job.id }),
                                  disabled: retryMutation.isLoading,
                                },
                              ]
                            : []),
                          {
                            key: "copy-job-id",
                            label: t("copyJobId"),
                            icon: CopyIcon,
                            onSelect: () => copyText(job.id, t("copiedJobId")),
                          },
                          ...(job.fileName
                            ? [
                                {
                                  key: "copy-file-name",
                                  label: t("copyFileName"),
                                  icon: CopyIcon,
                                  onSelect: () => copyText(job.fileName ?? "", t("copiedFileName")),
                                },
                              ]
                            : []),
                        ];

                        return (
                          <TableRow key={job.id} className="hover:bg-muted/35">
                            <TableCell className="text-xs text-muted-foreground">
                              {formatDateTime(job.createdAt, locale)}
                            </TableCell>
                            <TableCell className="font-medium">
                              <div className="max-w-[280px]">
                                <p className="truncate">{typeLabels[job.type] ?? job.type}</p>
                                <p className="mt-0.5 truncate text-xs font-normal text-muted-foreground">
                                  {job.id}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {formatDate(job.periodStart, locale)} — {formatDate(job.periodEnd, locale)}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {job.fileName ? (
                                <div className="max-w-[220px]">
                                  <p className="truncate text-foreground">{job.fileName}</p>
                                  <p>{formatFileSize(job.fileSize)}</p>
                                </div>
                              ) : (
                                <span>{t("filePending")}</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant={statusBadgeVariant(job.status)}>
                                <StatusIcon className="h-3.5 w-3.5" aria-hidden />
                                {t(`status.${job.status}`)}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-end">
                                <RowActions
                                  moreLabel={tCommon("tooltips.moreActions")}
                                  actions={actions}
                                />
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              renderMobile={(job) => {
                const StatusIcon = statusIcon(job.status);
                const actions = [
                  {
                    key: "download",
                    label: tCommon("tooltips.download"),
                    icon: DownloadIcon,
                    href: `/api/exports/${job.id}`,
                    disabled: !job.storagePath || job.status !== "DONE",
                    variant: "primary",
                  },
                  ...(job.status === "FAILED"
                    ? [
                        {
                          key: "retry",
                          label: tCommon("tooltips.retry"),
                          icon: RestoreIcon,
                          onSelect: () => retryMutation.mutate({ jobId: job.id }),
                          disabled: retryMutation.isLoading,
                        },
                      ]
                    : []),
                  {
                    key: "copy-job-id",
                    label: t("copyJobId"),
                    icon: CopyIcon,
                    onSelect: () => copyText(job.id, t("copiedJobId")),
                  },
                  ...(job.fileName
                    ? [
                        {
                          key: "copy-file-name",
                          label: t("copyFileName"),
                          icon: CopyIcon,
                          onSelect: () => copyText(job.fileName ?? "", t("copiedFileName")),
                        },
                      ]
                    : []),
                ];

                return (
                  <div className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {typeLabels[job.type] ?? job.type}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(job.createdAt, locale)}
                        </p>
                      </div>
                      <Badge variant={statusBadgeVariant(job.status)}>
                        <StatusIcon className="h-3.5 w-3.5" aria-hidden />
                        {t(`status.${job.status}`)}
                      </Badge>
                    </div>
                    <div className="mt-3 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                      <div>
                        {formatDate(job.periodStart, locale)} — {formatDate(job.periodEnd, locale)}
                      </div>
                      {job.fileName ? (
                        <div className="mt-1 truncate text-foreground">
                          {job.fileName} {formatFileSize(job.fileSize)}
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-3 flex items-center justify-end">
                      <RowActions
                        moreLabel={tCommon("tooltips.moreActions")}
                        actions={actions}
                      />
                    </div>
                  </div>
                );
              }}
            />
          ) : (
            <EmptyState
              icon={<SpreadsheetIcon className="h-9 w-9" aria-hidden />}
              title={t("empty")}
              description={t("emptyDescription")}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ExportsPage;

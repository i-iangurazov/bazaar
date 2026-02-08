"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { ExportType, ExportJobStatus } from "@prisma/client";

import { PageHeader } from "@/components/page-header";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { CopyIcon, DownloadIcon, RestoreIcon } from "@/components/icons";
import { RowActions } from "@/components/row-actions";
import { useToast } from "@/components/ui/toast";
import { Field, FormActions, FormGrid } from "@/components/form-layout";
import { formatDate, formatDateTime } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const formatDateInput = (value: Date) => value.toISOString().slice(0, 10);
type ExportFileFormat = "csv" | "xlsx";

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
  const [exportType, setExportType] = useState<ExportType>(ExportType.INVENTORY_MOVEMENTS_LEDGER);
  const [format, setFormat] = useState<ExportFileFormat>("csv");

  const now = useMemo(() => new Date(), []);
  const [periodStart, setPeriodStart] = useState(formatDateInput(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [periodEnd, setPeriodEnd] = useState(formatDateInput(now));

  const jobsQuery = trpc.exports.list.useQuery(
    { storeId: storeId || undefined },
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
  const typeLabels = useMemo(
    () => ({
      [ExportType.INVENTORY_MOVEMENTS_LEDGER]: t("types.inventoryMovementsLedger"),
      [ExportType.INVENTORY_BALANCES_AT_DATE]: t("types.inventoryBalancesAtDate"),
      [ExportType.PURCHASES_RECEIPTS]: t("types.purchasesReceipts"),
      [ExportType.PRICE_LIST]: t("types.priceList"),
      [ExportType.SALES_SUMMARY]: t("types.salesSummary"),
      [ExportType.STOCK_MOVEMENTS]: t("types.stockMovements"),
      [ExportType.PURCHASES]: t("types.purchases"),
      [ExportType.INVENTORY_ON_HAND]: t("types.inventoryOnHand"),
      [ExportType.PERIOD_CLOSE_REPORT]: t("types.periodClose"),
      [ExportType.RECEIPTS_FOR_KKM]: t("types.kkmReceipts"),
    }),
    [t],
  );

  const handleGenerate = () => {
    if (!storeId) {
      toast({ variant: "error", description: tErrors("storeRequired") });
      return;
    }
    const start = new Date(`${periodStart}T00:00:00`);
    const end = new Date(`${periodEnd}T23:59:59`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
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
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {canGenerate ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{t("requestTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormGrid>
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
              <Field label={t("typeLabel")}>
                <Select value={exportType} onValueChange={(value) => setExportType(value as ExportType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ExportType.INVENTORY_MOVEMENTS_LEDGER}>
                      {t("types.inventoryMovementsLedger")}
                    </SelectItem>
                    <SelectItem value={ExportType.INVENTORY_BALANCES_AT_DATE}>
                      {t("types.inventoryBalancesAtDate")}
                    </SelectItem>
                    <SelectItem value={ExportType.PURCHASES_RECEIPTS}>
                      {t("types.purchasesReceipts")}
                    </SelectItem>
                    <SelectItem value={ExportType.PRICE_LIST}>{t("types.priceList")}</SelectItem>
                    <SelectItem value={ExportType.SALES_SUMMARY}>{t("types.salesSummary")}</SelectItem>
                    <SelectItem value={ExportType.STOCK_MOVEMENTS}>{t("types.stockMovements")}</SelectItem>
                    <SelectItem value={ExportType.PURCHASES}>{t("types.purchases")}</SelectItem>
                    <SelectItem value={ExportType.INVENTORY_ON_HAND}>{t("types.inventoryOnHand")}</SelectItem>
                    <SelectItem value={ExportType.PERIOD_CLOSE_REPORT}>{t("types.periodClose")}</SelectItem>
                    <SelectItem value={ExportType.RECEIPTS_FOR_KKM}>{t("types.kkmReceipts")}</SelectItem>
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
                <Input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
              </Field>
              <Field label={t("periodEnd")}>
                <Input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
              </Field>
            </FormGrid>
            <FormActions>
              <Button type="button" onClick={handleGenerate} disabled={createMutation.isLoading}>
                {createMutation.isLoading ? tCommon("loading") : t("generate")}
              </Button>
            </FormActions>
          </CardContent>
        </Card>
      ) : null}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("jobsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {jobsQuery.isLoading ? (
            <p className="text-sm text-gray-500">{tCommon("loading")}</p>
          ) : jobsQuery.error ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-red-500">
              <span>{translateError(tErrors, jobsQuery.error)}</span>
              <Button type="button" variant="secondary" size="sm" onClick={() => jobsQuery.refetch()}>
                {tErrors("tryAgain")}
              </Button>
            </div>
          ) : jobsQuery.data?.length ? (
            <ResponsiveDataList
              items={jobsQuery.data}
              getKey={(job) => job.id}
              renderDesktop={(visibleItems) => (
                <div className="overflow-x-auto">
                  <Table className="min-w-[720px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("columns.createdAt")}</TableHead>
                        <TableHead>{t("columns.type")}</TableHead>
                        <TableHead>{t("columns.period")}</TableHead>
                        <TableHead>{t("columns.status")}</TableHead>
                        <TableHead>{t("columns.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleItems.map((job) => {
                        const actions = [
                          {
                            key: "download",
                            label: tCommon("tooltips.download"),
                            icon: DownloadIcon,
                            href: `/api/exports/${job.id}`,
                            disabled: !job.storagePath || job.status !== ExportJobStatus.DONE,
                          },
                          ...(job.status === ExportJobStatus.FAILED
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
                            label: tCommon("tooltips.copyLink"),
                            icon: CopyIcon,
                            onSelect: () => copyText(job.id, t("copiedJobId")),
                          },
                          ...(job.fileName
                            ? [
                                {
                                  key: "copy-file-name",
                                  label: tCommon("tooltips.copyLink"),
                                  icon: CopyIcon,
                                  onSelect: () => copyText(job.fileName ?? "", t("copiedFileName")),
                                },
                              ]
                            : []),
                        ];

                        return (
                          <TableRow key={job.id}>
                            <TableCell className="text-xs text-gray-500">
                              {formatDateTime(job.createdAt, locale)}
                            </TableCell>
                            <TableCell className="font-medium">
                              {typeLabels[job.type] ?? job.type}
                            </TableCell>
                            <TableCell className="text-xs text-gray-500">
                              {formatDate(job.periodStart, locale)} — {formatDate(job.periodEnd, locale)}
                            </TableCell>
                            <TableCell>
                              <Badge variant={job.status === ExportJobStatus.DONE ? "success" : "muted"}>
                                {t(`status.${job.status}`)}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <RowActions
                                moreLabel={tCommon("tooltips.moreActions")}
                                actions={actions}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              renderMobile={(job) => {
                const actions = [
                  {
                    key: "download",
                    label: tCommon("tooltips.download"),
                    icon: DownloadIcon,
                    href: `/api/exports/${job.id}`,
                    disabled: !job.storagePath || job.status !== ExportJobStatus.DONE,
                  },
                  ...(job.status === ExportJobStatus.FAILED
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
                    label: tCommon("tooltips.copyLink"),
                    icon: CopyIcon,
                    onSelect: () => copyText(job.id, t("copiedJobId")),
                  },
                  ...(job.fileName
                    ? [
                        {
                          key: "copy-file-name",
                          label: tCommon("tooltips.copyLink"),
                          icon: CopyIcon,
                          onSelect: () => copyText(job.fileName ?? "", t("copiedFileName")),
                        },
                      ]
                    : []),
                ];

                return (
                  <div className="rounded-md border border-gray-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">
                          {typeLabels[job.type] ?? job.type}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatDateTime(job.createdAt, locale)}
                        </p>
                      </div>
                      <Badge variant={job.status === ExportJobStatus.DONE ? "success" : "muted"}>
                        {t(`status.${job.status}`)}
                      </Badge>
                    </div>
                    <div className="mt-2 text-xs text-gray-500">
                      {formatDate(job.periodStart, locale)} — {formatDate(job.periodEnd, locale)}
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
            <p className="text-sm text-gray-500">{t("empty")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ExportsPage;

"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { ExportType, ExportJobStatus } from "@prisma/client";

import { PageHeader } from "@/components/page-header";
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
import { DownloadIcon, CopyIcon } from "@/components/icons";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatDateTime } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const formatDateInput = (value: Date) => value.toISOString().slice(0, 10);

const ExportsPage = () => {
  const t = useTranslations("exports");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session, status } = useSession();
  const canView = session?.user?.role && session.user.role !== "STAFF";
  const { toast } = useToast();

  const storesQuery = trpc.stores.list.useQuery(undefined, { enabled: status === "authenticated" });
  const [storeId, setStoreId] = useState("");
  const [exportType, setExportType] = useState<ExportType>(ExportType.STOCK_MOVEMENTS);

  const now = useMemo(() => new Date(), []);
  const [periodStart, setPeriodStart] = useState(formatDateInput(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [periodEnd, setPeriodEnd] = useState(formatDateInput(now));

  const jobsQuery = trpc.exports.list.useQuery(
    { storeId: storeId || undefined },
    { enabled: status === "authenticated" && Boolean(canView) },
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

  const storeOptions = storesQuery.data ?? [];
  const typeLabels = useMemo(
    () => ({
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

  if (status === "authenticated" && !canView) {
    return (
      <div>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <p className="mt-4 text-sm text-red-500">{tErrors("forbidden")}</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("requestTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs text-gray-500">{t("storeLabel")}</label>
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
            </div>
            <div>
              <label className="text-xs text-gray-500">{t("typeLabel")}</label>
              <Select value={exportType} onValueChange={(value) => setExportType(value as ExportType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ExportType.SALES_SUMMARY}>{t("types.salesSummary")}</SelectItem>
                  <SelectItem value={ExportType.STOCK_MOVEMENTS}>{t("types.stockMovements")}</SelectItem>
                  <SelectItem value={ExportType.PURCHASES}>{t("types.purchases")}</SelectItem>
                  <SelectItem value={ExportType.INVENTORY_ON_HAND}>{t("types.inventoryOnHand")}</SelectItem>
                  <SelectItem value={ExportType.PERIOD_CLOSE_REPORT}>{t("types.periodClose")}</SelectItem>
                  <SelectItem value={ExportType.RECEIPTS_FOR_KKM}>{t("types.kkmReceipts")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-gray-500">{t("periodStart")}</label>
              <Input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-500">{t("periodEnd")}</label>
              <Input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
            </div>
          </div>
          <Button type="button" onClick={handleGenerate} disabled={createMutation.isLoading}>
            {createMutation.isLoading ? tCommon("loading") : t("generate")}
          </Button>
        </CardContent>
      </Card>

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
              <Button type="button" variant="ghost" className="h-8 px-3" onClick={() => jobsQuery.refetch()}>
                {tErrors("tryAgain")}
              </Button>
            </div>
          ) : jobsQuery.data?.length ? (
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
                  {jobsQuery.data.map((job) => (
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
                      <TableCell className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t("download")}
                          disabled={!job.storagePath || job.status !== ExportJobStatus.DONE}
                          asChild
                        >
                          <a href={`/api/exports/${job.id}`}>
                            <DownloadIcon className="h-4 w-4" aria-hidden />
                          </a>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t("copyJobId")}
                          onClick={() => copyText(job.id, t("copiedJobId"))}
                        >
                          <CopyIcon className="h-4 w-4" aria-hidden />
                        </Button>
                        {job.fileName ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t("copyFileName")}
                            onClick={() => copyText(job.fileName ?? "", t("copiedFileName"))}
                          >
                            <CopyIcon className="h-4 w-4" aria-hidden />
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-gray-500">{t("empty")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ExportsPage;

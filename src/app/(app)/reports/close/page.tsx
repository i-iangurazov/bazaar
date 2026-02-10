"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";

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
import { DownloadIcon } from "@/components/icons";
import { RowActions } from "@/components/row-actions";
import { useToast } from "@/components/ui/toast";
import { Field, FormActions, FormGrid } from "@/components/form-layout";
import { formatDate, formatDateTime } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const formatMonthInput = (value: Date) => value.toISOString().slice(0, 7);
const PERIOD_CLOSE_EXPORT_TYPE = "PERIOD_CLOSE_REPORT" as const;

const buildPeriod = (monthValue: string) => {
  const [year, month] = monthValue.split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59);
  return { start, end };
};

const PeriodClosePage = () => {
  const t = useTranslations("periodClose");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session, status } = useSession();
  const canView = session?.user?.role && session.user.role !== "STAFF";
  const { toast } = useToast();

  const storesQuery = trpc.stores.list.useQuery(undefined, { enabled: status === "authenticated" });
  const [storeId, setStoreId] = useState("");
  const now = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(formatMonthInput(now));

  const closesQuery = trpc.periodClose.list.useQuery(
    { storeId: storeId || undefined },
    { enabled: status === "authenticated" && Boolean(canView) },
  );

  const closeMutation = trpc.periodClose.close.useMutation({
    onSuccess: () => {
      toast({ variant: "success", description: t("closed") });
      closesQuery.refetch();
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const exportMutation = trpc.exports.create.useMutation({
    onSuccess: (job) => {
      toast({ variant: "success", description: t("exportCreated") });
      if (job?.id) {
        window.open(`/api/exports/${job.id}`, "_blank");
      }
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  if (status === "authenticated" && !canView) {
    return (
      <div>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <p className="mt-4 text-sm text-red-500">{tErrors("forbidden")}</p>
      </div>
    );
  }

  const handleClose = () => {
    if (!storeId) {
      toast({ variant: "error", description: tErrors("storeRequired") });
      return;
    }
    const { start, end } = buildPeriod(month);
    closeMutation.mutate({ storeId, periodStart: start, periodEnd: end });
  };

  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("closeTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <FormGrid>
            <Field label={t("storeLabel")}>
              <Select value={storeId} onValueChange={setStoreId}>
                <SelectTrigger>
                  <SelectValue placeholder={tCommon("selectStore")} />
                </SelectTrigger>
                <SelectContent>
                  {(storesQuery.data ?? []).map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("monthLabel")}>
              <Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
            </Field>
          </FormGrid>
          <FormActions>
            <Button type="button" onClick={handleClose} disabled={closeMutation.isLoading}>
              {closeMutation.isLoading ? tCommon("loading") : t("closeAction")}
            </Button>
          </FormActions>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("historyTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {closesQuery.isLoading ? (
            <p className="text-sm text-gray-500">{tCommon("loading")}</p>
          ) : closesQuery.error ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-red-500">
              <span>{translateError(tErrors, closesQuery.error)}</span>
              <Button type="button" variant="secondary" size="sm" onClick={() => closesQuery.refetch()}>
                {tErrors("tryAgain")}
              </Button>
            </div>
          ) : closesQuery.data?.length ? (
            <ResponsiveDataList
              items={closesQuery.data}
              getKey={(close) => close.id}
              renderDesktop={(visibleItems) => (
                <div className="overflow-x-auto">
                  <Table className="min-w-[640px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("columns.period")}</TableHead>
                        <TableHead>{t("columns.closedAt")}</TableHead>
                        <TableHead>{t("columns.status")}</TableHead>
                        <TableHead>{t("columns.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleItems.map((close) => {
                        const actions = [
                          {
                            key: "download",
                            label: t("download"),
                            icon: DownloadIcon,
                            onSelect: () =>
                              exportMutation.mutate({
                                storeId: close.storeId,
                                type: PERIOD_CLOSE_EXPORT_TYPE,
                                periodStart: close.periodStart,
                                periodEnd: close.periodEnd,
                              }),
                            disabled: exportMutation.isLoading,
                          },
                        ];

                        return (
                          <TableRow key={close.id}>
                            <TableCell className="text-xs text-gray-500">
                              {formatDate(close.periodStart, locale)} — {formatDate(close.periodEnd, locale)}
                            </TableCell>
                            <TableCell className="text-xs text-gray-500">
                              {formatDateTime(close.closedAt, locale)}
                            </TableCell>
                            <TableCell>
                              <Badge variant="success">{t("statusClosed")}</Badge>
                            </TableCell>
                            <TableCell>
                              <RowActions
                                actions={actions}
                                maxInline={1}
                                moreLabel={tCommon("tooltips.moreActions")}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              renderMobile={(close) => (
                <div className="rounded-md border border-gray-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">
                        {formatDate(close.periodStart, locale)} — {formatDate(close.periodEnd, locale)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatDateTime(close.closedAt, locale)}
                      </p>
                    </div>
                    <Badge variant="success">{t("statusClosed")}</Badge>
                  </div>
                  <div className="mt-3 flex items-center justify-end">
                    <RowActions
                      actions={[
                        {
                          key: "download",
                          label: t("download"),
                          icon: DownloadIcon,
                          onSelect: () =>
                            exportMutation.mutate({
                              storeId: close.storeId,
                              type: PERIOD_CLOSE_EXPORT_TYPE,
                              periodStart: close.periodStart,
                              periodEnd: close.periodEnd,
                            }),
                          disabled: exportMutation.isLoading,
                        },
                      ]}
                      maxInline={1}
                      moreLabel={tCommon("tooltips.moreActions")}
                    />
                  </div>
                </div>
              )}
            />
          ) : (
            <p className="text-sm text-gray-500">{t("empty")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default PeriodClosePage;

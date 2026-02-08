"use client";

import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { RowActions } from "@/components/row-actions";
import { RestoreIcon, CheckIcon } from "@/components/icons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { formatDateTime } from "@/lib/i18nFormat";

const AdminJobsPage = () => {
  const t = useTranslations("adminJobs");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session, status } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const isForbidden = status === "authenticated" && !isAdmin;
  const { toast } = useToast();

  const jobsQuery = trpc.adminJobs.list.useQuery(undefined, { enabled: isAdmin });
  type JobRow = NonNullable<typeof jobsQuery.data>[number];

  const retryMutation = trpc.adminJobs.retry.useMutation({
    onSuccess: () => {
      jobsQuery.refetch();
      toast({ variant: "success", description: t("retrySuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const resolveMutation = trpc.adminJobs.resolve.useMutation({
    onSuccess: () => {
      jobsQuery.refetch();
      toast({ variant: "success", description: t("resolveSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  if (isForbidden) {
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

      <Card>
        <CardHeader>
          <CardTitle>{t("listTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {jobsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : !(jobsQuery.data ?? []).length ? (
            <p className="text-sm text-gray-500">{t("empty")}</p>
          ) : (
            <ResponsiveDataList
              items={jobsQuery.data ?? []}
              getKey={(job) => job.id}
              renderDesktop={(visibleItems) => (
                <div className="overflow-x-auto">
                  <Table className="min-w-[720px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("columns.job")}</TableHead>
                        <TableHead>{t("columns.attempts")}</TableHead>
                        <TableHead>{t("columns.lastError")}</TableHead>
                        <TableHead>{t("columns.lastErrorAt")}</TableHead>
                        <TableHead>{t("columns.status")}</TableHead>
                        <TableHead className="text-right">{tCommon("actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleItems.map((job: JobRow) => (
                        <TableRow key={job.id}>
                          <TableCell className="font-medium">{job.jobName}</TableCell>
                          <TableCell className="text-xs text-gray-500">{job.attempts}</TableCell>
                          <TableCell className="text-xs text-gray-500">{job.lastError}</TableCell>
                          <TableCell className="text-xs text-gray-500">
                            {formatDateTime(job.lastErrorAt, locale)}
                          </TableCell>
                          <TableCell>
                            {job.resolvedAt ? (
                              <Badge variant="success">{t("statusResolved")}</Badge>
                            ) : (
                              <Badge variant="warning">{t("statusOpen")}</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {job.resolvedAt ? (
                              <span className="text-xs text-gray-400">{t("resolved")}</span>
                            ) : (
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => retryMutation.mutate({ jobId: job.id })}
                                  disabled={retryMutation.isLoading}
                                >
                                  {t("retry")}
                                </Button>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => resolveMutation.mutate({ jobId: job.id })}
                                  disabled={resolveMutation.isLoading}
                                >
                                  {t("resolve")}
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              renderMobile={(job) => (
                <div className="rounded-md border border-gray-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{job.jobName}</p>
                      <p className="text-xs text-gray-500">
                        {t("columns.attempts")}: {job.attempts}
                      </p>
                      <p className="text-xs text-gray-500">{job.lastError}</p>
                      <p className="text-xs text-gray-500">
                        {formatDateTime(job.lastErrorAt, locale)}
                      </p>
                    </div>
                    {job.resolvedAt ? (
                      <Badge variant="success">{t("statusResolved")}</Badge>
                    ) : (
                      <Badge variant="warning">{t("statusOpen")}</Badge>
                    )}
                  </div>
                  <div className="mt-2 flex justify-end">
                    {job.resolvedAt ? (
                      <span className="text-xs text-gray-400">{t("resolved")}</span>
                    ) : (
                      <RowActions
                        actions={[
                          {
                            key: "retry",
                            label: t("retry"),
                            icon: RestoreIcon,
                            onSelect: () => retryMutation.mutate({ jobId: job.id }),
                            disabled: retryMutation.isLoading,
                          },
                          {
                            key: "resolve",
                            label: t("resolve"),
                            icon: CheckIcon,
                            onSelect: () => resolveMutation.mutate({ jobId: job.id }),
                            disabled: resolveMutation.isLoading,
                          },
                        ]}
                        maxInline={2}
                        moreLabel={tCommon("tooltips.moreActions")}
                      />
                    )}
                  </div>
                </div>
              )}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminJobsPage;

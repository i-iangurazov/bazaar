"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { QueryErrorState } from "@/components/query-error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Checkbox } from "@/components/ui/checkbox";
import { Modal } from "@/components/ui/modal";
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
  const [resolveJob, setResolveJob] = useState<JobRow | null>(null);
  const [resolutionAcknowledged, setResolutionAcknowledged] = useState(false);
  const openResolve = (job: JobRow) => {
    setResolutionAcknowledged(false);
    setResolveJob(job);
  };

  const retryMutation = trpc.adminJobs.retry.useMutation({
    onSuccess: async (result) => {
      toast(result.status === "resolved"
        ? { variant: "success", description: t("retrySuccess") }
        : { variant: "error", description: t("retryFailed") });
      await jobsQuery.refetch();
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
      void jobsQuery.refetch();
    },
  });

  const resolveMutation = trpc.adminJobs.resolve.useMutation({
    onSuccess: () => {
      setResolveJob(null);
      setResolutionAcknowledged(false);
      void jobsQuery.refetch();
      toast({ variant: "success", description: t("resolveSuccess") });
    },
    onError: (error) => {
      setResolutionAcknowledged(false);
      toast({ variant: "error", description: translateError(tErrors, error) });
      void jobsQuery.refetch();
    },
  });
  const actionsBusy = retryMutation.isLoading || resolveMutation.isLoading || jobsQuery.isFetching;

  if (isForbidden) {
    return (
      <div>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <p className="mt-4 text-sm text-danger">{tErrors("forbidden")}</p>
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
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : jobsQuery.isError ? (
            <QueryErrorState onRetry={() => void jobsQuery.refetch()} />
          ) : !(jobsQuery.data ?? []).length ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
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
                          <TableCell className="text-xs text-muted-foreground">{job.attempts}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{job.lastError}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDateTime(job.lastErrorAt, locale)}
                          </TableCell>
                          <TableCell>
                            {job.resolvedAt ? (
                              <Badge variant="success">{t("statusResolved")}</Badge>
                            ) : job.retryAttemptId ? (
                              <div className="max-w-[18rem] space-y-2 text-left">
                                <Badge variant="warning">{t("statusNeedsReconciliation")}</Badge>
                                <p className="text-xs text-muted-foreground">{t("retryClaimed")}</p>
                                {job.retryStartedAt ? <p className="text-xs text-muted-foreground">{t("retryStartedAt", { time: formatDateTime(job.retryStartedAt, locale) })}</p> : null}
                              </div>
                            ) : (
                              <Badge variant="warning">{t("statusOpen")}</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {job.resolvedAt ? (
                              <span className="text-xs text-muted-foreground/80">{t("resolved")}</span>
                            ) : (
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => retryMutation.mutate({ jobId: job.id })}
                                  disabled={actionsBusy || Boolean(job.retryAttemptId)}
                                >
                                  {t("retry")}
                                </Button>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => openResolve(job)}
                                  disabled={actionsBusy}
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
                <div className="rounded-md border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{job.jobName}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("columns.attempts")}: {job.attempts}
                      </p>
                      <p className="text-xs text-muted-foreground">{job.lastError}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(job.lastErrorAt, locale)}
                      </p>
                    </div>
                    {job.resolvedAt ? (
                      <Badge variant="success">{t("statusResolved")}</Badge>
                    ) : job.retryAttemptId ? (
                      <Badge variant="warning" className="max-w-[10rem]">{t("statusNeedsReconciliation")}</Badge>
                    ) : (
                      <Badge variant="warning">{t("statusOpen")}</Badge>
                    )}
                  </div>
                  {!job.resolvedAt && job.retryAttemptId ? <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    <p>{t("retryClaimed")}</p>
                    {job.retryStartedAt ? <p>{t("retryStartedAt", { time: formatDateTime(job.retryStartedAt, locale) })}</p> : null}
                  </div> : null}
                  <div className="mt-2 flex justify-end">
                    {job.resolvedAt ? (
                      <span className="text-xs text-muted-foreground/80">{t("resolved")}</span>
                    ) : (
                      <RowActions
                        actions={[
                          {
                            key: "retry",
                            label: t("retry"),
                            icon: RestoreIcon,
                            onSelect: () => retryMutation.mutate({ jobId: job.id }),
                            disabled: actionsBusy || Boolean(job.retryAttemptId),
                          },
                          {
                            key: "resolve",
                            label: t("resolve"),
                            icon: CheckIcon,
                            onSelect: () => openResolve(job),
                            disabled: actionsBusy,
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
      <Modal
        open={Boolean(resolveJob)}
        onOpenChange={(open) => {
          if (!open && !resolveMutation.isLoading) {
            setResolveJob(null);
            setResolutionAcknowledged(false);
          }
        }}
        title={t("resolveConfirmTitle")}
        subtitle={t("resolveConfirmDescription")}
      >
        <div className="space-y-4">
          <p className="break-words font-medium">{resolveJob?.jobName}</p>
          {resolveJob?.retryAttemptId ? <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{t("resolveClaimWarning")}</p> : null}
          <label htmlFor="job-resolution-acknowledgement" className="flex items-start gap-3 text-sm leading-6">
            <Checkbox id="job-resolution-acknowledgement" className="mt-1" checked={resolutionAcknowledged} onCheckedChange={value => setResolutionAcknowledged(value === true)} disabled={resolveMutation.isLoading} />
            <span>{t("resolveAcknowledgement")}</span>
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={resolveMutation.isLoading} onClick={() => { setResolveJob(null); setResolutionAcknowledged(false); }}>{tCommon("cancel")}</Button>
            <Button type="button" disabled={!resolutionAcknowledged || actionsBusy} onClick={() => {
              if (resolveJob && resolutionAcknowledged) resolveMutation.mutate({ jobId: resolveJob.id });
            }}>{t("resolveConfirm")}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default AdminJobsPage;

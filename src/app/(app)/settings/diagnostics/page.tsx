"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";

import { PageHeader, PageHeaderActions } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import {
  ActivityIcon,
  CopyIcon,
} from "@/components/icons";
import { formatDateTime } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

type DiagnosticsCheckType =
  | "database"
  | "redis"
  | "sse"
  | "email"
  | "exports"
  | "pdf"
  | "jobs"
  | "subscription";

type DiagnosticsStatus = "ok" | "warning" | "error";

type DiagnosticsCheckResult = {
  type: DiagnosticsCheckType;
  status: DiagnosticsStatus;
  code: string;
  details: Record<string, unknown>;
  ranAt: string;
  durationMs: number;
};

type DiagnosticsReportSummary = {
  id: string;
  createdAt: string;
  generatedAt: string;
  overallStatus: DiagnosticsStatus;
  checks: DiagnosticsCheckResult[];
};

const checkOrder: DiagnosticsCheckType[] = [
  "database",
  "redis",
  "sse",
  "email",
  "exports",
  "pdf",
  "jobs",
  "subscription",
];

const computeOverallStatus = (checks: DiagnosticsCheckResult[]): DiagnosticsStatus => {
  if (checks.some((check) => check.status === "error")) {
    return "error";
  }
  if (checks.some((check) => check.status === "warning")) {
    return "warning";
  }
  return "ok";
};

const DiagnosticsPage = () => {
  const t = useTranslations("ownerDiagnostics");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { status } = useSession();
  const { toast } = useToast();
  const profileQuery = trpc.userSettings.getMyProfile.useQuery(undefined, {
    enabled: status === "authenticated",
  });
  const isOrgOwner = Boolean(profileQuery.data?.isOrgOwner);
  const isForbidden = status === "authenticated" && profileQuery.isSuccess && !isOrgOwner;

  const [checkResults, setCheckResults] = useState<Partial<Record<DiagnosticsCheckType, DiagnosticsCheckResult>>>({});
  const [reportMeta, setReportMeta] = useState<{
    id: string;
    createdAt: string;
    generatedAt: string;
  } | null>(null);
  const [confirmEmailInProduction, setConfirmEmailInProduction] = useState(false);

  const lastReportQuery = trpc.diagnostics.getLastReport.useQuery(undefined, {
    enabled: status === "authenticated" && profileQuery.isSuccess && isOrgOwner,
  });

  const applyReport = (report: DiagnosticsReportSummary) => {
    setReportMeta({
      id: report.id,
      createdAt: report.createdAt,
      generatedAt: report.generatedAt,
    });
    setCheckResults((prev) => {
      if (report.checks.length > 1) {
        const next: Partial<Record<DiagnosticsCheckType, DiagnosticsCheckResult>> = {};
        for (const check of report.checks) {
          next[check.type] = check;
        }
        return next;
      }
      if (report.checks.length === 1) {
        const [single] = report.checks;
        return { ...prev, [single.type]: single };
      }
      return prev;
    });
  };

  useEffect(() => {
    if (!lastReportQuery.data) {
      return;
    }
    applyReport(lastReportQuery.data as DiagnosticsReportSummary);
  }, [lastReportQuery.data]);

  const runAllMutation = trpc.diagnostics.runAll.useMutation({
    onSuccess: (report) => {
      applyReport(report as DiagnosticsReportSummary);
      toast({ variant: "success", description: t("runAllSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const runOneMutation = trpc.diagnostics.runOne.useMutation({
    onSuccess: (report) => {
      applyReport(report as DiagnosticsReportSummary);
      toast({ variant: "success", description: t("runOneSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const sortedChecks = useMemo(
    () =>
      checkOrder
        .map((type) => checkResults[type])
        .filter((check): check is DiagnosticsCheckResult => Boolean(check)),
    [checkResults],
  );

  const overallStatus = computeOverallStatus(sortedChecks);
  const runningCheck = runOneMutation.variables?.check;
  const isBusy = runAllMutation.isLoading || runOneMutation.isLoading;

  const handleRunAll = () => {
    runAllMutation.mutate({ confirmEmailInProduction });
  };

  const handleRunCheck = (check: DiagnosticsCheckType, sendEmailTest = false) => {
    runOneMutation.mutate({
      check,
      sendEmailTest,
      confirmEmailInProduction,
    });
  };

  const handleCopyReport = async () => {
    const payload = {
      id: reportMeta?.id ?? null,
      createdAt: reportMeta?.createdAt ?? null,
      generatedAt: reportMeta?.generatedAt ?? new Date().toISOString(),
      overallStatus,
      checks: sortedChecks,
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      toast({ variant: "success", description: t("copySuccess") });
    } catch {
      toast({ variant: "error", description: t("copyFailed") });
    }
  };

  if (isForbidden) {
    return (
      <div>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <p className="mt-4 text-sm text-danger">{tErrors("forbidden")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <PageHeaderActions>
            <Button type="button" variant="secondary" onClick={handleCopyReport} disabled={!sortedChecks.length}>
              <CopyIcon className="h-4 w-4" aria-hidden />
              {t("copyReport")}
            </Button>
            <Button type="button" onClick={handleRunAll} disabled={isBusy || status !== "authenticated"}>
              {runAllMutation.isLoading ? <Spinner className="h-4 w-4" /> : <ActivityIcon className="h-4 w-4" aria-hidden />}
              {runAllMutation.isLoading ? tCommon("loading") : t("runAll")}
            </Button>
          </PageHeaderActions>
        }
      />

      <Card>
        <CardHeader className="space-y-2">
          <CardTitle>{t("overviewTitle")}</CardTitle>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <Badge variant={overallStatus === "ok" ? "success" : overallStatus === "warning" ? "warning" : "danger"}>
              {t(`statuses.${overallStatus}`)}
            </Badge>
            {reportMeta?.generatedAt ? (
              <span>{t("lastGenerated", { value: formatDateTime(reportMeta.generatedAt, locale) })}</span>
            ) : (
              <span>{t("neverRun")}</span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{t("emailConfirmTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("emailConfirmDescription")}</p>
            </div>
            <Switch
              checked={confirmEmailInProduction}
              onCheckedChange={setConfirmEmailInProduction}
              aria-label={t("emailConfirmTitle")}
            />
          </div>

          {lastReportQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            {checkOrder.map((checkType) => {
              const result = checkResults[checkType];
              const statusValue = result?.status;
              const badgeVariant =
                statusValue === "ok" ? "success" : statusValue === "warning" ? "warning" : statusValue === "error" ? "danger" : "muted";
              const isCurrentCheckRunning = runOneMutation.isLoading && runningCheck === checkType;

              return (
                <Card key={checkType} className="h-full">
                  <CardHeader className="space-y-2 pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-base">{t(`checks.${checkType}.title`)}</CardTitle>
                      <Badge variant={badgeVariant}>
                        {statusValue ? t(`statuses.${statusValue}`) : t("statuses.notRun")}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{t(`checks.${checkType}.description`)}</p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-sm text-muted-foreground">
                      {result ? (
                        <div className="space-y-1">
                          <p>{t(`codes.${result.code}`)}</p>
                          <p className="text-xs text-muted-foreground">
                            {t("lastRun", { value: formatDateTime(result.ranAt, locale) })}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t("durationMs", { value: result.durationMs })}
                          </p>
                        </div>
                      ) : (
                        <p>{t("checkNotRunYet")}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => handleRunCheck(checkType)}
                        disabled={isBusy || status !== "authenticated"}
                      >
                        {isCurrentCheckRunning ? <Spinner className="h-4 w-4" /> : null}
                        {isCurrentCheckRunning ? tCommon("loading") : t("runCheck")}
                      </Button>
                      {checkType === "email" ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => handleRunCheck("email", true)}
                          disabled={isBusy || status !== "authenticated"}
                        >
                          {t("sendEmailTest")}
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {lastReportQuery.error ? (
        <p className="text-sm text-danger">{translateError(tErrors, lastReportQuery.error)}</p>
      ) : null}
    </div>
  );
};

export default DiagnosticsPage;

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { MMarketEnvironment, MMarketExportJobStatus } from "@prisma/client";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { CopyIcon, HideIcon, IntegrationsIcon, ViewIcon } from "@/components/icons";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const ISSUE_CODES = [
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

const formatCountdown = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.trunc(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remSeconds).padStart(2, "0")}`;
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

const MMarketSettingsPage = () => {
  const t = useTranslations("mMarketSettings");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session } = useSession();
  const { toast } = useToast();

  const role = session?.user?.role ?? "STAFF";
  const canView = role === "ADMIN" || role === "MANAGER" || role === "STAFF";
  const canEdit = role === "ADMIN" || role === "MANAGER";

  const settingsQuery = trpc.mMarket.settings.useQuery(undefined, { enabled: canView });
  const jobsQuery = trpc.mMarket.jobs.useQuery({ limit: 100 }, { enabled: canView });
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

  const [environment, setEnvironment] = useState<MMarketEnvironment>(MMarketEnvironment.DEV);
  const [apiToken, setApiToken] = useState("");
  const [showApiToken, setShowApiToken] = useState(false);
  const [branchMappings, setBranchMappings] = useState<Record<string, string>>({});
  const [preflightFresh, setPreflightFresh] = useState(false);
  const [filterSku, setFilterSku] = useState("");
  const [filterIssue, setFilterIssue] = useState<string>("ALL");
  const [cooldownRemainingSeconds, setCooldownRemainingSeconds] = useState(0);

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

  const handleRunPreflight = async () => {
    const result = await preflightQuery.refetch();
    if (result.data) {
      setPreflightFresh(true);
    }
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

  const preflightData = preflightQuery.data;
  const preflightCanExport = preflightFresh && Boolean(preflightData?.canExport);
  const effectiveCooldownSeconds = Math.max(
    cooldownRemainingSeconds,
    preflightData?.cooldown.remainingSeconds ?? 0,
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
              endpoint:
                settingsQuery.data?.integration.environment
                  ? settingsQuery.data.endpoints[settingsQuery.data.integration.environment]
                  : settingsQuery.data?.endpoints[MMarketEnvironment.DEV] ?? "",
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
              {validateLocalMutation.isLoading
                ? tCommon("loading")
                : t("connection.validateLocal")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleClearToken}
              disabled={!canEdit || !settingsQuery.data?.integration.hasToken || saveConnectionMutation.isLoading}
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
                  <p className="text-xs text-muted-foreground">{t("preflight.metrics.considered")}</p>
                  <p className="text-lg font-semibold">{preflightData.summary.productsConsidered}</p>
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
                <p className="text-sm font-medium text-foreground">{t("preflight.blockersTitle")}</p>
                {preflightData.blockers.total === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">{t("preflight.noBlockers")}</p>
                ) : (
                  <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                    {ISSUE_CODES.filter((code) => (preflightData.blockers.byCode[code] ?? 0) > 0).map(
                      (code) => (
                        <p key={code}>
                          {t(`issues.${code}`)}: {preflightData.blockers.byCode[code]}
                        </p>
                      ),
                    )}
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
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  value={filterSku}
                  onChange={(event) => setFilterSku(event.target.value)}
                  placeholder={t("preflight.filters.search")}
                />
                <Select value={filterIssue} onValueChange={setFilterIssue}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("preflight.filters.issue")}/>
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
              disabled={!canEdit || exportMutation.isLoading || !preflightCanExport || effectiveCooldownSeconds > 0}
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
                        job.payloadStatsJson && typeof job.payloadStatsJson === "object" && !Array.isArray(job.payloadStatsJson)
                          ? (job.payloadStatsJson as Record<string, unknown>)
                          : {};
                      const productCount = typeof stats.productCount === "number" ? stats.productCount : 0;

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
                              <span className="text-xs text-muted-foreground">{t("history.noError")}</span>
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
    </div>
  );
};

export default MMarketSettingsPage;

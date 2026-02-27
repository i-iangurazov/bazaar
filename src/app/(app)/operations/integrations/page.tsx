"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyIcon, IntegrationsIcon, ViewIcon } from "@/components/icons";
import { useToast } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc";

type SummaryStatus = "NOT_CONFIGURED" | "DRAFT" | "PUBLISHED";

const resolveAbsoluteCatalogUrl = (publicUrlPath: string) => {
  const configuredBase = process.env.NEXT_PUBLIC_BAZAAR_CATALOG_BASE_URL?.trim();
  if (configuredBase) {
    return new URL(publicUrlPath, configuredBase).toString();
  }
  if (typeof window !== "undefined") {
    return new URL(publicUrlPath, window.location.origin).toString();
  }
  return publicUrlPath;
};

const IntegrationsPage = () => {
  const t = useTranslations("integrations");
  const tCommon = useTranslations("common");
  const { toast } = useToast();

  const storesQuery = trpc.bazaarCatalog.listStores.useQuery();
  const mMarketOverviewQuery = trpc.mMarket.overview.useQuery();

  const { summaryStatus, publishedEntry, defaultStoreId } = useMemo(() => {
    const stores = storesQuery.data ?? [];
    const published = stores.find((store) => store.status === "PUBLISHED") ?? null;
    const hasDraft = stores.some((store) => store.status === "DRAFT");
    const hasPublished = Boolean(published);
    const summary: SummaryStatus = hasPublished
      ? "PUBLISHED"
      : hasDraft
        ? "DRAFT"
        : "NOT_CONFIGURED";
    return {
      summaryStatus: summary,
      publishedEntry: published,
      defaultStoreId: stores[0]?.storeId ?? "",
    };
  }, [storesQuery.data]);

  const settingsHref = defaultStoreId
    ? `/operations/integrations/bazaar-catalog?storeId=${encodeURIComponent(defaultStoreId)}`
    : "/operations/integrations/bazaar-catalog";

  const catalogUrl = publishedEntry?.publicUrlPath
    ? resolveAbsoluteCatalogUrl(publishedEntry.publicUrlPath)
    : null;
  const statusLabelKey =
    summaryStatus === "PUBLISHED"
      ? "published"
      : summaryStatus === "DRAFT"
        ? "draft"
        : "notConfigured";

  const handleCopyLink = async () => {
    if (!catalogUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(catalogUrl);
      toast({ variant: "success", description: t("bazaarCatalog.copySuccess") });
    } catch {
      toast({ variant: "error", description: t("bazaarCatalog.copyFailed") });
    }
  };

  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <IntegrationsIcon className="h-5 w-5 text-primary" aria-hidden />
                  {t("bazaarCatalog.title")}
                </CardTitle>
                <p className="text-sm text-muted-foreground">{t("bazaarCatalog.description")}</p>
              </div>
              <Badge
                variant={
                  summaryStatus === "PUBLISHED"
                    ? "success"
                    : summaryStatus === "DRAFT"
                      ? "warning"
                      : "muted"
                }
              >
                {t(`status.${statusLabelKey}`)}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {publishedEntry?.storeName ? (
              <p className="text-xs text-muted-foreground">
                {t("bazaarCatalog.publishedStore", { store: publishedEntry.storeName })}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Link href={settingsHref}>
                <Button>{t("bazaarCatalog.openSettings")}</Button>
              </Link>
              {catalogUrl ? (
                <>
                  <Link href={catalogUrl} target="_blank" rel="noopener noreferrer">
                    <Button variant="secondary">
                      <ViewIcon className="h-4 w-4" aria-hidden />
                      {t("bazaarCatalog.openCatalog")}
                    </Button>
                  </Link>
                  <Button type="button" variant="outline" onClick={handleCopyLink}>
                    <CopyIcon className="h-4 w-4" aria-hidden />
                    {tCommon("tooltips.copyLink")}
                  </Button>
                </>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <IntegrationsIcon className="h-5 w-5 text-primary" aria-hidden />
                  {t("mMarket.title")}
                </CardTitle>
                <p className="text-sm text-muted-foreground">{t("mMarket.description")}</p>
              </div>
              <Badge
                variant={
                  mMarketOverviewQuery.data?.status === "READY"
                    ? "success"
                    : mMarketOverviewQuery.data?.status === "ERROR"
                      ? "danger"
                      : "muted"
                }
              >
                {mMarketOverviewQuery.data?.status === "READY"
                  ? t("mMarket.status.ready")
                  : mMarketOverviewQuery.data?.status === "ERROR"
                    ? t("mMarket.status.error")
                    : t("mMarket.status.notConfigured")}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Link href="/operations/integrations/m-market">
                <Button>{t("mMarket.openSettings")}</Button>
              </Link>
              {mMarketOverviewQuery.data?.configured ? (
                <Link href="/operations/integrations/m-market">
                  <Button variant="secondary">{t("mMarket.openExport")}</Button>
                </Link>
              ) : (
                <Button variant="secondary" disabled>
                  {t("mMarket.openExport")}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default IntegrationsPage;

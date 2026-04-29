"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";

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
  const { data: session } = useSession();
  const role = session?.user?.role;
  const canManageApiKeys = role === "ADMIN" || role === "MANAGER";

  const storesQuery = trpc.bazaarCatalog.listStores.useQuery();
  const mMarketOverviewQuery = trpc.mMarket.overview.useQuery();
  const bakaiStoreOverviewQuery = trpc.bakaiStore.overview.useQuery();
  const productImageStudioOverviewQuery = trpc.productImageStudio.overview.useQuery();

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
  const apiSettingsHref = `${settingsHref}#bazaar-api`;
  const apiKeysQuery = trpc.bazaarCatalog.apiKeys.useQuery(
    { storeId: defaultStoreId },
    { enabled: canManageApiKeys && Boolean(defaultStoreId) },
  );
  const activeApiKeyCount = (apiKeysQuery.data ?? []).filter((apiKey) => !apiKey.revokedAt).length;

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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                  {t("bazaarApi.title")}
                </CardTitle>
                <p className="text-sm text-muted-foreground">{t("bazaarApi.description")}</p>
              </div>
              <Badge variant={activeApiKeyCount > 0 ? "success" : "muted"}>
                {activeApiKeyCount > 0 ? t("status.ready") : t("status.notConfigured")}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeApiKeyCount > 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("bazaarApi.activeKeys", { count: activeApiKeyCount })}
              </p>
            ) : null}
            <div className="grid gap-2 rounded-md border border-border p-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">{t("bazaarApi.productsEndpoint")}</p>
                <p className="break-all font-mono text-xs">
                  {t("bazaarApi.productsEndpointValue")}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("bazaarApi.ordersEndpoint")}</p>
                <p className="break-all font-mono text-xs">{t("bazaarApi.ordersEndpointValue")}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={apiSettingsHref}>
                <Button>{t("bazaarApi.manageKeys")}</Button>
              </Link>
              <Link href={settingsHref}>
                <Button variant="secondary">{t("bazaarCatalog.openSettings")}</Button>
              </Link>
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

        <Card>
          <CardHeader className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <IntegrationsIcon className="h-5 w-5 text-primary" aria-hidden />
                  {t("bakaiStore.title")}
                </CardTitle>
                <p className="text-sm text-muted-foreground">{t("bakaiStore.description")}</p>
              </div>
              <Badge
                variant={
                  bakaiStoreOverviewQuery.data?.status === "READY"
                    ? "success"
                    : bakaiStoreOverviewQuery.data?.status === "ERROR"
                      ? "danger"
                      : bakaiStoreOverviewQuery.data?.status === "DRAFT"
                        ? "warning"
                        : "muted"
                }
              >
                {bakaiStoreOverviewQuery.data?.status === "READY"
                  ? t("bakaiStore.status.ready")
                  : bakaiStoreOverviewQuery.data?.status === "ERROR"
                    ? t("bakaiStore.status.error")
                    : bakaiStoreOverviewQuery.data?.status === "DRAFT"
                      ? t("bakaiStore.status.draft")
                      : t("bakaiStore.status.notConfigured")}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Link href="/operations/integrations/bakai-store">
                <Button>{t("bakaiStore.openSettings")}</Button>
              </Link>
              {bakaiStoreOverviewQuery.data?.configured ? (
                <Link href="/operations/integrations/bakai-store">
                  <Button variant="secondary">{t("bakaiStore.openExport")}</Button>
                </Link>
              ) : (
                <Button variant="secondary" disabled>
                  {t("bakaiStore.openExport")}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <IntegrationsIcon className="h-5 w-5 text-primary" aria-hidden />
                  {t("productImageStudio.title")}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {t("productImageStudio.description")}
                </p>
              </div>
              <Badge
                variant={
                  productImageStudioOverviewQuery.data?.status === "READY"
                    ? "success"
                    : productImageStudioOverviewQuery.data?.status === "ERROR"
                      ? "danger"
                      : "muted"
                }
              >
                {productImageStudioOverviewQuery.data?.status === "READY"
                  ? t("productImageStudio.status.ready")
                  : productImageStudioOverviewQuery.data?.status === "ERROR"
                    ? t("productImageStudio.status.error")
                    : t("productImageStudio.status.notConfigured")}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Link href="/operations/integrations/product-image-studio">
                <Button>{t("productImageStudio.openStudio")}</Button>
              </Link>
              <Link href="/operations/integrations/product-image-studio">
                <Button variant="secondary">{t("productImageStudio.openHistory")}</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default IntegrationsPage;

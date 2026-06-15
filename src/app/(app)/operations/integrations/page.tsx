"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";

import { CopyIcon, IntegrationsIcon, ViewIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc";

type SummaryStatus = "NOT_CONFIGURED" | "DRAFT" | "PUBLISHED";
type BadgeVariant = "default" | "success" | "warning" | "danger" | "muted";

const IntegrationTile = ({
  title,
  description,
  status,
  statusVariant,
  detail,
  actions,
  className,
}: {
  title: string;
  description: string;
  status: string;
  statusVariant: BadgeVariant;
  detail?: ReactNode;
  actions: ReactNode;
  className?: string;
}) => (
  <Card className={`bazaar-admin-surface flex min-h-[220px] flex-col ${className ?? ""}`}>
    <CardHeader className="border-b border-border/60 bg-muted/20 px-5 py-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <IntegrationsIcon className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 space-y-1">
            <CardTitle className="truncate text-lg leading-tight">{title}</CardTitle>
            <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">{description}</p>
          </div>
        </div>
        <Badge variant={statusVariant} className="shrink-0">
          {status}
        </Badge>
      </div>
    </CardHeader>
    <CardContent className="flex flex-1 flex-col justify-between gap-4 px-5 py-4">
      <div className="min-h-6 text-sm leading-6 text-muted-foreground">{detail}</div>
      <div className="flex flex-wrap gap-2 [&>a]:w-full sm:[&>a]:w-auto [&_button]:w-full sm:[&_button]:w-auto">
        {actions}
      </div>
    </CardContent>
  </Card>
);

const ActionLink = ({
  href,
  children,
  external = false,
}: {
  href: string;
  children: ReactNode;
  external?: boolean;
}) => (
  <Link href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
    {children}
  </Link>
);

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
  const emailMarketingOverviewQuery = trpc.emailMarketing.overview.useQuery(undefined, {
    enabled: canManageApiKeys,
  });

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
  const apiSettingsHref = defaultStoreId
    ? `/operations/integrations/bazaar-api?storeId=${encodeURIComponent(defaultStoreId)}`
    : "/operations/integrations/bazaar-api";
  const apiKeysQuery = trpc.bazaarApi.apiKeys.useQuery(
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

  const mMarketStatus =
    mMarketOverviewQuery.data?.status === "READY"
      ? t("mMarket.status.ready")
      : mMarketOverviewQuery.data?.status === "ERROR"
        ? t("mMarket.status.error")
        : t("mMarket.status.notConfigured");
  const mMarketStatusVariant: BadgeVariant =
    mMarketOverviewQuery.data?.status === "READY"
      ? "success"
      : mMarketOverviewQuery.data?.status === "ERROR"
        ? "danger"
        : "muted";

  const bakaiStoreStatus =
    bakaiStoreOverviewQuery.data?.status === "READY"
      ? t("bakaiStore.status.ready")
      : bakaiStoreOverviewQuery.data?.status === "ERROR"
        ? t("bakaiStore.status.error")
        : bakaiStoreOverviewQuery.data?.status === "DRAFT"
          ? t("bakaiStore.status.draft")
          : t("bakaiStore.status.notConfigured");
  const bakaiStoreStatusVariant: BadgeVariant =
    bakaiStoreOverviewQuery.data?.status === "READY"
      ? "success"
      : bakaiStoreOverviewQuery.data?.status === "ERROR"
        ? "danger"
        : bakaiStoreOverviewQuery.data?.status === "DRAFT"
          ? "warning"
          : "muted";

  const imageStudioStatus =
    productImageStudioOverviewQuery.data?.status === "READY"
      ? t("productImageStudio.status.ready")
      : productImageStudioOverviewQuery.data?.status === "ERROR"
        ? t("productImageStudio.status.error")
        : t("productImageStudio.status.notConfigured");
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="grid max-w-[1500px] gap-4 md:grid-cols-2 xl:grid-cols-3">
        <IntegrationTile
          title={t("bazaarCatalog.title")}
          description={t("bazaarCatalog.description")}
          status={t(`status.${statusLabelKey}`)}
          statusVariant={
            summaryStatus === "PUBLISHED"
              ? "success"
              : summaryStatus === "DRAFT"
                ? "warning"
                : "muted"
          }
          detail={
            publishedEntry?.storeName
              ? t("bazaarCatalog.publishedStore", { store: publishedEntry.storeName })
              : null
          }
          actions={
            <>
              <ActionLink href={settingsHref}>
                <Button>{t("bazaarCatalog.openSettings")}</Button>
              </ActionLink>
              {catalogUrl ? (
                <>
                  <ActionLink href={catalogUrl} external>
                    <Button variant="secondary">
                      <ViewIcon className="h-4 w-4" aria-hidden />
                      {t("bazaarCatalog.openCatalog")}
                    </Button>
                  </ActionLink>
                  <Button type="button" variant="outline" onClick={handleCopyLink}>
                    <CopyIcon className="h-4 w-4" aria-hidden />
                    {tCommon("tooltips.copyLink")}
                  </Button>
                </>
              ) : null}
            </>
          }
        />

        <IntegrationTile
          title={t("bazaarApi.title")}
          description={t("bazaarApi.description")}
          status={activeApiKeyCount > 0 ? t("status.ready") : t("status.notConfigured")}
          statusVariant={activeApiKeyCount > 0 ? "success" : "muted"}
          detail={t("bazaarApi.activeKeys", { count: activeApiKeyCount })}
          actions={
            <ActionLink href={apiSettingsHref}>
              <Button>{t("bazaarApi.manageKeys")}</Button>
            </ActionLink>
          }
        />

        {canManageApiKeys ? (
          <IntegrationTile
            title={t("emailMarketing.title")}
            description={t("emailMarketing.description")}
            status={
              emailMarketingOverviewQuery.data?.status === "READY"
                ? t("emailMarketing.status.ready")
                : t("emailMarketing.status.notConfigured")
            }
            statusVariant={
              emailMarketingOverviewQuery.data?.status === "READY" ? "success" : "muted"
            }
            detail={t("emailMarketing.reachable", {
              count: emailMarketingOverviewQuery.data?.reachableCustomers ?? 0,
            })}
            actions={
              <ActionLink href="/operations/integrations/email-marketing">
                <Button>{t("emailMarketing.open")}</Button>
              </ActionLink>
            }
          />
        ) : null}

        <IntegrationTile
          title={t("mMarket.title")}
          description={t("mMarket.description")}
          status={mMarketStatus}
          statusVariant={mMarketStatusVariant}
          actions={
            <>
              <ActionLink href="/operations/integrations/m-market">
                <Button>{t("mMarket.openSettings")}</Button>
              </ActionLink>
              {mMarketOverviewQuery.data?.configured ? (
                <ActionLink href="/operations/integrations/m-market">
                  <Button variant="secondary">{t("mMarket.openExport")}</Button>
                </ActionLink>
              ) : null}
            </>
          }
        />

        <IntegrationTile
          title={t("bakaiStore.title")}
          description={t("bakaiStore.description")}
          status={bakaiStoreStatus}
          statusVariant={bakaiStoreStatusVariant}
          actions={
            <>
              <ActionLink href="/operations/integrations/bakai-store">
                <Button>{t("bakaiStore.openSettings")}</Button>
              </ActionLink>
              {bakaiStoreOverviewQuery.data?.configured ? (
                <ActionLink href="/operations/integrations/bakai-store">
                  <Button variant="secondary">{t("bakaiStore.openExport")}</Button>
                </ActionLink>
              ) : null}
            </>
          }
        />

        <IntegrationTile
          title={t("productImageStudio.title")}
          description={t("productImageStudio.description")}
          status={t("productImageStudio.soonBadge")}
          statusVariant="muted"
          detail={
            <span>
              {t("productImageStudio.currentStatus")}: {imageStudioStatus}
            </span>
          }
          className="pointer-events-none opacity-40"
          actions={
            <>
              <ActionLink href="/operations/integrations/product-image-studio">
                <Button>{t("productImageStudio.openStudio")}</Button>
              </ActionLink>
              <ActionLink href="/operations/integrations/product-image-studio">
                <Button variant="secondary">{t("productImageStudio.openHistory")}</Button>
              </ActionLink>
            </>
          }
        />
      </div>
    </div>
  );
};

export default IntegrationsPage;

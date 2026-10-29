"use client";

import { useMemo, type ComponentProps, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";

import { CopyIcon, IntegrationsIcon, ViewIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { QueryErrorState } from "@/components/query-error-state";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc";

type SummaryStatus = "NOT_CONFIGURED" | "DRAFT" | "PUBLISHED";
type BadgeVariant = "default" | "success" | "warning" | "danger" | "muted";

const queryState = (query: {
  error: ComponentProps<typeof QueryErrorState>["error"] | null;
  isLoading: boolean;
  refetch: () => unknown;
}) => ({
  failure: query.error ? { error: query.error, onRetry: () => void query.refetch() } : undefined,
  pending: query.isLoading,
});

const IntegrationTile = ({
  title,
  description,
  status,
  statusVariant,
  detail,
  actions,
  className,
  failure,
  pending,
}: {
  title: string;
  description: string;
  status: string;
  statusVariant: BadgeVariant;
  detail?: ReactNode;
  actions: ReactNode;
  className?: string;
  failure?: ComponentProps<typeof QueryErrorState>;
  pending?: boolean;
}) => {
  const tCommon = useTranslations("common");
  return (
    <Card className={`flex flex-col ${className ?? ""}`}>
      <CardHeader className="px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
            <IntegrationsIcon className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base leading-6">{title}</CardTitle>
            <p className="text-sm leading-5 text-muted-foreground">{description}</p>
          </div>
        </div>
          <Badge
            variant={failure ? "danger" : pending ? "muted" : statusVariant}
            className="shrink-0"
          >
            {failure ? tCommon("notAvailable") : pending ? tCommon("loading") : status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="mt-auto flex flex-col gap-3 px-4 pb-4 pt-0">
        {failure ? (
          <QueryErrorState {...failure} />
        ) : !pending && detail ? (
          <div className="text-sm leading-5 text-muted-foreground">{detail}</div>
        ) : null}
        <div className="flex flex-wrap gap-2">{actions}</div>
      </CardContent>
    </Card>
  );
};

const ActionLink = ({
  href,
  children,
  external = false,
}: {
  href: string;
  children: ReactNode;
  external?: boolean;
}) => (
  <Link
    href={href}
    className={buttonVariants({ variant: "secondary" })}
    {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
  >
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
  const tErrors = useTranslations("errors");
  const { toast } = useToast();
  const { data: session } = useSession();
  const role = session?.user?.role;
  const canManageApiKeys = role === "ADMIN" || role === "MANAGER";

  const storesQuery = trpc.bazaarCatalog.listStores.useQuery(undefined, {
    enabled: canManageApiKeys,
  });
  const mMarketOverviewQuery = trpc.mMarket.overview.useQuery(undefined, {
    enabled: canManageApiKeys,
  });
  const bakaiStoreOverviewQuery = trpc.bakaiStore.overview.useQuery(undefined, {
    enabled: canManageApiKeys,
  });
  const oMarketOverviewQuery = trpc.oMarket.overview.useQuery(undefined, {
    enabled: canManageApiKeys,
  });
  const productImageStudioOverviewQuery = trpc.productImageStudio.overview.useQuery(undefined, {
    enabled: canManageApiKeys,
  });
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

  const oMarketStatus =
    oMarketOverviewQuery.data?.status === "READY"
      ? t("oMarket.status.ready")
      : oMarketOverviewQuery.data?.status === "ERROR"
        ? t("oMarket.status.error")
        : oMarketOverviewQuery.data?.status === "DRAFT"
          ? t("oMarket.status.draft")
          : t("oMarket.status.notConfigured");
  const oMarketStatusVariant: BadgeVariant =
    oMarketOverviewQuery.data?.status === "READY"
      ? "success"
      : oMarketOverviewQuery.data?.status === "ERROR"
        ? "danger"
        : oMarketOverviewQuery.data?.status === "DRAFT"
          ? "warning"
          : "muted";

  const imageStudioStatus =
    productImageStudioOverviewQuery.data?.status === "READY"
      ? t("productImageStudio.status.ready")
      : productImageStudioOverviewQuery.data?.status === "ERROR"
        ? t("productImageStudio.status.error")
        : t("productImageStudio.status.notConfigured");

  if (!canManageApiKeys) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <p role={session?.user ? "alert" : "status"}>
          {session?.user ? tErrors("forbidden") : tCommon("loading")}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="grid max-w-[1500px] gap-4 md:grid-cols-2 xl:grid-cols-3">
        <IntegrationTile
          title={t("bazaarCatalog.title")}
          {...queryState(storesQuery)}
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
              <ActionLink href={settingsHref}>{t("bazaarCatalog.openSettings")}</ActionLink>
              {catalogUrl ? (
                <>
                  <ActionLink href={catalogUrl} external>
                    <ViewIcon className="h-4 w-4" aria-hidden />
                    {t("bazaarCatalog.openCatalog")}
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
          {...queryState(storesQuery.error || storesQuery.isLoading || !defaultStoreId ? storesQuery : apiKeysQuery)}
          description={t("bazaarApi.description")}
          status={activeApiKeyCount > 0 ? t("status.ready") : t("status.notConfigured")}
          statusVariant={activeApiKeyCount > 0 ? "success" : "muted"}
          detail={t("bazaarApi.activeKeys", { count: activeApiKeyCount })}
          actions={<ActionLink href={apiSettingsHref}>{t("bazaarApi.manageKeys")}</ActionLink>}
        />

        {canManageApiKeys ? (
          <IntegrationTile
            title={t("emailMarketing.title")}
            {...queryState(emailMarketingOverviewQuery)}
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
                {t("emailMarketing.open")}
              </ActionLink>
            }
          />
        ) : null}

        <IntegrationTile
          title={t("mMarket.title")}
          {...queryState(mMarketOverviewQuery)}
          description={t("mMarket.description")}
          status={mMarketStatus}
          statusVariant={mMarketStatusVariant}
          actions={
            <>
              <ActionLink href="/operations/integrations/m-market">
                {t("mMarket.openSettings")}
              </ActionLink>
              {mMarketOverviewQuery.data?.configured ? (
                <ActionLink href="/operations/integrations/m-market">
                  {t("mMarket.openExport")}
                </ActionLink>
              ) : null}
            </>
          }
        />

        <IntegrationTile
          title={t("bakaiStore.title")}
          {...queryState(bakaiStoreOverviewQuery)}
          description={t("bakaiStore.description")}
          status={bakaiStoreStatus}
          statusVariant={bakaiStoreStatusVariant}
          actions={
            <>
              <ActionLink href="/operations/integrations/bakai-store">
                {t("bakaiStore.openSettings")}
              </ActionLink>
              {bakaiStoreOverviewQuery.data?.configured ? (
                <ActionLink href="/operations/integrations/bakai-store">
                  {t("bakaiStore.openExport")}
                </ActionLink>
              ) : null}
            </>
          }
        />

        <IntegrationTile
          title={t("oMarket.title")}
          {...queryState(oMarketOverviewQuery)}
          description={t("oMarket.description")}
          status={oMarketStatus}
          statusVariant={oMarketStatusVariant}
          detail={
            oMarketOverviewQuery.data?.lastSyncAt
              ? t("oMarket.lastSync", {
                  date: new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(oMarketOverviewQuery.data.lastSyncAt)),
                })
              : null
          }
          actions={
            <>
              <ActionLink href="/operations/integrations/o-market">
                {t("oMarket.openSettings")}
              </ActionLink>
              {oMarketOverviewQuery.data?.configured ? (
                <ActionLink href="/operations/integrations/o-market">
                  {t("oMarket.openExport")}
                </ActionLink>
              ) : null}
            </>
          }
        />

        <IntegrationTile
          title={t("productImageStudio.title")}
          {...queryState(productImageStudioOverviewQuery)}
          description={t("productImageStudio.description")}
          status={imageStudioStatus}
          statusVariant={productImageStudioOverviewQuery.data?.configured ? "success" : "muted"}
          detail={
            <span>
              {t("productImageStudio.currentStatus")}: {imageStudioStatus}
            </span>
          }
          actions={
            <>
              <ActionLink href="/operations/integrations/product-image-studio">
                {t("productImageStudio.openStudio")}
              </ActionLink>
              <ActionLink href="/operations/integrations/product-image-studio">
                {t("productImageStudio.openHistory")}
              </ActionLink>
            </>
          }
        />
      </div>
    </div>
  );
};

export default IntegrationsPage;

"use client";

import { useEffect, useMemo, useState } from "react";
import { OMarketExportJobStatus, OMarketJobType } from "@prisma/client";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";

import { BackIcon, HideIcon, ViewIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "muted";

const O_MARKET_ATTRIBUTES_PLACEHOLDER = '[{"attribute_id":1,"value_id":1}]';

type ProductResult = {
  productId: string | null;
  sku: string;
  name: string | null;
  status: "pending" | "processing" | "exported" | "updated" | "skipped" | "failed";
  reason: string | null;
  oMarketProductId: number | null;
};

const statusVariant = (status?: string | null): BadgeVariant => {
  if (status === "READY" || status === "DONE" || status === "exported" || status === "updated") {
    return "success";
  }
  if (status === "ERROR" || status === "FAILED" || status === "failed") {
    return "danger";
  }
  if (status === "DRAFT" || status === "RUNNING" || status === "processing") {
    return "warning";
  }
  return "muted";
};

const formatDate = (value?: Date | string | null) => {
  if (!value) {
    return "Never";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Never";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const getProductResults = (value: unknown): ProductResult[] => {
  const rows = asRecord(value)?.productResults;
  if (!Array.isArray(rows)) {
    return [];
  }
  const mapped = rows
    .map((row) => {
      const record = asRecord(row);
      if (!record) {
        return null;
      }
      return {
        productId: typeof record.productId === "string" ? record.productId : null,
        sku: typeof record.sku === "string" ? record.sku : "",
        name: typeof record.name === "string" ? record.name : null,
        status:
          typeof record.status === "string"
            ? (record.status as ProductResult["status"])
            : "pending",
        reason: typeof record.reason === "string" ? record.reason : null,
        oMarketProductId:
          typeof record.oMarketProductId === "number" ? record.oMarketProductId : null,
      };
    })
    .filter((row): row is ProductResult => Boolean(row?.sku));
  return mapped;
};

const money = (value: number | null) =>
  value === null
    ? "Missing"
    : new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "KGS",
        maximumFractionDigits: 0,
      }).format(value);

const OMarketPage = () => {
  const t = useTranslations("integrations.oMarketPage");
  const { data: session } = useSession();
  const role = session?.user?.role;
  const canManage = role === "ADMIN" || role === "MANAGER";
  const { toast } = useToast();
  const trpcUtils = trpc.useUtils();

  const settingsQuery = trpc.oMarket.settings.useQuery();
  const [activeStoreId, setActiveStoreId] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api-market.o.kg");
  const [apiToken, setApiToken] = useState("");
  const [clearToken, setClearToken] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [storeMappings, setStoreMappings] = useState<Record<string, string>>({});
  const [categoryMappings, setCategoryMappings] = useState<
    Record<
      string,
      { oMarketCategoryId: string; oMarketCategoryName: string; attributesJson: string }
    >
  >({});
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<"all" | "included" | "excluded">("all");
  const [page, setPage] = useState(1);
  const [jobType, setJobType] = useState<OMarketJobType>(OMarketJobType.PRODUCT_EXPORT);

  useEffect(() => {
    const data = settingsQuery.data;
    if (!data) {
      return;
    }
    setBaseUrl(data.integration.baseUrl);
    setStoreMappings(
      Object.fromEntries(data.stores.map((store) => [store.storeId, store.locationId])),
    );
    setCategoryMappings(
      Object.fromEntries(
        data.categoryMappings.map((mapping) => [
          mapping.bazaarCategory,
          {
            oMarketCategoryId: mapping.oMarketCategoryId,
            oMarketCategoryName: mapping.oMarketCategoryName,
            attributesJson: mapping.attributesJson,
          },
        ]),
      ),
    );
    setActiveStoreId((current) => current || data.stores[0]?.storeId || "");
  }, [settingsQuery.data]);

  const productsQuery = trpc.oMarket.products.useQuery(
    {
      storeId: activeStoreId,
      search,
      selection,
      page,
      pageSize: 10,
    },
    { enabled: Boolean(activeStoreId) },
  );
  const preflightQuery = trpc.oMarket.preflight.useQuery(
    { storeId: activeStoreId, jobType },
    {
      enabled: Boolean(activeStoreId),
      refetchInterval: false,
    },
  );
  const jobsQuery = trpc.oMarket.jobs.useQuery(
    { limit: 25 },
    {
      refetchInterval: (data) =>
        data?.some(
          (job) =>
            job.status === OMarketExportJobStatus.QUEUED ||
            job.status === OMarketExportJobStatus.RUNNING,
        )
          ? 3000
          : false,
    },
  );
  const revealTokenQuery = trpc.oMarket.revealToken.useQuery(undefined, {
    enabled: false,
  });

  const activeStore = useMemo(
    () => settingsQuery.data?.stores.find((store) => store.storeId === activeStoreId) ?? null,
    [activeStoreId, settingsQuery.data?.stores],
  );

  const refresh = async () => {
    await Promise.all([
      trpcUtils.oMarket.overview.invalidate(),
      trpcUtils.oMarket.settings.invalidate(),
      trpcUtils.oMarket.products.invalidate(),
      trpcUtils.oMarket.preflight.invalidate(),
      trpcUtils.oMarket.jobs.invalidate(),
    ]);
  };

  const saveSettingsMutation = trpc.oMarket.saveSettings.useMutation({
    onSuccess: async () => {
      setApiToken("");
      setClearToken(false);
      toast({ variant: "success", description: t("toasts.settingsSaved") });
      await refresh();
    },
    onError: (error) => toast({ variant: "error", description: error.message }),
  });
  const revealSavedToken = async () => {
    const result = await revealTokenQuery.refetch();
    if (result.error) {
      toast({ variant: "error", description: result.error.message });
      return;
    }
    setApiToken(result.data?.apiToken ?? "");
    setShowToken(true);
  };
  const testConnectionMutation = trpc.oMarket.testConnection.useMutation({
    onSuccess: async (data) => {
      toast({ variant: "success", description: t("toasts.connectionChecked", { status: data.status }) });
      await refresh();
    },
    onError: (error) => toast({ variant: "error", description: error.message }),
  });
  const saveStoreMappingsMutation = trpc.oMarket.saveStoreMappings.useMutation({
    onSuccess: async () => {
      toast({ variant: "success", description: t("toasts.storeMappingSaved") });
      await refresh();
    },
    onError: (error) => toast({ variant: "error", description: error.message }),
  });
  const saveCategoryMappingsMutation = trpc.oMarket.saveCategoryMappings.useMutation({
    onSuccess: async () => {
      toast({ variant: "success", description: t("toasts.categoryMappingSaved") });
      await refresh();
    },
    onError: (error) => toast({ variant: "error", description: error.message }),
  });
  const updateProductsMutation = trpc.oMarket.updateProducts.useMutation({
    onSuccess: async (data) => {
      toast({ variant: "success", description: t("toasts.productsUpdated", { count: data.updatedCount }) });
      await refresh();
    },
    onError: (error) => toast({ variant: "error", description: error.message }),
  });
  const exportMutation = trpc.oMarket.exportNow.useMutation({
    onSuccess: async () => {
      toast({ variant: "success", description: t("toasts.exportQueued") });
      await refresh();
    },
    onError: (error) => toast({ variant: "error", description: error.message }),
  });
  const exportReadyMutation = trpc.oMarket.exportReadyNow.useMutation({
    onSuccess: async () => {
      toast({ variant: "success", description: t("toasts.readyExportQueued") });
      await refresh();
    },
    onError: (error) => toast({ variant: "error", description: error.message }),
  });
  const stockPriceMutation = trpc.oMarket.syncStockPriceNow.useMutation({
    onSuccess: async () => {
      toast({ variant: "success", description: t("toasts.stockPriceQueued") });
      await refresh();
    },
    onError: (error) => toast({ variant: "error", description: error.message }),
  });
  const fullSyncMutation = trpc.oMarket.fullSyncNow.useMutation({
    onSuccess: async () => {
      toast({ variant: "success", description: t("toasts.fullSyncQueued") });
      await refresh();
    },
    onError: (error) => toast({ variant: "error", description: error.message }),
  });

  const preflight = preflightQuery.data;
  const canRunAll = Boolean(preflight?.actionability.canRunAll);
  const canRunReadyOnly = Boolean(preflight?.actionability.canRunReadyOnly);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <Card className="bazaar-admin-surface">
          <CardHeader className="border-b border-border/60 bg-muted/20">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{t("connection.title")}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("connection.description")}
                </p>
              </div>
              <Badge variant={statusVariant(settingsQuery.data?.integration.status)}>
                {settingsQuery.data?.integration.status ?? t("common.loading")}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs uppercase text-muted-foreground">{t("connection.token")}</p>
              <p className="mt-1 font-medium">
                {settingsQuery.data?.integration.hasToken ? t("common.saved") : t("common.missing")}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">{t("connection.baseUrl")}</p>
              <p className="mt-1 break-all font-medium">
                {settingsQuery.data?.integration.baseUrl ?? "https://api-market.o.kg"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">{t("connection.lastSync")}</p>
              <p className="mt-1 font-medium">
                {formatDate(settingsQuery.data?.integration.lastSyncAt)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">{t("connection.lastCheck")}</p>
              <p className="mt-1 font-medium">
                {formatDate(settingsQuery.data?.integration.lastConnectionCheckAt)}
              </p>
            </div>
            {settingsQuery.data?.integration.mockMode ? (
              <div className="sm:col-span-2 lg:col-span-4">
                <Badge variant="warning">{t("connection.mockMode")}</Badge>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="bazaar-admin-surface">
          <CardHeader className="border-b border-border/60 bg-muted/20">
            <CardTitle>{t("credentials.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            <div className="space-y-2">
              <Label htmlFor="o-market-base-url">{t("credentials.baseUrl")}</Label>
              <Input
                id="o-market-base-url"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                disabled={!canManage}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="o-market-token">{t("credentials.token")}</Label>
              <div className="flex gap-2">
                <Input
                  id="o-market-token"
                  type={showToken ? "text" : "password"}
                  value={apiToken}
                  placeholder={
                    settingsQuery.data?.integration.hasToken
                      ? t("credentials.tokenSavedPlaceholder")
                      : t("credentials.tokenPlaceholder")
                  }
                  onChange={(event) => setApiToken(event.target.value)}
                  disabled={!canManage}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={!canManage}
                  onClick={() =>
                    showToken
                      ? setShowToken(false)
                      : settingsQuery.data?.integration.hasToken
                        ? void revealSavedToken()
                        : setShowToken(true)
                  }
                  aria-label={showToken ? t("credentials.hideToken") : t("credentials.revealToken")}
                >
                  {showToken ? <HideIcon className="h-4 w-4" /> : <ViewIcon className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={clearToken}
                onCheckedChange={(checked) => setClearToken(Boolean(checked))}
                disabled={!canManage}
              />
              {t("credentials.clearToken")}
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={!canManage || saveSettingsMutation.isLoading}
                onClick={() =>
                  saveSettingsMutation.mutate({
                    baseUrl,
                    apiToken: apiToken.trim() || null,
                    clearToken,
                  })
                }
              >
                {t("credentials.saveSettings")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!canManage || testConnectionMutation.isLoading}
                onClick={() => testConnectionMutation.mutate()}
              >
                {t("credentials.testConnection")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="bazaar-admin-surface">
          <CardHeader className="border-b border-border/60 bg-muted/20">
            <CardTitle>{t("storeMapping.title")}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {t("storeMapping.description")}
            </p>
          </CardHeader>
          <CardContent className="space-y-3 p-5">
            {(settingsQuery.data?.stores ?? []).map((store) => (
              <div key={store.storeId} className="grid gap-2 sm:grid-cols-[1fr_180px]">
                <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
                  {store.storeName}
                </div>
                <Input
                  value={storeMappings[store.storeId] ?? ""}
                  inputMode="numeric"
                  placeholder={t("storeMapping.locationPlaceholder")}
                  disabled={!canManage}
                  onChange={(event) =>
                    setStoreMappings((current) => ({
                      ...current,
                      [store.storeId]: event.target.value,
                    }))
                  }
                />
              </div>
            ))}
            <Button
              type="button"
              disabled={!canManage || saveStoreMappingsMutation.isLoading}
              onClick={() =>
                saveStoreMappingsMutation.mutate({
                  mappings: (settingsQuery.data?.stores ?? []).map((store) => ({
                    storeId: store.storeId,
                    locationId: storeMappings[store.storeId] ?? "",
                  })),
                })
              }
            >
              {t("storeMapping.save")}
            </Button>
          </CardContent>
        </Card>

        <Card className="bazaar-admin-surface">
          <CardHeader className="border-b border-border/60 bg-muted/20">
            <CardTitle>{t("categoryMapping.title")}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {t("categoryMapping.description")}
            </p>
          </CardHeader>
          <CardContent className="max-h-[520px] space-y-3 overflow-y-auto p-5">
            {(settingsQuery.data?.categoryMappings ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("categoryMapping.empty")}</p>
            ) : null}
            {(settingsQuery.data?.categoryMappings ?? []).map((mapping) => {
              const state = categoryMappings[mapping.bazaarCategory] ?? {
                oMarketCategoryId: "",
                oMarketCategoryName: "",
                attributesJson: "",
              };
              return (
                <div key={mapping.bazaarCategory} className="space-y-2 rounded-md border p-3">
                  <p className="font-medium">{mapping.bazaarCategory}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      value={state.oMarketCategoryId}
                      inputMode="numeric"
                      placeholder={t("categoryMapping.categoryIdPlaceholder")}
                      disabled={!canManage}
                      onChange={(event) =>
                        setCategoryMappings((current) => ({
                          ...current,
                          [mapping.bazaarCategory]: {
                            ...state,
                            oMarketCategoryId: event.target.value,
                          },
                        }))
                      }
                    />
                    <Input
                      value={state.oMarketCategoryName}
                      placeholder={t("categoryMapping.categoryNamePlaceholder")}
                      disabled={!canManage}
                      onChange={(event) =>
                        setCategoryMappings((current) => ({
                          ...current,
                          [mapping.bazaarCategory]: {
                            ...state,
                            oMarketCategoryName: event.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                  <Textarea
                    value={state.attributesJson}
                    placeholder={O_MARKET_ATTRIBUTES_PLACEHOLDER}
                    disabled={!canManage}
                    onChange={(event) =>
                      setCategoryMappings((current) => ({
                        ...current,
                        [mapping.bazaarCategory]: {
                          ...state,
                          attributesJson: event.target.value,
                        },
                      }))
                    }
                  />
                </div>
              );
            })}
            <Button
              type="button"
              disabled={!canManage || saveCategoryMappingsMutation.isLoading}
              onClick={() =>
                saveCategoryMappingsMutation.mutate({
                  mappings: (settingsQuery.data?.categoryMappings ?? []).map((mapping) => ({
                    bazaarCategory: mapping.bazaarCategory,
                    oMarketCategoryId:
                      categoryMappings[mapping.bazaarCategory]?.oMarketCategoryId ?? "",
                    oMarketCategoryName:
                      categoryMappings[mapping.bazaarCategory]?.oMarketCategoryName ?? "",
                    attributesJson:
                      categoryMappings[mapping.bazaarCategory]?.attributesJson ?? "",
                  })),
                })
              }
            >
              {t("categoryMapping.save")}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="bazaar-admin-surface">
        <CardHeader className="border-b border-border/60 bg-muted/20">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{t("productExport.title")}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("productExport.description")}
              </p>
            </div>
            <div className="flex min-w-[240px] flex-col gap-2 sm:flex-row">
              <Select value={activeStoreId} onValueChange={setActiveStoreId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("productExport.selectStore")} />
                </SelectTrigger>
                <SelectContent>
                  {(settingsQuery.data?.stores ?? []).map((store) => (
                    <SelectItem key={store.storeId} value={store.storeId}>
                      {store.storeName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={jobType} onValueChange={(value) => setJobType(value as OMarketJobType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={OMarketJobType.PRODUCT_EXPORT}>
                    {t("productExport.productExport")}
                  </SelectItem>
                  <SelectItem value={OMarketJobType.STOCK_PRICE_SYNC}>
                    {t("productExport.stockPrice")}
                  </SelectItem>
                  <SelectItem value={OMarketJobType.FULL_SYNC}>
                    {t("productExport.fullSync")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase text-muted-foreground">{t("productExport.store")}</p>
              <p className="mt-1 font-medium">{activeStore?.storeName ?? t("productExport.selectStore")}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase text-muted-foreground">{t("productExport.considered")}</p>
              <p className="mt-1 font-medium">{preflight?.summary.productsConsidered ?? 0}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase text-muted-foreground">{t("productExport.ready")}</p>
              <p className="mt-1 font-medium">{preflight?.summary.productsReady ?? 0}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase text-muted-foreground">{t("productExport.failedSkipped")}</p>
              <p className="mt-1 font-medium">{preflight?.summary.productsFailed ?? 0}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={!canManage || !canRunAll || exportMutation.isLoading}
              onClick={() => exportMutation.mutate({ storeId: activeStoreId })}
            >
              {t("productExport.exportSelected")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!canManage || !canRunReadyOnly || exportReadyMutation.isLoading}
              onClick={() => exportReadyMutation.mutate({ storeId: activeStoreId })}
            >
              {t("productExport.exportReady")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!canManage || !canRunReadyOnly || stockPriceMutation.isLoading}
              onClick={() => stockPriceMutation.mutate({ storeId: activeStoreId })}
            >
              {t("productExport.syncStockPrice")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!canManage || !canRunAll || fullSyncMutation.isLoading}
              onClick={() => fullSyncMutation.mutate({ storeId: activeStoreId })}
            >
              {t("productExport.fullSync")}
            </Button>
          </div>

          {preflight?.warnings.global.includes("FULL_SYNC_DEACTIVATES_MISSING_PRODUCTS") ? (
            <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              {t("productExport.fullSyncWarning")}
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <div className="space-y-3">
              <Input
                value={search}
                placeholder={t("productExport.searchPlaceholder")}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
              <Select
                value={selection}
                onValueChange={(value) => {
                  setSelection(value as typeof selection);
                  setPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("productExport.allProducts")}</SelectItem>
                  <SelectItem value="included">{t("productExport.included")}</SelectItem>
                  <SelectItem value="excluded">{t("productExport.excluded")}</SelectItem>
                </SelectContent>
              </Select>
              <div className="rounded-md border p-3 text-sm text-muted-foreground">
                {t("productExport.storeScopeNote", {
                  store: activeStore?.storeName ?? t("productExport.selectedStore"),
                })}
              </div>
            </div>

            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("table.product")}</TableHead>
                    <TableHead>{t("table.category")}</TableHead>
                    <TableHead>{t("table.price")}</TableHead>
                    <TableHead>{t("table.stock")}</TableHead>
                    <TableHead>{t("table.status")}</TableHead>
                    <TableHead>{t("table.action")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(productsQuery.data?.items ?? []).map((product) => (
                    <TableRow key={product.id}>
                      <TableCell>
                        <div className="flex min-w-[220px] items-center gap-3">
                          {product.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={product.imageUrl}
                              alt=""
                              className="h-10 w-10 rounded-md object-cover"
                            />
                          ) : (
                            <div className="h-10 w-10 rounded-md border bg-muted" />
                          )}
                          <div className="min-w-0">
                            <p className="truncate font-medium">{product.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{product.sku}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{product.category ?? t("common.missing")}</TableCell>
                      <TableCell>{money(product.priceKgs)}</TableCell>
                      <TableCell>{product.onHandQty}</TableCell>
                      <TableCell>
                        <Badge variant={product.included ? "success" : "muted"}>
                          {product.exportStatus}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          size="sm"
                          variant={product.included ? "outline" : "secondary"}
                          disabled={!canManage || updateProductsMutation.isLoading}
                          onClick={() =>
                            updateProductsMutation.mutate({
                              storeId: activeStoreId,
                              productIds: [product.id],
                              included: !product.included,
                            })
                          }
                        >
                          {product.included ? t("productExport.exclude") : t("productExport.include")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </div>
          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <BackIcon className="h-4 w-4" />
              {t("pagination.previous")}
            </Button>
            <span className="text-sm text-muted-foreground">
              {t("pagination.pageOf", {
                page: productsQuery.data?.page ?? page,
                total: Math.max(1, Math.ceil((productsQuery.data?.total ?? 0) / 10)),
              })}
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={(productsQuery.data?.page ?? page) >= Math.ceil((productsQuery.data?.total ?? 0) / 10)}
              onClick={() => setPage((current) => current + 1)}
            >
              {t("pagination.next")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bazaar-admin-surface">
        <CardHeader className="border-b border-border/60 bg-muted/20">
          <CardTitle>{t("validation.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-5">
          {preflightQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">{t("validation.loading")}</p>
          ) : null}
          {preflight && preflight.blockers.total === 0 ? (
            <Badge variant="success">{t("validation.noBlockers")}</Badge>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {Object.entries(preflight?.blockers.byCode ?? {}).map(([code, count]) => (
              <Badge key={code} variant="danger">
                {code}: {count}
              </Badge>
            ))}
            {Object.entries(preflight?.warnings.byCode ?? {}).map(([code, count]) => (
              <Badge key={code} variant="warning">
                {code}: {count}
              </Badge>
            ))}
          </div>
          {(preflight?.failedProducts ?? []).length ? (
            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("table.sku")}</TableHead>
                    <TableHead>{t("table.name")}</TableHead>
                    <TableHead>{t("table.reason")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(preflight?.failedProducts ?? []).slice(0, 20).map((product) => (
                    <TableRow key={product.productId}>
                      <TableCell>{product.sku || t("common.missing")}</TableCell>
                      <TableCell>{product.name}</TableCell>
                      <TableCell>{product.issues.join(", ")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : null}
        </CardContent>
      </Card>

      <Card className="bazaar-admin-surface">
        <CardHeader className="border-b border-border/60 bg-muted/20">
          <CardTitle>{t("jobs.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-5">
          {(jobsQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("jobs.empty")}</p>
          ) : null}
          {(jobsQuery.data ?? []).map((job) => {
            const results = getProductResults(job.responseJson);
            return (
              <div key={job.id} className="space-y-3 rounded-md border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{job.jobType}</p>
                    <p className="text-sm text-muted-foreground">
                      {t("jobs.createdBy", {
                        date: formatDate(job.createdAt),
                        user: job.requestedBy?.name ?? t("jobs.userFallback"),
                      })}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
                    <Badge variant="muted">
                      {t("jobs.counts", {
                        ok: job.succeededCount ?? 0,
                        failed: job.failedCount ?? 0,
                        skipped: job.skippedCount ?? 0,
                      })}
                    </Badge>
                  </div>
                </div>
                {results.length ? (
                  <TableContainer>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("table.sku")}</TableHead>
                          <TableHead>{t("table.product")}</TableHead>
                          <TableHead>{t("table.status")}</TableHead>
                          <TableHead>{t("table.reason")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {results.slice(0, 50).map((result) => (
                          <TableRow key={`${job.id}-${result.sku}`}>
                            <TableCell>{result.sku}</TableCell>
                            <TableCell>{result.name ?? ""}</TableCell>
                            <TableCell>
                              <Badge variant={statusVariant(result.status)}>
                                {result.status}
                              </Badge>
                            </TableCell>
                            <TableCell>{result.reason ?? ""}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
};

export default OMarketPage;

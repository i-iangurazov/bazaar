"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";

import { PageHeader } from "@/components/page-header";
import { ReceiptPreviewModal } from "@/components/pos/receipt-preview-modal";
import { BackIcon, DownloadIcon, SearchIcon, ViewIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { baseAccountingCurrency, formatKgsMoney } from "@/lib/currencyDisplay";
import { downloadTableFile, type DownloadFormat } from "@/lib/fileExport";
import { formatDate, formatDateTime, formatNumber } from "@/lib/i18nFormat";
import { defaultTimeZone } from "@/lib/timezone";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { cn } from "@/lib/utils";

type Preset = "today" | "yesterday" | "last7" | "last30" | "thisMonth" | "lastMonth";
type SelectedPreset = Preset | "custom";
type SalesPoint = {
  date: string;
  grossSalesKgs: number;
  returnsKgs: number;
  netSalesKgs: number;
  receiptCount: number;
  averageReceiptKgs: number;
};

const paymentMethods = ["CASH", "CARD", "TRANSFER", "OTHER"] as const;
const pageSize = 25;

const dateOnlyFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: defaultTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const formatDateInput = (value: Date) => {
  const parts = dateOnlyFormatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
};

const parseDateOnly = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
};

const addDays = (dateOnly: string, days: number) => {
  const { year, month, day } = parseDateOnly(dateOnly);
  return new Date(Date.UTC(year, month - 1, day + days, 0, 0, 0, 0)).toISOString().slice(0, 10);
};

const dateOnlyToDisplayDate = (dateOnly: string) => {
  const { year, month, day } = parseDateOnly(dateOnly);
  return new Date(Date.UTC(year, month - 1, day, 6, 0, 0, 0));
};

const monthBounds = (dateOnly: string, offsetMonths = 0) => {
  const { year, month } = parseDateOnly(dateOnly);
  const start = new Date(Date.UTC(year, month - 1 + offsetMonths, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month + offsetMonths, 0, 0, 0, 0, 0));
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
};

const buildPresetRange = (preset: Preset) => {
  const today = formatDateInput(new Date());
  if (preset === "today") {
    return { from: today, to: today };
  }
  if (preset === "yesterday") {
    const yesterday = addDays(today, -1);
    return { from: yesterday, to: yesterday };
  }
  if (preset === "last7") {
    return { from: addDays(today, -6), to: today };
  }
  if (preset === "thisMonth") {
    return monthBounds(today);
  }
  if (preset === "lastMonth") {
    return monthBounds(today, -1);
  }
  return { from: addDays(today, -29), to: today };
};

const AnalyticsPage = () => {
  const t = useTranslations("analytics");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const tPos = useTranslations("pos");
  const tExports = useTranslations("exports");
  const locale = useLocale();
  const { data: session, status } = useSession();
  const role = session?.user?.role ?? "STAFF";
  const canView = role === "ADMIN" || role === "MANAGER";

  const initialRange = useMemo(() => buildPresetRange("last30"), []);
  const [storeId, setStoreId] = useState(canView ? "all" : "");
  const [registerId, setRegisterId] = useState("all");
  const [cashierId, setCashierId] = useState("all");
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);
  const [preset, setPreset] = useState<SelectedPreset>("last30");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [productPage, setProductPage] = useState(1);
  const [downloadFormat, setDownloadFormat] = useState<DownloadFormat>("csv");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<{
    productId: string;
    variantKey: string;
    name: string;
  } | null>(null);
  const [previewSaleId, setPreviewSaleId] = useState<string | null>(null);

  const storesQuery = trpc.stores.list.useQuery(undefined, {
    enabled: status === "authenticated" && canView,
  });

  useEffect(() => {
    if (storeId || !storesQuery.data?.length) {
      return;
    }
    setStoreId(canView ? "all" : storesQuery.data[0].id);
  }, [canView, storeId, storesQuery.data]);

  const resolvedStoreId = storeId === "all" ? undefined : storeId || undefined;
  const selectedStore = resolvedStoreId
    ? storesQuery.data?.find((store) => store.id === resolvedStoreId) ?? null
    : null;
  const currencySource = selectedStore ?? baseAccountingCurrency;
  const commonAnalyticsInput = {
    storeId: resolvedStoreId,
    registerId: registerId === "all" ? undefined : registerId,
    cashierId: cashierId === "all" ? undefined : cashierId,
    dateFrom,
    dateTo,
  };
  const analyticsEnabled = status === "authenticated" && canView && Boolean(storeId);

  const registersQuery = trpc.pos.registers.list.useQuery(
    {
      storeId: resolvedStoreId,
      status: "all",
    },
    { enabled: analyticsEnabled },
  );
  const cashiersQuery = trpc.pos.cashiers.list.useQuery(
    { storeId: resolvedStoreId },
    { enabled: analyticsEnabled },
  );
  const overviewQuery = trpc.analytics.salesOverview.useQuery(commonAnalyticsInput, {
    enabled: analyticsEnabled,
    keepPreviousData: true,
  });
  const filterOptionsQuery = trpc.analytics.salesFilterOptions.useQuery(commonAnalyticsInput, {
    enabled: analyticsEnabled,
    keepPreviousData: true,
  });
  const soldProductsQuery = trpc.analytics.soldProducts.useQuery(
    {
      ...commonAnalyticsInput,
      category: category === "all" ? undefined : category,
      search: deferredSearch || undefined,
      page: productPage,
      pageSize,
    },
    {
      enabled: analyticsEnabled,
      keepPreviousData: true,
    },
  );
  const dayDetailQuery = trpc.analytics.salesDayDetail.useQuery(
    {
      storeId: resolvedStoreId,
      registerId: registerId === "all" ? undefined : registerId,
      cashierId: cashierId === "all" ? undefined : cashierId,
      date: selectedDay ?? dateFrom,
    },
    {
      enabled: analyticsEnabled && Boolean(selectedDay),
      keepPreviousData: false,
    },
  );
  const productReceiptsQuery = trpc.analytics.productReceipts.useQuery(
    {
      ...commonAnalyticsInput,
      productId: selectedProduct?.productId ?? "",
      variantKey: selectedProduct?.variantKey,
      page: 1,
      pageSize: 100,
    },
    {
      enabled: analyticsEnabled && Boolean(selectedProduct),
      keepPreviousData: false,
    },
  );

  useEffect(() => {
    setRegisterId("all");
    setCashierId("all");
  }, [storeId]);

  useEffect(() => {
    if (registerId === "all") {
      return;
    }
    const exists = (registersQuery.data ?? []).some((register) => register.id === registerId);
    if (!exists && registersQuery.data) {
      setRegisterId("all");
    }
  }, [registerId, registersQuery.data]);

  useEffect(() => {
    setProductPage(1);
  }, [dateFrom, dateTo, storeId, registerId, cashierId, category, deferredSearch]);

  const chartData = (overviewQuery.data?.series ?? []) as SalesPoint[];
  const totals = overviewQuery.data?.totals;
  const soldProducts = soldProductsQuery.data?.items ?? [];
  const productTotal = soldProductsQuery.data?.total ?? 0;
  const productPages = Math.max(1, Math.ceil(productTotal / pageSize));
  const categories = filterOptionsQuery.data?.categories ?? [];

  const applyPreset = (nextPreset: Preset) => {
    const range = buildPresetRange(nextPreset);
    setPreset(nextPreset);
    setDateFrom(range.from);
    setDateTo(range.to);
  };

  const handleCustomDate = (field: "from" | "to", value: string) => {
    setPreset("custom");
    if (field === "from") {
      setDateFrom(value);
    } else {
      setDateTo(value);
    }
  };

  const handleExportProducts = () => {
    downloadTableFile({
      format: downloadFormat,
      fileNameBase: `sold-products-${dateFrom}-${dateTo}`,
      header: [
        "productName",
        "sku",
        "barcode",
        "category",
        "quantitySold",
        "quantityReturned",
        "netQuantity",
        "grossRevenue",
        "returns",
        "netRevenue",
        "averagePrice",
        "stockRemaining",
        "receiptCount",
      ],
      rows: soldProducts.map((product) => [
        product.productName,
        product.productSku,
        product.barcode ?? "",
        product.category ?? "",
        String(product.quantitySold),
        String(product.quantityReturned),
        String(product.netQuantity),
        formatKgsMoney(product.grossRevenueKgs, locale, currencySource),
        formatKgsMoney(product.returnedRevenueKgs, locale, currencySource),
        formatKgsMoney(product.netRevenueKgs, locale, currencySource),
        formatKgsMoney(product.averagePriceKgs, locale, currencySource),
        String(product.stockRemaining),
        String(product.receiptCount),
      ]),
    });
  };

  const renderMoney = (value: number) => formatKgsMoney(value, locale, currencySource);

  const ChartTooltip = ({ active, payload, label }: TooltipProps<number, string>) => {
    if (!active || !payload?.length) {
      return null;
    }
    const point = payload[0]?.payload as SalesPoint | undefined;
    return (
      <div className="rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground shadow-lg">
        <p className="font-semibold text-foreground">
          {formatDate(dateOnlyToDisplayDate(String(label)), locale)}
        </p>
        {point ? (
          <div className="mt-2 space-y-1">
            <p>{t("chart.netSales")}: {renderMoney(point.netSalesKgs)}</p>
            <p>{t("chart.grossSales")}: {renderMoney(point.grossSalesKgs)}</p>
            <p>{t("chart.returns")}: {renderMoney(point.returnsKgs)}</p>
            <p>{t("chart.receipts")}: {formatNumber(point.receiptCount, locale)}</p>
            <p>{t("chart.averageReceipt")}: {renderMoney(point.averageReceiptKgs)}</p>
          </div>
        ) : null}
      </div>
    );
  };

  if (status === "loading") {
    return <Skeleton className="h-[28rem] w-full" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <Button asChild variant="secondary">
            <Link href="/reports">
              <BackIcon className="h-4 w-4" aria-hidden />
              {t("backToReports")}
            </Link>
          </Button>
        }
      />
      {storeId === "all" ? (
        <p className="-mt-4 text-sm text-muted-foreground">{t("baseCurrencyNotice")}</p>
      ) : null}

      {!canView ? (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          {tErrors("forbidden")}
        </div>
      ) : (
        <>
          <Card className="bazaar-admin-surface">
            <CardHeader className="bazaar-admin-section-header px-4 py-3 sm:px-5">
              <CardTitle className="text-base">{t("filters.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-4 sm:p-5">
              <div className="grid gap-3 md:grid-cols-[minmax(160px,1fr)_minmax(160px,1fr)_minmax(160px,1fr)_minmax(160px,1fr)]">
                <label className="space-y-1.5 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">{t("filters.store")}</span>
                  <Select value={storeId || "all"} onValueChange={setStoreId}>
                    <SelectTrigger>
                      <SelectValue placeholder={tCommon("selectStore")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("allStores")}</SelectItem>
                      {(storesQuery.data ?? []).map((store) => (
                        <SelectItem key={store.id} value={store.id}>
                          {store.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">{t("filters.register")}</span>
                  <Select value={registerId} onValueChange={setRegisterId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("filters.allRegisters")}</SelectItem>
                      {(registersQuery.data ?? []).map((register) => (
                        <SelectItem key={register.id} value={register.id}>
                          {register.name} ({register.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">{t("filters.cashier")}</span>
                  <Select value={cashierId} onValueChange={setCashierId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("filters.allCashiers")}</SelectItem>
                      {(cashiersQuery.data ?? []).map((cashier) => (
                        <SelectItem key={cashier.id} value={cashier.id}>
                          {cashier.name ?? cashier.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">{t("filters.category")}</span>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("filters.allCategories")}</SelectItem>
                      {categories.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              </div>

              <div className="grid gap-3 lg:grid-cols-[140px_140px_minmax(220px,1fr)]">
                <label className="space-y-1.5 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">{t("filters.dateFrom")}</span>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(event) => handleCustomDate("from", event.target.value)}
                  />
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">{t("filters.dateTo")}</span>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(event) => handleCustomDate("to", event.target.value)}
                  />
                </label>
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">{t("filters.presets")}</span>
                  <div className="flex flex-wrap gap-2">
                    {(["today", "yesterday", "last7", "last30", "thisMonth", "lastMonth"] as Preset[]).map(
                      (item) => (
                        <Button
                          key={item}
                          type="button"
                          variant={preset === item ? "primary" : "outline"}
                          size="sm"
                          onClick={() => applyPreset(item)}
                        >
                          {t(`presets.${item}`)}
                        </Button>
                      ),
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <label className="relative flex-1 space-y-1.5 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">{t("filters.productSearch")}</span>
                  <SearchIcon className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t("filters.productSearchPlaceholder")}
                    className="pl-9"
                  />
                </label>
                <div className="flex gap-2">
                  <Select value={downloadFormat} onValueChange={(value) => setDownloadFormat(value as DownloadFormat)}>
                    <SelectTrigger className="w-[120px]" aria-label={tExports("formatLabel")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="csv">{tExports("formats.csv")}</SelectItem>
                      <SelectItem value="xlsx">{tExports("formats.xlsx")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleExportProducts}
                    disabled={!soldProducts.length}
                  >
                    <DownloadIcon className="h-4 w-4" aria-hidden />
                    {t("actions.exportProducts")}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {overviewQuery.error ? (
            <div className="rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
              {translateError(tErrors, overviewQuery.error)}
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            {[
              { label: t("kpis.netSales"), value: renderMoney(totals?.netSalesKgs ?? 0), emphasis: true },
              { label: t("kpis.grossSales"), value: renderMoney(totals?.grossSalesKgs ?? 0) },
              { label: t("kpis.returns"), value: renderMoney(totals?.returnsKgs ?? 0) },
              { label: t("kpis.receipts"), value: formatNumber(totals?.receiptCount ?? 0, locale) },
              { label: t("kpis.averageReceipt"), value: renderMoney(totals?.averageReceiptKgs ?? 0) },
              { label: t("kpis.nonCash"), value: renderMoney(totals?.nonCashSalesKgs ?? 0) },
            ].map((item) => (
              <div
                key={item.label}
                className={cn(
                  "rounded-md border border-border bg-card p-4 shadow-sm",
                  item.emphasis ? "border-primary/35 bg-primary/5" : null,
                )}
              >
                <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
                {overviewQuery.isLoading ? (
                  <Skeleton className="mt-3 h-7 w-28" />
                ) : (
                  <p className="mt-2 text-xl font-semibold text-foreground">{item.value}</p>
                )}
              </div>
            ))}
          </div>

          <Card className="bazaar-admin-surface overflow-hidden">
            <CardHeader className="bazaar-admin-section-header flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <CardTitle className="text-base">{t("chart.title")}</CardTitle>
                <p className="text-xs text-muted-foreground">{t("chart.subtitle")}</p>
              </div>
              {overviewQuery.data ? (
                <Badge variant="muted">{overviewQuery.data.range.timeZone}</Badge>
              ) : null}
            </CardHeader>
            <CardContent className="p-4 sm:p-5">
              {overviewQuery.isLoading ? (
                <Skeleton className="h-[22rem] w-full" />
              ) : chartData.some((point) => point.grossSalesKgs || point.returnsKgs || point.receiptCount) ? (
                <div className="h-[22rem] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => String(value).slice(5)}
                        fontSize={12}
                      />
                      <YAxis yAxisId="sales" tickLine={false} axisLine={false} width={64} fontSize={12} />
                      <YAxis
                        yAxisId="receipts"
                        orientation="right"
                        tickLine={false}
                        axisLine={false}
                        width={42}
                        fontSize={12}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend />
                      <Bar
                        yAxisId="sales"
                        dataKey="netSalesKgs"
                        name={t("chart.netSales")}
                        fill="hsl(var(--primary))"
                        radius={[4, 4, 0, 0]}
                        cursor="pointer"
                        onClick={(event: unknown) => {
                          const payload = event as { payload?: { date?: string } };
                          if (payload.payload?.date) {
                            setSelectedDay(payload.payload.date);
                          }
                        }}
                      />
                      <Line
                        yAxisId="receipts"
                        type="monotone"
                        dataKey="receiptCount"
                        name={t("chart.receipts")}
                        stroke="hsl(var(--warning))"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        activeDot={{
                          r: 6,
                          onClick: (_event: unknown, payload: unknown) => {
                            const point = payload as { payload?: { date?: string } };
                            if (point.payload?.date) {
                              setSelectedDay(point.payload.date);
                            }
                          },
                        }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="bazaar-admin-empty min-h-[18rem]">{t("emptySales")}</div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Card className="bazaar-admin-surface overflow-hidden">
              <CardHeader className="bazaar-admin-section-header flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div>
                  <CardTitle className="text-base">{t("products.title")}</CardTitle>
                  <p className="text-xs text-muted-foreground">{t("products.subtitle")}</p>
                </div>
                {!soldProductsQuery.isLoading ? (
                  <p className="text-xs text-muted-foreground">
                    {t("products.count", { count: productTotal })}
                  </p>
                ) : null}
              </CardHeader>
              <CardContent className="p-0">
                {soldProductsQuery.isLoading ? (
                  <div className="space-y-2 p-4 sm:p-5">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <Skeleton key={index} className="h-12 w-full" />
                    ))}
                  </div>
                ) : soldProductsQuery.error ? (
                  <div className="m-4 rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-danger sm:m-5">
                    {translateError(tErrors, soldProductsQuery.error)}
                  </div>
                ) : soldProducts.length ? (
                  <>
                    <div className="overflow-x-auto">
                      <Table className="min-w-[1080px]" sortable={false}>
                        <TableHeader className="bg-muted/40">
                          <TableRow>
                            <TableHead className="px-4 py-3">{t("products.columns.product")}</TableHead>
                            <TableHead className="px-4 py-3">{t("products.columns.sku")}</TableHead>
                            <TableHead className="px-4 py-3 text-right">{t("products.columns.quantity")}</TableHead>
                            <TableHead className="px-4 py-3 text-right">{t("products.columns.revenue")}</TableHead>
                            <TableHead className="px-4 py-3 text-right">{t("products.columns.averagePrice")}</TableHead>
                            <TableHead className="px-4 py-3 text-right">{t("products.columns.stock")}</TableHead>
                            <TableHead className="px-4 py-3 text-right">{t("products.columns.receipts")}</TableHead>
                            <TableHead className="px-4 py-3 text-right">{t("products.columns.actions")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {soldProducts.map((product) => (
                            <TableRow key={`${product.productId}:${product.variantKey}`}>
                              <TableCell className="px-4 py-3">
                                <div className="font-medium text-foreground">{product.productName}</div>
                                <div className="text-xs text-muted-foreground">
                                  {product.variantName ?? product.category ?? tCommon("notAvailable")}
                                </div>
                              </TableCell>
                              <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                                <div>{product.productSku}</div>
                                {product.barcode ? <div>{product.barcode}</div> : null}
                              </TableCell>
                              <TableCell className="px-4 py-3 text-right">
                                <div className="font-medium text-foreground">
                                  {formatNumber(product.quantitySold, locale)}
                                </div>
                                {product.quantityReturned > 0 ? (
                                  <div className="text-xs text-warning">
                                    -{formatNumber(product.quantityReturned, locale)} {t("products.returned")}
                                  </div>
                                ) : null}
                              </TableCell>
                              <TableCell className="px-4 py-3 text-right">
                                <div className="font-semibold text-foreground">
                                  {renderMoney(product.netRevenueKgs)}
                                </div>
                                {product.returnedRevenueKgs > 0 ? (
                                  <div className="text-xs text-warning">
                                    {t("products.returns")}: {renderMoney(product.returnedRevenueKgs)}
                                  </div>
                                ) : null}
                              </TableCell>
                              <TableCell className="px-4 py-3 text-right">
                                {renderMoney(product.averagePriceKgs)}
                              </TableCell>
                              <TableCell className="px-4 py-3 text-right">
                                {formatNumber(product.stockRemaining, locale)}
                              </TableCell>
                              <TableCell className="px-4 py-3 text-right">
                                {formatNumber(product.receiptCount, locale)}
                              </TableCell>
                              <TableCell className="px-4 py-3">
                                <div className="flex justify-end gap-2">
                                  <Button asChild variant="outline" size="sm">
                                    <Link href={`/products/${product.productId}`}>
                                      {t("actions.openProduct")}
                                    </Link>
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      setSelectedProduct({
                                        productId: product.productId,
                                        variantKey: product.variantKey,
                                        name: product.productName,
                                      })
                                    }
                                  >
                                    <ViewIcon className="h-4 w-4" aria-hidden />
                                    {t("actions.showReceipts")}
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="flex flex-col gap-2 border-t border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs text-muted-foreground">
                        {t("products.page", { page: productPage, pages: productPages })}
                      </p>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={productPage <= 1}
                          onClick={() => setProductPage((page) => Math.max(1, page - 1))}
                        >
                          {tCommon("pagination.previous")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={productPage >= productPages}
                          onClick={() => setProductPage((page) => Math.min(productPages, page + 1))}
                        >
                          {tCommon("pagination.next")}
                        </Button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="bazaar-admin-empty m-4 min-h-[12rem] sm:m-5">
                    {t("emptyTopProducts")}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card className="bazaar-admin-surface overflow-hidden">
                <CardHeader className="bazaar-admin-section-header px-4 py-3 sm:px-5">
                  <CardTitle className="text-base">{t("dayTable.title")}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {overviewQuery.isLoading ? (
                    <div className="space-y-2 p-4">
                      {Array.from({ length: 5 }).map((_, index) => (
                        <Skeleton key={index} className="h-10 w-full" />
                      ))}
                    </div>
                  ) : chartData.length ? (
                    <div className="max-h-[30rem] overflow-y-auto">
                      <Table sortable={false}>
                        <TableHeader className="bg-muted/40">
                          <TableRow>
                            <TableHead className="px-4 py-3">{t("dayTable.date")}</TableHead>
                            <TableHead className="px-4 py-3 text-right">{t("dayTable.sales")}</TableHead>
                            <TableHead className="px-4 py-3 text-right">{t("dayTable.receipts")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {chartData.map((point) => (
                            <TableRow
                              key={point.date}
                              className="cursor-pointer hover:bg-muted/25"
                              onClick={() => setSelectedDay(point.date)}
                            >
                              <TableCell className="px-4 py-3">
                                {formatDate(dateOnlyToDisplayDate(point.date), locale)}
                              </TableCell>
                              <TableCell className="px-4 py-3 text-right font-medium">
                                {renderMoney(point.netSalesKgs)}
                              </TableCell>
                              <TableCell className="px-4 py-3 text-right">
                                {formatNumber(point.receiptCount, locale)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="bazaar-admin-empty m-4 min-h-[8rem]">{t("emptySales")}</div>
                  )}
                </CardContent>
              </Card>

              <Card className="bazaar-admin-surface">
                <CardHeader className="bazaar-admin-section-header px-4 py-3 sm:px-5">
                  <CardTitle className="text-base">{t("dataPolicy.title")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 p-4 text-xs text-muted-foreground sm:p-5">
                  <p>{t("dataPolicy.sales")}</p>
                  <p>{t("dataPolicy.returns")}</p>
                  <p>{t("dataPolicy.payments")}</p>
                  <p>{t("dataPolicy.timezone", { timezone: defaultTimeZone })}</p>
                  {overviewQuery.data?.meta.timingsMs ? (
                    <p className="text-foreground">
                      {t("performance.overview")}:{" "}
                      {Object.values(overviewQuery.data.meta.timingsMs).reduce(
                        (sum, value) => sum + Number(value ?? 0),
                        0,
                      )}{" "}
                      ms
                    </p>
                  ) : null}
                  {soldProductsQuery.data?.meta.timingsMs ? (
                    <p className="text-foreground">
                      {t("performance.products")}:{" "}
                      {Object.values(soldProductsQuery.data.meta.timingsMs).reduce(
                        (sum, value) => sum + Number(value ?? 0),
                        0,
                      )}{" "}
                      ms
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          </div>

          <Modal
            open={Boolean(selectedDay)}
            onOpenChange={(nextOpen) => {
              if (!nextOpen) {
                setSelectedDay(null);
              }
            }}
            title={selectedDay ? t("dayDetail.title", { date: formatDate(dateOnlyToDisplayDate(selectedDay), locale) }) : t("dayDetail.titleFallback")}
            className="max-w-6xl"
            bodyClassName="p-0"
            mobileSheet
            usePortal
          >
            {dayDetailQuery.isLoading ? (
              <div className="flex min-h-[18rem] items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                <Spinner className="h-4 w-4" />
                {tCommon("loading")}
              </div>
            ) : dayDetailQuery.error ? (
              <div className="m-4 rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-danger sm:m-6">
                {translateError(tErrors, dayDetailQuery.error)}
              </div>
            ) : dayDetailQuery.data ? (
              <div>
                <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-3 lg:p-6">
                  <div className="rounded-md border border-border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">{t("kpis.netSales")}</p>
                    <p className="text-lg font-semibold text-foreground">
                      {renderMoney(dayDetailQuery.data.summary?.netSalesKgs ?? 0)}
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">{t("kpis.receipts")}</p>
                    <p className="text-lg font-semibold text-foreground">
                      {formatNumber(dayDetailQuery.data.summary?.receiptCount ?? 0, locale)}
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">{t("kpis.returns")}</p>
                    <p className="text-lg font-semibold text-foreground">
                      {renderMoney(dayDetailQuery.data.summary?.returnsKgs ?? 0)}
                    </p>
                  </div>
                </div>
                <div className="grid gap-0 lg:grid-cols-2">
                  <div className="border-b border-border lg:border-b-0 lg:border-r">
                    <div className="border-b border-border px-4 py-3 lg:px-6">
                      <h3 className="text-sm font-semibold text-foreground">{t("dayDetail.products")}</h3>
                    </div>
                    <div className="max-h-[28rem] overflow-auto">
                      <Table className="min-w-[600px]" sortable={false}>
                        <TableHeader className="bg-muted/40">
                          <TableRow>
                            <TableHead className="px-4 py-3 lg:px-6">{t("products.columns.product")}</TableHead>
                            <TableHead className="px-4 py-3 text-right">{t("products.columns.quantity")}</TableHead>
                            <TableHead className="px-4 py-3 text-right lg:px-6">{t("products.columns.revenue")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {dayDetailQuery.data.products.map((product) => (
                            <TableRow key={`${product.productId}:${product.variantKey}`}>
                              <TableCell className="px-4 py-3 lg:px-6">
                                <div className="font-medium text-foreground">{product.productName}</div>
                                <div className="text-xs text-muted-foreground">{product.productSku}</div>
                              </TableCell>
                              <TableCell className="px-4 py-3 text-right">
                                {formatNumber(product.netQuantity, locale)}
                              </TableCell>
                              <TableCell className="px-4 py-3 text-right font-semibold lg:px-6">
                                {renderMoney(product.netRevenueKgs)}
                              </TableCell>
                            </TableRow>
                          ))}
                          {!dayDetailQuery.data.products.length ? (
                            <TableRow>
                              <TableCell colSpan={3} className="px-4 py-8 text-center text-sm text-muted-foreground">
                                {t("emptyTopProducts")}
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                  <div>
                    <div className="border-b border-border px-4 py-3 lg:px-6">
                      <h3 className="text-sm font-semibold text-foreground">{t("dayDetail.receipts")}</h3>
                    </div>
                    <div className="max-h-[28rem] overflow-auto">
                      <Table className="min-w-[660px]" sortable={false}>
                        <TableHeader className="bg-muted/40">
                          <TableRow>
                            <TableHead className="px-4 py-3 lg:px-6">{t("receipts.columns.number")}</TableHead>
                            <TableHead className="px-4 py-3">{t("receipts.columns.cashier")}</TableHead>
                            <TableHead className="px-4 py-3">{t("receipts.columns.payment")}</TableHead>
                            <TableHead className="px-4 py-3 text-right lg:px-6">{t("receipts.columns.total")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {dayDetailQuery.data.receipts.map((receipt) => (
                            <TableRow
                              key={receipt.id}
                              className="cursor-pointer hover:bg-muted/25"
                              onClick={() => setPreviewSaleId(receipt.id)}
                            >
                              <TableCell className="px-4 py-3 lg:px-6">
                                <div className="font-medium text-foreground">{receipt.number}</div>
                                <div className="text-xs text-muted-foreground">
                                  {formatDateTime(receipt.completedAt ?? receipt.createdAt, locale)}
                                </div>
                              </TableCell>
                              <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                                {receipt.cashier?.name ?? receipt.cashier?.email ?? t("receipts.unknownCashier")}
                              </TableCell>
                              <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                                {paymentMethods
                                  .filter((method) => (receipt.paymentBreakdown[method] ?? 0) > 0)
                                  .map((method) => tPos(`payments.${method.toLowerCase()}`))
                                  .join(", ") || tCommon("notAvailable")}
                              </TableCell>
                              <TableCell className="px-4 py-3 text-right font-semibold lg:px-6">
                                {renderMoney(receipt.totalKgs)}
                              </TableCell>
                            </TableRow>
                          ))}
                          {!dayDetailQuery.data.receipts.length ? (
                            <TableRow>
                              <TableCell colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                                {t("receipts.empty")}
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </Modal>

          <Modal
            open={Boolean(selectedProduct)}
            onOpenChange={(nextOpen) => {
              if (!nextOpen) {
                setSelectedProduct(null);
              }
            }}
            title={selectedProduct ? t("productReceipts.title", { product: selectedProduct.name }) : t("productReceipts.titleFallback")}
            className="max-w-4xl"
            bodyClassName="p-0"
            mobileSheet
            usePortal
          >
            {productReceiptsQuery.isLoading ? (
              <div className="flex min-h-[14rem] items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                <Spinner className="h-4 w-4" />
                {tCommon("loading")}
              </div>
            ) : productReceiptsQuery.error ? (
              <div className="m-4 rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-danger sm:m-6">
                {translateError(tErrors, productReceiptsQuery.error)}
              </div>
            ) : (
              <div className="max-h-[32rem] overflow-auto">
                <Table className="min-w-[760px]" sortable={false}>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="px-4 py-3 lg:px-6">{t("receipts.columns.number")}</TableHead>
                      <TableHead className="px-4 py-3">{t("receipts.columns.store")}</TableHead>
                      <TableHead className="px-4 py-3">{t("receipts.columns.cashier")}</TableHead>
                      <TableHead className="px-4 py-3">{t("receipts.columns.payment")}</TableHead>
                      <TableHead className="px-4 py-3 text-right lg:px-6">{t("receipts.columns.total")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(productReceiptsQuery.data?.items ?? []).map((receipt) => (
                      <TableRow
                        key={receipt.id}
                        className="cursor-pointer hover:bg-muted/25"
                        onClick={() => setPreviewSaleId(receipt.id)}
                      >
                        <TableCell className="px-4 py-3 lg:px-6">
                          <div className="font-medium text-foreground">{receipt.number}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatDateTime(receipt.completedAt ?? receipt.createdAt, locale)}
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                          {receipt.store.name}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                          {receipt.cashier?.name ?? receipt.cashier?.email ?? t("receipts.unknownCashier")}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                          {paymentMethods
                            .filter((method) => (receipt.paymentBreakdown[method] ?? 0) > 0)
                            .map((method) => tPos(`payments.${method.toLowerCase()}`))
                            .join(", ") || tCommon("notAvailable")}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right font-semibold lg:px-6">
                          {renderMoney(receipt.totalKgs)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!productReceiptsQuery.isLoading && !(productReceiptsQuery.data?.items ?? []).length ? (
                      <TableRow>
                        <TableCell colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                          {t("receipts.empty")}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            )}
          </Modal>

          <ReceiptPreviewModal
            saleId={previewSaleId}
            open={Boolean(previewSaleId)}
            onOpenChange={(nextOpen) => {
              if (!nextOpen) {
                setPreviewSaleId(null);
              }
            }}
          />
        </>
      )}
    </div>
  );
};

export default AnalyticsPage;

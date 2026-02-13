"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DownloadIcon } from "@/components/icons";
import { downloadTableFile, type DownloadFormat } from "@/lib/fileExport";
import { formatDate, formatNumber } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const ReportsPage = () => {
  const t = useTranslations("reports");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const tExports = useTranslations("exports");
  const locale = useLocale();
  const { data: session, status } = useSession();
  const canView = session?.user?.role && session.user.role !== "STAFF";
  const reportsEnabled = status === "authenticated" && Boolean(canView);

  const [storeId, setStoreId] = useState("");
  const [rangeDays, setRangeDays] = useState(30);
  const [exportFormat, setExportFormat] = useState<DownloadFormat>("csv");

  const storesQuery = trpc.stores.list.useQuery(undefined, { enabled: reportsEnabled });
  const stockoutsQuery = trpc.reports.stockouts.useQuery(
    { storeId: storeId || undefined, days: rangeDays },
    { enabled: reportsEnabled },
  );
  const slowMoversQuery = trpc.reports.slowMovers.useQuery(
    { storeId: storeId || undefined, days: rangeDays },
    { enabled: reportsEnabled },
  );
  const shrinkageQuery = trpc.reports.shrinkage.useQuery(
    { storeId: storeId || undefined, days: rangeDays },
    { enabled: reportsEnabled },
  );

  const storeOptions = storesQuery.data ?? [];

  const stockoutRows = useMemo(() => stockoutsQuery.data ?? [], [stockoutsQuery.data]);
  const slowMoverRows = useMemo(() => slowMoversQuery.data ?? [], [slowMoversQuery.data]);
  const shrinkageRows = useMemo(() => shrinkageQuery.data ?? [], [shrinkageQuery.data]);

  if (status === "authenticated" && !canView) {
    return (
      <div>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <p className="mt-4 text-sm text-danger">{tErrors("forbidden")}</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <>
            <Button asChild variant="secondary">
              <Link href="/reports/analytics">{t("analyticsLink")}</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/reports/exports">{t("exportsLink")}</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/reports/close">{t("closeLink")}</Link>
            </Button>
          </>
        }
        filters={
          <>
            <div className="w-full sm:max-w-xs">
              <Select
                value={storeId || "all"}
                onValueChange={(value) => setStoreId(value === "all" ? "" : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={tCommon("selectStore")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allStores")}</SelectItem>
                  {storeOptions.map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:max-w-xs">
              <Select
                value={String(rangeDays)}
                onValueChange={(value) => setRangeDays(Number(value))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("rangeLabel")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">{t("range30")}</SelectItem>
                  <SelectItem value="90">{t("range90")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:max-w-xs">
              <Select
                value={exportFormat}
                onValueChange={(value) => setExportFormat(value as DownloadFormat)}
              >
                <SelectTrigger aria-label={tExports("formatLabel")}>
                  <SelectValue placeholder={tExports("formatLabel")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="csv">{tExports("formats.csv")}</SelectItem>
                  <SelectItem value="xlsx">{tExports("formats.xlsx")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        }
      />

      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>{t("stockoutsTitle")}</CardTitle>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              const rows = stockoutRows.map((row) => [
                row.storeName,
                row.productName,
                row.variantName ?? "",
                String(row.count),
                row.lastAt ? formatDate(row.lastAt, locale) : "",
                String(row.onHand),
              ]);
              downloadTableFile({
                format: exportFormat,
                fileNameBase: `stockouts-${rangeDays}d-${locale}`,
                header: [
                  t("columns.store"),
                  t("columns.product"),
                  t("columns.variant"),
                  t("columns.count"),
                  t("columns.lastAt"),
                  t("columns.onHand"),
                ],
                rows,
              });
            }}
            disabled={!stockoutRows.length}
          >
            <DownloadIcon className="h-4 w-4" aria-hidden />
            {exportFormat === "csv" ? t("exportCsv") : t("exportXlsx")}
          </Button>
        </CardHeader>
        <CardContent>
          {stockoutsQuery.isLoading ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : stockoutsQuery.error ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-danger">
              <span>{translateError(tErrors, stockoutsQuery.error)}</span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => stockoutsQuery.refetch()}
              >
                {tErrors("tryAgain")}
              </Button>
            </div>
          ) : stockoutRows.length ? (
            <ResponsiveDataList
              items={stockoutRows}
              getKey={(row) => `${row.storeId}-${row.productId}-${row.variantId ?? "base"}`}
              renderDesktop={(visibleItems) => (
                <div className="overflow-x-auto">
                  <Table className="min-w-[720px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("columns.store")}</TableHead>
                        <TableHead>{t("columns.product")}</TableHead>
                        <TableHead className="hidden md:table-cell">{t("columns.variant")}</TableHead>
                        <TableHead>{t("columns.count")}</TableHead>
                        <TableHead className="hidden md:table-cell">{t("columns.lastAt")}</TableHead>
                        <TableHead>{t("columns.onHand")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleItems.map((row) => (
                        <TableRow key={`${row.storeId}-${row.productId}-${row.variantId ?? "base"}`}>
                          <TableCell className="text-xs text-muted-foreground">{row.storeName}</TableCell>
                          <TableCell className="font-medium">{row.productName}</TableCell>
                          <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                            {row.variantName ?? tCommon("notAvailable")}
                          </TableCell>
                          <TableCell>{formatNumber(row.count, locale)}</TableCell>
                          <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                            {row.lastAt ? formatDate(row.lastAt, locale) : tCommon("notAvailable")}
                          </TableCell>
                          <TableCell>{formatNumber(row.onHand, locale)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              renderMobile={(row) => (
                <div className="rounded-md border border-border bg-card p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{row.productName}</p>
                    <p className="text-xs text-muted-foreground">{row.storeName}</p>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                        {t("columns.variant")}
                      </p>
                      <p className="text-foreground/90">
                        {row.variantName ?? tCommon("notAvailable")}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                        {t("columns.count")}
                      </p>
                      <p className="text-foreground/90">{formatNumber(row.count, locale)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                        {t("columns.lastAt")}
                      </p>
                      <p className="text-foreground/90">
                        {row.lastAt ? formatDate(row.lastAt, locale) : tCommon("notAvailable")}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                        {t("columns.onHand")}
                      </p>
                      <p className="text-foreground/90">{formatNumber(row.onHand, locale)}</p>
                    </div>
                  </div>
                </div>
              )}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t("stockoutsEmpty")}</p>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>{t("slowMoversTitle")}</CardTitle>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              const rows = slowMoverRows.map((row) => [
                row.storeName,
                row.productName,
                row.variantName ?? "",
                row.lastMovementAt ? formatDate(row.lastMovementAt, locale) : "",
                String(row.onHand),
              ]);
              downloadTableFile({
                format: exportFormat,
                fileNameBase: `slow-movers-${rangeDays}d-${locale}`,
                header: [
                  t("columns.store"),
                  t("columns.product"),
                  t("columns.variant"),
                  t("columns.lastMovement"),
                  t("columns.onHand"),
                ],
                rows,
              });
            }}
            disabled={!slowMoverRows.length}
          >
            <DownloadIcon className="h-4 w-4" aria-hidden />
            {exportFormat === "csv" ? t("exportCsv") : t("exportXlsx")}
          </Button>
        </CardHeader>
        <CardContent>
          {slowMoversQuery.isLoading ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : slowMoversQuery.error ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-danger">
              <span>{translateError(tErrors, slowMoversQuery.error)}</span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => slowMoversQuery.refetch()}
              >
                {tErrors("tryAgain")}
              </Button>
            </div>
          ) : slowMoverRows.length ? (
            <ResponsiveDataList
              items={slowMoverRows}
              getKey={(row) => `${row.storeId}-${row.productId}-${row.variantId ?? "base"}`}
              renderDesktop={(visibleItems) => (
                <div className="overflow-x-auto">
                  <Table className="min-w-[720px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("columns.store")}</TableHead>
                        <TableHead>{t("columns.product")}</TableHead>
                        <TableHead className="hidden md:table-cell">{t("columns.variant")}</TableHead>
                        <TableHead>{t("columns.lastMovement")}</TableHead>
                        <TableHead>{t("columns.onHand")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleItems.map((row) => (
                        <TableRow key={`${row.storeId}-${row.productId}-${row.variantId ?? "base"}`}>
                          <TableCell className="text-xs text-muted-foreground">{row.storeName}</TableCell>
                          <TableCell className="font-medium">{row.productName}</TableCell>
                          <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                            {row.variantName ?? tCommon("notAvailable")}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {row.lastMovementAt
                              ? formatDate(row.lastMovementAt, locale)
                              : tCommon("notAvailable")}
                          </TableCell>
                          <TableCell>{formatNumber(row.onHand, locale)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              renderMobile={(row) => (
                <div className="rounded-md border border-border bg-card p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{row.productName}</p>
                    <p className="text-xs text-muted-foreground">{row.storeName}</p>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                        {t("columns.variant")}
                      </p>
                      <p className="text-foreground/90">
                        {row.variantName ?? tCommon("notAvailable")}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                        {t("columns.lastMovement")}
                      </p>
                      <p className="text-foreground/90">
                        {row.lastMovementAt
                          ? formatDate(row.lastMovementAt, locale)
                          : tCommon("notAvailable")}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                        {t("columns.onHand")}
                      </p>
                      <p className="text-foreground/90">{formatNumber(row.onHand, locale)}</p>
                    </div>
                  </div>
                </div>
              )}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t("slowMoversEmpty")}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>{t("shrinkageTitle")}</CardTitle>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              const rows = shrinkageRows.map((row) => [
                row.storeName,
                row.productName,
                row.variantName ?? "",
                row.userName ?? "",
                String(row.totalQty),
                String(row.movementCount),
              ]);
              downloadTableFile({
                format: exportFormat,
                fileNameBase: `shrinkage-${rangeDays}d-${locale}`,
                header: [
                  t("columns.store"),
                  t("columns.product"),
                  t("columns.variant"),
                  t("columns.user"),
                  t("columns.qty"),
                  t("columns.movements"),
                ],
                rows,
              });
            }}
            disabled={!shrinkageRows.length}
          >
            <DownloadIcon className="h-4 w-4" aria-hidden />
            {exportFormat === "csv" ? t("exportCsv") : t("exportXlsx")}
          </Button>
        </CardHeader>
        <CardContent>
          {shrinkageQuery.isLoading ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : shrinkageQuery.error ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-danger">
              <span>{translateError(tErrors, shrinkageQuery.error)}</span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => shrinkageQuery.refetch()}
              >
                {tErrors("tryAgain")}
              </Button>
            </div>
          ) : shrinkageRows.length ? (
            <ResponsiveDataList
              items={shrinkageRows}
              getKey={(row) =>
                `${row.storeId}-${row.productId}-${row.variantId ?? "base"}-${row.userId ?? "anon"}`
              }
              renderDesktop={(visibleItems) => (
                <div className="overflow-x-auto">
                  <Table className="min-w-[720px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("columns.store")}</TableHead>
                        <TableHead>{t("columns.product")}</TableHead>
                        <TableHead className="hidden md:table-cell">{t("columns.variant")}</TableHead>
                        <TableHead>{t("columns.user")}</TableHead>
                        <TableHead>{t("columns.qty")}</TableHead>
                        <TableHead>{t("columns.movements")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleItems.map((row) => (
                        <TableRow
                          key={`${row.storeId}-${row.productId}-${row.variantId ?? "base"}-${row.userId ?? "anon"}`}
                        >
                          <TableCell className="text-xs text-muted-foreground">{row.storeName}</TableCell>
                          <TableCell className="font-medium">{row.productName}</TableCell>
                          <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                            {row.variantName ?? tCommon("notAvailable")}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {row.userName ?? tCommon("notAvailable")}
                          </TableCell>
                          <TableCell>{formatNumber(row.totalQty, locale)}</TableCell>
                          <TableCell>{formatNumber(row.movementCount, locale)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              renderMobile={(row) => (
                <div className="rounded-md border border-border bg-card p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{row.productName}</p>
                    <p className="text-xs text-muted-foreground">{row.storeName}</p>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                        {t("columns.variant")}
                      </p>
                      <p className="text-foreground/90">
                        {row.variantName ?? tCommon("notAvailable")}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                        {t("columns.user")}
                      </p>
                      <p className="text-foreground/90">{row.userName ?? tCommon("notAvailable")}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                        {t("columns.qty")}
                      </p>
                      <p className="text-foreground/90">{formatNumber(row.totalQty, locale)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                        {t("columns.movements")}
                      </p>
                      <p className="text-foreground/90">{formatNumber(row.movementCount, locale)}</p>
                    </div>
                  </div>
                </div>
              )}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t("shrinkageEmpty")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ReportsPage;

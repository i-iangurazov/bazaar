"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { formatDate, formatNumber } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;

const ReportsPage = () => {
  const t = useTranslations("reports");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session, status } = useSession();
  const canView = session?.user?.role && session.user.role !== "STAFF";
  const reportsEnabled = status === "authenticated" && Boolean(canView);

  const [storeId, setStoreId] = useState("");
  const [rangeDays, setRangeDays] = useState(30);

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

  const downloadCsv = (filename: string, header: string[], rows: string[][]) => {
    const lines = [header, ...rows].map((row) => row.map(escapeCsv).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const stockoutRows = useMemo(() => stockoutsQuery.data ?? [], [stockoutsQuery.data]);
  const slowMoverRows = useMemo(() => slowMoversQuery.data ?? [], [slowMoversQuery.data]);
  const shrinkageRows = useMemo(() => shrinkageQuery.data ?? [], [shrinkageQuery.data]);

  if (status === "authenticated" && !canView) {
    return (
      <div>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <p className="mt-4 text-sm text-red-500">{tErrors("forbidden")}</p>
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
            <Button asChild variant="ghost">
              <Link href="/reports/analytics">{t("analyticsLink")}</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/reports/exports">{t("exportsLink")}</Link>
            </Button>
            <Button asChild variant="ghost">
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
          </>
        }
      />

      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>{t("stockoutsTitle")}</CardTitle>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              const rows = stockoutRows.map((row) => [
                row.storeName,
                row.productName,
                row.variantName ?? "",
                String(row.count),
                row.lastAt ? formatDate(row.lastAt, locale) : "",
                String(row.onHand),
              ]);
              downloadCsv(
                `stockouts-${rangeDays}d-${locale}.csv`,
                [
                  t("columns.store"),
                  t("columns.product"),
                  t("columns.variant"),
                  t("columns.count"),
                  t("columns.lastAt"),
                  t("columns.onHand"),
                ],
                rows,
              );
            }}
            disabled={!stockoutRows.length}
          >
            <DownloadIcon className="h-4 w-4" aria-hidden />
            {t("exportCsv")}
          </Button>
        </CardHeader>
        <CardContent>
          {stockoutsQuery.isLoading ? (
            <p className="text-sm text-gray-500">{tCommon("loading")}</p>
          ) : stockoutsQuery.error ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-red-500">
              <span>{translateError(tErrors, stockoutsQuery.error)}</span>
              <Button
                type="button"
                variant="ghost"
                className="h-8 px-3"
                onClick={() => stockoutsQuery.refetch()}
              >
                {tErrors("tryAgain")}
              </Button>
            </div>
          ) : stockoutRows.length ? (
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
                  {stockoutRows.map((row) => (
                    <TableRow key={`${row.storeId}-${row.productId}-${row.variantId ?? "base"}`}>
                      <TableCell className="text-xs text-gray-500">{row.storeName}</TableCell>
                      <TableCell className="font-medium">{row.productName}</TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-gray-500">
                        {row.variantName ?? tCommon("notAvailable")}
                      </TableCell>
                      <TableCell>{formatNumber(row.count, locale)}</TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-gray-500">
                        {row.lastAt ? formatDate(row.lastAt, locale) : tCommon("notAvailable")}
                      </TableCell>
                      <TableCell>{formatNumber(row.onHand, locale)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-gray-500">{t("stockoutsEmpty")}</p>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>{t("slowMoversTitle")}</CardTitle>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              const rows = slowMoverRows.map((row) => [
                row.storeName,
                row.productName,
                row.variantName ?? "",
                row.lastMovementAt ? formatDate(row.lastMovementAt, locale) : "",
                String(row.onHand),
              ]);
              downloadCsv(
                `slow-movers-${rangeDays}d-${locale}.csv`,
                [
                  t("columns.store"),
                  t("columns.product"),
                  t("columns.variant"),
                  t("columns.lastMovement"),
                  t("columns.onHand"),
                ],
                rows,
              );
            }}
            disabled={!slowMoverRows.length}
          >
            <DownloadIcon className="h-4 w-4" aria-hidden />
            {t("exportCsv")}
          </Button>
        </CardHeader>
        <CardContent>
          {slowMoversQuery.isLoading ? (
            <p className="text-sm text-gray-500">{tCommon("loading")}</p>
          ) : slowMoversQuery.error ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-red-500">
              <span>{translateError(tErrors, slowMoversQuery.error)}</span>
              <Button
                type="button"
                variant="ghost"
                className="h-8 px-3"
                onClick={() => slowMoversQuery.refetch()}
              >
                {tErrors("tryAgain")}
              </Button>
            </div>
          ) : slowMoverRows.length ? (
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
                  {slowMoverRows.map((row) => (
                    <TableRow key={`${row.storeId}-${row.productId}-${row.variantId ?? "base"}`}>
                      <TableCell className="text-xs text-gray-500">{row.storeName}</TableCell>
                      <TableCell className="font-medium">{row.productName}</TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-gray-500">
                        {row.variantName ?? tCommon("notAvailable")}
                      </TableCell>
                      <TableCell className="text-xs text-gray-500">
                        {row.lastMovementAt ? formatDate(row.lastMovementAt, locale) : tCommon("notAvailable")}
                      </TableCell>
                      <TableCell>{formatNumber(row.onHand, locale)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-gray-500">{t("slowMoversEmpty")}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>{t("shrinkageTitle")}</CardTitle>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              const rows = shrinkageRows.map((row) => [
                row.storeName,
                row.productName,
                row.variantName ?? "",
                row.userName ?? "",
                String(row.totalQty),
                String(row.movementCount),
              ]);
              downloadCsv(
                `shrinkage-${rangeDays}d-${locale}.csv`,
                [
                  t("columns.store"),
                  t("columns.product"),
                  t("columns.variant"),
                  t("columns.user"),
                  t("columns.qty"),
                  t("columns.movements"),
                ],
                rows,
              );
            }}
            disabled={!shrinkageRows.length}
          >
            <DownloadIcon className="h-4 w-4" aria-hidden />
            {t("exportCsv")}
          </Button>
        </CardHeader>
        <CardContent>
          {shrinkageQuery.isLoading ? (
            <p className="text-sm text-gray-500">{tCommon("loading")}</p>
          ) : shrinkageQuery.error ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-red-500">
              <span>{translateError(tErrors, shrinkageQuery.error)}</span>
              <Button
                type="button"
                variant="ghost"
                className="h-8 px-3"
                onClick={() => shrinkageQuery.refetch()}
              >
                {tErrors("tryAgain")}
              </Button>
            </div>
          ) : shrinkageRows.length ? (
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
                  {shrinkageRows.map((row) => (
                    <TableRow key={`${row.storeId}-${row.productId}-${row.variantId ?? "base"}-${row.userId ?? "anon"}`}>
                      <TableCell className="text-xs text-gray-500">{row.storeName}</TableCell>
                      <TableCell className="font-medium">{row.productName}</TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-gray-500">
                        {row.variantName ?? tCommon("notAvailable")}
                      </TableCell>
                      <TableCell className="text-xs text-gray-500">
                        {row.userName ?? tCommon("notAvailable")}
                      </TableCell>
                      <TableCell>{formatNumber(row.totalQty, locale)}</TableCell>
                      <TableCell>{formatNumber(row.movementCount, locale)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-gray-500">{t("shrinkageEmpty")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ReportsPage;

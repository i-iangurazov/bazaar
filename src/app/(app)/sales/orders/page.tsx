"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { CustomerOrderStatus } from "@prisma/client";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
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
import { AddIcon, CheckIcon, CloseIcon, EmptyIcon, ViewIcon } from "@/components/icons";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { RowActions } from "@/components/row-actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { currencySourceWithFallback, formatKgsMoney } from "@/lib/currencyDisplay";
import { formatDate } from "@/lib/i18nFormat";
import { getCustomerOrderStatusLabel } from "@/lib/i18n/status";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const salesOrderStatuses = Object.values(CustomerOrderStatus);
const salesOrderSortOptions = ["createdAt", "number", "totalKgs", "customerName"] as const;

const parsePositiveInteger = (value: string | null, fallback: number, max: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : fallback;
};

const parseOption = <T extends string>(value: string | null, options: readonly T[], fallback: T) =>
  value && options.includes(value as T) ? (value as T) : fallback;

const SalesOrdersPage = () => {
  const t = useTranslations("salesOrders");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session } = useSession();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const router = useRouter();
  const pathname = usePathname() ?? "/sales/orders";
  const searchParams = useSearchParams();
  const currentQueryString = searchParams.toString();
  const page = parsePositiveInteger(searchParams.get("page"), 1, 10_000);
  const pageSize = parsePositiveInteger(searchParams.get("pageSize"), 25, 200);
  const search = searchParams.get("search") ?? "";
  const storeId = searchParams.get("storeId") || "all";
  const statusFilter = parseOption(
    searchParams.get("status"),
    salesOrderStatuses,
    "all" as CustomerOrderStatus | "all",
  );
  const sortBy = parseOption(searchParams.get("sortBy"), salesOrderSortOptions, "createdAt");
  const sortDirection = parseOption(
    searchParams.get("sortDirection"),
    ["asc", "desc"] as const,
    "desc",
  );
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const updateListParams = useCallback(
    (updates: Record<string, string | number | null>) => {
      const params = new URLSearchParams(currentQueryString);
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === "") {
          params.delete(key);
        } else {
          params.set(key, String(value));
        }
      });
      const nextQuery = params.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    },
    [currentQueryString, pathname, router],
  );
  const setPage = (value: number) => updateListParams({ page: value === 1 ? null : value });
  const setPageSize = (value: number) =>
    updateListParams({ pageSize: value === 25 ? null : value, page: null });
  const setFilter = (key: string, value: string | null) =>
    updateListParams({ [key]: value, page: null });

  const canFinalize = session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";

  const storesQuery = trpc.stores.list.useQuery();
  const stores = useMemo(() => storesQuery.data ?? [], [storesQuery.data]);
  const showAllStoresFilter = stores.length !== 1;

  const listQuery = trpc.salesOrders.list.useQuery(
    {
      page,
      pageSize,
      search: search.trim() || undefined,
      storeId: storeId === "all" ? undefined : storeId,
      status: statusFilter === "all" ? undefined : statusFilter,
      sortBy,
      sortDirection,
    },
    { keepPreviousData: true },
  );

  const completeMutation = trpc.salesOrders.complete.useMutation({
    onSuccess: async () => {
      await listQuery.refetch();
      toast({ variant: "success", description: t("completeSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const cancelMutation = trpc.salesOrders.cancel.useMutation({
    onSuccess: async (result) => {
      await listQuery.refetch();
      if (result.cancellationEmail?.status === "sent") {
        toast({ variant: "success", description: t("cancelSuccessEmailSent") });
        return;
      }
      if (
        result.cancellationEmail?.status === "skipped" &&
        result.cancellationEmail.reason === "missingEmail"
      ) {
        toast({ variant: "info", description: t("cancelSuccessEmailSkipped") });
        return;
      }
      if (result.cancellationEmail?.status === "failed") {
        toast({ variant: "error", description: t("cancelSuccessEmailFailed") });
        return;
      }
      toast({ variant: "success", description: t("cancelSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const items = useMemo(() => listQuery.data?.items ?? [], [listQuery.data?.items]);
  const totalItems = listQuery.data?.total ?? 0;
  const activeMobileFilterCount = [
    search.trim(),
    storeId !== "all" ? storeId : "",
    statusFilter !== "all" ? statusFilter : "",
    sortBy !== "createdAt" || sortDirection !== "desc" ? sortBy : "",
  ].filter(Boolean).length;

  const statusVariant = (
    status: CustomerOrderStatus,
  ): "default" | "success" | "warning" | "danger" => {
    switch (status) {
      case CustomerOrderStatus.COMPLETED:
        return "success";
      case CustomerOrderStatus.CANCELED:
        return "danger";
      case CustomerOrderStatus.READY:
        return "warning";
      default:
        return "default";
    }
  };

  const canCancel = (status: CustomerOrderStatus) =>
    status === CustomerOrderStatus.DRAFT ||
    status === CustomerOrderStatus.CONFIRMED ||
    status === CustomerOrderStatus.READY;

  const sourceLabel = (source?: string | null) =>
    source === "API"
      ? t("source.api")
      : source === "CATALOG"
        ? t("source.catalog")
        : t("source.manual");

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <>
            {canFinalize ? (
              <Link href="/sales/orders/metrics" className="w-full sm:w-auto">
                <Button variant="secondary" className="w-full sm:w-auto">
                  <ViewIcon className="h-4 w-4" aria-hidden />
                  {t("metricsTitle")}
                </Button>
              </Link>
            ) : null}
            <Link href="/sales/orders/new" className="w-full sm:w-auto">
              <Button className="w-full sm:w-auto" data-tour="sales-orders-create">
                <AddIcon className="h-4 w-4" aria-hidden />
                {t("new")}
              </Button>
            </Link>
          </>
        }
      />

      <Card className="bazaar-admin-surface">
        <CardHeader className="border-b border-border/60 bg-muted/20">
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bazaar-admin-toolbar space-y-3 md:hidden">
            <Input
              value={search}
              onChange={(event) => {
                setFilter("search", event.target.value);
              }}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchPlaceholder")}
              className="h-11"
            />
            <div className="scrollbar-none flex gap-2 overflow-x-auto pb-1">
              <Button
                type="button"
                size="sm"
                variant={statusFilter === "all" ? "default" : "secondary"}
                className="h-10 shrink-0"
                onClick={() => {
                  setFilter("status", null);
                }}
              >
                {t("allStatuses")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={statusFilter === CustomerOrderStatus.READY ? "default" : "secondary"}
                className="h-10 shrink-0"
                onClick={() => {
                  setFilter("status", CustomerOrderStatus.READY);
                }}
              >
                {getCustomerOrderStatusLabel(t, "READY")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={activeMobileFilterCount ? "default" : "secondary"}
                className="h-10 shrink-0"
                onClick={() => setMobileFiltersOpen(true)}
              >
                {tCommon("filters")} {activeMobileFilterCount}
              </Button>
            </div>
          </div>

          <div className="bazaar-admin-toolbar hidden grid-cols-1 gap-3 md:grid md:grid-cols-5">
            <Input
              value={search}
              onChange={(event) => {
                setFilter("search", event.target.value);
              }}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchPlaceholder")}
            />
            <Select
              value={storeId}
              onValueChange={(value) => {
                setFilter("storeId", value === "all" ? null : value);
              }}
            >
              <SelectTrigger aria-label={t("store")}>
                <SelectValue placeholder={t("store")} />
              </SelectTrigger>
              <SelectContent>
                {showAllStoresFilter ? (
                  <SelectItem value="all">{tCommon("allStores")}</SelectItem>
                ) : null}
                {stores.map((store) => (
                  <SelectItem key={store.id} value={store.id}>
                    {store.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setFilter("status", value === "all" ? null : value);
              }}
            >
              <SelectTrigger aria-label={t("statusLabel")}>
                <SelectValue placeholder={t("statusLabel")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allStatuses")}</SelectItem>
                <SelectItem value="DRAFT">{getCustomerOrderStatusLabel(t, "DRAFT")}</SelectItem>
                <SelectItem value="CONFIRMED">
                  {getCustomerOrderStatusLabel(t, "CONFIRMED")}
                </SelectItem>
                <SelectItem value="READY">{getCustomerOrderStatusLabel(t, "READY")}</SelectItem>
                <SelectItem value="COMPLETED">
                  {getCustomerOrderStatusLabel(t, "COMPLETED")}
                </SelectItem>
                <SelectItem value="CANCELED">
                  {getCustomerOrderStatusLabel(t, "CANCELED")}
                </SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={`${sortBy}:${sortDirection}`}
              onValueChange={(value) => {
                const [nextSortBy, nextDirection] = value.split(":") as [
                  (typeof salesOrderSortOptions)[number],
                  "asc" | "desc",
                ];
                updateListParams({
                  sortBy: nextSortBy === "createdAt" ? null : nextSortBy,
                  sortDirection: nextDirection === "desc" ? null : nextDirection,
                  page: null,
                });
              }}
            >
              <SelectTrigger aria-label={t("sortLabel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="createdAt:desc">{t("sortNewest")}</SelectItem>
                <SelectItem value="createdAt:asc">{t("sortOldest")}</SelectItem>
                <SelectItem value="number:asc">{t("sortNumberAsc")}</SelectItem>
                <SelectItem value="customerName:asc">{t("sortCustomerAsc")}</SelectItem>
                <SelectItem value="totalKgs:desc">{t("sortTotalDesc")}</SelectItem>
                <SelectItem value="totalKgs:asc">{t("sortTotalAsc")}</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center text-sm text-muted-foreground">
              {t("totalLabel", { count: totalItems })}
            </div>
          </div>

          <ResponsiveDataList
            key={`sales-orders-${pageSize}`}
            items={items}
            getKey={(item) => item.id}
            page={page}
            totalItems={totalItems}
            defaultPageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            renderDesktop={(visibleItems) => (
              <div className="bazaar-admin-table-shell">
                <div className="bazaar-admin-table-scroll">
                  <Table className="min-w-[980px]" data-tour="sales-orders-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("number")}</TableHead>
                        <TableHead>{t("customer")}</TableHead>
                        <TableHead>{t("customerAddress")}</TableHead>
                        <TableHead>{t("store")}</TableHead>
                        <TableHead>{t("statusLabel")}</TableHead>
                        <TableHead>{t("sourceLabel")}</TableHead>
                        <TableHead>{t("total")}</TableHead>
                        <TableHead>{t("created")}</TableHead>
                        <TableHead className="text-right">{tCommon("actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleItems.map((order) => (
                        <TableRow key={order.id}>
                          <TableCell>
                            <Link
                              className="font-medium text-foreground"
                              href={`/sales/orders/${order.id}`}
                            >
                              {order.number}
                            </Link>
                          </TableCell>
                          <TableCell>{order.customerName || tCommon("notAvailable")}</TableCell>
                          <TableCell className="max-w-[220px] truncate">
                            {order.customerAddress || tCommon("notAvailable")}
                          </TableCell>
                          <TableCell>{order.store.name}</TableCell>
                          <TableCell>
                            <Badge variant={statusVariant(order.status)}>
                              {getCustomerOrderStatusLabel(t, order.status)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                order.source === "API"
                                  ? "success"
                                  : order.source === "CATALOG"
                                    ? "warning"
                                    : "muted"
                              }
                            >
                              {sourceLabel(order.source)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {formatKgsMoney(
                              order.totalKgs,
                              locale,
                              currencySourceWithFallback(order, order.store),
                            )}
                          </TableCell>
                          <TableCell>{formatDate(order.createdAt, locale)}</TableCell>
                          <TableCell>
                            <div className="flex justify-end">
                              <RowActions
                                moreLabel={tCommon("moreActions")}
                                actions={[
                                  {
                                    key: "view",
                                    label: tCommon("view"),
                                    icon: ViewIcon,
                                    href: `/sales/orders/${order.id}`,
                                  },
                                  ...(canFinalize && order.status === CustomerOrderStatus.READY
                                    ? [
                                        {
                                          key: "complete",
                                          label: t("complete"),
                                          icon: CheckIcon,
                                          onSelect: () => {
                                            void completeMutation.mutateAsync({
                                              customerOrderId: order.id,
                                              idempotencyKey:
                                                typeof crypto !== "undefined" &&
                                                "randomUUID" in crypto
                                                  ? crypto.randomUUID()
                                                  : `sales-order-${Date.now()}`,
                                            });
                                          },
                                          disabled: completeMutation.isLoading,
                                        },
                                      ]
                                    : []),
                                  ...(canFinalize && canCancel(order.status)
                                    ? [
                                        {
                                          key: "cancel",
                                          label: t("cancel"),
                                          icon: CloseIcon,
                                          variant: "danger",
                                          onSelect: async () => {
                                            if (
                                              !(await confirm({
                                                description: t("confirmCancel"),
                                                confirmVariant: "danger",
                                              }))
                                            ) {
                                              return;
                                            }
                                            void cancelMutation.mutateAsync({
                                              customerOrderId: order.id,
                                            });
                                          },
                                          disabled: cancelMutation.isLoading,
                                        },
                                      ]
                                    : []),
                                ]}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
            renderMobile={(order) => (
              <Card className="bazaar-admin-mobile-card">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      className="text-sm font-semibold text-foreground"
                      href={`/sales/orders/${order.id}`}
                    >
                      {order.number}
                    </Link>
                    <Badge variant={statusVariant(order.status)}>
                      {getCustomerOrderStatusLabel(t, order.status)}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>
                      <p>{t("customer")}</p>
                      <p className="font-medium text-foreground">
                        {order.customerName || tCommon("notAvailable")}
                      </p>
                    </div>
                    <div>
                      <p>{t("store")}</p>
                      <p className="font-medium text-foreground">{order.store.name}</p>
                    </div>
                    <div className="col-span-2">
                      <p>{t("customerAddress")}</p>
                      <p className="font-medium text-foreground">
                        {order.customerAddress || tCommon("notAvailable")}
                      </p>
                    </div>
                    <div>
                      <p>{t("sourceLabel")}</p>
                      <p className="font-medium text-foreground">{sourceLabel(order.source)}</p>
                    </div>
                    <div>
                      <p>{t("total")}</p>
                      <p className="font-medium text-foreground">
                        {formatKgsMoney(
                          order.totalKgs,
                          locale,
                          currencySourceWithFallback(order, order.store),
                        )}
                      </p>
                    </div>
                    <div>
                      <p>{t("created")}</p>
                      <p className="font-medium text-foreground">
                        {formatDate(order.createdAt, locale)}
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <RowActions
                      moreLabel={tCommon("moreActions")}
                      actions={[
                        {
                          key: "view",
                          label: tCommon("view"),
                          icon: ViewIcon,
                          href: `/sales/orders/${order.id}`,
                        },
                        ...(canFinalize && order.status === CustomerOrderStatus.READY
                          ? [
                              {
                                key: "complete",
                                label: t("complete"),
                                icon: CheckIcon,
                                onSelect: () => {
                                  void completeMutation.mutateAsync({
                                    customerOrderId: order.id,
                                    idempotencyKey:
                                      typeof crypto !== "undefined" && "randomUUID" in crypto
                                        ? crypto.randomUUID()
                                        : `sales-order-${Date.now()}`,
                                  });
                                },
                                disabled: completeMutation.isLoading,
                              },
                            ]
                          : []),
                        ...(canFinalize && canCancel(order.status)
                          ? [
                              {
                                key: "cancel",
                                label: t("cancel"),
                                icon: CloseIcon,
                                variant: "danger",
                                onSelect: async () => {
                                  if (
                                    !(await confirm({
                                      description: t("confirmCancel"),
                                      confirmVariant: "danger",
                                    }))
                                  ) {
                                    return;
                                  }
                                  void cancelMutation.mutateAsync({ customerOrderId: order.id });
                                },
                                disabled: cancelMutation.isLoading,
                              },
                            ]
                          : []),
                      ]}
                    />
                  </div>
                </CardContent>
              </Card>
            )}
            paginationKey="sales-orders"
          />
          {listQuery.isLoading ? (
            <div className="bazaar-admin-empty mt-4 min-h-[9rem] gap-2">
              <span>{tCommon("loading")}</span>
            </div>
          ) : totalItems === 0 ? (
            <div className="bazaar-admin-empty mt-4">
              <div className="flex items-center gap-2">
                <EmptyIcon className="h-4 w-4" aria-hidden />
                {t("noOrders")}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
      {mobileFiltersOpen ? (
        <div className="fixed inset-0 z-[70] md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/35"
            onClick={() => setMobileFiltersOpen(false)}
            aria-label={tCommon("close")}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-label={tCommon("filters")}
            className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-background p-4 shadow-2xl"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{tCommon("filters")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="h-11 w-11 shrink-0"
                onClick={() => setMobileFiltersOpen(false)}
                aria-label={tCommon("close")}
              >
                <CloseIcon className="h-4 w-4" aria-hidden />
              </Button>
            </div>

            <div className="mt-4 space-y-4">
              <label className="space-y-1.5">
                <span className="text-sm font-medium text-foreground">{t("store")}</span>
                <Select
                  value={storeId}
                  onValueChange={(value) => {
                    setFilter("storeId", value === "all" ? null : value);
                  }}
                >
                  <SelectTrigger aria-label={t("store")} className="h-11">
                    <SelectValue placeholder={t("store")} />
                  </SelectTrigger>
                  <SelectContent>
                    {showAllStoresFilter ? (
                      <SelectItem value="all">{tCommon("allStores")}</SelectItem>
                    ) : null}
                    {stores.map((store) => (
                      <SelectItem key={store.id} value={store.id}>
                        {store.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-foreground">{t("statusLabel")}</span>
                <Select
                  value={statusFilter}
                  onValueChange={(value) => {
                    setFilter("status", value === "all" ? null : value);
                  }}
                >
                  <SelectTrigger aria-label={t("statusLabel")} className="h-11">
                    <SelectValue placeholder={t("statusLabel")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("allStatuses")}</SelectItem>
                    <SelectItem value="DRAFT">{getCustomerOrderStatusLabel(t, "DRAFT")}</SelectItem>
                    <SelectItem value="CONFIRMED">
                      {getCustomerOrderStatusLabel(t, "CONFIRMED")}
                    </SelectItem>
                    <SelectItem value="READY">{getCustomerOrderStatusLabel(t, "READY")}</SelectItem>
                    <SelectItem value="COMPLETED">
                      {getCustomerOrderStatusLabel(t, "COMPLETED")}
                    </SelectItem>
                    <SelectItem value="CANCELED">
                      {getCustomerOrderStatusLabel(t, "CANCELED")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-foreground">{t("sortLabel")}</span>
                <Select
                  value={`${sortBy}:${sortDirection}`}
                  onValueChange={(value) => {
                    const [nextSortBy, nextDirection] = value.split(":");
                    updateListParams({
                      sortBy: nextSortBy === "createdAt" ? null : nextSortBy,
                      sortDirection: nextDirection === "desc" ? null : nextDirection,
                      page: null,
                    });
                  }}
                >
                  <SelectTrigger aria-label={t("sortLabel")} className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="createdAt:desc">{t("sortNewest")}</SelectItem>
                    <SelectItem value="createdAt:asc">{t("sortOldest")}</SelectItem>
                    <SelectItem value="number:asc">{t("sortNumberAsc")}</SelectItem>
                    <SelectItem value="customerName:asc">{t("sortCustomerAsc")}</SelectItem>
                    <SelectItem value="totalKgs:desc">{t("sortTotalDesc")}</SelectItem>
                    <SelectItem value="totalKgs:asc">{t("sortTotalAsc")}</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="secondary"
                className="h-11"
                onClick={() => {
                  updateListParams({
                    search: null,
                    storeId: null,
                    status: null,
                    sortBy: null,
                    sortDirection: null,
                    page: null,
                  });
                }}
              >
                {tCommon("clearSelection")}
              </Button>
              <Button type="button" className="h-11" onClick={() => setMobileFiltersOpen(false)}>
                {tCommon("confirm")}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
      {confirmDialog}
    </div>
  );
};

export default SalesOrdersPage;

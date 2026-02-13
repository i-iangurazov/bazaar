"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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
import {
  AddIcon,
  CheckIcon,
  CloseIcon,
  EmptyIcon,
  ViewIcon,
} from "@/components/icons";
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
import { formatCurrencyKGS, formatDate } from "@/lib/i18nFormat";
import { getCustomerOrderStatusLabel } from "@/lib/i18n/status";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const SalesOrdersPage = () => {
  const t = useTranslations("salesOrders");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session } = useSession();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [storeId, setStoreId] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<CustomerOrderStatus | "all">("all");

  const canFinalize = session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";

  const storesQuery = trpc.stores.list.useQuery();
  const listQuery = trpc.salesOrders.list.useQuery({
    page,
    pageSize,
    search: search.trim() || undefined,
    storeId: storeId === "all" ? undefined : storeId,
    status: statusFilter === "all" ? undefined : statusFilter,
  });

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
    onSuccess: async () => {
      await listQuery.refetch();
      toast({ variant: "success", description: t("cancelSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const items = useMemo(() => listQuery.data?.items ?? [], [listQuery.data?.items]);
  const totalItems = listQuery.data?.total ?? 0;

  const statusVariant = (status: CustomerOrderStatus): "default" | "success" | "warning" | "danger" => {
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

  return (
    <div>
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

      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchPlaceholder")}
            />
            <Select
              value={storeId}
              onValueChange={(value) => {
                setStoreId(value);
                setPage(1);
              }}
            >
              <SelectTrigger aria-label={t("store")}>
                <SelectValue placeholder={t("store")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tCommon("allStores")}</SelectItem>
                {(storesQuery.data ?? []).map((store) => (
                  <SelectItem key={store.id} value={store.id}>
                    {store.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value as CustomerOrderStatus | "all");
                setPage(1);
              }}
            >
              <SelectTrigger aria-label={t("statusLabel")}>
                <SelectValue placeholder={t("statusLabel")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allStatuses")}</SelectItem>
                <SelectItem value="DRAFT">{getCustomerOrderStatusLabel(t, "DRAFT")}</SelectItem>
                <SelectItem value="CONFIRMED">{getCustomerOrderStatusLabel(t, "CONFIRMED")}</SelectItem>
                <SelectItem value="READY">{getCustomerOrderStatusLabel(t, "READY")}</SelectItem>
                <SelectItem value="COMPLETED">{getCustomerOrderStatusLabel(t, "COMPLETED")}</SelectItem>
                <SelectItem value="CANCELED">{getCustomerOrderStatusLabel(t, "CANCELED")}</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center text-sm text-muted-foreground">
              {t("totalLabel", { count: totalItems })}
            </div>
          </div>

          <ResponsiveDataList
            items={items}
            getKey={(item) => item.id}
            page={page}
            totalItems={totalItems}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            renderDesktop={(visibleItems) => (
              <div className="overflow-x-auto">
                <Table className="min-w-[760px]" data-tour="sales-orders-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("number")}</TableHead>
                      <TableHead>{t("customer")}</TableHead>
                      <TableHead>{t("store")}</TableHead>
                      <TableHead>{t("statusLabel")}</TableHead>
                      <TableHead>{t("total")}</TableHead>
                      <TableHead>{t("created")}</TableHead>
                      <TableHead className="text-right">{tCommon("actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleItems.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell>
                          <Link className="font-medium text-foreground" href={`/sales/orders/${order.id}`}>
                            {order.number}
                          </Link>
                        </TableCell>
                        <TableCell>{order.customerName || tCommon("notAvailable")}</TableCell>
                        <TableCell>{order.store.name}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(order.status)}>
                            {getCustomerOrderStatusLabel(t, order.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatCurrencyKGS(order.totalKgs, locale)}</TableCell>
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
                                          if (!(await confirm({ description: t("confirmCancel"), confirmVariant: "danger" }))) {
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
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            renderMobile={(order) => (
              <Card className="border-border">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link className="text-sm font-semibold text-foreground" href={`/sales/orders/${order.id}`}>
                      {order.number}
                    </Link>
                    <Badge variant={statusVariant(order.status)}>
                      {getCustomerOrderStatusLabel(t, order.status)}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>
                      <p>{t("customer")}</p>
                      <p className="font-medium text-foreground">{order.customerName || tCommon("notAvailable")}</p>
                    </div>
                    <div>
                      <p>{t("store")}</p>
                      <p className="font-medium text-foreground">{order.store.name}</p>
                    </div>
                    <div>
                      <p>{t("total")}</p>
                      <p className="font-medium text-foreground">{formatCurrencyKGS(order.totalKgs, locale)}</p>
                    </div>
                    <div>
                      <p>{t("created")}</p>
                      <p className="font-medium text-foreground">{formatDate(order.createdAt, locale)}</p>
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
                                  if (!(await confirm({ description: t("confirmCancel"), confirmVariant: "danger" }))) {
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
            empty={
              <div className="rounded-lg border border-dashed border-border p-6 text-center">
                <EmptyIcon className="mx-auto mb-2 h-5 w-5 text-muted-foreground" aria-hidden />
                <p className="text-sm text-muted-foreground">{t("noOrders")}</p>
                <Link href="/sales/orders/new" className="mt-3 inline-flex">
                  <Button size="sm">
                    <AddIcon className="h-4 w-4" aria-hidden />
                    {t("create")}
                  </Button>
                </Link>
              </div>
            }
            paginationKey="sales-orders"
          />
        </CardContent>
      </Card>
      {confirmDialog}
    </div>
  );
};

export default SalesOrdersPage;

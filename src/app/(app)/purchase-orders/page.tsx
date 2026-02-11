"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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
  CloseIcon,
  EmptyIcon,
  StatusDangerIcon,
  StatusPendingIcon,
  StatusSuccessIcon,
  ViewIcon,
} from "@/components/icons";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SelectionToolbar } from "@/components/selection-toolbar";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { RowActions } from "@/components/row-actions";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { formatCurrencyKGS, formatDate } from "@/lib/i18nFormat";
import { getPurchaseOrderStatusLabel } from "@/lib/i18n/status";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { useSse } from "@/lib/useSse";

const PurchaseOrdersPage = () => {
  const t = useTranslations("purchaseOrders");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const { data: session } = useSession();
  const canManage = session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [bulkCanceling, setBulkCanceling] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const listQuery = trpc.purchaseOrders.list.useQuery({ page, pageSize });
  const orders = useMemo(() => listQuery.data?.items ?? [], [listQuery.data?.items]);
  const totalOrders = listQuery.data?.total ?? 0;
  const cancelMutation = trpc.purchaseOrders.cancel.useMutation({
    onMutate: (variables) => {
      setCancelingId(variables.purchaseOrderId);
    },
    onSuccess: () => {
      listQuery.refetch();
      toast({ variant: "success", description: t("cancelSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
    onSettled: () => {
      setCancelingId(null);
    },
  });
  const bulkCancelMutation = trpc.purchaseOrders.cancel.useMutation();

  useSse({
    "purchaseOrder.updated": () => listQuery.refetch(),
  });

  const statusLabel = (status: string) => getPurchaseOrderStatusLabel(t, status);

  const statusIcon = (status: string) => {
    switch (status) {
      case "RECEIVED":
        return StatusSuccessIcon;
      case "PARTIALLY_RECEIVED":
        return StatusPendingIcon;
      case "CANCELLED":
        return StatusDangerIcon;
      case "APPROVED":
      case "SUBMITTED":
        return StatusPendingIcon;
      default:
        return StatusPendingIcon;
    }
  };

  const selectedOrders = useMemo(
    () => orders.filter((po) => selectedIds.has(po.id)),
    [orders, selectedIds],
  );
  const allSelected = Boolean(orders.length) && selectedIds.size === orders.length;
  const cancelableSelected = selectedOrders.filter(
    (po) => po.status === "DRAFT" || po.status === "SUBMITTED",
  );

  const toggleSelectAll = () => {
    if (!orders.length) {
      return;
    }
    setSelectedIds(() => {
      if (allSelected) {
        return new Set();
      }
      return new Set(orders.map((po) => po.id));
    });
  };

  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, pageSize]);

  const toggleSelect = (purchaseOrderId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(purchaseOrderId)) {
        next.delete(purchaseOrderId);
      } else {
        next.add(purchaseOrderId);
      }
      return next;
    });
  };

  const handleBulkCancel = async () => {
    if (!cancelableSelected.length) {
      toast({ variant: "error", description: t("bulkCancelUnavailable") });
      return;
    }
    if (
      !(await confirm({
        description: t("confirmBulkCancel", { count: cancelableSelected.length }),
        confirmVariant: "danger",
      }))
    ) {
      return;
    }
    setBulkCanceling(true);
    try {
      await Promise.all(
        cancelableSelected.map((po) =>
          bulkCancelMutation.mutateAsync({ purchaseOrderId: po.id }),
        ),
      );
      await listQuery.refetch();
      setSelectedIds(new Set());
      toast({
        variant: "success",
        description: t("bulkCancelSuccess", { count: cancelableSelected.length }),
      });
    } catch (error) {
      toast({
        variant: "error",
        description: translateError(tErrors, error as Parameters<typeof translateError>[1]),
      });
    } finally {
      setBulkCanceling(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          canManage ? (
            <Link href="/purchase-orders/new" className="w-full sm:w-auto">
              <Button className="w-full sm:w-auto" data-tour="po-create">
                <AddIcon className="h-4 w-4" aria-hidden />
                {t("new")}
              </Button>
            </Link>
          ) : null
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {canManage && orders.length ? (
            <div className="mb-3 sm:hidden">
              <div className="flex flex-wrap items-center gap-2">
                {!allSelected ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={toggleSelectAll}
                  >
                    {t("selectAll")}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          {canManage && selectedOrders.length ? (
            <div className="mb-3">
              <TooltipProvider>
                <SelectionToolbar
                  count={selectedOrders.length}
                  label={tCommon("selectedCount", { count: selectedOrders.length })}
                  clearLabel={tCommon("clearSelection")}
                  onClear={() => setSelectedIds(new Set())}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-danger shadow-none hover:text-danger"
                        aria-label={t("bulkCancel")}
                        onClick={handleBulkCancel}
                        disabled={bulkCanceling || !cancelableSelected.length}
                      >
                        {bulkCanceling ? <Spinner className="h-4 w-4" /> : <CloseIcon className="h-4 w-4" aria-hidden />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("bulkCancel")}</TooltipContent>
                  </Tooltip>
                </SelectionToolbar>
              </TooltipProvider>
            </div>
          ) : null}
          <ResponsiveDataList
            items={orders}
            getKey={(po) => po.id}
            page={page}
            totalItems={totalOrders}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            renderDesktop={(visibleItems) => (
              <div className="overflow-x-auto">
                <TooltipProvider>
                  <Table className="min-w-[760px]" data-tour="po-table">
                    <TableHeader>
                      <TableRow>
                        {canManage ? (
                          <TableHead className="w-10">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-border bg-background text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                              checked={allSelected}
                              onChange={toggleSelectAll}
                              aria-label={t("selectAll")}
                            />
                          </TableHead>
                        ) : null}
                        <TableHead>{t("number")}</TableHead>
                        <TableHead>{t("supplier")}</TableHead>
                        <TableHead>{t("store")}</TableHead>
                        <TableHead>{t("statusLabel")}</TableHead>
                        <TableHead>{t("total")}</TableHead>
                        <TableHead className="hidden md:table-cell">{t("created")}</TableHead>
                        <TableHead>{tCommon("actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleItems.map((po) => (
                        <TableRow key={po.id}>
                          {canManage ? (
                            <TableCell>
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-border bg-background text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                                checked={selectedIds.has(po.id)}
                                onChange={() => toggleSelect(po.id)}
                                aria-label={t("selectPurchaseOrder", { number: po.id.slice(0, 8).toUpperCase() })}
                              />
                            </TableCell>
                          ) : null}
                          <TableCell className="text-xs text-gray-500" title={po.id}>
                            {po.id.slice(0, 8).toUpperCase()}
                          </TableCell>
                          <TableCell>
                            <Link className="font-medium text-ink" href={`/purchase-orders/${po.id}`}>
                              {po.supplier?.name ?? tCommon("supplierUnassigned")}
                            </Link>
                          </TableCell>
                          <TableCell className="text-xs text-gray-500">{po.store.name}</TableCell>
                          <TableCell>
                              <Badge
                                variant={
                                  po.status === "RECEIVED"
                                    ? "success"
                                    : po.status === "PARTIALLY_RECEIVED"
                                      ? "warning"
                                      : po.status === "CANCELLED"
                                        ? "danger"
                                        : "warning"
                                }
                              >
                              {(() => {
                                const Icon = statusIcon(po.status);
                                return <Icon className="h-3 w-3" aria-hidden />;
                              })()}
                              {statusLabel(po.status)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-gray-500">
                            {po.hasCost ? formatCurrencyKGS(po.total, locale) : tCommon("notAvailable")}
                          </TableCell>
                          <TableCell className="text-xs text-gray-500 hidden md:table-cell">
                            {formatDate(po.createdAt, locale)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="shadow-none"
                                    aria-label={tCommon("view")}
                                    onClick={() => router.push(`/purchase-orders/${po.id}`)}
                                  >
                                    <ViewIcon className="h-4 w-4" aria-hidden />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>{tCommon("view")}</TooltipContent>
                              </Tooltip>
                              {canManage && (po.status === "DRAFT" || po.status === "SUBMITTED") ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="text-danger shadow-none hover:text-danger"
                                      aria-label={t("cancelOrder")}
                                      onClick={async () => {
                                        if (!(await confirm({ description: t("confirmCancel"), confirmVariant: "danger" }))) {
                                          return;
                                        }
                                        cancelMutation.mutate({ purchaseOrderId: po.id });
                                      }}
                                      disabled={cancelingId === po.id}
                                    >
                                      {cancelingId === po.id ? (
                                        <Spinner className="h-4 w-4" />
                                      ) : (
                                        <CloseIcon className="h-4 w-4" aria-hidden />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{t("cancelOrder")}</TooltipContent>
                                </Tooltip>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TooltipProvider>
              </div>
            )}
            renderMobile={(po) => {
              const status = statusLabel(po.status);
              const StatusIcon = statusIcon(po.status);
              const actions = [
                {
                  key: "view",
                  label: tCommon("view"),
                  icon: ViewIcon,
                  onSelect: () => router.push(`/purchase-orders/${po.id}`),
                },
                ...(canManage && (po.status === "DRAFT" || po.status === "SUBMITTED")
                  ? [
                      {
                        key: "cancel",
                        label: t("cancelOrder"),
                        icon: CloseIcon,
                        variant: "danger",
                        disabled: cancelingId === po.id,
                        onSelect: async () => {
                          if (!(await confirm({ description: t("confirmCancel"), confirmVariant: "danger" }))) {
                            return;
                          }
                          cancelMutation.mutate({ purchaseOrderId: po.id });
                        },
                      },
                    ]
                  : []),
              ];

              return (
                <div className="rounded-md border border-gray-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2">
                      {canManage ? (
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border-border bg-background text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                          checked={selectedIds.has(po.id)}
                          onChange={() => toggleSelect(po.id)}
                          aria-label={t("selectPurchaseOrder", { number: po.id.slice(0, 8).toUpperCase() })}
                        />
                      ) : null}
                      <div className="min-w-0">
                        <p className="text-xs text-gray-500">{po.id.slice(0, 8).toUpperCase()}</p>
                        <p className="truncate text-sm font-medium text-ink">
                          {po.supplier?.name ?? tCommon("supplierUnassigned")}
                        </p>
                        <p className="text-xs text-gray-500">{po.store.name}</p>
                      </div>
                    </div>
                    <RowActions
                      actions={actions}
                      maxInline={1}
                      moreLabel={tCommon("tooltips.moreActions")}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge
                      variant={
                        po.status === "RECEIVED"
                          ? "success"
                          : po.status === "PARTIALLY_RECEIVED"
                            ? "warning"
                            : po.status === "CANCELLED"
                              ? "danger"
                              : "warning"
                      }
                    >
                      <StatusIcon className="h-3 w-3" aria-hidden />
                      {status}
                    </Badge>
                    <span className="text-xs text-gray-500">
                      {po.hasCost ? formatCurrencyKGS(po.total, locale) : tCommon("notAvailable")}
                    </span>
                    <span className="text-xs text-gray-500">
                      {formatDate(po.createdAt, locale)}
                    </span>
                  </div>
                </div>
              );
            }}
          />
          {listQuery.isLoading ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : totalOrders === 0 ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-gray-500">
              <div className="flex items-center gap-2">
                <EmptyIcon className="h-4 w-4" aria-hidden />
                {t("noOrders")}
              </div>
            </div>
          ) : null}
          {listQuery.error ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-red-500">
              <span>{translateError(tErrors, listQuery.error)}</span>
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => listQuery.refetch()}
              >
                {tCommon("tryAgain")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
      {confirmDialog}
    </div>
  );
};

export default PurchaseOrdersPage;

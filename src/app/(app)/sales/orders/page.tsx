"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { CustomerOrderStatus } from "@prisma/client";

import { ListToolbar, ListSearch, FilterField } from "@/components/list-toolbar";
import { QueryErrorState } from "@/components/query-error-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  ChevronDownIcon,
  AdjustIcon,
  ArchiveIcon,
  RestoreIcon,
  CheckIcon,
  CloseIcon,
  EditIcon,
  EmptyIcon,
  PrintIcon,
  ViewIcon,
} from "@/components/icons";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { RowActions } from "@/components/row-actions";
import { SalesDocumentActions } from "@/components/sales-document-actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { currencySourceWithFallback, formatKgsMoney } from "@/lib/currencyDisplay";
import { useIsMobile } from "@/hooks/useIsMobile";
import { scrollChildIntoHorizontalView } from "@/lib/horizontalScrollFocus";
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

const SalesOrdersPageContent = () => {
  const t = useTranslations("salesOrders");
  const isMobile = useIsMobile();
  const tCommon = useTranslations("common");
  const tWorkspace = useTranslations("workspace");
  const tDocuments = useTranslations("salesDocuments");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session } = useSession();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [documentTarget, setDocumentTarget] = useState<{ id: string; number: string } | null>(null);
  const actionTriggerRefs = useRef(new Map<string, HTMLButtonElement[]>());
  const documentReturnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (documentTarget) return;
    const target = documentReturnFocusRef.current;
    if (!target?.isConnected) return;
    const timer = window.setTimeout(() => target.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [documentTarget]);
  const pathname = usePathname() ?? "/sales/orders";
  const searchParams = useSearchParams();
  const currentQueryString = searchParams.toString();
  const archiveView = searchParams.get("view") === "archive";
  const lifecycleView = archiveView
    ? "ALL"
    : searchParams.get("view") === "history"
      ? "HISTORY"
      : "ACTIVE";
  const page = parsePositiveInteger(searchParams.get("page"), 1, 10_000);
  const pageSize = parsePositiveInteger(searchParams.get("pageSize"), 25, 200);
  const search = searchParams.get("search") ?? "";
  const storeId = searchParams.get("storeId") || "all";
  const employeeId = searchParams.get("employeeId") || "all";
  const createdFromDay = searchParams.get("createdFromDay") ?? "";
  const createdToDay = searchParams.get("createdToDay") ?? "";
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
  const utils = trpc.useUtils();

  const updateListParams = useCallback(
    (updates: Record<string, string | number | null>) => {
      const params = new URLSearchParams(window.location.search);
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === "") {
          params.delete(key);
        } else {
          params.set(key, String(value));
        }
      });
      const nextQuery = params.toString();
      window.history.replaceState(null, "", nextQuery ? `${pathname}?${nextQuery}` : pathname);
    },
    [pathname],
  );
  const setPage = (value: number) => updateListParams({ page: value === 1 ? null : value });
  const setPageSize = (value: number) =>
    updateListParams({ pageSize: value === 25 ? null : value, page: null });
  const setFilter = (key: string, value: string | null) =>
    updateListParams({ [key]: value, page: null });

  const canFinalize = session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";
  const listReturnUrl = currentQueryString ? `${pathname}?${currentQueryString}` : pathname;
  const orderHref = (customerOrderId: string) =>
    `/sales/orders/${customerOrderId}?returnTo=${encodeURIComponent(listReturnUrl)}`;

  const storesQuery = trpc.stores.list.useQuery();
  const stores = useMemo(() => storesQuery.data ?? [], [storesQuery.data]);
  const showAllStoresFilter = stores.length !== 1;
  const selectedStore =
    stores.find((store) => store.id === storeId) ??
    (storeId === "all" && stores.length === 1 ? stores[0] : undefined);
  const employeesQuery = trpc.salesOrders.employeeOptions.useQuery({
    storeId: storeId === "all" ? undefined : storeId,
  });
  const employees = useMemo(() => employeesQuery.data ?? [], [employeesQuery.data]);

  const listQuery = trpc.salesOrders.list.useQuery(
    {
      page,
      pageSize,
      search: search.trim() || undefined,
      storeId: storeId === "all" ? undefined : storeId,
      employeeId: employeeId === "all" ? undefined : employeeId,
      createdFromDay: createdFromDay || undefined,
      createdToDay: createdToDay || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
      sortBy,
      sortDirection,
      lifecycleView,
      archiveFilter: archiveView ? "ARCHIVED" : "VISIBLE",
    },
    { keepPreviousData: true },
  );

  const completeMutation = trpc.salesOrders.complete.useMutation({
    onSuccess: async (order, variables) => {
      utils.salesOrders.getById.setData(
        { customerOrderId: variables.customerOrderId },
        (current) => (current ? { ...current, ...order } : current),
      );
      await Promise.all([
        utils.salesOrders.list.invalidate(),
        utils.salesOrders.getById.invalidate({ customerOrderId: variables.customerOrderId }),
      ]);
      toast({ variant: "success", description: t("completeSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const cancelMutation = trpc.salesOrders.cancel.useMutation({
    onSuccess: async (result, variables) => {
      utils.salesOrders.getById.setData(
        { customerOrderId: variables.customerOrderId },
        (current) => (current ? { ...current, ...result.order } : current),
      );
      await Promise.all([
        utils.salesOrders.list.invalidate(),
        utils.salesOrders.getById.invalidate({ customerOrderId: variables.customerOrderId }),
      ]);
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

  const archiveMutation = trpc.salesOrders.setArchived.useMutation({
    onSuccess: async (_order, variables) => {
      await Promise.all([
        utils.salesOrders.list.invalidate(),
        utils.salesOrders.getById.invalidate({ customerOrderId: variables.customerOrderId }),
      ]);
      if (items.length === 1 && page > 1) setPage(page - 1);
      toast({
        variant: "success",
        description: t(variables.archived ? "archive.saved" : "archive.restored"),
      });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const archiveActions = (order: { id: string; archivedAt: Date | null }) =>
    canFinalize
      ? [
          {
            key: "archive",
            label: t(order.archivedAt ? "archive.restore" : "archive.action"),
            icon: order.archivedAt ? RestoreIcon : ArchiveIcon,
            disabled: archiveMutation.isLoading,
            onSelect: async () => {
              if (!order.archivedAt && !(await confirm({ description: t("archive.confirm") })))
                return;
              archiveMutation.mutate({ customerOrderId: order.id, archived: !order.archivedAt });
            },
          },
        ]
      : [];
  const items = useMemo(() => listQuery.data?.items ?? [], [listQuery.data?.items]);
  const totalItems = listQuery.data?.total ?? 0;

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

  const canOfferUnpaidEdit = (order: (typeof items)[number]) =>
    canFinalize &&
    order.status === CustomerOrderStatus.COMPLETED &&
    order.source === "MANUAL" &&
    !order.archivedAt &&
    !order.externalOrderId &&
    !order.registerId &&
    !order.shiftId &&
    !order.isDebt &&
    !order.receivedPayments?.length;

  const orderActions = (order: (typeof items)[number]) => [
    {
      key: "view",
      label: tCommon("view"),
      icon: ViewIcon,
      href: orderHref(order.id),
    },
    ...(order.status === CustomerOrderStatus.DRAFT ||
    order.status === CustomerOrderStatus.CONFIRMED ||
    canOfferUnpaidEdit(order)
      ? [
          {
            key: "edit",
            label: t("editOrder"),
            icon: EditIcon,
            href: `/sales/orders/${encodeURIComponent(order.id)}/edit?returnTo=${encodeURIComponent(listReturnUrl)}`,
          },
        ]
      : []),
    ...(canFinalize && order.status === CustomerOrderStatus.COMPLETED && !canOfferUnpaidEdit(order)
      ? [
          {
            key: "correct",
            label: t("correctOrder"),
            icon: AdjustIcon,
            href: `/sales/orders/${encodeURIComponent(order.id)}/correction?returnTo=${encodeURIComponent(listReturnUrl)}`,
          },
        ]
      : []),
    {
      key: "document",
      label: tDocuments("open"),
      icon: PrintIcon,
      onSelect: () => {
        const triggers = actionTriggerRefs.current.get(order.id) ?? [];
        documentReturnFocusRef.current =
          triggers.find((trigger) => trigger.offsetParent !== null) ?? triggers[0] ?? null;
        setDocumentTarget({ id: order.id, number: order.number });
      },
    },
    ...(canFinalize && !order.archivedAt && order.status === CustomerOrderStatus.READY
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
    ...archiveActions(order),
    ...(canFinalize && !order.archivedAt && canCancel(order.status)
      ? [
          {
            key: "cancel",
            label: t("cancel"),
            icon: CloseIcon,
            variant: "danger",
            separatorBefore: true,
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
  ];

  const sourceLabel = (source?: string | null) =>
    source === "API"
      ? t("source.api")
      : source === "CATALOG"
        ? t("source.catalog")
        : t("source.manual");

  const defaultSort = sortBy === "createdAt" && sortDirection === "desc";
  const currentSortLabel =
    sortBy === "number"
      ? t("sortNumberAsc")
      : sortBy === "customerName"
        ? t("sortCustomerAsc")
        : sortBy === "totalKgs"
          ? sortDirection === "asc"
            ? t("sortTotalAsc")
            : t("sortTotalDesc")
          : sortDirection === "asc"
            ? t("sortOldest")
            : t("sortNewest");
  const activeExtraFilterCount = Number(statusFilter !== "all") + Number(!defaultSort);

  const employeeLabel = (order: {
    source?: string | null;
    createdBy?: { name: string; isActive: boolean } | null;
  }) => order.createdBy?.name ?? (order.source === "API" ? t("systemActor") : t("unknownEmployee"));

  const renderReceivedPayments = (order: (typeof items)[number]) => {
    if (!order.receivedPayments?.length) return tCommon("notAvailable");

    const currency = currencySourceWithFallback(order, order.store);
    return (
      <ul className="space-y-1">
        {order.receivedPayments.map(({ method, amountKgs }) => (
          <li key={method} className="leading-tight">
            <span className="block">{t(`payment.${method}`)}</span>
            <span className="block whitespace-nowrap text-xs font-normal text-muted-foreground">
              {formatKgsMoney(amountKgs, locale, currency)}
            </span>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="space-y-3 md:space-y-6">
      <PageHeader
        compactMobile
        actionClassName="max-md:w-full max-md:flex-nowrap max-md:justify-start"
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <>
            {canFinalize ? (
              <Button asChild variant="secondary" className="w-full sm:w-auto max-md:h-11 max-md:w-11 max-md:shrink-0 max-md:p-0">
                <Link href="/sales/orders/metrics" aria-label={t("metricsTitle")} title={t("metricsTitle")}>
                  <ViewIcon className="h-4 w-4" aria-hidden />
                  <span className="hidden md:inline">{t("metricsTitle")}</span>
                </Link>
              </Button>
            ) : null}
            <Button asChild className="w-full sm:w-auto max-md:h-11 max-md:min-w-0 max-md:flex-1" data-tour="sales-orders-create">
              <Link href={`/sales/orders/new?${new URLSearchParams({ returnTo: listReturnUrl, ...(storeId !== "all" ? { storeId } : {}) })}`}>
                <AddIcon className="h-4 w-4" aria-hidden />
                <span className="truncate">{t("new")}</span>
              </Link>
            </Button>
          </>
        }
      />

      <Card className="bazaar-admin-surface max-md:border-0 max-md:bg-transparent">
        <CardHeader className="hidden border-b border-border bg-muted/20 md:block">
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 max-md:space-y-2 max-md:p-0">
          <div
            className="grid grid-cols-3 gap-2 rounded-md border border-border bg-muted/35 p-1 max-md:gap-0.5"
            role="tablist"
            aria-label={t("lifecycleViewLabel")}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const views = ["active", "history", "archive"];
              const current = archiveView ? 2 : lifecycleView === "HISTORY" ? 1 : 0;
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? 2
                    : (current + (event.key === "ArrowRight" ? 1 : 2)) % 3;
              updateListParams({ view: next === 0 ? null : views[next], page: null });
              (
                event.currentTarget.querySelectorAll('[role="tab"]')[next] as HTMLButtonElement
              )?.focus();
            }}
          >
            <Button
              type="button"
              role="tab"
              aria-selected={lifecycleView === "ACTIVE"}
              tabIndex={lifecycleView === "ACTIVE" ? 0 : -1}
              data-testid="sales-orders-active-tab"
              variant={lifecycleView === "ACTIVE" ? "default" : "ghost"}
              className="min-h-11"
              onClick={() => updateListParams({ view: null, page: null })}
            >
              {t("activeView")}
            </Button>
            <Button
              type="button"
              role="tab"
              aria-selected={lifecycleView === "HISTORY"}
              tabIndex={lifecycleView === "HISTORY" ? 0 : -1}
              data-testid="sales-orders-history-tab"
              variant={lifecycleView === "HISTORY" ? "default" : "ghost"}
              className="min-h-11"
              onClick={() => updateListParams({ view: "history", page: null })}
            >
              {t("historyView")}
            </Button>
            <Button
              type="button"
              role="tab"
              aria-selected={archiveView}
              tabIndex={archiveView ? 0 : -1}
              data-testid="sales-orders-archive-tab"
              variant={archiveView ? "default" : "ghost"}
              className="min-h-11"
              onClick={() => updateListParams({ view: "archive", page: null })}
            >
              {t("archive.view")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground max-md:sr-only">
            {archiveView
              ? t("archive.hint")
              : lifecycleView === "ACTIVE"
                ? t("activeViewHint")
                : t("historyViewHint")}
          </p>
          <ListToolbar
            total={totalItems}
            loading={listQuery.isFetching}
            filters={[
              ...(search
                ? [
                    {
                      key: "search",
                      label: `${tCommon("search")}: ${search}`,
                      onRemove: () => setFilter("search", null),
                    },
                  ]
                : []),
              ...(statusFilter !== "all"
                ? [
                    {
                      key: "status",
                      label: getCustomerOrderStatusLabel(t, statusFilter),
                      onRemove: () => setFilter("status", null),
                    },
                  ]
                : []),
              ...(!defaultSort
                ? [
                    {
                      key: "sort",
                      label: `${t("sortLabel")}: ${currentSortLabel}`,
                      onRemove: () =>
                        updateListParams({ sortBy: null, sortDirection: null, page: null }),
                    },
                  ]
                : []),
              ...(employeeId !== "all"
                ? [
                    {
                      key: "employee",
                      label: `${t("employeeFilter")}: ${
                        employees.find((employee) => employee.id === employeeId)?.name ??
                        t("unknownEmployee")
                      }`,
                      onRemove: () => setFilter("employeeId", null),
                    },
                  ]
                : []),
              ...(createdFromDay || createdToDay
                ? [
                    {
                      key: "period",
                      label: `${t("createdPeriod")}: ${createdFromDay || "…"} — ${createdToDay || "…"}`,
                      onRemove: () =>
                        updateListParams({ createdFromDay: null, createdToDay: null, page: null }),
                    },
                  ]
                : []),
            ]}
            onReset={() =>
              updateListParams({
                search: null,
                status: null,
                sortBy: null,
                sortDirection: null,
                employeeId: null,
                createdFromDay: null,
                createdToDay: null,
                page: null,
              })
            }
            extraCount={activeExtraFilterCount}
            extra={
              <div className="contents" data-testid="sales-order-extra-filters">
                <FilterField id="sales-order-statusLabel" label={t("statusLabel")}>
                  <Select
                    value={statusFilter}
                    onValueChange={(value) => {
                      setFilter("status", value === "all" ? null : value);
                    }}
                  >
                    <SelectTrigger id="sales-order-statusLabel" aria-label={t("statusLabel")}>
                      <SelectValue placeholder={t("statusLabel")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("allStatuses")}</SelectItem>
                      <SelectItem value="DRAFT">
                        {getCustomerOrderStatusLabel(t, "DRAFT")}
                      </SelectItem>
                      <SelectItem value="CONFIRMED">
                        {getCustomerOrderStatusLabel(t, "CONFIRMED")}
                      </SelectItem>
                      <SelectItem value="READY">
                        {getCustomerOrderStatusLabel(t, "READY")}
                      </SelectItem>
                      <SelectItem value="COMPLETED">
                        {getCustomerOrderStatusLabel(t, "COMPLETED")}
                      </SelectItem>
                      <SelectItem value="CANCELED">
                        {getCustomerOrderStatusLabel(t, "CANCELED")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </FilterField>
                <FilterField id="sales-order-sortLabel" label={t("sortLabel")}>
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
                    <SelectTrigger id="sales-order-sortLabel" aria-label={t("sortLabel")}>
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
                </FilterField>
              </div>
            }
            compactMobile={{
              scope: selectedStore?.name ?? (storeId === "all" ? tCommon("allStores") : t("store")),
              extraCount:
                activeExtraFilterCount +
                Number(employeeId !== "all") +
                Number(Boolean(createdFromDay || createdToDay)),
              search: (
                <ListSearch
                  className="max-md:basis-0 max-md:[&>label]:sr-only"
                  value={search}
                  onChange={(value) => setFilter("search", value)}
                  label={tCommon("search")}
                  placeholder={isMobile ? tCommon("search") : t("searchPlaceholder")}
                />
              ),
            }}
          >
            <FilterField id="sales-order-store" label={t("store")}>
              <Select
                value={storeId === "all" && stores.length === 1 ? stores[0].id : storeId}
                onValueChange={(value) => {
                  setFilter("storeId", value === "all" ? null : value);
                }}
              >
                <SelectTrigger id="sales-order-store" aria-label={t("store")}>
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
            </FilterField>
            <FilterField id="sales-order-employee" label={t("employeeFilter")}>
              <Select
                value={employeeId}
                onValueChange={(value) => setFilter("employeeId", value === "all" ? null : value)}
              >
                <SelectTrigger id="sales-order-employee" aria-label={t("employeeFilter")}>
                  <SelectValue placeholder={t("employeeFilter")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allEmployees")}</SelectItem>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.name}
                      {employee.isActive ? "" : ` (${t("inactiveEmployee")})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <fieldset className="min-w-0 flex-1 basis-80" data-testid="sales-order-period-group">
              <legend className="mb-1.5 block text-xs font-medium text-muted-foreground">
                {t("createdPeriod")}
              </legend>
              <div className="grid min-w-0 grid-cols-2 gap-2 max-[380px]:grid-cols-1">
                <div className="min-w-0">
                  <label
                    htmlFor="sales-order-created-from"
                    className="mb-1 block text-[11px] leading-4 text-muted-foreground"
                  >
                    {t("createdFrom")}
                  </label>
                  <Input
                    id="sales-order-created-from"
                    type="date"
                    value={createdFromDay}
                    max={createdToDay || undefined}
                    aria-describedby="sales-order-created-period-hint"
                    onChange={(event) => setFilter("createdFromDay", event.target.value || null)}
                  />
                </div>
                <div className="min-w-0">
                  <label
                    htmlFor="sales-order-created-to"
                    className="mb-1 block text-[11px] leading-4 text-muted-foreground"
                  >
                    {t("createdTo")}
                  </label>
                  <Input
                    id="sales-order-created-to"
                    type="date"
                    value={createdToDay}
                    min={createdFromDay || undefined}
                    aria-describedby="sales-order-created-period-hint"
                    onChange={(event) => setFilter("createdToDay", event.target.value || null)}
                  />
                </div>
              </div>
            </fieldset>
            <p
              id="sales-order-created-period-hint"
              className="min-w-0 flex-1 basis-64 text-xs leading-5 text-muted-foreground"
            >
              {t("createdPeriodHint")}
            </p>
          </ListToolbar>

          {listQuery.error ? (
            <QueryErrorState error={listQuery.error} onRetry={() => void listQuery.refetch()} />
          ) : null}
          <ResponsiveDataList
            key={`sales-orders-${pageSize}`}
            items={items}
            getKey={(item) => item.id}
            page={page}
            totalItems={totalItems}
            defaultPageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            mobileItemsClassName="space-y-2"
            renderDesktop={(visibleItems) => (
              <div className="bazaar-admin-table-shell">
                <div
                  className="bazaar-admin-table-scroll"
                  onFocusCapture={(event) =>
                    scrollChildIntoHorizontalView(event.currentTarget, event.target)
                  }
                >
                  <Table className="min-w-[1195px] table-fixed" data-tour="sales-orders-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead wrap className="w-[80px]">
                          {t("number")}
                        </TableHead>
                        <TableHead wrap className="w-[80px]">
                          {t("customer")}
                        </TableHead>
                        <TableHead wrap className="w-[120px]">
                          {t("customerAddress")}
                        </TableHead>
                        <TableHead wrap className="w-[80px]">
                          {t("store")}
                        </TableHead>
                        <TableHead wrap className="w-[100px]">
                          {t("employee")}
                        </TableHead>
                        <TableHead wrap className="w-[110px]">
                          {t("statusLabel")}
                        </TableHead>
                        <TableHead wrap className="w-[80px]">
                          {t("trackingNumber")}
                        </TableHead>
                        <TableHead wrap className="w-[80px]">
                          {t("sourceLabel")}
                        </TableHead>
                        <TableHead wrap className="w-[90px]">
                          {t("total")}
                        </TableHead>
                        <TableHead wrap sortable={false} className="w-[140px]">
                          {t("payment.method")}
                        </TableHead>
                        <TableHead wrap className="w-[80px]">
                          {t("created")}
                        </TableHead>
                        <TableHead
                          sortable={false}
                          className="sticky right-0 z-10 w-[64px] bg-card px-1 text-right shadow-[-10px_0_14px_-14px_rgba(15,23,42,0.35)]"
                        >
                          {tCommon("actions")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleItems.map((order) => (
                        <TableRow key={order.id}>
                          <TableCell className="whitespace-nowrap">
                            <Link
                              className="font-medium text-foreground"
                              href={orderHref(order.id)}
                            >
                              {order.number}
                            </Link>
                          </TableCell>
                          <TableCell>{order.customerName || tCommon("notAvailable")}</TableCell>
                          <TableCell className="whitespace-normal break-words">
                            {order.customerAddress || tCommon("notAvailable")}
                          </TableCell>
                          <TableCell>{order.store.name}</TableCell>
                          <TableCell
                            className="max-w-[150px] truncate"
                            title={employeeLabel(order)}
                          >
                            {employeeLabel(order)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusVariant(order.status)}>
                              {getCustomerOrderStatusLabel(t, order.status)}
                            </Badge>
                          </TableCell>
                          <TableCell>{order.trackingNumber || tCommon("notAvailable")}</TableCell>
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
                          <TableCell className="whitespace-normal">{renderReceivedPayments(order)}</TableCell>
                          <TableCell>{formatDate(order.createdAt, locale)}</TableCell>
                          <TableCell className="sticky right-0 z-10 bg-card shadow-[-10px_0_14px_-14px_rgba(15,23,42,0.35)]">
                            <div className="flex items-center justify-end">
                              <RowActions
                                maxInline={0}
                                moreLabel={t("orderActions", { number: order.number })}
                                moreTriggerRef={(node) => {
                                  const current = actionTriggerRefs.current.get(order.id) ?? [];
                                  if (node) {
                                    if (!current.includes(node)) {
                                      actionTriggerRefs.current.set(order.id, [...current, node]);
                                    }
                                  } else {
                                    actionTriggerRefs.current.set(
                                      order.id,
                                      current.filter((item) => item !== node),
                                    );
                                  }
                                }}
                                actions={orderActions(order)}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="mt-2 text-xs text-muted-foreground min-[1540px]:hidden">
                  {t("horizontalScrollHint")}
                </p>
              </div>
            )}
            renderMobile={(order) => (
              <Card className="p-2.5">
                <div className="flex min-w-0 items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <Link
                      className="inline-block max-w-full break-words text-sm font-semibold text-foreground [overflow-wrap:anywhere]"
                      href={orderHref(order.id)}
                    >
                      {order.number}
                    </Link>
                    <p className="mt-0.5 break-words text-xs font-medium text-foreground [overflow-wrap:anywhere]">
                      {order.customerName || tCommon("notAvailable")}
                    </p>
                  </div>
                  <div className="min-w-0 max-w-[44%] text-right">
                    <p className="break-words text-sm font-semibold tabular-nums text-foreground [overflow-wrap:anywhere]">
                      {formatKgsMoney(
                        order.totalKgs,
                        locale,
                        currencySourceWithFallback(order, order.store),
                      )}
                    </p>
                    <Badge
                      className="mt-0.5 max-w-full whitespace-normal text-left"
                      variant={statusVariant(order.status)}
                    >
                      {getCustomerOrderStatusLabel(t, order.status)}
                    </Badge>
                  </div>
                  <RowActions
                    className="-mr-1 -mt-1 shrink-0"
                    maxInline={0}
                    moreLabel={t("orderActions", { number: order.number })}
                    moreTriggerRef={(node) => {
                      const current = actionTriggerRefs.current.get(order.id) ?? [];
                      if (node) {
                        if (!current.includes(node)) {
                          actionTriggerRefs.current.set(order.id, [...current, node]);
                        }
                      } else {
                        actionTriggerRefs.current.set(
                          order.id,
                          current.filter((item) => item !== node),
                        );
                      }
                    }}
                    actions={orderActions(order)}
                  />
                </div>
                <p className="mt-1 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {order.store.name} · {formatDate(order.createdAt, locale)}
                </p>
                <details className="group">
                  <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1 text-xs font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
                    {tWorkspace("viewDetails")}
                    <ChevronDownIcon className="h-3.5 w-3.5 group-open:rotate-180" aria-hidden />
                  </summary>
                  <dl className="grid min-w-0 grid-cols-2 gap-2 border-t border-border/70 pt-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    <div>
                      <dt>{t("employee")}</dt>
                      <dd className="text-foreground">{employeeLabel(order)}</dd>
                    </div>
                    <div>
                      <dt>{t("sourceLabel")}</dt>
                      <dd className="text-foreground">{sourceLabel(order.source)}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt>{t("customerAddress")}</dt>
                      <dd className="text-foreground">{order.customerAddress || tCommon("notAvailable")}</dd>
                    </div>
                    <div>
                      <dt>{t("trackingNumber")}</dt>
                      <dd className="text-foreground">{order.trackingNumber || tCommon("notAvailable")}</dd>
                    </div>
                    <div>
                      <dt>{t("payment.method")}</dt>
                      <dd className="text-foreground">{renderReceivedPayments(order)}</dd>
                    </div>
                  </dl>
                </details>
              </Card>
            )}
            paginationKey="sales-orders"
          />
          {listQuery.isLoading ? (
            <div className="bazaar-admin-empty mt-4 min-h-[9rem] gap-2">
              <span>{tCommon("loading")}</span>
            </div>
          ) : !listQuery.error && totalItems === 0 ? (
            <div className="bazaar-admin-empty mt-4">
              <div className="flex items-center gap-2">
                <EmptyIcon className="h-4 w-4" aria-hidden />
                {archiveView
                  ? t("archive.empty")
                  : lifecycleView === "ACTIVE"
                    ? t("noActiveOrders")
                    : t("noHistoryOrders")}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
      {confirmDialog}
      <SalesDocumentActions
        orderId={documentTarget?.id ?? ""}
        number={documentTarget?.number ?? ""}
        open={Boolean(documentTarget)}
        onOpenChange={(nextOpen) => {
          if (nextOpen) return;
          const id = documentTarget?.id;
          setDocumentTarget(null);
          if (id) {
            window.setTimeout(() => {
              const triggers = actionTriggerRefs.current.get(id) ?? [];
              (triggers.find((trigger) => trigger.offsetParent !== null) ?? triggers[0])?.focus();
            }, 60);
          }
        }}
        trigger={null}
        returnFocusRef={documentReturnFocusRef}
      />
    </div>
  );
};

const SalesOrdersPage = () => (
  <Suspense
    fallback={
      <div className="bazaar-admin-empty min-h-[12rem]">
        <span>…</span>
      </div>
    }
  >
    <SalesOrdersPageContent />
  </Suspense>
);

export default SalesOrdersPage;

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CustomerOrderStatus } from "@prisma/client";
import type { ColumnDef, OnChangeFn, SortingState } from "@tanstack/react-table";

import { PageHeader } from "@/components/page-header";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal, ModalFooter } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ArchiveIcon,
  CheckIcon,
  ChevronDownIcon,
  CirclePlusIcon,
  DownloadIcon,
  EditIcon,
  EmptyIcon,
  ReceiveIcon,
  SearchIcon,
  SortIcon,
  TransferIcon,
  ViewIcon,
} from "@/components/icons";
import { formatCurrencyKGS, formatDateTime, formatNumber } from "@/lib/i18nFormat";
import { getProductMovementEditTarget } from "@/lib/productMovementEditTarget";
import { resolveSafeReturnTo } from "@/lib/safeReturnTo";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const documentTypeOptions = [
  "SALE",
  "RETURN",
  "STOCK_RECEIVING",
  "PURCHASE_ORDER",
  "STOCK_COUNT",
  "TRANSFER",
  "WRITE_OFF",
  "ADJUSTMENT",
  "RECEIVE",
  "IMPORT",
  "BUNDLE_ASSEMBLY",
  "STORE_CLONE",
  "PRODUCT",
  "OTHER",
] as const;

const statusOptions = [
  "POSTED",
  "DRAFT",
  "CONFIRMED",
  "READY",
  "COMPLETED",
  "CANCELED",
  "CANCELLED",
  "SUBMITTED",
  "APPROVED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "IN_PROGRESS",
  "APPLIED",
] as const;

const paymentStatusOptions = ["PAID", "PARTIAL", "UNPAID", "REFUNDED", "NOT_APPLICABLE"] as const;
const sortOptions = ["date", "type", "status", "amount", "positions", "author", "store"] as const;

type SortKey = (typeof sortOptions)[number];
type SortDirection = "asc" | "desc";

const allValue = "all";

const parsePositiveInteger = (value: string | null, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return fallback;
  }
  return parsed;
};

const parseOption = <T extends string, F extends T | typeof allValue>(
  value: string | null,
  options: readonly T[],
  fallback: F,
): T | F => (value && options.includes(value as T) ? (value as T) : fallback);

const normalizeOptionalParam = (value: string) => {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const ProductMovementsPage = () => {
  const t = useTranslations("inventory.movementJournal");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const trpcUtils = trpc.useUtils();
  const { toast } = useToast();
  const currentQueryString = searchParams.toString();
  const page = parsePositiveInteger(searchParams.get("page"), 1, 1, 10_000);
  const pageSize = parsePositiveInteger(searchParams.get("pageSize"), 25, 10, 100);
  const search = searchParams.get("search") ?? "";
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  const storeId = searchParams.get("storeId") || allValue;
  const type = parseOption(searchParams.get("type"), documentTypeOptions, allValue);
  const status = parseOption(searchParams.get("status"), statusOptions, allValue);
  const paymentStatus = parseOption(
    searchParams.get("paymentStatus"),
    paymentStatusOptions,
    allValue,
  );
  const orderStatus = parseOption(
    searchParams.get("orderStatus"),
    Object.values(CustomerOrderStatus),
    allValue,
  );
  const senderSearch = searchParams.get("senderSearch") ?? "";
  const recipientSearch = searchParams.get("recipientSearch") ?? "";
  const authorSearch = searchParams.get("authorSearch") ?? "";
  const sortBy = parseOption(searchParams.get("sortBy"), sortOptions, "date");
  const sortDirection = parseOption(
    searchParams.get("sortDirection"),
    ["asc", "desc"] as const,
    "desc",
  );
  const hasSecondaryFilters =
    paymentStatus !== allValue ||
    orderStatus !== allValue ||
    Boolean(senderSearch.trim()) ||
    Boolean(recipientSearch.trim()) ||
    Boolean(authorSearch.trim());
  const [additionalFiltersOpen, setAdditionalFiltersOpen] = useState(hasSecondaryFilters);

  useEffect(() => {
    if (hasSecondaryFilters) {
      setAdditionalFiltersOpen(true);
    }
  }, [hasSecondaryFilters]);

  const updateJournalParams = useCallback(
    (updates: Record<string, string | number | null | undefined>) => {
      const params = new URLSearchParams(currentQueryString);
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === undefined || value === "") {
          params.delete(key);
          return;
        }
        params.set(key, String(value));
      });
      const nextQuery = params.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    },
    [currentQueryString, pathname, router],
  );

  const setPage = (value: number) => updateJournalParams({ page: value > 1 ? value : null });
  const setPageSize = (value: number) =>
    updateJournalParams({ pageSize: value === 25 ? null : value, page: null });
  const setFilterParam = (key: string, value: string | null) =>
    updateJournalParams({ [key]: value, page: null });
  const currentJournalHref = currentQueryString ? `${pathname}?${currentQueryString}` : pathname;
  const safeCurrentJournalHref = resolveSafeReturnTo(currentJournalHref);
  const withJournalReturn = (href: string) => {
    const params = new URLSearchParams({ from: "movements", returnTo: safeCurrentJournalHref });
    return `${href}${href.includes("?") ? "&" : "?"}${params.toString()}`;
  };

  const storesQuery = trpc.stores.list.useQuery();
  const stores = storesQuery.data ?? [];

  const movementQuery = trpc.inventory.productMovements.useQuery(
    {
      page,
      pageSize,
      search: search.trim() || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      storeId: storeId === allValue ? undefined : storeId,
      type: type === allValue ? undefined : type,
      status: status === allValue ? undefined : status,
      paymentStatus: paymentStatus === allValue ? undefined : paymentStatus,
      orderStatus: orderStatus === allValue ? undefined : orderStatus,
      senderSearch: senderSearch.trim() || undefined,
      recipientSearch: recipientSearch.trim() || undefined,
      authorSearch: authorSearch.trim() || undefined,
      sortBy,
      sortDirection,
    },
    { keepPreviousData: true },
  );

  const items = useMemo(() => movementQuery.data?.items ?? [], [movementQuery.data?.items]);
  const totalItems = movementQuery.data?.total ?? 0;

  type MovementRow = (typeof items)[number];
  const [archiveTarget, setArchiveTarget] = useState<MovementRow | null>(null);
  const [archiveReason, setArchiveReason] = useState("");
  const archiveReasonTrimmed = archiveReason.trim();

  const archiveMutation = trpc.inventory.archiveStockReceivingDocument.useMutation({
    onSuccess: async () => {
      toast({ variant: "success", description: t("archiveReceivingSuccess") });
      setArchiveTarget(null);
      setArchiveReason("");
      await trpcUtils.inventory.list.invalidate();
      await trpcUtils.inventory.productMovements.invalidate();
      await trpcUtils.inventory.productMovementDocument.invalidate();
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const resetFilters = () => {
    updateJournalParams({
      search: null,
      dateFrom: null,
      dateTo: null,
      storeId: null,
      type: null,
      status: null,
      paymentStatus: null,
      orderStatus: null,
      senderSearch: null,
      recipientSearch: null,
      authorSearch: null,
      sortBy: null,
      sortDirection: null,
      page: null,
      pageSize: null,
    });
    setAdditionalFiltersOpen(false);
  };

  const documentTypeLabel = (value: string) => t(`type.${value}`);
  const statusLabel = (value?: string | null) =>
    value ? t(`status.${value}`) : tCommon("notAvailable");
  const paymentStatusLabel = (value?: string | null) =>
    value ? t(`payment.${value}`) : tCommon("notAvailable");
  const sortLabel = (value: string) => t(`sort.${value}`);
  const formatDateInput = (value: string) => {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      return value;
    }
    const [, year, month, day] = match;
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
      new Date(Number(year), Number(month) - 1, Number(day)),
    );
  };
  const dateRangeSummary =
    dateFrom && dateTo
      ? t("dateRangeBetween", { from: formatDateInput(dateFrom), to: formatDateInput(dateTo) })
      : dateFrom
        ? t("dateRangeFromValue", { from: formatDateInput(dateFrom) })
        : dateTo
          ? t("dateRangeToValue", { to: formatDateInput(dateTo) })
          : t("dateRangeAny");
  const hasFilters =
    Boolean(search.trim()) ||
    Boolean(dateFrom) ||
    Boolean(dateTo) ||
    storeId !== allValue ||
    type !== allValue ||
    status !== allValue ||
    paymentStatus !== allValue ||
    orderStatus !== allValue ||
    Boolean(senderSearch.trim()) ||
    Boolean(recipientSearch.trim()) ||
    Boolean(authorSearch.trim()) ||
    sortBy !== "date" ||
    sortDirection !== "desc";
  const secondaryFilterCount = [
    paymentStatus !== allValue,
    orderStatus !== allValue,
    Boolean(senderSearch.trim()),
    Boolean(recipientSearch.trim()),
    Boolean(authorSearch.trim()),
  ].filter(Boolean).length;

  const defaultSortDirection = (key: SortKey): SortDirection =>
    ["date", "amount", "positions"].includes(key) ? "desc" : "asc";

  const setSortColumn = (key: SortKey) => {
    const nextDirection = sortBy === key ? sortDirection : defaultSortDirection(key);
    updateJournalParams({
      sortBy: key === "date" ? null : key,
      sortDirection: nextDirection === "desc" ? null : nextDirection,
      page: null,
    });
  };

  const statusVariant = (
    value?: string | null,
  ): "default" | "success" | "warning" | "danger" | "muted" => {
    switch (value) {
      case "POSTED":
      case "COMPLETED":
      case "RECEIVED":
      case "APPLIED":
        return "success";
      case "DRAFT":
      case "CONFIRMED":
      case "READY":
      case "SUBMITTED":
      case "APPROVED":
      case "PARTIALLY_RECEIVED":
      case "IN_PROGRESS":
        return "warning";
      case "CANCELED":
      case "CANCELLED":
        return "danger";
      default:
        return "muted";
    }
  };

  const paymentVariant = (
    value?: string | null,
  ): "default" | "success" | "warning" | "danger" | "muted" => {
    switch (value) {
      case "PAID":
      case "REFUNDED":
        return "success";
      case "PARTIAL":
        return "warning";
      case "UNPAID":
        return "danger";
      default:
        return "muted";
    }
  };

  const renderMutedDash = () => (
    <span className="text-muted-foreground">{tCommon("notAvailable")}</span>
  );
  const renderOptionalText = (value?: string | null) =>
    value ? <span className="truncate">{value}</span> : renderMutedDash();
  const renderMoney = (value?: number | null) =>
    typeof value === "number" ? <span>{formatCurrencyKGS(value, locale)}</span> : renderMutedDash();
  const renderPaymentStatus = (value?: string | null) =>
    !value || value === "NOT_APPLICABLE" ? (
      renderMutedDash()
    ) : (
      <Badge variant={paymentVariant(value)}>{paymentStatusLabel(value)}</Badge>
    );

  const editDisabledReasonLabel = (reason: NonNullable<ReturnType<typeof getProductMovementEditTarget>["disabledReason"]>) =>
    t(`editUnavailable.${reason}`);

  const renderActions = (movement: MovementRow, layout: "desktop" | "mobile" = "desktop") => {
    const viewButton = movement.detailUrl ? (
      <Button
        variant={layout === "desktop" ? "ghost" : "secondary"}
        size={layout === "desktop" ? "icon" : undefined}
        asChild
        aria-label={tCommon("view")}
        className={layout === "mobile" ? "w-full justify-center" : undefined}
      >
        <Link href={withJournalReturn(movement.detailUrl)}>
          <ViewIcon className="h-4 w-4" aria-hidden />
          {layout === "mobile" ? tCommon("view") : null}
        </Link>
      </Button>
    ) : null;
    const editTarget = getProductMovementEditTarget({
      id: movement.id,
      documentId: movement.documentId,
      documentType: movement.documentType,
      isPosSale: movement.isPosSale,
      returnTo: safeCurrentJournalHref,
    });
    const disabledReason = editTarget.disabledReason ?? "unsupported";
    const editButton = editTarget.href ? (
      <Button
        variant={layout === "desktop" ? "ghost" : "secondary"}
        size={layout === "desktop" ? "icon" : undefined}
        asChild
        aria-label={tCommon("edit")}
        data-testid="movement-edit-button"
        className={layout === "mobile" ? "w-full justify-center" : undefined}
      >
        <Link href={editTarget.href}>
          <EditIcon className="h-4 w-4" aria-hidden />
          {layout === "mobile" ? tCommon("edit") : null}
        </Link>
      </Button>
    ) : (
      <Button
        variant={layout === "desktop" ? "ghost" : "secondary"}
        size={layout === "desktop" ? "icon" : undefined}
        aria-label={editDisabledReasonLabel(disabledReason)}
        title={editDisabledReasonLabel(disabledReason)}
        data-testid="movement-edit-button-disabled"
        className={layout === "mobile" ? "w-full justify-center" : undefined}
        disabled
      >
        <EditIcon className="h-4 w-4" aria-hidden />
        {layout === "mobile" ? editDisabledReasonLabel(disabledReason) : null}
      </Button>
    );
    const archiveButton =
      movement.documentType === "STOCK_RECEIVING" ? (
        <Button
          type="button"
          variant={layout === "desktop" ? "ghost" : "secondary"}
          size={layout === "desktop" ? "icon" : undefined}
          aria-label={t("archiveReceiving")}
          title={t("archiveReceiving")}
          data-testid="movement-archive-receiving-button"
          className={layout === "mobile" ? "w-full justify-center" : undefined}
          onClick={() => {
            setArchiveTarget(movement);
            setArchiveReason("");
          }}
          disabled={archiveMutation.isLoading}
        >
          <ArchiveIcon className="h-4 w-4" aria-hidden />
          {layout === "mobile" ? t("archiveReceiving") : null}
        </Button>
      ) : null;

    return (
      <div
        className={
          layout === "mobile"
            ? "mt-3 grid grid-cols-2 gap-2"
            : "flex items-center justify-end gap-1"
        }
      >
        {viewButton ?? <span className="text-muted-foreground">{tCommon("notAvailable")}</span>}
        {editButton}
        {archiveButton}
      </div>
    );
  };

  const renderDocument = (movement: MovementRow) => {
    const documentNumber = movement.documentNumber || movement.documentId;
    return (
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge
            variant="muted"
            className="border-transparent bg-muted/60 px-1.5 py-0 text-[11px] font-medium"
          >
            {documentTypeLabel(movement.documentType)}
          </Badge>
          {movement.detailUrl ? (
            <Link
              className="truncate font-medium text-foreground underline-offset-2 hover:text-primary hover:underline"
              href={withJournalReturn(movement.detailUrl)}
            >
              #{documentNumber}
            </Link>
          ) : (
            <span className="truncate font-medium text-foreground">#{documentNumber}</span>
          )}
        </div>
        {movement.description || movement.comment ? (
          <p className="mt-1 max-w-[28rem] truncate text-xs text-muted-foreground">
            {movement.comment || movement.description}
          </p>
        ) : null}
      </div>
    );
  };

  const movementSorting = useMemo<SortingState>(
    () => [{ id: sortBy, desc: sortDirection === "desc" }],
    [sortBy, sortDirection],
  );

  const handleMovementSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === "function" ? updater(movementSorting) : updater;
    const nextSort = next[0];
    if (!nextSort || !sortOptions.includes(nextSort.id as SortKey)) {
      return;
    }
    const nextSortBy = nextSort.id as SortKey;
    const nextDirection = nextSort.desc ? "desc" : "asc";
    updateJournalParams({
      sortBy: nextSortBy === "date" ? null : nextSortBy,
      sortDirection: nextDirection === "desc" ? null : nextDirection,
      page: null,
    });
  };

  const movementColumns: ColumnDef<MovementRow>[] = [
    {
      id: "type",
      header: t("document"),
      enableSorting: true,
      accessorFn: (movement) => movement.documentType,
      cell: ({ row }) => renderDocument(row.original),
      meta: { className: "min-w-[13rem]" },
    },
    {
      id: "date",
      header: t("date"),
      enableSorting: true,
      accessorFn: (movement) => movement.createdAt,
      cell: ({ row }) => formatDateTime(row.original.createdAt, locale),
      meta: { className: "min-w-[7.25rem]" },
    },
    {
      id: "status",
      header: t("statusLabel"),
      enableSorting: true,
      accessorFn: (movement) => movement.status,
      cell: ({ row }) => (
        <Badge variant={statusVariant(row.original.status)}>
          {statusLabel(row.original.status)}
        </Badge>
      ),
      meta: { className: "min-w-[6.25rem]" },
    },
    {
      id: "paymentStatus",
      header: t("paymentStatus"),
      enableSorting: false,
      cell: ({ row }) => renderPaymentStatus(row.original.paymentStatus),
      meta: { className: "min-w-[6.25rem]" },
    },
    {
      id: "sender",
      header: t("sender"),
      enableSorting: false,
      cell: ({ row }) => renderOptionalText(row.original.senderName),
      meta: { className: "hidden max-w-[12rem] min-w-[9rem] truncate" },
    },
    {
      id: "recipient",
      header: t("recipient"),
      enableSorting: false,
      cell: ({ row }) => renderOptionalText(row.original.recipientName),
      meta: { className: "hidden max-w-[12rem] min-w-[9rem] truncate" },
    },
    {
      id: "store",
      header: t("store"),
      enableSorting: true,
      accessorFn: (movement) => movement.storeName ?? "",
      cell: ({ row }) => renderOptionalText(row.original.storeName),
      meta: { className: "max-w-[9rem] min-w-[6.5rem] truncate" },
    },
    {
      id: "author",
      header: t("author"),
      enableSorting: true,
      accessorFn: (movement) => movement.authorName || movement.authorEmail || "",
      cell: ({ row }) => renderOptionalText(row.original.authorName || row.original.authorEmail),
      meta: { className: "hidden max-w-[12rem] min-w-[9rem] truncate" },
    },
    {
      id: "positions",
      header: t("positions"),
      enableSorting: true,
      accessorFn: (movement) => movement.positionsCount,
      cell: ({ row }) => formatNumber(row.original.positionsCount, locale),
      meta: { className: "min-w-[4.75rem] text-right" },
    },
    {
      id: "quantity",
      header: t("quantity"),
      enableSorting: false,
      cell: ({ row }) => formatNumber(row.original.totalQuantity, locale),
      meta: { className: "hidden min-w-[7rem] text-right" },
    },
    {
      id: "amount",
      header: t("amount"),
      enableSorting: true,
      accessorFn: (movement) => movement.totalAmount ?? 0,
      cell: ({ row }) => renderMoney(row.original.totalAmount),
      meta: { className: "min-w-[6.25rem] text-right" },
    },
    {
      id: "paidAmount",
      header: t("paidAmount"),
      enableSorting: false,
      cell: ({ row }) => renderMoney(row.original.paidAmount),
      meta: { className: "hidden min-w-[8rem] text-right" },
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{tCommon("actions")}</span>,
      enableSorting: false,
      cell: ({ row }) => renderActions(row.original),
      meta: { className: "min-w-[8rem] text-right" },
    },
  ];

  const sortMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="secondary" className="shrink-0">
          <SortIcon className="h-4 w-4" aria-hidden />
          {t("sortCompact", { field: sortLabel(sortBy) })}
          {sortDirection === "asc" ? (
            <ArrowUpIcon className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <ArrowDownIcon className="h-3.5 w-3.5" aria-hidden />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        <DropdownMenuLabel>{t("sortBy")}</DropdownMenuLabel>
        {sortOptions.map((option) => (
          <DropdownMenuItem key={option} onSelect={() => setSortColumn(option)}>
            <span className="flex-1">{sortLabel(option)}</span>
            {sortBy === option ? <CheckIcon className="h-4 w-4" aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            const nextDirection = sortDirection === "asc" ? "desc" : "asc";
            updateJournalParams({
              sortDirection: nextDirection === "desc" ? null : nextDirection,
              page: null,
            });
          }}
        >
          {sortDirection === "asc" ? (
            <ArrowUpIcon className="h-4 w-4" aria-hidden />
          ) : (
            <ArrowDownIcon className="h-4 w-4" aria-hidden />
          )}
          {sortDirection === "asc" ? t("sortAscending") : t("sortDescending")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const filterControls = (
    <div className="flex w-full flex-col gap-3">
      <div className="grid w-full gap-3 md:grid-cols-2 xl:grid-cols-[minmax(16rem,2fr)_minmax(15rem,1.5fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(10rem,1fr)]">
        <div className="space-y-1">
          <Label htmlFor="movement-search">{tCommon("search")}</Label>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="movement-search"
              value={search}
              onChange={(event) =>
                setFilterParam("search", normalizeOptionalParam(event.target.value))
              }
              className="pl-9"
              placeholder={t("searchPlaceholder")}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label>{t("dateRange")}</Label>
          <div className="rounded-xl border border-input bg-card px-2 py-1 shadow-sm">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
              <Input
                type="date"
                value={dateFrom}
                onChange={(event) => setFilterParam("dateFrom", event.target.value || null)}
                aria-label={t("dateRangeStart")}
                className="h-8 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
              />
              <span className="px-1 text-muted-foreground" aria-hidden>
                -
              </span>
              <Input
                type="date"
                value={dateTo}
                onChange={(event) => setFilterParam("dateTo", event.target.value || null)}
                aria-label={t("dateRangeEnd")}
                className="h-8 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
              />
            </div>
            <p className="px-1 pb-0.5 text-xs text-muted-foreground">{dateRangeSummary}</p>
          </div>
        </div>
        <div className="space-y-1">
          <Label>{t("store")}</Label>
          <Select
            value={storeId}
            onValueChange={(value) => setFilterParam("storeId", value === allValue ? null : value)}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("allStores")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={allValue}>{t("allStores")}</SelectItem>
              {stores.map((store) => (
                <SelectItem key={store.id} value={store.id}>
                  {store.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{t("documentType")}</Label>
          <Select
            value={type}
            onValueChange={(value) => setFilterParam("type", value === allValue ? null : value)}
          >
            <SelectTrigger data-testid="movement-type-filter">
              <SelectValue placeholder={t("allTypes")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={allValue}>{t("allTypes")}</SelectItem>
              {documentTypeOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {documentTypeLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{t("statusLabel")}</Label>
          <Select
            value={status}
            onValueChange={(value) => setFilterParam("status", value === allValue ? null : value)}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("allStatuses")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={allValue}>{t("allStatuses")}</SelectItem>
              {statusOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {statusLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/55 bg-card/70 p-2 shadow-inner shadow-foreground/[0.015]">
        <Button
          type="button"
          variant="secondary"
          className="px-3"
          aria-expanded={additionalFiltersOpen}
          onClick={() => setAdditionalFiltersOpen((current) => !current)}
        >
          <ChevronDownIcon
            className={`h-4 w-4 transition-transform ${additionalFiltersOpen ? "rotate-180" : ""}`}
            aria-hidden
          />
          {t("additionalFilters")}
          {secondaryFilterCount ? (
            <Badge variant="muted" className="ml-1 px-1.5 py-0">
              {secondaryFilterCount}
            </Badge>
          ) : null}
        </Button>
        {sortMenu}
        <Button type="button" variant="secondary" asChild>
          <Link href="/reports/exports">
            <DownloadIcon className="h-4 w-4" aria-hidden />
            {t("export")}
          </Link>
        </Button>
        <Button type="button" variant="secondary" onClick={resetFilters} disabled={!hasFilters}>
          {t("resetFilters")}
        </Button>
      </div>
      {additionalFiltersOpen ? (
        <div className="rounded-xl border border-border/60 bg-card/80 p-3 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-1">
              <Label>{t("paymentStatus")}</Label>
              <Select
                value={paymentStatus}
                onValueChange={(value) => {
                  setFilterParam("paymentStatus", value === allValue ? null : value);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("allPayments")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={allValue}>{t("allPayments")}</SelectItem>
                  {paymentStatusOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {paymentStatusLabel(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("orderStatus")}</Label>
              <Select
                value={orderStatus}
                onValueChange={(value) => {
                  setFilterParam("orderStatus", value === allValue ? null : value);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("allOrderStatuses")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={allValue}>{t("allOrderStatuses")}</SelectItem>
                  {Object.values(CustomerOrderStatus).map((option) => (
                    <SelectItem key={option} value={option}>
                      {statusLabel(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="movement-sender">{t("sender")}</Label>
              <Input
                id="movement-sender"
                value={senderSearch}
                onChange={(event) => {
                  setFilterParam("senderSearch", normalizeOptionalParam(event.target.value));
                }}
                placeholder={t("senderPlaceholder")}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="movement-recipient">{t("recipient")}</Label>
              <Input
                id="movement-recipient"
                value={recipientSearch}
                onChange={(event) => {
                  setFilterParam("recipientSearch", normalizeOptionalParam(event.target.value));
                }}
                placeholder={t("recipientPlaceholder")}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="movement-author">{t("author")}</Label>
              <Input
                id="movement-author"
                value={authorSearch}
                onChange={(event) => {
                  setFilterParam("authorSearch", normalizeOptionalParam(event.target.value));
                }}
                placeholder={t("authorPlaceholder")}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <div>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button">
                <CirclePlusIcon className="h-4 w-4" aria-hidden />
                {t("createDocument")}
                <ChevronDownIcon className="h-4 w-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[240px]">
              <DropdownMenuLabel>{t("createDocument")}</DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <Link href="/inventory/write-offs">
                  <ArchiveIcon className="h-4 w-4" aria-hidden />
                  {t("createWriteOff")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/inventory/receiving">
                  <ReceiveIcon className="h-4 w-4" aria-hidden />
                  {t("createReceiving")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/inventory/transfers">
                  <TransferIcon className="h-4 w-4" aria-hidden />
                  {t("createTransfer")}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
        filters={filterControls}
      />

      {movementQuery.error ? (
        <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {translateError(tErrors, movementQuery.error)}
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>{t("tableTitle")}</CardTitle>
          <span className="text-sm text-muted-foreground">
            {t("totalLabel", { count: totalItems })}
          </span>
        </CardHeader>
        <CardContent className="min-w-0 overflow-hidden">
          <ResponsiveDataList
            items={items}
            getKey={(movement) => movement.id}
            page={page}
            totalItems={totalItems}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            paginationKey="product-movements"
            scrollToTopOnPageChange
            empty={
              <div className="flex min-h-[12rem] flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                <EmptyIcon className="mb-3 h-8 w-8" aria-hidden />
                {movementQuery.isLoading ? tCommon("loading") : t("empty")}
              </div>
            }
            desktopClassName="min-w-0"
            renderDesktop={(visibleItems) => (
              <DataTable
                columns={movementColumns}
                data={visibleItems}
                getRowId={(movement) => movement.id}
                isLoading={movementQuery.isLoading}
                manualSorting
                sorting={movementSorting}
                onSortingChange={handleMovementSortingChange}
                tableClassName="min-w-[1000px] [&_td]:px-2 [&_th]:px-2"
                empty={
                  <EmptyState
                    icon={<EmptyIcon className="h-8 w-8" aria-hidden />}
                    description={movementQuery.isLoading ? tCommon("loading") : t("empty")}
                    className="min-h-[12rem] rounded-none border-0"
                  />
                }
              />
            )}
            renderMobile={(movement) => (
              <div className="rounded-xl border border-border/65 bg-card p-3 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  {renderDocument(movement)}
                  <Badge variant={statusVariant(movement.status)}>
                    {statusLabel(movement.status)}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p>{t("date")}</p>
                    <p className="font-medium text-foreground">
                      {formatDateTime(movement.createdAt, locale)}
                    </p>
                  </div>
                  <div>
                    <p>{t("paymentStatus")}</p>
                    {renderPaymentStatus(movement.paymentStatus)}
                  </div>
                  <div>
                    <p>{t("sender")}</p>
                    <p className="font-medium text-foreground">
                      {renderOptionalText(movement.senderName)}
                    </p>
                  </div>
                  <div>
                    <p>{t("recipient")}</p>
                    <p className="font-medium text-foreground">
                      {renderOptionalText(movement.recipientName)}
                    </p>
                  </div>
                  <div>
                    <p>{t("store")}</p>
                    <p className="font-medium text-foreground">
                      {renderOptionalText(movement.storeName)}
                    </p>
                  </div>
                  <div>
                    <p>{t("author")}</p>
                    <p className="font-medium text-foreground">
                      {renderOptionalText(movement.authorName || movement.authorEmail)}
                    </p>
                  </div>
                  <div>
                    <p>{t("positions")}</p>
                    <p className="font-medium text-foreground">
                      {formatNumber(movement.positionsCount, locale)}
                    </p>
                  </div>
                  <div>
                    <p>{t("quantity")}</p>
                    <p className="font-medium text-foreground">
                      {formatNumber(movement.totalQuantity, locale)}
                    </p>
                  </div>
                  <div>
                    <p>{t("amount")}</p>
                    <p className="font-medium text-foreground">
                      {renderMoney(movement.totalAmount)}
                    </p>
                  </div>
                  <div>
                    <p>{t("paidAmount")}</p>
                    <p className="font-medium text-foreground">
                      {renderMoney(movement.paidAmount)}
                    </p>
                  </div>
                </div>
                {renderActions(movement, "mobile")}
              </div>
            )}
          />
          {movementQuery.isLoading && items.length ? (
            <p className="mt-4 text-sm text-muted-foreground">{tCommon("loading")}</p>
          ) : null}
        </CardContent>
      </Card>
      <Modal
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => {
          if (!open && !archiveMutation.isLoading) {
            setArchiveTarget(null);
            setArchiveReason("");
          }
        }}
        title={t("archiveReceivingTitle")}
        subtitle={t("archiveReceivingDescription", {
          number: archiveTarget?.documentNumber || archiveTarget?.documentId || "",
        })}
        className="max-w-xl"
      >
        <div className="space-y-2">
          <Label htmlFor="archive-receiving-reason">{t("archiveReceivingReason")}</Label>
          <Textarea
            id="archive-receiving-reason"
            value={archiveReason}
            onChange={(event) => setArchiveReason(event.target.value)}
            placeholder={t("archiveReceivingReasonPlaceholder")}
            rows={4}
            disabled={archiveMutation.isLoading}
          />
          {!archiveReasonTrimmed ? (
            <p className="text-xs text-danger">{t("archiveReceivingReasonRequired")}</p>
          ) : null}
        </div>
        <ModalFooter className="mt-6">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setArchiveTarget(null);
              setArchiveReason("");
            }}
            disabled={archiveMutation.isLoading}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={!archiveTarget || !archiveReasonTrimmed || archiveMutation.isLoading}
            onClick={() => {
              if (!archiveTarget || !archiveReasonTrimmed) {
                return;
              }
              archiveMutation.mutate({
                documentKey: archiveTarget.id,
                reason: archiveReasonTrimmed,
                idempotencyKey: crypto.randomUUID(),
              });
            }}
          >
            {archiveMutation.isLoading ? tCommon("loading") : t("archiveReceivingSubmit")}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
};

export default ProductMovementsPage;

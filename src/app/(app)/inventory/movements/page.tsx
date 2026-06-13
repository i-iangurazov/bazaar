"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { CustomerOrderStatus } from "@prisma/client";

import { PageHeader } from "@/components/page-header";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

type DocumentType = (typeof documentTypeOptions)[number];
type PaymentStatus = (typeof paymentStatusOptions)[number];
type SortKey = (typeof sortOptions)[number];
type SortDirection = "asc" | "desc";

const allValue = "all";

const ProductMovementsPage = () => {
  const t = useTranslations("inventory.movementJournal");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [storeId, setStoreId] = useState(allValue);
  const [type, setType] = useState<DocumentType | typeof allValue>(allValue);
  const [status, setStatus] = useState<string>(allValue);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | typeof allValue>(allValue);
  const [orderStatus, setOrderStatus] = useState<CustomerOrderStatus | typeof allValue>(allValue);
  const [senderSearch, setSenderSearch] = useState("");
  const [recipientSearch, setRecipientSearch] = useState("");
  const [authorSearch, setAuthorSearch] = useState("");
  const [additionalFiltersOpen, setAdditionalFiltersOpen] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

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

  const resetPage = () => setPage(1);
  const resetFilters = () => {
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setStoreId(allValue);
    setType(allValue);
    setStatus(allValue);
    setPaymentStatus(allValue);
    setOrderStatus(allValue);
    setSenderSearch("");
    setRecipientSearch("");
    setAuthorSearch("");
    setAdditionalFiltersOpen(false);
    setSortBy("date");
    setSortDirection("desc");
    setPage(1);
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
    setSortBy(key);
    setSortDirection((current) => (sortBy === key ? current : defaultSortDirection(key)));
    resetPage();
  };

  const toggleTableSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDirection(defaultSortDirection(key));
    }
    resetPage();
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
  const editDisabledReason = (movement: MovementRow) => {
    if (movement.documentType === "SALE") {
      return t("editUnsupportedSale");
    }
    if (
      movement.documentType === "RETURN" ||
      movement.documentType === "STOCK_RECEIVING" ||
      movement.documentType === "TRANSFER" ||
      movement.documentType === "WRITE_OFF"
    ) {
      return t("editUnsupportedDocument");
    }
    return t("editUnsupportedType");
  };
  const renderActions = (movement: MovementRow, layout: "desktop" | "mobile" = "desktop") => {
    const viewButton = movement.detailUrl ? (
      <Button
        variant={layout === "desktop" ? "ghost" : "secondary"}
        size={layout === "desktop" ? "icon" : undefined}
        asChild
        aria-label={tCommon("view")}
        className={layout === "mobile" ? "w-full justify-center" : undefined}
      >
        <Link href={movement.detailUrl}>
          <ViewIcon className="h-4 w-4" aria-hidden />
          {layout === "mobile" ? tCommon("view") : null}
        </Link>
      </Button>
    ) : null;
    const editButton = (
      <Button
        variant={layout === "desktop" ? "ghost" : "secondary"}
        size={layout === "desktop" ? "icon" : undefined}
        disabled
        aria-label={tCommon("edit")}
        title={editDisabledReason(movement)}
        className={layout === "mobile" ? "w-full justify-center" : undefined}
      >
        <EditIcon className="h-4 w-4" aria-hidden />
        {layout === "mobile" ? tCommon("edit") : null}
      </Button>
    );

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
              href={movement.detailUrl}
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
            setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
            resetPage();
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

  const renderSortableHead = (key: SortKey, label: string, className?: string) => {
    const active = sortBy === key;
    return (
      <TableHead
        sortable={false}
        className={className}
        aria-sort={active ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
      >
        <button
          type="button"
          className={`inline-flex max-w-full items-center gap-1.5 text-left uppercase text-inherit ${
            className?.includes("text-right") ? "ml-auto" : ""
          }`}
          onClick={() => toggleTableSort(key)}
        >
          <span className="truncate">{label}</span>
          {active ? (
            sortDirection === "asc" ? (
              <ArrowUpIcon className="h-3.5 w-3.5 shrink-0 text-foreground" aria-hidden />
            ) : (
              <ArrowDownIcon className="h-3.5 w-3.5 shrink-0 text-foreground" aria-hidden />
            )
          ) : (
            <SortIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
          )}
        </button>
      </TableHead>
    );
  };

  const filterControls = (
    <div className="flex w-full flex-col gap-3">
      <div className="grid w-full gap-3 md:grid-cols-2 xl:grid-cols-[minmax(14rem,2fr)_minmax(15rem,1.5fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(9rem,1fr)]">
        <div className="space-y-1">
          <Label htmlFor="movement-search">{tCommon("search")}</Label>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="movement-search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                resetPage();
              }}
              className="pl-9"
              placeholder={t("searchPlaceholder")}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label>{t("dateRange")}</Label>
          <div className="rounded-md border border-input bg-background px-2 py-1">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
              <Input
                type="date"
                value={dateFrom}
                onChange={(event) => {
                  setDateFrom(event.target.value);
                  resetPage();
                }}
                aria-label={t("dateRangeStart")}
                className="h-8 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
              />
              <span className="px-1 text-muted-foreground" aria-hidden>
                -
              </span>
              <Input
                type="date"
                value={dateTo}
                onChange={(event) => {
                  setDateTo(event.target.value);
                  resetPage();
                }}
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
            onValueChange={(value) => {
              setStoreId(value);
              resetPage();
            }}
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
            onValueChange={(value) => {
              setType(value as DocumentType | typeof allValue);
              resetPage();
            }}
          >
            <SelectTrigger>
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
            onValueChange={(value) => {
              setStatus(value);
              resetPage();
            }}
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
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          className="px-2 text-muted-foreground"
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
        <div className="rounded-md border border-border/70 bg-muted/20 p-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-1">
              <Label>{t("paymentStatus")}</Label>
              <Select
                value={paymentStatus}
                onValueChange={(value) => {
                  setPaymentStatus(value as PaymentStatus | typeof allValue);
                  resetPage();
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
                  setOrderStatus(value as CustomerOrderStatus | typeof allValue);
                  resetPage();
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
                  setSenderSearch(event.target.value);
                  resetPage();
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
                  setRecipientSearch(event.target.value);
                  resetPage();
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
                  setAuthorSearch(event.target.value);
                  resetPage();
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
        <div className="mb-4 border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {translateError(tErrors, movementQuery.error)}
        </div>
      ) : null}

      <Card>
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
              <div className="flex min-h-[12rem] flex-col items-center justify-center border border-dashed border-border bg-background p-6 text-center text-sm text-muted-foreground">
                <EmptyIcon className="mb-3 h-8 w-8" aria-hidden />
                {movementQuery.isLoading ? tCommon("loading") : t("empty")}
              </div>
            }
            desktopClassName="min-w-0"
            renderDesktop={(visibleItems) => (
              <div className="w-full max-w-full overflow-x-auto">
                <Table
                  sortable={false}
                  className="min-w-[1160px]"
                  data-tour="product-movements-table"
                >
                  <TableHeader>
                    <TableRow>
                      {renderSortableHead("type", t("document"))}
                      {renderSortableHead("date", t("date"))}
                      {renderSortableHead("status", t("statusLabel"))}
                      <TableHead>{t("paymentStatus")}</TableHead>
                      <TableHead>{t("sender")}</TableHead>
                      <TableHead>{t("recipient")}</TableHead>
                      {renderSortableHead("store", t("store"))}
                      {renderSortableHead("author", t("author"))}
                      {renderSortableHead("positions", t("positions"), "text-right")}
                      <TableHead className="text-right">{t("quantity")}</TableHead>
                      {renderSortableHead("amount", t("amount"), "text-right")}
                      <TableHead className="text-right">{t("paidAmount")}</TableHead>
                      <TableHead className="text-right">{tCommon("actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleItems.map((movement) => (
                      <TableRow key={movement.id}>
                        <TableCell>{renderDocument(movement)}</TableCell>
                        <TableCell>{formatDateTime(movement.createdAt, locale)}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(movement.status)}>
                            {statusLabel(movement.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>{renderPaymentStatus(movement.paymentStatus)}</TableCell>
                        <TableCell className="max-w-[12rem] truncate">
                          {renderOptionalText(movement.senderName)}
                        </TableCell>
                        <TableCell className="max-w-[12rem] truncate">
                          {renderOptionalText(movement.recipientName)}
                        </TableCell>
                        <TableCell className="max-w-[12rem] truncate">
                          {renderOptionalText(movement.storeName)}
                        </TableCell>
                        <TableCell className="max-w-[12rem] truncate">
                          {renderOptionalText(movement.authorName || movement.authorEmail)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatNumber(movement.positionsCount, locale)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatNumber(movement.totalQuantity, locale)}
                        </TableCell>
                        <TableCell className="text-right">
                          {renderMoney(movement.totalAmount)}
                        </TableCell>
                        <TableCell className="text-right">
                          {renderMoney(movement.paidAmount)}
                        </TableCell>
                        <TableCell className="text-right">{renderActions(movement)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            renderMobile={(movement) => (
              <div className="rounded-md border border-border bg-card p-3">
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
    </div>
  );
};

export default ProductMovementsPage;

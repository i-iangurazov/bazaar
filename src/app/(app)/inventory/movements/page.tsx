"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { CustomerOrderStatus } from "@prisma/client";

import { PageHeader } from "@/components/page-header";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal, ModalFooter } from "@/components/ui/modal";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import {
  AddIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ArchiveIcon,
  CheckIcon,
  ChevronDownIcon,
  CirclePlusIcon,
  DeleteIcon,
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

type EditableMovementType = "SALE" | "RETURN" | "STOCK_RECEIVING" | "TRANSFER" | "WRITE_OFF";

type EditLineState = {
  key: string;
  lineId: string | null;
  customerOrderLineId: string | null;
  productId: string;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  quantityInput: string;
  unitPriceInput: string;
  unitCostInput: string;
};

type EditProductChoice = {
  product: { id: string; name: string; sku?: string | null };
  snapshot: { variantId?: string | null };
  variant?: { name?: string | null } | null;
  primaryBarcode?: string | null;
  priceKgs?: number | null;
  unitCostKgs?: number | null;
  customerOrderLineId?: string | null;
};

const allValue = "all";
const editableMovementTypes = new Set<EditableMovementType>([
  "SALE",
  "RETURN",
  "STOCK_RECEIVING",
  "TRANSFER",
  "WRITE_OFF",
]);

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
  const [editingMovement, setEditingMovement] = useState<MovementRow | null>(null);
  const [editLines, setEditLines] = useState<EditLineState[]>([]);
  const [editSearch, setEditSearch] = useState("");
  const [replaceLineKey, setReplaceLineKey] = useState<string | null>(null);
  const [editReason, setEditReason] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editCustomerName, setEditCustomerName] = useState("");
  const [editCustomerPhone, setEditCustomerPhone] = useState("");
  const [editDestinationStoreId, setEditDestinationStoreId] = useState("");
  const { toast } = useToast();
  const trpcUtils = trpc.useUtils();

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

  const editableDocumentQuery = trpc.inventory.editableProductMovementDocument.useQuery(
    { documentKey: editingMovement?.id ?? "" },
    {
      enabled: Boolean(editingMovement),
      staleTime: 0,
    },
  );
  const editableDocument = editableDocumentQuery.data ?? null;
  const editStoreId = editableDocument?.storeId ?? "";
  const editProductSearchQuery = trpc.inventory.searchProducts.useQuery(
    {
      storeId: editStoreId,
      search: editSearch.trim() || undefined,
      limit: 30,
    },
    {
      enabled: Boolean(
        editingMovement &&
          editingMovement.documentType !== "RETURN" &&
          editStoreId &&
          editSearch.trim(),
      ),
      keepPreviousData: true,
    },
  );
  const editProductResults = useMemo(
    () => editProductSearchQuery.data ?? [],
    [editProductSearchQuery.data],
  );
  const editProductChoices = useMemo<EditProductChoice[]>(() => {
    if (editingMovement?.documentType === "RETURN") {
      const query = editSearch.trim().toLocaleLowerCase(locale);
      const returnableLines = editableDocument?.returnableLines ?? [];
      if (!query) {
        return [];
      }
      return returnableLines
        .filter((line) => {
          const label = `${line.productName} ${line.variantName ?? ""}`.toLocaleLowerCase(locale);
          return label.includes(query);
        })
        .map((line) => ({
          product: { id: line.productId, name: line.productName },
          snapshot: { variantId: line.variantId },
          variant: line.variantName ? { name: line.variantName } : null,
          priceKgs: line.unitPriceKgs,
          unitCostKgs: line.unitCostKgs,
          customerOrderLineId: line.customerOrderLineId,
        }));
    }
    return editProductResults.map((result) => ({
      product: result.product,
      snapshot: result.snapshot,
      variant: result.variant,
      primaryBarcode: result.primaryBarcode,
      priceKgs: result.priceKgs,
      unitCostKgs: result.unitCostKgs,
      customerOrderLineId: null,
    }));
  }, [editableDocument?.returnableLines, editProductResults, editSearch, editingMovement?.documentType, locale]);
  const editMutation = trpc.inventory.editProductMovementDocument.useMutation({
    onSuccess: async () => {
      toast({ variant: "success", description: t("editSaved") });
      setEditingMovement(null);
      await Promise.all([
        trpcUtils.inventory.productMovements.invalidate(),
        trpcUtils.inventory.productMovementDocument.invalidate(),
        trpcUtils.inventory.editableProductMovementDocument.invalidate(),
      ]);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

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

  const isEditableMovement = (movement: MovementRow): movement is MovementRow & {
    documentType: EditableMovementType;
  } => editableMovementTypes.has(movement.documentType as EditableMovementType);

  useEffect(() => {
    if (!editableDocument || !editingMovement) {
      return;
    }
    setEditNotes(editableDocument.notes ?? "");
    setEditReason("");
    setReplaceLineKey(null);
    setEditCustomerName(editableDocument.customerName ?? "");
    setEditCustomerPhone(editableDocument.customerPhone ?? "");
    setEditDestinationStoreId(editableDocument.destinationStoreId ?? "");
    setEditLines(
      editableDocument.lines.map((line, index) => ({
        key: line.lineId ?? `${line.productId}:${line.variantId ?? "BASE"}:${index}`,
        lineId: line.lineId,
        customerOrderLineId: line.customerOrderLineId,
        productId: line.productId,
        variantId: line.variantId,
        productName: line.productName,
        variantName: line.variantName,
        quantityInput: String(line.quantity),
        unitPriceInput: line.unitPriceKgs === null ? "" : String(line.unitPriceKgs),
        unitCostInput: line.unitCostKgs === null ? "" : String(line.unitCostKgs),
      })),
    );
  }, [editableDocument, editingMovement]);

  const parseNumberInput = (value: string) => {
    const normalized = value.trim().replace(",", ".");
    if (!normalized) {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const openEditModal = (movement: MovementRow) => {
    if (!isEditableMovement(movement)) {
      return;
    }
    setEditingMovement(movement);
    setEditSearch("");
  };

  const updateEditLine = (key: string, patch: Partial<EditLineState>) => {
    setEditLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  };

  const removeEditLine = (key: string) => {
    setEditLines((current) => current.filter((line) => line.key !== key));
  };

  const applyProductToEditLine = (lineKey: string, result: EditProductChoice) => {
    if (
      editLines.some(
        (line) =>
          line.key !== lineKey &&
          line.productId === result.product.id &&
          (line.variantId ?? null) === (result.snapshot.variantId ?? null),
      )
    ) {
      toast({ variant: "error", description: t("editDuplicateLine") });
      return;
    }
    updateEditLine(lineKey, {
      productId: result.product.id,
      variantId: result.snapshot.variantId ?? null,
      productName: result.product.name,
      variantName: result.variant?.name ?? null,
      customerOrderLineId: result.customerOrderLineId ?? null,
      unitPriceInput:
        editingMovement?.documentType === "SALE" || editingMovement?.documentType === "RETURN"
          ? String(result.priceKgs ?? 0)
          : editLines.find((line) => line.key === lineKey)?.unitPriceInput ?? "",
      unitCostInput:
        editingMovement?.documentType === "STOCK_RECEIVING" ||
        editingMovement?.documentType === "TRANSFER" ||
        editingMovement?.documentType === "WRITE_OFF"
          ? String(result.unitCostKgs ?? 0)
          : editLines.find((line) => line.key === lineKey)?.unitCostInput ?? "",
    });
    setEditSearch("");
    setReplaceLineKey(null);
  };

  const addProductToEdit = (result: EditProductChoice) => {
    if (replaceLineKey) {
      applyProductToEditLine(replaceLineKey, result);
      setReplaceLineKey(null);
      return;
    }
    if (
      editLines.some(
        (line) =>
          line.productId === result.product.id &&
          (line.variantId ?? null) === (result.snapshot.variantId ?? null),
      )
    ) {
      toast({ variant: "error", description: t("editDuplicateLine") });
      return;
    }
    setEditLines((current) => [
      ...current,
      {
        key:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${result.product.id}:${Date.now()}`,
        lineId: null,
        customerOrderLineId: result.customerOrderLineId ?? null,
        productId: result.product.id,
        variantId: result.snapshot.variantId ?? null,
        productName: result.product.name,
        variantName: result.variant?.name ?? null,
        quantityInput: "1",
        unitPriceInput:
          editingMovement?.documentType === "SALE" || editingMovement?.documentType === "RETURN"
            ? String(result.priceKgs ?? 0)
            : "",
        unitCostInput:
          editingMovement?.documentType === "STOCK_RECEIVING" ||
          editingMovement?.documentType === "TRANSFER" ||
          editingMovement?.documentType === "WRITE_OFF"
            ? String(result.unitCostKgs ?? 0)
            : "",
      },
    ]);
    setEditSearch("");
  };

  const submitEdit = async () => {
    if (!editingMovement) {
      return;
    }
    if (!editLines.length) {
      toast({ variant: "error", description: t("editLinesRequired") });
      return;
    }

    const lines = editLines.map((line) => {
      const quantity = parseNumberInput(line.quantityInput);
      const unitPriceKgs = parseNumberInput(line.unitPriceInput);
      const unitCostKgs = parseNumberInput(line.unitCostInput);
      return {
        line,
        quantity,
        unitPriceKgs,
        unitCostKgs,
      };
    });
    const invalidLine = lines.find(
      ({ quantity, unitPriceKgs, unitCostKgs }) =>
        quantity === null ||
        !Number.isInteger(quantity) ||
        quantity <= 0 ||
        ((editingMovement.documentType === "SALE" || editingMovement.documentType === "RETURN") &&
          (unitPriceKgs === null || unitPriceKgs < 0)) ||
        ((editingMovement.documentType === "STOCK_RECEIVING" ||
          editingMovement.documentType === "TRANSFER" ||
          editingMovement.documentType === "WRITE_OFF") &&
          (unitCostKgs === null || unitCostKgs < 0)),
    );
    if (invalidLine) {
      toast({ variant: "error", description: t("editInvalidLine") });
      return;
    }

    await editMutation.mutateAsync({
      documentKey: editingMovement.id,
      customerName: editCustomerName,
      customerPhone: editCustomerPhone,
      notes: editNotes,
      reason: editReason,
      destinationStoreId:
        editingMovement.documentType === "TRANSFER" ? editDestinationStoreId : undefined,
      lines: lines.map(({ line, quantity, unitPriceKgs, unitCostKgs }) => ({
        lineId: line.lineId,
        customerOrderLineId: line.customerOrderLineId,
        productId: line.productId,
        variantId: line.variantId,
        quantity: quantity ?? 0,
        unitPriceKgs,
        unitCostKgs,
      })),
      idempotencyKey:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `movement-edit-${Date.now()}`,
    });
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
    const editButton = isEditableMovement(movement) ? (
      <Button
        variant={layout === "desktop" ? "ghost" : "secondary"}
        size={layout === "desktop" ? "icon" : undefined}
        onClick={() => openEditModal(movement)}
        aria-label={tCommon("edit")}
        data-testid="movement-edit-button"
        className={layout === "mobile" ? "w-full justify-center" : undefined}
      >
        <EditIcon className="h-4 w-4" aria-hidden />
        {layout === "mobile" ? tCommon("edit") : null}
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
      <Modal
        open={Boolean(editingMovement)}
        onOpenChange={(open) => {
          if (!open) {
            setEditingMovement(null);
            setReplaceLineKey(null);
          }
        }}
        title={t("editTitle")}
        subtitle={
          editingMovement
            ? t("editSubtitle", {
                number: editingMovement.documentNumber || editingMovement.documentId,
              })
            : undefined
        }
        className="max-w-5xl"
        bodyClassName="space-y-5"
        usePortal
        mobileSheet
      >
        {editableDocumentQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">{tCommon("loading")}</p>
        ) : editableDocumentQuery.error ? (
          <div className="border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {translateError(tErrors, editableDocumentQuery.error)}
          </div>
        ) : editingMovement ? (
          <div data-testid="movement-edit-modal" className="space-y-5">
            {editingMovement.documentType === "SALE" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="movement-edit-customer">{t("editCustomer")}</Label>
                  <Input
                    id="movement-edit-customer"
                    value={editCustomerName}
                    onChange={(event) => setEditCustomerName(event.target.value)}
                    data-testid="movement-edit-customer"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="movement-edit-phone">{t("editCustomerPhone")}</Label>
                  <Input
                    id="movement-edit-phone"
                    value={editCustomerPhone}
                    onChange={(event) => setEditCustomerPhone(event.target.value)}
                    data-testid="movement-edit-customer-phone"
                  />
                </div>
              </div>
            ) : null}

            {editingMovement.documentType === "TRANSFER" ? (
              <div className="space-y-1">
                <Label htmlFor="movement-edit-destination-store">{t("recipient")}</Label>
                <Select value={editDestinationStoreId} onValueChange={setEditDestinationStoreId}>
                  <SelectTrigger
                    id="movement-edit-destination-store"
                    data-testid="movement-edit-destination-store"
                  >
                    <SelectValue placeholder={t("recipientPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {stores
                      .filter((store) => store.id !== editableDocument?.sourceStoreId)
                      .map((store) => (
                        <SelectItem key={store.id} value={store.id}>
                          {store.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="space-y-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-end">
                <div className="min-w-0 flex-1 space-y-1">
                  <Label htmlFor="movement-edit-search">
                    {replaceLineKey ? t("editReplaceProduct") : t("editAddProduct")}
                  </Label>
                  <Input
                    id="movement-edit-search"
                    value={editSearch}
                    onChange={(event) => setEditSearch(event.target.value)}
                    placeholder={t("editProductSearchPlaceholder")}
                    data-testid="movement-edit-product-search"
                  />
                </div>
                {replaceLineKey ? (
                  <Button type="button" variant="secondary" onClick={() => setReplaceLineKey(null)}>
                    {t("editCancelReplace")}
                  </Button>
                ) : null}
              </div>
              {editSearch.trim() ? (
                <div className="max-h-48 overflow-y-auto rounded-md border border-border">
                  {editingMovement.documentType !== "RETURN" && editProductSearchQuery.isLoading ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground">
                      {tCommon("loading")}
                    </p>
                  ) : editProductChoices.length ? (
                    editProductChoices.map((result) => (
                      <button
                        key={`${result.product.id}:${result.snapshot.variantId ?? "BASE"}:${result.customerOrderLineId ?? "product"}`}
                        type="button"
                        data-testid="movement-edit-product-result"
                        className="flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/50"
                        onClick={() => addProductToEdit(result)}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">
                            {result.product.name}
                            {result.variant?.name ? ` · ${result.variant.name}` : ""}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {result.product.sku || result.primaryBarcode || tCommon("notAvailable")}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {replaceLineKey ? t("editReplace") : t("editAdd")}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-2 text-sm text-muted-foreground">
                      {tCommon("nothingFound")}
                    </p>
                  )}
                </div>
              ) : null}
            </div>

            <div className="overflow-x-auto rounded-md border border-border">
              <Table className="min-w-[820px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{tCommon("product")}</TableHead>
                    <TableHead className="w-28 text-right">{t("quantity")}</TableHead>
                    <TableHead className="w-36 text-right">
                      {editingMovement.documentType === "SALE" ||
                      editingMovement.documentType === "RETURN"
                        ? t("editUnitPrice")
                        : t("printUnitCost")}
                    </TableHead>
                    <TableHead className="w-36 text-right">{t("printLineTotal")}</TableHead>
                    <TableHead className="w-40 text-right">{tCommon("actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {editLines.map((line) => {
                    const quantity = parseNumberInput(line.quantityInput) ?? 0;
                    const unitValue =
                      editingMovement.documentType === "SALE" ||
                      editingMovement.documentType === "RETURN"
                        ? (parseNumberInput(line.unitPriceInput) ?? 0)
                        : (parseNumberInput(line.unitCostInput) ?? 0);
                    return (
                      <TableRow key={line.key} data-testid="movement-edit-line">
                        <TableCell>
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {line.productName}
                              {line.variantName ? ` · ${line.variantName}` : ""}
                            </p>
                            {replaceLineKey === line.key ? (
                              <p className="text-xs text-primary">{t("editReplaceActive")}</p>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={line.quantityInput}
                            inputMode="numeric"
                            className="text-right"
                            data-testid="movement-edit-line-qty"
                            onChange={(event) =>
                              updateEditLine(line.key, { quantityInput: event.target.value })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={
                              editingMovement.documentType === "SALE" ||
                              editingMovement.documentType === "RETURN"
                                ? line.unitPriceInput
                                : line.unitCostInput
                            }
                            inputMode="decimal"
                            className="text-right"
                            data-testid="movement-edit-line-price"
                            onChange={(event) =>
                              updateEditLine(
                                line.key,
                                editingMovement.documentType === "SALE" ||
                                  editingMovement.documentType === "RETURN"
                                  ? { unitPriceInput: event.target.value }
                                  : { unitCostInput: event.target.value },
                              )
                            }
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrencyKGS(quantity * unitValue, locale)}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              variant={replaceLineKey === line.key ? "default" : "secondary"}
                              size="sm"
                              data-testid="movement-edit-line-replace"
                              onClick={() => {
                                setReplaceLineKey(line.key);
                                setEditSearch("");
                              }}
                            >
                              <EditIcon className="h-4 w-4" aria-hidden />
                              {t("editReplace")}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              data-testid="movement-edit-line-remove"
                              onClick={() => removeEditLine(line.key)}
                              aria-label={t("editRemoveLine")}
                              title={t("editRemoveLine")}
                            >
                              <DeleteIcon className="h-4 w-4" aria-hidden />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="movement-edit-notes">{t("comment")}</Label>
                <Textarea
                  id="movement-edit-notes"
                  value={editNotes}
                  onChange={(event) => setEditNotes(event.target.value)}
                  data-testid="movement-edit-notes"
                  rows={3}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="movement-edit-reason">{t("reason")}</Label>
                <Textarea
                  id="movement-edit-reason"
                  value={editReason}
                  onChange={(event) => setEditReason(event.target.value)}
                  placeholder={t("editReasonPlaceholder")}
                  data-testid="movement-edit-reason"
                  rows={3}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{t("amount")}</span>
              <span className="font-semibold text-foreground" data-testid="movement-edit-total">
                {formatCurrencyKGS(
                  editLines.reduce((sum, line) => {
                    const quantity = parseNumberInput(line.quantityInput) ?? 0;
                    const unitValue =
                      editingMovement.documentType === "SALE" ||
                      editingMovement.documentType === "RETURN"
                        ? (parseNumberInput(line.unitPriceInput) ?? 0)
                        : (parseNumberInput(line.unitCostInput) ?? 0);
                    return sum + quantity * unitValue;
                  }, 0),
                  locale,
                )}
              </span>
            </div>

            <ModalFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditingMovement(null);
                  setReplaceLineKey(null);
                }}
                disabled={editMutation.isLoading}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="button"
                onClick={submitEdit}
                disabled={editMutation.isLoading}
                data-testid="movement-edit-save"
              >
                <AddIcon className="h-4 w-4" aria-hidden />
                {editMutation.isLoading ? tCommon("saving") : tCommon("save")}
              </Button>
            </ModalFooter>
          </div>
        ) : null}
      </Modal>
    </div>
  );
};

export default ProductMovementsPage;

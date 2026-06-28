"use client";

import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type HTMLAttributes,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { PageHeader } from "@/components/page-header";
import { ColumnVisibilityMenu } from "@/components/column-visibility-menu";
import { HelpLink } from "@/components/help-link";
import { SavedTableViews } from "@/components/saved-table-views";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { RowActions } from "@/components/row-actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/form-layout";
import { Spinner } from "@/components/ui/spinner";
import {
  AddIcon,
  AdjustIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ArchiveIcon,
  DownloadIcon,
  ReceiveIcon,
  PrintIcon,
  TransferIcon,
  CheckIcon,
  StatusSuccessIcon,
  EmptyIcon,
  GridViewIcon,
  MoreIcon,
  SearchIcon,
  SortIcon,
  TableViewIcon,
  ViewIcon,
} from "@/components/icons";
import { TooltipProvider } from "@/components/ui/tooltip";
import { formatDateTime, formatNumber } from "@/lib/i18nFormat";
import { formatMovementNote } from "@/lib/i18n/movementNote";
import { formatStoreMoney } from "@/lib/currencyDisplay";
import { parseNumberInput, resolveNumberInputOnBlur, toNumberInputValue } from "@/lib/numberInput";
import {
  buildBarcodeLabelPrintItems,
  hasPrintableBarcode,
  type BarcodePrintProduct,
} from "@/lib/barcodePrint";
import { downloadPdfBlob, fetchPdfBlob, printPdfBlob } from "@/lib/pdfClient";
import { getQzTrayBinding, printPdfBlobViaQzTray, qzTrayErrorMessageKey } from "@/lib/qzTrayPrint";
import {
  PRICE_TAG_ROLL_DEFAULTS,
  PRICE_TAG_ROLL_LIMITS,
  PRICE_TAG_TEMPLATES,
  ROLL_PRICE_TAG_TEMPLATE,
  isRollPriceTagTemplate,
} from "@/lib/priceTags";
import { buildSavedLabelPrintValues, resolveLabelPrintFlowAction } from "@/lib/labelPrintFlow";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import {
  buildScopedStorageKey,
  useScopedLocalStorageState,
} from "@/lib/useScopedLocalStorageState";
import {
  createSavedTableView,
  findMatchingSavedTableView,
  overwriteSavedTableView,
  parseSavedTableViews,
  renameSavedTableView,
} from "@/lib/saved-table-views";
import { useSse } from "@/lib/useSse";
import { useToast } from "@/components/ui/toast";
import { SelectionToolbar } from "@/components/selection-toolbar";
import { InlineEditableCell, InlineEditTableProvider } from "@/components/table/InlineEditableCell";
import { isInlineEditingEnabled } from "@/lib/inlineEdit/featureFlag";
import { inlineEditRegistry, type InlineMutationOperation } from "@/lib/inlineEdit/registry";

const inventoryViewModeSchema = z.enum(["table", "grid"]);
const inventoryStockFilterSchema = z.enum(["all", "lowStock", "outOfStock", "negativeStock"]);
const inventorySortKeySchema = z.enum([
  "sku",
  "image",
  "product",
  "onHand",
  "minStock",
  "lowStock",
  "onOrder",
  "suggestedOrder",
]);
const inventorySortDirectionSchema = z.enum(["asc", "desc"]);
const inventoryVisibleColumnSchema = z.enum([
  "sku",
  "image",
  "product",
  "onHand",
  "minStock",
  "lowStock",
  "onOrder",
  "suggestedOrder",
]);
const defaultInventoryVisibleColumns = [
  "sku",
  "image",
  "product",
  "onHand",
  "minStock",
  "lowStock",
  "onOrder",
  "suggestedOrder",
] as const;
const defaultInventorySortDirectionByKey: Record<InventorySortKey, InventorySortDirection> = {
  sku: "asc",
  image: "asc",
  product: "asc",
  onHand: "desc",
  minStock: "desc",
  lowStock: "desc",
  onOrder: "desc",
  suggestedOrder: "desc",
};
const inventoryTableStateSchema = z.object({
  storeId: z.string(),
  search: z.string(),
  viewMode: inventoryViewModeSchema,
  stockFilter: inventoryStockFilterSchema.optional().default("all"),
  pageSize: z.number().int().min(1).max(200),
  showPlanning: z.boolean(),
  sort: z
    .object({
      key: inventorySortKeySchema,
      direction: inventorySortDirectionSchema,
    })
    .optional()
    .default({ key: "product", direction: "asc" }),
  visibleColumns: z
    .array(inventoryVisibleColumnSchema)
    .optional()
    .default([...defaultInventoryVisibleColumns]),
});

const legacyInventoryPrintModalEnabled = process.env.NODE_ENV !== "production";
const BULK_ON_HAND_CHUNK_SIZE = 100;

type InventoryTableState = z.infer<typeof inventoryTableStateSchema>;
type InventoryStockFilter = z.infer<typeof inventoryStockFilterSchema>;
type InventoryVisibleColumnKey = z.infer<typeof inventoryVisibleColumnSchema>;
type InventorySortKey = z.infer<typeof inventorySortKeySchema>;
type InventorySortDirection = z.infer<typeof inventorySortDirectionSchema>;
type InventoryProductOption = {
  key: string;
  productId: string;
  variantId: string | null;
  label: string;
  sku: string;
  barcode: string | null;
  imageUrl: string | null;
  onHand: number;
  unitCostKgs: number | null;
  priceKgs: number | null;
};

type ProductSearchSelectProps = HTMLAttributes<HTMLDivElement> & {
  value: string;
  options: InventoryProductOption[];
  search: string;
  onSearchChange: (value: string) => void;
  onProductSelect: (option: InventoryProductOption) => void;
  placeholder: string;
  selectedLabel: string;
  noResultsLabel: string;
  loadingLabel: string;
  stockLabel: string;
  costLabel: string;
  priceLabel: string;
  formatMoney: (value: number) => string;
  disabled?: boolean;
  loading?: boolean;
};

const ProductSearchSelect = forwardRef<HTMLDivElement, ProductSearchSelectProps>(
  (
    {
      value,
      options,
      search,
      onSearchChange,
      onProductSelect,
      placeholder,
      selectedLabel,
      noResultsLabel,
      loadingLabel,
      stockLabel,
      costLabel,
      priceLabel,
      formatMoney,
      disabled,
      loading,
      ...props
    },
    ref,
  ) => {
    const selectedOption = options.find((option) => option.key === value) ?? null;
    const normalizedSearch = search.trim().toLowerCase();
    const visibleOptions = options
      .filter((option) =>
        normalizedSearch
          ? [option.label, option.sku, option.barcode ?? ""]
              .join(" ")
              .toLowerCase()
              .includes(normalizedSearch)
          : true,
      )
      .slice(0, 25);

    return (
      <div ref={ref} className="space-y-2" {...props}>
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={selectedOption?.label ?? placeholder}
            disabled={disabled}
            className="pl-9"
            autoComplete="off"
          />
        </div>
        <div className="max-h-56 overflow-y-auto rounded-xl border border-border bg-background">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {loadingLabel}
            </div>
          ) : visibleOptions.length ? (
            visibleOptions.map((option) => {
              const selected = option.key === value;
              return (
                <button
                  key={option.key}
                  type="button"
                  className="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => {
                    onProductSelect(option);
                  }}
                  disabled={disabled}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden bg-muted/30">
                    {option.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={option.imageUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <EmptyIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground">
                      {option.label}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[option.sku, option.barcode].filter(Boolean).join(" • ") || selectedLabel}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {stockLabel}: {option.onHand}
                      {option.unitCostKgs !== null
                        ? ` • ${costLabel}: ${formatMoney(option.unitCostKgs)}`
                        : ""}
                      {option.priceKgs !== null
                        ? ` • ${priceLabel}: ${formatMoney(option.priceKgs)}`
                        : ""}
                    </span>
                  </span>
                  {selected ? (
                    <CheckIcon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  ) : null}
                </button>
              );
            })
          ) : (
            <div className="px-3 py-2 text-sm text-muted-foreground">{noResultsLabel}</div>
          )}
        </div>
        {selectedOption ? (
          <p className="text-xs text-muted-foreground">
            {selectedLabel}: <span className="text-foreground">{selectedOption.label}</span>
          </p>
        ) : null}
      </div>
    );
  },
);
ProductSearchSelect.displayName = "ProductSearchSelect";

const InventoryPage = () => {
  const t = useTranslations("inventory");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const tPrinting = useTranslations("printingSettings");
  const locale = useLocale();
  const { data: session } = useSession();
  const role = session?.user?.role;
  const canManage = role === "ADMIN" || role === "MANAGER";
  const isAdmin = role === "ADMIN";
  const canManageStock = canManage;
  const router = useRouter();
  const pathname = usePathname() ?? "/inventory";
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const trpcUtils = trpc.useUtils();
  const storesQuery = trpc.stores.list.useQuery();
  type StoreRow = NonNullable<typeof storesQuery.data>[number] & { trackExpiryLots?: boolean };
  const stores: StoreRow[] = (storesQuery.data ?? []) as StoreRow[];
  const [inventoryPage, setInventoryPage] = useState(1);
  const [expandedReorderId, setExpandedReorderId] = useState<string | null>(null);
  const [expiryWindow, setExpiryWindow] = useState<30 | 60 | 90>(30);
  const [activeDialog, setActiveDialog] = useState<
    "adjust" | "transfer" | "minStock" | "bulkOnHand" | "movements" | null
  >(null);
  const [bulkOnHandProgress, setBulkOnHandProgress] = useState<{
    processed: number;
    total: number;
  } | null>(null);
  const [movementTarget, setMovementTarget] = useState<{
    productId: string;
    variantId?: string | null;
    label: string;
  } | null>(null);
  const [poDraftOpen, setPoDraftOpen] = useState(false);
  const [poDraftItems, setPoDraftItems] = useState<
    {
      key: string;
      productId: string;
      variantId?: string | null;
      productName: string;
      variantName: string;
      suggestedQty: number;
      qtyOrdered: number;
      supplierId: string | null;
      selected: boolean;
    }[]
  >([]);
  const [poDraftQtyInputByKey, setPoDraftQtyInputByKey] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectingAllResults, setSelectingAllResults] = useState(false);
  const [printSetupOpen, setPrintSetupOpen] = useState(false);
  const [inventoryQuickPrintLoading, setInventoryQuickPrintLoading] = useState(false);
  // Dev-only fallback for the old inventory print modal. Normal inventory actions use
  // saved-profile quick print and must not open this settings form.
  const [legacyInventoryPrintModalOpen, setLegacyInventoryPrintModalOpen] = useState(false);
  const [calibrationLoadedStoreKey, setCalibrationLoadedStoreKey] = useState("");
  const [adjustProductSearch, setAdjustProductSearch] = useState("");
  const [transferProductSearch, setTransferProductSearch] = useState("");
  const inlineEditingEnabled = isInlineEditingEnabled();
  const suppliersQuery = trpc.suppliers.list.useQuery(undefined, {
    enabled: canManage && poDraftOpen,
  });
  const defaultInventoryTableState = useMemo<InventoryTableState>(
    () => ({
      storeId: "",
      search: "",
      viewMode: "table",
      stockFilter: "all",
      pageSize: 25,
      showPlanning: false,
      sort: {
        key: "product",
        direction: "asc",
      },
      visibleColumns: [...defaultInventoryVisibleColumns],
    }),
    [],
  );
  const inventoryTableStorageKey = useMemo(
    () =>
      buildScopedStorageKey({
        prefix: "inventory-table-state",
        organizationId: session?.user?.organizationId,
        userId: session?.user?.id,
      }),
    [session?.user?.id, session?.user?.organizationId],
  );
  const parseInventoryTableState = useCallback((raw: string) => {
    try {
      const parsed = inventoryTableStateSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }, []);
  const {
    value: inventoryTableState,
    setValue: setInventoryTableState,
    isReady: inventoryTableStateReady,
    hasStoredValue: hasStoredInventoryTableState,
  } = useScopedLocalStorageState({
    storageKey: inventoryTableStorageKey,
    defaultValue: defaultInventoryTableState,
    parse: parseInventoryTableState,
  });
  const defaultInventorySavedViewsState = useMemo(() => ({ views: [], defaultViewId: null }), []);
  const inventorySavedViewsStorageKey = useMemo(
    () =>
      buildScopedStorageKey({
        prefix: "inventory-saved-views",
        organizationId: session?.user?.organizationId,
        userId: session?.user?.id,
      }),
    [session?.user?.id, session?.user?.organizationId],
  );
  const parseInventorySavedViews = useCallback(
    (raw: string) =>
      parseSavedTableViews(raw, (value) => {
        const parsed = inventoryTableStateSchema.safeParse(value);
        return parsed.success ? parsed.data : null;
      }),
    [],
  );
  const {
    value: inventorySavedViewsState,
    setValue: setInventorySavedViewsState,
    isReady: inventorySavedViewsReady,
  } = useScopedLocalStorageState({
    storageKey: inventorySavedViewsStorageKey,
    defaultValue: defaultInventorySavedViewsState,
    parse: parseInventorySavedViews,
  });
  const storeId = inventoryTableState.storeId;
  const search = inventoryTableState.search;
  const viewMode = inventoryTableState.viewMode;
  const stockFilter = inventoryTableState.stockFilter;
  const inventoryPageSize = inventoryTableState.pageSize;
  const showPlanning = inventoryTableState.showPlanning;
  const inventorySort = inventoryTableState.sort;
  const visibleInventoryColumns = inventoryTableState.visibleColumns;
  const setStoreId = useCallback(
    (nextValue: string) =>
      setInventoryTableState((current) => ({
        ...current,
        storeId: nextValue,
      })),
    [setInventoryTableState],
  );
  const setSearch = useCallback(
    (nextValue: string) =>
      setInventoryTableState((current) => ({
        ...current,
        search: nextValue,
      })),
    [setInventoryTableState],
  );
  const setStockFilter = useCallback(
    (nextValue: InventoryStockFilter) =>
      setInventoryTableState((current) => ({
        ...current,
        stockFilter: nextValue,
      })),
    [setInventoryTableState],
  );
  const setViewMode = useCallback(
    (nextValue: "table" | "grid") =>
      setInventoryTableState((current) => ({
        ...current,
        viewMode: nextValue,
      })),
    [setInventoryTableState],
  );
  const setInventoryPageSize = useCallback(
    (nextValue: number) =>
      setInventoryTableState((current) => ({
        ...current,
        pageSize: nextValue,
      })),
    [setInventoryTableState],
  );
  const setShowPlanning = useCallback(
    (nextValue: boolean) =>
      setInventoryTableState((current) => ({
        ...current,
        showPlanning: nextValue,
      })),
    [setInventoryTableState],
  );
  const toggleInventorySort = useCallback(
    (key: InventorySortKey) => {
      setInventoryTableState((current) => ({
        ...current,
        sort:
          current.sort.key === key
            ? {
                key,
                direction: current.sort.direction === "asc" ? "desc" : "asc",
              }
            : {
                key,
                direction: defaultInventorySortDirectionByKey[key],
              },
      }));
      setInventoryPage(1);
    },
    [setInventoryTableState],
  );
  const toggleVisibleInventoryColumn = useCallback(
    (columnKey: InventoryVisibleColumnKey) =>
      setInventoryTableState((current) => ({
        ...current,
        visibleColumns: current.visibleColumns.includes(columnKey)
          ? current.visibleColumns.filter((value) => value !== columnKey)
          : [...current.visibleColumns, columnKey],
      })),
    [setInventoryTableState],
  );
  const trackExpiryLots = stores.find((store) => store.id === storeId)?.trackExpiryLots ?? false;
  const selectedStore = stores.find((store) => store.id === storeId) ?? null;
  const enableSku = selectedStore?.enableSku ?? true;
  const enableBarcode = selectedStore?.enableBarcode ?? true;
  const formatSelectedStoreMoney = useCallback(
    (value: number) => formatStoreMoney(value, locale, selectedStore),
    [locale, selectedStore],
  );
  const matchingInventorySavedView = useMemo(
    () => findMatchingSavedTableView(inventorySavedViewsState.views, inventoryTableState),
    [inventorySavedViewsState.views, inventoryTableState],
  );
  const baseInventoryColumnOptions = useMemo(
    () => [
      { key: "sku", label: t("sku") },
      { key: "image", label: t("imageLabel") },
      { key: "product", label: tCommon("product"), required: true },
      { key: "onHand", label: t("onHand") },
      { key: "minStock", label: t("minStock") },
      { key: "lowStock", label: t("lowStock") },
      { key: "onOrder", label: t("onOrder") },
      { key: "suggestedOrder", label: t("suggestedOrder") },
    ],
    [t, tCommon],
  );
  const inventoryColumnOptions = useMemo(
    () =>
      baseInventoryColumnOptions.filter((column) => {
        if (column.key === "sku") {
          return enableSku;
        }
        return true;
      }),
    [baseInventoryColumnOptions, enableSku],
  );
  const visibleInventoryColumnSet = useMemo(
    () =>
      new Set<InventoryVisibleColumnKey>(
        visibleInventoryColumns.filter((column) => (column === "sku" ? enableSku : true)),
      ),
    [enableSku, visibleInventoryColumns],
  );
  const mobileStockFilters = useMemo(
    () =>
      [
        { value: "all", label: t("stockFilterAll") },
        { value: "lowStock", label: t("lowStock") },
        { value: "outOfStock", label: t("outOfStock") },
        { value: "negativeStock", label: t("summaryNegativeStock") },
      ] satisfies Array<{ value: InventoryStockFilter; label: string }>,
    [t],
  );

  const adjustSchema = useMemo(
    () =>
      z.object({
        productId: z.string().min(1, t("productRequired")),
        variantId: z.string().optional().nullable(),
        qtyDelta: z.coerce
          .number()
          .int()
          .refine((value) => value !== 0, t("qtyNonZero")),
        unitSelection: z.string().min(1, t("unitRequired")),
        reason: z.string().trim().min(3, t("reasonRequired")),
        expiryDate: z.string().optional(),
      }),
    [t],
  );

  const bulkOnHandSchema = useMemo(
    () =>
      z.object({
        targetOnHand: z.coerce.number().int(),
        reason: z.string().trim().min(3, t("reasonRequired")),
      }),
    [t],
  );

  const transferSchema = useMemo(
    () =>
      z
        .object({
          fromStoreId: z.string().min(1, t("storeRequired")),
          toStoreId: z.string().min(1, t("storeRequired")),
          productId: z.string().min(1, t("productRequired")),
          variantId: z.string().optional().nullable(),
          qty: z.coerce.number().int().positive(t("qtyPositive")),
          unitSelection: z.string().min(1, t("unitRequired")),
          note: z.string().optional(),
          expiryDate: z.string().optional(),
        })
        .refine((data) => data.fromStoreId !== data.toStoreId, {
          message: t("transferStoreDifferent"),
          path: ["toStoreId"],
        }),
    [t],
  );

  const minStockSchema = useMemo(
    () =>
      z
        .object({
          productId: z.string().optional(),
          minStock: z.coerce.number().int().min(0, t("minStockNonNegative")),
          applyToAll: z.boolean().default(false),
        })
        .superRefine((values, context) => {
          if (values.applyToAll) {
            return;
          }
          if (!values.productId?.trim()) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: t("productRequired"),
              path: ["productId"],
            });
          }
        }),
    [t],
  );

  const printSchema = useMemo(
    () =>
      z.object({
        template: z.enum(PRICE_TAG_TEMPLATES),
        storeId: z.string().optional(),
        quantity: z.coerce.number().int().min(1, t("printQtyMin")),
        gapMm: z.coerce
          .number()
          .min(
            PRICE_TAG_ROLL_LIMITS.gapMm.min,
            t("rollGapRange", {
              min: PRICE_TAG_ROLL_LIMITS.gapMm.min,
              max: PRICE_TAG_ROLL_LIMITS.gapMm.max,
            }),
          )
          .max(
            PRICE_TAG_ROLL_LIMITS.gapMm.max,
            t("rollGapRange", {
              min: PRICE_TAG_ROLL_LIMITS.gapMm.min,
              max: PRICE_TAG_ROLL_LIMITS.gapMm.max,
            }),
          ),
        xOffsetMm: z.coerce
          .number()
          .min(
            PRICE_TAG_ROLL_LIMITS.offsetMm.min,
            t("rollOffsetRange", {
              min: PRICE_TAG_ROLL_LIMITS.offsetMm.min,
              max: PRICE_TAG_ROLL_LIMITS.offsetMm.max,
            }),
          )
          .max(
            PRICE_TAG_ROLL_LIMITS.offsetMm.max,
            t("rollOffsetRange", {
              min: PRICE_TAG_ROLL_LIMITS.offsetMm.min,
              max: PRICE_TAG_ROLL_LIMITS.offsetMm.max,
            }),
          ),
        yOffsetMm: z.coerce
          .number()
          .min(
            PRICE_TAG_ROLL_LIMITS.offsetMm.min,
            t("rollOffsetRange", {
              min: PRICE_TAG_ROLL_LIMITS.offsetMm.min,
              max: PRICE_TAG_ROLL_LIMITS.offsetMm.max,
            }),
          )
          .max(
            PRICE_TAG_ROLL_LIMITS.offsetMm.max,
            t("rollOffsetRange", {
              min: PRICE_TAG_ROLL_LIMITS.offsetMm.min,
              max: PRICE_TAG_ROLL_LIMITS.offsetMm.max,
            }),
          ),
        allowWithoutBarcode: z.boolean().default(false),
      }),
    [t],
  );

  const adjustForm = useForm<z.infer<typeof adjustSchema>>({
    resolver: zodResolver(adjustSchema),
    defaultValues: {
      productId: "",
      variantId: null,
      qtyDelta: 0,
      unitSelection: "BASE",
      reason: "",
      expiryDate: "",
    },
  });

  const bulkOnHandForm = useForm<z.infer<typeof bulkOnHandSchema>>({
    resolver: zodResolver(bulkOnHandSchema),
    defaultValues: {
      targetOnHand: 0,
      reason: "",
    },
  });

  const transferForm = useForm<z.infer<typeof transferSchema>>({
    resolver: zodResolver(transferSchema),
    defaultValues: {
      fromStoreId: "",
      toStoreId: "",
      productId: "",
      variantId: null,
      qty: 0,
      unitSelection: "BASE",
      note: "",
      expiryDate: "",
    },
  });

  const minStockForm = useForm<z.infer<typeof minStockSchema>>({
    resolver: zodResolver(minStockSchema),
    defaultValues: {
      productId: "",
      minStock: 0,
      applyToAll: false,
    },
  });

  const printForm = useForm<z.infer<typeof printSchema>>({
    resolver: zodResolver(printSchema),
    defaultValues: {
      template: ROLL_PRICE_TAG_TEMPLATE,
      storeId: storeId || "",
      quantity: 1,
      gapMm: PRICE_TAG_ROLL_DEFAULTS.gapMm,
      xOffsetMm: PRICE_TAG_ROLL_DEFAULTS.xOffsetMm,
      yOffsetMm: PRICE_TAG_ROLL_DEFAULTS.yOffsetMm,
      allowWithoutBarcode: false,
    },
  });
  const printTemplate = printForm.watch("template");
  const legacyPrintStoreId = printForm.watch("storeId")?.trim() ?? "";
  const rollTemplateSelected = isRollPriceTagTemplate(printTemplate);
  const printProfileQuery = trpc.stores.hardware.useQuery(
    { storeId: storeId || "" },
    {
      enabled: Boolean(storeId),
    },
  );
  const printProfileSettings = printProfileQuery.data?.settings;
  const legacyPrintHardwareQuery = trpc.stores.hardware.useQuery(
    { storeId: legacyPrintStoreId },
    {
      enabled:
        legacyInventoryPrintModalEnabled &&
        legacyInventoryPrintModalOpen &&
        rollTemplateSelected &&
        Boolean(legacyPrintStoreId),
    },
  );

  const inventoryListInput = useMemo(
    () => ({
      storeId: storeId ?? "",
      search: search || undefined,
      stockFilter,
      page: inventoryPage,
      pageSize: inventoryPageSize,
      sortKey: inventorySort.key,
      sortDirection: inventorySort.direction,
    }),
    [
      inventoryPage,
      inventoryPageSize,
      inventorySort.direction,
      inventorySort.key,
      search,
      stockFilter,
      storeId,
    ],
  );
  const inventoryQuery = trpc.inventory.list.useQuery(inventoryListInput, {
    enabled: Boolean(storeId) && inventoryTableStateReady,
    keepPreviousData: true,
  });
  const adjustProductSearchQuery = trpc.inventory.searchProducts.useQuery(
    { storeId: storeId ?? "", search: adjustProductSearch || undefined, limit: 25 },
    {
      enabled: activeDialog === "adjust" && Boolean(storeId),
      keepPreviousData: true,
    },
  );
  const transferProductSearchQuery = trpc.inventory.searchProducts.useQuery(
    { storeId: storeId ?? "", search: transferProductSearch || undefined, limit: 25 },
    {
      enabled: activeDialog === "transfer" && Boolean(storeId),
      keepPreviousData: true,
    },
  );
  const inventoryItems = useMemo(
    () => inventoryQuery.data?.items ?? [],
    [inventoryQuery.data?.items],
  );
  const inventoryTotal = inventoryQuery.data?.total ?? 0;
  const inventorySummary = useMemo(
    () => ({
      totalSkus: inventoryTotal,
      negativeStockCount: inventoryItems.filter((item) => item.snapshot.onHand < 0).length,
      lowStockCount: inventoryItems.filter((item) => item.lowStock).length,
      pendingReceiveCount: inventoryItems.filter((item) => item.snapshot.onOrder > 0).length,
    }),
    [inventoryItems, inventoryTotal],
  );
  const reorderCandidates = useMemo(() => {
    return inventoryItems
      .filter((item) => (item.reorder?.suggestedOrderQty ?? 0) > 0)
      .map((item) => ({
        key: `${item.product.id}:${item.snapshot.variantId ?? "BASE"}`,
        productId: item.product.id,
        variantId: item.snapshot.variantId ?? null,
        productName: item.product.name,
        variantName: item.variant?.name ?? tCommon("notAvailable"),
        suggestedQty: item.reorder?.suggestedOrderQty ?? 0,
        qtyOrdered: item.reorder?.suggestedOrderQty ?? 0,
        supplierId: item.product.supplierId ?? null,
      }));
  }, [inventoryItems, tCommon]);
  const supplierMap = useMemo(
    () => new Map((suppliersQuery.data ?? []).map((supplier) => [supplier.id, supplier.name])),
    [suppliersQuery.data],
  );
  const expiringQuery = trpc.stockLots.expiringSoon.useQuery(
    { storeId: storeId ?? "", days: expiryWindow },
    { enabled: Boolean(storeId && trackExpiryLots) },
  );
  const movementsQuery = trpc.inventory.movements.useQuery(
    movementTarget && storeId
      ? {
          storeId,
          productId: movementTarget.productId,
          variantId: movementTarget.variantId ?? undefined,
        }
      : { storeId: "", productId: "" },
    { enabled: Boolean(movementTarget && storeId) },
  );

  type InventoryRow = NonNullable<typeof inventoryItems>[number];
  type InventorySelectorSnapshot = Pick<
    InventoryRow["snapshot"],
    | "id"
    | "storeId"
    | "productId"
    | "variantId"
    | "variantKey"
    | "onHand"
    | "onOrder"
    | "allowNegativeStock"
    | "updatedAt"
  >;
  type InventorySelectorProduct = {
    id: string;
    supplierId: string | null;
    sku: string;
    name: string;
    baseUnitId: string;
    basePriceKgs?: number | { toString(): string } | null;
    photoUrl?: string | null;
    baseUnit: { labelRu: string; labelKg: string };
    barcodes?: Array<{ value: string }>;
    packs: {
      id: string;
      packName: string;
      multiplierToBase: number;
      allowInPurchasing: boolean;
      allowInReceiving: boolean;
    }[];
    images?: Array<{ url?: string | null }>;
  };
  type InventorySelectorItem = {
    snapshot: InventorySelectorSnapshot;
    product: InventorySelectorProduct;
    variant: { id: string; name: string | null } | null;
    primaryBarcode?: string | null;
    unitCostKgs?: number | null;
    priceKgs?: number | null;
  };
  const getInventoryPreviewUrl = (item: {
    product: {
      images?: Array<{ url?: string | null }>;
      photoUrl?: string | null;
    };
  }) => {
    const imageUrl = item.product.images?.[0]?.url ?? item.product.photoUrl ?? null;
    if (!imageUrl || imageUrl.startsWith("data:image/")) {
      return null;
    }
    return imageUrl;
  };

  const selectorItems = useMemo(() => {
    const byKey = new Map<string, InventorySelectorItem>();
    const addItem = (item: InventorySelectorItem) => {
      byKey.set(`${item.product.id}:${item.snapshot.variantId ?? "BASE"}`, item);
    };
    inventoryItems.forEach(addItem);
    (adjustProductSearchQuery.data ?? []).forEach(addItem);
    (transferProductSearchQuery.data ?? []).forEach(addItem);
    return Array.from(byKey.values());
  }, [adjustProductSearchQuery.data, inventoryItems, transferProductSearchQuery.data]);

  const productOptions = useMemo<InventoryProductOption[]>(() => {
    return selectorItems.map((item) => {
      const label = item.variant?.name
        ? `${item.product.name} • ${item.variant.name}`
        : item.product.name;
      const skuLabel = enableSku && item.product.sku ? `${label} (${item.product.sku})` : label;
      return {
        key: `${item.product.id}:${item.snapshot.variantId ?? "BASE"}`,
        productId: item.product.id,
        variantId: item.snapshot.variantId ?? null,
        label: skuLabel,
        sku: enableSku ? item.product.sku : "",
        barcode: enableBarcode
          ? (("primaryBarcode" in item ? item.primaryBarcode : item.product.barcodes?.[0]?.value) ??
            null)
          : null,
        imageUrl: getInventoryPreviewUrl(item),
        onHand: item.snapshot.onHand,
        unitCostKgs: ("unitCostKgs" in item ? item.unitCostKgs : null) ?? null,
        priceKgs:
          ("priceKgs" in item
            ? item.priceKgs
            : item.product.basePriceKgs !== null && item.product.basePriceKgs !== undefined
              ? Number(item.product.basePriceKgs)
              : null) ?? null,
      };
    });
  }, [enableBarcode, enableSku, selectorItems]);

  const productMap = useMemo(
    () => new Map(selectorItems.map((item) => [item.product.id, item.product])),
    [selectorItems],
  );

  const resolveUnitLabel = (unit?: { labelRu: string; labelKg: string }) => {
    if (!unit) {
      return tCommon("notAvailable");
    }
    return locale === "kg" ? unit.labelKg : unit.labelRu;
  };

  const buildUnitOptions = (
    product?: {
      baseUnitId: string;
      baseUnit: { labelRu: string; labelKg: string };
      packs: {
        id: string;
        packName: string;
        multiplierToBase: number;
        allowInPurchasing: boolean;
        allowInReceiving: boolean;
      }[];
    },
    mode: "purchasing" | "receiving" | "inventory" = "inventory",
  ) => {
    if (!product) {
      return [];
    }
    const baseLabel = resolveUnitLabel(product.baseUnit);
    const packList = product.packs ?? [];
    const filtered = packList.filter((pack) =>
      mode === "purchasing" ? pack.allowInPurchasing : pack.allowInReceiving,
    );
    return [
      { value: "BASE", label: baseLabel },
      ...filtered.map((pack) => ({
        value: pack.id,
        label: `${pack.packName} (${pack.multiplierToBase} ${baseLabel})`,
      })),
    ];
  };

  const resolveBasePreview = (
    product:
      | {
          baseUnit: { labelRu: string; labelKg: string };
          packs: { id: string; multiplierToBase: number }[];
        }
      | undefined,
    unitSelection: string,
    qty: number,
  ) => {
    if (!product || !Number.isFinite(qty)) {
      return null;
    }
    const pack =
      unitSelection && unitSelection !== "BASE"
        ? product.packs?.find((item) => item.id === unitSelection)
        : null;
    const multiplier = pack?.multiplierToBase ?? 1;
    return qty * multiplier;
  };

  type ExpiringLot = NonNullable<typeof expiringQuery.data>[number];
  const expiringLots: ExpiringLot[] = useMemo(() => expiringQuery.data ?? [], [expiringQuery.data]);

  const expiringSet = useMemo(() => {
    const set = new Set<string>();
    expiringLots.forEach((lot) => {
      const key = `${lot.productId}:${lot.variantId ?? "BASE"}`;
      set.add(key);
    });
    return set;
  }, [expiringLots]);

  const minStockOptions = useMemo(() => {
    const map = new Map<string, { productId: string; label: string }>();
    inventoryItems.forEach((item) => {
      if (map.has(item.product.id)) {
        return;
      }
      const label =
        enableSku && item.product.sku
          ? `${item.product.name} (${item.product.sku})`
          : item.product.name;
      map.set(item.product.id, { productId: item.product.id, label });
    });
    return Array.from(map.values());
  }, [enableSku, inventoryItems]);

  const selectedSnapshotIds = useMemo(() => Array.from(selectedIds), [selectedIds]);
  const selectedPrintItems = useMemo(
    () => inventoryItems.filter((item) => selectedIds.has(item.snapshot.id)),
    [inventoryItems, selectedIds],
  );
  const rollPreviewItem = selectedPrintItems[0] ?? null;
  const selectedCount = selectedSnapshotIds.length;
  const allSelected =
    Boolean(inventoryItems.length) &&
    inventoryItems.every((item) => selectedIds.has(item.snapshot.id));
  const allResultsSelected = inventoryTotal > 0 && selectedIds.size === inventoryTotal;

  const toggleSelectAll = () => {
    if (!inventoryItems.length) {
      return;
    }
    setSelectedIds(() => {
      if (allSelected) {
        return new Set();
      }
      return new Set(inventoryItems.map((item) => item.snapshot.id));
    });
  };

  const handleSelectAllResults = async () => {
    if (!storeId) {
      return;
    }
    setSelectingAllResults(true);
    try {
      const ids = await trpcUtils.inventory.listIds.fetch({
        storeId,
        search: search || undefined,
        stockFilter,
      });
      setSelectedIds(new Set(ids));
    } catch (error) {
      toast({
        variant: "error",
        description: translateError(tErrors, error as Parameters<typeof translateError>[1]),
      });
    } finally {
      setSelectingAllResults(false);
    }
  };

  const toggleSelect = (snapshotId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(snapshotId)) {
        next.delete(snapshotId);
      } else {
        next.add(snapshotId);
      }
      return next;
    });
  };

  const applyInventorySavedView = useCallback(
    (viewId: string) => {
      const view = inventorySavedViewsState.views.find((item) => item.id === viewId);
      if (!view) {
        return;
      }
      setInventoryTableState(view.state);
      setInventoryPage(1);
      setSelectedIds(new Set());
    },
    [inventorySavedViewsState.views, setInventoryTableState],
  );

  const saveInventoryView = useCallback(
    (name: string) => {
      setInventorySavedViewsState((current) => ({
        ...current,
        views: [...current.views, createSavedTableView({ name, state: inventoryTableState })],
      }));
    },
    [inventoryTableState, setInventorySavedViewsState],
  );

  const renameInventoryView = useCallback(
    (viewId: string, nextName: string) => {
      setInventorySavedViewsState((current) => ({
        ...current,
        views: current.views.map((view) =>
          view.id === viewId ? renameSavedTableView(view, nextName) : view,
        ),
      }));
    },
    [setInventorySavedViewsState],
  );

  const overwriteInventoryView = useCallback(
    (viewId: string) => {
      setInventorySavedViewsState((current) => ({
        ...current,
        views: current.views.map((view) =>
          view.id === viewId ? overwriteSavedTableView(view, inventoryTableState) : view,
        ),
      }));
    },
    [inventoryTableState, setInventorySavedViewsState],
  );

  const deleteInventoryView = useCallback(
    (viewId: string) => {
      setInventorySavedViewsState((current) => ({
        views: current.views.filter((view) => view.id !== viewId),
        defaultViewId: current.defaultViewId === viewId ? null : current.defaultViewId,
      }));
    },
    [setInventorySavedViewsState],
  );

  const setDefaultInventoryView = useCallback(
    (viewId: string | null) => {
      setInventorySavedViewsState((current) => ({
        ...current,
        defaultViewId: viewId && current.views.some((view) => view.id === viewId) ? viewId : null,
      }));
    },
    [setInventorySavedViewsState],
  );

  useEffect(() => {
    if (!storeId && storesQuery.data?.[0]) {
      setStoreId(storesQuery.data[0].id);
    }
  }, [setStoreId, storeId, storesQuery.data]);

  useEffect(() => {
    if (!inventoryTableStateReady || !inventorySavedViewsReady || hasStoredInventoryTableState) {
      return;
    }
    const defaultView = inventorySavedViewsState.views.find(
      (view) => view.id === inventorySavedViewsState.defaultViewId,
    );
    if (!defaultView) {
      return;
    }
    setInventoryTableState(defaultView.state);
  }, [
    hasStoredInventoryTableState,
    inventorySavedViewsReady,
    inventorySavedViewsState.defaultViewId,
    inventorySavedViewsState.views,
    inventoryTableStateReady,
    setInventoryTableState,
  ]);

  useEffect(() => {
    setInventoryPage(1);
  }, [inventorySort.direction, inventorySort.key, search, stockFilter, storeId]);

  useEffect(() => {
    if (!poDraftOpen) {
      setPoDraftQtyInputByKey({});
      return;
    }
    const nextItems = reorderCandidates.map((item) => ({
      ...item,
      selected: true,
    }));
    setPoDraftItems(nextItems);
    setPoDraftQtyInputByKey(
      Object.fromEntries(nextItems.map((item) => [item.key, String(item.qtyOrdered)])),
    );
  }, [poDraftOpen, reorderCandidates]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [storeId, search, stockFilter]);

  useEffect(() => {
    if (activeDialog !== "adjust") {
      setAdjustProductSearch("");
    }
  }, [activeDialog]);

  useEffect(() => {
    if (!legacyInventoryPrintModalOpen) {
      setCalibrationLoadedStoreKey("");
      return;
    }
    printForm.reset({
      template: ROLL_PRICE_TAG_TEMPLATE,
      storeId: storeId || "",
      quantity: 1,
      gapMm: PRICE_TAG_ROLL_DEFAULTS.gapMm,
      xOffsetMm: PRICE_TAG_ROLL_DEFAULTS.xOffsetMm,
      yOffsetMm: PRICE_TAG_ROLL_DEFAULTS.yOffsetMm,
      allowWithoutBarcode: false,
    });
    setCalibrationLoadedStoreKey("");
  }, [legacyInventoryPrintModalOpen, printForm, storeId]);

  useEffect(() => {
    if (!legacyInventoryPrintModalOpen || !rollTemplateSelected) {
      return;
    }
    if (!legacyPrintStoreId) {
      if (calibrationLoadedStoreKey !== "default") {
        printForm.setValue("gapMm", PRICE_TAG_ROLL_DEFAULTS.gapMm);
        printForm.setValue("xOffsetMm", PRICE_TAG_ROLL_DEFAULTS.xOffsetMm);
        printForm.setValue("yOffsetMm", PRICE_TAG_ROLL_DEFAULTS.yOffsetMm);
        printForm.setValue("allowWithoutBarcode", false);
        setCalibrationLoadedStoreKey("default");
      }
      return;
    }
    if (!legacyPrintHardwareQuery.data) {
      return;
    }
    const nextStoreKey = `store:${legacyPrintStoreId}`;
    if (calibrationLoadedStoreKey === nextStoreKey) {
      return;
    }
    printForm.setValue("gapMm", legacyPrintHardwareQuery.data.settings.labelRollGapMm);
    printForm.setValue("xOffsetMm", legacyPrintHardwareQuery.data.settings.labelRollXOffsetMm);
    printForm.setValue("yOffsetMm", legacyPrintHardwareQuery.data.settings.labelRollYOffsetMm);
    printForm.setValue("allowWithoutBarcode", false);
    setCalibrationLoadedStoreKey(nextStoreKey);
  }, [
    calibrationLoadedStoreKey,
    printForm,
    legacyPrintHardwareQuery.data,
    legacyInventoryPrintModalOpen,
    legacyPrintStoreId,
    rollTemplateSelected,
  ]);

  useEffect(() => {
    if (rollTemplateSelected) {
      return;
    }
    printForm.setValue("allowWithoutBarcode", false);
  }, [printForm, rollTemplateSelected]);

  const adjustProductId = adjustForm.watch("productId");
  const adjustVariantId = adjustForm.watch("variantId");
  const adjustUnitSelection = adjustForm.watch("unitSelection");
  const adjustQty = adjustForm.watch("qtyDelta");
  const transferProductId = transferForm.watch("productId");
  const transferVariantId = transferForm.watch("variantId");
  const transferUnitSelection = transferForm.watch("unitSelection");
  const transferQty = transferForm.watch("qty");
  const transferFromStoreId = transferForm.watch("fromStoreId");
  const minStockProductId = minStockForm.watch("productId");
  const minStockApplyToAll = minStockForm.watch("applyToAll");
  const adjustProduct = adjustProductId ? productMap.get(adjustProductId) : undefined;
  const transferProduct = transferProductId ? productMap.get(transferProductId) : undefined;

  useEffect(() => {
    if (storeId) {
      transferForm.setValue("fromStoreId", storeId, { shouldValidate: true });
    }
  }, [storeId, transferForm]);

  useEffect(() => {
    if (!storesQuery.data?.length) {
      return;
    }
    const currentFrom = transferForm.getValues("fromStoreId") || storeId;
    const fallbackStore =
      storesQuery.data.find((store) => store.id !== currentFrom) ?? storesQuery.data[0];
    const currentTo = transferForm.getValues("toStoreId");
    if (!currentTo || currentTo === currentFrom) {
      transferForm.setValue("toStoreId", fallbackStore.id, { shouldValidate: true });
    }
  }, [storeId, storesQuery.data, transferForm, transferFromStoreId]);

  useEffect(() => {
    const firstOption = productOptions[0];
    if (!firstOption) {
      return;
    }
    if (!adjustForm.getValues("productId")) {
      adjustForm.setValue("productId", firstOption.productId, { shouldValidate: true });
      adjustForm.setValue("variantId", firstOption.variantId, { shouldValidate: true });
      adjustForm.setValue("unitSelection", "BASE", { shouldValidate: true });
    }
    if (!transferForm.getValues("productId")) {
      transferForm.setValue("productId", firstOption.productId, { shouldValidate: true });
      transferForm.setValue("variantId", firstOption.variantId, { shouldValidate: true });
      transferForm.setValue("unitSelection", "BASE", { shouldValidate: true });
    }
  }, [productOptions, adjustForm, transferForm]);

  useEffect(() => {
    const firstMinStock = minStockOptions[0];
    if (!firstMinStock) {
      return;
    }
    if (!minStockForm.getValues("productId")) {
      minStockForm.setValue("productId", firstMinStock.productId, { shouldValidate: true });
    }
  }, [minStockOptions, minStockForm]);

  useEffect(() => {
    if (!minStockProductId) {
      return;
    }
    const item = inventoryItems.find((entry) => entry.product.id === minStockProductId);
    if (item) {
      minStockForm.setValue("minStock", item.minStock, { shouldValidate: true });
    }
  }, [minStockProductId, inventoryItems, minStockForm]);

  const openPrintSettings = useCallback(() => {
    router.push("/settings/printing");
  }, [router]);

  const handleInventoryQuickPrint = async () => {
    if (!selectedSnapshotIds.length || inventoryQuickPrintLoading) {
      return;
    }

    const action = resolveLabelPrintFlowAction({
      settings: printProfileSettings,
      storeId,
      isLoading: printProfileQuery.isLoading,
    });

    if (action === "setupRequired") {
      setPrintSetupOpen(true);
      return;
    }
    if (action === "loading") {
      toast({ variant: "info", description: t("printProfileLoading") });
      return;
    }

    const loadedMissingBarcode = selectedPrintItems.filter(
      (item) => !hasPrintableBarcode(item.product as BarcodePrintProduct),
    );
    if (loadedMissingBarcode.length > 0) {
      toast({ variant: "error", description: t("printMissingBarcode") });
      return;
    }

    setInventoryQuickPrintLoading(true);
    try {
      const snapshotProductIds = await trpcUtils.inventory.productIdsBySnapshotIds.fetch({
        snapshotIds: selectedSnapshotIds,
      });
      if (!snapshotProductIds.length) {
        toast({ variant: "error", description: t("printNoPrintableProducts") });
        return;
      }
      const productsForPrint = await trpcUtils.products.byIds.fetch({ ids: snapshotProductIds });
      const missingBarcodeCount = productsForPrint.filter(
        (product) => !hasPrintableBarcode(product as BarcodePrintProduct),
      ).length;
      if (missingBarcodeCount > 0) {
        toast({
          variant: "error",
          description: t("printMissingBarcodeCount", { count: missingBarcodeCount }),
        });
        return;
      }

      const printValues = buildSavedLabelPrintValues({
        settings: printProfileSettings,
        storeId,
      });
      const blob = await fetchPdfBlob({
        url: "/api/price-tags/pdf",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            template: printValues.template,
            storeId: printValues.storeId || undefined,
            allowWithoutBarcode: false,
            rollCalibration: isRollPriceTagTemplate(printValues.template)
              ? {
                  widthMm: printValues.widthMm,
                  heightMm: printValues.heightMm,
                  gapMm: printProfileSettings?.labelRollGapMm,
                  xOffsetMm: printProfileSettings?.labelRollXOffsetMm,
                  yOffsetMm: printProfileSettings?.labelRollYOffsetMm,
                }
              : undefined,
            display: printProfileSettings
              ? {
                  showProductName: printProfileSettings.labelShowProductName,
                  showPrice: printProfileSettings.labelShowPrice,
                  showSku: printProfileSettings.labelShowSku,
                  showBarcodeText: printProfileSettings.labelShowBarcodeText,
                  showCurrency: printProfileSettings.labelShowCurrency,
                  showStoreName: printProfileSettings.labelShowStoreName,
                  barcodeType: printProfileSettings.labelBarcodeType,
                  labelLayoutOrder: printProfileSettings.labelLayoutOrder,
                  barcodeHeightMm: printProfileSettings.labelBarcodeHeightMm,
                  labelFontSize: printProfileSettings.labelFontSize,
                }
              : undefined,
            items: buildBarcodeLabelPrintItems({
              productIds: snapshotProductIds,
              quantity: printValues.quantity,
            }),
          }),
        },
      });
      const printStoreId = printValues.storeId || storeId || "";
      if (printProfileSettings?.labelPrintProvider === "QZ_TRAY" && printStoreId) {
        const binding = getQzTrayBinding(printStoreId);
        await printPdfBlobViaQzTray({
          blob,
          printerName: binding.labelPrinterName,
        });
      } else {
        const result = await printPdfBlob(blob);
        if (!result.autoPrintAttempted) {
          toast({ variant: "info", description: t("printFallback") });
        }
      }
      toast({
        variant: "success",
        description: t("printQueued", {
          count: snapshotProductIds.length * printValues.quantity,
        }),
        actionLabel: t("changePrintSettings"),
        actionHref: "/settings/printing",
      });
      setSelectedIds(new Set());
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === tErrors("priceTagsBarcodeConfirmationRequired")) {
        toast({ variant: "error", description: t("printMissingBarcode") });
        return;
      }
      const qzErrorKey = qzTrayErrorMessageKey(error);
      if (message.startsWith("qz") || qzErrorKey !== "qzPrintFailed") {
        toast({ variant: "error", description: tPrinting(qzErrorKey) });
        return;
      }
      if (message && message !== "pdfRequestFailed" && message !== "pdfContentTypeInvalid") {
        toast({ variant: "error", description: message });
        return;
      }
      toast({ variant: "error", description: t("priceTagsFailed") });
    } finally {
      setInventoryQuickPrintLoading(false);
    }
  };

  const handleLegacyInventoryPrintTags = async (
    values: z.infer<typeof printSchema>,
    mode: "download" | "print",
  ) => {
    if (!selectedSnapshotIds.length) {
      return;
    }
    try {
      const snapshotProductIds = await trpcUtils.inventory.productIdsBySnapshotIds.fetch({
        snapshotIds: selectedSnapshotIds,
      });
      if (!snapshotProductIds.length) {
        return;
      }
      const legacySettings = legacyPrintHardwareQuery.data?.settings;
      const blob = await fetchPdfBlob({
        url: "/api/price-tags/pdf",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            template: values.template,
            storeId: values.storeId || undefined,
            allowWithoutBarcode: values.allowWithoutBarcode,
            rollCalibration: isRollPriceTagTemplate(values.template)
              ? {
                  gapMm: values.gapMm,
                  xOffsetMm: values.xOffsetMm,
                  yOffsetMm: values.yOffsetMm,
                }
              : undefined,
            display: legacySettings
              ? {
                  showProductName: legacySettings.labelShowProductName,
                  showPrice: legacySettings.labelShowPrice,
                  showSku: legacySettings.labelShowSku,
                  showBarcodeText: legacySettings.labelShowBarcodeText,
                  showCurrency: legacySettings.labelShowCurrency,
                  showStoreName: legacySettings.labelShowStoreName,
                  barcodeType: legacySettings.labelBarcodeType,
                  labelLayoutOrder: legacySettings.labelLayoutOrder,
                  barcodeHeightMm: legacySettings.labelBarcodeHeightMm,
                  labelFontSize: legacySettings.labelFontSize,
                }
              : undefined,
            items: snapshotProductIds.map((productId) => ({
              productId,
              quantity: values.quantity,
            })),
          }),
        },
      });
      if (mode === "print") {
        if (legacySettings?.labelPrintProvider === "QZ_TRAY" && values.storeId) {
          const binding = getQzTrayBinding(values.storeId);
          await printPdfBlobViaQzTray({
            blob,
            printerName: binding.labelPrinterName,
          });
        } else {
          await printPdfBlob(blob);
        }
      } else {
        downloadPdfBlob(blob, `price-tags-${values.template}.pdf`);
      }
      setLegacyInventoryPrintModalOpen(false);
      setSelectedIds(new Set());
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === tErrors("priceTagsBarcodeConfirmationRequired")) {
        toast({ variant: "error", description: t("printWithoutBarcodeConfirmRequired") });
        return;
      }
      const qzErrorKey = qzTrayErrorMessageKey(error);
      if (message.startsWith("qz") || qzErrorKey !== "qzPrintFailed") {
        toast({ variant: "error", description: tPrinting(qzErrorKey) });
        return;
      }
      toast({ variant: "error", description: t("priceTagsFailed") });
    }
  };

  const buildTransferHref = useCallback(
    (item?: InventoryRow) => {
      const params = new URLSearchParams();
      if (storeId) {
        params.set("fromStoreId", storeId);
      }
      if (item) {
        params.set("productId", item.product.id);
        if (item.snapshot.variantId) {
          params.set("variantId", item.snapshot.variantId);
        }
      }
      const query = params.toString();
      return query ? `/inventory/transfers?${query}` : "/inventory/transfers";
    },
    [storeId],
  );

  const buildWriteOffHref = useCallback(
    (item?: InventoryRow) => {
      const params = new URLSearchParams();
      if (storeId) {
        params.set("storeId", storeId);
      }
      if (item) {
        params.set("productId", item.product.id);
        if (item.snapshot.variantId) {
          params.set("variantId", item.snapshot.variantId);
        }
      }
      const query = params.toString();
      return query ? `/inventory/write-offs?${query}` : "/inventory/write-offs";
    },
    [storeId],
  );

  const openActionDialog = useCallback(
    (type: "adjust" | "transfer" | "minStock", item?: InventoryRow) => {
      if ((type === "adjust" || type === "transfer") && !canManageStock) {
        return;
      }
      if (type === "minStock" && !canManage) {
        return;
      }
      setActiveDialog(type);
      if (type === "minStock") {
        minStockForm.setValue("applyToAll", false, { shouldValidate: false });
      }
      if (!item) {
        return;
      }
      const productId = item.product.id;
      const variantId = item.snapshot.variantId ?? null;
      if (type === "adjust") {
        adjustForm.setValue("productId", productId, { shouldValidate: true });
        adjustForm.setValue("variantId", variantId, { shouldValidate: true });
      }
      if (type === "transfer") {
        transferForm.setValue("productId", productId, { shouldValidate: true });
        transferForm.setValue("variantId", variantId, { shouldValidate: true });
      }
      if (type === "minStock") {
        minStockForm.setValue("applyToAll", false, { shouldValidate: true });
        minStockForm.setValue("productId", productId, { shouldValidate: true });
        minStockForm.setValue("minStock", item.minStock, { shouldValidate: true });
      }
    },
    [adjustForm, canManage, canManageStock, minStockForm, transferForm],
  );

  useEffect(() => {
    const action = searchParams.get("action");
    if (!action) {
      return;
    }

    const isStockAction = action === "adjust" || action === "transfer";
    const isManagedAction = isStockAction || action === "minStock";
    if ((isStockAction && !canManageStock) || (isManagedAction && !canManage)) {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete("action");
      const nextQuery = nextParams.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
      return;
    }

    if (!storeId && !(storesQuery.data?.length ?? 0)) {
      return;
    }

    if (action === "transfer") {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete("action");
      const nextQuery = nextParams.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
      router.push(buildTransferHref());
      return;
    }

    if (action === "adjust" || action === "minStock") {
      openActionDialog(action);
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("action");
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [
    canManage,
    canManageStock,
    buildTransferHref,
    openActionDialog,
    pathname,
    router,
    searchParams,
    storeId,
    storesQuery.data,
  ]);

  const openMovements = (item: InventoryRow) => {
    const label = item.variant?.name
      ? `${item.product.name} • ${item.variant.name}`
      : item.product.name;
    setMovementTarget({
      productId: item.product.id,
      variantId: item.snapshot.variantId,
      label,
    });
    setActiveDialog("movements");
  };

  const getInventoryActions = (item: InventoryRow) => {
    const actions = [
      ...(canManageStock
        ? [
            {
              key: "adjust",
              label: t("stockAdjustment"),
              icon: AdjustIcon,
              onSelect: () => openActionDialog("adjust", item),
            },
            {
              key: "transfer",
              label: t("transferStock"),
              icon: TransferIcon,
              onSelect: () => router.push(buildTransferHref(item)),
            },
            {
              key: "writeOff",
              label: t("stockWriteOff"),
              icon: ArchiveIcon,
              onSelect: () => router.push(buildWriteOffHref(item)),
            },
          ]
        : []),
      ...(canManage
        ? [
            {
              key: "minStock",
              label: t("minStockTitle"),
              icon: AddIcon,
              onSelect: () => openActionDialog("minStock", item),
            },
          ]
        : []),
      {
        key: "movements",
        label: t("viewMovements"),
        icon: ViewIcon,
        onSelect: () => openMovements(item),
      },
    ];
    return actions.length
      ? actions
      : [
          {
            key: "view",
            label: tCommon("view"),
            icon: ViewIcon,
            onSelect: () => openMovements(item),
          },
        ];
  };

  const adjustMutation = trpc.inventory.adjust.useMutation({
    onSuccess: () => {
      inventoryQuery.refetch();
      void trpcUtils.inventory.searchProducts.invalidate();
      adjustForm.setValue("qtyDelta", 0);
      adjustForm.setValue("reason", "");
      toast({ variant: "success", description: t("adjustSuccess") });
      setActiveDialog(null);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const bulkOnHandMutation = trpc.inventory.bulkSetOnHand.useMutation();
  const bulkOnHandBusy = bulkOnHandMutation.isLoading || Boolean(bulkOnHandProgress);

  const handleBulkOnHandSubmit = async (values: z.infer<typeof bulkOnHandSchema>) => {
    if (!storeId || !selectedSnapshotIds.length || bulkOnHandBusy) {
      return;
    }

    const snapshotIds = [...selectedSnapshotIds];
    const total = snapshotIds.length;
    let processedCount = 0;
    let updatedCount = 0;
    setBulkOnHandProgress({ processed: 0, total });

    try {
      for (let index = 0; index < snapshotIds.length; index += BULK_ON_HAND_CHUNK_SIZE) {
        const chunk = snapshotIds.slice(index, index + BULK_ON_HAND_CHUNK_SIZE);
        const result = await bulkOnHandMutation.mutateAsync({
          storeId,
          snapshotIds: chunk,
          targetOnHand: values.targetOnHand,
          reason: values.reason.trim(),
          idempotencyKey: crypto.randomUUID(),
        });
        processedCount += chunk.length;
        updatedCount += result.updatedCount;
        setBulkOnHandProgress({ processed: processedCount, total });
      }

      await inventoryQuery.refetch();
      await trpcUtils.inventory.searchProducts.invalidate();
      bulkOnHandForm.setValue("targetOnHand", 0);
      bulkOnHandForm.setValue("reason", "");
      toast({
        variant: "success",
        description: t("bulkOnHandSuccess", { count: total, updated: updatedCount }),
      });
      setSelectedIds(new Set());
      setActiveDialog(null);
    } catch (error) {
      toast({
        variant: "error",
        description: translateError(tErrors, error as Parameters<typeof translateError>[1]),
      });
    } finally {
      setBulkOnHandProgress(null);
    }
  };

  const transferMutation = trpc.inventory.transfer.useMutation({
    onSuccess: () => {
      inventoryQuery.refetch();
      void trpcUtils.inventory.searchProducts.invalidate();
      transferForm.setValue("qty", 0);
      transferForm.setValue("note", "");
      toast({ variant: "success", description: t("transferSuccess") });
      setActiveDialog(null);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const minStockMutation = trpc.inventory.setMinStock.useMutation({
    onSuccess: () => {
      inventoryQuery.refetch();
      toast({ variant: "success", description: t("minStockSaved") });
      setActiveDialog(null);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const defaultMinStockMutation = trpc.inventory.setDefaultMinStock.useMutation({
    onSuccess: (result) => {
      inventoryQuery.refetch();
      toast({ variant: "success", description: t("minStockAppliedAll", { count: result.count }) });
      setActiveDialog(null);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const inlineMinStockMutation = trpc.inventory.setMinStock.useMutation();

  const applyInventoryListPatch = useCallback(
    (
      productId: string,
      patch: (
        item: NonNullable<typeof inventoryQuery.data>["items"][number],
      ) => NonNullable<typeof inventoryQuery.data>["items"][number],
    ) => {
      trpcUtils.inventory.list.setData(inventoryListInput, (current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          items: current.items.map((item) =>
            item.snapshot.productId === productId ? patch(item) : item,
          ),
        };
      });
    },
    [inventoryListInput, inventoryQuery, trpcUtils.inventory.list],
  );

  const executeInlineInventoryMutation = useCallback(
    async (operation: InlineMutationOperation) => {
      if (operation.route !== "inventory.setMinStock") {
        throw new Error(`Unsupported inline operation: ${operation.route}`);
      }

      const previous = trpcUtils.inventory.list.getData(inventoryListInput);
      applyInventoryListPatch(operation.input.productId, (item) => ({
        ...item,
        minStock: operation.input.minStock,
        lowStock: operation.input.minStock > 0 && item.snapshot.onHand <= operation.input.minStock,
      }));
      try {
        await inlineMinStockMutation.mutateAsync(operation.input);
      } catch (error) {
        trpcUtils.inventory.list.setData(inventoryListInput, previous);
        throw error;
      }
      await trpcUtils.inventory.list.invalidate(inventoryListInput);
    },
    [applyInventoryListPatch, inlineMinStockMutation, inventoryListInput, trpcUtils.inventory.list],
  );

  const createPoDraftMutation = trpc.purchaseOrders.createFromReorder.useMutation({
    onSuccess: (result) => {
      toast({
        variant: "success",
        description: t("createPoDraftsSuccess", { count: result.purchaseOrders.length }),
      });
      setPoDraftOpen(false);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  useSse({
    "inventory.updated": () => inventoryQuery.refetch(),
    "lowStock.triggered": () => inventoryQuery.refetch(),
  });

  useEffect(() => {
    if (!showPlanning) {
      setExpandedReorderId(null);
    }
  }, [showPlanning]);

  const buildSelectionKey = (productId: string, variantId?: string | null) =>
    `${productId}:${variantId ?? "BASE"}`;

  const movementTypeLabel = (type: string) => {
    switch (type) {
      case "RECEIVE":
        return t("movementType.receive");
      case "SALE":
        return t("movementType.sale");
      case "RETURN":
        return t("movementType.return");
      case "ADJUSTMENT":
        return t("movementType.adjustment");
      case "TRANSFER_IN":
        return t("movementType.transferIn");
      case "TRANSFER_OUT":
        return t("movementType.transferOut");
      case "WRITE_OFF":
        return t("movementType.writeOff");
      default:
        return type;
    }
  };

  const movementBadgeVariant = (type: string) => {
    switch (type) {
      case "RECEIVE":
      case "TRANSFER_IN":
        return "success";
      case "TRANSFER_OUT":
      case "WRITE_OFF":
        return "warning";
      case "SALE":
        return "danger";
      case "RETURN":
        return "success";
      default:
        return "default";
    }
  };

  const adjustSelectionKey = adjustProductId
    ? buildSelectionKey(adjustProductId, adjustVariantId)
    : "";
  const transferSelectionKey = transferProductId
    ? buildSelectionKey(transferProductId, transferVariantId)
    : "";
  const tableColumnCount =
    2 +
    (visibleInventoryColumnSet.has("sku") ? 1 : 0) +
    (visibleInventoryColumnSet.has("image") ? 1 : 0) +
    (visibleInventoryColumnSet.has("product") ? 1 : 0) +
    (visibleInventoryColumnSet.has("onHand") ? 1 : 0) +
    (visibleInventoryColumnSet.has("minStock") ? 1 : 0) +
    (visibleInventoryColumnSet.has("lowStock") ? 1 : 0) +
    (visibleInventoryColumnSet.has("onOrder") ? 1 : 0) +
    (showPlanning && visibleInventoryColumnSet.has("suggestedOrder") ? 1 : 0);
  const renderInventorySortableHead = (
    key: InventorySortKey,
    label: string,
    className?: string,
  ) => (
    <TableHead
      className={className}
      sortable={false}
      aria-sort={
        inventorySort.key === key
          ? inventorySort.direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <button
        type="button"
        className="inline-flex max-w-full items-center gap-1.5 text-left uppercase text-inherit"
        onClick={() => toggleInventorySort(key)}
      >
        <span className="truncate">{label}</span>
        {inventorySort.key === key ? (
          inventorySort.direction === "asc" ? (
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
  const groupedDraftItems = useMemo(() => {
    const groups = new Map<string, typeof poDraftItems>();
    poDraftItems.forEach((item) => {
      const key = item.supplierId ?? "unassigned";
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    });
    return groups;
  }, [poDraftItems]);
  const commitPoDraftQtyInput = useCallback((itemKey: string, rawValue: string) => {
    const nextQty = resolveNumberInputOnBlur(rawValue, 0);
    setPoDraftItems((prev) =>
      prev.map((entry) =>
        entry.key === itemKey
          ? {
              ...entry,
              qtyOrdered: nextQty,
            }
          : entry,
      ),
    );
    setPoDraftQtyInputByKey((prev) => ({
      ...prev,
      [itemKey]: String(nextQty),
    }));
  }, []);

  return (
    <div>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <div className="hidden md:contents">
            {canManage || canManageStock ? (
              <>
                {canManageStock ? (
                  <Button asChild className="w-full sm:w-auto" data-tour="inventory-receive">
                    <Link href="/inventory/receiving">
                      <ReceiveIcon className="h-4 w-4" aria-hidden />
                      {t("stockReceiving")}
                    </Link>
                  </Button>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" className="w-full sm:w-auto">
                      <MoreIcon className="h-4 w-4" aria-hidden />
                      {tCommon("actions")}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[240px]">
                    <DropdownMenuItem asChild>
                      <Link href="/inventory/counts">
                        <ViewIcon className="h-4 w-4" aria-hidden />
                        {t("stockCounts")}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={!storeId || !canManageStock}
                      onSelect={() => openActionDialog("adjust")}
                      data-tour="inventory-adjust"
                    >
                      <AdjustIcon className="h-4 w-4" aria-hidden />
                      {t("stockAdjustment")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!storeId || !canManageStock}
                      onSelect={() => router.push(buildTransferHref())}
                      data-tour="inventory-transfer"
                    >
                      <TransferIcon className="h-4 w-4" aria-hidden />
                      {t("transferStock")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!storeId || !canManageStock}
                      onSelect={() => router.push(buildWriteOffHref())}
                      data-tour="inventory-write-off"
                    >
                      <ArchiveIcon className="h-4 w-4" aria-hidden />
                      {t("stockWriteOff")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!storeId || !canManage}
                      onSelect={() => openActionDialog("minStock")}
                    >
                      <StatusSuccessIcon className="h-4 w-4" aria-hidden />
                      {t("minStockTitle")}
                    </DropdownMenuItem>
                    {showPlanning ? (
                      <DropdownMenuItem
                        disabled={!storeId || reorderCandidates.length === 0}
                        onSelect={() => setPoDraftOpen(true)}
                      >
                        <AddIcon className="h-4 w-4" aria-hidden />
                        {t("createPoDrafts")}
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
                {showPlanning ? <HelpLink articleId="reorder" /> : null}
              </>
            ) : null}
          </div>
        }
        filters={
          <div className="hidden md:contents">
            <div className="w-full sm:max-w-xs">
              <Select value={storeId} onValueChange={(value) => setStoreId(value)}>
                <SelectTrigger>
                  <SelectValue placeholder={tCommon("selectStore")} />
                </SelectTrigger>
                <SelectContent>
                  {storesQuery.data?.map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input
              className="w-full sm:max-w-xs"
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
              <Switch
                checked={showPlanning}
                onCheckedChange={setShowPlanning}
                aria-label={t("showPlanning")}
              />
              <span className="text-sm text-muted-foreground">{t("showPlanning")}</span>
            </div>
          </div>
        }
        actionClassName="hidden md:flex"
        filtersClassName="hidden md:flex"
      />

      <section data-mobile-inventory-toolbar className="mb-4 space-y-3 md:hidden">
        <div className="space-y-3 rounded-xl border border-border bg-card p-3 shadow-sm">
          <Select value={storeId} onValueChange={(value) => setStoreId(value)}>
            <SelectTrigger className="min-h-11">
              <SelectValue placeholder={tCommon("selectStore")} />
            </SelectTrigger>
            <SelectContent>
              {storesQuery.data?.map((store) => (
                <SelectItem key={store.id} value={store.id}>
                  {store.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative">
            <SearchIcon
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="min-h-11 pl-9"
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div
            className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
            role="group"
            aria-label={t("stockFilter")}
          >
            {mobileStockFilters.map((filter) => (
              <Button
                key={filter.value}
                type="button"
                size="sm"
                variant={stockFilter === filter.value ? "primary" : "secondary"}
                className="min-h-10 shrink-0"
                onClick={() => setStockFilter(filter.value)}
              >
                {filter.label}
              </Button>
            ))}
          </div>
        </div>

        {canManage || canManageStock ? (
          <div data-mobile-inventory-actions className="grid grid-cols-[1fr_auto] gap-2">
            {canManageStock ? (
              <Button asChild className="min-h-12 justify-center px-3 text-sm">
                <Link href="/inventory/receiving">
                  <ReceiveIcon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="leading-tight">{t("stockReceiving")}</span>
                </Link>
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-12 w-12 px-0"
                  aria-label={tCommon("actions")}
                >
                  <MoreIcon className="h-5 w-5" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[220px]">
                {canManageStock ? (
                  <DropdownMenuItem
                    disabled={!storeId}
                    onSelect={() => router.push(buildTransferHref())}
                  >
                    <TransferIcon className="h-4 w-4" aria-hidden />
                    {t("transferStock")}
                  </DropdownMenuItem>
                ) : null}
                {canManageStock ? (
                  <DropdownMenuItem
                    disabled={!storeId}
                    onSelect={() => router.push(buildWriteOffHref())}
                  >
                    <ArchiveIcon className="h-4 w-4" aria-hidden />
                    {t("stockWriteOff")}
                  </DropdownMenuItem>
                ) : null}
                {canManage ? (
                  <DropdownMenuItem asChild>
                    <Link href="/inventory/counts">
                      <ViewIcon className="h-4 w-4" aria-hidden />
                      {t("countAdjustAction")}
                    </Link>
                  </DropdownMenuItem>
                ) : null}
                {canManage ? (
                  <DropdownMenuItem
                    disabled={!storeId}
                    onSelect={() => openActionDialog("minStock")}
                  >
                    <StatusSuccessIcon className="h-4 w-4" aria-hidden />
                    {t("minStockTitle")}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </section>

      <div className="mb-4 grid grid-cols-2 gap-2 text-sm md:hidden">
        <div className="rounded-xl bg-muted/40 px-3 py-2">
          <p className="text-xs text-muted-foreground">{t("summaryTotalSkus")}</p>
          <p className="font-semibold text-foreground">
            {formatNumber(inventorySummary.totalSkus, locale)}
          </p>
        </div>
        <div className="rounded-xl bg-muted/40 px-3 py-2">
          <p className="text-xs text-muted-foreground">{t("summaryLowStock")}</p>
          <p
            className={
              inventorySummary.lowStockCount > 0
                ? "font-semibold text-warning"
                : "font-semibold text-foreground"
            }
          >
            {formatNumber(inventorySummary.lowStockCount, locale)}
          </p>
        </div>
      </div>

      <div className="mb-5 hidden grid-cols-2 gap-2 md:mb-6 md:grid md:gap-3 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">{t("summaryTotalSkus")}</p>
          <p className="mt-1 text-xl font-semibold text-foreground">
            {formatNumber(inventorySummary.totalSkus, locale)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">{t("summaryNegativeStock")}</p>
          <p
            className={
              inventorySummary.negativeStockCount > 0
                ? "mt-1 text-xl font-semibold text-danger"
                : "mt-1 text-xl font-semibold text-foreground"
            }
          >
            {formatNumber(inventorySummary.negativeStockCount, locale)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">{t("summaryLowStock")}</p>
          <p
            className={
              inventorySummary.lowStockCount > 0
                ? "mt-1 text-xl font-semibold text-warning"
                : "mt-1 text-xl font-semibold text-foreground"
            }
          >
            {formatNumber(inventorySummary.lowStockCount, locale)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">{t("summaryPendingReceive")}</p>
          <p className="mt-1 text-xl font-semibold text-foreground">
            {formatNumber(inventorySummary.pendingReceiveCount, locale)}
          </p>
        </div>
      </div>

      {trackExpiryLots ? (
        <Card className="mb-6">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>{t("expiringSoonTitle")}</CardTitle>
            <div className="w-full sm:max-w-xs">
              <Select
                value={String(expiryWindow)}
                onValueChange={(value) => {
                  const next = Number(value);
                  if (next === 30 || next === 60 || next === 90) {
                    setExpiryWindow(next);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("expiryWindow")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">{t("expiry30")}</SelectItem>
                  <SelectItem value="60">{t("expiry60")}</SelectItem>
                  <SelectItem value="90">{t("expiry90")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {expiringQuery.isLoading ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="h-4 w-4" />
                {tCommon("loading")}
              </div>
            ) : expiringLots.length ? (
              <div className="space-y-2 text-sm">
                {expiringLots.map((lot) => (
                  <div key={lot.id} className="flex items-center justify-between">
                    <span>
                      {lot.product.name}
                      {lot.variant?.name ? ` • ${lot.variant.name}` : ""}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {lot.expiryDate
                        ? formatDateTime(lot.expiryDate, locale)
                        : tCommon("notAvailable")}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <EmptyIcon className="h-4 w-4" aria-hidden />
                {t("noExpiringLots")}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{t("inventoryOverview")}</CardTitle>
          <div className="hidden w-full flex-col gap-2 md:flex lg:w-auto lg:flex-row lg:flex-wrap lg:items-center lg:justify-end">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <SavedTableViews
                views={inventorySavedViewsState.views}
                matchingViewId={matchingInventorySavedView?.id ?? null}
                defaultViewId={inventorySavedViewsState.defaultViewId}
                disabled={!inventorySavedViewsReady || !inventoryTableStateReady}
                onApplyView={applyInventorySavedView}
                onSaveView={saveInventoryView}
                onRenameView={renameInventoryView}
                onOverwriteView={overwriteInventoryView}
                onDeleteView={deleteInventoryView}
                onSetDefaultView={setDefaultInventoryView}
              />
              {viewMode === "table" ? (
                <ColumnVisibilityMenu
                  columns={inventoryColumnOptions}
                  visibleColumns={visibleInventoryColumns}
                  onToggleColumn={(columnKey) =>
                    toggleVisibleInventoryColumn(columnKey as InventoryVisibleColumnKey)
                  }
                />
              ) : null}
            </div>
            <div className="inline-flex w-full shrink-0 items-center gap-1 rounded-xl border border-border p-1 sm:w-auto">
              <Button
                type="button"
                size="sm"
                variant={viewMode === "table" ? "secondary" : "ghost"}
                className="flex-1 sm:flex-none"
                onClick={() => setViewMode("table")}
                aria-label={t("viewTable")}
              >
                <TableViewIcon className="h-4 w-4" aria-hidden />
                {t("viewTable")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={viewMode === "grid" ? "secondary" : "ghost"}
                className="flex-1 sm:flex-none"
                onClick={() => setViewMode("grid")}
                aria-label={t("viewGrid")}
              >
                <GridViewIcon className="h-4 w-4" aria-hidden />
                {t("viewGrid")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {selectedCount ? (
            <div className="mb-3">
              <TooltipProvider>
                <SelectionToolbar
                  count={selectedCount}
                  label={tCommon("selectedCount", { count: selectedCount })}
                  clearLabel={tCommon("clearSelection")}
                  onClear={() => setSelectedIds(new Set())}
                >
                  {inventoryTotal > inventoryItems.length && !allResultsSelected ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="w-full sm:w-auto"
                      onClick={() => void handleSelectAllResults()}
                      disabled={selectingAllResults}
                    >
                      {selectingAllResults ? <Spinner className="h-4 w-4" /> : null}
                      {selectingAllResults
                        ? tCommon("loading")
                        : tCommon("selectAllResults", { count: inventoryTotal })}
                    </Button>
                  ) : null}
                  <Button
                    data-tour="inventory-print-tags"
                    type="button"
                    size="sm"
                    className="w-full sm:w-auto"
                    onClick={() => void handleInventoryQuickPrint()}
                    disabled={inventoryQuickPrintLoading}
                  >
                    {inventoryQuickPrintLoading ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      <PrintIcon className="h-4 w-4" aria-hidden />
                    )}
                    {inventoryQuickPrintLoading ? tCommon("loading") : t("printSelected")}
                  </Button>
                  {canManageStock ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="w-full sm:w-auto"
                      onClick={() => setActiveDialog("bulkOnHand")}
                    >
                      <AdjustIcon className="h-4 w-4" aria-hidden />
                      {t("bulkEditOnHand")}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="w-full sm:w-auto"
                    onClick={openPrintSettings}
                  >
                    {t("changePrintSettings")}
                  </Button>
                </SelectionToolbar>
              </TooltipProvider>
            </div>
          ) : null}
          <ResponsiveDataList
            items={inventoryItems}
            getKey={(item) => item.snapshot.id}
            paginationKey="inventory-overview"
            page={inventoryPage}
            totalItems={inventoryTotal}
            onPageChange={setInventoryPage}
            onPageSizeChange={setInventoryPageSize}
            renderDesktop={(visibleItems) =>
              viewMode === "table" ? (
                <div className="overflow-x-auto">
                  <TooltipProvider>
                    <InlineEditTableProvider>
                      <Table className="min-w-[640px]" sortable={false}>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded-xl border-border bg-background text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                                checked={allSelected}
                                onChange={toggleSelectAll}
                                aria-label={t("selectAll")}
                              />
                            </TableHead>
                            {visibleInventoryColumnSet.has("sku")
                              ? renderInventorySortableHead("sku", t("sku"), "hidden sm:table-cell")
                              : null}
                            {visibleInventoryColumnSet.has("image")
                              ? renderInventorySortableHead("image", t("imageLabel"))
                              : null}
                            {visibleInventoryColumnSet.has("product")
                              ? renderInventorySortableHead("product", tCommon("product"))
                              : null}
                            {visibleInventoryColumnSet.has("onHand")
                              ? renderInventorySortableHead("onHand", t("onHand"))
                              : null}
                            {visibleInventoryColumnSet.has("minStock")
                              ? renderInventorySortableHead(
                                  "minStock",
                                  t("minStock"),
                                  "hidden sm:table-cell",
                                )
                              : null}
                            {visibleInventoryColumnSet.has("lowStock")
                              ? renderInventorySortableHead("lowStock", t("lowStock"))
                              : null}
                            {visibleInventoryColumnSet.has("onOrder")
                              ? renderInventorySortableHead(
                                  "onOrder",
                                  t("onOrder"),
                                  "hidden md:table-cell",
                                )
                              : null}
                            {showPlanning && visibleInventoryColumnSet.has("suggestedOrder")
                              ? renderInventorySortableHead("suggestedOrder", t("suggestedOrder"))
                              : null}
                            <TableHead>{tCommon("actions")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {visibleItems.map((item) => {
                            const isExpanded = expandedReorderId === item.snapshot.id;
                            const reorder = item.reorder;
                            const expiryKey = `${item.product.id}:${item.snapshot.variantId ?? "BASE"}`;
                            const previewImageUrl = getInventoryPreviewUrl(item);
                            const actions = getInventoryActions(item);
                            return (
                              <Fragment key={item.snapshot.id}>
                                <TableRow>
                                  <TableCell>
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 rounded-xl border-border bg-background text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                                      checked={selectedIds.has(item.snapshot.id)}
                                      onChange={() => toggleSelect(item.snapshot.id)}
                                      aria-label={t("selectInventoryItem", {
                                        name: item.variant?.name
                                          ? `${item.product.name} • ${item.variant.name}`
                                          : item.product.name,
                                      })}
                                    />
                                  </TableCell>
                                  {visibleInventoryColumnSet.has("sku") ? (
                                    <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                                      {item.product.sku}
                                    </TableCell>
                                  ) : null}
                                  {visibleInventoryColumnSet.has("image") ? (
                                    <TableCell>
                                      {previewImageUrl ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                          src={previewImageUrl}
                                          alt={item.product.name}
                                          className="h-10 w-10 rounded-xl border border-border object-cover"
                                        />
                                      ) : (
                                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-dashed border-border bg-secondary/60">
                                          <EmptyIcon
                                            className="h-4 w-4 text-muted-foreground"
                                            aria-hidden
                                          />
                                        </div>
                                      )}
                                    </TableCell>
                                  ) : null}
                                  {visibleInventoryColumnSet.has("product") ? (
                                    <TableCell className="font-medium">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span>
                                          {item.product.name}
                                          {item.variant?.name ? ` • ${item.variant.name}` : ""}
                                        </span>
                                        {trackExpiryLots && expiringSet.has(expiryKey) ? (
                                          <Badge variant="warning">{t("expiringSoonBadge")}</Badge>
                                        ) : null}
                                        {item.snapshot.onHand < 0 ? (
                                          <Badge variant="danger">{t("negativeStockBadge")}</Badge>
                                        ) : null}
                                      </div>
                                    </TableCell>
                                  ) : null}
                                  {visibleInventoryColumnSet.has("onHand") ? (
                                    <TableCell
                                      className={
                                        item.snapshot.onHand < 0
                                          ? "font-semibold text-danger"
                                          : undefined
                                      }
                                    >
                                      {formatNumber(item.snapshot.onHand, locale)}
                                    </TableCell>
                                  ) : null}
                                  {visibleInventoryColumnSet.has("minStock") ? (
                                    <TableCell className="hidden sm:table-cell">
                                      <InlineEditableCell
                                        rowId={item.snapshot.id}
                                        row={item}
                                        value={item.minStock}
                                        definition={inlineEditRegistry.inventory.minStock}
                                        context={{}}
                                        role={role}
                                        locale={locale}
                                        columnLabel={t("minStock")}
                                        tTable={t}
                                        tCommon={tCommon}
                                        enabled={inlineEditingEnabled}
                                        executeMutation={executeInlineInventoryMutation}
                                      />
                                    </TableCell>
                                  ) : null}
                                  {visibleInventoryColumnSet.has("lowStock") ? (
                                    <TableCell>
                                      {item.lowStock && item.snapshot.onHand >= 0 ? (
                                        <Badge variant="warning">{t("lowStockBadge")}</Badge>
                                      ) : (
                                        <span className="text-xs text-muted-foreground/80">
                                          {tCommon("notAvailable")}
                                        </span>
                                      )}
                                    </TableCell>
                                  ) : null}
                                  {visibleInventoryColumnSet.has("onOrder") ? (
                                    <TableCell className="hidden md:table-cell">
                                      {formatNumber(item.snapshot.onOrder, locale)}
                                    </TableCell>
                                  ) : null}
                                  {showPlanning &&
                                  visibleInventoryColumnSet.has("suggestedOrder") ? (
                                    <TableCell>
                                      {reorder ? (
                                        <div className="space-y-1">
                                          <div className="font-medium">
                                            {formatNumber(reorder.suggestedOrderQty, locale)}
                                          </div>
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            className="h-8 px-2 text-xs"
                                            onClick={() =>
                                              setExpandedReorderId(
                                                isExpanded ? null : item.snapshot.id,
                                              )
                                            }
                                          >
                                            {isExpanded ? t("hideWhy") : t("why")}
                                          </Button>
                                        </div>
                                      ) : (
                                        <span className="text-xs text-muted-foreground/80">
                                          {t("planningUnavailable")}
                                        </span>
                                      )}
                                    </TableCell>
                                  ) : null}
                                  <TableCell>
                                    <RowActions
                                      actions={actions}
                                      maxInline={2}
                                      moreLabel={tCommon("tooltips.moreActions")}
                                    />
                                  </TableCell>
                                </TableRow>
                                {showPlanning && isExpanded && reorder ? (
                                  <TableRow>
                                    <TableCell colSpan={tableColumnCount}>
                                      <div className="rounded-xl border border-border/70 bg-muted/30 p-3 text-sm">
                                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                          <div>
                                            <p className="text-xs text-muted-foreground">
                                              {t("demandDuringLeadTime")}
                                            </p>
                                            <p className="font-semibold">
                                              {formatNumber(reorder.demandDuringLeadTime, locale)}
                                            </p>
                                          </div>
                                          <div>
                                            <p className="text-xs text-muted-foreground">
                                              {t("safetyStock")}
                                            </p>
                                            <p className="font-semibold">
                                              {formatNumber(reorder.safetyStock, locale)}
                                            </p>
                                          </div>
                                          <div>
                                            <p className="text-xs text-muted-foreground">
                                              {t("reorderPoint")}
                                            </p>
                                            <p className="font-semibold">
                                              {formatNumber(reorder.reorderPoint, locale)}
                                            </p>
                                          </div>
                                          <div>
                                            <p className="text-xs text-muted-foreground">
                                              {t("targetLevel")}
                                            </p>
                                            <p className="font-semibold">
                                              {formatNumber(reorder.targetLevel, locale)}
                                            </p>
                                          </div>
                                          <div>
                                            <p className="text-xs text-muted-foreground">
                                              {t("suggestedOrder")}
                                            </p>
                                            <p className="font-semibold">
                                              {formatNumber(reorder.suggestedOrderQty, locale)}
                                            </p>
                                          </div>
                                        </div>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                ) : null}
                              </Fragment>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </InlineEditTableProvider>
                  </TooltipProvider>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {visibleItems.map((item) => {
                    const reorder = item.reorder;
                    const label = item.variant?.name
                      ? `${item.product.name} • ${item.variant.name}`
                      : item.product.name;
                    const expiryKey = `${item.product.id}:${item.snapshot.variantId ?? "BASE"}`;
                    const previewImageUrl = getInventoryPreviewUrl(item);
                    const actions = getInventoryActions(item);
                    return (
                      <div
                        key={item.snapshot.id}
                        className="overflow-hidden rounded-xl border border-border bg-card"
                      >
                        <div className="relative aspect-[4/3] bg-muted/30">
                          {previewImageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={previewImageUrl}
                              alt={label}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <EmptyIcon className="h-8 w-8 text-muted-foreground" aria-hidden />
                            </div>
                          )}
                          <label className="absolute right-2 top-2">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded-xl border-border bg-background text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                              checked={selectedIds.has(item.snapshot.id)}
                              onChange={() => toggleSelect(item.snapshot.id)}
                              aria-label={t("selectInventoryItem", { name: label })}
                            />
                          </label>
                        </div>
                        <div className="space-y-3 p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-foreground">
                                {label}
                              </p>
                              {enableSku ? (
                                <p className="text-xs text-muted-foreground">{item.product.sku}</p>
                              ) : null}
                            </div>
                            <RowActions
                              actions={actions}
                              maxInline={2}
                              moreLabel={tCommon("tooltips.moreActions")}
                              className="shrink-0"
                            />
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {trackExpiryLots && expiringSet.has(expiryKey) ? (
                              <Badge variant="warning">{t("expiringSoonBadge")}</Badge>
                            ) : null}
                            {item.lowStock && item.snapshot.onHand >= 0 ? (
                              <Badge variant="warning">{t("lowStockBadge")}</Badge>
                            ) : null}
                            {item.snapshot.onHand < 0 ? (
                              <Badge variant="danger">{t("negativeStockBadge")}</Badge>
                            ) : null}
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                            <div>
                              <p>{t("onHand")}</p>
                              <p
                                className={
                                  item.snapshot.onHand < 0
                                    ? "text-sm font-semibold text-danger"
                                    : "text-sm font-semibold text-foreground"
                                }
                              >
                                {formatNumber(item.snapshot.onHand, locale)}
                              </p>
                            </div>
                            <div>
                              <p>{t("minStock")}</p>
                              <p className="text-sm font-semibold text-foreground">
                                {formatNumber(item.minStock, locale)}
                              </p>
                            </div>
                            <div>
                              <p>{t("onOrder")}</p>
                              <p className="text-sm font-semibold text-foreground">
                                {formatNumber(item.snapshot.onOrder, locale)}
                              </p>
                            </div>
                            {showPlanning ? (
                              <div>
                                <p>{t("suggestedOrder")}</p>
                                <p className="text-sm font-semibold text-foreground">
                                  {reorder
                                    ? formatNumber(reorder.suggestedOrderQty, locale)
                                    : t("planningUnavailable")}
                                </p>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            }
            renderMobile={(item) => {
              const reorder = item.reorder;
              const expiryKey = `${item.product.id}:${item.snapshot.variantId ?? "BASE"}`;
              const label = item.variant?.name
                ? `${item.product.name} • ${item.variant.name}`
                : item.product.name;
              const previewImageUrl = getInventoryPreviewUrl(item);
              const status =
                item.snapshot.onHand < 0
                  ? { label: t("negativeStockBadge"), variant: "danger" as const }
                  : item.snapshot.onHand === 0
                    ? { label: t("outOfStock"), variant: "warning" as const }
                    : item.lowStock
                      ? { label: t("lowStockBadge"), variant: "warning" as const }
                      : { label: t("stockOk"), variant: "success" as const };

              return (
                <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
                  <div className="flex items-start gap-3">
                    {previewImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={previewImageUrl}
                        alt={label}
                        className="h-14 w-14 rounded-xl border border-border object-cover"
                      />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-dashed border-border bg-secondary/60">
                        <EmptyIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">{label}</p>
                          {enableSku ? (
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {item.product.sku}
                            </p>
                          ) : null}
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-10 w-10 shrink-0"
                              aria-label={tCommon("tooltips.moreActions")}
                            >
                              <MoreIcon className="h-4 w-4" aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-[220px]">
                            {canManageStock ? (
                              <DropdownMenuItem onSelect={() => openActionDialog("adjust", item)}>
                                <AdjustIcon className="h-4 w-4" aria-hidden />
                                {t("stockAdjustment")}
                              </DropdownMenuItem>
                            ) : null}
                            {canManageStock ? (
                              <DropdownMenuItem
                                onSelect={() => router.push(buildTransferHref(item))}
                              >
                                <TransferIcon className="h-4 w-4" aria-hidden />
                                {t("transferStock")}
                              </DropdownMenuItem>
                            ) : null}
                            {canManageStock ? (
                              <DropdownMenuItem
                                onSelect={() => router.push(buildWriteOffHref(item))}
                              >
                                <ArchiveIcon className="h-4 w-4" aria-hidden />
                                {t("stockWriteOff")}
                              </DropdownMenuItem>
                            ) : null}
                            {canManage ? (
                              <DropdownMenuItem onSelect={() => openActionDialog("minStock", item)}>
                                <StatusSuccessIcon className="h-4 w-4" aria-hidden />
                                {t("minStockTitle")}
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => openMovements(item)}>
                              <ViewIcon className="h-4 w-4" aria-hidden />
                              {t("viewMovements")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge variant={status.variant}>{status.label}</Badge>
                        {trackExpiryLots && expiringSet.has(expiryKey) ? (
                          <Badge variant="warning">{t("expiringSoonBadge")}</Badge>
                        ) : null}
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                        <div className="min-w-0 rounded-xl bg-muted/30 px-2 py-1.5">
                          <p className="truncate">{t("onHand")}</p>
                          <p
                            className={
                              item.snapshot.onHand < 0
                                ? "text-lg font-semibold tabular-nums leading-tight text-danger"
                                : "text-lg font-semibold tabular-nums leading-tight text-foreground"
                            }
                          >
                            {formatNumber(item.snapshot.onHand, locale)}
                          </p>
                        </div>
                        <div className="min-w-0 rounded-xl bg-muted/30 px-2 py-1.5">
                          <p className="truncate">{t("minStock")}</p>
                          <p className="text-lg font-semibold tabular-nums leading-tight text-foreground">
                            {formatNumber(item.minStock, locale)}
                          </p>
                        </div>
                        <div className="min-w-0 rounded-xl bg-muted/30 px-2 py-1.5">
                          <p className="truncate">{t("onOrder")}</p>
                          <p className="text-lg font-semibold tabular-nums leading-tight text-foreground">
                            {formatNumber(item.snapshot.onOrder, locale)}
                          </p>
                        </div>
                      </div>
                      {showPlanning ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {t("suggestedOrder")}:{" "}
                          <span className="font-medium text-foreground">
                            {reorder
                              ? formatNumber(reorder.suggestedOrderQty, locale)
                              : t("planningUnavailable")}
                          </span>
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            }}
          />
          {inventoryQuery.isLoading ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : !storeId ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <EmptyIcon className="h-4 w-4" aria-hidden />
              {t("selectStoreHint")}
            </div>
          ) : inventoryTotal === 0 ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <EmptyIcon className="h-4 w-4" aria-hidden />
                {t("noInventory")}
              </div>
              {isAdmin ? (
                <Link href="/products/new" className="w-full sm:w-auto">
                  <Button className="w-full sm:w-auto">
                    <AddIcon className="h-4 w-4" aria-hidden />
                    {t("addProduct")}
                  </Button>
                </Link>
              ) : null}
            </div>
          ) : null}
          {inventoryQuery.error ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-danger">
              <span>{translateError(tErrors, inventoryQuery.error)}</span>
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => inventoryQuery.refetch()}
              >
                {tCommon("tryAgain")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Modal
        open={poDraftOpen}
        onOpenChange={(open) => {
          if (!open) {
            setPoDraftOpen(false);
          }
        }}
        title={t("createPoDrafts")}
        subtitle={t("createPoDraftsSubtitle")}
      >
        {reorderCandidates.length ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!storeId) {
                return;
              }
              const normalizedDraftItems = poDraftItems.map((item) => {
                const draftValue = poDraftQtyInputByKey[item.key];
                if (draftValue === undefined) {
                  return item;
                }
                return {
                  ...item,
                  qtyOrdered: resolveNumberInputOnBlur(draftValue, 0),
                };
              });
              setPoDraftItems(normalizedDraftItems);
              setPoDraftQtyInputByKey(
                Object.fromEntries(
                  normalizedDraftItems.map((item) => [item.key, String(item.qtyOrdered)]),
                ),
              );
              const selectedDraftItems = normalizedDraftItems.filter((item) => item.selected);
              if (!selectedDraftItems.length) {
                toast({ variant: "error", description: t("selectDraftItems") });
                return;
              }
              const missingSupplier = selectedDraftItems.find((item) => !item.supplierId);
              if (missingSupplier) {
                toast({ variant: "error", description: tErrors("supplierRequired") });
                return;
              }
              const payload = selectedDraftItems
                .filter((item) => item.qtyOrdered > 0)
                .map((item) => ({
                  productId: item.productId,
                  variantId: item.variantId ?? undefined,
                  qtyOrdered: item.qtyOrdered,
                  supplierId: item.supplierId ?? undefined,
                }));
              if (!payload.length) {
                toast({ variant: "error", description: t("selectDraftItems") });
                return;
              }
              createPoDraftMutation.mutate({
                storeId,
                idempotencyKey: crypto.randomUUID(),
                items: payload,
              });
            }}
          >
            <div className="space-y-3">
              {Array.from(groupedDraftItems.entries()).map(([supplierId, items]) => (
                <div key={supplierId} className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">
                    {supplierId === "unassigned"
                      ? t("supplierUnassigned")
                      : (supplierMap.get(supplierId) ?? t("supplierUnassigned"))}
                  </p>
                  {items.map((item) => (
                    <div
                      key={item.key}
                      className="space-y-2 rounded-xl border border-border/70 bg-card p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {item.productName}
                          </p>
                          <p className="text-xs text-muted-foreground">{item.variantName}</p>
                        </div>
                        <Switch
                          checked={item.selected}
                          onCheckedChange={(checked) =>
                            setPoDraftItems((prev) =>
                              prev.map((entry) =>
                                entry.key === item.key ? { ...entry, selected: checked } : entry,
                              ),
                            )
                          }
                        />
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <div className="text-xs text-muted-foreground">
                          {t("suggestedOrder")}
                          <div className="text-sm font-semibold text-foreground">
                            {formatNumber(item.suggestedQty, locale)}
                          </div>
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">{t("draftQty")}</label>
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            value={poDraftQtyInputByKey[item.key] ?? String(item.qtyOrdered)}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              setPoDraftQtyInputByKey((prev) => ({
                                ...prev,
                                [item.key]: nextValue,
                              }));
                              const parsedValue = parseNumberInput(nextValue);
                              if (parsedValue === null) {
                                return;
                              }
                              setPoDraftItems((prev) =>
                                prev.map((entry) =>
                                  entry.key === item.key
                                    ? {
                                        ...entry,
                                        qtyOrdered: parsedValue,
                                      }
                                    : entry,
                                ),
                              );
                            }}
                            onBlur={(event) => commitPoDraftQtyInput(item.key, event.target.value)}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">{t("supplier")}</label>
                          <Select
                            value={item.supplierId ?? ""}
                            onValueChange={(value) => {
                              setPoDraftItems((prev) =>
                                prev.map((entry) =>
                                  entry.key === item.key
                                    ? { ...entry, supplierId: value || null }
                                    : entry,
                                ),
                              );
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder={t("assignSupplier")} />
                            </SelectTrigger>
                            <SelectContent>
                              {suppliersQuery.data?.map((supplier) => (
                                <SelectItem key={supplier.id} value={supplier.id}>
                                  {supplier.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <FormActions>
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => setPoDraftOpen(false)}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                className="w-full sm:w-auto"
                disabled={createPoDraftMutation.isLoading}
              >
                {createPoDraftMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                {createPoDraftMutation.isLoading ? tCommon("loading") : t("createPoDraftsSubmit")}
              </Button>
            </FormActions>
          </form>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <EmptyIcon className="h-4 w-4" aria-hidden />
            {t("noReorderSuggestions")}
          </div>
        )}
      </Modal>

      <Modal
        open={printSetupOpen}
        onOpenChange={(open) => {
          if (!open) {
            setPrintSetupOpen(false);
          }
        }}
        title={t("printSetupRequiredTitle")}
        subtitle={t("printSetupRequiredSubtitle")}
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">
              {t("printSetupSelected", { count: selectedCount })}
            </p>
            <p className="mt-1">{t("printSetupBody")}</p>
          </div>
          <FormActions>
            <Button
              type="button"
              variant="secondary"
              className="w-full sm:w-auto"
              onClick={() => setPrintSetupOpen(false)}
            >
              {tCommon("cancel")}
            </Button>
            <Button type="button" className="w-full sm:w-auto" onClick={openPrintSettings}>
              <PrintIcon className="h-4 w-4" aria-hidden />
              {t("openPrintSettings")}
            </Button>
          </FormActions>
        </div>
      </Modal>

      {legacyInventoryPrintModalEnabled ? (
        <Modal
          open={legacyInventoryPrintModalOpen}
          onOpenChange={(open) => {
            if (!open) {
              setLegacyInventoryPrintModalOpen(false);
            }
          }}
          title={t("printPriceTags")}
          subtitle={t("printSubtitle", { count: selectedCount })}
        >
          <Form {...printForm}>
            <form
              className="space-y-4"
              onSubmit={printForm.handleSubmit((values) =>
                handleLegacyInventoryPrintTags(values, "download"),
              )}
            >
              <FormField
                control={printForm.control}
                name="template"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("template")}</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue placeholder={t("template")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ROLL_PRICE_TAG_TEMPLATE}>
                            {t("templateRollXp365b")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={printForm.control}
                name="storeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tCommon("store")}</FormLabel>
                    <FormControl>
                      <Select
                        value={field.value || "all"}
                        onValueChange={(value) => field.onChange(value === "all" ? "" : value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={tCommon("selectStore")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t("allStores")}</SelectItem>
                          {storesQuery.data?.map((store) => (
                            <SelectItem key={store.id} value={store.id}>
                              {store.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={printForm.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("printQty")}</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" inputMode="numeric" min={1} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {rollTemplateSelected ? (
                <div className="space-y-3 rounded-xl border border-border/70 bg-secondary/20 p-3">
                  <p className="text-xs font-medium text-foreground">
                    {t("rollTemplatePreviewTitle")}
                  </p>
                  <div className="w-[210px] max-w-full rounded-xl border border-border bg-card p-2">
                    <div className="aspect-[58/40] rounded-xl border border-dashed border-border/70 p-2">
                      <p className="line-clamp-2 text-[10px] font-medium text-foreground">
                        {rollPreviewItem?.product.name ?? t("rollPreviewName")}
                      </p>
                      <p className="mt-1 text-[11px] font-semibold text-foreground">
                        {t("rollPreviewPrice")}
                      </p>
                      {enableSku ? (
                        <p className="mt-1 text-[8px] text-muted-foreground">
                          {rollPreviewItem?.product.sku || t("rollPreviewSku")}
                        </p>
                      ) : null}
                      <div className="mt-1 h-4 rounded-xl bg-muted" />
                      <p className="mt-1 text-center text-[7px] text-muted-foreground">
                        {t("rollPreviewBarcode")}
                      </p>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{t("rollGapStoredHint")}</p>

                  <FormField
                    control={printForm.control}
                    name="gapMm"
                    render={({ field }) => (
                      <FormItem>
                        {(() => {
                          const resolvedGapMm = resolveNumberInputOnBlur(
                            field.value === undefined ? "" : String(field.value),
                            PRICE_TAG_ROLL_DEFAULTS.gapMm,
                          );
                          return (
                            <>
                              <FormLabel>{t("rollGapMm")}</FormLabel>
                              <FormControl>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="range"
                                    min={PRICE_TAG_ROLL_LIMITS.gapMm.min}
                                    max={PRICE_TAG_ROLL_LIMITS.gapMm.max}
                                    step={PRICE_TAG_ROLL_LIMITS.gapMm.step}
                                    value={resolvedGapMm}
                                    onChange={(event) => {
                                      const nextValue = event.currentTarget.valueAsNumber;
                                      if (Number.isFinite(nextValue)) {
                                        field.onChange(nextValue);
                                      }
                                    }}
                                    className="h-2 w-full cursor-pointer appearance-none rounded-xl bg-muted accent-primary"
                                    aria-label={t("rollGapMm")}
                                  />
                                  <Input
                                    value={toNumberInputValue(field.value)}
                                    onChange={(event) => field.onChange(event.target.value)}
                                    onBlur={(event) => {
                                      field.onChange(
                                        resolveNumberInputOnBlur(event.target.value, 0),
                                      );
                                      field.onBlur();
                                    }}
                                    type="number"
                                    className="w-20"
                                    min={PRICE_TAG_ROLL_LIMITS.gapMm.min}
                                    max={PRICE_TAG_ROLL_LIMITS.gapMm.max}
                                    step={PRICE_TAG_ROLL_LIMITS.gapMm.step}
                                  />
                                </div>
                              </FormControl>
                              <FormDescription>{t("rollGapHint")}</FormDescription>
                              <FormMessage />
                            </>
                          );
                        })()}
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={printForm.control}
                    name="xOffsetMm"
                    render={({ field }) => (
                      <FormItem>
                        {(() => {
                          const resolvedXOffset = resolveNumberInputOnBlur(
                            field.value === undefined ? "" : String(field.value),
                            PRICE_TAG_ROLL_DEFAULTS.xOffsetMm,
                          );
                          return (
                            <>
                              <FormLabel>{t("rollXOffsetMm")}</FormLabel>
                              <FormControl>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="range"
                                    min={PRICE_TAG_ROLL_LIMITS.offsetMm.min}
                                    max={PRICE_TAG_ROLL_LIMITS.offsetMm.max}
                                    step={PRICE_TAG_ROLL_LIMITS.offsetMm.step}
                                    value={resolvedXOffset}
                                    onChange={(event) => {
                                      const nextValue = event.currentTarget.valueAsNumber;
                                      if (Number.isFinite(nextValue)) {
                                        field.onChange(nextValue);
                                      }
                                    }}
                                    className="h-2 w-full cursor-pointer appearance-none rounded-xl bg-muted accent-primary"
                                    aria-label={t("rollXOffsetMm")}
                                  />
                                  <Input
                                    value={toNumberInputValue(field.value)}
                                    onChange={(event) => field.onChange(event.target.value)}
                                    onBlur={(event) => {
                                      field.onChange(
                                        resolveNumberInputOnBlur(event.target.value, 0),
                                      );
                                      field.onBlur();
                                    }}
                                    type="number"
                                    className="w-20"
                                    min={PRICE_TAG_ROLL_LIMITS.offsetMm.min}
                                    max={PRICE_TAG_ROLL_LIMITS.offsetMm.max}
                                    step={PRICE_TAG_ROLL_LIMITS.offsetMm.step}
                                  />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </>
                          );
                        })()}
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={printForm.control}
                    name="yOffsetMm"
                    render={({ field }) => (
                      <FormItem>
                        {(() => {
                          const resolvedYOffset = resolveNumberInputOnBlur(
                            field.value === undefined ? "" : String(field.value),
                            PRICE_TAG_ROLL_DEFAULTS.yOffsetMm,
                          );
                          return (
                            <>
                              <FormLabel>{t("rollYOffsetMm")}</FormLabel>
                              <FormControl>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="range"
                                    min={PRICE_TAG_ROLL_LIMITS.offsetMm.min}
                                    max={PRICE_TAG_ROLL_LIMITS.offsetMm.max}
                                    step={PRICE_TAG_ROLL_LIMITS.offsetMm.step}
                                    value={resolvedYOffset}
                                    onChange={(event) => {
                                      const nextValue = event.currentTarget.valueAsNumber;
                                      if (Number.isFinite(nextValue)) {
                                        field.onChange(nextValue);
                                      }
                                    }}
                                    className="h-2 w-full cursor-pointer appearance-none rounded-xl bg-muted accent-primary"
                                    aria-label={t("rollYOffsetMm")}
                                  />
                                  <Input
                                    value={toNumberInputValue(field.value)}
                                    onChange={(event) => field.onChange(event.target.value)}
                                    onBlur={(event) => {
                                      field.onChange(
                                        resolveNumberInputOnBlur(event.target.value, 0),
                                      );
                                      field.onBlur();
                                    }}
                                    type="number"
                                    className="w-20"
                                    min={PRICE_TAG_ROLL_LIMITS.offsetMm.min}
                                    max={PRICE_TAG_ROLL_LIMITS.offsetMm.max}
                                    step={PRICE_TAG_ROLL_LIMITS.offsetMm.step}
                                  />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </>
                          );
                        })()}
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={printForm.control}
                    name="allowWithoutBarcode"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card p-2">
                          <div>
                            <FormLabel>{t("printWithoutBarcode")}</FormLabel>
                            <FormDescription>{t("printWithoutBarcodeHint")}</FormDescription>
                          </div>
                          <FormControl>
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              ) : null}
              <FormActions>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full sm:w-auto"
                  onClick={() => setLegacyInventoryPrintModalOpen(false)}
                >
                  {tCommon("cancel")}
                </Button>
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  onClick={() => {
                    void printForm.handleSubmit((values) =>
                      handleLegacyInventoryPrintTags(values, "print"),
                    )();
                  }}
                >
                  <PrintIcon className="h-4 w-4" aria-hidden />
                  {t("printAction")}
                </Button>
                <Button type="submit" variant="secondary" className="w-full sm:w-auto">
                  <DownloadIcon className="h-4 w-4" aria-hidden />
                  {t("printDownload")}
                </Button>
              </FormActions>
            </form>
          </Form>
        </Modal>
      ) : null}

      <Modal
        open={activeDialog === "bulkOnHand"}
        onOpenChange={(open) => {
          if (!open && !bulkOnHandBusy) {
            setActiveDialog(null);
          }
        }}
        title={t("bulkOnHandTitle")}
        subtitle={t("bulkOnHandSubtitle", { count: selectedCount })}
      >
        <Form {...bulkOnHandForm}>
          <form
            className="space-y-4"
            onSubmit={bulkOnHandForm.handleSubmit(handleBulkOnHandSubmit)}
          >
            <FormGrid>
              <FormField
                control={bulkOnHandForm.control}
                name="targetOnHand"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("onHand")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        inputMode="numeric"
                        placeholder={t("qtyPlaceholder")}
                      />
                    </FormControl>
                    <FormDescription>{t("bulkOnHandHint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={bulkOnHandForm.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("reason")}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t("bulkOnHandReasonPlaceholder")} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGrid>
            {bulkOnHandProgress ? (
              <div className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                {t("bulkOnHandProgress", {
                  processed: bulkOnHandProgress.processed,
                  total: bulkOnHandProgress.total,
                })}
              </div>
            ) : null}
            <FormActions>
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => setActiveDialog(null)}
                disabled={bulkOnHandBusy}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                className="w-full sm:w-auto"
                disabled={bulkOnHandBusy || !storeId || selectedSnapshotIds.length === 0}
              >
                {bulkOnHandBusy ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <AdjustIcon className="h-4 w-4" aria-hidden />
                )}
                {bulkOnHandBusy
                  ? t("bulkOnHandProgressShort", {
                      processed: bulkOnHandProgress?.processed ?? 0,
                      total: bulkOnHandProgress?.total ?? selectedCount,
                    })
                  : t("bulkOnHandSubmit")}
              </Button>
            </FormActions>
          </form>
        </Form>
      </Modal>

      <Modal
        open={activeDialog === "adjust"}
        onOpenChange={(open) => {
          if (!open) {
            setActiveDialog(null);
          }
        }}
        title={t("stockAdjustment")}
        mobileSheet
      >
        <Form {...adjustForm}>
          <form
            className="space-y-4"
            onSubmit={adjustForm.handleSubmit((values) => {
              if (!storeId) {
                return;
              }
              adjustMutation.mutate({
                storeId,
                productId: values.productId,
                variantId: values.variantId ?? undefined,
                qtyDelta: values.qtyDelta,
                unitId: values.unitSelection === "BASE" ? adjustProduct?.baseUnitId : undefined,
                packId: values.unitSelection !== "BASE" ? values.unitSelection : undefined,
                reason: values.reason,
                expiryDate: values.expiryDate || undefined,
                idempotencyKey: crypto.randomUUID(),
              });
            })}
          >
            <FormGrid>
              <FormField
                control={adjustForm.control}
                name="productId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tCommon("product")}</FormLabel>
                    <FormControl>
                      <ProductSearchSelect
                        value={adjustSelectionKey}
                        options={productOptions}
                        search={adjustProductSearch}
                        onSearchChange={setAdjustProductSearch}
                        placeholder={t("productSearchPlaceholder")}
                        selectedLabel={t("selectedProduct")}
                        noResultsLabel={t("productSearchEmpty")}
                        loadingLabel={tCommon("loading")}
                        stockLabel={t("onHand")}
                        costLabel={t("unitCost")}
                        priceLabel={t("price")}
                        formatMoney={formatSelectedStoreMoney}
                        disabled={!storeId}
                        loading={adjustProductSearchQuery.isFetching}
                        onProductSelect={(option) => {
                          field.onChange(option.productId);
                          adjustForm.setValue("variantId", option.variantId, {
                            shouldValidate: true,
                          });
                          adjustForm.setValue("unitSelection", "BASE", { shouldValidate: true });
                        }}
                      />
                    </FormControl>
                    {!productOptions.length ? (
                      <FormDescription>{t("noInventory")}</FormDescription>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={adjustForm.control}
                name="qtyDelta"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("qtyDelta")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        inputMode="numeric"
                        placeholder={t("qtyPlaceholder")}
                      />
                    </FormControl>
                    {adjustProduct ? (
                      <FormDescription>
                        {(() => {
                          const baseQty = resolveBasePreview(
                            adjustProduct,
                            adjustUnitSelection,
                            adjustQty,
                          );
                          if (baseQty === null) {
                            return null;
                          }
                          return t("baseQtyPreview", {
                            qty: formatNumber(baseQty, locale),
                            unit: resolveUnitLabel(adjustProduct.baseUnit),
                          });
                        })()}
                      </FormDescription>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={adjustForm.control}
                name="unitSelection"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("unit")}</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={!adjustProduct}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t("unitPlaceholder")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {buildUnitOptions(adjustProduct, "inventory").map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {trackExpiryLots ? (
                <FormField
                  control={adjustForm.control}
                  name="expiryDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("expiryDate")}</FormLabel>
                      <FormControl>
                        <Input {...field} type="date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}
              <FormField
                control={adjustForm.control}
                name="reason"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>{t("reason")}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t("reasonPlaceholder")} />
                    </FormControl>
                    <FormDescription>{t("reasonHint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGrid>
            <FormActions>
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => setActiveDialog(null)}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                className="w-full sm:w-auto"
                disabled={adjustMutation.isLoading || !storeId || !adjustProductId}
              >
                {adjustMutation.isLoading ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <AdjustIcon className="h-4 w-4" aria-hidden />
                )}
                {adjustMutation.isLoading ? tCommon("loading") : t("adjustStock")}
              </Button>
            </FormActions>
          </form>
        </Form>
      </Modal>

      <Modal
        open={activeDialog === "transfer"}
        onOpenChange={(open) => {
          if (!open) {
            setActiveDialog(null);
          }
        }}
        title={t("transferStock")}
        mobileSheet
      >
        <Form {...transferForm}>
          <form
            className="space-y-4"
            onSubmit={transferForm.handleSubmit((values) => {
              const selectedProduct = transferProduct;
              transferMutation.mutate({
                fromStoreId: values.fromStoreId,
                toStoreId: values.toStoreId,
                productId: values.productId,
                variantId: values.variantId ?? undefined,
                qty: values.qty,
                unitId: values.unitSelection === "BASE" ? selectedProduct?.baseUnitId : undefined,
                packId: values.unitSelection !== "BASE" ? values.unitSelection : undefined,
                note: values.note?.trim() || undefined,
                expiryDate: values.expiryDate || undefined,
                idempotencyKey: crypto.randomUUID(),
              });
            })}
          >
            <FormGrid>
              <FormField
                control={transferForm.control}
                name="fromStoreId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fromStore")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={tCommon("selectStore")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {storesQuery.data?.map((store) => (
                          <SelectItem key={store.id} value={store.id}>
                            {store.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={transferForm.control}
                name="toStoreId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("toStore")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={tCommon("selectStore")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {storesQuery.data?.map((store) => (
                          <SelectItem key={store.id} value={store.id}>
                            {store.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={transferForm.control}
                name="productId"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>{tCommon("product")}</FormLabel>
                    <FormControl>
                      <ProductSearchSelect
                        value={transferSelectionKey}
                        options={productOptions}
                        search={transferProductSearch}
                        onSearchChange={setTransferProductSearch}
                        placeholder={t("productSearchPlaceholder")}
                        selectedLabel={t("selectedProduct")}
                        noResultsLabel={t("productSearchEmpty")}
                        loadingLabel={tCommon("loading")}
                        stockLabel={t("onHand")}
                        costLabel={t("unitCost")}
                        priceLabel={t("price")}
                        formatMoney={formatSelectedStoreMoney}
                        disabled={!storeId}
                        loading={transferProductSearchQuery.isFetching}
                        onProductSelect={(option) => {
                          field.onChange(option.productId);
                          transferForm.setValue("variantId", option.variantId, {
                            shouldValidate: true,
                          });
                          transferForm.setValue("unitSelection", "BASE", { shouldValidate: true });
                        }}
                      />
                    </FormControl>
                    {!productOptions.length ? (
                      <FormDescription>{t("noInventory")}</FormDescription>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={transferForm.control}
                name="qty"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("transferQty")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        inputMode="numeric"
                        placeholder={t("qtyPlaceholder")}
                      />
                    </FormControl>
                    {transferProduct ? (
                      <FormDescription>
                        {(() => {
                          const baseQty = resolveBasePreview(
                            transferProduct,
                            transferUnitSelection,
                            transferQty,
                          );
                          if (baseQty === null) {
                            return null;
                          }
                          return t("baseQtyPreview", {
                            qty: formatNumber(baseQty, locale),
                            unit: resolveUnitLabel(transferProduct.baseUnit),
                          });
                        })()}
                      </FormDescription>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={transferForm.control}
                name="unitSelection"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("unit")}</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={!transferProduct}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t("unitPlaceholder")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {buildUnitOptions(transferProduct, "inventory").map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {trackExpiryLots ? (
                <FormField
                  control={transferForm.control}
                  name="expiryDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("expiryDate")}</FormLabel>
                      <FormControl>
                        <Input {...field} type="date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}
              <FormField
                control={transferForm.control}
                name="note"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>{t("transferNote")}</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={3} placeholder={t("notePlaceholder")} />
                    </FormControl>
                    <FormDescription>{t("noteHint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGrid>
            <FormActions>
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => setActiveDialog(null)}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                className="w-full sm:w-auto"
                disabled={transferMutation.isLoading || !transferProductId}
              >
                {transferMutation.isLoading ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <TransferIcon className="h-4 w-4" aria-hidden />
                )}
                {transferMutation.isLoading ? tCommon("loading") : t("transferSubmit")}
              </Button>
            </FormActions>
          </form>
        </Form>
      </Modal>

      <Modal
        open={activeDialog === "minStock"}
        onOpenChange={(open) => {
          if (!open) {
            setActiveDialog(null);
          }
        }}
        title={t("minStockTitle")}
        mobileSheet
      >
        <Form {...minStockForm}>
          <form
            className="space-y-4"
            onSubmit={minStockForm.handleSubmit((values) => {
              if (!storeId) {
                return;
              }
              if (values.applyToAll) {
                defaultMinStockMutation.mutate({
                  storeId,
                  minStock: values.minStock,
                });
                return;
              }
              minStockMutation.mutate({
                storeId,
                productId: values.productId ?? "",
                minStock: values.minStock,
              });
            })}
          >
            <FormField
              control={minStockForm.control}
              name="applyToAll"
              render={({ field }) => (
                <FormItem className="flex items-start justify-between gap-4 rounded-xl border border-border p-4">
                  <div className="space-y-1">
                    <FormLabel>{t("minStockApplyAllLabel")}</FormLabel>
                    <FormDescription>{t("minStockApplyAllHint")}</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormGrid>
              <FormField
                control={minStockForm.control}
                name="productId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tCommon("product")}</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={minStockApplyToAll || !minStockOptions.length}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              minStockApplyToAll
                                ? t("minStockApplyAllLabel")
                                : tCommon("selectProduct")
                            }
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {minStockOptions.map((option) => (
                          <SelectItem key={option.productId} value={option.productId}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!minStockApplyToAll && !minStockOptions.length ? (
                      <FormDescription>{t("noInventory")}</FormDescription>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={minStockForm.control}
                name="minStock"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("minStock")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        inputMode="numeric"
                        placeholder={t("minStockPlaceholder")}
                      />
                    </FormControl>
                    <FormDescription>{t("minStockHint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGrid>
            <FormActions>
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => setActiveDialog(null)}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                className="w-full sm:w-auto"
                disabled={
                  minStockMutation.isLoading ||
                  defaultMinStockMutation.isLoading ||
                  !storeId ||
                  (!minStockApplyToAll && !minStockOptions.length)
                }
              >
                {minStockMutation.isLoading || defaultMinStockMutation.isLoading ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <StatusSuccessIcon className="h-4 w-4" aria-hidden />
                )}
                {minStockMutation.isLoading || defaultMinStockMutation.isLoading
                  ? tCommon("loading")
                  : t("minStockSave")}
              </Button>
            </FormActions>
          </form>
        </Form>
      </Modal>

      <Modal
        open={activeDialog === "movements"}
        onOpenChange={(open) => {
          if (!open) {
            setActiveDialog(null);
            setMovementTarget(null);
          }
        }}
        title={t("movementsTitle")}
        subtitle={movementTarget?.label}
        className="max-w-3xl"
      >
        {movementsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" />
            {tCommon("loading")}
          </div>
        ) : movementsQuery.error ? (
          <div className="flex flex-wrap items-center gap-3 text-sm text-danger">
            <span>{translateError(tErrors, movementsQuery.error)}</span>
            <Button
              type="button"
              variant="secondary"
              className="w-full sm:w-auto"
              onClick={() => movementsQuery.refetch()}
            >
              {tCommon("tryAgain")}
            </Button>
          </div>
        ) : movementsQuery.data?.length ? (
          <ResponsiveDataList
            items={movementsQuery.data}
            getKey={(movement) => movement.id}
            renderDesktop={(visibleItems) => (
              <div className="overflow-x-auto">
                <Table className="min-w-[520px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("movementDate")}</TableHead>
                      <TableHead>{t("movementTypeLabel")}</TableHead>
                      <TableHead>{t("movementQty")}</TableHead>
                      <TableHead className="hidden md:table-cell">{t("movementUser")}</TableHead>
                      <TableHead className="hidden md:table-cell">{t("movementNote")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleItems.map((movement) => (
                      <TableRow key={movement.id}>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDateTime(movement.createdAt, locale)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={movementBadgeVariant(movement.type)}>
                            {movementTypeLabel(movement.type)}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">
                          {movement.qtyDelta > 0 ? "+" : ""}
                          {formatNumber(movement.qtyDelta, locale)}
                        </TableCell>
                        <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                          {movement.createdBy?.name ??
                            movement.createdBy?.email ??
                            tCommon("notAvailable")}
                        </TableCell>
                        <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                          {formatMovementNote(t, movement.note) || tCommon("notAvailable")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            renderMobile={(movement) => (
              <div className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(movement.createdAt, locale)}
                    </p>
                    <div className="mt-1">
                      <Badge variant={movementBadgeVariant(movement.type)}>
                        {movementTypeLabel(movement.type)}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-sm font-semibold text-foreground">
                    {movement.qtyDelta > 0 ? "+" : ""}
                    {formatNumber(movement.qtyDelta, locale)}
                  </p>
                </div>
                <div className="mt-2 grid gap-2 text-xs text-muted-foreground">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                      {t("movementUser")}
                    </p>
                    <p className="text-foreground/90">
                      {movement.createdBy?.name ??
                        movement.createdBy?.email ??
                        tCommon("notAvailable")}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                      {t("movementNote")}
                    </p>
                    <p className="text-foreground/90">
                      {formatMovementNote(t, movement.note) || tCommon("notAvailable")}
                    </p>
                  </div>
                </div>
              </div>
            )}
          />
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <EmptyIcon className="h-4 w-4" aria-hidden />
            {t("noMovements")}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default InventoryPage;

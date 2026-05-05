"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { PageHeader } from "@/components/page-header";
import { ColumnVisibilityMenu } from "@/components/column-visibility-menu";
import { SavedTableViews } from "@/components/saved-table-views";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { SelectionToolbar } from "@/components/selection-toolbar";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { RowActions } from "@/components/row-actions";
import { InlineEditableCell, InlineEditTableProvider } from "@/components/table/InlineEditableCell";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { FormActions } from "@/components/form-layout";
import {
  AddIcon,
  ArchiveIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CopyIcon,
  DeleteIcon,
  DownloadIcon,
  EditIcon,
  EmptyIcon,
  GridViewIcon,
  MoreIcon,
  PriceIcon,
  PrintIcon,
  RestoreIcon,
  SparklesIcon,
  TableViewIcon,
  TagIcon,
  ViewIcon,
} from "@/components/icons";
import { downloadTableFile, parseCsvTextRows, type DownloadFormat } from "@/lib/fileExport";
import {
  buildBarcodeLabelPrintItems,
  hasPrintableBarcode,
  type BarcodePrintProduct,
} from "@/lib/barcodePrint";
import { downloadPdfBlob, fetchPdfBlob, printPdfBlob } from "@/lib/pdfClient";
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
import { normalizeCurrencyCode } from "@/lib/currency";
import { formatCurrency } from "@/lib/i18nFormat";
import { defaultLocale, normalizeLocale } from "@/lib/locales";
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
import {
  inlineEditRegistry,
  type InlineMutationOperation,
  type InlineProductsContext,
} from "@/lib/inlineEdit/registry";
import { useToast } from "@/components/ui/toast";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";

type ProductSortKey =
  | "sku"
  | "name"
  | "category"
  | "unit"
  | "onHandQty"
  | "salePrice"
  | "avgCost"
  | "barcodes"
  | "stores";

type ProductSortDirection = "asc" | "desc";
type ProductReadinessBadgeVariant = "muted" | "warning" | "danger";

const productTypeFilterSchema = z.enum(["all", "product", "bundle"]);
const productReadinessFilterSchema = z.enum([
  "all",
  "missingBarcode",
  "missingPrice",
  "lowStock",
  "negativeStock",
]);
const productViewModeSchema = z.enum(["table", "grid"]);
const productSortKeySchema = z.enum([
  "sku",
  "name",
  "category",
  "unit",
  "onHandQty",
  "salePrice",
  "avgCost",
  "barcodes",
  "stores",
]);
const productSortDirectionSchema = z.enum(["asc", "desc"]);
const productVisibleColumnSchema = z.enum([
  "sku",
  "image",
  "name",
  "category",
  "unit",
  "onHandQty",
  "salePrice",
  "avgCost",
  "barcodes",
  "readiness",
  "stores",
]);
const defaultProductVisibleColumns = [
  "image",
  "name",
  "onHandQty",
  "salePrice",
  "readiness",
] as const;
const productsTableStateSchema = z.object({
  search: z.string(),
  category: z.string(),
  productType: productTypeFilterSchema,
  readiness: productReadinessFilterSchema.optional().default("all"),
  storeId: z.string(),
  showArchived: z.boolean(),
  viewMode: productViewModeSchema,
  pageSize: z.number().int().min(1).max(200),
  sort: z.object({
    key: productSortKeySchema,
    direction: productSortDirectionSchema,
  }),
  visibleColumns: z
    .array(productVisibleColumnSchema)
    .optional()
    .default([...defaultProductVisibleColumns]),
});

const legacyProductsPrintModalEnabled = process.env.NODE_ENV !== "production";

const defaultSortDirectionByKey: Record<ProductSortKey, ProductSortDirection> = {
  sku: "asc",
  name: "asc",
  category: "asc",
  unit: "asc",
  onHandQty: "desc",
  salePrice: "desc",
  avgCost: "desc",
  barcodes: "asc",
  stores: "asc",
};

const aiArrangeCategoriesBatchSize = 25;
const bulkGenerateDescriptionsBatchSize = 25;
const customCategorySelectValue = "__custom__";
const clearCategorySelectValue = "__clear__";
const priceTagQuickQuantities = [1, 2, 3, 5] as const;

type AiArrangeCategoriesProgressState = {
  status: "running" | "done" | "error";
  totalCount: number;
  processedCount: number;
  scannedCount: number;
  eligibleCount: number;
  updatedCount: number;
  skippedCount: number;
  batchIndex: number;
  batchCount: number;
  startedAt: number;
  errorMessage: string | null;
};

type BulkDescriptionProgressState = {
  status: "running" | "done" | "rateLimited" | "error";
  totalCount: number;
  processedCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  deferredCount: number;
  batchIndex: number;
  batchCount: number;
  startedAt: number;
  errorMessage: string | null;
};

type ProductsTableState = z.infer<typeof productsTableStateSchema>;
type ProductVisibleColumnKey = z.infer<typeof productVisibleColumnSchema>;

const ProductsPage = () => {
  const t = useTranslations("products");
  const tInventory = useTranslations("inventory");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const role = session?.user?.role;
  const isAdmin = role === "ADMIN";
  const canManagePrices = role === "ADMIN" || role === "MANAGER";
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const trpcUtils = trpc.useUtils();
  const [productsPage, setProductsPage] = useState(1);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [categoryInputValue, setCategoryInputValue] = useState("");
  const [categoryToRemove, setCategoryToRemove] = useState("");
  const [bulkCategoryOpen, setBulkCategoryOpen] = useState(false);
  const [bulkCategoryMode, setBulkCategoryMode] = useState<"existing" | "custom" | "clear">(
    "existing",
  );
  const [bulkCategoryValue, setBulkCategoryValue] = useState("");
  const [bulkStorePriceOpen, setBulkStorePriceOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectingAllResults, setSelectingAllResults] = useState(false);
  const [arrangeCategoriesProgress, setArrangeCategoriesProgress] =
    useState<AiArrangeCategoriesProgressState | null>(null);
  const [arrangeCategoriesElapsedSeconds, setArrangeCategoriesElapsedSeconds] = useState(0);
  const [bulkDescriptionProgress, setBulkDescriptionProgress] =
    useState<BulkDescriptionProgressState | null>(null);
  const [bulkDescriptionElapsedSeconds, setBulkDescriptionElapsedSeconds] = useState(0);
  const [printSetupOpen, setPrintSetupOpen] = useState(false);
  const [quickPrintLoading, setQuickPrintLoading] = useState(false);
  // Dev-only fallback for the old all-in-one print modal. Normal product and inventory
  // actions must use the saved-profile quick print flow instead.
  const [legacyProductsPrintModalOpen, setLegacyProductsPrintModalOpen] = useState(false);
  const [printQueue, setPrintQueue] = useState<string[]>([]);
  const [printAdvancedOpen, setPrintAdvancedOpen] = useState(false);
  const inlineEditingEnabled = true;

  const defaultProductsTableState = useMemo<ProductsTableState>(
    () => ({
      search: "",
      category: "",
      productType: "all",
      readiness: "all",
      storeId: "",
      showArchived: false,
      viewMode: "table",
      pageSize: 25,
      sort: {
        key: "name",
        direction: "asc",
      },
      visibleColumns: [...defaultProductVisibleColumns],
    }),
    [],
  );
  const productsTableStorageKey = useMemo(
    () =>
      buildScopedStorageKey({
        prefix: "products-table-state",
        organizationId: session?.user?.organizationId,
        userId: session?.user?.id,
      }),
    [session?.user?.id, session?.user?.organizationId],
  );
  const parseProductsTableState = useCallback((raw: string) => {
    try {
      const parsed = productsTableStateSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }, []);
  const {
    value: productsTableState,
    setValue: setProductsTableState,
    isReady: productsTableStateReady,
    hasStoredValue: hasStoredProductsTableState,
  } = useScopedLocalStorageState({
    storageKey: productsTableStorageKey,
    defaultValue: defaultProductsTableState,
    parse: parseProductsTableState,
  });
  const defaultProductsSavedViewsState = useMemo(() => ({ views: [], defaultViewId: null }), []);
  const productsSavedViewsStorageKey = useMemo(
    () =>
      buildScopedStorageKey({
        prefix: "products-saved-views",
        organizationId: session?.user?.organizationId,
        userId: session?.user?.id,
      }),
    [session?.user?.id, session?.user?.organizationId],
  );
  const parseProductsSavedViews = useCallback(
    (raw: string) =>
      parseSavedTableViews(raw, (value) => {
        const parsed = productsTableStateSchema.safeParse(value);
        return parsed.success ? parsed.data : null;
      }),
    [],
  );
  const {
    value: productsSavedViewsState,
    setValue: setProductsSavedViewsState,
    isReady: productsSavedViewsReady,
  } = useScopedLocalStorageState({
    storageKey: productsSavedViewsStorageKey,
    defaultValue: defaultProductsSavedViewsState,
    parse: parseProductsSavedViews,
  });
  const search = productsTableState.search;
  const category = productsTableState.category;
  const productType = productsTableState.productType;
  const readiness = productsTableState.readiness;
  const rawStoreId = productsTableState.storeId;
  const showArchived = productsTableState.showArchived;
  const viewMode = productsTableState.viewMode;
  const productsPageSize = productsTableState.pageSize;
  const productSort = productsTableState.sort;
  const visibleProductColumns = productsTableState.visibleColumns;
  const readinessParam = searchParams.get("readiness");
  const setSearch = useCallback(
    (nextValue: string) =>
      setProductsTableState((current) => ({
        ...current,
        search: nextValue,
      })),
    [setProductsTableState],
  );
  const setCategory = useCallback(
    (nextValue: string) =>
      setProductsTableState((current) => ({
        ...current,
        category: nextValue,
      })),
    [setProductsTableState],
  );
  const setProductType = useCallback(
    (nextValue: "all" | "product" | "bundle") =>
      setProductsTableState((current) => ({
        ...current,
        productType: nextValue,
      })),
    [setProductsTableState],
  );
  const setReadiness = useCallback(
    (nextValue: z.infer<typeof productReadinessFilterSchema>) =>
      setProductsTableState((current) => ({
        ...current,
        readiness: nextValue,
      })),
    [setProductsTableState],
  );
  useEffect(() => {
    const parsed = productReadinessFilterSchema.safeParse(readinessParam);
    if (!parsed.success || readiness === parsed.data) {
      return;
    }
    setReadiness(parsed.data);
  }, [readiness, readinessParam, setReadiness]);
  const setStoreId = useCallback(
    (nextValue: string) =>
      setProductsTableState((current) => ({
        ...current,
        storeId: nextValue,
      })),
    [setProductsTableState],
  );
  const setShowArchived = useCallback(
    (nextValue: boolean) =>
      setProductsTableState((current) => ({
        ...current,
        showArchived: nextValue,
      })),
    [setProductsTableState],
  );
  const setViewMode = useCallback(
    (nextValue: "table" | "grid") =>
      setProductsTableState((current) => ({
        ...current,
        viewMode: nextValue,
      })),
    [setProductsTableState],
  );
  const setProductsPageSize = useCallback(
    (nextValue: number) =>
      setProductsTableState((current) => ({
        ...current,
        pageSize: nextValue,
      })),
    [setProductsTableState],
  );
  const toggleVisibleProductColumn = useCallback(
    (columnKey: ProductVisibleColumnKey) =>
      setProductsTableState((current) => ({
        ...current,
        visibleColumns: current.visibleColumns.includes(columnKey)
          ? current.visibleColumns.filter((value) => value !== columnKey)
          : [...current.visibleColumns, columnKey],
      })),
    [setProductsTableState],
  );
  const matchingProductsSavedView = useMemo(
    () => findMatchingSavedTableView(productsSavedViewsState.views, productsTableState),
    [productsSavedViewsState.views, productsTableState],
  );
  const productColumnOptions = useMemo(
    () => [
      { key: "sku", label: t("sku") },
      { key: "image", label: t("imageLabel") },
      { key: "name", label: t("name"), required: true },
      { key: "category", label: t("category") },
      { key: "unit", label: t("unit") },
      { key: "onHandQty", label: tInventory("onHand") },
      { key: "salePrice", label: t("salePrice") },
      { key: "avgCost", label: t("avgCost") },
      { key: "barcodes", label: t("barcodes") },
      { key: "readiness", label: t("readinessColumn") },
      { key: "stores", label: t("stores") },
    ],
    [t, tInventory],
  );
  const visibleProductColumnSet = useMemo(
    () => new Set<ProductVisibleColumnKey>(visibleProductColumns),
    [visibleProductColumns],
  );
  const productsBootstrapInput = useMemo(
    () => ({
      search: search || undefined,
      category: category || undefined,
      type: productType,
      includeArchived: isAdmin ? showArchived : undefined,
      readiness: readiness === "all" ? undefined : readiness,
      storeId: rawStoreId || undefined,
      page: productsPage,
      pageSize: productsPageSize,
      sortKey: productSort.key,
      sortDirection: productSort.direction,
    }),
    [
      category,
      isAdmin,
      productSort.direction,
      productSort.key,
      productType,
      readiness,
      productsPage,
      productsPageSize,
      search,
      showArchived,
      rawStoreId,
    ],
  );
  const productsBootstrapQuery = trpc.products.bootstrap.useQuery(productsBootstrapInput, {
    enabled: productsTableStateReady,
    keepPreviousData: true,
  });
  const storeId = rawStoreId || productsBootstrapQuery.data?.selectedStoreId || "";
  const stores = useMemo(
    () => productsBootstrapQuery.data?.stores ?? [],
    [productsBootstrapQuery.data?.stores],
  );
  const selectedStore = useMemo(
    () => stores.find((store) => store.id === storeId) ?? null,
    [storeId, stores],
  );
  const defaultPrintStoreId =
    storeId ||
    stores.find((store) => Boolean(store.printerSettings?.id))?.id ||
    (stores.length === 1 ? (stores[0]?.id ?? "") : "");
  const printPreviewStore = useMemo(
    () => stores.find((store) => store.id === defaultPrintStoreId) ?? selectedStore,
    [defaultPrintStoreId, selectedStore, stores],
  );
  const rollPreviewPriceText = printPreviewStore
    ? formatCurrency(0, locale, normalizeCurrencyCode(printPreviewStore.currencyCode))
    : t("rollPreviewPriceUnavailable");
  const printProfileQuery = trpc.stores.hardware.useQuery(
    { storeId: defaultPrintStoreId },
    { enabled: Boolean(defaultPrintStoreId) },
  );
  const printProfileSettings = printProfileQuery.data?.settings;
  const products = useMemo(
    () => productsBootstrapQuery.data?.list.items ?? [],
    [productsBootstrapQuery.data?.list.items],
  );
  const productsTotal = productsBootstrapQuery.data?.list.total ?? 0;
  const exportQuery = trpc.products.exportCsv.useQuery(
    { storeId: storeId || undefined },
    { enabled: false },
  );
  const archiveMutation = trpc.products.archive.useMutation({
    onSuccess: () => {
      productsBootstrapQuery.refetch();
      toast({ variant: "success", description: t("archiveSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const restoreMutation = trpc.products.restore.useMutation({
    onSuccess: () => {
      productsBootstrapQuery.refetch();
      toast({ variant: "success", description: t("restoreSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const bulkArchiveMutation = trpc.products.archive.useMutation();
  const bulkRestoreMutation = trpc.products.restore.useMutation();
  const inlineProductMutation = trpc.products.inlineUpdate.useMutation();
  const inlineCategoryMutation = trpc.products.bulkUpdateCategory.useMutation();
  const inlineStorePriceMutation = trpc.storePrices.upsert.useMutation();
  const inlineInventoryAdjustMutation = trpc.inventory.adjust.useMutation();

  const duplicateMutation = trpc.products.duplicate.useMutation({
    onSuccess: (result) => {
      productsBootstrapQuery.refetch();
      toast({
        variant: "success",
        description: result.copiedBarcodes
          ? t("duplicateSuccess")
          : t("duplicateSuccessNoBarcodes"),
      });
      router.push(`/products/${result.productId}`);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const bulkPriceMutation = trpc.storePrices.bulkUpdate.useMutation({
    onSuccess: (result) => {
      productsBootstrapQuery.refetch();
      toast({
        variant: "success",
        description: t("bulkPriceSuccess", { count: result.updated }),
      });
      setBulkOpen(false);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const createCategoryMutation = trpc.productCategories.create.useMutation({
    onSuccess: () => {
      productsBootstrapQuery.refetch();
      toast({ variant: "success", description: t("categoryCreateSuccess") });
      setCategoryInputValue("");
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const removeCategoryMutation = trpc.productCategories.remove.useMutation({
    onSuccess: (_result, input) => {
      productsBootstrapQuery.refetch();
      if (category === input.name) {
        setCategory("");
      }
      if (categoryToRemove === input.name) {
        setCategoryToRemove("");
      }
      toast({ variant: "success", description: t("categoryRemoveSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const bulkCategoryMutation = trpc.products.bulkUpdateCategory.useMutation({
    onSuccess: (result) => {
      productsBootstrapQuery.refetch();
      toast({
        variant: "success",
        description: t("bulkCategorySuccess", { count: result.updated }),
      });
      setBulkCategoryOpen(false);
      setSelectedIds(new Set());
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const arrangeCategoriesMutation = trpc.products.arrangeClothingCategories.useMutation();

  const bulkStorePriceMutation = trpc.storePrices.upsert.useMutation({
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const bulkGenerateBarcodesMutation = trpc.products.bulkGenerateBarcodes.useMutation({
    onSuccess: (result) => {
      productsBootstrapQuery.refetch();
      setSelectedIds(new Set());
      toast({
        variant: "success",
        description: t("bulkGenerateBarcodesSuccess", {
          generated: result.generatedCount,
          skipped: result.skippedCount,
        }),
      });
    },
    onError: (error) => {
      toast({
        variant: "error",
        description: translateError(tErrors, error),
      });
    },
  });
  const bulkGenerateDescriptionsMutation = trpc.products.bulkGenerateDescriptions.useMutation();

  useEffect(() => {
    if (!productsTableStateReady || !productsSavedViewsReady || hasStoredProductsTableState) {
      return;
    }
    const defaultView = productsSavedViewsState.views.find(
      (view) => view.id === productsSavedViewsState.defaultViewId,
    );
    if (!defaultView) {
      return;
    }
    setProductsTableState(defaultView.state);
  }, [
    hasStoredProductsTableState,
    productsSavedViewsReady,
    productsSavedViewsState.defaultViewId,
    productsSavedViewsState.views,
    productsTableStateReady,
    setProductsTableState,
  ]);

  useEffect(() => {
    if (!bulkCategoryOpen) {
      setBulkCategoryMode("existing");
      setBulkCategoryValue("");
    }
  }, [bulkCategoryOpen]);

  useEffect(() => {
    setProductsPage(1);
  }, [search, category, showArchived, storeId, productType]);

  useEffect(() => {
    setProductsPage(1);
  }, [productSort.direction, productSort.key]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [search, category, showArchived, storeId, productType]);

  useEffect(() => {
    if (!arrangeCategoriesProgress) {
      setArrangeCategoriesElapsedSeconds(0);
      return;
    }
    if (arrangeCategoriesProgress.status !== "running") {
      setArrangeCategoriesElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - arrangeCategoriesProgress.startedAt) / 1000)),
      );
      return;
    }
    const updateElapsed = () => {
      setArrangeCategoriesElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - arrangeCategoriesProgress.startedAt) / 1000)),
      );
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(timer);
  }, [arrangeCategoriesProgress]);

  useEffect(() => {
    if (!bulkDescriptionProgress) {
      setBulkDescriptionElapsedSeconds(0);
      return;
    }
    if (bulkDescriptionProgress.status !== "running") {
      setBulkDescriptionElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - bulkDescriptionProgress.startedAt) / 1000)),
      );
      return;
    }
    const updateElapsed = () => {
      setBulkDescriptionElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - bulkDescriptionProgress.startedAt) / 1000)),
      );
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(timer);
  }, [bulkDescriptionProgress]);

  const getProductCategories = useCallback(
    (product: { category?: string | null; categories?: string[] }) => {
      const seen = new Set<string>();
      const values = [
        ...(product.category ? [product.category] : []),
        ...(product.categories ?? []),
      ].filter((value): value is string => Boolean(value?.trim()));
      return values.filter((value) => {
        if (seen.has(value)) {
          return false;
        }
        seen.add(value);
        return true;
      });
    },
    [],
  );

  const categories = useMemo(() => {
    const set = new Set<string>();
    (productsBootstrapQuery.data?.categories ?? []).forEach((value) => {
      if (value) {
        set.add(value);
      }
    });
    products.forEach((product) => {
      for (const value of getProductCategories(product)) {
        set.add(value);
      }
    });
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
  }, [getProductCategories, products, productsBootstrapQuery.data?.categories]);

  useEffect(() => {
    if (!categoryManagerOpen) {
      setCategoryInputValue("");
      setCategoryToRemove("");
      return;
    }
    setCategoryToRemove((current) => (current && categories.includes(current) ? current : ""));
  }, [categories, categoryManagerOpen]);

  const showEffectivePrice = Boolean(storeId);
  const inlineProductsContext = useMemo<InlineProductsContext>(
    () => ({
      storeId: storeId || null,
      currencyCode: selectedStore?.currencyCode ?? null,
      currencyRateKgsPerUnit: selectedStore?.currencyRateKgsPerUnit ?? null,
      categories,
      stockAdjustReason: tInventory("stockAdjustment"),
    }),
    [
      categories,
      selectedStore?.currencyCode,
      selectedStore?.currencyRateKgsPerUnit,
      storeId,
      tInventory,
    ],
  );

  const applyProductListPatch = useCallback(
    (productId: string, patch: (item: ProductRow) => ProductRow) => {
      trpcUtils.products.bootstrap.setData(productsBootstrapInput, (current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          list: {
            ...current.list,
            items: current.list.items.map((item) => (item.id === productId ? patch(item) : item)),
          },
        };
      });
    },
    [productsBootstrapInput, trpcUtils.products.bootstrap],
  );

  const executeInlineProductMutation = useCallback(
    async (operation: InlineMutationOperation) => {
      const previous = trpcUtils.products.bootstrap.getData(productsBootstrapInput);
      const rollback = () => {
        trpcUtils.products.bootstrap.setData(productsBootstrapInput, previous);
      };

      if (operation.route === "products.inlineUpdate") {
        const patch = operation.input.patch;
        applyProductListPatch(operation.input.productId, (item) => {
          const nextBasePrice =
            patch.basePriceKgs !== undefined ? patch.basePriceKgs : item.basePriceKgs;
          return {
            ...item,
            name: patch.name ?? item.name,
            baseUnitId: patch.baseUnitId ?? item.baseUnitId,
            unit: item.unit,
            basePriceKgs: nextBasePrice,
            avgCostKgs: patch.avgCostKgs !== undefined ? patch.avgCostKgs : item.avgCostKgs,
            effectivePriceKgs: showEffectivePrice ? item.effectivePriceKgs : nextBasePrice,
          };
        });
        try {
          await inlineProductMutation.mutateAsync(operation.input);
        } catch (error) {
          rollback();
          throw error;
        }
        await trpcUtils.products.bootstrap.invalidate(productsBootstrapInput);
        return;
      }

      if (operation.route === "products.bulkUpdateCategory") {
        applyProductListPatch(operation.input.productIds[0], (item) => {
          const currentCategories = getProductCategories(item);
          const nextCategories = !operation.input.category
            ? []
            : operation.input.mode === "setPrimary"
              ? [
                  operation.input.category,
                  ...currentCategories.filter((value) => value !== operation.input.category),
                ]
              : operation.input.mode === "replace"
                ? [operation.input.category]
                : currentCategories.includes(operation.input.category)
                  ? currentCategories
                  : [...currentCategories, operation.input.category];
          return {
            ...item,
            category: nextCategories[0] ?? null,
            categories: nextCategories,
          };
        });
        try {
          await inlineCategoryMutation.mutateAsync(operation.input);
        } catch (error) {
          rollback();
          throw error;
        }
        await trpcUtils.products.bootstrap.invalidate(productsBootstrapInput);
        return;
      }

      if (operation.route === "storePrices.upsert") {
        applyProductListPatch(operation.input.productId, (item) => ({
          ...item,
          effectivePriceKgs: operation.input.priceKgs,
          priceOverridden: true,
        }));
        try {
          await inlineStorePriceMutation.mutateAsync(operation.input);
        } catch (error) {
          rollback();
          throw error;
        }
        await trpcUtils.products.bootstrap.invalidate(productsBootstrapInput);
        return;
      }

      if (operation.route === "inventory.adjust") {
        applyProductListPatch(operation.input.productId, (item) => ({
          ...item,
          onHandQty: item.onHandQty + operation.input.qtyDelta,
        }));
        try {
          await inlineInventoryAdjustMutation.mutateAsync(operation.input);
        } catch (error) {
          rollback();
          throw error;
        }
        await Promise.all([
          trpcUtils.products.bootstrap.invalidate(productsBootstrapInput),
          trpcUtils.inventory.list.invalidate(),
        ]);
        return;
      }

      throw new Error(`Unsupported inline operation: ${operation.route}`);
    },
    [
      applyProductListPatch,
      getProductCategories,
      inlineCategoryMutation,
      inlineInventoryAdjustMutation,
      inlineProductMutation,
      inlineStorePriceMutation,
      productsBootstrapInput,
      showEffectivePrice,
      trpcUtils.products.bootstrap,
      trpcUtils.inventory.list,
    ],
  );

  const bulkSchema = useMemo(
    () =>
      z.object({
        storeId: z.string().min(1, t("storeRequired")),
        search: z.string().optional(),
        category: z.string().optional(),
        mode: z.enum(["set", "increasePct", "increaseAbs"]),
        value: z.coerce.number(),
      }),
    [t],
  );

  const bulkForm = useForm<z.infer<typeof bulkSchema>>({
    resolver: zodResolver(bulkSchema),
    defaultValues: {
      storeId: storeId || "",
      search: "",
      category: "",
      mode: "set",
      value: 0,
    },
  });

  useEffect(() => {
    if (bulkOpen) {
      bulkForm.reset({
        storeId: storeId || "",
        search,
        category,
        mode: "set",
        value: 0,
      });
    }
  }, [bulkOpen, bulkForm, storeId, search, category]);

  const bulkValues = bulkForm.watch();
  const previewQuery = trpc.products.list.useQuery(
    {
      search: bulkValues.search || undefined,
      category: bulkValues.category || undefined,
      type: productType,
      includeArchived: isAdmin ? showArchived : undefined,
      page: 1,
      pageSize: 1,
    },
    { enabled: bulkOpen },
  );

  const printSchema = useMemo(
    () =>
      z.object({
        template: z.enum(PRICE_TAG_TEMPLATES),
        storeId: z.string().optional(),
        quantity: z.coerce.number().int().min(1, t("printQtyMin")),
        widthMm: z.coerce
          .number()
          .min(
            PRICE_TAG_ROLL_LIMITS.widthMm.min,
            t("rollWidthRange", {
              min: PRICE_TAG_ROLL_LIMITS.widthMm.min,
              max: PRICE_TAG_ROLL_LIMITS.widthMm.max,
            }),
          )
          .max(
            PRICE_TAG_ROLL_LIMITS.widthMm.max,
            t("rollWidthRange", {
              min: PRICE_TAG_ROLL_LIMITS.widthMm.min,
              max: PRICE_TAG_ROLL_LIMITS.widthMm.max,
            }),
          ),
        heightMm: z.coerce
          .number()
          .min(
            PRICE_TAG_ROLL_LIMITS.heightMm.min,
            t("rollHeightRange", {
              min: PRICE_TAG_ROLL_LIMITS.heightMm.min,
              max: PRICE_TAG_ROLL_LIMITS.heightMm.max,
            }),
          )
          .max(
            PRICE_TAG_ROLL_LIMITS.heightMm.max,
            t("rollHeightRange", {
              min: PRICE_TAG_ROLL_LIMITS.heightMm.min,
              max: PRICE_TAG_ROLL_LIMITS.heightMm.max,
            }),
          ),
        allowWithoutBarcode: z.boolean().default(false),
      }),
    [t],
  );

  const printForm = useForm<z.infer<typeof printSchema>>({
    resolver: zodResolver(printSchema),
    defaultValues: {
      template: ROLL_PRICE_TAG_TEMPLATE,
      storeId: defaultPrintStoreId,
      quantity: 1,
      widthMm: PRICE_TAG_ROLL_DEFAULTS.widthMm,
      heightMm: PRICE_TAG_ROLL_DEFAULTS.heightMm,
      allowWithoutBarcode: false,
    },
  });
  const printTemplate = printForm.watch("template");
  const printQuantity = printForm.watch("quantity");
  const allowWithoutBarcode = printForm.watch("allowWithoutBarcode");
  const rollWidthMm = printForm.watch("widthMm");
  const rollHeightMm = printForm.watch("heightMm");
  const resolvedPrintQuantity = Math.max(1, Number(printQuantity) || 1);
  const parsedRollWidthMm = Number(rollWidthMm);
  const parsedRollHeightMm = Number(rollHeightMm);
  const resolvedRollWidthMm = Number.isFinite(parsedRollWidthMm)
    ? parsedRollWidthMm
    : PRICE_TAG_ROLL_DEFAULTS.widthMm;
  const resolvedRollHeightMm = Number.isFinite(parsedRollHeightMm)
    ? parsedRollHeightMm
    : PRICE_TAG_ROLL_DEFAULTS.heightMm;
  const rollPreviewPaddingX = Math.min(40, (5 / Math.max(1, resolvedRollWidthMm)) * 100);
  const rollPreviewPaddingY = Math.min(40, (5 / Math.max(1, resolvedRollHeightMm)) * 100);
  const rollTemplateSelected = isRollPriceTagTemplate(printTemplate);

  const bulkStorePriceSchema = useMemo(
    () =>
      z.object({
        storeId: z.string().min(1, tErrors("storeRequired")),
        priceKgs: z.coerce.number().min(0, t("priceNonNegative")),
      }),
    [t, tErrors],
  );

  const bulkStorePriceForm = useForm<z.infer<typeof bulkStorePriceSchema>>({
    resolver: zodResolver(bulkStorePriceSchema),
    defaultValues: {
      storeId: storeId || "",
      priceKgs: 0,
    },
  });

  const selectedList = useMemo(() => Array.from(selectedIds), [selectedIds]);
  const allSelected =
    Boolean(products.length) && products.every((product) => selectedIds.has(product.id));
  const allResultsSelected = productsTotal > 0 && selectedIds.size === productsTotal;
  const arrangeCategoriesProgressPercent = arrangeCategoriesProgress
    ? Math.round(
        (arrangeCategoriesProgress.processedCount /
          Math.max(1, arrangeCategoriesProgress.totalCount)) *
          100,
      )
    : 0;
  const arrangeCategoriesRunning = arrangeCategoriesProgress?.status === "running";
  const bulkDescriptionProgressPercent = bulkDescriptionProgress
    ? Math.round(
        (bulkDescriptionProgress.processedCount / Math.max(1, bulkDescriptionProgress.totalCount)) *
          100,
      )
    : 0;
  const bulkDescriptionRunning = bulkDescriptionProgress?.status === "running";

  const queueIdsForQuery = useMemo(() => Array.from(new Set(printQueue)).sort(), [printQueue]);
  const queueProductsQuery = trpc.products.byIds.useQuery(
    { ids: queueIdsForQuery },
    { enabled: legacyProductsPrintModalOpen && queueIdsForQuery.length > 0 },
  );
  type QueueProductLite = {
    id: string;
    name: string;
    sku: string;
    isDeleted: boolean;
    barcodes: { value: string }[];
  };
  const productById = useMemo(() => {
    const map = new Map<string, QueueProductLite>();
    products.forEach((product) => {
      map.set(product.id, {
        id: product.id,
        name: product.name,
        sku: product.sku,
        isDeleted: product.isDeleted,
        barcodes: product.barcodes,
      });
    });
    (queueProductsQuery.data ?? []).forEach((product) => {
      map.set(product.id, product);
    });
    return map;
  }, [products, queueProductsQuery.data]);
  const rollPreviewProduct = useMemo(() => {
    const firstId = printQueue[0];
    return firstId ? (productById.get(firstId) ?? null) : null;
  }, [printQueue, productById]);
  const queueMissingBarcodeCount = useMemo(() => {
    if (!rollTemplateSelected) {
      return 0;
    }
    return printQueue.reduce((count, productId) => {
      const product = productById.get(productId);
      if (!product) {
        return count;
      }
      const hasBarcode = Boolean(product?.barcodes.some((entry) => entry.value.trim()));
      return hasBarcode ? count : count + 1;
    }, 0);
  }, [printQueue, productById, rollTemplateSelected]);
  const printLabelCount = printQueue.length * resolvedPrintQuantity;
  const printRequiresBarcodeConfirmation =
    rollTemplateSelected && queueMissingBarcodeCount > 0 && !allowWithoutBarcode;
  const selectedProducts = useMemo(
    () => products.filter((product) => selectedIds.has(product.id)),
    [products, selectedIds],
  );
  const hasActiveSelected = selectedProducts.some((product) => !product.isDeleted);
  const hasArchivedSelected = selectedProducts.some((product) => product.isDeleted);
  const bulkCategorySelectValue =
    bulkCategoryMode === "custom"
      ? customCategorySelectValue
      : bulkCategoryMode === "clear"
        ? clearCategorySelectValue
        : bulkCategoryValue || undefined;
  const bulkCategoryCanSubmit =
    bulkCategoryMode === "clear" ||
    (bulkCategoryMode === "custom"
      ? Boolean(bulkCategoryValue.trim())
      : Boolean(bulkCategoryValue));

  const toggleSelectAll = () => {
    if (!products.length) {
      return;
    }
    setSelectedIds(() => {
      if (allSelected) {
        return new Set();
      }
      return new Set(products.map((product) => product.id));
    });
  };

  const handleSelectAllResults = async () => {
    setSelectingAllResults(true);
    try {
      const ids = await trpcUtils.products.listIds.fetch({
        search: search || undefined,
        category: category || undefined,
        type: productType,
        includeArchived: isAdmin ? showArchived : undefined,
        storeId: storeId || undefined,
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

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const applyProductsSavedView = useCallback(
    (viewId: string) => {
      const view = productsSavedViewsState.views.find((item) => item.id === viewId);
      if (!view) {
        return;
      }
      setProductsTableState(view.state);
      setProductsPage(1);
      setSelectedIds(new Set());
    },
    [productsSavedViewsState.views, setProductsTableState],
  );

  const saveProductsView = useCallback(
    (name: string) => {
      setProductsSavedViewsState((current) => ({
        ...current,
        views: [...current.views, createSavedTableView({ name, state: productsTableState })],
      }));
    },
    [productsTableState, setProductsSavedViewsState],
  );

  const renameProductsView = useCallback(
    (viewId: string, nextName: string) => {
      setProductsSavedViewsState((current) => ({
        ...current,
        views: current.views.map((view) =>
          view.id === viewId ? renameSavedTableView(view, nextName) : view,
        ),
      }));
    },
    [setProductsSavedViewsState],
  );

  const overwriteProductsView = useCallback(
    (viewId: string) => {
      setProductsSavedViewsState((current) => ({
        ...current,
        views: current.views.map((view) =>
          view.id === viewId ? overwriteSavedTableView(view, productsTableState) : view,
        ),
      }));
    },
    [productsTableState, setProductsSavedViewsState],
  );

  const deleteProductsView = useCallback(
    (viewId: string) => {
      setProductsSavedViewsState((current) => ({
        views: current.views.filter((view) => view.id !== viewId),
        defaultViewId: current.defaultViewId === viewId ? null : current.defaultViewId,
      }));
    },
    [setProductsSavedViewsState],
  );

  const setDefaultProductsView = useCallback(
    (viewId: string | null) => {
      setProductsSavedViewsState((current) => ({
        ...current,
        defaultViewId: viewId && current.views.some((view) => view.id === viewId) ? viewId : null,
      }));
    },
    [setProductsSavedViewsState],
  );

  useEffect(() => {
    if (legacyProductsPrintModalOpen) {
      setPrintAdvancedOpen(false);
      setPrintQueue((current) => (current.length ? current : selectedList));
    } else {
      setPrintQueue([]);
    }
  }, [legacyProductsPrintModalOpen, selectedList]);

  useEffect(() => {
    if (!legacyProductsPrintModalEnabled) {
      return;
    }
    const target = window as typeof window & {
      __seedLegacyProductsPrintModalQueue?: (count?: number) => void;
    };
    target.__seedLegacyProductsPrintModalQueue = (count = 500) => {
      const ids = products.slice(0, count).map((product) => product.id);
      setSelectedIds(new Set(ids));
      setPrintQueue(ids);
      setLegacyProductsPrintModalOpen(true);
    };
    return () => {
      delete target.__seedLegacyProductsPrintModalQueue;
    };
  }, [products]);

  useEffect(() => {
    if (!rollTemplateSelected || queueMissingBarcodeCount > 0) {
      return;
    }
    printForm.setValue("allowWithoutBarcode", false);
  }, [printForm, queueMissingBarcodeCount, rollTemplateSelected]);

  useEffect(() => {
    if (bulkStorePriceOpen) {
      bulkStorePriceForm.reset({
        storeId: storeId || "",
        priceKgs: 0,
      });
    }
  }, [bulkStorePriceOpen, bulkStorePriceForm, storeId]);

  const storeNameById = useMemo(
    () => new Map(stores.map((store) => [store.id, store.name])),
    [stores],
  );
  const totalStores = stores.length;
  const getBarcodeSummary = (barcodes: { value: string }[]) => {
    const values = barcodes.map((barcode) => barcode.value).filter(Boolean);
    if (!values.length) {
      return { label: tCommon("notAvailable"), values };
    }
    if (values.length === 1) {
      return { label: values[0], values };
    }
    return { label: t("barcodesCount", { count: values.length }), values };
  };
  const getStoreInfo = (storeIds: string[]) => {
    const uniqueIds = Array.from(new Set(storeIds));
    const names = uniqueIds
      .map((storeId) => storeNameById.get(storeId))
      .filter((name): name is string => Boolean(name))
      .sort((a, b) => a.localeCompare(b));
    const count = uniqueIds.length;
    const summary =
      totalStores > 0 && count === totalStores
        ? t("allStores")
        : count > 0
          ? t("storesCount", { count })
          : tCommon("notAvailable");
    return { summary, names };
  };

  const getProductPreviewUrl = (product: {
    photoUrl?: string | null;
    images?: { url: string }[];
  }) => product.images?.[0]?.url ?? product.photoUrl ?? null;
  type ProductRow = NonNullable<typeof products>[number];
  const getProductReadiness = (product: ProductRow) => {
    const price = showEffectivePrice ? product.effectivePriceKgs : product.basePriceKgs;
    return {
      missingBarcode: !product.barcodes.some((barcode) => barcode.value.trim()),
      missingPrice: price === null || price === undefined,
      negativeStock: product.onHandQty < 0,
      lowStock: product.onHandQty <= 0,
    };
  };
  const getProductReadinessSummary = (
    readinessState: ReturnType<typeof getProductReadiness>,
  ): { label: string; variant: ProductReadinessBadgeVariant } => {
    if (readinessState.negativeStock) {
      return { label: t("negativeStock"), variant: "danger" };
    }
    if (readinessState.missingPrice) {
      return { label: t("missingPrice"), variant: "danger" };
    }
    if (readinessState.missingBarcode) {
      return { label: t("missingBarcode"), variant: "warning" };
    }
    if (readinessState.lowStock) {
      return { label: t("missingStock"), variant: "warning" };
    }
    return { label: t("readyForSale"), variant: "muted" };
  };
  const sortCollator = useMemo(
    () =>
      new Intl.Collator(locale, {
        numeric: true,
        sensitivity: "base",
      }),
    [locale],
  );
  const resolveSalePriceForSort = useCallback(
    (product: ProductRow) => {
      const value = showEffectivePrice ? product.effectivePriceKgs : product.basePriceKgs;
      return value ?? Number.NEGATIVE_INFINITY;
    },
    [showEffectivePrice],
  );
  const resolveBarcodeSortValue = useCallback(
    (product: ProductRow) => {
      const values = product.barcodes
        .map((entry) => entry.value.trim())
        .filter(Boolean)
        .sort((left, right) => sortCollator.compare(left, right));
      return values.join(", ");
    },
    [sortCollator],
  );
  const resolveStoreSortValue = useCallback(
    (product: ProductRow) => {
      const names = Array.from(
        new Set(
          product.inventorySnapshots
            .map((snapshot) => storeNameById.get(snapshot.storeId))
            .filter((name): name is string => Boolean(name)),
        ),
      ).sort((left, right) => sortCollator.compare(left, right));
      return names.join(", ");
    },
    [sortCollator, storeNameById],
  );
  const sortedProducts = useMemo(() => {
    const directionMultiplier = productSort.direction === "asc" ? 1 : -1;
    const sorted = [...products];
    sorted.sort((left, right) => {
      let result = 0;
      switch (productSort.key) {
        case "sku":
          result = sortCollator.compare(left.sku, right.sku);
          break;
        case "name":
          result = sortCollator.compare(left.name, right.name);
          break;
        case "category":
          result = sortCollator.compare(left.category ?? "", right.category ?? "");
          break;
        case "unit":
          result = sortCollator.compare(left.unit ?? "", right.unit ?? "");
          break;
        case "onHandQty":
          result = left.onHandQty - right.onHandQty;
          break;
        case "salePrice":
          result = resolveSalePriceForSort(left) - resolveSalePriceForSort(right);
          break;
        case "avgCost":
          result =
            (left.avgCostKgs ?? Number.NEGATIVE_INFINITY) -
            (right.avgCostKgs ?? Number.NEGATIVE_INFINITY);
          break;
        case "barcodes":
          result = sortCollator.compare(
            resolveBarcodeSortValue(left),
            resolveBarcodeSortValue(right),
          );
          break;
        case "stores":
          result = sortCollator.compare(resolveStoreSortValue(left), resolveStoreSortValue(right));
          break;
        default:
          result = 0;
      }

      if (result === 0) {
        result = sortCollator.compare(left.name, right.name);
      }
      if (result === 0) {
        result = sortCollator.compare(left.sku, right.sku);
      }
      if (result === 0) {
        result = left.id.localeCompare(right.id);
      }

      return result * directionMultiplier;
    });
    return sorted;
  }, [
    productSort.direction,
    productSort.key,
    products,
    resolveBarcodeSortValue,
    resolveSalePriceForSort,
    resolveStoreSortValue,
    sortCollator,
  ]);
  const toggleProductSort = useCallback(
    (key: ProductSortKey) => {
      setProductsTableState((current) => ({
        ...current,
        sort:
          current.sort.key === key
            ? {
                key,
                direction: current.sort.direction === "asc" ? "desc" : "asc",
              }
            : {
                key,
                direction: defaultSortDirectionByKey[key],
              },
      }));
    },
    [setProductsTableState],
  );
  const renderSortableHead = (key: ProductSortKey, label: string, className?: string) => (
    <TableHead
      className={className}
      aria-sort={
        productSort.key === key
          ? productSort.direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <button
        type="button"
        className="inline-flex items-center gap-1 text-left"
        onClick={() => toggleProductSort(key)}
      >
        <span>{label}</span>
        {productSort.key === key ? (
          productSort.direction === "asc" ? (
            <ArrowUpIcon className="h-3 w-3 text-foreground" aria-hidden />
          ) : (
            <ArrowDownIcon className="h-3 w-3 text-foreground" aria-hidden />
          )
        ) : (
          <ArrowDownIcon className="h-3 w-3 text-muted-foreground/60" aria-hidden />
        )}
      </button>
    </TableHead>
  );

  const buildSavedPrintValues = useCallback(
    (quantity?: number): z.infer<typeof printSchema> =>
      buildSavedLabelPrintValues({
        settings: printProfileSettings,
        storeId: defaultPrintStoreId,
        quantity,
      }),
    [defaultPrintStoreId, printProfileSettings],
  );

  const openPrintSettings = useCallback(() => {
    if (defaultPrintStoreId) {
      router.push(`/stores/${defaultPrintStoreId}/hardware`);
      return;
    }
    router.push("/settings/printing");
  }, [defaultPrintStoreId, router]);

  const performPrintTags = useCallback(
    async (queue: string[], values: z.infer<typeof printSchema>, mode: "download" | "print") => {
      if (!queue.length) {
        return false;
      }
      try {
        const settings = printProfileSettings;
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
                    widthMm: values.widthMm,
                    heightMm: values.heightMm,
                    gapMm: settings?.labelRollGapMm,
                    xOffsetMm: settings?.labelRollXOffsetMm,
                    yOffsetMm: settings?.labelRollYOffsetMm,
                  }
                : undefined,
              display: settings
                ? {
                    showProductName: settings.labelShowProductName,
                    showPrice: settings.labelShowPrice,
                    showSku: settings.labelShowSku,
                    showStoreName: settings.labelShowStoreName,
                  }
                : undefined,
              items: buildBarcodeLabelPrintItems({
                productIds: queue,
                quantity: values.quantity,
              }),
            }),
          },
        });
        const fileName = `price-tags-${values.template}.pdf`;
        if (mode === "print") {
          const result = await printPdfBlob(blob);
          if (!result.autoPrintAttempted) {
            toast({ variant: "info", description: t("printFallback") });
          }
        } else {
          downloadPdfBlob(blob, fileName);
        }
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message === tErrors("priceTagsBarcodeConfirmationRequired")) {
          toast({ variant: "error", description: t("printMissingBarcode") });
          return false;
        }
        if (message && message !== "pdfRequestFailed" && message !== "pdfContentTypeInvalid") {
          toast({ variant: "error", description: message });
          return false;
        }
        toast({ variant: "error", description: t("priceTagsFailed") });
        return false;
      }
    },
    [printProfileSettings, t, tErrors, toast],
  );

  const openPrintForProducts = useCallback(
    async (ids: string[], quantity?: number, options?: { settings?: boolean }) => {
      if (options?.settings) {
        openPrintSettings();
        return;
      }
      if (quickPrintLoading) {
        return;
      }
      const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
      if (!uniqueIds.length) {
        toast({ variant: "error", description: t("printNoPrintableProducts") });
        return;
      }
      const savedValues = buildSavedPrintValues(quantity);
      printForm.reset(savedValues);
      setPrintQueue(uniqueIds);
      const action = resolveLabelPrintFlowAction({
        settings: printProfileSettings,
        storeId: defaultPrintStoreId,
        isLoading: printProfileQuery.isLoading,
      });
      if (action === "openSettings") {
        openPrintSettings();
        return;
      }
      if (action === "setupRequired") {
        setPrintSetupOpen(true);
        return;
      }
      if (action === "loading") {
        toast({ variant: "info", description: t("printProfileLoading") });
        return;
      }
      setQuickPrintLoading(true);
      try {
        const productsForPrint = await trpcUtils.products.byIds.fetch({ ids: uniqueIds });
        const activeProducts = productsForPrint.filter((product) => !product.isDeleted);
        const activeIds = activeProducts.map((product) => product.id);
        const missingBarcodeCount = activeProducts.filter(
          (product) => !hasPrintableBarcode(product as BarcodePrintProduct),
        ).length;
        if (missingBarcodeCount > 0) {
          toast({
            variant: "error",
            description: t("printMissingBarcodeCount", { count: missingBarcodeCount }),
          });
          return;
        }
        if (!activeIds.length) {
          toast({ variant: "error", description: t("printNoPrintableProducts") });
          return;
        }
        setPrintQueue(activeIds);
        const ok = await performPrintTags(activeIds, savedValues, "print");
        if (ok) {
          toast({
            variant: "success",
            description: t("printQueued", { count: activeIds.length }),
            actionLabel: t("changePrintSettings"),
            actionHref: defaultPrintStoreId
              ? `/stores/${defaultPrintStoreId}/hardware`
              : "/settings/printing",
          });
          setSelectedIds(new Set());
          setPrintQueue([]);
        }
      } catch (error) {
        toast({
          variant: "error",
          description: error instanceof Error ? error.message : t("priceTagsFailed"),
        });
      } finally {
        setQuickPrintLoading(false);
      }
    },
    [
      buildSavedPrintValues,
      defaultPrintStoreId,
      performPrintTags,
      printForm,
      printProfileSettings,
      printProfileQuery.isLoading,
      quickPrintLoading,
      openPrintSettings,
      t,
      toast,
      trpcUtils.products.byIds,
    ],
  );
  const getProductActions = (product: ProductRow) => [
    ...(isAdmin
      ? product.isDeleted
        ? [
            {
              key: "restore",
              label: t("restore"),
              icon: RestoreIcon,
              onSelect: async () => {
                if (
                  !(await confirm({ description: t("confirmRestore"), confirmVariant: "danger" }))
                ) {
                  return;
                }
                restoreMutation.mutate({ productId: product.id });
              },
            },
          ]
        : [
            {
              key: "edit",
              label: tCommon("edit"),
              icon: EditIcon,
              href: `/products/${product.id}`,
              openInNewTab: true,
            },
            {
              key: "print-labels",
              label: t("printLabels"),
              icon: PrintIcon,
              onSelect: () => {
                if (!hasPrintableBarcode(product as BarcodePrintProduct)) {
                  toast({ variant: "error", description: t("printMissingBarcode") });
                  return;
                }
                void openPrintForProducts([product.id]);
              },
            },
            {
              key: "duplicate",
              label: t("duplicate"),
              icon: CopyIcon,
              onSelect: () =>
                duplicateMutation.mutate({
                  productId: product.id,
                }),
            },
            {
              key: "archive",
              label: tCommon("archive"),
              icon: ArchiveIcon,
              variant: "danger",
              onSelect: async () => {
                if (
                  !(await confirm({ description: t("confirmArchive"), confirmVariant: "danger" }))
                ) {
                  return;
                }
                archiveMutation.mutate({ productId: product.id });
              },
            },
          ]
      : [
          {
            key: "view",
            label: tCommon("view"),
            icon: ViewIcon,
            href: `/products/${product.id}`,
            openInNewTab: false,
          },
        ]),
  ];

  const handleExport = async (format: DownloadFormat) => {
    const { data, error } = await exportQuery.refetch();
    if (error) {
      toast({ variant: "error", description: translateError(tErrors, error) });
      return;
    }
    if (!data) {
      return;
    }
    const rows = parseCsvTextRows(data);
    const [header, ...body] = rows;
    if (!header) {
      return;
    }
    downloadTableFile({
      format,
      fileNameBase: `products-${locale}`,
      header,
      rows: body,
    });
  };

  const handlePrintTags = async (
    values: z.infer<typeof printSchema>,
    mode: "download" | "print",
  ) => {
    const queue = printQueue;
    const ok = await performPrintTags(queue, values, mode);
    if (ok) {
      setLegacyProductsPrintModalOpen(false);
      setSelectedIds(new Set());
      setPrintQueue([]);
    }
  };

  const handleBulkArchive = async () => {
    if (!selectedList.length || !hasActiveSelected) {
      return;
    }
    if (!(await confirm({ description: t("confirmBulkArchive"), confirmVariant: "danger" }))) {
      return;
    }
    const targets = selectedProducts.filter((product) => !product.isDeleted);
    try {
      await Promise.all(
        targets.map((product) => bulkArchiveMutation.mutateAsync({ productId: product.id })),
      );
      productsBootstrapQuery.refetch();
      toast({
        variant: "success",
        description: t("bulkArchiveSuccess", { count: targets.length }),
      });
      setSelectedIds(new Set());
    } catch (error) {
      toast({
        variant: "error",
        description: translateError(tErrors, error as Parameters<typeof translateError>[1]),
      });
    }
  };

  const handleBulkRestore = async () => {
    if (!selectedList.length || !hasArchivedSelected) {
      return;
    }
    if (!(await confirm({ description: t("confirmBulkRestore"), confirmVariant: "danger" }))) {
      return;
    }
    const targets = selectedProducts.filter((product) => product.isDeleted);
    try {
      await Promise.all(
        targets.map((product) => bulkRestoreMutation.mutateAsync({ productId: product.id })),
      );
      productsBootstrapQuery.refetch();
      toast({
        variant: "success",
        description: t("bulkRestoreSuccess", { count: targets.length }),
      });
      setSelectedIds(new Set());
    } catch (error) {
      toast({
        variant: "error",
        description: translateError(tErrors, error as Parameters<typeof translateError>[1]),
      });
    }
  };

  const handleBulkCategoryApply = () => {
    if (!selectedList.length) {
      return;
    }
    if (bulkCategoryMode === "clear") {
      bulkCategoryMutation.mutate({
        productIds: selectedList,
        category: null,
        mode: "replace",
      });
      return;
    }
    const trimmed = bulkCategoryValue.trim();
    if (!trimmed) {
      return;
    }
    bulkCategoryMutation.mutate({
      productIds: selectedList,
      category: trimmed,
      mode: "add",
    });
  };

  const handleArrangeCategoriesWithAi = async () => {
    if (!isAdmin || arrangeCategoriesRunning) {
      return;
    }
    const targetIds = selectedList.length ? selectedList : products.map((product) => product.id);
    if (!targetIds.length) {
      toast({ variant: "info", description: t("aiArrangeCategoriesEmpty") });
      return;
    }
    if (
      !(await confirm({
        description: t("aiArrangeCategoriesConfirm", { count: targetIds.length }),
        confirmVariant: "primary",
      }))
    ) {
      return;
    }

    const chunks: string[][] = [];
    for (let index = 0; index < targetIds.length; index += aiArrangeCategoriesBatchSize) {
      chunks.push(targetIds.slice(index, index + aiArrangeCategoriesBatchSize));
    }

    const summary = {
      processedCount: 0,
      scannedCount: 0,
      eligibleCount: 0,
      updatedCount: 0,
      skippedCount: 0,
    };

    setArrangeCategoriesProgress({
      status: "running",
      totalCount: targetIds.length,
      processedCount: 0,
      scannedCount: 0,
      eligibleCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      batchIndex: 0,
      batchCount: chunks.length,
      startedAt: Date.now(),
      errorMessage: null,
    });

    try {
      for (const [batchIndex, chunk] of chunks.entries()) {
        setArrangeCategoriesProgress((current) =>
          current
            ? {
                ...current,
                batchIndex: batchIndex + 1,
              }
            : current,
        );

        const result = await arrangeCategoriesMutation.mutateAsync({ productIds: chunk });
        summary.processedCount += chunk.length;
        summary.scannedCount += result.scanned;
        summary.eligibleCount += result.eligible;
        summary.updatedCount += result.updated;
        summary.skippedCount += result.skipped;

        setArrangeCategoriesProgress((current) =>
          current
            ? {
                ...current,
                processedCount: summary.processedCount,
                scannedCount: summary.scannedCount,
                eligibleCount: summary.eligibleCount,
                updatedCount: summary.updatedCount,
                skippedCount: summary.skippedCount,
                batchIndex: batchIndex + 1,
              }
            : current,
        );
      }

      setArrangeCategoriesProgress((current) =>
        current
          ? {
              ...current,
              status: "done",
              processedCount: targetIds.length,
              scannedCount: summary.scannedCount,
              eligibleCount: summary.eligibleCount,
              updatedCount: summary.updatedCount,
              skippedCount: summary.skippedCount,
              batchIndex: chunks.length,
            }
          : current,
      );

      await productsBootstrapQuery.refetch();
      setSelectedIds(new Set());
      toast({
        variant: "success",
        description: t("aiArrangeCategoriesSuccess", {
          updated: summary.updatedCount,
          skipped: summary.skippedCount,
        }),
      });
    } catch (error) {
      await productsBootstrapQuery.refetch();
      const errorMessage = translateError(tErrors, error as Parameters<typeof translateError>[1]);
      setArrangeCategoriesProgress((current) =>
        current
          ? {
              ...current,
              status: "error",
              errorMessage,
            }
          : current,
      );
      toast({
        variant: "error",
        description: errorMessage,
      });
    }
  };

  const handleCategoryCreate = () => {
    const trimmed = categoryInputValue.trim();
    if (!trimmed) {
      return;
    }
    createCategoryMutation.mutate({ name: trimmed });
  };

  const handleCategoryRemove = () => {
    if (!categoryToRemove) {
      return;
    }
    removeCategoryMutation.mutate({ name: categoryToRemove });
  };

  const handleBulkStorePriceApply = async (values: z.infer<typeof bulkStorePriceSchema>) => {
    if (!selectedList.length) {
      return;
    }
    try {
      await Promise.all(
        selectedList.map((productId) =>
          bulkStorePriceMutation.mutateAsync({
            storeId: values.storeId,
            productId,
            priceKgs: values.priceKgs,
            variantId: null,
          }),
        ),
      );
      productsBootstrapQuery.refetch();
      toast({
        variant: "success",
        description: t("bulkStorePriceSuccess", { count: selectedList.length }),
      });
      setBulkStorePriceOpen(false);
      setSelectedIds(new Set());
    } catch (error) {
      toast({
        variant: "error",
        description: translateError(tErrors, error as Parameters<typeof translateError>[1]),
      });
    }
  };

  const handleBulkGenerateBarcodes = async () => {
    if (!selectedList.length || !isAdmin) {
      return;
    }
    if (
      !(await confirm({
        description: t("confirmBulkGenerateBarcodes", {
          count: selectedList.length,
        }),
      }))
    ) {
      return;
    }
    bulkGenerateBarcodesMutation.mutate({
      mode: "EAN13",
      filter: {
        productIds: selectedList,
        limit: selectedList.length,
      },
    });
  };

  const handleBulkGenerateDescriptions = async () => {
    if (!selectedList.length || !isAdmin || bulkDescriptionRunning) {
      return;
    }
    const targetIds = [...selectedList];
    if (
      !(await confirm({
        description: t("confirmBulkGenerateDescriptions", {
          count: targetIds.length,
        }),
      }))
    ) {
      return;
    }
    const batches = Array.from(
      { length: Math.ceil(targetIds.length / bulkGenerateDescriptionsBatchSize) },
      (_value, index) =>
        targetIds.slice(
          index * bulkGenerateDescriptionsBatchSize,
          (index + 1) * bulkGenerateDescriptionsBatchSize,
        ),
    ).filter((batch) => batch.length > 0);
    const summary = {
      processedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      deferredCount: 0,
    };

    setBulkDescriptionProgress({
      status: "running",
      totalCount: targetIds.length,
      processedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      deferredCount: 0,
      batchIndex: 0,
      batchCount: batches.length,
      startedAt: Date.now(),
      errorMessage: null,
    });

    try {
      for (const [batchIndex, batch] of batches.entries()) {
        setBulkDescriptionProgress((current) =>
          current
            ? {
                ...current,
                batchIndex: batchIndex + 1,
              }
            : current,
        );

        const result = await bulkGenerateDescriptionsMutation.mutateAsync({
          productIds: batch,
          locale: normalizeLocale(locale) ?? defaultLocale,
        });
        const handledInBatch = result.updatedCount + result.skippedCount + result.failedCount;
        const remainingAfterBatch = Math.max(
          0,
          targetIds.length - (batchIndex + 1) * bulkGenerateDescriptionsBatchSize,
        );

        summary.processedCount += handledInBatch;
        summary.updatedCount += result.updatedCount;
        summary.skippedCount += result.skippedCount;
        summary.failedCount += result.failedCount;

        if (result.rateLimited) {
          summary.deferredCount += result.deferredCount + remainingAfterBatch;
          setBulkDescriptionProgress((current) =>
            current
              ? {
                  ...current,
                  status: "rateLimited",
                  processedCount: summary.processedCount,
                  updatedCount: summary.updatedCount,
                  skippedCount: summary.skippedCount,
                  failedCount: summary.failedCount,
                  deferredCount: summary.deferredCount,
                  batchIndex: batchIndex + 1,
                }
              : current,
          );
          await Promise.all([
            trpcUtils.products.bootstrap.invalidate(),
            trpcUtils.products.list.invalidate(),
          ]);
          toast({
            variant: "info",
            description: t("bulkGenerateDescriptionsRateLimited", {
              updated: summary.updatedCount,
              skipped: summary.skippedCount,
              failed: summary.failedCount,
              deferred: summary.deferredCount,
            }),
          });
          return;
        }

        setBulkDescriptionProgress((current) =>
          current
            ? {
                ...current,
                processedCount: summary.processedCount,
                updatedCount: summary.updatedCount,
                skippedCount: summary.skippedCount,
                failedCount: summary.failedCount,
                deferredCount: 0,
                batchIndex: batchIndex + 1,
              }
            : current,
        );
      }

      setBulkDescriptionProgress((current) =>
        current
          ? {
              ...current,
              status: "done",
              processedCount: summary.processedCount,
              updatedCount: summary.updatedCount,
              skippedCount: summary.skippedCount,
              failedCount: summary.failedCount,
              deferredCount: 0,
              batchIndex: batches.length,
            }
          : current,
      );
      await Promise.all([
        trpcUtils.products.bootstrap.invalidate(),
        trpcUtils.products.list.invalidate(),
      ]);
      if (summary.failedCount === 0) {
        setSelectedIds(new Set());
      }
      toast({
        variant: summary.failedCount > 0 ? "info" : "success",
        description:
          summary.failedCount > 0
            ? t("bulkGenerateDescriptionsPartial", {
                updated: summary.updatedCount,
                skipped: summary.skippedCount,
                failed: summary.failedCount,
              })
            : t("bulkGenerateDescriptionsSuccess", {
                updated: summary.updatedCount,
                skipped: summary.skippedCount,
              }),
      });
    } catch (error) {
      await Promise.all([
        trpcUtils.products.bootstrap.invalidate(),
        trpcUtils.products.list.invalidate(),
      ]);
      const errorMessage = translateError(tErrors, error as Parameters<typeof translateError>[1]);
      setBulkDescriptionProgress((current) =>
        current
          ? {
              ...current,
              status: "error",
              deferredCount: Math.max(0, current.totalCount - current.processedCount),
              errorMessage,
            }
          : current,
      );
      toast({
        variant: "error",
        description: errorMessage,
      });
    }
  };

  return (
    <div>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <TooltipProvider>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              {isAdmin ? (
                <Link href="/products/new" className="w-full sm:w-auto">
                  <Button className="w-full sm:w-auto" data-tour="products-create">
                    <AddIcon className="h-4 w-4" aria-hidden />
                    {t("newProduct")}
                  </Button>
                </Link>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full sm:w-auto"
                    aria-label={tCommon("moreActions")}
                  >
                    <MoreIcon className="h-4 w-4" aria-hidden />
                    {tCommon("actions")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[240px]">
                  {isAdmin ? (
                    <>
                      <DropdownMenuItem asChild>
                        <Link href="/products/new?type=bundle">
                          <AddIcon className="h-4 w-4" aria-hidden />
                          {t("newBundle")}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/settings/import">
                          <DownloadIcon className="h-4 w-4 rotate-180" aria-hidden />
                          {t("importProducts")}
                        </Link>
                      </DropdownMenuItem>
                    </>
                  ) : null}
                  <DropdownMenuItem onSelect={openPrintSettings}>
                    <PrintIcon className="h-4 w-4" aria-hidden />
                    {t("changePrintSettings")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {canManagePrices ? (
                    <DropdownMenuItem disabled={!stores.length} onSelect={() => setBulkOpen(true)}>
                      <EditIcon className="h-4 w-4" aria-hidden />
                      {t("bulkPriceUpdate")}
                    </DropdownMenuItem>
                  ) : null}
                  {isAdmin ? (
                    <DropdownMenuItem
                      disabled={!products.length || arrangeCategoriesRunning}
                      onSelect={() => void handleArrangeCategoriesWithAi()}
                    >
                      {arrangeCategoriesRunning ? (
                        <Spinner className="h-4 w-4" />
                      ) : (
                        <SparklesIcon className="h-4 w-4" aria-hidden />
                      )}
                      {arrangeCategoriesRunning ? tCommon("loading") : t("aiArrangeCategories")}
                    </DropdownMenuItem>
                  ) : null}
                  {selectedList.length ? (
                    <>
                      <DropdownMenuItem
                        data-tour="products-print-tags"
                        onSelect={() => void openPrintForProducts(selectedList)}
                      >
                        <PrintIcon className="h-4 w-4" aria-hidden />
                        {t("printPriceTags")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          void openPrintForProducts(selectedList, undefined, { settings: true })
                        }
                      >
                        <MoreIcon className="h-4 w-4" aria-hidden />
                        {t("changePrintSettings")}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={exportQuery.isFetching}
                    onSelect={() => {
                      void handleExport("csv");
                    }}
                  >
                    {exportQuery.isFetching ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      <DownloadIcon className="h-4 w-4" aria-hidden />
                    )}
                    {t("exportCsv")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={exportQuery.isFetching}
                    onSelect={() => {
                      void handleExport("xlsx");
                    }}
                  >
                    {exportQuery.isFetching ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      <DownloadIcon className="h-4 w-4" aria-hidden />
                    )}
                    {t("exportXlsx")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </TooltipProvider>
        }
        filters={
          <>
            <Input
              data-tour="products-search"
              className="w-full sm:max-w-xs"
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
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
                  {stores.map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-full items-center gap-2 sm:max-w-xs">
              <Select
                value={category || "all"}
                onValueChange={(value) => setCategory(value === "all" ? "" : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("allCategories")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allCategories")}</SelectItem>
                  {categories.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isAdmin ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="shrink-0"
                  aria-label={t("manageCategories")}
                  onClick={() => setCategoryManagerOpen(true)}
                >
                  <TagIcon className="h-4 w-4" aria-hidden />
                </Button>
              ) : null}
            </div>
            <div className="w-full sm:max-w-xs">
              <Select
                value={productType}
                onValueChange={(value) => setProductType(value as "all" | "product" | "bundle")}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("typeLabel")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allTypes")}</SelectItem>
                  <SelectItem value="product">{t("typeProduct")}</SelectItem>
                  <SelectItem value="bundle">{t("typeBundle")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:max-w-xs">
              <Select
                value={readiness}
                onValueChange={(value) =>
                  setReadiness(value as z.infer<typeof productReadinessFilterSchema>)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("readinessFilter")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("readinessAll")}</SelectItem>
                  <SelectItem value="missingBarcode">{t("missingBarcode")}</SelectItem>
                  <SelectItem value="missingPrice">{t("missingPrice")}</SelectItem>
                  <SelectItem value="lowStock">{t("lowStock")}</SelectItem>
                  <SelectItem value="negativeStock">{t("negativeStock")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isAdmin ? (
              <div className="flex items-center gap-2 rounded-none border border-border px-3 py-2">
                <Switch
                  checked={showArchived}
                  onCheckedChange={setShowArchived}
                  aria-label={t("showArchived")}
                />
                <span className="text-sm text-muted-foreground">{t("showArchived")}</span>
              </div>
            ) : null}
          </>
        }
      />

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{t("title")}</CardTitle>
          <div className="flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:flex-wrap lg:items-center lg:justify-end">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <SavedTableViews
                views={productsSavedViewsState.views}
                matchingViewId={matchingProductsSavedView?.id ?? null}
                defaultViewId={productsSavedViewsState.defaultViewId}
                disabled={!productsSavedViewsReady || !productsTableStateReady}
                onApplyView={applyProductsSavedView}
                onSaveView={saveProductsView}
                onRenameView={renameProductsView}
                onOverwriteView={overwriteProductsView}
                onDeleteView={deleteProductsView}
                onSetDefaultView={setDefaultProductsView}
              />
              {viewMode === "table" ? (
                <ColumnVisibilityMenu
                  columns={productColumnOptions}
                  visibleColumns={visibleProductColumns}
                  onToggleColumn={(columnKey) =>
                    toggleVisibleProductColumn(columnKey as ProductVisibleColumnKey)
                  }
                />
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1 rounded-none border border-border p-1">
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
          {products.length ? (
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
                {productsTotal > products.length && !allResultsSelected ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={() => void handleSelectAllResults()}
                    disabled={selectingAllResults}
                  >
                    {selectingAllResults ? <Spinner className="h-4 w-4" /> : null}
                    {selectingAllResults
                      ? tCommon("loading")
                      : tCommon("selectAllResults", { count: productsTotal })}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          {selectedList.length ? (
            <div className="mb-3">
              <TooltipProvider>
                <SelectionToolbar
                  count={selectedList.length}
                  label={tCommon("selectedCount", { count: selectedList.length })}
                  clearLabel={tCommon("clearSelection")}
                  onClear={() => setSelectedIds(new Set())}
                >
                  {productsTotal > products.length && !allResultsSelected ? (
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
                        : tCommon("selectAllResults", { count: productsTotal })}
                    </Button>
                  ) : null}
                  <Button
                    data-tour="products-print-tags"
                    type="button"
                    size="sm"
                    className="w-full sm:w-auto"
                    onClick={() => void openPrintForProducts(selectedList)}
                    disabled={quickPrintLoading}
                  >
                    {quickPrintLoading ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      <PrintIcon className="h-4 w-4" aria-hidden />
                    )}
                    {quickPrintLoading ? tCommon("loading") : t("printLabels")}
                  </Button>
                  {canManagePrices ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="w-full sm:w-auto"
                      onClick={() => setBulkStorePriceOpen(true)}
                    >
                      <PriceIcon className="h-4 w-4" aria-hidden />
                      {t("bulkSetStorePrice")}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="w-full sm:w-auto"
                    onClick={() => void handleExport("csv")}
                    disabled={exportQuery.isFetching}
                  >
                    {exportQuery.isFetching ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      <DownloadIcon className="h-4 w-4" aria-hidden />
                    )}
                    {t("exportCsv")}
                  </Button>
                  {hasActiveSelected && isAdmin ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="w-full text-danger hover:text-danger sm:w-auto"
                      onClick={handleBulkArchive}
                    >
                      <ArchiveIcon className="h-4 w-4" aria-hidden />
                      {t("bulkArchive")}
                    </Button>
                  ) : null}
                  {hasArchivedSelected && isAdmin ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="w-full sm:w-auto"
                      onClick={handleBulkRestore}
                    >
                      <RestoreIcon className="h-4 w-4" aria-hidden />
                      {t("bulkRestore")}
                    </Button>
                  ) : null}
                  {isAdmin ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="w-full sm:w-auto"
                      onClick={() => setBulkCategoryOpen(true)}
                    >
                      <TagIcon className="h-4 w-4" aria-hidden />
                      {t("bulkSetCategory")}
                    </Button>
                  ) : null}
                  {isAdmin ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="w-full sm:w-auto"
                          aria-label={t("bulkAiActions")}
                        >
                          <SparklesIcon className="h-4 w-4" aria-hidden />
                          {t("bulkAiActions")}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-[260px]">
                        <DropdownMenuItem
                          disabled={arrangeCategoriesRunning}
                          onSelect={() => void handleArrangeCategoriesWithAi()}
                        >
                          {arrangeCategoriesRunning ? (
                            <Spinner className="h-4 w-4" />
                          ) : (
                            <SparklesIcon className="h-4 w-4" aria-hidden />
                          )}
                          {arrangeCategoriesRunning ? tCommon("loading") : t("aiArrangeCategories")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={bulkDescriptionRunning}
                          onSelect={() => void handleBulkGenerateDescriptions()}
                        >
                          {bulkDescriptionRunning ? (
                            <Spinner className="h-4 w-4" />
                          ) : (
                            <SparklesIcon className="h-4 w-4" aria-hidden />
                          )}
                          {bulkDescriptionRunning
                            ? tCommon("loading")
                            : t("bulkGenerateDescriptions")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={
                            bulkGenerateBarcodesMutation.isLoading || bulkDescriptionRunning
                          }
                          onSelect={() => void handleBulkGenerateBarcodes()}
                        >
                          {bulkGenerateBarcodesMutation.isLoading ? (
                            <Spinner className="h-4 w-4" />
                          ) : (
                            <AddIcon className="h-4 w-4" aria-hidden />
                          )}
                          {bulkGenerateBarcodesMutation.isLoading
                            ? tCommon("loading")
                            : t("bulkGenerateBarcodes")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </SelectionToolbar>
              </TooltipProvider>
            </div>
          ) : null}
          <InlineEditTableProvider>
            <ResponsiveDataList
              items={sortedProducts}
              getKey={(product) => product.id}
              page={productsPage}
              totalItems={productsTotal}
              onPageChange={setProductsPage}
              onPageSizeChange={setProductsPageSize}
              scrollToTopOnPageChange
              mobileItemsClassName={viewMode === "grid" ? "grid grid-cols-2 gap-3" : undefined}
              renderDesktop={(visibleItems) =>
                viewMode === "table" ? (
                  <div className="overflow-x-auto">
                    <TooltipProvider>
                      <Table className="min-w-[720px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded-none border-border bg-background text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                                checked={allSelected}
                                onChange={toggleSelectAll}
                                aria-label={t("selectAll")}
                              />
                            </TableHead>
                            {visibleProductColumnSet.has("sku")
                              ? renderSortableHead("sku", t("sku"))
                              : null}
                            {visibleProductColumnSet.has("image") ? (
                              <TableHead>{t("imageLabel")}</TableHead>
                            ) : null}
                            {visibleProductColumnSet.has("name")
                              ? renderSortableHead("name", t("name"))
                              : null}
                            {visibleProductColumnSet.has("category")
                              ? renderSortableHead(
                                  "category",
                                  t("category"),
                                  "hidden md:table-cell",
                                )
                              : null}
                            {visibleProductColumnSet.has("unit")
                              ? renderSortableHead("unit", t("unit"), "hidden lg:table-cell")
                              : null}
                            {visibleProductColumnSet.has("onHandQty")
                              ? renderSortableHead("onHandQty", tInventory("onHand"), "text-nowrap")
                              : null}
                            {visibleProductColumnSet.has("salePrice")
                              ? renderSortableHead("salePrice", t("salePrice"))
                              : null}
                            {visibleProductColumnSet.has("avgCost")
                              ? renderSortableHead("avgCost", t("avgCost"))
                              : null}
                            {visibleProductColumnSet.has("barcodes")
                              ? renderSortableHead("barcodes", t("barcodes"))
                              : null}
                            {visibleProductColumnSet.has("readiness") ? (
                              <TableHead>{t("readinessColumn")}</TableHead>
                            ) : null}
                            {visibleProductColumnSet.has("stores")
                              ? renderSortableHead("stores", t("stores"))
                              : null}
                            <TableHead>{tCommon("actions")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {visibleItems.map((product) => {
                            const barcodeSummary = getBarcodeSummary(product.barcodes);
                            const previewImageUrl = getProductPreviewUrl(product);
                            const storeInfo = getStoreInfo(
                              product.inventorySnapshots.map((snapshot) => snapshot.storeId),
                            );
                            const productCategories = getProductCategories(product);
                            const readinessState = getProductReadiness(product);
                            const readinessSummary = getProductReadinessSummary(readinessState);
                            return (
                              <TableRow key={product.id}>
                                <TableCell>
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded-none border-border bg-background text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                                    checked={selectedIds.has(product.id)}
                                    onChange={() => toggleSelect(product.id)}
                                    aria-label={t("selectProduct", { name: product.name })}
                                  />
                                </TableCell>
                                {visibleProductColumnSet.has("sku") ? (
                                  <TableCell className="text-xs text-muted-foreground">
                                    {product.sku}
                                  </TableCell>
                                ) : null}
                                {visibleProductColumnSet.has("image") ? (
                                  <TableCell>
                                    {previewImageUrl ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={previewImageUrl}
                                        alt={product.name}
                                        className="h-10 w-10 rounded-md border border-border object-cover"
                                      />
                                    ) : (
                                      <div className="flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-border bg-secondary/60">
                                        <EmptyIcon
                                          className="h-4 w-4 text-muted-foreground"
                                          aria-hidden
                                        />
                                      </div>
                                    )}
                                  </TableCell>
                                ) : null}
                                {visibleProductColumnSet.has("name") ? (
                                  <TableCell className="font-medium">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <InlineEditableCell
                                        rowId={product.id}
                                        row={product}
                                        value={product.name}
                                        definition={inlineEditRegistry.products.name}
                                        context={inlineProductsContext}
                                        role={role}
                                        locale={locale}
                                        columnLabel={t("name")}
                                        tTable={t}
                                        tCommon={tCommon}
                                        enabled={inlineEditingEnabled}
                                        executeMutation={executeInlineProductMutation}
                                      />
                                      <Badge variant="muted">
                                        {product.isBundle ? t("typeBundle") : t("typeProduct")}
                                      </Badge>
                                      {product.isDeleted ? (
                                        <Badge variant="muted">{t("archived")}</Badge>
                                      ) : null}
                                    </div>
                                  </TableCell>
                                ) : null}
                                {visibleProductColumnSet.has("category") ? (
                                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                                    <div className="flex flex-wrap items-center gap-1">
                                      <InlineEditableCell
                                        rowId={product.id}
                                        row={product}
                                        value={product.category}
                                        definition={inlineEditRegistry.products.category}
                                        context={inlineProductsContext}
                                        role={role}
                                        locale={locale}
                                        columnLabel={t("category")}
                                        tTable={t}
                                        tCommon={tCommon}
                                        enabled={inlineEditingEnabled}
                                        executeMutation={executeInlineProductMutation}
                                      />
                                      {productCategories
                                        .filter((value) => value !== product.category)
                                        .map((value) => (
                                          <Badge key={value} variant="muted">
                                            {value}
                                          </Badge>
                                        ))}
                                    </div>
                                  </TableCell>
                                ) : null}
                                {visibleProductColumnSet.has("unit") ? (
                                  <TableCell className="hidden lg:table-cell">
                                    <span>{product.unit}</span>
                                  </TableCell>
                                ) : null}
                                {visibleProductColumnSet.has("onHandQty") ? (
                                  <TableCell
                                    className={
                                      readinessState.negativeStock
                                        ? "text-sm font-semibold text-danger"
                                        : "text-xs text-muted-foreground"
                                    }
                                  >
                                    <InlineEditableCell
                                      rowId={product.id}
                                      row={product}
                                      value={product.onHandQty}
                                      definition={inlineEditRegistry.products.onHand}
                                      context={inlineProductsContext}
                                      role={role}
                                      locale={locale}
                                      columnLabel={tInventory("onHand")}
                                      tTable={t}
                                      tCommon={tCommon}
                                      enabled={inlineEditingEnabled}
                                      executeMutation={executeInlineProductMutation}
                                    />
                                  </TableCell>
                                ) : null}
                                {visibleProductColumnSet.has("salePrice") ? (
                                  <TableCell className="text-xs text-muted-foreground">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <InlineEditableCell
                                        rowId={product.id}
                                        row={product}
                                        value={
                                          showEffectivePrice
                                            ? product.effectivePriceKgs
                                            : product.basePriceKgs
                                        }
                                        definition={inlineEditRegistry.products.salePrice}
                                        context={inlineProductsContext}
                                        role={role}
                                        locale={locale}
                                        columnLabel={t("salePrice")}
                                        tTable={t}
                                        tCommon={tCommon}
                                        enabled={inlineEditingEnabled}
                                        executeMutation={executeInlineProductMutation}
                                      />
                                      {showEffectivePrice && product.priceOverridden ? (
                                        <Badge variant="muted">{t("priceOverridden")}</Badge>
                                      ) : null}
                                    </div>
                                  </TableCell>
                                ) : null}
                                {visibleProductColumnSet.has("avgCost") ? (
                                  <TableCell className="text-xs text-muted-foreground">
                                    <InlineEditableCell
                                      rowId={product.id}
                                      row={product}
                                      value={product.avgCostKgs}
                                      definition={inlineEditRegistry.products.avgCost}
                                      context={inlineProductsContext}
                                      role={role}
                                      locale={locale}
                                      columnLabel={t("avgCost")}
                                      tTable={t}
                                      tCommon={tCommon}
                                      enabled={inlineEditingEnabled}
                                      executeMutation={executeInlineProductMutation}
                                    />
                                  </TableCell>
                                ) : null}
                                {visibleProductColumnSet.has("barcodes") ? (
                                  <TableCell className="text-xs text-muted-foreground">
                                    {barcodeSummary.label}
                                  </TableCell>
                                ) : null}
                                {visibleProductColumnSet.has("readiness") ? (
                                  <TableCell>
                                    <Badge variant={readinessSummary.variant}>
                                      {readinessSummary.label}
                                    </Badge>
                                  </TableCell>
                                ) : null}
                                {visibleProductColumnSet.has("stores") ? (
                                  <TableCell className="text-xs text-muted-foreground">
                                    {storeInfo.names.length ? (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="cursor-help text-foreground">
                                            {storeInfo.summary}
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p>{storeInfo.names.join(", ")}</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    ) : (
                                      storeInfo.summary
                                    )}
                                  </TableCell>
                                ) : null}
                                <TableCell>
                                  <RowActions
                                    actions={getProductActions(product)}
                                    maxInline={1}
                                    moreLabel={tCommon("tooltips.moreActions")}
                                  />
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </TooltipProvider>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {visibleItems.map((product) => {
                      const barcodeSummary = getBarcodeSummary(product.barcodes);
                      const previewImageUrl = getProductPreviewUrl(product);
                      const actions = getProductActions(product);
                      const productCategories = getProductCategories(product);
                      const readinessState = getProductReadiness(product);
                      const readinessSummary = getProductReadinessSummary(readinessState);
                      return (
                        <div
                          key={product.id}
                          className="overflow-hidden rounded-none border border-border bg-card"
                        >
                          <div className="relative aspect-[4/3] bg-muted/30">
                            {previewImageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={previewImageUrl}
                                alt={product.name}
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
                                className="h-4 w-4 rounded-none border-border bg-background text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                                checked={selectedIds.has(product.id)}
                                onChange={() => toggleSelect(product.id)}
                                aria-label={t("selectProduct", { name: product.name })}
                              />
                            </label>
                          </div>
                          <div className="space-y-3 p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="line-clamp-2 text-base font-semibold leading-tight text-foreground">
                                  {product.name}
                                </p>
                                <p className="text-xs text-muted-foreground">{product.sku}</p>
                              </div>
                              <RowActions
                                actions={actions}
                                maxInline={2}
                                moreLabel={tCommon("tooltips.moreActions")}
                                className="shrink-0"
                              />
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="muted">
                                {product.isBundle ? t("typeBundle") : t("typeProduct")}
                              </Badge>
                              {product.isDeleted ? (
                                <Badge variant="muted">{t("archived")}</Badge>
                              ) : null}
                              <Badge variant={readinessSummary.variant}>
                                {readinessSummary.label}
                              </Badge>
                              {productCategories.map((value) => (
                                <Badge key={value} variant="muted">
                                  {value}
                                </Badge>
                              ))}
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                              <div>
                                <p>{t("salePrice")}</p>
                                <InlineEditableCell
                                  rowId={product.id}
                                  row={product}
                                  value={
                                    showEffectivePrice
                                      ? product.effectivePriceKgs
                                      : product.basePriceKgs
                                  }
                                  definition={inlineEditRegistry.products.salePrice}
                                  context={inlineProductsContext}
                                  role={role}
                                  locale={locale}
                                  columnLabel={t("salePrice")}
                                  tTable={t}
                                  tCommon={tCommon}
                                  enabled={inlineEditingEnabled}
                                  executeMutation={executeInlineProductMutation}
                                  className="text-sm font-semibold text-foreground"
                                />
                              </div>
                              <div>
                                <p>{tInventory("onHand")}</p>
                                <InlineEditableCell
                                  rowId={product.id}
                                  row={product}
                                  value={product.onHandQty}
                                  definition={inlineEditRegistry.products.onHand}
                                  context={inlineProductsContext}
                                  role={role}
                                  locale={locale}
                                  columnLabel={tInventory("onHand")}
                                  tTable={t}
                                  tCommon={tCommon}
                                  enabled={inlineEditingEnabled}
                                  executeMutation={executeInlineProductMutation}
                                  className="text-sm font-semibold text-foreground"
                                />
                              </div>
                              <div>
                                <p>{t("avgCost")}</p>
                                <InlineEditableCell
                                  rowId={product.id}
                                  row={product}
                                  value={product.avgCostKgs}
                                  definition={inlineEditRegistry.products.avgCost}
                                  context={inlineProductsContext}
                                  role={role}
                                  locale={locale}
                                  columnLabel={t("avgCost")}
                                  tTable={t}
                                  tCommon={tCommon}
                                  enabled={inlineEditingEnabled}
                                  executeMutation={executeInlineProductMutation}
                                  className="text-sm font-semibold text-foreground"
                                />
                              </div>
                              <div>
                                <p>{t("barcodes")}</p>
                                <p className="truncate text-sm font-semibold text-foreground">
                                  {barcodeSummary.label}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              }
              renderMobile={(product) => {
                const barcodeSummary = getBarcodeSummary(product.barcodes);
                const previewImageUrl = getProductPreviewUrl(product);
                const storeInfo = getStoreInfo(
                  product.inventorySnapshots.map((snapshot) => snapshot.storeId),
                );
                const actions = getProductActions(product);
                const productCategories = getProductCategories(product);
                const readinessState = getProductReadiness(product);
                const readinessSummary = getProductReadinessSummary(readinessState);

                if (viewMode === "grid") {
                  return (
                    <div className="overflow-hidden rounded-none border border-border bg-card">
                      <div className="relative aspect-[4/3] bg-muted/30">
                        {previewImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={previewImageUrl}
                            alt={product.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <EmptyIcon className="h-6 w-6 text-muted-foreground" aria-hidden />
                          </div>
                        )}
                        <label className="absolute left-2 top-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded-none border-border bg-background text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                            checked={selectedIds.has(product.id)}
                            onChange={() => toggleSelect(product.id)}
                            aria-label={t("selectProduct", { name: product.name })}
                          />
                        </label>
                      </div>
                      <div className="space-y-3 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="line-clamp-2 text-base font-semibold leading-tight text-foreground">
                              {product.name}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">{product.sku}</p>
                          </div>
                          <RowActions
                            actions={actions}
                            maxInline={1}
                            moreLabel={tCommon("tooltips.moreActions")}
                            className="shrink-0"
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="muted">
                            {product.isBundle ? t("typeBundle") : t("typeProduct")}
                          </Badge>
                          {product.isDeleted ? (
                            <Badge variant="muted">{t("archived")}</Badge>
                          ) : null}
                          <Badge variant={readinessSummary.variant}>{readinessSummary.label}</Badge>
                          {productCategories.map((value) => (
                            <Badge key={value} variant="muted">
                              {value}
                            </Badge>
                          ))}
                        </div>
                        <div className="space-y-2 text-xs text-muted-foreground">
                          <div className="flex items-center justify-between gap-2">
                            <span>{t("salePrice")}</span>
                            <InlineEditableCell
                              rowId={product.id}
                              row={product}
                              value={
                                showEffectivePrice
                                  ? product.effectivePriceKgs
                                  : product.basePriceKgs
                              }
                              definition={inlineEditRegistry.products.salePrice}
                              context={inlineProductsContext}
                              role={role}
                              locale={locale}
                              columnLabel={t("salePrice")}
                              tTable={t}
                              tCommon={tCommon}
                              enabled={inlineEditingEnabled}
                              executeMutation={executeInlineProductMutation}
                              className="justify-end text-sm font-semibold text-foreground"
                            />
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span>{tInventory("onHand")}</span>
                            <InlineEditableCell
                              rowId={product.id}
                              row={product}
                              value={product.onHandQty}
                              definition={inlineEditRegistry.products.onHand}
                              context={inlineProductsContext}
                              role={role}
                              locale={locale}
                              columnLabel={tInventory("onHand")}
                              tTable={t}
                              tCommon={tCommon}
                              enabled={inlineEditingEnabled}
                              executeMutation={executeInlineProductMutation}
                              className="justify-end text-sm font-semibold text-foreground"
                            />
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span>{t("avgCost")}</span>
                            <InlineEditableCell
                              rowId={product.id}
                              row={product}
                              value={product.avgCostKgs}
                              definition={inlineEditRegistry.products.avgCost}
                              context={inlineProductsContext}
                              role={role}
                              locale={locale}
                              columnLabel={t("avgCost")}
                              tTable={t}
                              tCommon={tCommon}
                              enabled={inlineEditingEnabled}
                              executeMutation={executeInlineProductMutation}
                              className="justify-end text-sm font-semibold text-foreground"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="rounded-none border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <label className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded-none border-border bg-background text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                          checked={selectedIds.has(product.id)}
                          onChange={() => toggleSelect(product.id)}
                          aria-label={t("selectProduct", { name: product.name })}
                        />
                        {previewImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={previewImageUrl}
                            alt={product.name}
                            className="h-10 w-10 rounded-md border border-border object-cover"
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-border bg-secondary/60">
                            <EmptyIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
                          </div>
                        )}
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-base font-semibold leading-tight text-foreground">
                              {product.name}
                            </span>
                            <Badge variant="muted">
                              {product.isBundle ? t("typeBundle") : t("typeProduct")}
                            </Badge>
                            {product.isDeleted ? (
                              <Badge variant="muted">{t("archived")}</Badge>
                            ) : null}
                            <Badge variant={readinessSummary.variant}>
                              {readinessSummary.label}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {t("sku")}: {product.sku}
                          </p>
                        </div>
                      </label>
                      <RowActions
                        actions={actions}
                        maxInline={1}
                        moreLabel={tCommon("tooltips.moreActions")}
                        className="shrink-0"
                      />
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                      <div className="flex items-center justify-between gap-2">
                        <span>{t("category")}</span>
                        <span className="text-foreground">
                          {productCategories.length
                            ? productCategories.join(", ")
                            : tCommon("notAvailable")}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span>{t("unit")}</span>
                        <span className="text-foreground">{product.unit}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span>{t("salePrice")}</span>
                        <InlineEditableCell
                          rowId={product.id}
                          row={product}
                          value={
                            showEffectivePrice ? product.effectivePriceKgs : product.basePriceKgs
                          }
                          definition={inlineEditRegistry.products.salePrice}
                          context={inlineProductsContext}
                          role={role}
                          locale={locale}
                          columnLabel={t("salePrice")}
                          tTable={t}
                          tCommon={tCommon}
                          enabled={inlineEditingEnabled}
                          executeMutation={executeInlineProductMutation}
                          className="justify-end text-foreground"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span>{tInventory("onHand")}</span>
                        <InlineEditableCell
                          rowId={product.id}
                          row={product}
                          value={product.onHandQty}
                          definition={inlineEditRegistry.products.onHand}
                          context={inlineProductsContext}
                          role={role}
                          locale={locale}
                          columnLabel={tInventory("onHand")}
                          tTable={t}
                          tCommon={tCommon}
                          enabled={inlineEditingEnabled}
                          executeMutation={executeInlineProductMutation}
                          className="justify-end text-foreground"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span>{t("avgCost")}</span>
                        <InlineEditableCell
                          rowId={product.id}
                          row={product}
                          value={product.avgCostKgs}
                          definition={inlineEditRegistry.products.avgCost}
                          context={inlineProductsContext}
                          role={role}
                          locale={locale}
                          columnLabel={t("avgCost")}
                          tTable={t}
                          tCommon={tCommon}
                          enabled={inlineEditingEnabled}
                          executeMutation={executeInlineProductMutation}
                          className="justify-end text-foreground"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span>{t("barcodes")}</span>
                        <span className="text-foreground">{barcodeSummary.label}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span>{t("stores")}</span>
                        <span className="text-foreground">{storeInfo.summary}</span>
                      </div>
                    </div>
                  </div>
                );
              }}
            />
          </InlineEditTableProvider>
          {productsBootstrapQuery.isLoading ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : productsTotal === 0 ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <EmptyIcon className="h-4 w-4" aria-hidden />
                {t("noProducts")}
              </div>
            </div>
          ) : null}
          {productsBootstrapQuery.error ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-danger">
              <span>{translateError(tErrors, productsBootstrapQuery.error)}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => productsBootstrapQuery.refetch()}
              >
                {tErrors("tryAgain")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Modal
        open={Boolean(arrangeCategoriesProgress)}
        onOpenChange={(open) => {
          if (!open && !arrangeCategoriesRunning) {
            setArrangeCategoriesProgress(null);
          }
        }}
        title={t("aiArrangeCategoriesProgressTitle")}
        subtitle={
          arrangeCategoriesProgress
            ? arrangeCategoriesProgress.status === "running"
              ? t("aiArrangeCategoriesProgressRunning")
              : arrangeCategoriesProgress.status === "error"
                ? t("aiArrangeCategoriesProgressError")
                : t("aiArrangeCategoriesProgressDone")
            : undefined
        }
      >
        {arrangeCategoriesProgress ? (
          <div className="space-y-4">
            <div className="rounded-none border border-border bg-muted/30 p-4">
              <div className="flex items-center justify-between gap-3 text-sm">
                <p className="font-medium text-foreground">
                  {t("aiArrangeCategoriesProgressLabel", {
                    processed: arrangeCategoriesProgress.processedCount,
                    total: arrangeCategoriesProgress.totalCount,
                  })}
                </p>
                <span className="text-sm font-semibold text-foreground">
                  {arrangeCategoriesProgressPercent}%
                </span>
              </div>
              <div className="mt-3 h-2 rounded-full bg-border/70">
                <div
                  className="h-2 rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${arrangeCategoriesProgressPercent}%` }}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>
                  {t("aiArrangeCategoriesProgressBatch", {
                    current:
                      arrangeCategoriesProgress.batchCount > 0
                        ? Math.min(
                            arrangeCategoriesProgress.batchCount,
                            Math.max(1, arrangeCategoriesProgress.batchIndex),
                          )
                        : 0,
                    total: arrangeCategoriesProgress.batchCount,
                  })}
                </span>
                <span>
                  {t("aiArrangeCategoriesProgressElapsed", {
                    seconds: arrangeCategoriesElapsedSeconds,
                  })}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-none border border-border bg-card p-3">
                <p className="text-xs text-muted-foreground">
                  {t("aiArrangeCategoriesProgressScanned")}
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {arrangeCategoriesProgress.scannedCount}
                </p>
              </div>
              <div className="rounded-none border border-border bg-card p-3">
                <p className="text-xs text-muted-foreground">
                  {t("aiArrangeCategoriesProgressEligible")}
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {arrangeCategoriesProgress.eligibleCount}
                </p>
              </div>
              <div className="rounded-none border border-border bg-card p-3">
                <p className="text-xs text-muted-foreground">
                  {t("aiArrangeCategoriesProgressUpdated")}
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {arrangeCategoriesProgress.updatedCount}
                </p>
              </div>
              <div className="rounded-none border border-border bg-card p-3">
                <p className="text-xs text-muted-foreground">
                  {t("aiArrangeCategoriesProgressSkipped")}
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {arrangeCategoriesProgress.skippedCount}
                </p>
              </div>
            </div>

            {arrangeCategoriesProgress.errorMessage ? (
              <div className="rounded-none border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
                {arrangeCategoriesProgress.errorMessage}
              </div>
            ) : null}

            {!arrangeCategoriesRunning ? (
              <FormActions>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full sm:w-auto"
                  onClick={() => setArrangeCategoriesProgress(null)}
                >
                  {tCommon("close")}
                </Button>
              </FormActions>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(bulkDescriptionProgress)}
        onOpenChange={(open) => {
          if (!open && !bulkDescriptionRunning) {
            setBulkDescriptionProgress(null);
          }
        }}
        title={t("bulkGenerateDescriptionsProgressTitle")}
        subtitle={
          bulkDescriptionProgress
            ? bulkDescriptionProgress.status === "running"
              ? t("bulkGenerateDescriptionsProgressRunning")
              : bulkDescriptionProgress.status === "rateLimited"
                ? t("bulkGenerateDescriptionsProgressRateLimited")
                : bulkDescriptionProgress.status === "error"
                  ? t("bulkGenerateDescriptionsProgressError")
                  : bulkDescriptionProgress.failedCount > 0
                    ? t("bulkGenerateDescriptionsProgressPartial")
                    : t("bulkGenerateDescriptionsProgressDone")
            : undefined
        }
      >
        {bulkDescriptionProgress ? (
          <div className="space-y-4">
            <div className="rounded-none border border-border bg-muted/30 p-4">
              <div className="flex items-center justify-between gap-3 text-sm">
                <p className="font-medium text-foreground">
                  {t("bulkGenerateDescriptionsProgressLabel", {
                    processed: bulkDescriptionProgress.processedCount,
                    total: bulkDescriptionProgress.totalCount,
                  })}
                </p>
                <span className="text-sm font-semibold text-foreground">
                  {bulkDescriptionProgressPercent}%
                </span>
              </div>
              <div className="mt-3 h-2 rounded-full bg-border/70">
                <div
                  className="h-2 rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${bulkDescriptionProgressPercent}%` }}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>
                  {t("bulkGenerateDescriptionsProgressBatch", {
                    current:
                      bulkDescriptionProgress.batchCount > 0
                        ? Math.min(
                            bulkDescriptionProgress.batchCount,
                            Math.max(1, bulkDescriptionProgress.batchIndex),
                          )
                        : 0,
                    total: bulkDescriptionProgress.batchCount,
                  })}
                </span>
                <span>
                  {t("bulkGenerateDescriptionsProgressElapsed", {
                    seconds: bulkDescriptionElapsedSeconds,
                  })}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-none border border-border bg-card p-3">
                <p className="text-xs text-muted-foreground">
                  {t("bulkGenerateDescriptionsProgressUpdated")}
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {bulkDescriptionProgress.updatedCount}
                </p>
              </div>
              <div className="rounded-none border border-border bg-card p-3">
                <p className="text-xs text-muted-foreground">
                  {t("bulkGenerateDescriptionsProgressSkipped")}
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {bulkDescriptionProgress.skippedCount}
                </p>
              </div>
              <div className="rounded-none border border-border bg-card p-3">
                <p className="text-xs text-muted-foreground">
                  {t("bulkGenerateDescriptionsProgressFailed")}
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {bulkDescriptionProgress.failedCount}
                </p>
              </div>
              <div className="rounded-none border border-border bg-card p-3">
                <p className="text-xs text-muted-foreground">
                  {t("bulkGenerateDescriptionsProgressDeferred")}
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {bulkDescriptionProgress.deferredCount}
                </p>
              </div>
            </div>

            {bulkDescriptionProgress.errorMessage ? (
              <div className="rounded-none border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
                {bulkDescriptionProgress.errorMessage}
              </div>
            ) : null}

            {!bulkDescriptionRunning ? (
              <FormActions>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full sm:w-auto"
                  onClick={() => setBulkDescriptionProgress(null)}
                >
                  {tCommon("close")}
                </Button>
              </FormActions>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={bulkOpen}
        onOpenChange={(open) => {
          if (!open) {
            setBulkOpen(false);
          }
        }}
        title={t("bulkPriceUpdate")}
        subtitle={t("bulkPriceSubtitle")}
      >
        <Form {...bulkForm}>
          <form
            className="space-y-4"
            onSubmit={bulkForm.handleSubmit((values) => {
              bulkPriceMutation.mutate({
                storeId: values.storeId,
                filter: {
                  search: values.search || undefined,
                  category: values.category || undefined,
                  type: productType,
                  includeArchived: isAdmin ? showArchived : undefined,
                },
                mode: values.mode,
                value: values.value,
              });
            })}
          >
            <FormField
              control={bulkForm.control}
              name="storeId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tCommon("store")}</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder={tCommon("selectStore")} />
                      </SelectTrigger>
                      <SelectContent>
                        {stores.map((store) => (
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
              control={bulkForm.control}
              name="search"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("searchPlaceholder")}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t("searchPlaceholder")} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={bulkForm.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("category")}</FormLabel>
                  <FormControl>
                    <Select
                      value={field.value || "all"}
                      onValueChange={(value) => field.onChange(value === "all" ? "" : value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("allCategories")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("allCategories")}</SelectItem>
                        {categories.map((item) => (
                          <SelectItem key={item} value={item}>
                            {item}
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
              control={bulkForm.control}
              name="mode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("bulkMode")}</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder={t("bulkMode")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="set">{t("bulkModeSet")}</SelectItem>
                        <SelectItem value="increasePct">{t("bulkModePct")}</SelectItem>
                        <SelectItem value="increaseAbs">{t("bulkModeAbs")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={bulkForm.control}
              name="value"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("bulkValue")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      placeholder={t("pricePlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="rounded-none border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {previewQuery.isLoading
                ? tCommon("loading")
                : t("bulkPreview", { count: previewQuery.data?.total ?? 0 })}
            </div>

            <FormActions>
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => setBulkOpen(false)}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                className="w-full sm:w-auto"
                disabled={bulkPriceMutation.isLoading}
              >
                {bulkPriceMutation.isLoading ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <EditIcon className="h-4 w-4" aria-hidden />
                )}
                {bulkPriceMutation.isLoading ? tCommon("loading") : t("applyBulkPrice")}
              </Button>
            </FormActions>
          </form>
        </Form>
      </Modal>

      <Modal
        open={categoryManagerOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCategoryManagerOpen(false);
          }
        }}
        title={t("categoriesManageTitle")}
        subtitle={t("categoriesManageSubtitle")}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            handleCategoryCreate();
          }}
        >
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              {t("categoriesManageCreateLabel")}
            </label>
            <Input
              value={categoryInputValue}
              onChange={(event) => setCategoryInputValue(event.target.value)}
              placeholder={t("categoriesManagePlaceholder")}
            />
          </div>

          <FormActions>
            <Button
              type="button"
              variant="secondary"
              className="w-full sm:w-auto"
              onClick={() => setCategoryManagerOpen(false)}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              type="submit"
              className="w-full sm:w-auto"
              disabled={createCategoryMutation.isLoading}
            >
              {createCategoryMutation.isLoading ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <AddIcon className="h-4 w-4" aria-hidden />
              )}
              {createCategoryMutation.isLoading ? tCommon("loading") : tCommon("save")}
            </Button>
          </FormActions>
        </form>

        <div className="mt-4 space-y-2">
          {categories.length ? (
            <>
              <label className="text-sm font-medium text-foreground">
                {t("categoriesManageRemoveLabel")}
              </label>
              <Select value={categoryToRemove || undefined} onValueChange={setCategoryToRemove}>
                <SelectTrigger>
                  <SelectValue placeholder={t("categoriesManageRemovePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="secondary"
                className="w-full justify-center text-danger sm:w-auto"
                onClick={handleCategoryRemove}
                disabled={!categoryToRemove || removeCategoryMutation.isLoading}
              >
                {removeCategoryMutation.isLoading ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <DeleteIcon className="h-4 w-4" aria-hidden />
                )}
                {removeCategoryMutation.isLoading ? tCommon("loading") : tCommon("delete")}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("categoriesManageEmpty")}</p>
          )}
        </div>
      </Modal>

      <Modal
        open={bulkCategoryOpen}
        onOpenChange={(open) => {
          if (!open) {
            setBulkCategoryOpen(false);
          }
        }}
        title={t("bulkCategoryTitle")}
        subtitle={t("bulkCategorySubtitle")}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            handleBulkCategoryApply();
          }}
        >
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t("category")}</label>
            <Select
              value={bulkCategorySelectValue}
              onValueChange={(value) => {
                if (value === customCategorySelectValue) {
                  setBulkCategoryMode("custom");
                  setBulkCategoryValue("");
                  return;
                }
                if (value === clearCategorySelectValue) {
                  setBulkCategoryMode("clear");
                  setBulkCategoryValue("");
                  return;
                }
                setBulkCategoryMode("existing");
                setBulkCategoryValue(value);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("bulkCategorySelectPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {categories.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
                <SelectItem value={customCategorySelectValue}>
                  {t("bulkCategoryCustomOption")}
                </SelectItem>
                <SelectItem value={clearCategorySelectValue}>
                  {t("bulkCategoryClearOption")}
                </SelectItem>
              </SelectContent>
            </Select>
            {bulkCategoryMode === "custom" ? (
              <Input
                value={bulkCategoryValue}
                onChange={(event) => setBulkCategoryValue(event.target.value)}
                placeholder={t("bulkCategoryPlaceholder")}
              />
            ) : null}
            <p className="text-xs text-muted-foreground">{t("bulkCategoryHint")}</p>
          </div>
          <FormActions>
            <Button
              type="button"
              variant="secondary"
              className="w-full sm:w-auto"
              onClick={() => setBulkCategoryOpen(false)}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              type="submit"
              className="w-full sm:w-auto"
              disabled={bulkCategoryMutation.isLoading || !bulkCategoryCanSubmit}
            >
              {bulkCategoryMutation.isLoading ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <TagIcon className="h-4 w-4" aria-hidden />
              )}
              {bulkCategoryMutation.isLoading ? tCommon("loading") : tCommon("save")}
            </Button>
          </FormActions>
        </form>
      </Modal>

      <Modal
        open={bulkStorePriceOpen}
        onOpenChange={(open) => {
          if (!open) {
            setBulkStorePriceOpen(false);
          }
        }}
        title={t("bulkStorePriceTitle")}
        subtitle={t("bulkStorePriceSubtitle")}
      >
        <Form {...bulkStorePriceForm}>
          <form
            className="space-y-4"
            onSubmit={bulkStorePriceForm.handleSubmit(handleBulkStorePriceApply)}
          >
            <FormField
              control={bulkStorePriceForm.control}
              name="storeId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tCommon("store")}</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder={tCommon("selectStore")} />
                      </SelectTrigger>
                      <SelectContent>
                        {stores.map((store) => (
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
              control={bulkStorePriceForm.control}
              name="priceKgs"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("effectivePrice")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      placeholder={t("pricePlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormActions>
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => setBulkStorePriceOpen(false)}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                className="w-full sm:w-auto"
                disabled={bulkStorePriceMutation.isLoading}
              >
                {bulkStorePriceMutation.isLoading ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <PriceIcon className="h-4 w-4" aria-hidden />
                )}
                {bulkStorePriceMutation.isLoading ? tCommon("loading") : t("savePrice")}
              </Button>
            </FormActions>
          </form>
        </Form>
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
          <div className="border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">
              {t("printSetupSelected", { count: printQueue.length })}
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

      {legacyProductsPrintModalEnabled ? (
        <Modal
          open={legacyProductsPrintModalOpen}
          onOpenChange={(open) => {
            if (!open) {
              setLegacyProductsPrintModalOpen(false);
            }
          }}
          title={t("printSettingsTitle")}
          subtitle={t("printSubtitle", { count: printQueue.length })}
          className="sm:!max-w-6xl"
        >
          <Form {...printForm}>
            <form
              className="space-y-4"
              onSubmit={printForm.handleSubmit((values) => handlePrintTags(values, "download"))}
            >
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-md border border-border/70 bg-secondary/20 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {tCommon("selectedCount", { count: printQueue.length })}
                      </p>
                      <p className="mt-1 text-lg font-semibold text-foreground">
                        {printQueue.length}
                      </p>
                    </div>
                    <div className="rounded-md border border-border/70 bg-secondary/20 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {t("printQty")}
                      </p>
                      <p className="mt-1 text-lg font-semibold text-foreground">
                        {printLabelCount}
                      </p>
                    </div>
                    <div className="rounded-md border border-border/70 bg-secondary/20 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {t("template")}
                      </p>
                      <p className="mt-1 truncate text-sm font-semibold text-foreground">
                        {t("templateRollXp365b")}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-md border border-border/70 bg-card p-3">
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
                      <FormField
                        control={printForm.control}
                        name="storeId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{tCommon("store")}</FormLabel>
                            <FormControl>
                              <Select
                                value={field.value || "all"}
                                onValueChange={(value) =>
                                  field.onChange(value === "all" ? "" : value)
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder={tCommon("selectStore")} />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="all">{t("allStores")}</SelectItem>
                                  {stores.map((store) => (
                                    <SelectItem key={store.id} value={store.id}>
                                      {store.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FormControl>
                            <FormDescription>{t("printStoreHint")}</FormDescription>
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
                            <div className="flex gap-1.5 pt-1">
                              {priceTagQuickQuantities.map((quantity) => (
                                <Button
                                  key={quantity}
                                  type="button"
                                  variant={
                                    resolvedPrintQuantity === quantity ? "default" : "secondary"
                                  }
                                  size="sm"
                                  className="h-7 flex-1 px-2"
                                  onClick={() =>
                                    printForm.setValue("quantity", quantity, {
                                      shouldDirty: true,
                                      shouldValidate: true,
                                    })
                                  }
                                >
                                  {quantity}
                                </Button>
                              ))}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  {printRequiresBarcodeConfirmation ? (
                    <div className="flex flex-col gap-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-medium">
                          {t("rollMissingBarcodeCount", { count: queueMissingBarcodeCount })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t("printWithoutBarcodeHint")}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="w-full sm:w-auto"
                        onClick={() =>
                          printForm.setValue("allowWithoutBarcode", true, {
                            shouldDirty: true,
                            shouldValidate: true,
                          })
                        }
                      >
                        {t("printWithoutBarcode")}
                      </Button>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-md border border-border/70 bg-secondary/20 px-3 py-2 text-sm font-medium text-foreground transition hover:bg-secondary/40"
                    onClick={() => setPrintAdvancedOpen((current) => !current)}
                  >
                    <span>{printAdvancedOpen ? t("hideAdvanced") : t("showAdvanced")}</span>
                    {printAdvancedOpen ? (
                      <ArrowUpIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
                    ) : (
                      <ArrowDownIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
                    )}
                  </button>

                  {printAdvancedOpen ? (
                    <div className="grid gap-3 rounded-md border border-border/70 bg-card p-3 sm:grid-cols-2">
                      <FormField
                        control={printForm.control}
                        name="widthMm"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("rollWidthMm")}</FormLabel>
                            <FormControl>
                              <Input
                                value={field.value ?? ""}
                                onChange={(event) => field.onChange(event.target.value)}
                                onBlur={(event) => {
                                  const raw = event.target.value.trim();
                                  if (raw === "") {
                                    field.onChange(0);
                                  } else {
                                    const parsed = Number(raw);
                                    field.onChange(Number.isFinite(parsed) ? parsed : 0);
                                  }
                                  field.onBlur();
                                }}
                                type="number"
                                min={PRICE_TAG_ROLL_LIMITS.widthMm.min}
                                max={PRICE_TAG_ROLL_LIMITS.widthMm.max}
                                step={PRICE_TAG_ROLL_LIMITS.widthMm.step}
                              />
                            </FormControl>
                            <FormDescription>{t("rollSizeHint")}</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={printForm.control}
                        name="heightMm"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("rollHeightMm")}</FormLabel>
                            <FormControl>
                              <Input
                                value={field.value ?? ""}
                                onChange={(event) => field.onChange(event.target.value)}
                                onBlur={(event) => {
                                  const raw = event.target.value.trim();
                                  if (raw === "") {
                                    field.onChange(0);
                                  } else {
                                    const parsed = Number(raw);
                                    field.onChange(Number.isFinite(parsed) ? parsed : 0);
                                  }
                                  field.onBlur();
                                }}
                                type="number"
                                min={PRICE_TAG_ROLL_LIMITS.heightMm.min}
                                max={PRICE_TAG_ROLL_LIMITS.heightMm.max}
                                step={PRICE_TAG_ROLL_LIMITS.heightMm.step}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={printForm.control}
                        name="allowWithoutBarcode"
                        render={({ field }) => (
                          <FormItem className="sm:col-span-2">
                            <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-secondary/20 p-3">
                              <div>
                                <FormLabel>{t("printWithoutBarcode")}</FormLabel>
                                <FormDescription>{t("printWithoutBarcodeHint")}</FormDescription>
                              </div>
                              <FormControl>
                                <Switch
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                  disabled={queueMissingBarcodeCount === 0}
                                />
                              </FormControl>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  ) : null}
                </div>

                <div className="space-y-3">
                  {rollTemplateSelected ? (
                    <div className="rounded-md border border-border/70 bg-secondary/20 p-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="text-xs font-medium text-foreground">
                          {t("rollTemplatePreviewTitle")}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {t("rollPreviewSize", {
                            width: resolvedRollWidthMm,
                            height: resolvedRollHeightMm,
                          })}
                        </p>
                      </div>
                      <div className="mx-auto w-[210px] max-w-full rounded-md border border-border bg-card p-2">
                        <div
                          className="rounded-md border border-dashed border-border/70"
                          style={{
                            aspectRatio: `${Math.max(1, resolvedRollWidthMm)} / ${Math.max(1, resolvedRollHeightMm)}`,
                          }}
                        >
                          <div
                            className="flex h-full flex-col justify-between"
                            style={{
                              padding: `${rollPreviewPaddingY}% ${rollPreviewPaddingX}%`,
                            }}
                          >
                            <p className="line-clamp-2 text-[10px] font-medium text-foreground">
                              {rollPreviewProduct?.name ?? t("rollPreviewName")}
                            </p>
                            <p className="mt-1 text-[11px] font-semibold text-foreground">
                              {rollPreviewPriceText}
                            </p>
                            <p className="mt-1 text-[8px] text-muted-foreground">
                              {rollPreviewProduct?.sku || t("rollPreviewSku")}
                            </p>
                            <div className="mt-1 h-4 rounded-md bg-muted" />
                            <p className="mt-1 text-center text-[7px] text-muted-foreground">
                              {t("rollPreviewBarcode")}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3">
                    <p className="text-xs font-medium text-foreground">{t("printQueueTitle")}</p>
                    {queueProductsQuery.isLoading && queueIdsForQuery.length > 0 ? (
                      <p className="text-xs text-muted-foreground">{tCommon("loading")}</p>
                    ) : null}
                    <div className="max-h-44 space-y-1 overflow-y-auto pr-1 text-xs">
                      {printQueue.map((productId) => {
                        const product = productById.get(productId);
                        return (
                          <div
                            key={productId}
                            className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-card/80 px-2 py-1.5"
                          >
                            <span className="truncate text-foreground">
                              {product?.name ?? productId}
                            </span>
                            <span className="shrink-0 text-muted-foreground">
                              {product?.sku ?? tCommon("notAvailable")}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
              <FormActions>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full sm:w-auto"
                  onClick={() => setLegacyProductsPrintModalOpen(false)}
                >
                  {tCommon("cancel")}
                </Button>
                <Button
                  type="submit"
                  variant="secondary"
                  className="w-full sm:w-auto"
                  disabled={printRequiresBarcodeConfirmation}
                >
                  <DownloadIcon className="h-4 w-4" aria-hidden />
                  {t("printDownload")}
                </Button>
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  disabled={printRequiresBarcodeConfirmation}
                  onClick={() => {
                    void printForm.handleSubmit((values) => handlePrintTags(values, "print"))();
                  }}
                >
                  <PrintIcon className="h-4 w-4" aria-hidden />
                  {t("printAction")}
                </Button>
              </FormActions>
            </form>
          </Form>
        </Modal>
      ) : null}
      {confirmDialog}
    </div>
  );
};

export default ProductsPage;

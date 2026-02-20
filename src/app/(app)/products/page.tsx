"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { PageHeader } from "@/components/page-header";
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
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { FormActions } from "@/components/form-layout";
import {
  AddIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ArchiveIcon,
  CopyIcon,
  DeleteIcon,
  DownloadIcon,
  EditIcon,
  EmptyIcon,
  GridViewIcon,
  GripIcon,
  MoreIcon,
  PriceIcon,
  RestoreIcon,
  TableViewIcon,
  TagIcon,
  ViewIcon,
} from "@/components/icons";
import { downloadTableFile, parseCsvTextRows, type DownloadFormat } from "@/lib/fileExport";
import { formatCurrencyKGS, formatNumber } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { isInlineEditingEnabled } from "@/lib/inlineEdit/featureFlag";
import {
  inlineEditRegistry,
  type InlineMutationOperation,
  type InlineProductsContext,
} from "@/lib/inlineEdit/registry";
import { useToast } from "@/components/ui/toast";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";

const ProductsPage = () => {
  const t = useTranslations("products");
  const tInventory = useTranslations("inventory");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const tExports = useTranslations("exports");
  const locale = useLocale();
  const router = useRouter();
  const { data: session } = useSession();
  const role = session?.user?.role;
  const isAdmin = role === "ADMIN";
  const canManagePrices = role === "ADMIN" || role === "MANAGER";
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const trpcUtils = trpc.useUtils();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [productType, setProductType] = useState<"all" | "product" | "bundle">("all");
  const [storeId, setStoreId] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [productsPage, setProductsPage] = useState(1);
  const [productsPageSize, setProductsPageSize] = useState(25);
  const [exportFormat, setExportFormat] = useState<DownloadFormat>("csv");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [categoryInputValue, setCategoryInputValue] = useState("");
  const [bulkCategoryOpen, setBulkCategoryOpen] = useState(false);
  const [bulkCategoryValue, setBulkCategoryValue] = useState("");
  const [bulkStorePriceOpen, setBulkStorePriceOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectingAllResults, setSelectingAllResults] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [printQueue, setPrintQueue] = useState<string[]>([]);
  const [draggedQueueIndex, setDraggedQueueIndex] = useState<number | null>(null);
  const [queueSearch, setQueueSearch] = useState("");
  const inlineEditingEnabled = isInlineEditingEnabled();

  const storesQuery = trpc.stores.list.useQuery();
  const categoriesQuery = trpc.productCategories.list.useQuery();
  const productsListInput = useMemo(
    () => ({
      search: search || undefined,
      category: category || undefined,
      type: productType,
      includeArchived: isAdmin ? showArchived : undefined,
      storeId: storeId || undefined,
      page: productsPage,
      pageSize: productsPageSize,
    }),
    [category, isAdmin, productType, productsPage, productsPageSize, search, showArchived, storeId],
  );
  const productsQuery = trpc.products.list.useQuery(productsListInput, { keepPreviousData: true });
  const products = useMemo(() => productsQuery.data?.items ?? [], [productsQuery.data?.items]);
  const productsTotal = productsQuery.data?.total ?? 0;
  const exportQuery = trpc.products.exportCsv.useQuery(undefined, { enabled: false });
  const archiveMutation = trpc.products.archive.useMutation({
    onSuccess: () => {
      productsQuery.refetch();
      toast({ variant: "success", description: t("archiveSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const restoreMutation = trpc.products.restore.useMutation({
    onSuccess: () => {
      productsQuery.refetch();
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

  const duplicateMutation = trpc.products.duplicate.useMutation({
    onSuccess: (result) => {
      productsQuery.refetch();
      toast({
        variant: "success",
        description: result.copiedBarcodes ? t("duplicateSuccess") : t("duplicateSuccessNoBarcodes"),
      });
      router.push(`/products/${result.productId}`);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const bulkPriceMutation = trpc.storePrices.bulkUpdate.useMutation({
    onSuccess: (result) => {
      productsQuery.refetch();
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
      categoriesQuery.refetch();
      toast({ variant: "success", description: t("categoryCreateSuccess") });
      setCategoryInputValue("");
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const removeCategoryMutation = trpc.productCategories.remove.useMutation({
    onSuccess: (_result, input) => {
      categoriesQuery.refetch();
      if (category === input.name) {
        setCategory("");
      }
      toast({ variant: "success", description: t("categoryRemoveSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const bulkCategoryMutation = trpc.products.bulkUpdateCategory.useMutation({
    onSuccess: (result) => {
      productsQuery.refetch();
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

  const bulkStorePriceMutation = trpc.storePrices.upsert.useMutation({
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const bulkGenerateBarcodesMutation = trpc.products.bulkGenerateBarcodes.useMutation({
    onSuccess: (result) => {
      productsQuery.refetch();
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

  useEffect(() => {
    if (!storeId && storesQuery.data?.length === 1) {
      setStoreId(storesQuery.data[0].id);
    }
  }, [storeId, storesQuery.data]);

  useEffect(() => {
    if (bulkCategoryOpen) {
      setBulkCategoryValue("");
    }
  }, [bulkCategoryOpen]);

  useEffect(() => {
    setProductsPage(1);
  }, [search, category, showArchived, storeId, productType]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [search, category, showArchived, storeId, productType]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    (categoriesQuery.data ?? []).forEach((value) => {
      if (value) {
        set.add(value);
      }
    });
    products.forEach((product) => {
      if (product.category) {
        set.add(product.category);
      }
    });
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
  }, [categoriesQuery.data, products]);

  const showEffectivePrice = Boolean(storeId);
  const inlineProductsContext = useMemo<InlineProductsContext>(
    () => ({
      storeId: storeId || null,
      categories,
    }),
    [categories, storeId],
  );

  const applyProductListPatch = useCallback(
    (
      productId: string,
      patch: (item: NonNullable<typeof productsQuery.data>["items"][number]) => NonNullable<
        typeof productsQuery.data
      >["items"][number],
    ) => {
      trpcUtils.products.list.setData(productsListInput, (current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          items: current.items.map((item) => (item.id === productId ? patch(item) : item)),
        };
      });
    },
    [productsListInput, productsQuery, trpcUtils.products.list],
  );

  const executeInlineProductMutation = useCallback(
    async (operation: InlineMutationOperation) => {
      const previous = trpcUtils.products.list.getData(productsListInput);
      const rollback = () => {
        trpcUtils.products.list.setData(productsListInput, previous);
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
            effectivePriceKgs: showEffectivePrice
              ? item.effectivePriceKgs
              : nextBasePrice,
          };
        });
        try {
          await inlineProductMutation.mutateAsync(operation.input);
        } catch (error) {
          rollback();
          throw error;
        }
        await trpcUtils.products.list.invalidate(productsListInput);
        return;
      }

      if (operation.route === "products.bulkUpdateCategory") {
        applyProductListPatch(operation.input.productIds[0], (item) => ({
          ...item,
          category: operation.input.category,
        }));
        try {
          await inlineCategoryMutation.mutateAsync(operation.input);
        } catch (error) {
          rollback();
          throw error;
        }
        await trpcUtils.products.list.invalidate(productsListInput);
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
        await trpcUtils.products.list.invalidate(productsListInput);
        return;
      }

      throw new Error(`Unsupported inline operation: ${operation.route}`);
    },
    [
      applyProductListPatch,
      inlineCategoryMutation,
      inlineProductMutation,
      inlineStorePriceMutation,
      productsListInput,
      showEffectivePrice,
      trpcUtils.products.list,
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
        template: z.enum(["3x8", "2x5"]),
        storeId: z.string().optional(),
        quantity: z.coerce.number().int().min(1, t("printQtyMin")),
      }),
    [t],
  );

  const printForm = useForm<z.infer<typeof printSchema>>({
    resolver: zodResolver(printSchema),
    defaultValues: {
      template: "3x8",
      storeId: storeId || "",
      quantity: 1,
    },
  });

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
  const allSelected = Boolean(products.length) && products.every((product) => selectedIds.has(product.id));
  const allResultsSelected = productsTotal > 0 && selectedIds.size === productsTotal;

  const queueIdsForQuery = useMemo(
    () => Array.from(new Set(printQueue)).sort(),
    [printQueue],
  );
  const queueProductsQuery = trpc.products.byIds.useQuery(
    { ids: queueIdsForQuery },
    { enabled: printOpen && queueIdsForQuery.length > 0 },
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
  const canDragQueue = printQueue.length <= 50;
  const filteredQueueEntries = useMemo(() => {
    const query = queueSearch.trim().toLowerCase();
    return printQueue.reduce<Array<{ productId: string; queueIndex: number }>>(
      (acc, productId, queueIndex) => {
        if (!query) {
          acc.push({ productId, queueIndex });
          return acc;
        }
        const product = productById.get(productId);
        const name = product?.name ?? "";
        const sku = product?.sku ?? "";
        const barcodes =
          product?.barcodes?.map((barcode) => barcode.value).join(" ") ?? "";
        const matched = [name, sku, barcodes].some((value) =>
          value.toLowerCase().includes(query),
        );
        if (matched) {
          acc.push({ productId, queueIndex });
        }
        return acc;
      },
      [],
    );
  }, [printQueue, productById, queueSearch]);
  const selectedProducts = useMemo(
    () => products.filter((product) => selectedIds.has(product.id)),
    [products, selectedIds],
  );
  const hasActiveSelected = selectedProducts.some((product) => !product.isDeleted);
  const hasArchivedSelected = selectedProducts.some((product) => product.isDeleted);

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

  useEffect(() => {
    if (printOpen) {
      printForm.reset({
        template: "3x8",
        storeId: storeId || "",
        quantity: 1,
      });
      setPrintQueue(selectedList);
      setDraggedQueueIndex(null);
      setQueueSearch("");
    } else {
      setPrintQueue([]);
      setQueueSearch("");
    }
  }, [printOpen, printForm, storeId, selectedList]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") {
      return;
    }
    const target = window as typeof window & {
      __seedPrintQueue?: (count?: number) => void;
    };
    target.__seedPrintQueue = (count = 500) => {
      const ids = products.slice(0, count).map((product) => product.id);
      setSelectedIds(new Set(ids));
      setPrintQueue(ids);
      setPrintOpen(true);
    };
    return () => {
      delete target.__seedPrintQueue;
    };
  }, [products]);

  useEffect(() => {
    if (bulkStorePriceOpen) {
      bulkStorePriceForm.reset({
        storeId: storeId || "",
        priceKgs: 0,
      });
    }
  }, [bulkStorePriceOpen, bulkStorePriceForm, storeId]);

  const storeNameById = useMemo(
    () => new Map((storesQuery.data ?? []).map((store) => [store.id, store.name])),
    [storesQuery.data],
  );
  const totalStores = storesQuery.data?.length ?? 0;
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
  const getProductActions = (product: ProductRow) => [
    ...(isAdmin
      ? product.isDeleted
        ? [
            {
              key: "restore",
              label: t("restore"),
              icon: RestoreIcon,
              onSelect: async () => {
                if (!(await confirm({ description: t("confirmRestore"), confirmVariant: "danger" }))) {
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
                if (!(await confirm({ description: t("confirmArchive"), confirmVariant: "danger" }))) {
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
          },
        ]),
  ];

  const handleExport = async () => {
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
      format: exportFormat,
      fileNameBase: `products-${locale}`,
      header,
      rows: body,
    });
  };

  const movePrintQueueItem = (fromIndex: number, toIndex: number) => {
    setPrintQueue((prev) => {
      if (fromIndex === toIndex) {
        return prev;
      }
      const next = [...prev];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return next;
    });
  };

  const handlePrintTags = async (values: z.infer<typeof printSchema>) => {
    const queue = printQueue;
    if (!queue.length) {
      return;
    }
    try {
      const response = await fetch("/api/price-tags/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template: values.template,
          storeId: values.storeId || undefined,
          items: queue.map((productId) => ({
            productId,
            quantity: values.quantity,
          })),
        }),
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "priceTagsFailed");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `price-tags-${values.template}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
      setPrintOpen(false);
      setSelectedIds(new Set());
      setPrintQueue([]);
    } catch (error) {
      toast({ variant: "error", description: t("priceTagsFailed") });
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
      productsQuery.refetch();
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
      productsQuery.refetch();
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
    const trimmed = bulkCategoryValue.trim();
    bulkCategoryMutation.mutate({
      productIds: selectedList,
      category: trimmed ? trimmed : null,
    });
  };

  const handleCategoryCreate = () => {
    const trimmed = categoryInputValue.trim();
    if (!trimmed) {
      return;
    }
    createCategoryMutation.mutate({ name: trimmed });
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
      productsQuery.refetch();
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

  return (
    <div>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <>
            {isAdmin ? (
              <>
                <Link href="/products/new" className="w-full sm:w-auto">
                  <Button className="w-full sm:w-auto" data-tour="products-create">
                    <AddIcon className="h-4 w-4" aria-hidden />
                    {t("newProduct")}
                  </Button>
                </Link>
                <Link href="/products/new?type=bundle" className="w-full sm:w-auto">
                  <Button variant="secondary" className="w-full sm:w-auto">
                    <AddIcon className="h-4 w-4" aria-hidden />
                    {t("newBundle")}
                  </Button>
                </Link>
              </>
            ) : null}
            {canManagePrices ? (
              <Button
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => setBulkOpen(true)}
                disabled={!storesQuery.data?.length}
              >
                <EditIcon className="h-4 w-4" aria-hidden />
                {t("bulkPriceUpdate")}
              </Button>
            ) : null}
            {selectedList.length ? (
              <Button
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => setPrintOpen(true)}
                data-tour="products-print-tags"
              >
                <DownloadIcon className="h-4 w-4" aria-hidden />
                {t("printPriceTags")}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              className="w-full sm:w-auto"
              onClick={handleExport}
              disabled={exportQuery.isFetching}
            >
              {exportQuery.isFetching ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <DownloadIcon className="h-4 w-4" aria-hidden />
              )}
              {exportQuery.isFetching
                ? tCommon("loading")
                : exportFormat === "csv"
                  ? t("exportCsv")
                  : t("exportXlsx")}
            </Button>
            <div className="w-full sm:w-[100px]">
              <Select
                value={exportFormat}
                onValueChange={(value) => setExportFormat(value as DownloadFormat)}
              >
                <SelectTrigger aria-label={tExports("formatLabel")}>
                  <SelectValue placeholder={tExports("formatLabel")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="csv">{tExports("formats.csv")}</SelectItem>
                  <SelectItem value="xlsx">{tExports("formats.xlsx")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
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
                  {storesQuery.data?.map((store) => (
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
                onValueChange={(value) =>
                  setProductType(value as "all" | "product" | "bundle")
                }
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
            {isAdmin ? (
              <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
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
          <div className="inline-flex w-full items-center gap-1 rounded-lg border border-border p-1 sm:w-auto">
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
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        data-tour="products-print-tags"
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shadow-none"
                        aria-label={t("printPriceTags")}
                        onClick={() => setPrintOpen(true)}
                      >
                        <DownloadIcon className="h-4 w-4" aria-hidden />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("printPriceTags")}</TooltipContent>
                  </Tooltip>
                  {hasActiveSelected && isAdmin ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-danger shadow-none hover:text-danger"
                          aria-label={t("bulkArchive")}
                          onClick={handleBulkArchive}
                        >
                          <ArchiveIcon className="h-4 w-4" aria-hidden />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("bulkArchive")}</TooltipContent>
                    </Tooltip>
                  ) : null}
                  {hasArchivedSelected && isAdmin ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shadow-none"
                          aria-label={t("bulkRestore")}
                          onClick={handleBulkRestore}
                        >
                          <RestoreIcon className="h-4 w-4" aria-hidden />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("bulkRestore")}</TooltipContent>
                    </Tooltip>
                  ) : null}
                  {isAdmin ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shadow-none"
                          aria-label={t("bulkSetCategory")}
                          onClick={() => setBulkCategoryOpen(true)}
                        >
                          <TagIcon className="h-4 w-4" aria-hidden />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("bulkSetCategory")}</TooltipContent>
                    </Tooltip>
                  ) : null}
                  {canManagePrices ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shadow-none"
                          aria-label={t("bulkSetStorePrice")}
                          onClick={() => setBulkStorePriceOpen(true)}
                        >
                          <PriceIcon className="h-4 w-4" aria-hidden />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("bulkSetStorePrice")}</TooltipContent>
                    </Tooltip>
                  ) : null}
                  {isAdmin ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="w-full sm:w-auto"
                      onClick={() => void handleBulkGenerateBarcodes()}
                      disabled={bulkGenerateBarcodesMutation.isLoading}
                    >
                      {bulkGenerateBarcodesMutation.isLoading ? (
                        <Spinner className="h-4 w-4" />
                      ) : (
                        <AddIcon className="h-4 w-4" aria-hidden />
                      )}
                      {bulkGenerateBarcodesMutation.isLoading
                        ? tCommon("loading")
                        : t("bulkGenerateBarcodes")}
                    </Button>
                  ) : null}
                </SelectionToolbar>
              </TooltipProvider>
            </div>
          ) : null}
          <ResponsiveDataList
            items={products}
            getKey={(product) => product.id}
            page={productsPage}
            totalItems={productsTotal}
            onPageChange={setProductsPage}
            onPageSizeChange={setProductsPageSize}
            renderDesktop={(visibleItems) =>
              viewMode === "table" ? (
                <div className="overflow-x-auto">
                  <TooltipProvider>
                    <InlineEditTableProvider>
                      <Table className="min-w-[720px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-border bg-background text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                            checked={allSelected}
                            onChange={toggleSelectAll}
                            aria-label={t("selectAll")}
                          />
                        </TableHead>
                        <TableHead>{t("sku")}</TableHead>
                        <TableHead>{t("imageLabel")}</TableHead>
                        <TableHead>{t("name")}</TableHead>
                        <TableHead className="hidden md:table-cell">{t("category")}</TableHead>
                        <TableHead className="hidden lg:table-cell">{t("unit")}</TableHead>
                        <TableHead>{tInventory("onHand")}</TableHead>
                        <TableHead>{t("salePrice")}</TableHead>
                        <TableHead>{t("avgCost")}</TableHead>
                        <TableHead>{t("barcodes")}</TableHead>
                        <TableHead>{t("stores")}</TableHead>
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
                        return (
                          <TableRow key={product.id}>
                            <TableCell>
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-border bg-background text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                                checked={selectedIds.has(product.id)}
                                onChange={() => toggleSelect(product.id)}
                                aria-label={t("selectProduct", { name: product.name })}
                              />
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{product.sku}</TableCell>
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
                                  <EmptyIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
                                </div>
                              )}
                            </TableCell>
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
                            <TableCell className="text-xs text-muted-foreground hidden md:table-cell">
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
                            </TableCell>
                            <TableCell className="hidden lg:table-cell">
                              <span>{product.unit}</span>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {formatNumber(product.onHandQty, locale)}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              <div className="flex flex-wrap items-center gap-2">
                                <InlineEditableCell
                                  rowId={product.id}
                                  row={product}
                                  value={showEffectivePrice ? product.effectivePriceKgs : product.basePriceKgs}
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
                            <TableCell className="text-xs text-muted-foreground">
                              {product.avgCostKgs !== null && product.avgCostKgs !== undefined
                                ? formatCurrencyKGS(product.avgCostKgs, locale)
                                : tCommon("notAvailable")}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {barcodeSummary.label}
                            </TableCell>
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
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {isAdmin ? (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="shadow-none"
                                        aria-label={tCommon("actions")}
                                      >
                                        <MoreIcon className="h-4 w-4" aria-hidden />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      {product.isDeleted ? (
                                        <DropdownMenuItem
                                          onClick={async () => {
                                            if (!(await confirm({ description: t("confirmRestore"), confirmVariant: "danger" }))) {
                                              return;
                                            }
                                            restoreMutation.mutate({ productId: product.id });
                                          }}
                                        >
                                          {t("restore")}
                                        </DropdownMenuItem>
                                      ) : (
                                        <>
                                          <DropdownMenuItem
                                            asChild
                                          >
                                            <Link
                                              href={`/products/${product.id}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                            >
                                              {tCommon("edit")}
                                            </Link>
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            onClick={() =>
                                              duplicateMutation.mutate({
                                                productId: product.id,
                                              })
                                            }
                                          >
                                            {t("duplicate")}
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            onClick={async () => {
                                              if (!(await confirm({ description: t("confirmArchive"), confirmVariant: "danger" }))) {
                                                return;
                                              }
                                              archiveMutation.mutate({ productId: product.id });
                                            }}
                                          >
                                            {tCommon("archive")}
                                          </DropdownMenuItem>
                                        </>
                                      )}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                ) : (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="shadow-none"
                                        onClick={() => router.push(`/products/${product.id}`)}
                                        aria-label={tCommon("view")}
                                      >
                                        <ViewIcon className="h-4 w-4" aria-hidden />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>{tCommon("view")}</TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                    </InlineEditTableProvider>
                  </TooltipProvider>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {visibleItems.map((product) => {
                    const barcodeSummary = getBarcodeSummary(product.barcodes);
                    const previewImageUrl = getProductPreviewUrl(product);
                    const actions = getProductActions(product);
                    return (
                      <div
                        key={product.id}
                        className="overflow-hidden rounded-lg border border-border bg-card"
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
                              className="h-4 w-4 rounded border-border bg-background text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                              checked={selectedIds.has(product.id)}
                              onChange={() => toggleSelect(product.id)}
                              aria-label={t("selectProduct", { name: product.name })}
                            />
                          </label>
                        </div>
                        <div className="space-y-3 p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-foreground">
                                {product.name}
                              </p>
                              <p className="text-xs text-muted-foreground">{product.sku}</p>
                            </div>
                            <RowActions
                              actions={actions}
                              maxInline={3}
                              moreLabel={tCommon("tooltips.moreActions")}
                              className="shrink-0"
                            />
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="muted">
                              {product.isBundle ? t("typeBundle") : t("typeProduct")}
                            </Badge>
                            {product.isDeleted ? <Badge variant="muted">{t("archived")}</Badge> : null}
                            {product.category ? <Badge variant="muted">{product.category}</Badge> : null}
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                            <div>
                              <p>{t("salePrice")}</p>
                              <p className="text-sm font-semibold text-foreground">
                                {showEffectivePrice
                                  ? product.effectivePriceKgs !== null &&
                                    product.effectivePriceKgs !== undefined
                                    ? formatCurrencyKGS(product.effectivePriceKgs, locale)
                                    : tCommon("notAvailable")
                                  : product.basePriceKgs !== null &&
                                      product.basePriceKgs !== undefined
                                    ? formatCurrencyKGS(product.basePriceKgs, locale)
                                    : tCommon("notAvailable")}
                              </p>
                            </div>
                            <div>
                              <p>{tInventory("onHand")}</p>
                              <p className="text-sm font-semibold text-foreground">
                                {formatNumber(product.onHandQty, locale)}
                              </p>
                            </div>
                            <div>
                              <p>{t("avgCost")}</p>
                              <p className="text-sm font-semibold text-foreground">
                                {product.avgCostKgs !== null && product.avgCostKgs !== undefined
                                  ? formatCurrencyKGS(product.avgCostKgs, locale)
                                  : tCommon("notAvailable")}
                              </p>
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

              return (
                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 rounded border-border bg-background text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
                          <span className="text-sm font-semibold text-foreground">{product.name}</span>
                          <Badge variant="muted">
                            {product.isBundle ? t("typeBundle") : t("typeProduct")}
                          </Badge>
                          {product.isDeleted ? (
                            <Badge variant="muted">{t("archived")}</Badge>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t("sku")}: {product.sku}
                        </p>
                      </div>
                    </label>
                    <RowActions
                      actions={actions}
                      moreLabel={tCommon("tooltips.moreActions")}
                      className="shrink-0"
                    />
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                    <div className="flex items-center justify-between gap-2">
                      <span>{t("category")}</span>
                      <span className="text-foreground">
                        {product.category ?? tCommon("notAvailable")}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span>{t("unit")}</span>
                      <span className="text-foreground">{product.unit}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span>{t("salePrice")}</span>
                      <span className="text-foreground">
                        {showEffectivePrice
                          ? product.effectivePriceKgs !== null &&
                            product.effectivePriceKgs !== undefined
                            ? formatCurrencyKGS(product.effectivePriceKgs, locale)
                            : tCommon("notAvailable")
                          : product.basePriceKgs !== null && product.basePriceKgs !== undefined
                            ? formatCurrencyKGS(product.basePriceKgs, locale)
                            : tCommon("notAvailable")}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span>{tInventory("onHand")}</span>
                      <span className="text-foreground">
                        {formatNumber(product.onHandQty, locale)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span>{t("avgCost")}</span>
                      <span className="text-foreground">
                        {product.avgCostKgs !== null && product.avgCostKgs !== undefined
                          ? formatCurrencyKGS(product.avgCostKgs, locale)
                          : tCommon("notAvailable")}
                      </span>
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
          {productsQuery.isLoading ? (
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
          {productsQuery.error ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-danger">
              <span>{translateError(tErrors, productsQuery.error)}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => productsQuery.refetch()}
              >
                {tErrors("tryAgain")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

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

            <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
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
              <Button type="submit" className="w-full sm:w-auto" disabled={bulkPriceMutation.isLoading}>
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
            <label className="text-sm font-medium text-foreground">{t("category")}</label>
            <Input
              value={categoryInputValue}
              onChange={(event) => setCategoryInputValue(event.target.value)}
              placeholder={t("categoriesManagePlaceholder")}
              list="manage-category-options"
            />
            <datalist id="manage-category-options">
              {categories.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
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

        <div className="space-y-2 mt-4">
          {categories.length ? (
            categories.map((item) => (
              <div
                key={item}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-2"
              >
                <span className="text-sm text-foreground">{item}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-danger"
                  aria-label={tCommon("delete")}
                  onClick={() => removeCategoryMutation.mutate({ name: item })}
                  disabled={removeCategoryMutation.isLoading}
                >
                  <DeleteIcon className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            ))
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
            <Input
              value={bulkCategoryValue}
              onChange={(event) => setBulkCategoryValue(event.target.value)}
              placeholder={t("bulkCategoryPlaceholder")}
              list="bulk-category-options"
            />
            <p className="text-xs text-muted-foreground">{t("bulkCategoryHint")}</p>
            <datalist id="bulk-category-options">
              {categories.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
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
              disabled={bulkCategoryMutation.isLoading}
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
        open={printOpen}
        onOpenChange={(open) => {
          if (!open) {
            setPrintOpen(false);
          }
        }}
        title={t("printPriceTags")}
        subtitle={t("printSubtitle", { count: printQueue.length })}
        className="h-[92dvh] sm:h-[85dvh] sm:max-w-2xl"
        bodyClassName="p-0 min-h-0 overflow-hidden"
      >
        <Form {...printForm}>
          <form
            className="flex h-full min-h-0 flex-col"
            onSubmit={printForm.handleSubmit((values) => handlePrintTags(values))}
          >
            <div className="sticky top-0 z-10 border-b border-border/70 bg-card px-4 py-3 sm:px-6 sm:pt-6 sm:pb-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
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
                            <SelectItem value="3x8">{t("template3x8")}</SelectItem>
                            <SelectItem value="2x5">{t("template2x5")}</SelectItem>
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
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 sm:mt-4">
                <div className="w-full sm:max-w-xs">
                  <Input
                    value={queueSearch}
                    onChange={(event) => setQueueSearch(event.target.value)}
                    placeholder={t("printQueueSearchPlaceholder")}
                    aria-label={t("printQueueSearchLabel")}
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  {queueSearch.trim()
                    ? t("printQueueFiltered", {
                        filtered: filteredQueueEntries.length,
                        total: printQueue.length,
                      })
                    : t("printQueueSelected", { count: printQueue.length })}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPrintQueue([])}
                  disabled={!printQueue.length}
                >
                  <DeleteIcon className="h-4 w-4" aria-hidden />
                  {t("printQueueClear")}
                </Button>
              </div>
              <div className="mt-3 flex items-center justify-between text-sm sm:mt-4">
                <span className="font-medium text-foreground">{t("printQueueTitle")}</span>
                <span className="text-xs text-muted-foreground">
                  {canDragQueue ? t("printQueueHint") : t("printQueueNoDragHint")}
                </span>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col px-4 py-3 sm:px-6 sm:py-4">
              {printQueue.length ? (
                filteredQueueEntries.length ? (
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
                    <div className="space-y-2">
                      {filteredQueueEntries.map(({ productId, queueIndex }) => {
                        const product = productById.get(productId);
                        const canMoveUp = queueIndex > 0;
                        const canMoveDown = queueIndex < printQueue.length - 1;
                        const isDragging = draggedQueueIndex === queueIndex;
                        return (
                          <div
                            key={`${productId}-${queueIndex}`}
                            className={`flex h-[72px] items-center justify-between gap-3 rounded-md border border-border bg-card px-3 ${
                              isDragging ? "opacity-60" : ""
                            }`}
                            draggable={canDragQueue}
                            onDragStart={() => {
                              if (!canDragQueue) {
                                return;
                              }
                              setDraggedQueueIndex(queueIndex);
                            }}
                            onDragEnd={() => {
                              if (!canDragQueue) {
                                return;
                              }
                              setDraggedQueueIndex(null);
                            }}
                            onDragOver={(event) => {
                              if (!canDragQueue || draggedQueueIndex === null) {
                                return;
                              }
                              event.preventDefault();
                            }}
                            onDrop={(event) => {
                              if (!canDragQueue) {
                                return;
                              }
                              event.preventDefault();
                              if (draggedQueueIndex === null || draggedQueueIndex === queueIndex) {
                                return;
                              }
                              movePrintQueueItem(draggedQueueIndex, queueIndex);
                              setDraggedQueueIndex(null);
                            }}
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              {canDragQueue ? (
                                <GripIcon className="h-4 w-4 text-muted-foreground/80" aria-hidden />
                              ) : null}
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-foreground">
                                  {product?.name ?? tCommon("notAvailable")}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {product?.sku ?? productId.slice(0, 8).toUpperCase()}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="shadow-none"
                                    aria-label={t("printQueueMoveUp")}
                                    onClick={() => canMoveUp && movePrintQueueItem(queueIndex, queueIndex - 1)}
                                    disabled={!canMoveUp}
                                  >
                                    <ArrowUpIcon className="h-4 w-4" aria-hidden />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>{t("printQueueMoveUp")}</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="shadow-none"
                                    aria-label={t("printQueueMoveDown")}
                                    onClick={() => canMoveDown && movePrintQueueItem(queueIndex, queueIndex + 1)}
                                    disabled={!canMoveDown}
                                  >
                                    <ArrowDownIcon className="h-4 w-4" aria-hidden />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>{t("printQueueMoveDown")}</TooltipContent>
                              </Tooltip>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("printQueueNoResults")}</p>
                )
              ) : (
                <p className="text-xs text-muted-foreground">{t("printQueueEmpty")}</p>
              )}
            </div>
            <div className="sticky bottom-0 z-10 border-t border-border/70 bg-card px-4 py-3 sm:px-6 sm:py-4">
              <FormActions>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full sm:w-auto"
                  onClick={() => setPrintOpen(false)}
                >
                  {tCommon("cancel")}
                </Button>
                <Button type="submit" className="w-full sm:w-auto">
                  <DownloadIcon className="h-4 w-4" aria-hidden />
                  {t("printDownload")}
                </Button>
              </FormActions>
            </div>
          </form>
        </Form>
      </Modal>
      {confirmDialog}
    </div>
  );
};

export default ProductsPage;

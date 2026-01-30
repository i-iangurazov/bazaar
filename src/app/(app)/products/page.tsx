"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import Papa from "papaparse";
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
  DownloadIcon,
  EditIcon,
  EmptyIcon,
  GripIcon,
  MoreIcon,
  PriceIcon,
  RestoreIcon,
  TagIcon,
  UploadIcon,
  ViewIcon,
} from "@/components/icons";
import { formatCurrencyKGS } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { useToast } from "@/components/ui/toast";

type ImportRow = {
  sku: string;
  name: string;
  category?: string;
  unit: string;
  description?: string;
  photoUrl?: string;
  barcodes?: string[];
};

const normalizeValue = (value: unknown) =>
  typeof value === "string" ? value.trim() : String(value ?? "").trim();

const parseBarcodes = (value: string) =>
  value
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter(Boolean);

const ProductsPage = () => {
  const t = useTranslations("products");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const { data: session } = useSession();
  const role = session?.user?.role;
  const isAdmin = role === "ADMIN";
  const canManagePrices = role === "ADMIN" || role === "MANAGER";
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [storeId, setStoreId] = useState("");
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [priceTarget, setPriceTarget] = useState<{
    id: string;
    name: string;
    basePriceKgs: number | null;
    effectivePriceKgs: number | null;
  } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCategoryOpen, setBulkCategoryOpen] = useState(false);
  const [bulkCategoryValue, setBulkCategoryValue] = useState("");
  const [bulkStorePriceOpen, setBulkStorePriceOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [printOpen, setPrintOpen] = useState(false);
  const [printQueue, setPrintQueue] = useState<string[]>([]);
  const [draggedQueueIndex, setDraggedQueueIndex] = useState<number | null>(null);

  const storesQuery = trpc.stores.list.useQuery();
  const productsQuery = trpc.products.list.useQuery({
    search: search || undefined,
    category: category || undefined,
    includeArchived: isAdmin ? showArchived : undefined,
    storeId: storeId || undefined,
  });
  const importMutation = trpc.products.importCsv.useMutation({
    onSuccess: () => {
      productsQuery.refetch();
      setImportRows([]);
      toast({ variant: "success", description: t("importSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
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

  const storePriceMutation = trpc.storePrices.upsert.useMutation({
    onSuccess: () => {
      productsQuery.refetch();
      toast({ variant: "success", description: t("priceSaved") });
      setPriceTarget(null);
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

  const categories = useMemo(() => {
    const set = new Set<string>();
    productsQuery.data?.forEach((product) => {
      if (product.category) {
        set.add(product.category);
      }
    });
    return Array.from(set.values());
  }, [productsQuery.data]);

  const showEffectivePrice = Boolean(storeId);
  const showPriceAction = canManagePrices && Boolean(storeId);

  const priceSchema = useMemo(
    () =>
      z.object({
        priceKgs: z.coerce.number().min(0, t("priceNonNegative")),
      }),
    [t],
  );

  const priceForm = useForm<z.infer<typeof priceSchema>>({
    resolver: zodResolver(priceSchema),
    defaultValues: { priceKgs: 0 },
  });

  useEffect(() => {
    if (priceTarget) {
      priceForm.reset({
        priceKgs: priceTarget.effectivePriceKgs ?? priceTarget.basePriceKgs ?? 0,
      });
    }
  }, [priceTarget, priceForm]);

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
      includeArchived: isAdmin ? showArchived : undefined,
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

  const selectedList = useMemo(
    () =>
      (productsQuery.data ?? [])
        .filter((product) => selectedIds.has(product.id))
        .map((product) => product.id),
    [productsQuery.data, selectedIds],
  );
  const allSelected =
    Boolean(productsQuery.data?.length) &&
    selectedIds.size === (productsQuery.data?.length ?? 0);

  const productById = useMemo(
    () => new Map((productsQuery.data ?? []).map((product) => [product.id, product])),
    [productsQuery.data],
  );
  const selectedProducts = useMemo(
    () => (productsQuery.data ?? []).filter((product) => selectedIds.has(product.id)),
    [productsQuery.data, selectedIds],
  );
  const hasActiveSelected = selectedProducts.some((product) => !product.isDeleted);
  const hasArchivedSelected = selectedProducts.some((product) => product.isDeleted);

  const toggleSelectAll = () => {
    if (!productsQuery.data?.length) {
      return;
    }
    setSelectedIds(() => {
      if (allSelected) {
        return new Set();
      }
      return new Set(productsQuery.data.map((product) => product.id));
    });
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
    } else {
      setPrintQueue([]);
    }
  }, [printOpen, printForm, storeId, selectedList]);

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

  const handleImportFile = (file: File) => {
    setImportError(null);
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows: ImportRow[] = [];
        const errors: string[] = [];
        results.data.forEach((row, index) => {
          const sku = normalizeValue(row.sku ?? row.SKU);
          const name = normalizeValue(row.name ?? row.Name);
          const unit = normalizeValue(row.unit ?? row.Unit);
          if (!sku || !name || !unit) {
            errors.push(`${t("rowInvalid")} #${index + 1}`);
            return;
          }
          const barcodesValue = normalizeValue(row.barcodes ?? row.Barcodes ?? "");
          rows.push({
            sku,
            name,
            unit,
            category: normalizeValue(row.category ?? row.Category) || undefined,
            description: normalizeValue(row.description ?? row.Description) || undefined,
            photoUrl: normalizeValue(row.photoUrl ?? row.PhotoUrl) || undefined,
            barcodes: barcodesValue ? parseBarcodes(barcodesValue) : undefined,
          });
        });
        if (errors.length) {
          setImportError(errors[0]);
        }
        setImportRows(rows);
      },
      error: () => {
        setImportError(t("importParseError"));
      },
    });
  };

  const handleExport = async () => {
    const { data, error } = await exportQuery.refetch();
    if (error) {
      toast({ variant: "error", description: translateError(tErrors, error) });
      return;
    }
    if (!data) {
      return;
    }
    const blob = new Blob([data], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `products-${locale}.csv`;
    link.click();
    URL.revokeObjectURL(url);
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
    const queue = printQueue.length ? printQueue : selectedList;
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
    if (!window.confirm(t("confirmBulkArchive"))) {
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
    if (!window.confirm(t("confirmBulkRestore"))) {
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

  return (
    <div>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <>
            {isAdmin ? (
              <Link href="/products/new" className="w-full sm:w-auto">
                <Button className="w-full sm:w-auto">
                  <AddIcon className="h-4 w-4" aria-hidden />
                  {t("newProduct")}
                </Button>
              </Link>
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
              {exportQuery.isFetching ? tCommon("loading") : t("exportCsv")}
            </Button>
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
              >
                <DownloadIcon className="h-4 w-4" aria-hidden />
                {t("printPriceTags")}
              </Button>
            ) : null}
            {isAdmin ? (
              <Button
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => setShowImport((prev) => !prev)}
              >
                <UploadIcon className="h-4 w-4" aria-hidden />
                {showImport ? t("hideImport") : t("importCsv")}
              </Button>
            ) : null}
          </>
        }
        filters={
          <>
            <Input
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
            <div className="w-full sm:max-w-xs">
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
            </div>
            {isAdmin ? (
              <div className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2">
                <Switch
                  checked={showArchived}
                  onCheckedChange={setShowArchived}
                  aria-label={t("showArchived")}
                />
                <span className="text-sm text-gray-600">{t("showArchived")}</span>
              </div>
            ) : null}
          </>
        }
      />

      {isAdmin && showImport ? (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>{t("importCsv")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  handleImportFile(file);
                }
              }}
            />
            {importRows.length ? (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">
                  {t("importPreview", { count: importRows.length })}
                </p>
                <div className="overflow-x-auto">
                  <Table className="min-w-[520px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("sku")}</TableHead>
                        <TableHead>{t("name")}</TableHead>
                        <TableHead className="hidden sm:table-cell">{t("category")}</TableHead>
                        <TableHead className="hidden sm:table-cell">{t("unit")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importRows.slice(0, 5).map((row) => (
                        <TableRow key={`${row.sku}-${row.name}`}>
                          <TableCell className="text-xs text-gray-500">{row.sku}</TableCell>
                          <TableCell className="font-medium">{row.name}</TableCell>
                          <TableCell className="text-xs text-gray-500 hidden sm:table-cell">
                            {row.category ?? tCommon("notAvailable")}
                          </TableCell>
                          <TableCell className="text-xs text-gray-500 hidden sm:table-cell">
                            {row.unit}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <Button
                  onClick={() => importMutation.mutate({ rows: importRows })}
                  disabled={importMutation.isLoading}
                >
                  {importMutation.isLoading ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <UploadIcon className="h-4 w-4" aria-hidden />
                  )}
                  {importMutation.isLoading ? tCommon("loading") : t("confirmImport")}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <EmptyIcon className="h-4 w-4" aria-hidden />
                {t("importHint")}
              </div>
            )}
            {importError ? <p className="text-sm text-red-500">{importError}</p> : null}
            {importMutation.error ? (
              <p className="text-sm text-red-500">
                {translateError(tErrors, importMutation.error)}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {selectedList.length ? (
            <div className="mb-3">
              <TooltipProvider>
                <SelectionToolbar
                  count={selectedList.length}
                  label={tCommon("selectedCount", { count: selectedList.length })}
                  clearLabel={tCommon("clearSelection")}
                  onClear={() => setSelectedIds(new Set())}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
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
                </SelectionToolbar>
              </TooltipProvider>
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <TooltipProvider>
              <Table className="min-w-[720px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-ink"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        aria-label={t("selectAll")}
                      />
                    </TableHead>
                    <TableHead>{t("sku")}</TableHead>
                    <TableHead>{t("name")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("category")}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t("unit")}</TableHead>
                    <TableHead>{t("basePrice")}</TableHead>
                    {showEffectivePrice ? <TableHead>{t("effectivePrice")}</TableHead> : null}
                    <TableHead>{t("barcodes")}</TableHead>
                    <TableHead>{t("stores")}</TableHead>
                    <TableHead>{tCommon("actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {productsQuery.data?.map((product) => {
                    const barcodeSummary = getBarcodeSummary(product.barcodes);
                    const storeInfo = getStoreInfo(
                      product.inventorySnapshots.map((snapshot) => snapshot.storeId),
                    );
                    return (
                      <TableRow key={product.id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-ink"
                            checked={selectedIds.has(product.id)}
                            onChange={() => toggleSelect(product.id)}
                            aria-label={t("selectProduct", { name: product.name })}
                          />
                        </TableCell>
                        <TableCell className="text-xs text-gray-500">{product.sku}</TableCell>
                        <TableCell className="font-medium">
                          <div className="flex flex-wrap items-center gap-2">
                            <span>{product.name}</span>
                            {product.isDeleted ? (
                              <Badge variant="muted">{t("archived")}</Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-gray-500 hidden md:table-cell">
                          {product.category ?? tCommon("notAvailable")}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">{product.unit}</TableCell>
                        <TableCell className="text-xs text-gray-500">
                          {product.basePriceKgs !== null && product.basePriceKgs !== undefined
                            ? formatCurrencyKGS(product.basePriceKgs, locale)
                            : tCommon("notAvailable")}
                        </TableCell>
                        {showEffectivePrice ? (
                          <TableCell className="text-xs text-gray-500">
                            <div className="flex flex-wrap items-center gap-2">
                              <span>
                                {product.effectivePriceKgs !== null &&
                                product.effectivePriceKgs !== undefined
                                  ? formatCurrencyKGS(product.effectivePriceKgs, locale)
                                  : tCommon("notAvailable")}
                              </span>
                              {product.priceOverridden ? (
                                <Badge variant="muted">{t("priceOverridden")}</Badge>
                              ) : null}
                            </div>
                          </TableCell>
                        ) : null}
                        <TableCell className="text-xs text-gray-500">
                          {barcodeSummary.label}
                        </TableCell>
                        <TableCell className="text-xs text-gray-500">
                          {storeInfo.names.length ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help text-ink">
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
                                  {showPriceAction ? (
                                    <DropdownMenuItem
                                      onClick={() =>
                                        setPriceTarget({
                                          id: product.id,
                                          name: product.name,
                                          basePriceKgs: product.basePriceKgs ?? null,
                                          effectivePriceKgs: product.effectivePriceKgs ?? null,
                                        })
                                      }
                                    >
                                      {t("setStorePrice")}
                                    </DropdownMenuItem>
                                  ) : null}
                                  {product.isDeleted ? (
                                    <DropdownMenuItem
                                      onClick={() => {
                                        if (!window.confirm(t("confirmRestore"))) {
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
                                        onClick={() => router.push(`/products/${product.id}`)}
                                      >
                                        {tCommon("edit")}
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => {
                                          if (!window.confirm(t("confirmArchive"))) {
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
                            ) : showPriceAction ? (
                              <>
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
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="shadow-none"
                                      onClick={() =>
                                        setPriceTarget({
                                          id: product.id,
                                          name: product.name,
                                          basePriceKgs: product.basePriceKgs ?? null,
                                          effectivePriceKgs: product.effectivePriceKgs ?? null,
                                        })
                                      }
                                      aria-label={t("setStorePrice")}
                                    >
                                      <EditIcon className="h-4 w-4" aria-hidden />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{t("setStorePrice")}</TooltipContent>
                                </Tooltip>
                              </>
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
            </TooltipProvider>
          </div>
          {productsQuery.isLoading ? (
            <p className="mt-4 text-sm text-gray-500">{tCommon("loading")}</p>
          ) : !productsQuery.data?.length ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-gray-500">
              <div className="flex items-center gap-2">
                <EmptyIcon className="h-4 w-4" aria-hidden />
                {t("noProducts")}
              </div>
              {isAdmin ? (
                <Link href="/products/new" className="w-full sm:w-auto">
                  <Button className="w-full sm:w-auto">
                    <AddIcon className="h-4 w-4" aria-hidden />
                    {t("newProduct")}
                  </Button>
                </Link>
              ) : null}
            </div>
          ) : null}
          {productsQuery.error ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-red-500">
              <span>{translateError(tErrors, productsQuery.error)}</span>
              <Button
                type="button"
                variant="ghost"
                className="h-8 px-3"
                onClick={() => productsQuery.refetch()}
              >
                {tErrors("tryAgain")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Modal
        open={Boolean(priceTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setPriceTarget(null);
          }
        }}
        title={t("setStorePrice")}
        subtitle={priceTarget?.name ?? ""}
      >
        <Form {...priceForm}>
          <form
            className="space-y-4"
            onSubmit={priceForm.handleSubmit((values) => {
              if (!priceTarget || !storeId) {
                return;
              }
              storePriceMutation.mutate({
                storeId,
                productId: priceTarget.id,
                priceKgs: values.priceKgs,
              });
            })}
          >
            <FormField
              control={priceForm.control}
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
                onClick={() => setPriceTarget(null)}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                className="w-full sm:w-auto"
                disabled={storePriceMutation.isLoading}
              >
                {storePriceMutation.isLoading ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <EditIcon className="h-4 w-4" aria-hidden />
                )}
                {storePriceMutation.isLoading ? tCommon("loading") : t("savePrice")}
              </Button>
            </FormActions>
          </form>
        </Form>
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

            <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-500">
              {previewQuery.isLoading
                ? tCommon("loading")
                : t("bulkPreview", { count: previewQuery.data?.length ?? 0 })}
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
            <label className="text-sm font-medium text-ink">{t("category")}</label>
            <Input
              value={bulkCategoryValue}
              onChange={(event) => setBulkCategoryValue(event.target.value)}
              placeholder={t("bulkCategoryPlaceholder")}
              list="bulk-category-options"
            />
            <p className="text-xs text-gray-500">{t("bulkCategoryHint")}</p>
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
        subtitle={t("printSubtitle", { count: printQueue.length || selectedList.length })}
      >
        <Form {...printForm}>
          <form
            className="space-y-4"
            onSubmit={printForm.handleSubmit((values) => handlePrintTags(values))}
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
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-ink">{t("printQueueTitle")}</span>
                <span className="text-xs text-gray-500">{t("printQueueHint")}</span>
              </div>
              {printQueue.length ? (
                <div className="space-y-2">
                  {printQueue.map((productId, index) => {
                    const product = productById.get(productId);
                    const canMoveUp = index > 0;
                    const canMoveDown = index < printQueue.length - 1;
                    return (
                      <div
                        key={productId}
                        className={`flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 ${
                          draggedQueueIndex === index ? "opacity-60" : ""
                        }`}
                        draggable
                        onDragStart={() => setDraggedQueueIndex(index)}
                        onDragEnd={() => setDraggedQueueIndex(null)}
                        onDragOver={(event) => {
                          if (draggedQueueIndex === null) {
                            return;
                          }
                          event.preventDefault();
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          if (draggedQueueIndex === null || draggedQueueIndex === index) {
                            return;
                          }
                          movePrintQueueItem(draggedQueueIndex, index);
                          setDraggedQueueIndex(null);
                        }}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <GripIcon className="h-4 w-4 text-gray-400" aria-hidden />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink">
                              {product?.name ?? tCommon("notAvailable")}
                            </p>
                            <p className="text-xs text-gray-500">
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
                                onClick={() => canMoveUp && movePrintQueueItem(index, index - 1)}
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
                                onClick={() => canMoveDown && movePrintQueueItem(index, index + 1)}
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
              ) : (
                <p className="text-xs text-gray-500">{t("printQueueEmpty")}</p>
              )}
            </div>
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
          </form>
        </Form>
      </Modal>
    </div>
  );
};

export default ProductsPage;

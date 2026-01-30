"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { PageHeader } from "@/components/page-header";
import { HelpLink } from "@/components/help-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  DownloadIcon,
  ReceiveIcon,
  TransferIcon,
  StatusWarningIcon,
  StatusSuccessIcon,
  EmptyIcon,
  MoreIcon,
  ViewIcon,
} from "@/components/icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDateTime, formatNumber } from "@/lib/i18nFormat";
import { formatMovementNote } from "@/lib/i18n/movementNote";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { useSse } from "@/lib/useSse";
import { useToast } from "@/components/ui/toast";
import { SelectionToolbar } from "@/components/selection-toolbar";

const InventoryPage = () => {
  const t = useTranslations("inventory");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session } = useSession();
  const role = session?.user?.role;
  const canManage = role === "ADMIN" || role === "MANAGER";
  const isAdmin = role === "ADMIN";
  const { toast } = useToast();
  const storesQuery = trpc.stores.list.useQuery();
  const suppliersQuery = trpc.suppliers.list.useQuery();
  type StoreRow = NonNullable<typeof storesQuery.data>[number] & { trackExpiryLots?: boolean };
  const stores: StoreRow[] = (storesQuery.data ?? []) as StoreRow[];
  const [storeId, setStoreId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [showPlanning, setShowPlanning] = useState(false);
  const [expandedReorderId, setExpandedReorderId] = useState<string | null>(null);
  const [expiryWindow, setExpiryWindow] = useState<30 | 60 | 90>(30);
  const [activeDialog, setActiveDialog] = useState<
    "receive" | "adjust" | "transfer" | "minStock" | "movements" | null
  >(null);
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [printOpen, setPrintOpen] = useState(false);
  const trackExpiryLots = stores.find((store) => store.id === storeId)?.trackExpiryLots ?? false;

  const receiveSchema = useMemo(
    () =>
      z.object({
        productId: z.string().min(1, t("productRequired")),
        variantId: z.string().optional().nullable(),
        qtyReceived: z.coerce.number().int().positive(t("qtyPositive")),
        unitSelection: z.string().min(1, t("unitRequired")),
        unitCost: z.coerce.number().min(0, t("unitCostNonNegative")).optional(),
        expiryDate: z.string().optional(),
        note: z.string().optional(),
      }),
    [t],
  );

  const adjustSchema = useMemo(
    () =>
      z.object({
        productId: z.string().min(1, t("productRequired")),
        variantId: z.string().optional().nullable(),
        qtyDelta: z.coerce.number().int().refine((value) => value !== 0, {
          message: t("qtyNonZero"),
        }),
        unitSelection: z.string().min(1, t("unitRequired")),
        reason: z.string().min(1, t("reasonRequired")),
        expiryDate: z.string().optional(),
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
      z.object({
        productId: z.string().min(1, t("productRequired")),
        minStock: z.coerce.number().int().min(0, t("minStockNonNegative")),
      }),
    [t],
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

  const receiveForm = useForm<z.infer<typeof receiveSchema>>({
    resolver: zodResolver(receiveSchema),
    defaultValues: {
      productId: "",
      variantId: null,
      qtyReceived: 0,
      unitSelection: "BASE",
      unitCost: undefined,
      expiryDate: "",
      note: "",
    },
  });

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
    },
  });

  const printForm = useForm<z.infer<typeof printSchema>>({
    resolver: zodResolver(printSchema),
    defaultValues: {
      template: "3x8",
      storeId: storeId || "",
      quantity: 1,
    },
  });

  const inventoryQuery = trpc.inventory.list.useQuery(
    { storeId: storeId ?? "", search: search || undefined },
    { enabled: Boolean(storeId) },
  );
  const reorderCandidates = useMemo(() => {
    return (inventoryQuery.data ?? [])
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
  }, [inventoryQuery.data, tCommon]);
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

  type InventoryRow = NonNullable<typeof inventoryQuery.data>[number];

  const productOptions = useMemo(() => {
    return (inventoryQuery.data ?? []).map((item) => {
      const label = item.variant?.name
        ? `${item.product.name} • ${item.variant.name}`
        : item.product.name;
      const skuLabel = item.product.sku ? `${label} (${item.product.sku})` : label;
      return {
        key: `${item.product.id}:${item.snapshot.variantId ?? "BASE"}`,
        productId: item.product.id,
        variantId: item.snapshot.variantId ?? null,
        label: skuLabel,
      };
    });
  }, [inventoryQuery.data]);

  const productMap = useMemo(
    () => new Map((inventoryQuery.data ?? []).map((item) => [item.product.id, item.product])),
    [inventoryQuery.data],
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
    product: {
      baseUnit: { labelRu: string; labelKg: string };
      packs: { id: string; multiplierToBase: number }[];
    } | undefined,
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
  const expiringLots: ExpiringLot[] = useMemo(
    () => expiringQuery.data ?? [],
    [expiringQuery.data],
  );

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
    (inventoryQuery.data ?? []).forEach((item) => {
      if (map.has(item.product.id)) {
        return;
      }
      const label = item.product.sku
        ? `${item.product.name} (${item.product.sku})`
        : item.product.name;
      map.set(item.product.id, { productId: item.product.id, label });
    });
    return Array.from(map.values());
  }, [inventoryQuery.data]);

  const selectedItems = useMemo(
    () => (inventoryQuery.data ?? []).filter((item) => selectedIds.has(item.snapshot.id)),
    [inventoryQuery.data, selectedIds],
  );
  const selectedProductIds = useMemo(() => {
    const ids = new Set<string>();
    selectedItems.forEach((item) => ids.add(item.product.id));
    return Array.from(ids);
  }, [selectedItems]);
  const allSelected =
    Boolean(inventoryQuery.data?.length) &&
    selectedIds.size === (inventoryQuery.data?.length ?? 0);

  const toggleSelectAll = () => {
    if (!inventoryQuery.data?.length) {
      return;
    }
    setSelectedIds(() => {
      if (allSelected) {
        return new Set();
      }
      return new Set(inventoryQuery.data.map((item) => item.snapshot.id));
    });
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

  useEffect(() => {
    if (!storeId && storesQuery.data?.[0]) {
      setStoreId(storesQuery.data[0].id);
    }
  }, [storeId, storesQuery.data]);

  useEffect(() => {
    if (!poDraftOpen) {
      return;
    }
    setPoDraftItems(
      reorderCandidates.map((item) => ({
        ...item,
        selected: true,
      })),
    );
  }, [poDraftOpen, reorderCandidates]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [storeId, inventoryQuery.data]);

  useEffect(() => {
    if (!printOpen) {
      return;
    }
    printForm.reset({
      template: "3x8",
      storeId: storeId || "",
      quantity: 1,
    });
  }, [printOpen, printForm, storeId]);

  const receiveProductId = receiveForm.watch("productId");
  const receiveVariantId = receiveForm.watch("variantId");
  const receiveUnitSelection = receiveForm.watch("unitSelection");
  const receiveQty = receiveForm.watch("qtyReceived");
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
  const receiveProduct = receiveProductId ? productMap.get(receiveProductId) : undefined;
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
    if (!receiveForm.getValues("productId")) {
      receiveForm.setValue("productId", firstOption.productId, { shouldValidate: true });
      receiveForm.setValue("variantId", firstOption.variantId, { shouldValidate: true });
      receiveForm.setValue("unitSelection", "BASE", { shouldValidate: true });
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
  }, [productOptions, receiveForm, adjustForm, transferForm]);

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
    if (!minStockProductId || !inventoryQuery.data) {
      return;
    }
    const item = inventoryQuery.data.find((entry) => entry.product.id === minStockProductId);
    if (item) {
      minStockForm.setValue("minStock", item.minStock, { shouldValidate: true });
    }
  }, [minStockProductId, inventoryQuery.data, minStockForm]);

  const handlePrintTags = async (values: z.infer<typeof printSchema>) => {
    if (!selectedProductIds.length) {
      return;
    }
    try {
      const response = await fetch("/api/price-tags/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template: values.template,
          storeId: values.storeId || undefined,
          items: selectedProductIds.map((productId) => ({
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
    } catch (error) {
      toast({ variant: "error", description: t("priceTagsFailed") });
    }
  };

  const openActionDialog = (
    type: "receive" | "adjust" | "transfer" | "minStock",
    item?: InventoryRow,
  ) => {
    setActiveDialog(type);
    if (!item) {
      return;
    }
    const productId = item.product.id;
    const variantId = item.snapshot.variantId ?? null;
    if (type === "receive") {
      receiveForm.setValue("productId", productId, { shouldValidate: true });
      receiveForm.setValue("variantId", variantId, { shouldValidate: true });
    }
    if (type === "adjust") {
      adjustForm.setValue("productId", productId, { shouldValidate: true });
      adjustForm.setValue("variantId", variantId, { shouldValidate: true });
    }
    if (type === "transfer") {
      transferForm.setValue("productId", productId, { shouldValidate: true });
      transferForm.setValue("variantId", variantId, { shouldValidate: true });
    }
    if (type === "minStock") {
      minStockForm.setValue("productId", productId, { shouldValidate: true });
      minStockForm.setValue("minStock", item.minStock, { shouldValidate: true });
    }
  };

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

  const adjustMutation = trpc.inventory.adjust.useMutation({
    onSuccess: () => {
      inventoryQuery.refetch();
      adjustForm.setValue("qtyDelta", 0);
      adjustForm.setValue("reason", "");
      toast({ variant: "success", description: t("adjustSuccess") });
      setActiveDialog(null);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const receiveMutation = trpc.inventory.receive.useMutation({
    onSuccess: () => {
      inventoryQuery.refetch();
      receiveForm.setValue("qtyReceived", 0);
      receiveForm.setValue("note", "");
      toast({ variant: "success", description: t("receiveSuccess") });
      setActiveDialog(null);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const transferMutation = trpc.inventory.transfer.useMutation({
    onSuccess: () => {
      inventoryQuery.refetch();
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
      case "ADJUSTMENT":
        return t("movementType.adjustment");
      case "TRANSFER_IN":
        return t("movementType.transferIn");
      case "TRANSFER_OUT":
        return t("movementType.transferOut");
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
        return "warning";
      case "SALE":
        return "danger";
      default:
        return "default";
    }
  };

  const receiveSelectionKey = receiveProductId
    ? buildSelectionKey(receiveProductId, receiveVariantId)
    : "";
  const adjustSelectionKey = adjustProductId
    ? buildSelectionKey(adjustProductId, adjustVariantId)
    : "";
  const transferSelectionKey = transferProductId
    ? buildSelectionKey(transferProductId, transferVariantId)
    : "";
  const tableColumnCount = showPlanning ? 9 : 8;
  const selectedDraftItems = poDraftItems.filter((item) => item.selected);
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

  return (
    <div>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <>
            <Button variant="secondary" className="w-full sm:w-auto" asChild>
              <Link href="/inventory/counts">
                <ViewIcon className="h-4 w-4" aria-hidden />
                {t("stockCounts")}
              </Link>
            </Button>
            {canManage ? (
              <>
              <Button
                className="w-full sm:w-auto"
                onClick={() => openActionDialog("receive")}
                disabled={!storeId}
              >
                <ReceiveIcon className="h-4 w-4" aria-hidden />
                {t("receiveStock")}
              </Button>
              <Button
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => openActionDialog("adjust")}
                disabled={!storeId}
              >
                <AdjustIcon className="h-4 w-4" aria-hidden />
                {t("stockAdjustment")}
              </Button>
              <Button
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => openActionDialog("transfer")}
                disabled={!storeId}
              >
                <TransferIcon className="h-4 w-4" aria-hidden />
                {t("transferStock")}
              </Button>
              <Button
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => openActionDialog("minStock")}
                disabled={!storeId}
              >
                <StatusSuccessIcon className="h-4 w-4" aria-hidden />
                {t("minStockTitle")}
              </Button>
              {showPlanning ? (
                <>
                  <Button
                    variant="secondary"
                    className="w-full sm:w-auto"
                    onClick={() => setPoDraftOpen(true)}
                    disabled={!storeId || reorderCandidates.length === 0}
                  >
                    <AddIcon className="h-4 w-4" aria-hidden />
                    {t("createPoDrafts")}
                  </Button>
                  <HelpLink articleId="reorder" />
                </>
              ) : null}
              </>
            ) : null}
          </>
        }
        filters={
          <>
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
            <div className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2">
              <Switch
                checked={showPlanning}
                onCheckedChange={setShowPlanning}
                aria-label={t("showPlanning")}
              />
              <span className="text-sm text-gray-600">{t("showPlanning")}</span>
            </div>
          </>
        }
      />

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
              <p className="text-sm text-gray-500">{tCommon("loading")}</p>
            ) : expiringLots.length ? (
              <div className="space-y-2 text-sm">
                {expiringLots.map((lot) => (
                  <div key={lot.id} className="flex items-center justify-between">
                    <span>
                      {lot.product.name}
                      {lot.variant?.name ? ` • ${lot.variant.name}` : ""}
                    </span>
                    <span className="text-xs text-gray-500">
                      {lot.expiryDate ? formatDateTime(lot.expiryDate, locale) : tCommon("notAvailable")}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <EmptyIcon className="h-4 w-4" aria-hidden />
                {t("noExpiringLots")}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("inventoryOverview")}</CardTitle>
        </CardHeader>
        <CardContent>
          {selectedItems.length ? (
            <div className="mb-3">
              <TooltipProvider>
                <SelectionToolbar
                  count={selectedItems.length}
                  label={tCommon("selectedCount", { count: selectedItems.length })}
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
                </SelectionToolbar>
              </TooltipProvider>
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <TooltipProvider>
              <Table className="min-w-[520px]">
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
                    <TableHead className="hidden sm:table-cell">{t("sku")}</TableHead>
                    <TableHead>{tCommon("product")}</TableHead>
                    <TableHead>{t("onHand")}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t("minStock")}</TableHead>
                    <TableHead>{t("lowStock")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("onOrder")}</TableHead>
                    {showPlanning ? (
                      <TableHead>{t("suggestedOrder")}</TableHead>
                    ) : null}
                    <TableHead>{tCommon("actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inventoryQuery.data?.map((item) => {
                    const isExpanded = expandedReorderId === item.snapshot.id;
                    const reorder = item.reorder;
                    const expiryKey = `${item.product.id}:${item.snapshot.variantId ?? "BASE"}`;
                    return (
                      <Fragment key={item.snapshot.id}>
                        <TableRow>
                          <TableCell>
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-ink"
                              checked={selectedIds.has(item.snapshot.id)}
                              onChange={() => toggleSelect(item.snapshot.id)}
                              aria-label={t("selectInventoryItem", {
                                name: item.variant?.name
                                  ? `${item.product.name} • ${item.variant.name}`
                                  : item.product.name,
                              })}
                            />
                          </TableCell>
                          <TableCell className="text-xs text-gray-500 hidden sm:table-cell">
                            {item.product.sku}
                          </TableCell>
                          <TableCell className="font-medium">
                            <div className="flex flex-wrap items-center gap-2">
                              <span>
                                {item.product.name}
                                {item.variant?.name ? ` • ${item.variant.name}` : ""}
                              </span>
                              {trackExpiryLots && expiringSet.has(expiryKey) ? (
                                <Badge variant="warning">{t("expiringSoonBadge")}</Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>{formatNumber(item.snapshot.onHand, locale)}</TableCell>
                          <TableCell className="hidden sm:table-cell">
                            {formatNumber(item.minStock, locale)}
                          </TableCell>
                          <TableCell>
                            {item.lowStock ? (
                              <Badge variant="danger">
                                <StatusWarningIcon className="h-3 w-3" aria-hidden />
                                {t("lowStockBadge")}
                              </Badge>
                            ) : (
                              <span className="text-xs text-gray-400">
                                {tCommon("notAvailable")}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            {formatNumber(item.snapshot.onOrder, locale)}
                          </TableCell>
                          {showPlanning ? (
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
                                <span className="text-xs text-gray-400">
                                  {t("planningUnavailable")}
                                </span>
                              )}
                            </TableCell>
                          ) : null}
                          <TableCell>
                            {canManage ? (
                              <DropdownMenu>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="inline-flex">
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
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>{tCommon("actions")}</TooltipContent>
                                </Tooltip>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onSelect={() => openActionDialog("receive", item)}
                                  >
                                    {t("receiveStock")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onSelect={() => openActionDialog("adjust", item)}>
                                    {t("stockAdjustment")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() => openActionDialog("transfer", item)}
                                  >
                                    {t("transferStock")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() => openActionDialog("minStock", item)}
                                  >
                                    {t("minStockTitle")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onSelect={() => openMovements(item)}>
                                    {t("viewMovements")}
                                  </DropdownMenuItem>
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
                                    onClick={() => openMovements(item)}
                                    aria-label={tCommon("view")}
                                  >
                                    <ViewIcon className="h-4 w-4" aria-hidden />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>{tCommon("view")}</TooltipContent>
                              </Tooltip>
                            )}
                          </TableCell>
                        </TableRow>
                        {showPlanning && isExpanded && reorder ? (
                          <TableRow>
                            <TableCell colSpan={tableColumnCount}>
                              <div className="rounded-md border border-gray-100 bg-gray-50 p-3 text-sm">
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                  <div>
                                    <p className="text-xs text-gray-500">
                                      {t("demandDuringLeadTime")}
                                    </p>
                                    <p className="font-semibold">
                                      {formatNumber(reorder.demandDuringLeadTime, locale)}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-gray-500">{t("safetyStock")}</p>
                                    <p className="font-semibold">
                                      {formatNumber(reorder.safetyStock, locale)}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-gray-500">{t("reorderPoint")}</p>
                                    <p className="font-semibold">
                                      {formatNumber(reorder.reorderPoint, locale)}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-gray-500">{t("targetLevel")}</p>
                                    <p className="font-semibold">
                                      {formatNumber(reorder.targetLevel, locale)}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-gray-500">
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
            </TooltipProvider>
            {inventoryQuery.isLoading ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
                <Spinner className="h-4 w-4" />
                {tCommon("loading")}
              </div>
            ) : !storeId ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
                <EmptyIcon className="h-4 w-4" aria-hidden />
                {t("selectStoreHint")}
              </div>
            ) : !inventoryQuery.data?.length ? (
              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-gray-500">
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
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-red-500">
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
          </div>
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
                  <p className="text-xs font-semibold text-gray-500">
                    {supplierId === "unassigned"
                      ? t("supplierUnassigned")
                      : supplierMap.get(supplierId) ?? t("supplierUnassigned")}
                  </p>
                  {items.map((item) => (
                    <div
                      key={item.key}
                      className="space-y-2 rounded-md border border-gray-100 bg-white p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-ink">{item.productName}</p>
                          <p className="text-xs text-gray-500">{item.variantName}</p>
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
                        <div className="text-xs text-gray-500">
                          {t("suggestedOrder")}
                          <div className="text-sm font-semibold text-ink">
                            {formatNumber(item.suggestedQty, locale)}
                          </div>
                        </div>
                        <div>
                          <label className="text-xs text-gray-500">{t("draftQty")}</label>
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            value={item.qtyOrdered}
                            onChange={(event) => {
                              const nextValue = Number(event.target.value);
                              setPoDraftItems((prev) =>
                                prev.map((entry) =>
                                  entry.key === item.key
                                    ? {
                                        ...entry,
                                        qtyOrdered: Number.isFinite(nextValue) ? nextValue : 0,
                                      }
                                    : entry,
                                ),
                              );
                            }}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500">{t("supplier")}</label>
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
              <Button type="submit" className="w-full sm:w-auto" disabled={createPoDraftMutation.isLoading}>
                {createPoDraftMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                {createPoDraftMutation.isLoading ? tCommon("loading") : t("createPoDraftsSubmit")}
              </Button>
            </FormActions>
          </form>
        ) : (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <EmptyIcon className="h-4 w-4" aria-hidden />
            {t("noReorderSuggestions")}
          </div>
        )}
      </Modal>

      <Modal
        open={printOpen}
        onOpenChange={(open) => {
          if (!open) {
            setPrintOpen(false);
          }
        }}
        title={t("printPriceTags")}
        subtitle={t("printSubtitle", { count: selectedItems.length })}
      >
        <Form {...printForm}>
          <form className="space-y-4" onSubmit={printForm.handleSubmit(handlePrintTags)}>
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

      <Modal
        open={activeDialog === "receive"}
        onOpenChange={(open) => {
          if (!open) {
            setActiveDialog(null);
          }
        }}
        title={t("receiveStock")}
      >
        <Form {...receiveForm}>
          <form
            className="space-y-4"
            onSubmit={receiveForm.handleSubmit((values) => {
              if (!storeId) {
                return;
              }
              receiveMutation.mutate({
                storeId,
                productId: values.productId,
                variantId: values.variantId ?? undefined,
                qtyReceived: values.qtyReceived,
                unitId:
                  values.unitSelection === "BASE"
                    ? receiveProduct?.baseUnitId
                    : undefined,
                packId: values.unitSelection !== "BASE" ? values.unitSelection : undefined,
                unitCost: values.unitCost ?? undefined,
                expiryDate: values.expiryDate || undefined,
                note: values.note?.trim() || undefined,
                idempotencyKey: crypto.randomUUID(),
              });
            })}
          >
            <FormGrid>
              <FormField
                control={receiveForm.control}
                name="productId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tCommon("product")}</FormLabel>
                    <Select
                      value={receiveSelectionKey}
                      onValueChange={(value) => {
                        const option = productOptions.find((item) => item.key === value);
                        if (!option) {
                          return;
                        }
                        field.onChange(option.productId);
                        receiveForm.setValue("variantId", option.variantId, { shouldValidate: true });
                        receiveForm.setValue("unitSelection", "BASE", { shouldValidate: true });
                      }}
                      disabled={!productOptions.length}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={tCommon("selectProduct")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {productOptions.map((option) => (
                          <SelectItem key={option.key} value={option.key}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!productOptions.length ? (
                      <FormDescription>{t("noInventory")}</FormDescription>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={receiveForm.control}
                name="qtyReceived"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("receiveQty")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        inputMode="numeric"
                        placeholder={t("qtyPlaceholder")}
                      />
                    </FormControl>
                    {receiveProduct ? (
                      <FormDescription>
                        {(() => {
                          const baseQty = resolveBasePreview(
                            receiveProduct,
                            receiveUnitSelection,
                            receiveQty,
                          );
                          if (baseQty === null) {
                            return null;
                          }
                          return t("baseQtyPreview", {
                            qty: formatNumber(baseQty, locale),
                            unit: resolveUnitLabel(receiveProduct.baseUnit),
                          });
                        })()}
                      </FormDescription>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={receiveForm.control}
                name="unitSelection"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("unit")}</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={!receiveProduct}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t("unitPlaceholder")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {buildUnitOptions(receiveProduct, "receiving").map((option) => (
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
              <FormField
                control={receiveForm.control}
                name="unitCost"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("unitCost")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        placeholder={t("unitCostPlaceholder")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {trackExpiryLots ? (
                <FormField
                  control={receiveForm.control}
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
                control={receiveForm.control}
                name="note"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>{t("receiveNote")}</FormLabel>
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
                disabled={receiveMutation.isLoading || !storeId || !productOptions.length}
              >
                {receiveMutation.isLoading ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <ReceiveIcon className="h-4 w-4" aria-hidden />
                )}
                {receiveMutation.isLoading ? tCommon("loading") : t("receiveSubmit")}
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
                unitId:
                  values.unitSelection === "BASE"
                    ? adjustProduct?.baseUnitId
                    : undefined,
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
                    <Select
                      value={adjustSelectionKey}
                      onValueChange={(value) => {
                        const option = productOptions.find((item) => item.key === value);
                        if (!option) {
                          return;
                        }
                        field.onChange(option.productId);
                        adjustForm.setValue("variantId", option.variantId, { shouldValidate: true });
                        adjustForm.setValue("unitSelection", "BASE", { shouldValidate: true });
                      }}
                      disabled={!productOptions.length}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={tCommon("selectProduct")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {productOptions.map((option) => (
                          <SelectItem key={option.key} value={option.key}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                disabled={adjustMutation.isLoading || !storeId || !productOptions.length}
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
                unitId:
                  values.unitSelection === "BASE"
                    ? selectedProduct?.baseUnitId
                    : undefined,
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
                    <Select
                      value={transferSelectionKey}
                      onValueChange={(value) => {
                        const option = productOptions.find((item) => item.key === value);
                        if (!option) {
                          return;
                        }
                        field.onChange(option.productId);
                        transferForm.setValue("variantId", option.variantId, {
                          shouldValidate: true,
                        });
                        transferForm.setValue("unitSelection", "BASE", { shouldValidate: true });
                      }}
                      disabled={!productOptions.length}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={tCommon("selectProduct")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {productOptions.map((option) => (
                          <SelectItem key={option.key} value={option.key}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                disabled={transferMutation.isLoading || !productOptions.length}
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
      >
        <Form {...minStockForm}>
          <form
            className="space-y-4"
            onSubmit={minStockForm.handleSubmit((values) => {
              if (!storeId) {
                return;
              }
              minStockMutation.mutate({
                storeId,
                productId: values.productId,
                minStock: values.minStock,
              });
            })}
          >
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
                      disabled={!minStockOptions.length}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={tCommon("selectProduct")} />
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
                    {!minStockOptions.length ? (
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
                disabled={minStockMutation.isLoading || !storeId || !minStockOptions.length}
              >
                {minStockMutation.isLoading ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <StatusSuccessIcon className="h-4 w-4" aria-hidden />
                )}
                {minStockMutation.isLoading ? tCommon("loading") : t("minStockSave")}
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
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Spinner className="h-4 w-4" />
            {tCommon("loading")}
          </div>
        ) : movementsQuery.error ? (
          <div className="flex flex-wrap items-center gap-3 text-sm text-red-500">
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
                {movementsQuery.data.map((movement) => (
                  <TableRow key={movement.id}>
                    <TableCell className="text-xs text-gray-500">
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
                    <TableCell className="text-xs text-gray-500 hidden md:table-cell">
                      {movement.createdBy?.name ??
                        movement.createdBy?.email ??
                        tCommon("notAvailable")}
                    </TableCell>
                    <TableCell className="text-xs text-gray-500 hidden md:table-cell">
                      {formatMovementNote(t, movement.note) || tCommon("notAvailable")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <EmptyIcon className="h-4 w-4" aria-hidden />
            {t("noMovements")}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default InventoryPage;

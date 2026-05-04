"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { PageHeader } from "@/components/page-header";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
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
import { Spinner } from "@/components/ui/spinner";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ProductForm } from "@/components/product-form";
import { ProductSearchResultItem } from "@/components/product-search-result-item";
import {
  AddIcon,
  ArchiveIcon,
  CopyIcon,
  DeleteIcon,
  DownloadIcon,
  EmptyIcon,
  MoreIcon,
  PrintIcon,
  ViewIcon,
} from "@/components/icons";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/i18nFormat";
import {
  convertFromKgs,
  convertToKgs,
  normalizeCurrencyCode,
  normalizeCurrencyRateKgsPerUnit,
} from "@/lib/currency";
import { formatMovementNote } from "@/lib/i18n/movementNote";
import { deriveBasePriceFallbackCandidate } from "@/lib/basePriceFallback";
import { buildBarcodeLabelPrintItems, hasPrintableBarcode } from "@/lib/barcodePrint";
import { downloadPdfBlob, fetchPdfBlob, printPdfBlob } from "@/lib/pdfClient";
import {
  buildSavedLabelPrintValues,
  resolveLabelPrintFlowAction,
  resolveSavedLabelCopies,
  resolveSavedLabelTemplate,
} from "@/lib/labelPrintFlow";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { useToast } from "@/components/ui/toast";
import { RowActions } from "@/components/row-actions";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";

const createIdempotencyKey = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `inventory-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const ProductDetailPage = () => {
  const params = useParams();
  const productId = String(params?.id ?? "");
  const t = useTranslations("products");
  const tInventory = useTranslations("inventory");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const locale = useLocale();
  const { data: session } = useSession();
  const trpcUtils = trpc.useUtils();
  const role = session?.user?.role;
  const isAdmin = role === "ADMIN";
  const canManageBundles = role === "ADMIN" || role === "MANAGER";
  const canManageStorePrices = role === "ADMIN" || role === "MANAGER";
  const canManageInventory = role === "ADMIN" || role === "MANAGER";
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [movementsOpen, setMovementsOpen] = useState(false);
  const [movementStoreId, setMovementStoreId] = useState("");
  const [pricingStoreId, setPricingStoreId] = useState("");
  const [showLots, setShowLots] = useState(false);
  const [showBundle, setShowBundle] = useState(false);
  const [componentDialogOpen, setComponentDialogOpen] = useState(false);
  const [componentSearch, setComponentSearch] = useState("");
  const [basePriceDraft, setBasePriceDraft] = useState("");
  const [storePriceDrafts, setStorePriceDrafts] = useState<Record<string, string>>({});
  const [storeOnHandDrafts, setStoreOnHandDrafts] = useState<Record<string, string>>({});
  const [selectedComponent, setSelectedComponent] = useState<{
    id: string;
    name: string;
    sku: string;
  } | null>(null);
  const [assembleOpen, setAssembleOpen] = useState(false);
  const [savingStorePriceId, setSavingStorePriceId] = useState<string | null>(null);
  const [savingStoreOnHandId, setSavingStoreOnHandId] = useState<string | null>(null);
  const [labelSetupOpen, setLabelSetupOpen] = useState(false);
  const [labelAction, setLabelAction] = useState<"print" | "download" | null>(null);
  const basePriceAutofillRef = useRef<string | null>(null);

  const productQuery = trpc.products.getById.useQuery(
    { productId },
    { enabled: Boolean(productId) },
  );
  const bundleComponentsQuery = trpc.bundles.listComponents.useQuery(
    { bundleProductId: productId },
    { enabled: Boolean(productId) },
  );
  const pricingQuery = trpc.products.pricing.useQuery(
    { productId, storeId: pricingStoreId || undefined },
    { enabled: Boolean(productId) },
  );
  const storePricingQuery = trpc.products.storePricing.useQuery(
    { productId },
    { enabled: Boolean(productId) },
  );
  const attributesQuery = trpc.attributes.list.useQuery();
  const unitsQuery = trpc.units.list.useQuery();
  const storesQuery = trpc.stores.list.useQuery();
  const movementsQuery = trpc.inventory.movements.useQuery(
    movementStoreId ? { storeId: movementStoreId, productId } : { storeId: "", productId: "" },
    { enabled: movementsOpen && Boolean(movementStoreId) && Boolean(productId) },
  );
  const componentSearchQuery = trpc.products.searchQuick.useQuery(
    { q: componentSearch },
    { enabled: componentDialogOpen && componentSearch.trim().length >= 2 },
  );
  const componentDetailQuery = trpc.products.getById.useQuery(
    { productId: selectedComponent?.id ?? "" },
    { enabled: Boolean(selectedComponent?.id) },
  );
  type StoreRow = NonNullable<typeof storesQuery.data>[number] & { trackExpiryLots?: boolean };
  const stores: StoreRow[] = (storesQuery.data ?? []) as StoreRow[];
  const selectedPricingStore = stores.find((store) => store.id === pricingStoreId);
  const selectedPricingCurrencyCode = normalizeCurrencyCode(selectedPricingStore?.currencyCode);
  const selectedPricingCurrencyRateKgsPerUnit = normalizeCurrencyRateKgsPerUnit(
    Number(selectedPricingStore?.currencyRateKgsPerUnit ?? 1),
    selectedPricingCurrencyCode,
  );
  const formatDraftMoneyAmount = useCallback(
    (value: number) => (Number.isFinite(value) ? Number(value.toFixed(6)).toString() : ""),
    [],
  );
  const parseDraftMoney = useCallback((raw: string) => {
    const normalized = raw.replace(/\s+/g, "").replace(",", ".");
    if (!normalized.length) {
      return null;
    }
    const value = Number(normalized);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }, []);
  const convertSelectedMoneyFromKgs = useCallback(
    (valueKgs: number) =>
      convertFromKgs(valueKgs, selectedPricingCurrencyRateKgsPerUnit, selectedPricingCurrencyCode),
    [selectedPricingCurrencyCode, selectedPricingCurrencyRateKgsPerUnit],
  );
  const convertSelectedMoneyToKgs = useCallback(
    (value: number) =>
      convertToKgs(value, selectedPricingCurrencyRateKgsPerUnit, selectedPricingCurrencyCode),
    [selectedPricingCurrencyCode, selectedPricingCurrencyRateKgsPerUnit],
  );
  const formatSelectedMoney = useCallback(
    (valueKgs: number) =>
      formatCurrency(convertSelectedMoneyFromKgs(valueKgs), locale, selectedPricingCurrencyCode),
    [convertSelectedMoneyFromKgs, locale, selectedPricingCurrencyCode],
  );
  const resolveStoreCurrency = useCallback(
    (store: { currencyCode?: string | null; currencyRateKgsPerUnit?: number | string | null }) => {
      const currencyCode = normalizeCurrencyCode(store.currencyCode);
      return {
        currencyCode,
        currencyRateKgsPerUnit: normalizeCurrencyRateKgsPerUnit(
          store.currencyRateKgsPerUnit,
          currencyCode,
        ),
      };
    },
    [],
  );
  const convertStoreMoneyFromKgs = useCallback(
    (
      valueKgs: number,
      store: { currencyCode?: string | null; currencyRateKgsPerUnit?: number | string | null },
    ) => {
      const { currencyCode, currencyRateKgsPerUnit } = resolveStoreCurrency(store);
      return convertFromKgs(valueKgs, currencyRateKgsPerUnit, currencyCode);
    },
    [resolveStoreCurrency],
  );
  const convertStoreMoneyToKgs = useCallback(
    (
      value: number,
      store: { currencyCode?: string | null; currencyRateKgsPerUnit?: number | string | null },
    ) => {
      const { currencyCode, currencyRateKgsPerUnit } = resolveStoreCurrency(store);
      return convertToKgs(value, currencyRateKgsPerUnit, currencyCode);
    },
    [resolveStoreCurrency],
  );
  const formatStoreMoney = useCallback(
    (
      valueKgs: number,
      store: { currencyCode?: string | null; currencyRateKgsPerUnit?: number | string | null },
    ) => {
      const { currencyCode, currencyRateKgsPerUnit } = resolveStoreCurrency(store);
      return formatCurrency(
        convertFromKgs(valueKgs, currencyRateKgsPerUnit, currencyCode),
        locale,
        currencyCode,
      );
    },
    [locale, resolveStoreCurrency],
  );
  const lotsEnabled = Boolean(selectedPricingStore?.trackExpiryLots);
  const lotsQuery = trpc.stockLots.byProduct.useQuery(
    pricingStoreId ? { storeId: pricingStoreId, productId } : { storeId: "", productId: "" },
    { enabled: Boolean(pricingStoreId && showLots && lotsEnabled) },
  );
  const updateMutation = trpc.products.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        productQuery.refetch(),
        storePricingQuery.refetch(),
        pricingQuery.refetch(),
        trpcUtils.products.bootstrap.invalidate(),
        trpcUtils.products.list.invalidate(),
      ]);
      toast({ variant: "success", description: t("saveSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const duplicateMutation = trpc.products.duplicate.useMutation({
    onSuccess: (result) => {
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
  const basePriceMutation = trpc.products.inlineUpdate.useMutation({
    onSuccess: async () => {
      await Promise.all([
        productQuery.refetch(),
        storePricingQuery.refetch(),
        pricingQuery.refetch(),
        trpcUtils.products.bootstrap.invalidate(),
        trpcUtils.products.list.invalidate(),
      ]);
      toast({ variant: "success", description: t("priceSaved") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const storePriceMutation = trpc.storePrices.upsert.useMutation({
    onSuccess: async () => {
      await Promise.all([
        storePricingQuery.refetch(),
        pricingQuery.refetch(),
        trpcUtils.products.bootstrap.invalidate(),
        trpcUtils.products.list.invalidate(),
      ]);
      toast({ variant: "success", description: t("priceSaved") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const adjustStockMutation = trpc.inventory.adjust.useMutation({
    onSuccess: async () => {
      await storePricingQuery.refetch();
      toast({ variant: "success", description: tInventory("adjustSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const addComponentMutation = trpc.bundles.addComponent.useMutation({
    onSuccess: () => {
      bundleComponentsQuery.refetch();
      toast({ variant: "success", description: t("bundleComponentAdded") });
      setComponentDialogOpen(false);
      setSelectedComponent(null);
      setComponentSearch("");
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const removeComponentMutation = trpc.bundles.removeComponent.useMutation({
    onSuccess: () => {
      bundleComponentsQuery.refetch();
      toast({ variant: "success", description: t("bundleComponentRemoved") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const assembleMutation = trpc.bundles.assemble.useMutation({
    onSuccess: () => {
      toast({ variant: "success", description: t("bundleAssembled") });
      setAssembleOpen(false);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const archiveMutation = trpc.products.archive.useMutation({
    onSuccess: () => {
      toast({ variant: "success", description: t("archiveSuccess") });
      router.push("/products");
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  useEffect(() => {
    if (!movementStoreId && storesQuery.data?.[0]) {
      setMovementStoreId(storesQuery.data[0].id);
    }
  }, [movementStoreId, storesQuery.data]);

  useEffect(() => {
    if (!pricingStoreId && storesQuery.data?.length === 1) {
      setPricingStoreId(storesQuery.data[0].id);
    }
  }, [pricingStoreId, storesQuery.data]);

  useEffect(() => {
    if (!storePricingQuery.data) {
      return;
    }
    const priceDrafts = Object.fromEntries(
      storePricingQuery.data.stores.map((storeRow) => [
        storeRow.storeId,
        storeRow.effectivePriceKgs !== null
          ? formatDraftMoneyAmount(convertStoreMoneyFromKgs(storeRow.effectivePriceKgs, storeRow))
          : "",
      ]),
    );
    const onHandDrafts = Object.fromEntries(
      storePricingQuery.data.stores.map((storeRow) => [storeRow.storeId, String(storeRow.onHand)]),
    );
    setStorePriceDrafts(priceDrafts);
    setStoreOnHandDrafts(onHandDrafts);
  }, [convertStoreMoneyFromKgs, formatDraftMoneyAmount, storePricingQuery.data]);

  useEffect(() => {
    const basePrice =
      storePricingQuery.data?.basePriceKgs ?? productQuery.data?.basePriceKgs ?? null;
    setBasePriceDraft(
      basePrice !== null ? formatDraftMoneyAmount(convertSelectedMoneyFromKgs(basePrice)) : "",
    );
  }, [
    convertSelectedMoneyFromKgs,
    formatDraftMoneyAmount,
    productQuery.data?.basePriceKgs,
    storePricingQuery.data?.basePriceKgs,
  ]);

  const movementTypeLabel = (type: string) => {
    switch (type) {
      case "RECEIVE":
        return tInventory("movementType.receive");
      case "SALE":
        return tInventory("movementType.sale");
      case "RETURN":
        return tInventory("movementType.return");
      case "ADJUSTMENT":
        return tInventory("movementType.adjustment");
      case "TRANSFER_IN":
        return tInventory("movementType.transferIn");
      case "TRANSFER_OUT":
        return tInventory("movementType.transferOut");
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
      case "RETURN":
        return "success";
      default:
        return "default";
    }
  };

  const formValues = useMemo(() => {
    if (!productQuery.data) {
      return null;
    }
    return {
      sku: productQuery.data.sku,
      name: productQuery.data.name,
      isBundle: productQuery.data.isBundle,
      category: productQuery.data.category ?? "",
      categories: productQuery.data.categories?.length
        ? productQuery.data.categories
        : productQuery.data.category
          ? [productQuery.data.category]
          : [],
      baseUnitId: productQuery.data.baseUnitId,
      basePriceKgs: productQuery.data.basePriceKgs ?? undefined,
      purchasePriceKgs: productQuery.data.purchasePriceKgs ?? undefined,
      avgCostKgs: productQuery.data.avgCostKgs ?? undefined,
      description: productQuery.data.description ?? "",
      photoUrl: productQuery.data.photoUrl ?? "",
      images: (productQuery.data.images?.length
        ? productQuery.data.images
        : productQuery.data.photoUrl
          ? [{ id: undefined, url: productQuery.data.photoUrl, position: 0 }]
          : []
      ).map((image) => ({
        id: image.id,
        url: image.url,
        position: image.position ?? 0,
      })),
      barcodes: productQuery.data.barcodes ?? [],
      packs: (productQuery.data.packs ?? []).map((pack) => ({
        id: pack.id,
        packName: pack.packName,
        packBarcode: pack.packBarcode ?? "",
        multiplierToBase: pack.multiplierToBase,
        allowInPurchasing: pack.allowInPurchasing,
        allowInReceiving: pack.allowInReceiving,
      })),
      variants: productQuery.data.variants.map((variant) => ({
        id: variant.id,
        name: variant.name ?? "",
        sku: variant.sku ?? "",
        attributes: (variant.attributes as Record<string, unknown>) ?? {},
        canDelete: variant.canDelete ?? true,
      })),
      bundleComponents: (bundleComponentsQuery.data ?? []).map((component) => ({
        componentProductId: component.componentProductId,
        componentVariantId: component.componentVariantId ?? null,
        qty: component.qty,
        componentName: component.componentProduct.name,
        componentSku: component.componentProduct.sku,
      })),
    };
  }, [productQuery.data, bundleComponentsQuery.data]);

  type BundleComponent = NonNullable<typeof bundleComponentsQuery.data>[number];
  type LotRow = NonNullable<typeof lotsQuery.data>[number];
  const bundleComponents: BundleComponent[] = bundleComponentsQuery.data ?? [];
  const lots: LotRow[] = lotsQuery.data ?? [];
  const labelStoreId = pricingStoreId || (stores.length === 1 ? (stores[0]?.id ?? "") : "");
  const labelPrintProfileQuery = trpc.stores.hardware.useQuery(
    { storeId: labelStoreId },
    { enabled: Boolean(labelStoreId) },
  );

  useEffect(() => {
    if (productQuery.data?.isBundle || bundleComponentsQuery.data?.length) {
      setShowBundle(true);
    }
  }, [productQuery.data, bundleComponentsQuery.data]);

  const componentSchema = useMemo(
    () =>
      z.object({
        qty: z.coerce.number().int().positive(t("bundleQtyPositive")),
        variantId: z.string().optional().nullable(),
      }),
    [t],
  );

  const componentForm = useForm<z.infer<typeof componentSchema>>({
    resolver: zodResolver(componentSchema),
    defaultValues: { qty: 1, variantId: null },
  });

  const assembleSchema = useMemo(
    () =>
      z.object({
        qty: z.coerce.number().int().positive(t("bundleQtyPositive")),
      }),
    [t],
  );

  const assembleForm = useForm<z.infer<typeof assembleSchema>>({
    resolver: zodResolver(assembleSchema),
    defaultValues: { qty: 1 },
  });

  useEffect(() => {
    if (componentDialogOpen) {
      componentForm.reset({ qty: 1, variantId: null });
    }
  }, [componentDialogOpen, componentForm]);

  useEffect(() => {
    if (assembleOpen) {
      assembleForm.reset({ qty: 1 });
    }
  }, [assembleOpen, assembleForm]);

  const effectivePrice = pricingQuery.data?.effectivePriceKgs ?? null;
  const avgCost = pricingQuery.data?.avgCostKgs ?? null;
  const currentBasePrice =
    storePricingQuery.data?.basePriceKgs ?? productQuery.data?.basePriceKgs ?? null;
  const basePriceFallbackCandidate = useMemo(
    () =>
      currentBasePrice === null
        ? deriveBasePriceFallbackCandidate(storePricingQuery.data?.stores ?? [])
        : null,
    [currentBasePrice, storePricingQuery.data?.stores],
  );
  const basePriceFallbackSource =
    basePriceFallbackCandidate?.matchingStoreCount === 1
      ? basePriceFallbackCandidate.sourceStoreName
      : basePriceFallbackCandidate
        ? t("storesCount", { count: basePriceFallbackCandidate.matchingStoreCount })
        : "";
  const previewImageUrl = productQuery.data?.images[0]?.url ?? productQuery.data?.photoUrl ?? null;
  const markupPct =
    avgCost && avgCost > 0 && effectivePrice !== null
      ? ((effectivePrice - avgCost) / avgCost) * 100
      : null;
  const marginPct =
    effectivePrice && effectivePrice > 0 && avgCost !== null
      ? ((effectivePrice - avgCost) / effectivePrice) * 100
      : null;

  useEffect(() => {
    if (!basePriceFallbackCandidate || currentBasePrice !== null) {
      basePriceAutofillRef.current = null;
      return;
    }

    const candidateKey = [
      productId,
      basePriceFallbackCandidate.sourceStoreId,
      basePriceFallbackCandidate.priceKgs,
      basePriceFallbackCandidate.matchingStoreCount,
    ].join(":");

    if (basePriceAutofillRef.current === candidateKey) {
      return;
    }

    setBasePriceDraft((current) =>
      current.trim().length > 0
        ? current
        : formatDraftMoneyAmount(convertSelectedMoneyFromKgs(basePriceFallbackCandidate.priceKgs)),
    );
    basePriceAutofillRef.current = candidateKey;
  }, [
    basePriceFallbackCandidate,
    convertSelectedMoneyFromKgs,
    currentBasePrice,
    formatDraftMoneyAmount,
    productId,
  ]);

  const resolveDraftBasePrice = () => {
    const raw = basePriceDraft.trim();
    if (!raw.length) {
      return currentBasePrice === null ? basePriceFallbackCandidate?.priceKgs : undefined;
    }
    const value = parseDraftMoney(raw);
    return value !== null ? convertSelectedMoneyToKgs(value) : undefined;
  };

  const handleSaveBasePrice = async () => {
    const raw = basePriceDraft.trim();
    const parsedValue = raw.length ? parseDraftMoney(raw) : null;
    const nextValue = raw.length
      ? parsedValue === null
        ? Number.NaN
        : convertSelectedMoneyToKgs(parsedValue)
      : currentBasePrice === null
        ? (basePriceFallbackCandidate?.priceKgs ?? null)
        : null;
    if (nextValue !== null && (!Number.isFinite(nextValue) || nextValue < 0)) {
      toast({ variant: "error", description: t("priceNonNegative") });
      return;
    }
    if (
      currentBasePrice !== null &&
      nextValue !== null &&
      Math.abs(currentBasePrice - nextValue) < 0.01
    ) {
      return;
    }
    await basePriceMutation.mutateAsync({
      productId,
      patch: {
        basePriceKgs: nextValue,
      },
    });
  };

  const handleApplyBasePriceFallback = async () => {
    if (!basePriceFallbackCandidate) {
      return;
    }

    setBasePriceDraft(
      formatDraftMoneyAmount(convertSelectedMoneyFromKgs(basePriceFallbackCandidate.priceKgs)),
    );
    if (currentBasePrice === basePriceFallbackCandidate.priceKgs) {
      return;
    }

    await basePriceMutation.mutateAsync({
      productId,
      patch: {
        basePriceKgs: basePriceFallbackCandidate.priceKgs,
      },
    });
  };

  const handleSaveStorePrice = async (storeId: string) => {
    const raw = storePriceDrafts[storeId]?.trim() ?? "";
    const parsedValue = parseDraftMoney(raw);
    if (!raw.length || parsedValue === null) {
      toast({ variant: "error", description: t("priceNonNegative") });
      return;
    }
    const storeRow = storePricingQuery.data?.stores.find((store) => store.storeId === storeId);
    const value = storeRow ? convertStoreMoneyToKgs(parsedValue, storeRow) : parsedValue;
    const currentValue = storeRow?.effectivePriceKgs ?? null;
    if (currentValue !== null && Math.abs(value - currentValue) < 0.01) {
      return;
    }
    setSavingStorePriceId(storeId);
    try {
      await storePriceMutation.mutateAsync({
        storeId,
        productId,
        priceKgs: value,
      });
    } finally {
      setSavingStorePriceId(null);
    }
  };

  const handleSaveStoreOnHand = async (storeId: string, currentOnHand: number) => {
    const raw = storeOnHandDrafts[storeId]?.trim() ?? "";
    const targetOnHand = Number(raw);
    if (!raw.length || !Number.isFinite(targetOnHand) || !Number.isInteger(targetOnHand)) {
      toast({ variant: "error", description: tErrors("validationError") });
      return;
    }
    if (targetOnHand === currentOnHand) {
      return;
    }
    setSavingStoreOnHandId(storeId);
    try {
      await adjustStockMutation.mutateAsync({
        storeId,
        productId,
        qtyDelta: targetOnHand - currentOnHand,
        reason: tInventory("stockAdjustment"),
        idempotencyKey: createIdempotencyKey(),
      });
    } finally {
      setSavingStoreOnHandId(null);
    }
  };

  const handleProductLabelPdf = async (mode: "print" | "download") => {
    const product = productQuery.data;
    if (!product || labelAction) {
      return;
    }
    const settings = labelPrintProfileQuery.data?.settings;
    const action = resolveLabelPrintFlowAction({
      settings,
      storeId: labelStoreId,
      isLoading: labelPrintProfileQuery.isLoading,
    });
    if (action === "setupRequired") {
      setLabelSetupOpen(true);
      return;
    }
    if (action === "loading") {
      toast({ variant: "info", description: t("printProfileLoading") });
      return;
    }
    if (!hasPrintableBarcode({ id: product.id, barcodes: product.barcodes })) {
      toast({ variant: "error", description: t("printMissingBarcode") });
      return;
    }

    setLabelAction(mode);
    try {
      const printValues = buildSavedLabelPrintValues({
        settings,
        storeId: labelStoreId,
      });
      const template = resolveSavedLabelTemplate(settings?.labelTemplate);
      const quantity = resolveSavedLabelCopies(settings?.labelDefaultCopies);
      const blob = await fetchPdfBlob({
        url: "/api/price-tags/pdf",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            template,
            storeId: printValues.storeId || undefined,
            allowWithoutBarcode: false,
            rollCalibration: {
              widthMm: printValues.widthMm,
              heightMm: printValues.heightMm,
              gapMm: settings?.labelRollGapMm,
              xOffsetMm: settings?.labelRollXOffsetMm,
              yOffsetMm: settings?.labelRollYOffsetMm,
            },
            display: settings
              ? {
                  showProductName: settings.labelShowProductName,
                  showPrice: settings.labelShowPrice,
                  showSku: settings.labelShowSku,
                  showStoreName: settings.labelShowStoreName,
                }
              : undefined,
            items: buildBarcodeLabelPrintItems({
              productIds: [product.id],
              quantity,
            }),
          }),
        },
      });
      if (mode === "print") {
        const result = await printPdfBlob(blob);
        if (!result.autoPrintAttempted) {
          toast({ variant: "info", description: t("printFallback") });
        }
        toast({ variant: "success", description: t("printQueued", { count: quantity }) });
      } else {
        downloadPdfBlob(blob, `price-tags-${product.sku}.pdf`);
        toast({ variant: "success", description: t("printDownloadSuccess") });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message && message !== "pdfRequestFailed" && message !== "pdfContentTypeInvalid") {
        toast({ variant: "error", description: message });
        return;
      }
      toast({ variant: "error", description: t("priceTagsFailed") });
    } finally {
      setLabelAction(null);
    }
  };

  if (productQuery.isLoading || !formValues) {
    return (
      <div>
        <PageHeader title={t("editTitle")} subtitle={tCommon("loading")} />
      </div>
    );
  }

  if (productQuery.error) {
    return (
      <div>
        <PageHeader title={t("editTitle")} subtitle={tErrors("genericTitle")} />
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-danger">
          <span>{translateError(tErrors, productQuery.error)}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => productQuery.refetch()}>
            {tErrors("tryAgain")}
          </Button>
        </div>
      </div>
    );
  }

  if (!productQuery.data) {
    return (
      <div>
        <PageHeader title={t("editTitle")} subtitle={t("notFound")} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t("editTitle")}
        subtitle={productQuery.data.name}
        action={
          <>
            <Button
              className="w-full sm:w-auto"
              onClick={() => void handleProductLabelPdf("print")}
              disabled={Boolean(labelAction)}
            >
              {labelAction === "print" ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <PrintIcon className="h-4 w-4" aria-hidden />
              )}
              {t("printLabels")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="secondary" className="w-full sm:w-auto">
                  <MoreIcon className="h-4 w-4" aria-hidden />
                  {tCommon("actions")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[240px]">
                <DropdownMenuItem
                  disabled={Boolean(labelAction)}
                  onSelect={() => void handleProductLabelPdf("download")}
                >
                  {labelAction === "download" ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <DownloadIcon className="h-4 w-4" aria-hidden />
                  )}
                  {t("printDownload")}
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={labelStoreId ? `/stores/${labelStoreId}/hardware` : "/settings/printing"}>
                    <PrintIcon className="h-4 w-4" aria-hidden />
                    {t("changePrintSettings")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setMovementsOpen(true)}>
                  <ViewIcon className="h-4 w-4" aria-hidden />
                  {tInventory("viewMovements")}
                </DropdownMenuItem>
                {isAdmin ? (
                  <DropdownMenuItem
                    disabled={duplicateMutation.isLoading}
                    onSelect={() => duplicateMutation.mutate({ productId })}
                  >
                    {duplicateMutation.isLoading ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      <CopyIcon className="h-4 w-4" aria-hidden />
                    )}
                    {duplicateMutation.isLoading ? tCommon("loading") : t("duplicate")}
                  </DropdownMenuItem>
                ) : null}
                {isAdmin ? (
                  <DropdownMenuItem
                    className="text-danger focus:text-danger"
                    disabled={archiveMutation.isLoading}
                    onSelect={async () => {
                      if (
                        !(await confirm({
                          description: t("confirmArchive"),
                          confirmVariant: "danger",
                        }))
                      ) {
                        return;
                      }
                      archiveMutation.mutate({ productId });
                    }}
                  >
                    {archiveMutation.isLoading ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      <ArchiveIcon className="h-4 w-4" aria-hidden />
                    )}
                    {archiveMutation.isLoading ? tCommon("loading") : t("archive")}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <Card className="mb-6 overflow-hidden">
        <CardContent className="grid gap-4 p-4 sm:p-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="overflow-hidden rounded-none border border-border bg-muted/20">
            {previewImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewImageUrl}
                alt={productQuery.data.name}
                className="aspect-square h-full w-full object-cover"
              />
            ) : (
              <div className="flex aspect-square items-center justify-center">
                <EmptyIcon className="h-10 w-10 text-muted-foreground" aria-hidden />
              </div>
            )}
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {productQuery.data.sku}
              </p>
              <h2 className="text-2xl font-semibold leading-tight text-foreground sm:text-3xl">
                {productQuery.data.name}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="muted">
                {productQuery.data.isBundle ? t("typeBundle") : t("typeProduct")}
              </Badge>
              {(productQuery.data.categories?.length
                ? productQuery.data.categories
                : productQuery.data.category
                  ? [productQuery.data.category]
                  : []
              ).map((category) => (
                <Badge key={category} variant="muted">
                  {category}
                </Badge>
              ))}
              <Badge variant="muted">{productQuery.data.baseUnit.code}</Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-none border border-border/70 bg-card p-3">
                <p className="text-xs text-muted-foreground">{t("salePrice")}</p>
                <p className="text-base font-semibold text-foreground">
                  {effectivePrice !== null
                    ? formatSelectedMoney(effectivePrice)
                    : tCommon("notAvailable")}
                </p>
              </div>
              <div className="rounded-none border border-border/70 bg-card p-3">
                <p className="text-xs text-muted-foreground">{t("avgCost")}</p>
                <p className="text-base font-semibold text-foreground">
                  {avgCost !== null ? formatSelectedMoney(avgCost) : tCommon("notAvailable")}
                </p>
              </div>
              <div className="rounded-none border border-border/70 bg-card p-3">
                <p className="text-xs text-muted-foreground">{tInventory("onHand")}</p>
                <p className="text-base font-semibold text-foreground">
                  {formatNumber(
                    storePricingQuery.data?.stores.reduce((sum, store) => sum + store.onHand, 0) ??
                      0,
                    locale,
                  )}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="mb-6">
        <ProductForm
          key={`${productId}:${selectedPricingCurrencyCode}:${selectedPricingCurrencyRateKgsPerUnit}`}
          initialValues={formValues}
          onSubmit={(values) =>
            updateMutation.mutate({
              productId,
              ...values,
              basePriceKgs: resolveDraftBasePrice(),
            })
          }
          attributeDefinitions={attributesQuery.data ?? []}
          units={unitsQuery.data ?? []}
          isSubmitting={updateMutation.isLoading}
          readOnly={!isAdmin}
          productId={productId}
          showBasePriceField={false}
          currencyCode={selectedPricingCurrencyCode}
          currencyRateKgsPerUnit={selectedPricingCurrencyRateKgsPerUnit}
        />
      </div>

      <Card className="mb-6">
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{t("storePricingTitle")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("storePricingHint")}</p>
        </CardHeader>
        <CardContent>
          {storePricingQuery.isLoading ? (
            <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : storePricingQuery.data ? (
            <div className="space-y-3">
              <div className="rounded-none border border-border bg-card p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{t("basePrice")}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("basePriceFallbackHint")}
                    </p>
                    {currentBasePrice === null && basePriceFallbackCandidate ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("basePriceDerivedHint", {
                          price: formatSelectedMoney(basePriceFallbackCandidate.priceKgs),
                          source: basePriceFallbackSource,
                        })}
                      </p>
                    ) : null}
                  </div>
                  {isAdmin ? (
                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        className="w-full sm:w-[160px]"
                        value={basePriceDraft}
                        onChange={(event) => setBasePriceDraft(event.target.value)}
                        onBlur={() => void handleSaveBasePrice()}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            event.currentTarget.blur();
                          }
                        }}
                        placeholder={t("pricePlaceholder")}
                        disabled={basePriceMutation.isLoading}
                      />
                      {currentBasePrice === null && basePriceFallbackCandidate ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void handleApplyBasePriceFallback()}
                          disabled={basePriceMutation.isLoading}
                        >
                          {t("basePriceApplyDerived")}
                        </Button>
                      ) : null}
                      {basePriceMutation.isLoading ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Spinner className="h-4 w-4" />
                          {tCommon("saving")}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">{t("basePriceReadOnly")}</div>
                  )}
                </div>
              </div>
              {storePricingQuery.data.stores.map((storeRow) => (
                <div key={storeRow.storeId} className="rounded-none border border-border bg-card p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {storeRow.storeName}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge variant="muted">
                          {storeRow.priceOverridden ? t("priceOverridden") : t("priceInherited")}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {storeRow.effectivePriceKgs !== null
                            ? formatStoreMoney(storeRow.effectivePriceKgs, storeRow)
                            : tCommon("notAvailable")}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {tInventory("onHand")}: {formatNumber(storeRow.onHand, locale)}
                        </span>
                      </div>
                    </div>
                    {canManageStorePrices || canManageInventory ? (
                      <div className="flex w-full flex-col gap-2 sm:w-auto">
                        {canManageStorePrices ? (
                          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                            <Input
                              type="number"
                              inputMode="decimal"
                              step="0.01"
                              className="w-full sm:w-[160px]"
                              value={storePriceDrafts[storeRow.storeId] ?? ""}
                              onChange={(event) =>
                                setStorePriceDrafts((prev) => ({
                                  ...prev,
                                  [storeRow.storeId]: event.target.value,
                                }))
                              }
                              onBlur={() => void handleSaveStorePrice(storeRow.storeId)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  event.currentTarget.blur();
                                }
                              }}
                              placeholder={t("pricePlaceholder")}
                              disabled={storePriceMutation.isLoading}
                            />
                            {savingStorePriceId === storeRow.storeId ? (
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Spinner className="h-4 w-4" />
                                {tCommon("saving")}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {canManageInventory ? (
                          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                            <Input
                              type="number"
                              inputMode="numeric"
                              step="1"
                              className="w-full sm:w-[160px]"
                              value={storeOnHandDrafts[storeRow.storeId] ?? String(storeRow.onHand)}
                              onChange={(event) =>
                                setStoreOnHandDrafts((prev) => ({
                                  ...prev,
                                  [storeRow.storeId]: event.target.value,
                                }))
                              }
                              onBlur={() =>
                                void handleSaveStoreOnHand(storeRow.storeId, storeRow.onHand)
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  event.currentTarget.blur();
                                }
                              }}
                              placeholder={tInventory("qtyPlaceholder")}
                              disabled={adjustStockMutation.isLoading}
                            />
                            {savingStoreOnHandId === storeRow.storeId ? (
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Spinner className="h-4 w-4" />
                                {tCommon("saving")}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">{t("storePriceReadOnly")}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{tCommon("notAvailable")}</p>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{t("profitabilityTitle")}</CardTitle>
          <div className="w-full sm:max-w-xs">
            <Select
              value={pricingStoreId || "all"}
              onValueChange={(value) => setPricingStoreId(value === "all" ? "" : value)}
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
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-none border border-border/70 bg-card p-3">
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground">{t("salePrice")}</p>
              {pricingQuery.data?.priceOverridden ? (
                <Badge variant="muted">{t("priceOverridden")}</Badge>
              ) : null}
            </div>
            <p className="text-sm font-semibold">
              {effectivePrice !== null
                ? formatSelectedMoney(effectivePrice)
                : tCommon("notAvailable")}
            </p>
          </div>
          <div className="rounded-none border border-border/70 bg-card p-3">
            <p className="text-xs text-muted-foreground">{t("avgCost")}</p>
            <p className="text-sm font-semibold">
              {avgCost !== null ? formatSelectedMoney(avgCost) : tCommon("notAvailable")}
            </p>
          </div>
          <div className="rounded-none border border-border/70 bg-card p-3">
            <p className="text-xs text-muted-foreground">{t("markupMargin")}</p>
            <p className="text-sm font-semibold">
              {markupPct !== null ? `${formatNumber(markupPct, locale)}%` : tCommon("notAvailable")}
              {" · "}
              {marginPct !== null ? `${formatNumber(marginPct, locale)}%` : tCommon("notAvailable")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground/80">{t("profitabilityHint")}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{t("bundleTitle")}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {canManageBundles ? (
              <Button
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => setComponentDialogOpen(true)}
              >
                <AddIcon className="h-4 w-4" aria-hidden />
                {t("bundleAddComponent")}
              </Button>
            ) : null}
            {canManageBundles && bundleComponentsQuery.data?.length ? (
              <Button className="w-full sm:w-auto" onClick={() => setAssembleOpen(true)}>
                <AddIcon className="h-4 w-4" aria-hidden />
                {t("bundleAssemble")}
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => setShowBundle((prev) => !prev)}>
              {showBundle ? t("hideBundle") : t("showBundle")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {showBundle ? (
            bundleComponentsQuery.isLoading ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="h-4 w-4" />
                {tCommon("loading")}
              </div>
            ) : bundleComponents.length ? (
              <ResponsiveDataList
                items={bundleComponents}
                getKey={(component) => component.id}
                renderDesktop={(visibleItems) => (
                  <div className="overflow-x-auto">
                    <Table className="min-w-[520px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>{tCommon("product")}</TableHead>
                          <TableHead>{t("variant")}</TableHead>
                          <TableHead>{t("bundleQty")}</TableHead>
                          <TableHead>{tCommon("actions")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleItems.map((component) => {
                          const actions = [
                            {
                              key: "remove",
                              label: t("bundleRemoveComponent"),
                              icon: DeleteIcon,
                              variant: "danger" as const,
                              onSelect: async () => {
                                if (
                                  !(await confirm({
                                    description: t("bundleRemoveConfirm"),
                                    confirmVariant: "danger",
                                  }))
                                ) {
                                  return;
                                }
                                removeComponentMutation.mutate({ componentId: component.id });
                              },
                              disabled: !canManageBundles,
                            },
                          ];

                          return (
                            <TableRow key={component.id}>
                              <TableCell>{component.componentProduct.name}</TableCell>
                              <TableCell>
                                {component.componentVariant?.name ?? tCommon("notAvailable")}
                              </TableCell>
                              <TableCell>{formatNumber(component.qty, locale)}</TableCell>
                              <TableCell>
                                {canManageBundles ? (
                                  <RowActions
                                    actions={actions}
                                    maxInline={1}
                                    moreLabel={tCommon("tooltips.moreActions")}
                                  />
                                ) : (
                                  <span className="text-xs text-muted-foreground/80">
                                    {tCommon("notAvailable")}
                                  </span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
                renderMobile={(component) => {
                  const actions = [
                    {
                      key: "remove",
                      label: t("bundleRemoveComponent"),
                      icon: DeleteIcon,
                      variant: "danger" as const,
                      onSelect: async () => {
                        if (
                          !(await confirm({
                            description: t("bundleRemoveConfirm"),
                            confirmVariant: "danger",
                          }))
                        ) {
                          return;
                        }
                        removeComponentMutation.mutate({ componentId: component.id });
                      },
                      disabled: !canManageBundles,
                    },
                  ];

                  return (
                    <div className="rounded-md border border-border bg-card p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {component.componentProduct.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {component.componentVariant?.name ?? tCommon("notAvailable")}
                          </p>
                        </div>
                        <div className="text-sm font-semibold text-foreground">
                          {formatNumber(component.qty, locale)}
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-end">
                        {canManageBundles ? (
                          <RowActions
                            actions={actions}
                            maxInline={1}
                            moreLabel={tCommon("tooltips.moreActions")}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground/80">
                            {tCommon("notAvailable")}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                }}
              />
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <EmptyIcon className="h-4 w-4" aria-hidden />
                {t("bundleEmpty")}
              </div>
            )
          ) : (
            <p className="text-sm text-muted-foreground">{t("bundleHiddenHint")}</p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{t("expiryLotsTitle")}</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLots((prev) => !prev)}
            disabled={!lotsEnabled}
          >
            {showLots ? t("hideLots") : t("showLots")}
          </Button>
        </CardHeader>
        <CardContent>
          {!lotsEnabled ? (
            <p className="text-sm text-muted-foreground">{t("expiryLotsDisabled")}</p>
          ) : showLots ? (
            lotsQuery.isLoading ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="h-4 w-4" />
                {tCommon("loading")}
              </div>
            ) : lots.length ? (
              <ResponsiveDataList
                items={lots}
                getKey={(lot) => lot.id}
                renderDesktop={(visibleItems) => (
                  <div className="overflow-x-auto">
                    <Table className="min-w-[420px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("expiryDate")}</TableHead>
                          <TableHead>{tInventory("onHand")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleItems.map((lot) => (
                          <TableRow key={lot.id}>
                            <TableCell>
                              {lot.expiryDate
                                ? formatDateTime(lot.expiryDate, locale)
                                : t("noExpiry")}
                            </TableCell>
                            <TableCell>{formatNumber(lot.onHandQty, locale)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                renderMobile={(lot) => (
                  <div className="rounded-md border border-border bg-card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">{t("expiryDate")}</p>
                        <p className="text-sm font-medium text-foreground">
                          {lot.expiryDate ? formatDateTime(lot.expiryDate, locale) : t("noExpiry")}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">{tInventory("onHand")}</p>
                        <p className="text-sm font-semibold text-foreground">
                          {formatNumber(lot.onHandQty, locale)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              />
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <EmptyIcon className="h-4 w-4" aria-hidden />
                {t("noLots")}
              </div>
            )
          ) : (
            <p className="text-sm text-muted-foreground">{t("lotsHiddenHint")}</p>
          )}
        </CardContent>
      </Card>
      {updateMutation.error ? (
        <p className="mt-3 text-sm text-danger">{translateError(tErrors, updateMutation.error)}</p>
      ) : null}

      <Modal
        open={componentDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setComponentDialogOpen(false);
            setSelectedComponent(null);
            setComponentSearch("");
          }
        }}
        title={t("bundleAddComponent")}
        subtitle={productQuery.data.name}
      >
        <Form {...componentForm}>
          <form
            className="space-y-4"
            onSubmit={componentForm.handleSubmit((values) => {
              if (!selectedComponent) {
                toast({ variant: "error", description: t("bundleSelectComponent") });
                return;
              }
              addComponentMutation.mutate({
                bundleProductId: productId,
                componentProductId: selectedComponent.id,
                componentVariantId: values.variantId ?? undefined,
                qty: values.qty,
              });
            })}
          >
            <div>
              <FormLabel>{t("bundleSearch")}</FormLabel>
              <div className="relative mt-2">
                <Input
                  value={componentSearch}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setComponentSearch(nextValue);
                    if (selectedComponent && nextValue !== selectedComponent.name) {
                      setSelectedComponent(null);
                      componentForm.setValue("variantId", null);
                    }
                  }}
                  placeholder={t("bundleSearchPlaceholder")}
                />
                {componentSearch.trim().length >= 2 ? (
                  <div className="absolute z-20 mt-2 w-full rounded-md border border-border bg-card shadow-lg">
                    <div className="max-h-56 overflow-y-auto py-1">
                      {componentSearchQuery.isLoading ? (
                        <div className="px-3 py-3 text-sm text-muted-foreground">
                          {tCommon("loading")}
                        </div>
                      ) : componentSearchQuery.data?.length ? (
                        componentSearchQuery.data.map((product) => (
                          <ProductSearchResultItem
                            key={product.id}
                            product={product}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              setSelectedComponent({
                                id: product.id,
                                name: product.name,
                                sku: product.sku,
                              });
                              setComponentSearch(product.name);
                            }}
                          />
                        ))
                      ) : (
                        <div className="px-3 py-3 text-sm text-muted-foreground">
                          {tCommon("nothingFound")}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
              {selectedComponent ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("bundleSelected")}: {selectedComponent.name}
                </p>
              ) : null}
            </div>

            <FormField
              control={componentForm.control}
              name="variantId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("variant")}</FormLabel>
                  <FormControl>
                    <Select
                      value={field.value ?? "BASE"}
                      onValueChange={(value) => field.onChange(value === "BASE" ? null : value)}
                      disabled={!selectedComponent}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("variant")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BASE">{t("variantBase")}</SelectItem>
                        {componentDetailQuery.data?.variants.map((variant) => (
                          <SelectItem key={variant.id} value={variant.id}>
                            {variant.name ?? tCommon("notAvailable")}
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
              control={componentForm.control}
              name="qty"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("bundleQty")}</FormLabel>
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
                onClick={() => setComponentDialogOpen(false)}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                className="w-full sm:w-auto"
                disabled={addComponentMutation.isLoading}
              >
                {addComponentMutation.isLoading ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <AddIcon className="h-4 w-4" aria-hidden />
                )}
                {addComponentMutation.isLoading ? tCommon("loading") : t("bundleAddComponent")}
              </Button>
            </FormActions>
          </form>
        </Form>
      </Modal>

      <Modal
        open={assembleOpen}
        onOpenChange={(open) => {
          if (!open) {
            setAssembleOpen(false);
          }
        }}
        title={t("bundleAssemble")}
        subtitle={productQuery.data.name}
      >
        <Form {...assembleForm}>
          <form
            className="space-y-4"
            onSubmit={assembleForm.handleSubmit((values) => {
              const targetStoreId = pricingStoreId || movementStoreId;
              if (!targetStoreId) {
                toast({ variant: "error", description: tErrors("storeRequired") });
                return;
              }
              assembleMutation.mutate({
                storeId: targetStoreId,
                bundleProductId: productId,
                qty: values.qty,
                idempotencyKey: crypto.randomUUID(),
              });
            })}
          >
            <FormField
              control={assembleForm.control}
              name="qty"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("bundleQty")}</FormLabel>
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
                onClick={() => setAssembleOpen(false)}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                className="w-full sm:w-auto"
                disabled={assembleMutation.isLoading}
              >
                {assembleMutation.isLoading ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <AddIcon className="h-4 w-4" aria-hidden />
                )}
                {assembleMutation.isLoading ? tCommon("loading") : t("bundleAssembleConfirm")}
              </Button>
            </FormActions>
          </form>
        </Form>
      </Modal>

      <Modal
        open={movementsOpen}
        onOpenChange={setMovementsOpen}
        title={tInventory("movementsTitle")}
        subtitle={productQuery.data.name}
        className="max-w-3xl"
      >
        <div className="space-y-4">
          <div className="w-full sm:max-w-xs">
            <Select value={movementStoreId} onValueChange={(value) => setMovementStoreId(value)}>
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
                        <TableHead>{tInventory("movementDate")}</TableHead>
                        <TableHead>{tInventory("movementTypeLabel")}</TableHead>
                        <TableHead>{tInventory("movementQty")}</TableHead>
                        <TableHead className="hidden md:table-cell">
                          {tInventory("movementUser")}
                        </TableHead>
                        <TableHead className="hidden md:table-cell">
                          {tInventory("movementNote")}
                        </TableHead>
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
                            {formatMovementNote(tInventory, movement.note) ||
                              tCommon("notAvailable")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              renderMobile={(movement) => (
                <div className="rounded-md border border-border bg-card p-3">
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
                        {tInventory("movementUser")}
                      </p>
                      <p className="text-foreground/90">
                        {movement.createdBy?.name ??
                          movement.createdBy?.email ??
                          tCommon("notAvailable")}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                        {tInventory("movementNote")}
                      </p>
                      <p className="text-foreground/90">
                        {formatMovementNote(tInventory, movement.note) || tCommon("notAvailable")}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            />
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <EmptyIcon className="h-4 w-4" aria-hidden />
              {tInventory("noMovements")}
            </div>
          )}
        </div>
      </Modal>
      <Modal
        open={labelSetupOpen}
        onOpenChange={(open) => {
          if (!open) {
            setLabelSetupOpen(false);
          }
        }}
        title={t("printSetupRequiredTitle")}
        subtitle={t("printSetupRequiredSubtitle")}
      >
        <div className="space-y-4">
          <div className="border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">
              {t("printSetupSelected", { count: 1 })}
            </p>
            <p className="mt-1">{t("printSetupBody")}</p>
          </div>
          <FormActions>
            <Button
              type="button"
              variant="secondary"
              className="w-full sm:w-auto"
              onClick={() => setLabelSetupOpen(false)}
            >
              {tCommon("cancel")}
            </Button>
            <Button asChild className="w-full sm:w-auto">
              <Link href={labelStoreId ? `/stores/${labelStoreId}/hardware` : "/settings/printing"}>
                <PrintIcon className="h-4 w-4" aria-hidden />
                {t("openPrintSettings")}
              </Link>
            </Button>
          </FormActions>
        </div>
      </Modal>
      {confirmDialog}
    </div>
  );
};

export default ProductDetailPage;

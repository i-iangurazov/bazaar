"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { PageHeader } from "@/components/page-header";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import {
  BackIcon,
  AddIcon,
  CopyIcon,
  DeleteIcon,
  EditIcon,
  EmptyIcon,
  ReceiveIcon,
  SearchIcon,
  StatusDangerIcon,
  StatusSuccessIcon,
} from "@/components/icons";
import { formatStoreMoney } from "@/lib/currencyDisplay";
import { formatNumber } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { cn } from "@/lib/utils";

type ReceivingLine = {
  key: string;
  productId: string;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  sku: string;
  barcode: string | null;
  imageUrl: string | null;
  currentStock: number;
  unitCostInput: string;
  quantityInput: string;
  duplicateHint?: boolean;
};

type ReceivingInputField = "quantity" | "unitCost";
type ReceivingInputViewport = "desktop" | "mobile";
type ReceivingDraftFocus =
  | { target: "search" }
  | { target: "lineInput"; key: string; field: ReceivingInputField };
type ReceivingDraft = {
  version: 1;
  storeId: string;
  dateTime: string;
  supplierName: string;
  referenceNumber: string;
  note: string;
  search: string;
  lines: ReceivingLine[];
  pageScrollY?: number;
  searchResultsScrollTop?: number;
  focusedElement?: ReceivingDraftFocus | null;
};

const toDateTimeLocalValue = (date: Date) => {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

const parseDecimalInput = (value: string) => Number(value.replace(",", "."));
const lineKey = (productId: string, variantId?: string | null) =>
  `${productId}:${variantId ?? "BASE"}`;
const receivingInputRefKey = (
  key: string,
  field: ReceivingInputField,
  viewport: ReceivingInputViewport,
) => `${key}:${field}:${viewport}`;
const receivingDraftStoragePrefix = "bazaar:inventory-receiving-draft:";
const receivingReturnSource = "stockReceiving";
const receivingProductSearchFields: ["name"] = ["name"];

const focusReceivingInputElement = (
  input: HTMLInputElement | null | undefined,
  selectContents = false,
) => {
  if (!input || input.disabled || input.readOnly) {
    return;
  }
  input.focus();
  if (!selectContents) {
    return;
  }
  const selectFocusedInput = () => {
    if (document.activeElement !== input || input.disabled || input.readOnly) {
      return;
    }
    try {
      input.select();
    } catch {
      // Some mobile/browser input types may reject text selection.
    }
  };
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(selectFocusedInput);
  } else {
    window.setTimeout(selectFocusedInput, 0);
  }
};

const createReceivingDraftKey = () =>
  `receiving-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getReceivingDraftStorageKey = (key: string) => `${receivingDraftStoragePrefix}${key}`;

const readReceivingDraft = (key: string): ReceivingDraft | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(getReceivingDraftStorageKey(key));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<ReceivingDraft>;
    if (parsed.version !== 1 || !parsed.storeId || !Array.isArray(parsed.lines)) {
      return null;
    }
    return {
      version: 1,
      storeId: parsed.storeId,
      dateTime: parsed.dateTime ?? "",
      supplierName: parsed.supplierName ?? "",
      referenceNumber: parsed.referenceNumber ?? "",
      note: parsed.note ?? "",
      search: parsed.search ?? "",
      lines: parsed.lines,
      pageScrollY: typeof parsed.pageScrollY === "number" ? parsed.pageScrollY : undefined,
      searchResultsScrollTop:
        typeof parsed.searchResultsScrollTop === "number"
          ? parsed.searchResultsScrollTop
          : undefined,
      focusedElement: parsed.focusedElement ?? null,
    };
  } catch {
    return null;
  }
};

const writeReceivingDraft = (key: string, draft: ReceivingDraft) => {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    window.sessionStorage.setItem(getReceivingDraftStorageKey(key), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
};

type InventoryReceivingPageProps = {
  editDocumentKey?: string;
  editBackHref?: string;
};

export const InventoryReceivingPage = ({
  editDocumentKey,
  editBackHref = "/inventory/movements",
}: InventoryReceivingPageProps = {}) => {
  const t = useTranslations("inventory");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returningDraftKey = searchParams?.get("receivingDraftKey")?.trim() ?? "";
  const returnSource = searchParams?.get("returnSource")?.trim() ?? "";
  const createdProductId = searchParams?.get("createdProductId")?.trim() ?? "";
  const { data: session, status: sessionStatus } = useSession();
  const { toast } = useToast();
  const trpcUtils = trpc.useUtils();
  const canManageStock =
    session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";
  const isEditMode = Boolean(editDocumentKey);
  const loadedEditDocumentRef = useRef("");

  const storesQuery = trpc.stores.list.useQuery();
  type StoreRow = NonNullable<typeof storesQuery.data>[number];
  const stores: StoreRow[] = useMemo(() => storesQuery.data ?? [], [storesQuery.data]);
  const editableDocumentQuery = trpc.inventory.editableProductMovementDocument.useQuery(
    { documentKey: editDocumentKey ?? "" },
    { enabled: Boolean(editDocumentKey && canManageStock), staleTime: 0 },
  );
  const editableDocument = editableDocumentQuery.data ?? null;
  const [storeId, setStoreId] = useState("");
  const [dateTime, setDateTime] = useState(() => toDateTimeLocalValue(new Date()));
  const [supplierName, setSupplierName] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<ReceivingLine[]>([]);
  const [restoredDraftKey, setRestoredDraftKey] = useState("");
  const receivingInputRefs = useRef(new Map<string, HTMLInputElement>());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchResultsRef = useRef<HTMLDivElement>(null);
  const lastFocusedElementRef = useRef<ReceivingDraftFocus | null>(null);
  const pendingRestoreViewRef = useRef<{
    pageScrollY?: number;
    searchResultsScrollTop?: number;
    focusedElement?: ReceivingDraftFocus | null;
  } | null>(null);
  const handledCreatedProductRef = useRef("");

  const selectedStore = stores.find((store) => store.id === storeId) ?? null;
  const enableSku = selectedStore?.enableSku ?? true;
  const enableBarcode = selectedStore?.enableBarcode ?? true;
  const formatMoney = useCallback(
    (value: number) => formatStoreMoney(value, locale, selectedStore),
    [locale, selectedStore],
  );

  const searchQuery = trpc.inventory.searchProducts.useQuery(
    {
      storeId,
      search: search.trim() || undefined,
      searchFields: receivingProductSearchFields,
      limit: 100,
    },
    {
      enabled: Boolean(storeId && canManageStock),
      keepPreviousData: true,
    },
  );
  type SearchResult = NonNullable<typeof searchQuery.data>[number];

  useEffect(() => {
    if (!storeId && stores[0]) {
      setStoreId(stores[0].id);
    }
  }, [storeId, stores]);

  useEffect(() => {
    if (!editableDocument || !editDocumentKey || loadedEditDocumentRef.current === editDocumentKey) {
      return;
    }
    loadedEditDocumentRef.current = editDocumentKey;
    setStoreId(editableDocument.storeId);
    setReferenceNumber(editableDocument.documentNumber ?? editableDocument.referenceId);
    setSupplierName("");
    setNote(editableDocument.notes ?? "");
    setSearch("");
    setLines(
      editableDocument.lines.map((line) => ({
        key: lineKey(line.productId, line.variantId),
        productId: line.productId,
        variantId: line.variantId,
        productName: line.productName,
        variantName: line.variantName,
        sku: "",
        barcode: null,
        imageUrl: null,
        currentStock: 0,
        unitCostInput: line.unitCostKgs === null ? "0" : String(line.unitCostKgs),
        quantityInput: String(line.quantity),
      })),
    );
  }, [editDocumentKey, editableDocument]);

  useEffect(() => {
    if (
      !returningDraftKey ||
      returnSource !== receivingReturnSource ||
      restoredDraftKey === returningDraftKey
    ) {
      return;
    }

    const draft = readReceivingDraft(returningDraftKey);
    if (!draft) {
      setRestoredDraftKey(returningDraftKey);
      return;
    }

    setStoreId(draft.storeId);
    setDateTime(draft.dateTime || toDateTimeLocalValue(new Date()));
    setSupplierName(draft.supplierName);
    setReferenceNumber(draft.referenceNumber);
    setNote(draft.note);
    setLines(draft.lines);
    setSearch(draft.search);
    pendingRestoreViewRef.current = {
      pageScrollY: draft.pageScrollY,
      searchResultsScrollTop: draft.searchResultsScrollTop,
      focusedElement: draft.focusedElement ?? null,
    };
    setRestoredDraftKey(returningDraftKey);
    void trpcUtils.inventory.searchProducts.invalidate();
  }, [restoredDraftKey, returningDraftKey, returnSource, trpcUtils.inventory.searchProducts]);

  const handleStoreChange = (nextStoreId: string) => {
    if (nextStoreId === storeId) {
      return;
    }
    setStoreId(nextStoreId);
    setLines([]);
    setSearch("");
  };

  const getPreviewUrl = useCallback((result: SearchResult) => {
    const imageUrl = result.product.images?.[0]?.url ?? result.product.photoUrl ?? null;
    if (!imageUrl || imageUrl.startsWith("data:image/")) {
      return null;
    }
    return imageUrl;
  }, []);

  const getDisplayName = (result: SearchResult) =>
    result.variant?.name ? `${result.product.name} • ${result.variant.name}` : result.product.name;

  const setReceivingInputRef = (
    key: string,
    field: ReceivingInputField,
    viewport: ReceivingInputViewport,
    node: HTMLInputElement | null,
  ) => {
    const refKey = receivingInputRefKey(key, field, viewport);
    if (node) {
      receivingInputRefs.current.set(refKey, node);
    } else {
      receivingInputRefs.current.delete(refKey);
    }
  };

  const focusReceivingInput = useCallback(
    (
      key: string,
      field: ReceivingInputField,
      viewport?: ReceivingInputViewport,
      options?: { selectContents?: boolean },
    ) => {
      window.setTimeout(() => {
        const viewportKey =
          viewport ?? (window.matchMedia("(min-width: 1024px)").matches ? "desktop" : "mobile");
        const input =
          receivingInputRefs.current.get(receivingInputRefKey(key, field, viewportKey)) ??
          receivingInputRefs.current.get(receivingInputRefKey(key, field, "desktop")) ??
          receivingInputRefs.current.get(receivingInputRefKey(key, field, "mobile"));
        focusReceivingInputElement(input, options?.selectContents ?? false);
      }, 0);
    },
    [],
  );

  const focusQuantity = useCallback(
    (key: string, options?: { selectContents?: boolean }) => {
      focusReceivingInput(key, "quantity", undefined, options);
    },
    [focusReceivingInput],
  );

  useEffect(() => {
    if (restoredDraftKey !== returningDraftKey || !pendingRestoreViewRef.current) {
      return;
    }

    const view = pendingRestoreViewRef.current;
    const restoreView = (clearPending = false) => {
      if (typeof view.searchResultsScrollTop === "number") {
        searchResultsRef.current?.scrollTo({ top: view.searchResultsScrollTop });
      }
      if (typeof view.pageScrollY === "number") {
        window.scrollTo({ top: view.pageScrollY, behavior: "auto" });
      }
      if (view.focusedElement?.target === "search") {
        focusReceivingInputElement(searchInputRef.current);
      } else if (view.focusedElement?.target === "lineInput") {
        focusReceivingInput(view.focusedElement.key, view.focusedElement.field);
      }
      if (clearPending) {
        pendingRestoreViewRef.current = null;
      }
    };

    const timers = [
      window.setTimeout(() => restoreView(), 0),
      window.setTimeout(() => restoreView(), 150),
      window.setTimeout(() => restoreView(true), 500),
    ];
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [focusReceivingInput, restoredDraftKey, returningDraftKey]);

  const clearDuplicateHint = useCallback((key: string) => {
    window.setTimeout(() => {
      setLines((current) =>
        current.map((line) => (line.key === key ? { ...line, duplicateHint: false } : line)),
      );
    }, 1800);
  }, []);

  const addSearchResult = useCallback(
    (result: SearchResult, mode: "manual" | "scan", options?: { selectQuantity?: boolean }) => {
      const key = lineKey(result.product.id, result.snapshot.variantId);
      setLines((current) => {
        const existing = current.find((line) => line.key === key);
        if (existing) {
          return current.map((line) => {
            if (line.key !== key) {
              return line;
            }
            const currentQty = parseDecimalInput(line.quantityInput);
            const nextQty =
              mode === "scan" && Number.isInteger(currentQty) && currentQty > 0
                ? currentQty + 1
                : currentQty;
            return {
              ...line,
              quantityInput: Number.isFinite(nextQty) ? String(nextQty) : line.quantityInput,
              duplicateHint: true,
            };
          });
        }
        return [
          ...current,
          {
            key,
            productId: result.product.id,
            variantId: result.snapshot.variantId ?? null,
            productName: result.product.name,
            variantName: result.variant?.name ?? null,
            sku: enableSku ? result.product.sku : "",
            barcode: enableBarcode ? result.primaryBarcode : null,
            imageUrl: getPreviewUrl(result),
            currentStock: result.snapshot.onHand,
            quantityInput: "1",
            unitCostInput: result.unitCostKgs !== null ? String(result.unitCostKgs) : "0",
          },
        ];
      });
      focusQuantity(key, { selectContents: options?.selectQuantity ?? false });
      clearDuplicateHint(key);
    },
    [clearDuplicateHint, enableBarcode, enableSku, focusQuantity, getPreviewUrl],
  );

  useEffect(() => {
    if (
      !createdProductId ||
      returnSource !== receivingReturnSource ||
      !returningDraftKey ||
      restoredDraftKey !== returningDraftKey ||
      !storeId ||
      !canManageStock
    ) {
      return;
    }

    const handledKey = `${returningDraftKey}:${createdProductId}`;
    if (handledCreatedProductRef.current === handledKey) {
      return;
    }
    handledCreatedProductRef.current = handledKey;

    const addReturnedProduct = async () => {
      try {
        const results = await trpcUtils.inventory.searchProducts.fetch({
          storeId,
          productId: createdProductId,
          limit: 100,
        });
        const result = results.find((item) => item.product.id === createdProductId) ?? results[0];
        if (result) {
          addSearchResult(result, "manual", { selectQuantity: true });
        }
      } catch (error) {
        toast({
          variant: "error",
          description: translateError(tErrors, error as Parameters<typeof translateError>[1]),
        });
      }
    };

    void addReturnedProduct();
  }, [
    addSearchResult,
    canManageStock,
    createdProductId,
    restoredDraftKey,
    returningDraftKey,
    returnSource,
    storeId,
    tErrors,
    toast,
    trpcUtils.inventory.searchProducts,
  ]);

  const handleSearchSubmit = async () => {
    if (!storeId || !search.trim()) {
      return;
    }
    try {
      const results = await trpcUtils.inventory.searchProducts.fetch({
        storeId,
        search: search.trim(),
        searchFields: receivingProductSearchFields,
        limit: 100,
      });
      if (!results.length) {
        toast({ variant: "error", description: t("receivingProductUnavailable") });
      }
    } catch (error) {
      toast({
        variant: "error",
        description: translateError(tErrors, error as Parameters<typeof translateError>[1]),
      });
    }
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    void handleSearchSubmit();
  };

  const createReceivingReturnParams = () => {
    if (!storeId) {
      toast({ variant: "error", description: t("receivingValidationNoStore") });
      return null;
    }

    const draftKey = createReceivingDraftKey();
    const saved = writeReceivingDraft(draftKey, {
      version: 1,
      storeId,
      dateTime,
      supplierName,
      referenceNumber,
      note,
      search,
      lines,
      pageScrollY: window.scrollY,
      searchResultsScrollTop: searchResultsRef.current?.scrollTop ?? 0,
      focusedElement: lastFocusedElementRef.current,
    });
    if (!saved) {
      toast({ variant: "error", description: t("receivingDraftSaveFailed") });
      return null;
    }

    const returnTo = (() => {
      if (!isEditMode || typeof window === "undefined") {
        return "/inventory/receiving";
      }
      const url = new URL(window.location.href);
      url.searchParams.delete("createdProductId");
      url.searchParams.delete("returnSource");
      url.searchParams.delete("receivingDraftKey");
      url.searchParams.delete("storeId");
      return `${url.pathname}${url.search}${url.hash}`;
    })();

    return new URLSearchParams({
      storeId,
      returnTo,
      returnSource: receivingReturnSource,
      receivingDraftKey: draftKey,
    });
  };

  const handleCreateProduct = () => {
    const params = createReceivingReturnParams();
    if (!params) {
      return;
    }
    router.push(`/products/new?${params.toString()}`);
  };

  const handleDuplicateProduct = (result: SearchResult) => {
    const params = createReceivingReturnParams();
    if (!params) {
      return;
    }
    params.set("duplicateFrom", result.product.id);
    router.push(`/products/new?${params.toString()}`);
  };

  const handleEditProduct = (result: SearchResult) => {
    const params = createReceivingReturnParams();
    if (!params) {
      return;
    }
    router.push(`/products/${result.product.id}?${params.toString()}`);
  };

  const handleReceivingInputKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    key: string,
    field: ReceivingInputField,
    viewport: ReceivingInputViewport,
  ) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    const currentRow = event.currentTarget.closest("[data-receiving-line-row]");
    const nextRow = event.shiftKey
      ? currentRow?.previousElementSibling
      : currentRow?.nextElementSibling;
    const nextInput = nextRow?.querySelector<HTMLInputElement>(
      `input[data-receiving-input="${field}"]`,
    );
    if (nextInput) {
      window.setTimeout(() => focusReceivingInputElement(nextInput, true), 0);
      return;
    }

    const currentIndex = lines.findIndex((line) => line.key === key);
    if (currentIndex === -1) {
      return;
    }
    const nextIndex = currentIndex + (event.shiftKey ? -1 : 1);
    const nextLine = lines[nextIndex];
    if (nextLine) {
      focusReceivingInput(nextLine.key, field, viewport, { selectContents: true });
    }
  };

  const updateLine = (key: string, patch: Partial<ReceivingLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const removeLine = (key: string) => {
    setLines((current) => current.filter((line) => line.key !== key));
  };

  const lineMetrics = useMemo(
    () =>
      lines.map((line) => {
        const quantity = parseDecimalInput(line.quantityInput);
        const unitCost = parseDecimalInput(line.unitCostInput);
        const quantityValid = Number.isInteger(quantity) && quantity > 0;
        const unitCostValid = Number.isFinite(unitCost) && unitCost >= 0;
        return {
          key: line.key,
          quantity,
          unitCost,
          quantityValid,
          unitCostValid,
          lineTotal: quantityValid && unitCostValid ? quantity * unitCost : 0,
          newStock: quantityValid ? line.currentStock + quantity : line.currentStock,
        };
      }),
    [lines],
  );

  const metricByKey = useMemo(
    () => new Map(lineMetrics.map((metric) => [metric.key, metric])),
    [lineMetrics],
  );
  const invalidQuantity = lineMetrics.some((metric) => !metric.quantityValid);
  const invalidUnitCost = lineMetrics.some((metric) => !metric.unitCostValid);
  const summary = useMemo(
    () => ({
      products: lines.length,
      totalQuantity: lineMetrics.reduce(
        (sum, metric) => sum + (metric.quantityValid ? metric.quantity : 0),
        0,
      ),
      totalCost: lineMetrics.reduce((sum, metric) => sum + metric.lineTotal, 0),
    }),
    [lineMetrics, lines.length],
  );
  const validationMessage = !storeId
    ? t("receivingValidationNoStore")
    : !lines.length
      ? t("receivingValidationNoProducts")
      : invalidQuantity
        ? t("receivingValidationInvalidQuantity")
        : invalidUnitCost
          ? t("receivingValidationInvalidUnitCost")
          : "";

  const postMutation = trpc.inventory.postStockReceiving.useMutation({
    onSuccess: async (result) => {
      await trpcUtils.inventory.list.invalidate();
      await trpcUtils.inventory.searchProducts.invalidate();
      await trpcUtils.inventory.productMovements.invalidate();
      await trpcUtils.inventory.productMovementDocument.invalidate();
      toast({ variant: "success", description: t("receivingSuccess") });
      router.push(
        `/inventory/movements/${encodeURIComponent(
          `STOCK_RECEIVING:STOCK_RECEIVING:${result.receivingId}`,
        )}`,
      );
    },
    onError: (error) => {
      toast({
        variant: "error",
        description: translateError(tErrors, error) || t("receivingPostFailed"),
      });
    },
  });
  const editMutation = trpc.inventory.editProductMovementDocument.useMutation({
    onSuccess: async () => {
      await trpcUtils.inventory.list.invalidate();
      await trpcUtils.inventory.searchProducts.invalidate();
      await trpcUtils.inventory.productMovements.invalidate();
      await trpcUtils.inventory.productMovementDocument.invalidate();
      await trpcUtils.inventory.editableProductMovementDocument.invalidate();
      toast({ variant: "success", description: t("receivingEditSuccess") });
      router.push(`/inventory/movements/${encodeURIComponent(editDocumentKey ?? "")}`);
    },
    onError: (error) => {
      toast({
        variant: "error",
        description: translateError(tErrors, error) || t("receivingPostFailed"),
      });
    },
  });

  const handlePost = () => {
    if (validationMessage || postMutation.isLoading || editMutation.isLoading) {
      if (validationMessage) {
        toast({ variant: "error", description: validationMessage });
      }
      return;
    }
    const parsedDate = dateTime ? new Date(dateTime) : null;
    const normalizedLines = lines.map((line) => {
      const metric = metricByKey.get(line.key);
      return {
        productId: line.productId,
        variantId: line.variantId,
        quantity: metric?.quantity ?? 0,
        unitCost: metric?.unitCost ?? 0,
      };
    });

    if (isEditMode && editDocumentKey) {
      editMutation.mutate({
        documentKey: editDocumentKey,
        notes: note.trim() || undefined,
        reason: note.trim() || t("receivingEditReason"),
        lines: normalizedLines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          quantity: line.quantity,
          unitCostKgs: line.unitCost,
        })),
        idempotencyKey: crypto.randomUUID(),
      });
      return;
    }

    postMutation.mutate({
      storeId,
      date:
        parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate.toISOString() : undefined,
      supplierName: supplierName.trim() || undefined,
      referenceNumber: referenceNumber.trim() || undefined,
      note: note.trim() || undefined,
      lines: normalizedLines,
      idempotencyKey: crypto.randomUUID(),
    });
  };

  const pageTitle = isEditMode ? t("receivingEditTitle") : t("stockReceiving");
  const pageSubtitle = isEditMode ? t("receivingEditSubtitle") : t("stockReceivingSubtitle");
  const backHref = isEditMode ? editBackHref : "/inventory";
  const saving = postMutation.isLoading || editMutation.isLoading;
  const submitLabel = isEditMode ? t("saveChanges") : t("receivingPost");
  const submitShortLabel = isEditMode ? t("saveChangesShort") : t("receivingPostShort");

  if (sessionStatus === "loading") {
    return <PageLoading />;
  }

  if (!canManageStock) {
    return (
      <div>
        <PageHeader
          title={pageTitle}
          subtitle={pageSubtitle}
          action={
            <Button asChild variant="secondary">
              <Link href={backHref}>
                <BackIcon className="h-4 w-4" aria-hidden />
                {isEditMode ? t("backToMovements") : tCommon("back")}
              </Link>
            </Button>
          }
        />
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          {t("receivingPermissionDenied")}
        </div>
      </div>
    );
  }

  if (isEditMode && editableDocumentQuery.isLoading) {
    return (
      <div>
        <PageHeader
          title={pageTitle}
          subtitle={pageSubtitle}
          action={
            <Button asChild variant="secondary">
              <Link href={backHref}>
                <BackIcon className="h-4 w-4" aria-hidden />
                {t("backToMovements")}
              </Link>
            </Button>
          }
        />
        <PageLoading />
      </div>
    );
  }

  if (isEditMode && editableDocumentQuery.error) {
    return (
      <div>
        <PageHeader
          title={pageTitle}
          subtitle={pageSubtitle}
          action={
            <Button asChild variant="secondary">
              <Link href={backHref}>
                <BackIcon className="h-4 w-4" aria-hidden />
                {t("backToMovements")}
              </Link>
            </Button>
          }
        />
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          {translateError(tErrors, editableDocumentQuery.error)}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-hidden pb-[15rem] md:pb-0">
      <PageHeader
        title={pageTitle}
        subtitle={pageSubtitle}
        action={
          <Button asChild variant="secondary">
            <Link href={backHref}>
              <BackIcon className="h-4 w-4" aria-hidden />
              {isEditMode ? t("backToMovements") : tCommon("back")}
            </Link>
          </Button>
        }
        actionClassName="hidden md:flex"
      />

      <div className="space-y-6">
        <section className="bazaar-doc-surface p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-foreground">
              {t("receivingDetailsTitle")}
            </h3>
            <Button asChild variant="ghost" size="sm" className="md:hidden">
              <Link href={backHref}>
                <BackIcon className="h-4 w-4" aria-hidden />
                {isEditMode ? t("backToMovements") : tCommon("back")}
              </Link>
            </Button>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label>{tCommon("store")}</Label>
              <Select value={storeId} onValueChange={handleStoreChange}>
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
            </div>
            <div className="space-y-2">
              <Label htmlFor="receiving-date">{t("receivingDate")}</Label>
              <Input
                id="receiving-date"
                type="datetime-local"
                value={dateTime}
                onChange={(event) => setDateTime(event.target.value)}
              />
            </div>
            <details className="rounded-xl border border-border/65 bg-muted/25 p-3 lg:hidden">
              <summary className="cursor-pointer text-sm font-semibold text-foreground">
                {tCommon("additional")}
              </summary>
              <div className="mt-3 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="receiving-supplier-mobile">{t("receivingSupplier")}</Label>
                  <Input
                    id="receiving-supplier-mobile"
                    value={supplierName}
                    onChange={(event) => setSupplierName(event.target.value)}
                    placeholder={t("receivingSupplierPlaceholder")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="receiving-reference-mobile">{t("receivingReference")}</Label>
                  <Input
                    id="receiving-reference-mobile"
                    value={referenceNumber}
                    onChange={(event) => setReferenceNumber(event.target.value)}
                    placeholder={t("receivingReferencePlaceholder")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="receiving-note-mobile">{t("receivingNote")}</Label>
                  <Textarea
                    id="receiving-note-mobile"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder={t("notePlaceholder")}
                    rows={3}
                  />
                </div>
              </div>
            </details>
            <div className="hidden space-y-2 lg:block">
              <Label htmlFor="receiving-supplier">{t("receivingSupplier")}</Label>
              <Input
                id="receiving-supplier"
                value={supplierName}
                onChange={(event) => setSupplierName(event.target.value)}
                placeholder={t("receivingSupplierPlaceholder")}
              />
            </div>
            <div className="hidden space-y-2 lg:block">
              <Label htmlFor="receiving-reference">{t("receivingReference")}</Label>
              <Input
                id="receiving-reference"
                value={referenceNumber}
                onChange={(event) => setReferenceNumber(event.target.value)}
                placeholder={t("receivingReferencePlaceholder")}
              />
            </div>
            <div className="hidden space-y-2 lg:col-span-2 lg:block">
              <Label htmlFor="receiving-note">{t("receivingNote")}</Label>
              <Textarea
                id="receiving-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t("notePlaceholder")}
                rows={3}
              />
            </div>
          </div>
        </section>

        <div className="grid items-start gap-4 xl:grid-cols-2">
          <section className="bazaar-doc-surface p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-foreground">
                {t("receivingSearchTitle")}
              </h3>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleCreateProduct}
                disabled={!storeId}
              >
                <AddIcon className="h-4 w-4" aria-hidden />
                {t("receivingCreateProduct")}
              </Button>
            </div>
            <div className="relative">
              <SearchIcon
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                ref={searchInputRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onFocus={() => {
                  lastFocusedElementRef.current = { target: "search" };
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder={t("receivingSearchPlaceholderShort")}
                disabled={!storeId}
                className="pl-9"
                autoComplete="off"
              />
            </div>
            <div
              ref={searchResultsRef}
              className="bazaar-doc-search-list"
            >
              {searchQuery.isFetching ? (
                <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                  <Spinner className="h-4 w-4" />
                  {tCommon("loading")}
                </div>
              ) : (searchQuery.data ?? []).length ? (
                (searchQuery.data ?? []).map((result) => {
                  const key = lineKey(result.product.id, result.snapshot.variantId);
                  const added = lines.some((line) => line.key === key);
                  return (
                    <div
                      key={key}
                      className="bazaar-doc-search-row"
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => addSearchResult(result, "manual")}
                        disabled={!storeId}
                      >
                        <span className="bazaar-doc-thumb">
                          {getPreviewUrl(result) ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={getPreviewUrl(result) ?? ""}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <EmptyIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block whitespace-normal break-words font-medium leading-snug text-foreground">
                            {getDisplayName(result)}
                          </span>
                          <span className="block whitespace-normal break-words text-xs leading-snug text-muted-foreground">
                            {[
                              enableSku ? result.product.sku : "",
                              enableBarcode ? result.primaryBarcode : "",
                            ]
                              .filter(Boolean)
                              .join(" • ") || tCommon("notAvailable")}
                          </span>
                          <span className="block text-xs text-muted-foreground lg:hidden">
                            {t("onHand")}: {formatNumber(result.snapshot.onHand, locale)}
                          </span>
                          <span className="hidden truncate text-xs text-muted-foreground lg:block">
                            {t("onHand")}: {formatNumber(result.snapshot.onHand, locale)}
                            {result.unitCostKgs !== null
                              ? ` • ${t("unitCost")}: ${formatMoney(result.unitCostKgs)}`
                              : ""}
                            {result.priceKgs !== null
                              ? ` • ${t("price")}: ${formatMoney(result.priceKgs)}`
                              : ""}
                          </span>
                        </span>
                        {added ? <Badge variant="success">{t("receivingAdded")}</Badge> : null}
                      </button>
                      <div className="mr-2 flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9"
                          aria-label={t("receivingEditProduct")}
                          title={t("receivingEditProduct")}
                          onClick={() => handleEditProduct(result)}
                          disabled={!storeId}
                        >
                          <EditIcon className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9"
                          aria-label={t("receivingDuplicateProduct")}
                          title={t("receivingDuplicateProduct")}
                          onClick={() => handleDuplicateProduct(result)}
                          disabled={!storeId}
                        >
                          <CopyIcon className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="space-y-3 px-3 py-3 text-sm text-muted-foreground">
                  <p>{storeId ? t("productSearchEmpty") : t("receivingValidationNoStore")}</p>
                  {storeId ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={handleCreateProduct}
                    >
                      <AddIcon className="h-4 w-4" aria-hidden />
                      {t("receivingCreateProduct")}
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          </section>

          <section className="bazaar-doc-surface p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-foreground">
                {t("receivingTableTitle")}
              </h3>
              <Badge variant={validationMessage ? "warning" : "success"}>
                {validationMessage || t("receivingValidationReady")}
              </Badge>
            </div>

            {lines.length ? (
              <div className="space-y-3">
                <div className="hidden px-3 text-[11px] font-medium text-muted-foreground md:grid md:grid-cols-[minmax(10rem,1fr)_4.75rem_6.75rem_5.75rem_4.75rem_2.25rem] md:gap-2">
                  <span>{tCommon("product")}</span>
                  <span>{t("receiveQty")}</span>
                  <span>{t("unitCost")}</span>
                  <span>{t("receivingLineTotal")}</span>
                  <span>{t("receivingNewStock")}</span>
                  <span />
                </div>
                {lines.map((line, index) => {
                  const metric = metricByKey.get(line.key);
                  const lineNumber = index + 1;
                  return (
                    <div
                      key={line.key}
                      data-receiving-line-row
                      className="bazaar-doc-line-row grid gap-3 md:grid-cols-[minmax(10rem,1fr)_4.75rem_6.75rem_5.75rem_4.75rem_2.25rem] md:items-center md:gap-2"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="bazaar-doc-line-index">
                          {lineNumber}
                        </span>
                        <span className="bazaar-doc-line-thumb">
                          {line.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={line.imageUrl}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <EmptyIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="whitespace-normal break-words text-sm font-semibold leading-snug text-foreground">
                            {line.variantName
                              ? `${line.productName} • ${line.variantName}`
                              : line.productName}
                          </p>
                          <p className="whitespace-normal break-words text-xs leading-snug text-muted-foreground">
                            {[enableSku ? line.sku : "", enableBarcode ? line.barcode : ""]
                              .filter(Boolean)
                              .join(" • ") || tCommon("notAvailable")}
                          </p>
                          <p className="text-xs text-muted-foreground md:hidden">
                            {t("onHand")}: {formatNumber(line.currentStock, locale)}
                          </p>
                          {line.duplicateHint ? (
                            <p className="whitespace-normal break-words text-xs leading-snug text-warning">
                              {t("receivingDuplicateHint")}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="space-y-1 md:space-y-0">
                        <Label className="block text-[11px] leading-4 md:hidden">
                          {t("receiveQty")}
                        </Label>
                        <Input
                          ref={(node) => {
                            setReceivingInputRef(line.key, "quantity", "desktop", node);
                          }}
                          value={line.quantityInput}
                          onChange={(event) =>
                            updateLine(line.key, { quantityInput: event.target.value })
                          }
                          onFocus={() => {
                            lastFocusedElementRef.current = {
                              target: "lineInput",
                              key: line.key,
                              field: "quantity",
                            };
                          }}
                          onKeyDown={(event) =>
                            handleReceivingInputKeyDown(event, line.key, "quantity", "desktop")
                          }
                          type="number"
                          inputMode="numeric"
                          min={1}
                          step={1}
                          data-receiving-input="quantity"
                          className={cn("h-8 px-2", !metric?.quantityValid && "border-danger/60")}
                        />
                      </div>
                      <div className="space-y-1 md:space-y-0">
                        <Label className="block text-[11px] leading-4 md:hidden">
                          {t("unitCost")}
                        </Label>
                        <Input
                          ref={(node) => {
                            setReceivingInputRef(line.key, "unitCost", "desktop", node);
                          }}
                          value={line.unitCostInput}
                          onChange={(event) =>
                            updateLine(line.key, { unitCostInput: event.target.value })
                          }
                          onFocus={() => {
                            lastFocusedElementRef.current = {
                              target: "lineInput",
                              key: line.key,
                              field: "unitCost",
                            };
                          }}
                          onKeyDown={(event) =>
                            handleReceivingInputKeyDown(event, line.key, "unitCost", "desktop")
                          }
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          data-receiving-input="unitCost"
                          className={cn("h-8 px-2", !metric?.unitCostValid && "border-danger/60")}
                        />
                      </div>
                      <div>
                        <p className="text-[11px] leading-4 text-muted-foreground md:hidden">
                          {t("receivingLineTotal")}
                        </p>
                        <p className="flex h-8 items-center text-sm font-semibold text-foreground">
                          {formatMoney(metric?.lineTotal ?? 0)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] leading-4 text-muted-foreground md:hidden">
                          {t("receivingNewStock")}
                        </p>
                        <p className="flex h-8 items-center text-sm font-semibold text-foreground">
                          {formatNumber(metric?.newStock ?? line.currentStock, locale)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="self-start md:h-8 md:w-8 md:self-center md:justify-self-end"
                        aria-label={t("receivingRemoveLine")}
                        onClick={() => removeLine(line.key)}
                      >
                        <DeleteIcon className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bazaar-doc-empty">
                <EmptyIcon className="mx-auto mb-3 h-8 w-8" aria-hidden />
                {t("receivingEmptyState")}
              </div>
            )}
          </section>
        </div>

        <section className="hidden md:block">
          <div className="bazaar-doc-summary">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h3 className="text-base font-semibold text-foreground">
                {t("receivingSummaryTitle")}
              </h3>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="secondary">
                  <Link href={backHref}>{tCommon("cancel")}</Link>
                </Button>
                <Button
                  type="button"
                  onClick={handlePost}
                  disabled={saving || Boolean(validationMessage)}
                >
                  {saving ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <ReceiveIcon className="h-4 w-4" aria-hidden />
                  )}
                  {saving ? tCommon("saving") : submitLabel}
                </Button>
              </div>
            </div>
            <dl className="mt-4 grid gap-3 text-sm lg:grid-cols-4">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{tCommon("store")}</dt>
                <dd className="text-right font-medium text-foreground">
                  {selectedStore?.name ?? tCommon("notAvailable")}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{t("receivingProductsCount")}</dt>
                <dd className="font-medium text-foreground">
                  {formatNumber(summary.products, locale)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{t("receivingTotalQuantity")}</dt>
                <dd className="font-medium text-foreground">
                  {formatNumber(summary.totalQuantity, locale)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{t("receivingTotalCost")}</dt>
                <dd className="font-medium text-foreground">{formatMoney(summary.totalCost)}</dd>
              </div>
            </dl>
            <div
              className={cn(
                "bazaar-doc-validation",
                validationMessage
                  ? "border-warning/30 bg-warning/10 text-warning"
                  : "border-success/30 bg-success/10 text-success",
              )}
            >
              {validationMessage ? (
                <StatusDangerIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              ) : (
                <StatusSuccessIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              )}
              <span>{validationMessage || t("receivingValidationReady")}</span>
            </div>
          </div>
        </section>
      </div>
      <div className="bazaar-doc-mobile-actions bottom-[calc(4.25rem+env(safe-area-inset-bottom))] md:hidden">
        <div className="mx-auto max-w-screen-sm space-y-2 pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <div className="min-w-0">
              <span className="font-semibold text-foreground">
                {formatNumber(summary.products, locale)}
              </span>{" "}
              {t("receivingProductsCountShort")}
              <span className="px-1 text-muted-foreground/60">·</span>
              <span className="font-semibold text-foreground">
                {formatNumber(summary.totalQuantity, locale)}
              </span>{" "}
              {t("receivingTotalQuantityShort")}
            </div>
            <div className="shrink-0 text-sm font-semibold text-foreground">
              {formatMoney(summary.totalCost)}
            </div>
          </div>
          <div className="grid grid-cols-[0.8fr_1.2fr] gap-2">
            <Button asChild variant="secondary" className="min-h-11">
              <Link href={backHref}>{tCommon("cancel")}</Link>
            </Button>
            <Button
              type="button"
              className="min-h-11"
              onClick={handlePost}
              disabled={saving || Boolean(validationMessage)}
            >
              {saving ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <ReceiveIcon className="h-4 w-4" aria-hidden />
              )}
              <span className="sm:hidden">
                {saving ? tCommon("saving") : submitShortLabel}
              </span>
              <span className="hidden sm:inline">
                {saving ? tCommon("saving") : submitLabel}
              </span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InventoryReceivingPage;

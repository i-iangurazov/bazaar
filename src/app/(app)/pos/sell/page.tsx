"use client";

import { memo, useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import Link from "next/link";
import { CustomerOrderStatus, PosPaymentMethod } from "@prisma/client";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import {
  BackIcon,
  AddIcon,
  ChevronDownIcon,
  CloseIcon,
  DeleteIcon,
  DownloadIcon,
  EmptyIcon,
  EditIcon,
  PrintIcon,
  SearchIcon,
  SalesOrdersIcon,
  StatusWarningIcon,
  TagIcon,
  ViewIcon,
} from "@/components/icons";
import { ScanInput } from "@/components/ScanInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { PopoverSurface } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import {
  currencySourceWithFallback,
  displayMoneyFromKgs,
  displayMoneyToKgs,
  formatKgsMoney,
  resolveCurrency,
} from "@/lib/currencyDisplay";
import { formatDateTime, formatNumber } from "@/lib/i18nFormat";
import { moneyToMinorUnits, parseMoneyInput } from "@/lib/moneyInput";
import { getQzTrayBinding, printPdfBlobViaQzTray, qzTrayErrorMessageKey } from "@/lib/qzTrayPrint";
import { downloadPdfBlob, fetchPdfBlob, printPdfBlob } from "@/lib/pdfClient";
import {
  createDefaultPosPaymentDraft,
  type PosPaymentAutoFillState,
  type PosPaymentDraft,
  reconcilePosPaymentDraftsForSaleTotal,
} from "@/lib/posPaymentDrafts";
import { normalizeScanValue } from "@/lib/scanning/normalize";
import { useSse } from "@/lib/useSse";
import {
  resolveScanResult,
  shouldSubmitFromKey,
  type ScanResolvedResult,
} from "@/lib/scanning/scanRouter";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const selectedRegisterKey = "pos:selected-register";
const keyboardScanResetMs = 300;
const keyboardScanMaxLength = 128;

const isEditableElement = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  if (target.closest("[contenteditable='true']")) {
    return true;
  }
  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
};

const createIdempotencyKey = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `pos-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const formatDateInput = (value: Date) => value.toISOString().slice(0, 10);

const useDebouncedValue = (value: string, delayMs: number) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
};

const hasTouchKeyboard = () => {
  if (typeof window === "undefined") {
    return false;
  }
  return (
    (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches) ||
    (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0)
  );
};

type PosCustomerSelection = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address?: string | null;
};

type CustomerCreatePanelProps = {
  name: string;
  email: string;
  phone: string;
  address: string;
  namePlaceholder: string;
  emailPlaceholder: string;
  phonePlaceholder: string;
  addressPlaceholder: string;
  submitLabel: string;
  isLoading: boolean;
  disabled: boolean;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onAddressChange: (value: string) => void;
  onSubmit: () => void;
};

const CustomerCreatePanel = ({
  name,
  email,
  phone,
  address,
  namePlaceholder,
  emailPlaceholder,
  phonePlaceholder,
  addressPlaceholder,
  submitLabel,
  isLoading,
  disabled,
  onNameChange,
  onEmailChange,
  onPhoneChange,
  onAddressChange,
  onSubmit,
}: CustomerCreatePanelProps) => (
  <div className="space-y-2 border-t border-border px-3 py-3">
    <Input
      value={name}
      onChange={(event) => onNameChange(event.target.value)}
      placeholder={namePlaceholder}
      autoComplete="name"
    />
    <Input
      value={email}
      onChange={(event) => onEmailChange(event.target.value)}
      placeholder={emailPlaceholder}
      autoComplete="email"
      inputMode="email"
    />
    <Input
      value={phone}
      onChange={(event) => onPhoneChange(event.target.value)}
      placeholder={phonePlaceholder}
      autoComplete="tel"
    />
    <Textarea
      value={address}
      onChange={(event) => onAddressChange(event.target.value)}
      placeholder={addressPlaceholder}
      autoComplete="street-address"
      className="min-h-20"
    />
    <Button
      type="button"
      className="h-10 w-full justify-start"
      onClick={onSubmit}
      disabled={disabled}
    >
      {isLoading ? <Spinner className="h-4 w-4" /> : <AddIcon className="h-4 w-4" aria-hidden />}
      {submitLabel}
    </Button>
  </div>
);

type PosCartProduct = {
  id: string;
  sku?: string | null;
  name: string;
  isBundle?: boolean;
  basePriceKgs?: number | null;
  effectivePriceKgs?: number | null;
  photoUrl?: string | null;
  primaryImage?: string | null;
  images?: Array<{ url: string }>;
  complianceFlags?: {
    requiresMarking: boolean;
    markingType?: string | null;
  } | null;
};

type PosCatalogProduct = PosCartProduct & {
  onHandQty?: number | null;
  barcodes?: Array<{ value: string }>;
};

type PosCartLine = {
  id: string;
  serverLineId?: string;
  productId?: string;
  variantId?: string | null;
  variantKey?: string | null;
  qty: number;
  unitPriceKgs: number;
  lineTotalKgs: number;
  unitCostKgs?: number | null;
  lineCostTotalKgs?: number | null;
  markingCodes: string[];
  product: {
    id: string;
    sku?: string | null;
    name: string;
    primaryImage?: string | null;
    isBundle?: boolean;
    complianceFlags?: {
      requiresMarking: boolean;
      markingType?: string | null;
    } | null;
  };
};

type LineInputDraft = {
  price?: string;
  qty?: string;
};

type PendingLinePatch = {
  qty?: number;
  unitPriceKgs?: number;
};

const optimisticLinePrefix = "optimistic:";

const isOptimisticLineId = (lineId: string) => lineId.startsWith(optimisticLinePrefix);

const optimisticLineIdForProduct = (productId: string, variantKey = "BASE") =>
  `${optimisticLinePrefix}${productId}:${variantKey}`;

const getCartLineProductId = (line: PosCartLine) => line.productId ?? line.product.id;

const findCartLineForProduct = (lines: PosCartLine[], productId: string, variantKey = "BASE") =>
  lines.find(
    (line) =>
      getCartLineProductId(line) === productId && (line.variantKey ?? "BASE") === variantKey,
  );

const parseDraftNumber = parseMoneyInput;

const recalculateCartLine = (line: PosCartLine, patch: PendingLinePatch): PosCartLine => {
  const qty = patch.qty ?? line.qty;
  const unitPriceKgs = patch.unitPriceKgs ?? line.unitPriceKgs;

  return {
    ...line,
    qty,
    unitPriceKgs,
    lineTotalKgs: roundMoney(unitPriceKgs * qty),
    lineCostTotalKgs:
      line.unitCostKgs === null || line.unitCostKgs === undefined
        ? (line.lineCostTotalKgs ?? null)
        : roundMoney(line.unitCostKgs * qty),
  };
};

const calculateCartSubtotalKgs = (lines: PosCartLine[]) =>
  roundMoney(
    lines.reduce((sum, line) => {
      const lineTotal = Number(line.lineTotalKgs);
      return Number.isFinite(lineTotal) ? sum + lineTotal : sum;
    }, 0),
  );

const buildOptimisticLine = (product: PosCartProduct): PosCartLine => {
  const unitPriceKgs = product.effectivePriceKgs ?? product.basePriceKgs ?? 0;
  const primaryImage = product.primaryImage ?? product.images?.[0]?.url ?? product.photoUrl ?? null;

  return {
    id: optimisticLineIdForProduct(product.id),
    productId: product.id,
    variantId: null,
    variantKey: "BASE",
    qty: 1,
    unitPriceKgs,
    lineTotalKgs: roundMoney(unitPriceKgs),
    unitCostKgs: null,
    lineCostTotalKgs: null,
    markingCodes: [],
    product: {
      id: product.id,
      sku: product.sku ?? "",
      name: product.name,
      primaryImage,
      isBundle: Boolean(product.isBundle),
      complianceFlags: product.complianceFlags ?? null,
    },
  };
};

type ProductStockMeta = {
  label: string;
  className: string;
  showWarningIcon: boolean;
};

type PosProductButtonProps = {
  product: PosCatalogProduct;
  variant: "desktop" | "mobile";
  enableSku: boolean;
  enableBarcode: boolean;
  disabled: boolean;
  cartQty: number;
  addProductLabel: string;
  decreaseQtyLabel: string;
  increaseQtyLabel: string;
  priceMissingLabel: string;
  formatSaleMoney: (amountKgs: number) => string;
  stockMeta: (stockQty: number | null) => ProductStockMeta;
  onProductClick: (product: PosCatalogProduct) => void;
  onProductDecrement: (product: PosCatalogProduct) => void;
};

const PosProductButton = memo(function PosProductButton({
  product,
  variant,
  enableSku,
  enableBarcode,
  disabled,
  cartQty,
  addProductLabel,
  decreaseQtyLabel,
  increaseQtyLabel,
  priceMissingLabel,
  formatSaleMoney,
  stockMeta,
  onProductClick,
  onProductDecrement,
}: PosProductButtonProps) {
  const priceKgs = product.effectivePriceKgs ?? product.basePriceKgs ?? null;
  const stockQty = product.onHandQty ?? null;
  const barcode = product.barcodes?.[0]?.value ?? null;
  const productIdentity = [enableSku ? product.sku : "", enableBarcode && barcode ? barcode : ""]
    .filter(Boolean)
    .join(" · ");
  const primaryImage = product.images?.[0]?.url ?? product.photoUrl;
  const stock = stockMeta(stockQty);
  const priceMissing = priceKgs === null;

  const activateProduct = () => {
    if (disabled) {
      return;
    }
    onProductClick(product);
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      data-testid="pos-product-button"
      data-product-id={product.id}
      onClick={activateProduct}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activateProduct();
        }
      }}
      className={`group grid w-full cursor-pointer grid-cols-[64px_minmax(0,1fr)] items-center gap-3 rounded-md border border-border bg-card text-left shadow-sm transition hover:border-primary/50 hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-60 sm:grid-cols-[64px_minmax(0,1fr)_auto] dark:hover:bg-accent/40 ${
        variant === "mobile" ? "min-h-20 p-2" : "min-h-[92px] p-3"
      }`}
    >
      <span className="grid h-16 w-16 place-items-center overflow-hidden rounded-md border border-border bg-muted/30">
        {primaryImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={primaryImage}
            alt={product.name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <EmptyIcon className="h-5 w-5 text-muted-foreground" aria-hidden />
        )}
      </span>

      <div className="min-w-0 self-stretch">
        <div className="grid min-h-full gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0">
            <p className="line-clamp-3 break-words text-sm font-semibold leading-5 text-foreground">
              {product.name}
            </p>
            {productIdentity ? (
              <p className="mt-0.5 line-clamp-2 break-all text-[11px] leading-4 text-muted-foreground sm:text-xs">
                {productIdentity}
              </p>
            ) : null}
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
              <span
                className={`inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${stock.className}`}
              >
                {stock.showWarningIcon ? (
                  <StatusWarningIcon className="h-3 w-3 shrink-0" aria-hidden />
                ) : null}
                <span className="truncate">{stock.label}</span>
              </span>
              <span
                className={
                  priceMissing
                    ? "text-xs font-medium text-muted-foreground"
                    : "text-sm font-bold text-foreground"
                }
              >
                {priceMissing ? priceMissingLabel : formatSaleMoney(priceKgs)}
              </span>
            </div>
          </div>

          <div
            className="flex shrink-0 items-center justify-end"
            onClick={(event) => event.stopPropagation()}
          >
            {cartQty > 0 ? (
              <div className="inline-flex h-10 items-center overflow-hidden rounded-md border border-border bg-background">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 rounded-md text-base"
                  onClick={() => onProductDecrement(product)}
                  disabled={disabled || cartQty <= 0}
                  aria-label={decreaseQtyLabel}
                >
                  -
                </Button>
                <span className="min-w-9 px-2 text-center text-sm font-semibold tabular-nums text-foreground">
                  {cartQty}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 rounded-md text-base"
                  onClick={() => onProductClick(product)}
                  disabled={disabled}
                  aria-label={increaseQtyLabel}
                >
                  +
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="secondary"
                className="h-10 min-w-10 shrink-0 px-3"
                onClick={() => onProductClick(product)}
                disabled={disabled}
                aria-label={addProductLabel}
              >
                <AddIcon className="h-4 w-4" aria-hidden />
                <span className="hidden xl:inline">{addProductLabel}</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

const PosSellPage = () => {
  const t = useTranslations("pos");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const trpcUtils = trpc.useUtils();
  const { toast } = useToast();

  const [registerId, setRegisterId] = useState(searchParams.get("registerId") ?? "");
  const [saleId, setSaleId] = useState<string | null>(null);
  const [lineSearch, setLineSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [markingInput, setMarkingInput] = useState<Record<string, string>>({});
  const [payments, setPaymentsState] = useState<PosPaymentDraft[]>(() => [
    createDefaultPosPaymentDraft(),
  ]);
  const [discountDraft, setDiscountDraft] = useState("");
  const [discountEditorOpen, setDiscountEditorOpen] = useState(false);
  const [sellInDebt, setSellInDebt] = useState(false);
  const [debtFullName, setDebtFullName] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<PosCustomerSelection | null>(null);
  const [customerSelectorOpen, setCustomerSelectorOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerCreateOpen, setCustomerCreateOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerEmail, setNewCustomerEmail] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [newCustomerAddress, setNewCustomerAddress] = useState("");
  const [customerEditOpen, setCustomerEditOpen] = useState(false);
  const [customerEditName, setCustomerEditName] = useState("");
  const [customerEditEmail, setCustomerEditEmail] = useState("");
  const [customerEditPhone, setCustomerEditPhone] = useState("");
  const [customerEditAddress, setCustomerEditAddress] = useState("");
  const [receiptJournalOpen, setReceiptJournalOpen] = useState(false);
  const [journalSearch, setJournalSearch] = useState("");
  const [journalDateFrom, setJournalDateFrom] = useState("");
  const [journalDateTo, setJournalDateTo] = useState("");
  const [journalStatusFilter, setJournalStatusFilter] = useState<CustomerOrderStatus | "ALL">(
    CustomerOrderStatus.COMPLETED,
  );
  const [journalPaymentMethodFilter, setJournalPaymentMethodFilter] = useState<
    PosPaymentMethod | "ALL"
  >("ALL");
  const [journalReturnStateFilter, setJournalReturnStateFilter] = useState<
    "ALL" | "NONE" | "RETURNED"
  >("ALL");
  const [journalCashierId, setJournalCashierId] = useState("");
  const [journalPage, setJournalPage] = useState(1);
  const [journalDetailSaleId, setJournalDetailSaleId] = useState<string | null>(null);
  const [journalReturnSaleId, setJournalReturnSaleId] = useState<string | null>(null);
  const [journalReturnQtyByLine, setJournalReturnQtyByLine] = useState<Record<string, string>>({});
  const [journalRefundMethod, setJournalRefundMethod] = useState<PosPaymentMethod>(
    PosPaymentMethod.CASH,
  );
  const [journalReturnNotes, setJournalReturnNotes] = useState("");
  const [journalReceiptAction, setJournalReceiptAction] = useState<{
    saleId: string;
    mode: "download" | "print";
    kind: "precheck" | "fiscal";
  } | null>(null);
  const [optimisticSaleLines, setOptimisticSaleLinesState] = useState<PosCartLine[] | null>(null);
  const [lineInputDrafts, setLineInputDrafts] = useState<Record<string, LineInputDraft>>({});
  const [lastCompletedSale, setLastCompletedSale] = useState<{
    id: string;
    number: string;
    kkmStatus: "NOT_SENT" | "SENT" | "FAILED";
  } | null>(null);
  const [receiptAction, setReceiptAction] = useState<{
    mode: "download" | "print";
    kind: "precheck" | "fiscal";
  } | null>(null);
  const [autoReceiptStatus, setAutoReceiptStatus] = useState<
    "idle" | "printing" | "ready" | "blocked" | "failed"
  >("idle");
  const [mobileCheckoutOpen, setMobileCheckoutOpen] = useState(false);
  const [isPhoneScreen, setIsPhoneScreen] = useState<boolean | null>(null);
  const lineSearchInputRef = useRef<HTMLInputElement | null>(null);
  const paymentsSectionRef = useRef<HTMLDivElement | null>(null);
  const firstPaymentAmountRef = useRef<HTMLInputElement | null>(null);
  const keyboardScanBufferRef = useRef("");
  const keyboardScanResetTimerRef = useRef<number | null>(null);
  const keyboardScanSubmittingRef = useRef(false);
  const optimisticSaleLinesRef = useRef<PosCartLine[] | null>(null);
  const pendingCartMutationCountRef = useRef(0);
  const removedOptimisticLineIdsRef = useRef<Set<string>>(new Set());
  const pendingAddProductIdsRef = useRef<Set<string>>(new Set());
  const pendingCartSyncPromisesRef = useRef<Set<Promise<void>>>(new Set());
  const draftCreationRef = useRef<Promise<{ id: string }> | null>(null);
  const lineSyncTimersRef = useRef<Record<string, number>>({});
  const lineSyncDraftsRef = useRef<Record<string, PendingLinePatch>>({});
  const lineSyncInFlightRef = useRef<Set<string>>(new Set());
  const lineSyncPendingRef = useRef<Set<string>>(new Set());
  const visibleProductsRef = useRef<PosCatalogProduct[]>([]);
  const autoPrintedSaleIdRef = useRef<string | null>(null);
  const paymentsRef = useRef<PosPaymentDraft[]>(payments);
  const paymentAutoFillRef = useRef<PosPaymentAutoFillState>({
    saleId: null,
    totalKgs: null,
  });

  const setPayments = useCallback((updater: SetStateAction<PosPaymentDraft[]>) => {
    const next =
      typeof updater === "function"
        ? (updater as (current: PosPaymentDraft[]) => PosPaymentDraft[])(paymentsRef.current)
        : updater;
    paymentsRef.current = next;
    setPaymentsState(next);
  }, []);

  const registersQuery = trpc.pos.registers.list.useQuery();
  const selectedRegister = (registersQuery.data ?? []).find((item) => item.id === registerId);
  const enableSku = selectedRegister?.store.enableSku ?? true;
  const enableBarcode = selectedRegister?.store.enableBarcode ?? true;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (registerId) {
      window.localStorage.setItem(selectedRegisterKey, registerId);
      return;
    }
    const saved = window.localStorage.getItem(selectedRegisterKey);
    if (saved) {
      setRegisterId(saved);
    }
  }, [registerId]);

  useEffect(() => {
    if (registerId || !registersQuery.data?.[0]) {
      return;
    }
    setRegisterId(registersQuery.data[0].id);
  }, [registerId, registersQuery.data]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      setIsPhoneScreen(false);
      return;
    }

    const phoneQuery = window.matchMedia("(max-width: 767px)");
    const updatePhoneScreen = () => setIsPhoneScreen(phoneQuery.matches);

    updatePhoneScreen();
    phoneQuery.addEventListener("change", updatePhoneScreen);

    return () => {
      phoneQuery.removeEventListener("change", updatePhoneScreen);
    };
  }, []);

  const shiftQuery = trpc.pos.shifts.current.useQuery(
    { registerId },
    { enabled: Boolean(registerId), refetchOnWindowFocus: true },
  );

  const hasLocalCartLines = Boolean(optimisticSaleLines?.length);
  const saleQuery = trpc.pos.sales.get.useQuery(
    { saleId: saleId ?? "" },
    { enabled: Boolean(saleId && !hasLocalCartLines), refetchOnWindowFocus: true },
  );
  const activeDraftQuery = trpc.pos.sales.activeDraft.useQuery(
    { registerId },
    { enabled: Boolean(registerId && shiftQuery.data?.id), refetchOnWindowFocus: true },
  );

  const focusLineSearchInput = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.requestAnimationFrame(() => {
      if (hasTouchKeyboard()) {
        lineSearchInputRef.current?.blur();
        return;
      }
      lineSearchInputRef.current?.focus();
      lineSearchInputRef.current?.select();
    });
  }, []);

  const focusPaymentsInput = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.requestAnimationFrame(() => {
      paymentsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      firstPaymentAmountRef.current?.focus();
      firstPaymentAmountRef.current?.select();
    });
  }, []);

  const debouncedLineSearch = useDebouncedValue(lineSearch.trim(), 180);
  const debouncedCustomerSearch = useDebouncedValue(customerSearch.trim(), 200);
  const debouncedJournalSearch = useDebouncedValue(journalSearch.trim(), 250);
  const searchTerm = debouncedLineSearch;
  const hasSearchTerm = lineSearch.trim().length >= 1;
  const activeStoreId = shiftQuery.data?.store.id;
  const journalStoreId = activeStoreId ?? selectedRegister?.store.id;
  const journalSelectedSaleId = journalReturnSaleId ?? journalDetailSaleId;
  const receiptPrintSettingsQuery = trpc.stores.hardware.useQuery(
    { storeId: activeStoreId ?? "" },
    { enabled: Boolean(activeStoreId), staleTime: 60_000 },
  );
  const receiptPrintSettings = receiptPrintSettingsQuery.data?.settings;
  const productsBootstrapQuery = trpc.products.bootstrap.useQuery(
    { storeId: activeStoreId, page: 1, pageSize: 1 },
    { enabled: Boolean(activeStoreId), staleTime: 60_000 },
  );
  const catalogProductsQuery = trpc.products.list.useQuery(
    {
      search: searchTerm || undefined,
      category: selectedCategory || undefined,
      storeId: activeStoreId,
      page: 1,
      pageSize: 80,
      sortKey: "name",
      sortDirection: "asc",
    },
    { enabled: Boolean(activeStoreId), keepPreviousData: true, staleTime: 30_000 },
  );
  const customerSearchQuery = trpc.pos.customers.search.useQuery(
    {
      storeId: activeStoreId ?? "",
      search: debouncedCustomerSearch || undefined,
      pageSize: 20,
    },
    {
      enabled: customerSelectorOpen && Boolean(activeStoreId),
      staleTime: 15_000,
    },
  );
  const journalCashiersQuery = trpc.pos.cashiers.list.useQuery(
    { storeId: journalStoreId ?? undefined },
    {
      enabled: receiptJournalOpen && Boolean(journalStoreId),
      staleTime: 60_000,
    },
  );
  const journalSalesQuery = trpc.pos.sales.list.useQuery(
    {
      storeId: journalStoreId ?? undefined,
      search: debouncedJournalSearch || undefined,
      statuses: journalStatusFilter === "ALL" ? undefined : [journalStatusFilter],
      cashierId: journalCashierId || undefined,
      paymentMethod:
        journalPaymentMethodFilter === "ALL" ? undefined : journalPaymentMethodFilter,
      returnState:
        journalReturnStateFilter === "NONE"
          ? "none"
          : journalReturnStateFilter === "RETURNED"
            ? "returned"
            : undefined,
      dateFrom: journalDateFrom ? new Date(`${journalDateFrom}T00:00:00`) : undefined,
      dateTo: journalDateTo ? new Date(`${journalDateTo}T23:59:59`) : undefined,
      page: journalPage,
      pageSize: 25,
    },
    {
      enabled: receiptJournalOpen && Boolean(journalStoreId),
      keepPreviousData: true,
      refetchOnWindowFocus: false,
    },
  );
  const journalSaleDetailQuery = trpc.pos.sales.get.useQuery(
    { saleId: journalSelectedSaleId ?? "" },
    {
      enabled: Boolean(journalSelectedSaleId),
      refetchOnWindowFocus: false,
    },
  );

  const createDraftMutation = trpc.pos.sales.createDraft.useMutation({
    onSuccess: (sale) => {
      setSaleId(sale.id);
      setPayments([createDefaultPosPaymentDraft()]);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const addLineMutation = trpc.pos.sales.addLine.useMutation({
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const updateLineMutation = trpc.pos.sales.updateLine.useMutation({
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const removeLineMutation = trpc.pos.sales.removeLine.useMutation({
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const updateDiscountMutation = trpc.pos.sales.updateDiscount.useMutation({
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const upsertMarkingCodesMutation = trpc.pos.sales.upsertMarkingCodes.useMutation({
    onSuccess: (result) => {
      setMarkingInput((current) => ({
        ...current,
        [result.lineId]: result.codes.join(", "),
      }));
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const cancelDraftMutation = trpc.pos.sales.cancelDraft.useMutation({
    onSuccess: async () => {
      setSaleId(null);
      setLineSearch("");
      setPayments([createDefaultPosPaymentDraft()]);
      setDiscountDraft("");
      setDiscountEditorOpen(false);
      setSellInDebt(false);
      setDebtFullName("");
      setSelectedCustomer(null);
      setCustomerSelectorOpen(false);
      setCustomerSearch("");
      setCustomerCreateOpen(false);
      setNewCustomerEmail("");
      setNewCustomerAddress("");
      setCustomerEditOpen(false);
      setMobileCheckoutOpen(true);
      setOptimisticSaleLines(null);
      setLineInputDrafts({});
      paymentAutoFillRef.current = { saleId: null, totalKgs: null };
      await Promise.all([activeDraftQuery.refetch(), trpcUtils.pos.sales.list.invalidate()]);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const updateCustomerMutation = trpc.pos.sales.updateCustomer.useMutation({
    onSuccess: async (result) => {
      setSelectedCustomer((current) =>
        result.customerName || result.customerEmail || result.customerPhone
          ? {
              id: current?.id ?? "",
              name: result.customerName ?? result.customerEmail ?? result.customerPhone ?? "",
              email: result.customerEmail,
              phone: result.customerPhone,
              address: result.customerAddress,
            }
          : null,
      );
      await Promise.all([
        saleId ? trpcUtils.pos.sales.get.invalidate({ saleId }) : Promise.resolve(),
        activeDraftQuery.refetch(),
      ]);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const createCustomerMutation = trpc.pos.customers.create.useMutation({
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const updateCustomerProfileMutation = trpc.pos.customers.update.useMutation({
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const createReturnMutation = trpc.pos.returns.createDraft.useMutation({
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const addReturnLineMutation = trpc.pos.returns.addLine.useMutation({
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const completeReturnMutation = trpc.pos.returns.complete.useMutation({
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const setOptimisticSaleLines = useCallback(
    (updater: PosCartLine[] | null | ((current: PosCartLine[] | null) => PosCartLine[] | null)) => {
      setOptimisticSaleLinesState((current) => {
        const next = typeof updater === "function" ? updater(current) : updater;
        optimisticSaleLinesRef.current = next;
        return next;
      });
    },
    [],
  );

  const beginCartSync = useCallback(() => {
    pendingCartMutationCountRef.current += 1;
  }, []);

  const endCartSync = useCallback(() => {
    pendingCartMutationCountRef.current = Math.max(0, pendingCartMutationCountRef.current - 1);
  }, []);

  const trackCartSyncPromise = useCallback(<T,>(promise: Promise<T>): Promise<T> => {
    const tracked = promise.then(
      () => undefined,
      () => undefined,
    );
    pendingCartSyncPromisesRef.current.add(tracked);
    void tracked.finally(() => {
      pendingCartSyncPromisesRef.current.delete(tracked);
    });
    return promise;
  }, []);

  const waitForCartSync = useCallback(async () => {
    while (pendingCartSyncPromisesRef.current.size > 0) {
      await Promise.allSettled(Array.from(pendingCartSyncPromisesRef.current));
    }
  }, []);

  const completeMutation = trpc.pos.sales.complete.useMutation({
    onSuccess: async (result) => {
      setLastCompletedSale({
        id: result.id,
        number: result.number,
        kkmStatus: result.kkmStatus,
      });
      setAutoReceiptStatus("idle");
      setSaleId(null);
      setPayments([createDefaultPosPaymentDraft()]);
      setDiscountDraft("");
      setDiscountEditorOpen(false);
      setSellInDebt(false);
      setDebtFullName("");
      setSelectedCustomer(null);
      setCustomerSelectorOpen(false);
      setCustomerSearch("");
      setCustomerCreateOpen(false);
      setNewCustomerEmail("");
      setNewCustomerAddress("");
      setCustomerEditOpen(false);
      setMobileCheckoutOpen(true);
      setOptimisticSaleLines(null);
      setLineInputDrafts({});
      paymentAutoFillRef.current = { saleId: null, totalKgs: null };
      await Promise.all([
        shiftQuery.refetch(),
        activeDraftQuery.refetch(),
        trpcUtils.pos.sales.list.invalidate(),
      ]);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const sale = saleQuery.data;
  const activeDraft = activeDraftQuery.data;
  const currencySource = currencySourceWithFallback(
    sale,
    currencySourceWithFallback(
      shiftQuery.data,
      shiftQuery.data?.store ?? selectedRegister?.store ?? null,
    ),
  );
  const saleLines = optimisticSaleLines ?? sale?.lines ?? [];
  const hasCartLines = saleLines.length > 0;
  const cartSubtotalKgs = calculateCartSubtotalKgs(saleLines);
  const discountDraftActive = discountEditorOpen || discountDraft.trim().length > 0;
  const parsedDiscountDraft = discountDraftActive
    ? discountDraft.trim().length > 0
      ? parseDraftNumber(discountDraft)
      : 0
    : null;
  const draftDiscountKgs =
    parsedDiscountDraft === null
      ? null
      : roundMoney(displayMoneyToKgs(parsedDiscountDraft, currencySource));
  const cartDiscountKgs = Math.min(
    cartSubtotalKgs,
    Math.max(0, draftDiscountKgs ?? sale?.discountKgs ?? 0),
  );
  const cartTotalKgs = roundMoney(Math.max(0, cartSubtotalKgs - cartDiscountKgs));
  const cartDisplayTotal = roundMoney(displayMoneyFromKgs(cartTotalKgs, currencySource));
  const cartDisplayTotalDraft = Number.isFinite(cartDisplayTotal) ? String(cartDisplayTotal) : "";
  const saleIdForPaymentInit = sale?.id ?? (saleId && hasCartLines ? saleId : undefined);
  const saleTotalForPaymentInit = hasCartLines ? cartTotalKgs : sale?.totalKgs;
  const saleCustomerName = sale?.customerName ?? null;
  const saleCustomerEmail = sale?.customerEmail ?? null;
  const saleCustomerPhone = sale?.customerPhone ?? null;
  const saleCustomerAddress = sale?.customerAddress ?? null;
  const saleMarkingEnabled = sale?.store.complianceProfile?.enableMarking ?? false;
  const saleMarkingMode = sale?.store.complianceProfile?.markingMode;

  useSse({
    "shift.opened": () => {
      void Promise.all([
        shiftQuery.refetch(),
        registersQuery.refetch(),
        activeDraftQuery.refetch(),
      ]);
    },
    "shift.closed": () => {
      void Promise.all([
        shiftQuery.refetch(),
        registersQuery.refetch(),
        activeDraftQuery.refetch(),
      ]);
    },
    "sale.completed": () => {
      void Promise.all([activeDraftQuery.refetch(), trpcUtils.pos.sales.list.invalidate()]);
    },
    "debt.settled": () => {
      void Promise.all([shiftQuery.refetch(), trpcUtils.pos.sales.list.invalidate()]);
    },
  });

  useEffect(() => {
    if (!saleIdForPaymentInit || saleTotalForPaymentInit === undefined) {
      return;
    }
    if (sellInDebt) {
      return;
    }
    const previousAutoFill = paymentAutoFillRef.current;
    setPayments((currentPayments) => {
      const next = reconcilePosPaymentDraftsForSaleTotal({
        currentPayments,
        saleId: saleIdForPaymentInit,
        totalKgs: saleTotalForPaymentInit,
        displayTotal: cartDisplayTotal,
        previousAutoFill,
      });
      return next.payments;
    });
    paymentAutoFillRef.current = {
      saleId: saleIdForPaymentInit,
      totalKgs: saleTotalForPaymentInit,
      displayTotal: cartDisplayTotal,
    };
  }, [cartDisplayTotal, saleIdForPaymentInit, saleTotalForPaymentInit, sellInDebt, setPayments]);

  useEffect(() => {
    if (!sale) {
      setDiscountDraft("");
      return;
    }
    if (discountEditorOpen) {
      return;
    }
    setDiscountDraft(String(displayMoneyFromKgs(sale.discountKgs ?? 0, currencySource)));
  }, [currencySource, discountEditorOpen, sale?.discountKgs, sale?.id, sale]);

  useEffect(() => {
    setSaleId(null);
    setLineSearch("");
    setPayments([createDefaultPosPaymentDraft()]);
    setDiscountDraft("");
    setDiscountEditorOpen(false);
    setSellInDebt(false);
    setDebtFullName("");
    setSelectedCustomer(null);
    setCustomerSelectorOpen(false);
    setCustomerSearch("");
    setCustomerCreateOpen(false);
    setNewCustomerEmail("");
    setNewCustomerAddress("");
    setCustomerEditOpen(false);
    setReceiptJournalOpen(false);
    setJournalDetailSaleId(null);
    setJournalReturnSaleId(null);
    setJournalReturnQtyByLine({});
    setJournalReturnNotes("");
    setOptimisticSaleLines(null);
    setLineInputDrafts({});
    paymentAutoFillRef.current = { saleId: null, totalKgs: null };
    setLastCompletedSale(null);
    setAutoReceiptStatus("idle");
    setMobileCheckoutOpen(false);
    autoPrintedSaleIdRef.current = null;
  }, [registerId, setOptimisticSaleLines, setPayments]);

  useEffect(() => {
    if (!saleId) {
      return;
    }
    if (!saleQuery.isFetched || saleQuery.isLoading || saleQuery.isFetching) {
      return;
    }
    if (saleQuery.data !== null) {
      return;
    }
    setSaleId(null);
    setPayments([createDefaultPosPaymentDraft()]);
    paymentAutoFillRef.current = { saleId: null, totalKgs: null };
    setMarkingInput({});
    setSelectedCustomer(null);
    setCustomerCreateOpen(false);
    setCustomerEditOpen(false);
  }, [saleId, saleQuery.data, saleQuery.isFetched, saleQuery.isFetching, saleQuery.isLoading, setPayments]);

  useEffect(() => {
    if (!sale?.id) {
      return;
    }
    if (saleCustomerName || saleCustomerEmail || saleCustomerPhone) {
      setSelectedCustomer((current) => ({
        id: current?.id ?? "",
        name: saleCustomerName ?? saleCustomerEmail ?? saleCustomerPhone ?? "",
        email: saleCustomerEmail,
        phone: saleCustomerPhone,
        address: saleCustomerAddress,
      }));
      return;
    }
    setSelectedCustomer(null);
  }, [sale?.id, saleCustomerAddress, saleCustomerEmail, saleCustomerName, saleCustomerPhone]);

  useEffect(() => {
    if (!sale?.lines?.length) {
      setMarkingInput({});
      return;
    }
    setMarkingInput(
      Object.fromEntries(sale.lines.map((line) => [line.id, (line.markingCodes ?? []).join(", ")])),
    );
  }, [sale?.id, sale?.lines]);

  const hasOpenShift = Boolean(shiftQuery.data?.id);
  const isLineBusy =
    removeLineMutation.isLoading ||
    updateDiscountMutation.isLoading ||
    updateCustomerMutation.isLoading ||
    upsertMarkingCodesMutation.isLoading ||
    cancelDraftMutation.isLoading;
  const totalPayment = roundMoney(
    payments.reduce((sum, payment) => {
      const amount = parseDraftNumber(payment.amount);
      if (amount === null) {
        return sum;
      }
      return sum + amount;
    }, 0),
  );
  const totalPaymentKgs =
    hasCartLines && payments.length === 1
      ? cartTotalKgs
      : roundMoney(displayMoneyToKgs(totalPayment, currencySource));
  const productResults: PosCatalogProduct[] = activeStoreId
    ? (catalogProductsQuery.data?.items ?? [])
    : [];
  const visibleProducts = productResults;
  const productGridLoading = Boolean(
    activeStoreId && catalogProductsQuery.isLoading && !catalogProductsQuery.data,
  );
  const productCategories = productsBootstrapQuery.data?.categories ?? [];

  useEffect(() => {
    visibleProductsRef.current = visibleProducts;
  }, [visibleProducts]);

  const getCurrentCartLines = useCallback(
    () => optimisticSaleLinesRef.current ?? (sale?.lines as PosCartLine[] | undefined) ?? [],
    [sale?.lines],
  );

  const resolveRemoteLineId = useCallback(
    (lineId: string) => {
      const line = getCurrentCartLines().find((item) => item.id === lineId);
      if (line?.serverLineId) {
        return line.serverLineId;
      }
      if (line && !isOptimisticLineId(line.id)) {
        return line.id;
      }
      return isOptimisticLineId(lineId) ? null : lineId;
    },
    [getCurrentCartLines],
  );

  const applyOptimisticAdd = useCallback(
    (product: PosCartProduct) => {
      setOptimisticSaleLines((current) => {
        const baseLines = current ?? getCurrentCartLines();
        const existingLine = findCartLineForProduct(baseLines, product.id);
        const existingIndex = existingLine ? baseLines.indexOf(existingLine) : -1;

        if (existingIndex >= 0) {
          return baseLines.map((line, index) =>
            index === existingIndex ? recalculateCartLine(line, { qty: line.qty + 1 }) : line,
          );
        }

        return [...baseLines, buildOptimisticLine(product)];
      });
    },
    [getCurrentCartLines, setOptimisticSaleLines],
  );

  const patchOptimisticLine = useCallback(
    (lineId: string, patch: PendingLinePatch) => {
      setOptimisticSaleLines((current) => {
        const baseLines = current ?? getCurrentCartLines();
        return baseLines.map((line) =>
          line.id === lineId ? recalculateCartLine(line, patch) : line,
        );
      });
    },
    [getCurrentCartLines, setOptimisticSaleLines],
  );

  const markLineSyncPending = useCallback(
    (lineId: string) => {
      if (lineSyncPendingRef.current.has(lineId)) {
        return;
      }
      lineSyncPendingRef.current.add(lineId);
      beginCartSync();
    },
    [beginCartSync],
  );

  const releaseLineSyncPending = useCallback(
    (lineId: string) => {
      if (!lineSyncPendingRef.current.has(lineId)) {
        return;
      }
      lineSyncPendingRef.current.delete(lineId);
      endCartSync();
    },
    [endCartSync],
  );

  const flushLineSync = useCallback(
    (lineId: string) => {
      if (lineSyncInFlightRef.current.has(lineId)) {
        return;
      }

      const remoteLineId = resolveRemoteLineId(lineId);
      if (!remoteLineId) {
        return;
      }

      const patch = lineSyncDraftsRef.current[lineId];
      if (!patch) {
        releaseLineSyncPending(lineId);
        return;
      }

      delete lineSyncDraftsRef.current[lineId];
      lineSyncInFlightRef.current.add(lineId);

      const syncPromise = (async () => {
        let shouldReleasePending = true;
        try {
          await updateLineMutation.mutateAsync({ lineId: remoteLineId, ...patch });
        } catch {
          lineSyncDraftsRef.current[lineId] = {
            ...patch,
            ...lineSyncDraftsRef.current[lineId],
          };
          shouldReleasePending = false;
        } finally {
          lineSyncInFlightRef.current.delete(lineId);
          if (lineSyncDraftsRef.current[lineId] && shouldReleasePending) {
            lineSyncTimersRef.current[lineId] = window.setTimeout(() => {
              delete lineSyncTimersRef.current[lineId];
              flushLineSync(lineId);
            }, 0);
            return;
          }
          releaseLineSyncPending(lineId);
        }
      })();
      void trackCartSyncPromise(syncPromise);
    },
    [releaseLineSyncPending, resolveRemoteLineId, trackCartSyncPromise, updateLineMutation],
  );

  const scheduleLineSync = useCallback(
    (lineId: string, patch: PendingLinePatch) => {
      lineSyncDraftsRef.current[lineId] = {
        ...lineSyncDraftsRef.current[lineId],
        ...patch,
      };
      markLineSyncPending(lineId);

      const existingTimer = lineSyncTimersRef.current[lineId];
      if (existingTimer !== undefined) {
        window.clearTimeout(existingTimer);
      }
      lineSyncTimersRef.current[lineId] = window.setTimeout(() => {
        delete lineSyncTimersRef.current[lineId];
        flushLineSync(lineId);
      }, 180);
    },
    [flushLineSync, markLineSyncPending],
  );

  const ensureSaleDraftId = useCallback(async () => {
    const existingSaleId = saleId ?? activeDraft?.id ?? null;
    if (existingSaleId) {
      setSaleId(existingSaleId);
      return existingSaleId;
    }

    if (!draftCreationRef.current) {
      draftCreationRef.current = createDraftMutation
        .mutateAsync({
          registerId,
          customerId: selectedCustomer?.id || undefined,
          customerName:
            selectedCustomer && !selectedCustomer.id ? selectedCustomer.name : undefined,
          customerEmail:
            selectedCustomer && !selectedCustomer.id ? selectedCustomer.email : undefined,
          customerPhone:
            selectedCustomer && !selectedCustomer.id ? selectedCustomer.phone : undefined,
          customerAddress:
            selectedCustomer && !selectedCustomer.id ? selectedCustomer.address : undefined,
        })
        .then((draft) => ({ id: draft.id }))
        .finally(() => {
          draftCreationRef.current = null;
        });
    }

    const draft = await draftCreationRef.current;
    setSaleId(draft.id);
    return draft.id;
  }, [activeDraft?.id, createDraftMutation, registerId, saleId, selectedCustomer]);

  const handleAddLine = useCallback(
    async (
      productId: string,
      product?: PosCartProduct,
      options: { refocusSearch?: boolean } = {},
    ): Promise<boolean> => {
      if (!registerId) {
        return false;
      }

      const productForCart =
        product ??
        visibleProductsRef.current.find((visibleProduct) => visibleProduct.id === productId);
      const optimisticLineId = optimisticLineIdForProduct(productId);
      const existingLineBeforeAdd = productForCart
        ? findCartLineForProduct(getCurrentCartLines(), productId)
        : null;
      if (productForCart) {
        applyOptimisticAdd(productForCart);
        setLastCompletedSale(null);
        setAutoReceiptStatus("idle");
        setMobileCheckoutOpen(true);
        if (options.refocusSearch) {
          focusLineSearchInput();
        }
      }

      if (existingLineBeforeAdd || pendingAddProductIdsRef.current.has(productId)) {
        const localLineId = existingLineBeforeAdd?.id ?? optimisticLineId;
        const nextQty = (existingLineBeforeAdd?.qty ?? 0) + 1;
        if (nextQty > 0) {
          scheduleLineSync(localLineId, { qty: nextQty });
        }
        return true;
      }

      beginCartSync();
      pendingAddProductIdsRef.current.add(productId);
      let targetSaleId: string | null = null;
      try {
        targetSaleId = await ensureSaleDraftId();
        setSaleId(targetSaleId);

        const updatedLine = await trackCartSyncPromise(
          addLineMutation.mutateAsync({
            saleId: targetSaleId,
            productId,
            qty: 1,
          }),
        );

        const currentLocalLine = findCartLineForProduct(
          optimisticSaleLinesRef.current ?? [],
          productId,
        );
        const localLineId = currentLocalLine?.id ?? optimisticLineId;
        const lineWasRemoved =
          removedOptimisticLineIdsRef.current.has(localLineId) || !currentLocalLine;

        if (lineWasRemoved) {
          removedOptimisticLineIdsRef.current.delete(localLineId);
          await trackCartSyncPromise(removeLineMutation.mutateAsync({ lineId: updatedLine.id }));
          return true;
        }

        setOptimisticSaleLines((current) =>
          current
            ? current.map((line) => {
                if (line.id !== localLineId && getCartLineProductId(line) !== productId) {
                  return line;
                }
                return {
                  ...line,
                  serverLineId: updatedLine.id,
                  productId: updatedLine.productId,
                  variantId: updatedLine.variantId,
                  variantKey: updatedLine.variantKey,
                };
              })
            : current,
        );

        const localLine = optimisticSaleLinesRef.current?.find((line) => line.id === localLineId);
        const patch: PendingLinePatch = {};
        if (localLine?.qty && localLine.qty !== updatedLine.qty) {
          patch.qty = localLine.qty;
        }
        if (
          localLine &&
          Math.abs(roundMoney(localLine.unitPriceKgs - updatedLine.unitPriceKgs)) > 0.009
        ) {
          patch.unitPriceKgs = localLine.unitPriceKgs;
        }
        if (patch.qty !== undefined || patch.unitPriceKgs !== undefined) {
          scheduleLineSync(localLineId, patch);
        } else {
          flushLineSync(localLineId);
        }

        return true;
      } catch {
        // handled by mutation onError
        return false;
      } finally {
        pendingAddProductIdsRef.current.delete(productId);
        endCartSync();
      }
    },
    [
      addLineMutation,
      applyOptimisticAdd,
      beginCartSync,
      endCartSync,
      ensureSaleDraftId,
      flushLineSync,
      focusLineSearchInput,
      getCurrentCartLines,
      registerId,
      removeLineMutation,
      scheduleLineSync,
      setOptimisticSaleLines,
      trackCartSyncPromise,
    ],
  );

  useEffect(() => {
    if (!hasOpenShift) {
      return;
    }
    focusLineSearchInput();
  }, [focusLineSearchInput, hasOpenShift]);

  const handleScanResolved = useCallback(
    async (result: ScanResolvedResult): Promise<boolean> => {
      if (result.kind === "notFound") {
        toast({ variant: "info", description: t("sell.noSearchResults") });
        return false;
      }
      if (result.kind === "multiple") {
        return true;
      }
      return trackCartSyncPromise(
        handleAddLine(result.item.id, result.item, { refocusSearch: true }),
      );
    },
    [handleAddLine, t, toast, trackCartSyncPromise],
  );

  useEffect(() => {
    return () => {
      if (keyboardScanResetTimerRef.current !== null) {
        window.clearTimeout(keyboardScanResetTimerRef.current);
      }
      Object.values(lineSyncTimersRef.current).forEach((timer) => window.clearTimeout(timer));
      lineSyncTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!hasOpenShift || typeof window === "undefined") {
      return;
    }

    const resetKeyboardScanBuffer = () => {
      keyboardScanBufferRef.current = "";
      if (keyboardScanResetTimerRef.current !== null) {
        window.clearTimeout(keyboardScanResetTimerRef.current);
        keyboardScanResetTimerRef.current = null;
      }
    };

    const scheduleKeyboardScanReset = () => {
      if (keyboardScanResetTimerRef.current !== null) {
        window.clearTimeout(keyboardScanResetTimerRef.current);
      }
      keyboardScanResetTimerRef.current = window.setTimeout(() => {
        keyboardScanBufferRef.current = "";
        keyboardScanResetTimerRef.current = null;
      }, keyboardScanResetMs);
    };

    const handleGlobalScannerInput = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (document.activeElement === lineSearchInputRef.current) {
        return;
      }
      if (isEditableElement(event.target)) {
        return;
      }

      if (event.key.length === 1) {
        keyboardScanBufferRef.current = `${keyboardScanBufferRef.current}${event.key}`.slice(
          -keyboardScanMaxLength,
        );
        scheduleKeyboardScanReset();
        return;
      }

      if (event.key === "Backspace") {
        keyboardScanBufferRef.current = keyboardScanBufferRef.current.slice(0, -1);
        scheduleKeyboardScanReset();
        return;
      }

      const trigger = shouldSubmitFromKey({
        key: event.key,
        supportsTabSubmit: true,
        tabSubmitMinLength: 1,
        normalizedValue: normalizeScanValue(keyboardScanBufferRef.current),
      });

      if (!trigger) {
        if (event.key === "Escape") {
          resetKeyboardScanBuffer();
        }
        return;
      }

      const rawScanValue = keyboardScanBufferRef.current;
      const normalizedScanValue = normalizeScanValue(rawScanValue);
      if (!normalizedScanValue || keyboardScanSubmittingRef.current) {
        resetKeyboardScanBuffer();
        return;
      }

      event.preventDefault();
      keyboardScanSubmittingRef.current = true;
      setLineSearch(rawScanValue);

      void (async () => {
        try {
          const lookup = await trpcUtils.products.lookupScan.fetch({ q: normalizedScanValue });
          const resolved = resolveScanResult({
            context: "pos",
            trigger,
            query: normalizedScanValue,
            lookup,
          });
          await handleScanResolved(resolved);
        } catch {
          toast({ variant: "error", description: tErrors("unexpectedError") });
        } finally {
          keyboardScanSubmittingRef.current = false;
          resetKeyboardScanBuffer();
        }
      })();
    };

    window.addEventListener("keydown", handleGlobalScannerInput);
    return () => {
      window.removeEventListener("keydown", handleGlobalScannerInput);
      resetKeyboardScanBuffer();
    };
  }, [hasOpenShift, handleScanResolved, tErrors, toast, trpcUtils.products.lookupScan]);

  const handleUpdateQty = (lineId: string, raw: string) => {
    setLineInputDrafts((current) => ({
      ...current,
      [lineId]: { ...current[lineId], qty: raw },
    }));

    const qty = Math.trunc(Number(raw));
    if (!Number.isFinite(qty) || qty <= 0) {
      return;
    }

    patchOptimisticLine(lineId, { qty });
    scheduleLineSync(lineId, { qty });
  };

  const handleQtyBlur = (line: PosCartLine) => {
    const raw = lineInputDrafts[line.id]?.qty ?? String(line.qty);
    const qty = Math.trunc(Number(raw));
    if (!Number.isFinite(qty) || qty <= 0) {
      setLineInputDrafts((current) => ({
        ...current,
        [line.id]: { ...current[line.id], qty: String(line.qty) },
      }));
      return;
    }

    setLineInputDrafts((current) => ({
      ...current,
      [line.id]: { ...current[line.id], qty: String(qty) },
    }));
  };

  const formatSaleMoneyDraft = (amountKgs: number) => {
    const amount = displayMoneyFromKgs(amountKgs, currencySource);
    return Number.isFinite(amount) ? Number(amount.toFixed(6)).toString() : "";
  };

  const parseSaleMoneyDraft = (raw: string) => {
    return parseDraftNumber(raw);
  };

  const handleUpdateLinePrice = (lineId: string, raw: string) => {
    setLineInputDrafts((current) => ({
      ...current,
      [lineId]: { ...current[lineId], price: raw },
    }));

    const amount = parseSaleMoneyDraft(raw);
    if (amount === null) {
      return;
    }

    const unitPriceKgs = roundMoney(displayMoneyToKgs(amount, currencySource));
    patchOptimisticLine(lineId, { unitPriceKgs });
    scheduleLineSync(lineId, { unitPriceKgs });
  };

  const handleLinePriceBlur = (line: PosCartLine) => {
    const raw = lineInputDrafts[line.id]?.price ?? formatSaleMoneyDraft(line.unitPriceKgs);
    const amount = parseSaleMoneyDraft(raw);
    if (amount === null) {
      toast({ variant: "error", description: t("sell.invalidAmount") });
      setLineInputDrafts((current) => ({
        ...current,
        [line.id]: { ...current[line.id], price: formatSaleMoneyDraft(line.unitPriceKgs) },
      }));
      return;
    }

    const unitPriceKgs = roundMoney(displayMoneyToKgs(amount, currencySource));
    patchOptimisticLine(line.id, { unitPriceKgs });
    scheduleLineSync(line.id, { unitPriceKgs });
    setLineInputDrafts((current) => ({
      ...current,
      [line.id]: { ...current[line.id], price: formatSaleMoneyDraft(unitPriceKgs) },
    }));
  };

  const handleRemoveLine = async (lineId: string) => {
    const currentLines = getCurrentCartLines();
    const lineToRemove = currentLines.find((line) => line.id === lineId);
    if (!lineToRemove) {
      return;
    }

    setOptimisticSaleLines(currentLines.filter((line) => line.id !== lineId));
    setLineInputDrafts((current) => {
      if (!current[lineId]) {
        return current;
      }
      const next = { ...current };
      delete next[lineId];
      return next;
    });

    const remoteLineId = resolveRemoteLineId(lineId);
    if (!remoteLineId) {
      removedOptimisticLineIdsRef.current.add(lineId);
      return;
    }

    beginCartSync();
    try {
      await trackCartSyncPromise(removeLineMutation.mutateAsync({ lineId: remoteLineId }));
    } catch {
      setOptimisticSaleLines(currentLines);
      // handled by mutation onError
    } finally {
      endCartSync();
    }
  };

  const handleUpdateDiscount = async () => {
    if (!saleId) {
      return;
    }
    const raw = discountDraft.trim();
    const amount = raw.length ? Number(raw.replace(/\s+/g, "").replace(",", ".")) : 0;
    if (!Number.isFinite(amount) || amount < 0) {
      toast({ variant: "error", description: t("sell.discountInvalid") });
      return;
    }
    const discountKgs = roundMoney(displayMoneyToKgs(amount, currencySource));
    if (discountKgs > cartSubtotalKgs) {
      toast({ variant: "error", description: t("sell.discountTooLarge") });
      return;
    }
    if (Math.abs(discountKgs - (sale?.discountKgs ?? 0)) < 0.009) {
      return;
    }
    try {
      await updateDiscountMutation.mutateAsync({ saleId, discountKgs });
      await trpcUtils.pos.sales.get.invalidate({ saleId });
    } catch {
      // handled by mutation onError
    }
  };

  const handleSaveMarkingCodes = async (lineId: string) => {
    if (!saleId) {
      return;
    }
    const value = markingInput[lineId] ?? "";
    const codes = value
      .split(/[\n,;]+/g)
      .map((item) => item.trim())
      .filter(Boolean);
    try {
      await upsertMarkingCodesMutation.mutateAsync({
        saleId,
        lineId,
        codes,
      });
      await trpcUtils.pos.sales.get.invalidate({ saleId });
    } catch {
      // handled by mutation onError
    }
  };

  const handleSelectCustomer = async (customer: PosCustomerSelection) => {
    const previousCustomer = selectedCustomer;
    setSelectedCustomer(customer);
    setCustomerSelectorOpen(false);
    setCustomerSearch("");
    setCustomerCreateOpen(false);

    const targetSaleId = saleId ?? activeDraft?.id ?? null;
    if (!targetSaleId) {
      return;
    }

    try {
      await updateCustomerMutation.mutateAsync({
        saleId: targetSaleId,
        customerId: customer.id,
      });
    } catch {
      setSelectedCustomer(previousCustomer);
    }
  };

  const handleClearCustomer = async () => {
    const previousCustomer = selectedCustomer;
    setSelectedCustomer(null);
    setCustomerSelectorOpen(false);
    setCustomerSearch("");
    setCustomerCreateOpen(false);
    setCustomerEditOpen(false);

    const targetSaleId = saleId ?? activeDraft?.id ?? null;
    if (!targetSaleId) {
      return;
    }

    try {
      await updateCustomerMutation.mutateAsync({
        saleId: targetSaleId,
        customerId: null,
      });
    } catch {
      setSelectedCustomer(previousCustomer);
    }
  };

  const handleCreateCustomer = async () => {
    if (!activeStoreId || createCustomerMutation.isLoading) {
      return;
    }
    const name = newCustomerName.trim().replace(/\s+/g, " ");
    const email = newCustomerEmail.trim().toLowerCase();
    const phone = newCustomerPhone.trim();
    const address = newCustomerAddress.trim();
    const phoneDigits = phone.replace(/\D/g, "");
    if (!name) {
      toast({ variant: "error", description: t("sell.customerNameRequired") });
      return;
    }
    if (!email && !phoneDigits) {
      toast({ variant: "error", description: t("sell.customerContactRequired") });
      return;
    }

    try {
      const result = await createCustomerMutation.mutateAsync({
        storeId: activeStoreId,
        name,
        phone: phone || null,
        email: email || null,
        address: address || null,
      });
      const customer = result.customer;
      setNewCustomerName("");
      setNewCustomerEmail("");
      setNewCustomerPhone("");
      setNewCustomerAddress("");
      setCustomerCreateOpen(false);
      await trpcUtils.pos.customers.search.invalidate();
      await handleSelectCustomer({
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
      });
    } catch {
      // handled by mutation onError
    }
  };

  const openCustomerEdit = () => {
    if (!selectedCustomer?.id) {
      toast({ variant: "error", description: t("sell.customerEditUnavailable") });
      return;
    }
    setCustomerEditName(selectedCustomer.name);
    setCustomerEditEmail(selectedCustomer.email ?? "");
    setCustomerEditPhone(selectedCustomer.phone ?? "");
    setCustomerEditAddress(selectedCustomer.address ?? "");
    setCustomerEditOpen(true);
  };

  const handleUpdateSelectedCustomer = async () => {
    if (!selectedCustomer?.id || updateCustomerProfileMutation.isLoading) {
      return;
    }
    const name = customerEditName.trim().replace(/\s+/g, " ");
    const email = customerEditEmail.trim().toLowerCase();
    const phone = customerEditPhone.trim();
    const address = customerEditAddress.trim();
    const phoneDigits = phone.replace(/\D/g, "");
    if (!name) {
      toast({ variant: "error", description: t("sell.customerNameRequired") });
      return;
    }
    if (!email && !phoneDigits) {
      toast({ variant: "error", description: t("sell.customerContactRequired") });
      return;
    }

    const previousCustomer = selectedCustomer;
    try {
      const customer = await updateCustomerProfileMutation.mutateAsync({
        customerId: selectedCustomer.id,
        name,
        email: email || null,
        phone: phone || null,
        address: address || null,
      });
      const nextCustomer: PosCustomerSelection = {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
      };
      setSelectedCustomer(nextCustomer);

      const targetSaleId = saleId ?? activeDraft?.id ?? null;
      if (targetSaleId) {
        await updateCustomerMutation.mutateAsync({
          saleId: targetSaleId,
          customerId: customer.id,
        });
      }

      setCustomerEditOpen(false);
      await trpcUtils.pos.customers.search.invalidate();
    } catch {
      setSelectedCustomer(previousCustomer);
    }
  };

  const flushPendingLineSyncs = useCallback(async () => {
    const pendingEntries = Object.entries(lineSyncDraftsRef.current);
    if (!pendingEntries.length) {
      return;
    }

    Object.values(lineSyncTimersRef.current).forEach((timer) => window.clearTimeout(timer));
    lineSyncTimersRef.current = {};

    await Promise.all(
      pendingEntries.map(async ([localLineId, patch]) => {
        const remoteLineId = resolveRemoteLineId(localLineId);
        if (!remoteLineId) {
          return;
        }

        delete lineSyncDraftsRef.current[localLineId];
        try {
          await trackCartSyncPromise(
            updateLineMutation.mutateAsync({ lineId: remoteLineId, ...patch }),
          );
        } catch (error) {
          lineSyncDraftsRef.current[localLineId] = {
            ...patch,
            ...lineSyncDraftsRef.current[localLineId],
          };
          throw error;
        } finally {
          releaseLineSyncPending(localLineId);
        }
      }),
    );
  }, [releaseLineSyncPending, resolveRemoteLineId, trackCartSyncPromise, updateLineMutation]);

  const flushAllPendingCartSync = useCallback(async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await flushPendingLineSyncs();
      await waitForCartSync();
      if (!Object.keys(lineSyncDraftsRef.current).length) {
        return;
      }
    }

    await flushPendingLineSyncs();
    await waitForCartSync();
    if (Object.keys(lineSyncDraftsRef.current).length) {
      throw new Error("posCartSyncPending");
    }
  }, [flushPendingLineSyncs, waitForCartSync]);

  const handleComplete = async () => {
    if (!saleId) {
      return;
    }

    if (sellInDebt) {
      const normalizedDebtName = debtFullName.trim().replace(/\s+/g, " ");
      if (normalizedDebtName.length < 2) {
        toast({ variant: "error", description: t("sell.debtNameRequired") });
        return;
      }
      try {
        await flushAllPendingCartSync();
        await completeMutation.mutateAsync({
          saleId,
          idempotencyKey: createIdempotencyKey(),
          debtCustomerName: normalizedDebtName,
          payments: [],
        });
      } catch {
        // handled by mutation onError
      }
      return;
    }

    try {
      await flushAllPendingCartSync();
    } catch {
      return;
    }

    const currentLines = getCurrentCartLines();
    const currentSubtotalKgs = calculateCartSubtotalKgs(currentLines);
    const currentDiscountKgs = Math.min(
      currentSubtotalKgs,
      Math.max(0, draftDiscountKgs ?? sale?.discountKgs ?? 0),
    );
    if (draftDiscountKgs !== null && Math.abs(currentDiscountKgs - (sale?.discountKgs ?? 0)) > 0.009) {
      try {
        await updateDiscountMutation.mutateAsync({ saleId, discountKgs: currentDiscountKgs });
      } catch {
        return;
      }
    }
    const currentCartTotalKgs = roundMoney(Math.max(0, currentSubtotalKgs - currentDiscountKgs));
    const currentDisplayTotal = roundMoney(displayMoneyFromKgs(currentCartTotalKgs, currencySource));
    const currentDisplayTotalDraft = Number.isFinite(currentDisplayTotal)
      ? String(currentDisplayTotal)
      : "";
    const currentPaymentDrafts = paymentsRef.current.length
      ? paymentsRef.current
      : [createDefaultPosPaymentDraft()];
    const reconciledPayments = reconcilePosPaymentDraftsForSaleTotal({
      currentPayments: currentPaymentDrafts,
      saleId,
      totalKgs: currentCartTotalKgs,
      displayTotal: currentDisplayTotal,
      previousAutoFill: paymentAutoFillRef.current,
    });
    const isSinglePaymentSale = reconciledPayments.payments.length === 1;
    const paymentsForSubmit = isSinglePaymentSale
      ? [{ ...reconciledPayments.payments[0], amount: currentDisplayTotalDraft }]
      : reconciledPayments.payments;
    paymentAutoFillRef.current = reconciledPayments.autoFill;
    setPayments(paymentsForSubmit);

    const currentCartTotalMinorUnits = moneyToMinorUnits(currentCartTotalKgs) ?? 0;
    const normalized = isSinglePaymentSale
      ? currentCartTotalMinorUnits > 0
        ? [
            {
              method: paymentsForSubmit[0]?.method ?? PosPaymentMethod.CASH,
              amountKgs: currentCartTotalKgs,
              providerRef: paymentsForSubmit[0]?.providerRef.trim() || null,
            },
          ]
        : []
      : paymentsForSubmit
          .map((payment) => {
            const displayAmount = parseDraftNumber(payment.amount);
            return {
              method: payment.method,
              amountKgs: roundMoney(displayMoneyToKgs(displayAmount ?? Number.NaN, currencySource)),
              providerRef: payment.providerRef.trim() || null,
            };
          })
          .filter((payment) => Number.isFinite(payment.amountKgs) && payment.amountKgs > 0);
    const normalizedPaymentTotalMinorUnits = normalized.reduce(
      (sum, payment) => sum + (moneyToMinorUnits(payment.amountKgs) ?? 0),
      0,
    );

    if (currentCartTotalMinorUnits > 0 && !normalized.length) {
      toast({ variant: "error", description: t("sell.paymentRequired") });
      focusPaymentsInput();
      return;
    }

    if (normalizedPaymentTotalMinorUnits !== currentCartTotalMinorUnits) {
      toast({ variant: "error", description: t("sell.paymentMismatch") });
      focusPaymentsInput();
      return;
    }

    try {
      await completeMutation.mutateAsync({
        saleId,
        idempotencyKey: createIdempotencyKey(),
        debtCustomerName: null,
        payments: normalized,
      });
    } catch {
      // handled by mutation onError
    }
  };

  const formatSaleMoney = useCallback(
    (amountKgs: number) => formatKgsMoney(amountKgs, locale, currencySource),
    [currencySource, locale],
  );

  const addPaymentRow = () => {
    setPayments((current) => {
      const syncedCurrent =
        current.length === 1 ? [{ ...current[0], amount: cartDisplayTotalDraft }] : current;
      return [...syncedCurrent, createDefaultPosPaymentDraft()];
    });
  };

  const removePaymentRow = (index: number) => {
    setPayments((current) =>
      current.length <= 1 ? current : current.filter((_, i) => i !== index),
    );
  };

  const paymentMethodLabel = (method: PosPaymentMethod) => {
    switch (method) {
      case PosPaymentMethod.CARD:
        return t("payments.card");
      case PosPaymentMethod.TRANSFER:
        return t("payments.transfer");
      case PosPaymentMethod.OTHER:
        return t("payments.other");
      default:
        return t("payments.cash");
    }
  };

  const saleStatusLabel = (status: CustomerOrderStatus) => {
    switch (status) {
      case CustomerOrderStatus.COMPLETED:
        return t("history.statusCompleted");
      case CustomerOrderStatus.CANCELED:
        return t("history.statusCanceled");
      default:
        return t("history.statusDraft");
    }
  };

  const saleStatusVariant = (
    status: CustomerOrderStatus,
  ): "default" | "success" | "warning" | "danger" => {
    switch (status) {
      case CustomerOrderStatus.COMPLETED:
        return "success";
      case CustomerOrderStatus.CANCELED:
        return "danger";
      default:
        return "warning";
    }
  };

  const returnStateForSale = (saleItem: { totalKgs: number; returnedTotalKgs?: number | null }) => {
    const returnedTotal = roundMoney(saleItem.returnedTotalKgs ?? 0);
    if (returnedTotal <= 0) {
      return "none" as const;
    }
    if (returnedTotal + 0.009 >= saleItem.totalKgs) {
      return "full" as const;
    }
    return "partial" as const;
  };

  const returnStateLabel = (state: "none" | "partial" | "full") => {
    switch (state) {
      case "full":
        return t("sell.returnStateFull");
      case "partial":
        return t("sell.returnStatePartial");
      default:
        return t("sell.returnStateNone");
    }
  };

  const returnStateVariant = (
    state: "none" | "partial" | "full",
  ): "default" | "success" | "warning" | "danger" | "muted" => {
    if (state === "full") {
      return "danger";
    }
    if (state === "partial") {
      return "warning";
    }
    return "muted";
  };

  const salePaymentSummary = (
    saleItem: { payments?: Array<{ method: PosPaymentMethod; amountKgs: number; isRefund?: boolean }> },
    saleCurrencySource = currencySource,
  ) => {
    const parts = (saleItem.payments ?? [])
      .filter((payment) => !payment.isRefund && payment.amountKgs > 0)
      .map(
        (payment) =>
          `${paymentMethodLabel(payment.method)} ${formatKgsMoney(
            payment.amountKgs,
            locale,
            saleCurrencySource,
          )}`,
      );
    return parts.join(" · ") || tCommon("notAvailable");
  };

  const journalSelectedSale = journalSaleDetailQuery.data;
  const journalSelectedSaleCurrencySource = currencySourceWithFallback(
    journalSelectedSale,
    journalSelectedSale?.store ?? selectedRegister?.store ?? null,
  );
  const journalAlreadyReturnedByLine: Record<string, number> = {};
  for (const saleReturn of journalSelectedSale?.saleReturns ?? []) {
    if (saleReturn.status !== "COMPLETED") {
      continue;
    }
    for (const line of saleReturn.lines) {
      journalAlreadyReturnedByLine[line.customerOrderLineId] =
        (journalAlreadyReturnedByLine[line.customerOrderLineId] ?? 0) + line.qty;
    }
  }
  const journalReturnTotal = journalSelectedSale
    ? roundMoney(
        journalSelectedSale.lines.reduce((total, line) => {
          const availableQty = Math.max(0, line.qty - (journalAlreadyReturnedByLine[line.id] ?? 0));
          const qty = Math.trunc(Number(journalReturnQtyByLine[line.id] ?? 0));
          if (!Number.isFinite(qty) || qty <= 0 || availableQty <= 0) {
            return total;
          }
          return total + line.unitPriceKgs * Math.min(qty, availableQty);
        }, 0),
      )
    : 0;
  const isJournalReturnBusy =
    createReturnMutation.isLoading ||
    addReturnLineMutation.isLoading ||
    completeReturnMutation.isLoading;

  useEffect(() => {
    if (!journalReturnSaleId || !journalSelectedSale?.lines?.length) {
      setJournalReturnQtyByLine({});
      return;
    }
    setJournalReturnQtyByLine(
      Object.fromEntries(journalSelectedSale.lines.map((line) => [line.id, "0"])),
    );
  }, [journalReturnSaleId, journalSelectedSale?.id, journalSelectedSale?.lines]);

  useEffect(() => {
    setJournalPage(1);
  }, [
    debouncedJournalSearch,
    journalCashierId,
    journalDateFrom,
    journalDateTo,
    journalPaymentMethodFilter,
    journalReturnStateFilter,
    journalStatusFilter,
  ]);

  const handleJournalReceiptPdf = async (
    saleIdentifier: { id: string; number: string },
    mode: "download" | "print",
    kind: "precheck" | "fiscal",
  ) => {
    if (journalReceiptAction) {
      return;
    }
    setJournalReceiptAction({ saleId: saleIdentifier.id, mode, kind });
    try {
      const blob = await fetchPdfBlob({
        url: `/api/pos/receipts/${saleIdentifier.id}/pdf?kind=${kind}&action=${
          mode === "print" ? "reprint" : "download"
        }`,
      });
      if (mode === "print") {
        const result = await printPdfBlob(blob);
        if (!result.autoPrintAttempted) {
          toast({ variant: "info", description: t("sell.receiptPrintFallback") });
        }
      } else {
        downloadPdfBlob(blob, `pos-receipt-${saleIdentifier.number}-${kind}.pdf`);
      }
    } catch {
      toast({ variant: "error", description: t("history.receiptPdfFailed") });
    } finally {
      setJournalReceiptAction(null);
    }
  };

  const fillFullJournalReturn = () => {
    if (!journalSelectedSale) {
      return;
    }
    setJournalReturnQtyByLine(
      Object.fromEntries(
        journalSelectedSale.lines.map((line) => [
          line.id,
          String(Math.max(0, line.qty - (journalAlreadyReturnedByLine[line.id] ?? 0))),
        ]),
      ),
    );
  };

  const handleStartJournalReturn = async () => {
    const shift = shiftQuery.data;
    const saleForReturn = journalSelectedSale;
    if (!shift || !saleForReturn) {
      toast({ variant: "error", description: t("history.openShiftRequired") });
      return;
    }

    const selectedLines = saleForReturn.lines
      .map((line) => ({
        lineId: line.id,
        maxQty: Math.max(0, line.qty - (journalAlreadyReturnedByLine[line.id] ?? 0)),
        qty: Math.trunc(Number(journalReturnQtyByLine[line.id] ?? 0)),
      }))
      .filter((line) => Number.isFinite(line.qty) && line.qty > 0 && line.maxQty > 0)
      .map((line) => ({
        lineId: line.lineId,
        qty: Math.min(line.qty, line.maxQty),
      }));

    if (!selectedLines.length || journalReturnTotal <= 0) {
      toast({ variant: "error", description: t("history.returnQtyRequired") });
      return;
    }

    try {
      const draft = await createReturnMutation.mutateAsync({
        shiftId: shift.id,
        originalSaleId: saleForReturn.id,
        notes: journalReturnNotes.trim() || null,
      });

      for (const selected of selectedLines) {
        await addReturnLineMutation.mutateAsync({
          saleReturnId: draft.id,
          customerOrderLineId: selected.lineId,
          qty: selected.qty,
        });
      }

      const completion = await completeReturnMutation.mutateAsync({
        saleReturnId: draft.id,
        idempotencyKey: createIdempotencyKey(),
        payments: [
          {
            method: journalRefundMethod,
            amountKgs: roundMoney(journalReturnTotal),
          },
        ],
      });

      if (completion.manualRequired) {
        toast({
          variant: "info",
          description: t("history.manualRefundRequired", {
            requestId: completion.refundRequestId ?? "-",
          }),
        });
      } else {
        toast({ variant: "success", description: t("history.returnSuccess") });
      }
      setJournalReturnSaleId(null);
      setJournalReturnNotes("");
      await Promise.all([
        journalSalesQuery.refetch(),
        journalSaleDetailQuery.refetch(),
        trpcUtils.pos.sales.list.invalidate(),
        trpcUtils.products.list.invalidate(),
      ]);
    } catch {
      // handled by mutation onError
    }
  };

  const handleSellInDebtChange = (checked: boolean) => {
    setSellInDebt(checked);
    if (checked) {
      setPayments([createDefaultPosPaymentDraft()]);
      paymentAutoFillRef.current = { saleId: saleIdForPaymentInit ?? null, totalKgs: null };
    }
  };

  const handleDiscardSale = async () => {
    if (!saleId) {
      return;
    }
    try {
      await cancelDraftMutation.mutateAsync({ saleId });
    } catch {
      // handled by mutation onError
    }
  };

  const handleResumeActiveDraft = () => {
    if (!activeDraft?.id) {
      return;
    }
    setLastCompletedSale(null);
    setAutoReceiptStatus("idle");
    setMobileCheckoutOpen(true);
    setDiscountEditorOpen(false);
    setCustomerSelectorOpen(false);
    setCustomerSearch("");
    setCustomerCreateOpen(false);
    setSelectedCustomer(
      activeDraft.customerName || activeDraft.customerEmail || activeDraft.customerPhone
        ? {
            id: "",
            name:
              activeDraft.customerName ??
              activeDraft.customerEmail ??
              activeDraft.customerPhone ??
              "",
            email: activeDraft.customerEmail,
            phone: activeDraft.customerPhone,
            address: activeDraft.customerAddress,
          }
        : null,
    );
    setSaleId(activeDraft.id);
  };

  const handleStartNewSale = () => {
    setLastCompletedSale(null);
    setAutoReceiptStatus("idle");
    setSelectedCustomer(null);
    setDiscountEditorOpen(false);
    setCustomerSelectorOpen(false);
    setCustomerSearch("");
    setCustomerCreateOpen(false);
    autoPrintedSaleIdRef.current = null;
    setMobileCheckoutOpen(false);
    focusLineSearchInput();
  };

  const handleDiscardActiveDraft = async () => {
    if (!activeDraft?.id) {
      return;
    }
    try {
      await cancelDraftMutation.mutateAsync({ saleId: activeDraft.id });
    } catch {
      // handled by mutation onError
    }
  };

  const printReceiptWithConfiguredProvider = useCallback(
    async (
      kind: "precheck" | "fiscal",
      action: "auto_print" | "reprint",
      options: { allowManualFallback: boolean },
    ) => {
      if (!lastCompletedSale || !activeStoreId) {
        throw new Error("receiptPrintNotReady");
      }
      const provider = receiptPrintSettings?.receiptPrintProvider ?? "DISABLED";
      if (
        provider !== "QZ_TRAY" &&
        provider !== "KIOSK_SILENT_PRINT" &&
        !(
          options.allowManualFallback &&
          receiptPrintSettings?.receiptFallbackMode === "MANUAL_BROWSER_PRINT"
        )
      ) {
        throw new Error("receiptAutoPrintSetupRequired");
      }
      const blob = await fetchPdfBlob({
        url: `/api/pos/receipts/${lastCompletedSale.id}/pdf?kind=${kind}&action=${action}`,
      });

      if (provider === "QZ_TRAY") {
        const binding = getQzTrayBinding(activeStoreId);
        const result = await printPdfBlobViaQzTray({
          blob,
          printerName: binding.receiptPrinterName,
        });
        return result.trustStatus === "trusted" ? ("qz" as const) : ("qz_untrusted" as const);
      }

      if (provider === "KIOSK_SILENT_PRINT") {
        const result = await printPdfBlob(blob);
        return result.autoPrintAttempted ? ("kiosk" as const) : ("blocked" as const);
      }

      if (
        options.allowManualFallback &&
        receiptPrintSettings?.receiptFallbackMode === "MANUAL_BROWSER_PRINT"
      ) {
        const result = await printPdfBlob(blob);
        return result.autoPrintAttempted ? ("manual" as const) : ("blocked" as const);
      }

      throw new Error("receiptAutoPrintSetupRequired");
    },
    [activeStoreId, lastCompletedSale, receiptPrintSettings],
  );

  const handleReceiptPdf = async (mode: "download" | "print", kind: "precheck" | "fiscal") => {
    if (!lastCompletedSale || receiptAction) {
      return;
    }
    setReceiptAction({ mode, kind });
    try {
      if (mode === "print") {
        const result = await printReceiptWithConfiguredProvider(kind, "reprint", {
          allowManualFallback: true,
        });
        if (result === "blocked" || result === "manual") {
          toast({ variant: "info", description: t("sell.receiptPrintFallback") });
        } else if (result === "qz_untrusted") {
          toast({ variant: "info", description: t("sell.qzTrustMissing") });
        }
      } else {
        const blob = await fetchPdfBlob({
          url: `/api/pos/receipts/${lastCompletedSale.id}/pdf?kind=${kind}&action=download`,
        });
        downloadPdfBlob(blob, `pos-receipt-${lastCompletedSale.number}-${kind}.pdf`);
      }
    } catch (error) {
      const key = qzTrayErrorMessageKey(error);
      toast({
        variant: "error",
        description: key === "qzPrintFailed" ? t("sell.receiptPdfFailed") : t(`sell.${key}`),
      });
    } finally {
      setReceiptAction(null);
    }
  };

  useEffect(() => {
    if (!lastCompletedSale || autoPrintedSaleIdRef.current === lastCompletedSale.id) {
      return;
    }
    if (receiptPrintSettingsQuery.isLoading) {
      return;
    }

    let active = true;
    autoPrintedSaleIdRef.current = lastCompletedSale.id;

    if (!receiptPrintSettings?.receiptAutoPrintEnabled) {
      setAutoReceiptStatus("idle");
      return;
    }

    void (async () => {
      setAutoReceiptStatus("printing");
      try {
        const result = await printReceiptWithConfiguredProvider("precheck", "auto_print", {
          allowManualFallback: false,
        });
        if (!active) {
          return;
        }
        setAutoReceiptStatus(result === "blocked" ? "blocked" : "ready");
        if (result === "qz_untrusted") {
          toast({ variant: "info", description: t("sell.qzTrustMissing") });
        }
      } catch (error) {
        if (active) {
          const message = error instanceof Error ? error.message : "";
          if (message === "receiptAutoPrintSetupRequired") {
            setAutoReceiptStatus("blocked");
            toast({ variant: "info", description: t("sell.receiptAutoSetupRequired") });
            return;
          }
          setAutoReceiptStatus("failed");
          const key = qzTrayErrorMessageKey(error);
          toast({
            variant: "error",
            description: key === "qzPrintFailed" ? t("sell.receiptAutoFailed") : t(`sell.${key}`),
          });
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [
    lastCompletedSale,
    printReceiptWithConfiguredProvider,
    receiptPrintSettings?.receiptAutoPrintEnabled,
    receiptPrintSettingsQuery.isLoading,
    t,
    toast,
  ]);

  const lineDiscountById = new Map<string, number>();
  if (saleLines.length && cartDiscountKgs > 0 && cartSubtotalKgs > 0) {
    let remainingDiscount = roundMoney(cartDiscountKgs);
    saleLines.forEach((line, index) => {
      const isLastLine = index === saleLines.length - 1;
      const lineDiscount = isLastLine
        ? remainingDiscount
        : Math.min(
            line.lineTotalKgs,
            roundMoney((cartDiscountKgs * line.lineTotalKgs) / cartSubtotalKgs),
          );
      lineDiscountById.set(line.id, lineDiscount);
      remainingDiscount = roundMoney(remainingDiscount - lineDiscount);
    });
  }
  const selectedRegisterLabel = selectedRegister
    ? `${selectedRegister.store.name} / ${selectedRegister.name}`
    : t("entry.selectRegister");
  const shiftOpenedLabel = shiftQuery.data?.openedAt
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(shiftQuery.data.openedAt))
    : null;
  const paymentTotalLabel = formatKgsMoney(totalPaymentKgs, locale, currencySource);
  const paymentDeltaKgs = hasCartLines ? roundMoney(totalPaymentKgs - cartTotalKgs) : 0;
  const showPaymentTotalSummary = Boolean(
    hasCartLines && !sellInDebt && (payments.length > 1 || Math.abs(paymentDeltaKgs) > 0.004),
  );
  const discountCurrencyCode = resolveCurrency(currencySource).currencyCode;
  const showDiscountEditor = discountEditorOpen || cartDiscountKgs > 0;
  const currentCustomer = selectedCustomer;
  const currentCustomerDetails = currentCustomer
    ? [currentCustomer.phone, currentCustomer.email].filter(Boolean).join(" · ")
    : "";
  const currentCustomerLabel = currentCustomer?.name || t("sell.retailCustomer");
  const cartItemCount = saleLines.reduce((sum, line) => sum + line.qty, 0);
  const cartQtyByProductId = new Map<string, number>();
  saleLines.forEach((line) => {
    const productId = getCartLineProductId(line);
    cartQtyByProductId.set(productId, (cartQtyByProductId.get(productId) ?? 0) + line.qty);
  });
  const showCompletedSale = Boolean(lastCompletedSale && !saleId);
  const checkoutPanelTitle = showCompletedSale
    ? t("sell.saleCompletedTitle")
    : sale?.number
      ? `${t("sell.saleTitle")} · ${sale.number}`
      : t("sell.saleTitle");
  const receiptStatusLabel =
    autoReceiptStatus === "printing"
      ? t("sell.receiptAutoPrinting")
      : autoReceiptStatus === "ready"
        ? t("sell.receiptAutoReady")
        : autoReceiptStatus === "blocked"
          ? t("sell.receiptAutoBlocked")
          : autoReceiptStatus === "failed"
            ? t("sell.receiptAutoFailed")
            : t("sell.receiptManualFallback");
  const checkoutSheetSummary = showCompletedSale
    ? t("sell.saleCompletedTitle")
    : hasCartLines
      ? t("sell.cartSummary", {
          count: cartItemCount,
          total: formatSaleMoney(cartTotalKgs),
        })
      : t("sell.emptyCartTitle");
  const completeDisabled = !saleId || completeMutation.isLoading || isLineBusy || !hasCartLines;
  const isDemoCategory = (category: string) =>
    ["test", "tests", "demo", "sample", "samples"].includes(category.trim().toLowerCase());
  const categoryLabel = (category: string) => {
    const normalized = category.trim().toLowerCase();
    if (["beverages", "drinks"].includes(normalized)) return t("sell.categoryBeverages");
    if (normalized === "household") return t("sell.categoryHousehold");
    if (normalized === "snacks") return t("sell.categorySnacks");
    if (normalized === "test") return t("sell.categoryTest");
    return category;
  };
  const visibleProductCategories = productCategories.filter(
    (category) => !isDemoCategory(category),
  );
  const stockMeta = useCallback(
    (stockQty: number | null): ProductStockMeta => {
      if (stockQty === null) {
        return {
          label: tCommon("notAvailable"),
          className: "border-foreground bg-foreground text-background",
          showWarningIcon: false,
        };
      }
      if (stockQty < 0) {
        const absoluteQty = formatNumber(Math.abs(stockQty), locale);
        return {
          label: `−${absoluteQty} ${t("sell.stockUnitShort")}`,
          className: "border-danger bg-danger text-danger-foreground",
          showWarningIcon: true,
        };
      }
      if (stockQty === 0) {
        return {
          label: t("sell.outOfStock"),
          className: "border-danger bg-danger text-danger-foreground",
          showWarningIcon: false,
        };
      }
      if (stockQty <= 5) {
        return {
          label: `${formatNumber(stockQty, locale)} ${t("sell.stockUnitShort")}`,
          className: "border-warning bg-warning text-warning-foreground",
          showWarningIcon: false,
        };
      }
      return {
        label: `${formatNumber(stockQty, locale)} ${t("sell.stockUnitShort")}`,
        className: "border-success bg-success text-success-foreground",
        showWarningIcon: false,
      };
    },
    [locale, t, tCommon],
  );
  const handleProductClick = useCallback(
    (product: PosCatalogProduct) => {
      void trackCartSyncPromise(handleAddLine(product.id, product, { refocusSearch: true }));
    },
    [handleAddLine, trackCartSyncPromise],
  );
  const handleProductDecrement = (product: PosCatalogProduct) => {
    const line = findCartLineForProduct(getCurrentCartLines(), product.id);
    if (!line) {
      return;
    }
    if (line.qty <= 1) {
      void trackCartSyncPromise(handleRemoveLine(line.id));
      focusLineSearchInput();
      return;
    }
    handleUpdateQty(line.id, String(line.qty - 1));
    focusLineSearchInput();
  };

  const CustomerEditModal = () => (
    <Modal
      open={customerEditOpen}
      onOpenChange={setCustomerEditOpen}
      title={t("sell.editCustomer")}
      subtitle={selectedCustomer?.name ?? t("sell.customer")}
      mobileSheet
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm font-medium text-foreground">
            <span>{t("sell.customerNamePlaceholder")}</span>
            <Input
              value={customerEditName}
              onChange={(event) => setCustomerEditName(event.target.value)}
              autoComplete="name"
            />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-foreground">
            <span>{t("sell.customerEmailPlaceholder")}</span>
            <Input
              value={customerEditEmail}
              onChange={(event) => setCustomerEditEmail(event.target.value)}
              autoComplete="email"
              inputMode="email"
            />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-foreground">
            <span>{t("sell.customerPhonePlaceholder")}</span>
            <Input
              value={customerEditPhone}
              onChange={(event) => setCustomerEditPhone(event.target.value)}
              autoComplete="tel"
            />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-foreground sm:col-span-2">
            <span>{t("sell.customerAddressPlaceholder")}</span>
            <Textarea
              value={customerEditAddress}
              onChange={(event) => setCustomerEditAddress(event.target.value)}
              autoComplete="street-address"
            />
          </label>
        </div>
        <ModalFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setCustomerEditOpen(false)}
            disabled={updateCustomerProfileMutation.isLoading || updateCustomerMutation.isLoading}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void handleUpdateSelectedCustomer()}
            disabled={updateCustomerProfileMutation.isLoading || updateCustomerMutation.isLoading}
          >
            {updateCustomerProfileMutation.isLoading || updateCustomerMutation.isLoading ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <EditIcon className="h-4 w-4" aria-hidden />
            )}
            {tCommon("save")}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );

  const ReceiptJournalModal = () => {
    const journalItems = journalSalesQuery.data?.items ?? [];
    const journalTotal = journalSalesQuery.data?.total ?? 0;
    const pageSize = journalSalesQuery.data?.pageSize ?? 25;
    const hasNextPage = journalPage * pageSize < journalTotal;

    const renderJournalActions = (saleItem: (typeof journalItems)[number]) => {
      const returnState = returnStateForSale(saleItem);
      const actionBusy = journalReceiptAction?.saleId === saleItem.id;
      return (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 px-2"
            onClick={() => {
              setJournalReturnSaleId(null);
              setJournalDetailSaleId(saleItem.id);
            }}
          >
            <ViewIcon className="h-3.5 w-3.5" aria-hidden />
            {t("history.openDetails")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 px-2"
            onClick={() =>
              void handleJournalReceiptPdf(
                { id: saleItem.id, number: saleItem.number },
                "print",
                "precheck",
              )
            }
            disabled={Boolean(journalReceiptAction)}
          >
            {actionBusy && journalReceiptAction?.mode === "print" ? (
              <Spinner className="h-3.5 w-3.5" />
            ) : (
              <PrintIcon className="h-3.5 w-3.5" aria-hidden />
            )}
            {t("history.printReceipt")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 px-2"
            onClick={() => {
              setJournalDetailSaleId(null);
              setJournalReturnSaleId(saleItem.id);
              setJournalReturnNotes("");
            }}
            disabled={saleItem.status !== CustomerOrderStatus.COMPLETED || returnState === "full"}
          >
            {t("history.return")}
          </Button>
        </div>
      );
    };

    return (
      <Modal
        open={receiptJournalOpen}
        onOpenChange={(open) => {
          setReceiptJournalOpen(open);
          if (!open) {
            setJournalDetailSaleId(null);
            setJournalReturnSaleId(null);
          }
        }}
        title={t("sell.receiptJournal")}
        subtitle={selectedRegisterLabel}
        className="max-w-[1200px]"
        bodyClassName="p-4 sm:p-6"
        mobileSheet
      >
        <div className="space-y-4">
          <div className="grid gap-2 md:grid-cols-4">
            <Input
              value={journalSearch}
              onChange={(event) => setJournalSearch(event.target.value)}
              placeholder={t("sell.receiptSearchPlaceholder")}
            />
            <Select
              value={journalStatusFilter}
              onValueChange={(value) =>
                setJournalStatusFilter(value as CustomerOrderStatus | "ALL")
              }
            >
              <SelectTrigger aria-label={t("history.saleStatus")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("history.statusAll")}</SelectItem>
                <SelectItem value={CustomerOrderStatus.COMPLETED}>
                  {t("history.statusCompleted")}
                </SelectItem>
                <SelectItem value={CustomerOrderStatus.DRAFT}>
                  {t("history.statusDraft")}
                </SelectItem>
                <SelectItem value={CustomerOrderStatus.CANCELED}>
                  {t("history.statusCanceled")}
                </SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={journalPaymentMethodFilter}
              onValueChange={(value) =>
                setJournalPaymentMethodFilter(value as PosPaymentMethod | "ALL")
              }
            >
              <SelectTrigger aria-label={t("history.paymentMethod")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("history.paymentMethodAll")}</SelectItem>
                <SelectItem value={PosPaymentMethod.CASH}>{t("payments.cash")}</SelectItem>
                <SelectItem value={PosPaymentMethod.CARD}>{t("payments.card")}</SelectItem>
                <SelectItem value={PosPaymentMethod.TRANSFER}>{t("payments.transfer")}</SelectItem>
                <SelectItem value={PosPaymentMethod.OTHER}>{t("payments.other")}</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={journalReturnStateFilter}
              onValueChange={(value) =>
                setJournalReturnStateFilter(value as "ALL" | "NONE" | "RETURNED")
              }
            >
              <SelectTrigger aria-label={t("sell.returnStatus")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("sell.returnStatusAll")}</SelectItem>
                <SelectItem value="NONE">{t("sell.returnStateNone")}</SelectItem>
                <SelectItem value="RETURNED">{t("sell.returnStatusReturned")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={journalCashierId || "ALL"} onValueChange={(value) => setJournalCashierId(value === "ALL" ? "" : value)}>
              <SelectTrigger aria-label={t("sell.cashier")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("sell.cashierAll")}</SelectItem>
                {(journalCashiersQuery.data ?? []).map((cashier) => (
                  <SelectItem key={cashier.id} value={cashier.id}>
                    {cashier.name || cashier.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={journalDateFrom}
              onChange={(event) => setJournalDateFrom(event.target.value)}
              aria-label={t("history.dateFrom")}
            />
            <Input
              type="date"
              value={journalDateTo}
              onChange={(event) => setJournalDateTo(event.target.value)}
              aria-label={t("history.dateTo")}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                className="h-10 flex-1"
                onClick={() => {
                  const today = formatDateInput(new Date());
                  setJournalDateFrom(today);
                  setJournalDateTo(today);
                }}
              >
                {t("history.today")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-10 flex-1"
                onClick={() => {
                  setJournalSearch("");
                  setJournalDateFrom("");
                  setJournalDateTo("");
                  setJournalStatusFilter(CustomerOrderStatus.COMPLETED);
                  setJournalPaymentMethodFilter("ALL");
                  setJournalReturnStateFilter("ALL");
                  setJournalCashierId("");
                }}
              >
                {t("history.clearFilters")}
              </Button>
            </div>
          </div>

          {journalSalesQuery.isLoading ? (
            <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : journalSalesQuery.error ? (
            <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
              {translateError(tErrors, journalSalesQuery.error)}
            </div>
          ) : journalItems.length ? (
            <>
              <TableContainer className="hidden md:block">
                <Table className="min-w-[1040px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("sell.receiptNumber")}</TableHead>
                      <TableHead>{t("history.dateTime")}</TableHead>
                      <TableHead>{t("history.customer")}</TableHead>
                      <TableHead>{t("history.store")}</TableHead>
                      <TableHead>{t("sell.cashier")}</TableHead>
                      <TableHead>{t("history.paymentMethod")}</TableHead>
                      <TableHead>{t("sell.cartTotal")}</TableHead>
                      <TableHead>{t("history.saleStatus")}</TableHead>
                      <TableHead>{t("sell.returnStatus")}</TableHead>
                      <TableHead sortable={false} className="text-right">
                        {tCommon("actions")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {journalItems.map((saleItem) => {
                      const saleCurrencySource = currencySourceWithFallback(
                        saleItem,
                        saleItem.store,
                      );
                      const returnState = returnStateForSale(saleItem);
                      return (
                        <TableRow key={saleItem.id}>
                          <TableCell className="font-medium">{saleItem.number}</TableCell>
                          <TableCell>{formatDateTime(saleItem.createdAt, locale)}</TableCell>
                          <TableCell>
                            {saleItem.customerName ||
                              saleItem.customerPhone ||
                              t("history.walkInCustomer")}
                          </TableCell>
                          <TableCell>{saleItem.store.name}</TableCell>
                          <TableCell>
                            {saleItem.cashier?.name ||
                              saleItem.cashier?.email ||
                              tCommon("notAvailable")}
                          </TableCell>
                          <TableCell>{salePaymentSummary(saleItem, saleCurrencySource)}</TableCell>
                          <TableCell className="font-semibold">
                            {formatKgsMoney(saleItem.totalKgs, locale, saleCurrencySource)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={saleStatusVariant(saleItem.status)}>
                              {saleStatusLabel(saleItem.status)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={returnStateVariant(returnState)}>
                              {returnStateLabel(returnState)}
                            </Badge>
                          </TableCell>
                          <TableCell>{renderJournalActions(saleItem)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>

              <div className="grid gap-3 md:hidden">
                {journalItems.map((saleItem) => {
                  const saleCurrencySource = currencySourceWithFallback(saleItem, saleItem.store);
                  const returnState = returnStateForSale(saleItem);
                  return (
                    <article key={saleItem.id} className="rounded-md border border-border bg-card p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground">{saleItem.number}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDateTime(saleItem.createdAt, locale)}
                          </p>
                        </div>
                        <p className="shrink-0 text-sm font-semibold">
                          {formatKgsMoney(saleItem.totalKgs, locale, saleCurrencySource)}
                        </p>
                      </div>
                      <dl className="mt-3 grid gap-2 text-sm">
                        <div className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">{t("history.customer")}</dt>
                          <dd className="text-right">
                            {saleItem.customerName ||
                              saleItem.customerPhone ||
                              t("history.walkInCustomer")}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">{t("sell.cashier")}</dt>
                          <dd className="text-right">
                            {saleItem.cashier?.name ||
                              saleItem.cashier?.email ||
                              tCommon("notAvailable")}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">{t("history.paymentMethod")}</dt>
                          <dd className="text-right">
                            {salePaymentSummary(saleItem, saleCurrencySource)}
                          </dd>
                        </div>
                      </dl>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Badge variant={saleStatusVariant(saleItem.status)}>
                          {saleStatusLabel(saleItem.status)}
                        </Badge>
                        <Badge variant={returnStateVariant(returnState)}>
                          {returnStateLabel(returnState)}
                        </Badge>
                      </div>
                      <div className="mt-3">{renderJournalActions(saleItem)}</div>
                    </article>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="grid min-h-40 place-items-center rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {t("history.empty")}
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-border pt-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>{t("sell.receiptJournalCount", { count: journalTotal })}</span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                className="h-9"
                onClick={() => setJournalPage((current) => Math.max(1, current - 1))}
                disabled={journalPage <= 1 || journalSalesQuery.isFetching}
              >
                {tCommon("back")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-9"
                onClick={() => setJournalPage((current) => current + 1)}
                disabled={!hasNextPage || journalSalesQuery.isFetching}
              >
                {t("sell.nextPage")}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    );
  };

  const JournalSaleDetailModal = () => (
    <Modal
      open={Boolean(journalDetailSaleId && !journalReturnSaleId)}
      onOpenChange={(open) => {
        if (!open) {
          setJournalDetailSaleId(null);
        }
      }}
      title={t("history.detailsTitle")}
      subtitle={journalSelectedSale?.number ?? ""}
      className="max-w-3xl"
      mobileSheet
    >
      {journalSaleDetailQuery.isLoading ? (
        <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {tCommon("loading")}
        </div>
      ) : journalSaleDetailQuery.error ? (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {translateError(tErrors, journalSaleDetailQuery.error)}
        </div>
      ) : journalSelectedSale ? (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-border p-3">
              <p className="text-xs uppercase text-muted-foreground">{t("history.customer")}</p>
              <p className="mt-1 font-medium">
                {journalSelectedSale.customerName ||
                  journalSelectedSale.customerPhone ||
                  t("history.walkInCustomer")}
              </p>
              <p className="text-sm text-muted-foreground">
                {[journalSelectedSale.customerPhone, journalSelectedSale.customerEmail]
                  .filter(Boolean)
                  .join(" · ") || tCommon("notAvailable")}
              </p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs uppercase text-muted-foreground">{t("history.store")}</p>
              <p className="mt-1 font-medium">{journalSelectedSale.store.name}</p>
              <p className="text-sm text-muted-foreground">
                {formatDateTime(journalSelectedSale.createdAt, locale)}
              </p>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-foreground">{t("history.itemsTitle")}</h3>
            <div className="mt-2 divide-y divide-border rounded-md border border-border">
              {journalSelectedSale.lines.map((line) => (
                <div key={line.id} className="grid gap-2 p-3 sm:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{line.product.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {line.qty} x{" "}
                      {formatKgsMoney(
                        line.unitPriceKgs,
                        locale,
                        journalSelectedSaleCurrencySource,
                      )}
                    </p>
                  </div>
                  <p className="font-semibold">
                    {formatKgsMoney(line.lineTotalKgs, locale, journalSelectedSaleCurrencySource)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-border p-3">
              <p className="text-sm font-semibold text-foreground">{t("history.paymentsTitle")}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {salePaymentSummary(journalSelectedSale, journalSelectedSaleCurrencySource)}
              </p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-sm font-semibold text-foreground">{t("history.totalsTitle")}</p>
              <div className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{t("sell.subtotal")}</span>
                  <span>
                    {formatKgsMoney(
                      journalSelectedSale.subtotalKgs,
                      locale,
                      journalSelectedSaleCurrencySource,
                    )}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{t("sell.discount")}</span>
                  <span>
                    {formatKgsMoney(
                      journalSelectedSale.discountKgs,
                      locale,
                      journalSelectedSaleCurrencySource,
                    )}
                  </span>
                </div>
                <div className="flex justify-between gap-3 font-semibold">
                  <span>{t("sell.cartTotal")}</span>
                  <span>
                    {formatKgsMoney(
                      journalSelectedSale.totalKgs,
                      locale,
                      journalSelectedSaleCurrencySource,
                    )}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                void handleJournalReceiptPdf(
                  { id: journalSelectedSale.id, number: journalSelectedSale.number },
                  "download",
                  "precheck",
                )
              }
              disabled={Boolean(journalReceiptAction)}
            >
              <DownloadIcon className="h-4 w-4" aria-hidden />
              {t("history.downloadReceipt")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                void handleJournalReceiptPdf(
                  { id: journalSelectedSale.id, number: journalSelectedSale.number },
                  "print",
                  "precheck",
                )
              }
              disabled={Boolean(journalReceiptAction)}
            >
              <PrintIcon className="h-4 w-4" aria-hidden />
              {t("history.printReceipt")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setJournalDetailSaleId(null);
                setJournalReturnSaleId(journalSelectedSale.id);
                setJournalReturnNotes("");
              }}
              disabled={
                journalSelectedSale.status !== CustomerOrderStatus.COMPLETED ||
                returnStateForSale({
                  totalKgs: journalSelectedSale.totalKgs,
                  returnedTotalKgs: journalSelectedSale.saleReturns.reduce(
                    (sum, saleReturn) => sum + saleReturn.totalKgs,
                    0,
                  ),
                }) === "full"
              }
            >
              {t("history.return")}
            </Button>
          </ModalFooter>
        </div>
      ) : null}
    </Modal>
  );

  const JournalReturnModal = () => (
    <Modal
      open={Boolean(journalReturnSaleId)}
      onOpenChange={(open) => {
        if (!open) {
          setJournalReturnSaleId(null);
          setJournalReturnNotes("");
        }
      }}
      title={t("history.returnDialogTitle")}
      subtitle={
        journalSelectedSale
          ? t("history.returnDialogDescription", { number: journalSelectedSale.number })
          : ""
      }
      className="max-w-2xl"
      mobileSheet
    >
      {journalSaleDetailQuery.isLoading || journalSelectedSale?.id !== journalReturnSaleId ? (
        <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {tCommon("loading")}
        </div>
      ) : journalSaleDetailQuery.error ? (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {translateError(tErrors, journalSaleDetailQuery.error)}
        </div>
      ) : journalSelectedSale ? (
        <div className="space-y-4">
          <Button
            type="button"
            variant="secondary"
            className="h-10"
            onClick={fillFullJournalReturn}
            disabled={isJournalReturnBusy}
          >
            {t("sell.fullReturn")}
          </Button>

          <div className="space-y-3">
            {journalSelectedSale.lines.map((line) => {
              const availableQty = Math.max(
                0,
                line.qty - (journalAlreadyReturnedByLine[line.id] ?? 0),
              );
              return (
                <div key={line.id} className="rounded-md border border-border bg-card p-3">
                  <p className="text-sm font-medium text-foreground">{line.product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {line.qty} x{" "}
                    {formatKgsMoney(
                      line.unitPriceKgs,
                      locale,
                      journalSelectedSaleCurrencySource,
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("history.availableQty")}: {availableQty}
                  </p>
                  <Input
                    value={journalReturnQtyByLine[line.id] ?? "0"}
                    onChange={(event) => {
                      const raw = event.target.value.replace(/[^\d]/g, "");
                      const parsed = raw ? Math.trunc(Number(raw)) : 0;
                      setJournalReturnQtyByLine((current) => ({
                        ...current,
                        [line.id]: String(Math.min(parsed, availableQty)),
                      }));
                    }}
                    inputMode="numeric"
                    className="mt-2"
                    disabled={availableQty <= 0 || isJournalReturnBusy}
                  />
                </div>
              );
            })}
          </div>

          <label className="space-y-1.5 text-sm font-medium text-foreground">
            <span>{t("sell.returnReason")}</span>
            <Textarea
              value={journalReturnNotes}
              onChange={(event) => setJournalReturnNotes(event.target.value)}
              placeholder={t("sell.returnReasonPlaceholder")}
              disabled={isJournalReturnBusy}
            />
          </label>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">{t("history.refundMethod")}</p>
            <Select
              value={journalRefundMethod}
              onValueChange={(value) => setJournalRefundMethod(value as PosPaymentMethod)}
              disabled={isJournalReturnBusy}
            >
              <SelectTrigger aria-label={t("history.refundMethod")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PosPaymentMethod.CASH}>{t("payments.cash")}</SelectItem>
                <SelectItem value={PosPaymentMethod.CARD}>{t("payments.card")}</SelectItem>
                <SelectItem value={PosPaymentMethod.TRANSFER}>{t("payments.transfer")}</SelectItem>
                <SelectItem value={PosPaymentMethod.OTHER}>{t("payments.other")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <p className="text-sm font-semibold text-foreground">
            {t("history.returnTotal")}:{" "}
            {formatKgsMoney(journalReturnTotal, locale, journalSelectedSaleCurrencySource)}
          </p>

          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setJournalReturnSaleId(null);
                setJournalReturnNotes("");
              }}
              disabled={isJournalReturnBusy}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void handleStartJournalReturn()}
              disabled={isJournalReturnBusy}
            >
              {isJournalReturnBusy ? <Spinner className="h-4 w-4" /> : null}
              {t("history.completeReturn")}
            </Button>
          </ModalFooter>
        </div>
      ) : null}
    </Modal>
  );

  const DesktopPosSaleView = () => (
    <div className="min-h-screen bg-muted/40 text-foreground">
      <header className="sticky top-0 z-30 flex min-h-16 flex-col border-b border-border bg-background shadow-sm lg:h-16 lg:flex-row">
        <Button
          asChild
          className="h-16 w-full rounded-md bg-primary px-5 text-base font-semibold text-primary-foreground hover:bg-primary/90 lg:w-32"
        >
          <Link href={`/pos${registerId ? `?registerId=${registerId}` : ""}`}>
            <BackIcon className="h-5 w-5" aria-hidden />
            {tCommon("back")}
          </Link>
        </Button>

        <div className="flex min-h-16 flex-1 items-center gap-3 bg-card px-4">
          <SearchIcon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <ScanInput
            ref={lineSearchInputRef}
            context="pos"
            value={lineSearch}
            onValueChange={setLineSearch}
            placeholder={t("sell.searchProduct")}
            ariaLabel={t("sell.searchProduct")}
            onResolved={handleScanResolved}
            supportsTabSubmit
            autoFocus={hasOpenShift}
            showDropdown={false}
            disabled={!hasOpenShift}
            className="w-full"
            inputClassName="h-12 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0"
          />
        </div>

        <div className="grid min-h-12 gap-0 border-t border-border bg-muted/30 lg:w-[520px] lg:border-l lg:border-t-0 2xl:w-[600px]">
          <div className="flex min-w-0 items-center gap-2 px-3 py-2">
            <Badge
              variant={hasOpenShift ? "success" : "warning"}
              className="h-8 shrink-0 px-3 text-xs font-semibold"
            >
              {hasOpenShift ? t("entry.shiftOpen") : t("entry.shiftClosed")}
            </Badge>
            <Select value={registerId} onValueChange={setRegisterId}>
              <SelectTrigger
                aria-label={t("entry.register")}
                className="h-8 min-w-0 flex-1 border-0 bg-transparent px-0 text-left text-sm font-semibold shadow-none focus:ring-0"
              >
                <SelectValue placeholder={selectedRegisterLabel} />
              </SelectTrigger>
              <SelectContent>
                {(registersQuery.data ?? []).map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.store.name} · {item.name} ({item.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative flex min-w-0 max-w-[44%] items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                className="h-8 min-w-0 justify-start gap-1 px-2 text-xs font-medium"
                onClick={() => setCustomerSelectorOpen((current) => !current)}
                disabled={!hasOpenShift || !activeStoreId}
                aria-expanded={customerSelectorOpen}
              >
                <span className="truncate">
                  {currentCustomer
                    ? currentCustomerDetails
                      ? `${currentCustomerLabel} · ${currentCustomerDetails}`
                      : currentCustomerLabel
                    : t("sell.retailCustomer")}
                </span>
                <ChevronDownIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </Button>
              {currentCustomer ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={openCustomerEdit}
                  disabled={!currentCustomer.id || updateCustomerProfileMutation.isLoading}
                  aria-label={t("sell.editCustomer")}
                  title={t("sell.editCustomer")}
                >
                  {updateCustomerProfileMutation.isLoading ? (
                    <Spinner className="h-3.5 w-3.5" />
                  ) : (
                    <EditIcon className="h-3.5 w-3.5" aria-hidden />
                  )}
                </Button>
              ) : null}
              {currentCustomer ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => void handleClearCustomer()}
                  disabled={updateCustomerMutation.isLoading}
                  aria-label={t("sell.clearCustomer")}
                  title={t("sell.clearCustomer")}
                >
                  {updateCustomerMutation.isLoading ? (
                    <Spinner className="h-3.5 w-3.5" />
                  ) : (
                    <CloseIcon className="h-3.5 w-3.5" aria-hidden />
                  )}
                </Button>
              ) : null}
              {customerSelectorOpen ? (
                <PopoverSurface className="absolute left-0 top-full z-50 mt-2 max-h-[70vh] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto p-0 sm:left-auto sm:right-0">
                  <div className="space-y-3 p-3">
                    <div className="flex gap-2">
                      <Input
                        value={customerSearch}
                        onChange={(event) => setCustomerSearch(event.target.value)}
                        placeholder={t("sell.customerSearchPlaceholder")}
                        autoFocus
                      />
                      <Button
                        type="button"
                        variant={customerCreateOpen ? "default" : "secondary"}
                        size="icon"
                        className="h-10 w-10 shrink-0"
                        onClick={() => setCustomerCreateOpen((current) => !current)}
                        aria-label={t("sell.createCustomer")}
                        title={t("sell.createCustomer")}
                      >
                        <AddIcon className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant={currentCustomer ? "secondary" : "default"}
                      className="h-10 w-full justify-start"
                      onClick={() => void handleClearCustomer()}
                      disabled={updateCustomerMutation.isLoading}
                    >
                      {t("sell.selectRetailCustomer")}
                    </Button>
                  </div>

                  {customerCreateOpen ? (
                    <CustomerCreatePanel
                      name={newCustomerName}
                      email={newCustomerEmail}
                      phone={newCustomerPhone}
                      address={newCustomerAddress}
                      namePlaceholder={t("sell.customerNamePlaceholder")}
                      emailPlaceholder={t("sell.customerEmailPlaceholder")}
                      phonePlaceholder={t("sell.customerPhonePlaceholder")}
                      addressPlaceholder={t("sell.customerAddressPlaceholder")}
                      submitLabel={t("sell.createCustomer")}
                      isLoading={createCustomerMutation.isLoading}
                      disabled={createCustomerMutation.isLoading || !activeStoreId}
                      onNameChange={setNewCustomerName}
                      onEmailChange={setNewCustomerEmail}
                      onPhoneChange={setNewCustomerPhone}
                      onAddressChange={setNewCustomerAddress}
                      onSubmit={() => void handleCreateCustomer()}
                    />
                  ) : null}

                  {customerSearchQuery.isLoading || customerSearchQuery.isFetching ? (
                    <div className="flex items-center justify-center gap-2 border-t border-border py-5 text-sm text-muted-foreground">
                      <Spinner className="h-4 w-4" />
                      {tCommon("loading")}
                    </div>
                  ) : null}

                  {customerSearchQuery.error ? (
                    <div className="m-3 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                      {translateError(tErrors, customerSearchQuery.error)}
                    </div>
                  ) : null}

                  {!customerSearchQuery.isLoading &&
                  !customerSearchQuery.error &&
                  !(customerSearchQuery.data?.items.length ?? 0) ? (
                    <div className="border-t border-border px-4 py-5 text-center text-sm text-muted-foreground">
                      {t("sell.customerNotFound")}
                    </div>
                  ) : null}

                  {customerSearchQuery.data?.items.length ? (
                    <div className="divide-y divide-border border-t border-border">
                      {customerSearchQuery.data.items.map((customer) => (
                        <button
                          key={customer.id}
                          type="button"
                          className="flex w-full flex-col gap-1 px-4 py-3 text-left transition hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => {
                            void handleSelectCustomer({
                              id: customer.id,
                              name: customer.name,
                              email: customer.email,
                              phone: customer.phone,
                              address: customer.address,
                            });
                          }}
                          disabled={updateCustomerMutation.isLoading}
                        >
                          <span className="font-medium text-foreground">{customer.name}</span>
                          <span className="text-sm text-muted-foreground">
                            {[customer.phone, customer.email].filter(Boolean).join(" · ") ||
                              t("sell.customerNoContact")}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </PopoverSurface>
              ) : null}
            </div>
            <Button
              type="button"
              variant="secondary"
              className="h-8 shrink-0 gap-1.5 px-2 text-xs"
              onClick={() => setReceiptJournalOpen(true)}
              disabled={!journalStoreId}
            >
              <SalesOrdersIcon className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden xl:inline">{t("sell.receiptJournal")}</span>
            </Button>
          </div>
        </div>
      </header>

      {!hasOpenShift ? (
        <main className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
          <section className="w-full max-w-xl rounded-md border border-border bg-card p-6 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-lg font-semibold text-foreground">{t("entry.shiftClosed")}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t("sell.openShiftFirst")}</p>
              </div>
              {registerId ? (
                <Button asChild>
                  <Link href={`/pos?registerId=${registerId}`}>{t("sell.openShiftFirst")}</Link>
                </Button>
              ) : null}
            </div>
          </section>
        </main>
      ) : (
        <main className="grid min-h-[calc(100vh-4rem)] pb-20 lg:h-[calc(100vh-4rem)] lg:grid-cols-[minmax(0,1fr)_520px] lg:pb-0 2xl:grid-cols-[minmax(0,1fr)_600px]">
          <section className="flex min-h-0 flex-col bg-muted/40">
            <div className="min-h-14 overflow-x-auto border-b border-border/70 bg-card px-4 py-3 shadow-sm">
              <div className="flex w-max min-w-full items-center justify-center gap-2">
                <Button
                  type="button"
                  variant={selectedCategory ? "secondary" : "default"}
                  className="h-10 shrink-0 rounded-md"
                  onClick={() => {
                    setSelectedCategory("");
                    setLineSearch("");
                  }}
                >
                  <TagIcon className="h-4 w-4" aria-hidden />
                  {t("sell.allProducts")}
                </Button>
                {visibleProductCategories.map((category) => (
                  <Button
                    key={category}
                    type="button"
                    variant={selectedCategory === category ? "default" : "secondary"}
                    className="h-10 shrink-0 rounded-md"
                    onClick={() => setSelectedCategory(category)}
                  >
                    {categoryLabel(category)}
                  </Button>
                ))}
              </div>
            </div>

            {activeDraft && !saleId ? (
              <div className="mx-4 mt-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <p className="font-semibold text-foreground">{t("sell.draftDetectedTitle")}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("sell.draftDetectedHint", { number: activeDraft?.number ?? "" })}
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Button
                    type="button"
                    className="w-full sm:w-auto"
                    onClick={handleResumeActiveDraft}
                    disabled={isLineBusy || completeMutation.isLoading}
                  >
                    {t("sell.resumeDraft")}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full sm:w-auto"
                    onClick={() => void handleDiscardActiveDraft()}
                    disabled={isLineBusy || completeMutation.isLoading}
                  >
                    {cancelDraftMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                    {t("sell.discardSale")}
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              {catalogProductsQuery.error ? (
                <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                  {translateError(tErrors, catalogProductsQuery.error)}
                </div>
              ) : null}

              {productGridLoading ? (
                <div className="flex min-h-[180px] items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Spinner className="h-4 w-4" />
                  {tCommon("loading")}
                </div>
              ) : null}

              {!productGridLoading && !visibleProducts.length ? (
                <div className="grid min-h-[260px] place-items-center rounded-md border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
                  <div>
                    <SearchIcon className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden />
                    <p className="mt-3">
                      {hasSearchTerm || selectedCategory
                        ? t("sell.noSearchResults")
                        : t("sell.catalogEmpty")}
                    </p>
                  </div>
                </div>
              ) : null}

              {visibleProducts.length ? (
                <div className="space-y-2">
                  {visibleProducts.map((product) => (
                    <PosProductButton
                      key={product.id}
                      product={product}
                      variant="desktop"
                      enableSku={enableSku}
                      enableBarcode={enableBarcode}
                      disabled={cancelDraftMutation.isLoading || completeMutation.isLoading}
                      cartQty={cartQtyByProductId.get(product.id) ?? 0}
                      addProductLabel={t("sell.addProduct")}
                      decreaseQtyLabel={t("sell.decreaseQty")}
                      increaseQtyLabel={t("sell.increaseQty")}
                      priceMissingLabel={t("sell.priceMissing")}
                      formatSaleMoney={formatSaleMoney}
                      stockMeta={stockMeta}
                      onProductClick={handleProductClick}
                      onProductDecrement={handleProductDecrement}
                    />
                  ))}
                </div>
              ) : null}
            </div>

            <footer className="grid min-h-12 grid-cols-[1fr_auto_1fr] items-center border-t border-border bg-card px-4 py-2 text-sm text-muted-foreground">
              <span aria-hidden />
              <div className="max-w-full truncate text-center">
                {selectedRegisterLabel}
                {shiftOpenedLabel ? ` / ${shiftOpenedLabel}` : ""}
              </div>
              <span className="h-3 w-3 justify-self-end rounded-md bg-success" aria-hidden />
            </footer>
          </section>

          <aside
            className={`fixed inset-x-0 bottom-0 z-40 flex max-h-[88vh] min-h-[76px] flex-col rounded-t-md border border-border bg-card shadow-2xl transition-transform duration-200 lg:static lg:z-auto lg:max-h-none lg:min-h-0 lg:translate-y-0 lg:rounded-md lg:border-y-0 lg:border-l lg:border-r-0 lg:shadow-none ${
              mobileCheckoutOpen ? "translate-y-0" : "translate-y-[calc(100%-76px)]"
            }`}
          >
            <button
              type="button"
              className="flex h-[76px] shrink-0 items-center justify-between gap-3 border-b border-border px-4 text-left lg:hidden"
              onClick={() => setMobileCheckoutOpen((current) => !current)}
              aria-expanded={mobileCheckoutOpen}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{checkoutPanelTitle}</p>
                <p className="truncate text-xs text-muted-foreground">{checkoutSheetSummary}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-base font-bold text-foreground">
                  {hasCartLines
                    ? formatSaleMoney(cartTotalKgs)
                    : showCompletedSale
                      ? t("sell.done")
                      : formatSaleMoney(0)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {mobileCheckoutOpen ? t("sell.hideCart") : t("sell.openCart")}
                </p>
              </div>
            </button>

            {showCompletedSale && lastCompletedSale ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="border-b border-border px-5 py-5">
                  <Badge variant={autoReceiptStatus === "failed" ? "danger" : "success"}>
                    {t("sell.saleCompletedTitle")}
                  </Badge>
                  <h2 className="mt-4 text-xl font-semibold text-foreground">
                    {t("sell.completeSuccess", { number: lastCompletedSale.number })}
                  </h2>
                  <p
                    className={`mt-2 text-sm ${
                      autoReceiptStatus === "failed" ? "text-danger" : "text-muted-foreground"
                    }`}
                  >
                    {receiptStatusLabel}
                  </p>
                </div>
                <div className="flex min-h-0 flex-1 flex-col justify-between gap-5 overflow-y-auto p-5">
                  <div className="space-y-3">
                    <Button type="button" className="h-12 w-full" onClick={handleStartNewSale}>
                      {t("sell.newSale")}
                    </Button>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          void handleReceiptPdf("print", "precheck");
                        }}
                        disabled={Boolean(receiptAction)}
                      >
                        {receiptAction?.mode === "print" && receiptAction.kind === "precheck" ? (
                          <Spinner className="h-4 w-4" />
                        ) : (
                          <PrintIcon className="h-4 w-4" aria-hidden />
                        )}
                        {t("sell.printPrecheck")}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          void handleReceiptPdf("download", "precheck");
                        }}
                        disabled={Boolean(receiptAction)}
                      >
                        {receiptAction?.mode === "download" && receiptAction.kind === "precheck" ? (
                          <Spinner className="h-4 w-4" />
                        ) : (
                          <DownloadIcon className="h-4 w-4" aria-hidden />
                        )}
                        {t("sell.downloadPrecheck")}
                      </Button>
                    </div>
                    {lastCompletedSale.kkmStatus === "SENT" ? (
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => {
                            void handleReceiptPdf("print", "fiscal");
                          }}
                          disabled={Boolean(receiptAction)}
                        >
                          {receiptAction?.mode === "print" && receiptAction.kind === "fiscal" ? (
                            <Spinner className="h-4 w-4" />
                          ) : (
                            <PrintIcon className="h-4 w-4" aria-hidden />
                          )}
                          {t("sell.printFiscalReceipt")}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            void handleReceiptPdf("download", "fiscal");
                          }}
                          disabled={Boolean(receiptAction)}
                        >
                          {receiptAction?.mode === "download" && receiptAction.kind === "fiscal" ? (
                            <Spinner className="h-4 w-4" />
                          ) : (
                            <DownloadIcon className="h-4 w-4" aria-hidden />
                          )}
                          {t("sell.downloadFiscalReceipt")}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <p className="text-center text-xs text-muted-foreground">
                    {t("sell.receiptActionsHint")}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {checkoutPanelTitle}
                      </p>
                      {shiftOpenedLabel ? (
                        <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                          {shiftOpenedLabel}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground">
                      {selectedRegisterLabel}
                    </p>
                  </div>
                  {saleId ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-8 shrink-0 px-3 text-xs"
                      onClick={handleDiscardSale}
                      disabled={isLineBusy || completeMutation.isLoading}
                    >
                      {cancelDraftMutation.isLoading ? <Spinner className="h-3.5 w-3.5" /> : null}
                      {t("sell.discardSale")}
                    </Button>
                  ) : null}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                  {saleId && saleQuery.error ? (
                    <div className="m-4 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                      {translateError(tErrors, saleQuery.error)}
                    </div>
                  ) : null}

                  {saleId && saleQuery.isLoading && !hasCartLines ? (
                    <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                      <Spinner className="h-4 w-4" />
                      {tCommon("loading")}
                    </div>
                  ) : null}

                  {!hasCartLines && !saleQuery.isLoading && !saleQuery.error ? (
                    <div className="grid min-h-[300px] place-items-center p-6 text-center">
                      <div>
                        <div className="mx-auto grid h-12 w-12 place-items-center rounded-md border border-dashed border-border bg-muted/30 text-muted-foreground">
                          <EmptyIcon className="h-5 w-5" aria-hidden />
                        </div>
                        <p className="mt-4 text-sm font-medium text-foreground">
                          {t("sell.emptyCartTitle")}
                        </p>
                        <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                          {t("sell.emptyCartHint")}
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {hasCartLines ? (
                    <div className="divide-y divide-border">
                      {saleLines.map((line) => {
                        const lineDiscountKgs = lineDiscountById.get(line.id) ?? 0;
                        const lineNetTotalKgs = roundMoney(
                          Math.max(0, line.lineTotalKgs - lineDiscountKgs),
                        );

                        return (
                          <div
                            key={line.id}
                            className="px-3 py-2"
                            data-testid="pos-cart-line"
                            data-product-id={getCartLineProductId(line)}
                          >
                            <div className="flex gap-2.5">
                              {line.product.primaryImage ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={line.product.primaryImage}
                                  alt={line.product.name}
                                  loading="lazy"
                                  decoding="async"
                                  className="h-12 w-12 shrink-0 rounded-md border border-border object-cover"
                                />
                              ) : (
                                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md border border-dashed border-border bg-muted/40 text-muted-foreground">
                                  <EmptyIcon className="h-4 w-4" aria-hidden />
                                </span>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="line-clamp-2 break-words text-sm font-medium leading-5 text-foreground">
                                      {line.product.name}
                                      {line.product.isBundle ? ` · ${t("sell.bundle")}` : ""}
                                    </p>
                                    {enableSku ? (
                                      <p className="truncate text-[11px] leading-4 text-muted-foreground">
                                        {line.product.sku}
                                      </p>
                                    ) : null}
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                                    onClick={() => handleRemoveLine(line.id)}
                                    disabled={isLineBusy || completeMutation.isLoading}
                                    aria-label={tCommon("delete")}
                                  >
                                    <DeleteIcon className="h-4 w-4" aria-hidden />
                                  </Button>
                                </div>
                                <div className="mt-1.5 grid grid-cols-[1fr_auto] items-center gap-2">
                                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <div className="flex min-w-0 items-center gap-1.5">
                                      <Input
                                        data-testid="pos-line-price"
                                        value={
                                          lineInputDrafts[line.id]?.price ??
                                          formatSaleMoneyDraft(line.unitPriceKgs)
                                        }
                                        aria-label={t("sell.unitPrice")}
                                        title={t("sell.unitPrice")}
                                        inputMode="decimal"
                                        className="h-8 w-24 rounded-md px-2 text-[12px] font-medium text-foreground shadow-none focus-visible:ring-1"
                                        onFocus={(event) => event.currentTarget.select()}
                                        onChange={(event) =>
                                          handleUpdateLinePrice(line.id, event.currentTarget.value)
                                        }
                                        onBlur={() => handleLinePriceBlur(line)}
                                        onKeyDown={(event) => {
                                          if (event.key === "Enter") {
                                            event.preventDefault();
                                            event.currentTarget.blur();
                                          }
                                          if (event.key === "Escape") {
                                            setLineInputDrafts((current) => ({
                                              ...current,
                                              [line.id]: {
                                                ...current[line.id],
                                                price: formatSaleMoneyDraft(line.unitPriceKgs),
                                              },
                                            }));
                                            event.currentTarget.blur();
                                          }
                                        }}
                                        disabled={
                                          cancelDraftMutation.isLoading ||
                                          completeMutation.isLoading
                                        }
                                      />
                                      {lineDiscountKgs > 0 ? (
                                        <span className="truncate text-[11px] leading-4 text-muted-foreground">
                                          {t("sell.discount")} {formatSaleMoney(lineDiscountKgs)}
                                        </span>
                                      ) : null}
                                    </div>
                                    <div className="inline-flex items-center overflow-hidden rounded-md border border-border bg-background">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 rounded-md text-sm"
                                        onClick={() =>
                                          handleUpdateQty(
                                            line.id,
                                            String(Math.max(1, line.qty - 1)),
                                          )
                                        }
                                        disabled={
                                          line.qty <= 1 ||
                                          cancelDraftMutation.isLoading ||
                                          completeMutation.isLoading
                                        }
                                        aria-label={t("sell.decreaseQty")}
                                      >
                                        -
                                      </Button>
                                      <Input
                                        data-testid="pos-line-qty"
                                        value={lineInputDrafts[line.id]?.qty ?? String(line.qty)}
                                        onChange={(event) =>
                                          handleUpdateQty(line.id, event.currentTarget.value)
                                        }
                                        onFocus={(event) => event.currentTarget.select()}
                                        onBlur={() => handleQtyBlur(line)}
                                        className="h-8 w-11 rounded-md border-y-0 px-1 text-center text-sm shadow-none focus-visible:ring-0"
                                        inputMode="numeric"
                                        disabled={
                                          cancelDraftMutation.isLoading ||
                                          completeMutation.isLoading
                                        }
                                      />
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 rounded-md text-sm"
                                        onClick={() =>
                                          handleUpdateQty(line.id, String(line.qty + 1))
                                        }
                                        disabled={
                                          cancelDraftMutation.isLoading ||
                                          completeMutation.isLoading
                                        }
                                        aria-label={t("sell.increaseQty")}
                                      >
                                        +
                                      </Button>
                                    </div>
                                  </div>
                                  <p
                                    className="text-right text-sm font-semibold leading-none text-foreground"
                                    data-testid="pos-line-total"
                                  >
                                    {formatSaleMoney(lineNetTotalKgs)}
                                  </p>
                                </div>
                              </div>
                            </div>
                            {saleMarkingEnabled && line.product.complianceFlags?.requiresMarking ? (
                              <div className="mt-2 space-y-1.5 rounded-md border border-border bg-muted/20 p-2">
                                <p className="text-[11px] text-muted-foreground">
                                  {t("sell.markingLabel")}
                                  {saleMarkingMode === "REQUIRED_ON_SALE"
                                    ? ` · ${t("sell.markingRequired")}`
                                    : ""}
                                </p>
                                <Input
                                  value={markingInput[line.id] ?? ""}
                                  onChange={(event) =>
                                    setMarkingInput((current) => ({
                                      ...current,
                                      [line.id]: event.target.value,
                                    }))
                                  }
                                  placeholder={t("sell.markingPlaceholder")}
                                  className="h-8 px-2 text-sm"
                                />
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-[11px] text-muted-foreground">
                                    {t("sell.markingCapturedCount", {
                                      count: line.markingCodes.length,
                                    })}
                                  </p>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    className="h-8 px-3 text-xs"
                                    onClick={() => handleSaveMarkingCodes(line.id)}
                                    disabled={isLineBusy || completeMutation.isLoading}
                                  >
                                    {t("sell.markingSave")}
                                  </Button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>

                {hasCartLines ? (
                  <div ref={paymentsSectionRef} className="border-t border-border bg-card">
                    <div className="space-y-2 px-4 py-2">
                      <div className="px-1">
                        <div className="space-y-1 text-[11px] leading-4">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">{t("sell.subtotal")}</span>
                            <span className="font-medium text-muted-foreground">
                              {formatSaleMoney(cartSubtotalKgs)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">{t("sell.discount")}</span>
                            <div className="flex items-center gap-2">
                              {!showDiscountEditor ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-1.5 text-[11px] text-muted-foreground"
                                  onClick={() => setDiscountEditorOpen(true)}
                                  disabled={isLineBusy || completeMutation.isLoading}
                                >
                                  + {t("sell.addDiscount")}
                                </Button>
                              ) : null}
                              <span className="font-medium text-muted-foreground">
                                {formatSaleMoney(cartDiscountKgs)}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-1.5 flex items-end justify-between gap-3">
                          <span className="text-sm font-semibold leading-none text-foreground">
                            {t("sell.amountDue")}
                          </span>
                          <span
                            className="text-xl font-bold leading-none text-foreground"
                            data-testid="pos-cart-total"
                          >
                            {formatSaleMoney(cartTotalKgs)}
                          </span>
                        </div>
                      </div>

                      {showDiscountEditor ? (
                        <div className="rounded-md border border-border/60 bg-muted/5 p-2">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs font-medium text-foreground">
                              {t("sell.saleDiscount")}
                            </p>
                            <Badge variant="muted" className="h-6 shrink-0 px-2 text-[11px]">
                              {t("sell.discountAmountMode")}
                            </Badge>
                          </div>
                          <div className="mt-1.5 grid gap-1.5 sm:grid-cols-[1fr_64px_auto]">
                            <Input
                              value={discountDraft}
                              onChange={(event) => setDiscountDraft(event.target.value)}
                              onBlur={() => void handleUpdateDiscount()}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  event.currentTarget.blur();
                                }
                              }}
                              aria-label={t("sell.saleDiscount")}
                              placeholder={t("sell.discountPlaceholder")}
                              inputMode="decimal"
                              disabled={isLineBusy || completeMutation.isLoading}
                              className="h-8 px-2 text-sm"
                            />
                            <div className="flex h-8 items-center justify-center rounded-md border border-input bg-muted/20 px-2 text-[11px] font-medium text-muted-foreground">
                              {discountCurrencyCode}
                            </div>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="h-8 px-2.5 text-xs"
                              onClick={() => void handleUpdateDiscount()}
                              disabled={isLineBusy || completeMutation.isLoading}
                            >
                              {updateDiscountMutation.isLoading ? (
                                <Spinner className="h-3.5 w-3.5" />
                              ) : null}
                              {t("sell.applyDiscount")}
                            </Button>
                          </div>
                        </div>
                      ) : null}

                      <div className="rounded-md border border-border/60 bg-muted/5 p-2">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium leading-none text-foreground">
                              {t("sell.paymentsTitle")}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 rounded-md px-1">
                            <span className="text-xs leading-none text-muted-foreground">
                              {t("sell.sellInDebt")}
                            </span>
                            <Switch checked={sellInDebt} onCheckedChange={handleSellInDebtChange} />
                          </div>
                        </div>

                        {sellInDebt ? (
                          <div className="mt-2 space-y-1.5 rounded-md border border-warning/25 bg-warning/10 p-2">
                            <p className="text-xs leading-4 text-muted-foreground">
                              {t("sell.sellInDebtHint")}
                            </p>
                            <label className="text-xs font-medium text-foreground">
                              {t("sell.debtFullName")}
                            </label>
                            <Input
                              value={debtFullName}
                              onChange={(event) => setDebtFullName(event.target.value)}
                              placeholder={t("sell.debtFullNamePlaceholder")}
                              disabled={isLineBusy || completeMutation.isLoading}
                              className="h-8 px-2 text-sm"
                            />
                          </div>
                        ) : null}

                        {!sellInDebt ? (
                          <div className="mt-2 space-y-1.5">
                            {payments.map((payment, index) => (
                              <div
                                key={`${index}-${payment.method}`}
                                className="grid grid-cols-[116px_1fr_32px] gap-1.5"
                              >
                                <Select
                                  value={payment.method}
                                  onValueChange={(value) =>
                                    setPayments((current) =>
                                      current.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? { ...item, method: value as PosPaymentMethod }
                                          : item,
                                      ),
                                    )
                                  }
                                >
                                  <SelectTrigger
                                    aria-label={t("sell.paymentMethod")}
                                    className="h-8 px-2 text-sm"
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value={PosPaymentMethod.CASH}>
                                      {t("payments.cash")}
                                    </SelectItem>
                                    <SelectItem value={PosPaymentMethod.CARD}>
                                      {t("payments.card")}
                                    </SelectItem>
                                    <SelectItem value={PosPaymentMethod.TRANSFER}>
                                      {t("payments.transfer")}
                                    </SelectItem>
                                    <SelectItem value={PosPaymentMethod.OTHER}>
                                      {t("payments.other")}
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                                <Input
                                  ref={index === 0 ? firstPaymentAmountRef : undefined}
                                  value={payments.length === 1 ? cartDisplayTotalDraft : payment.amount}
                                  onChange={(event) => {
                                    if (payments.length === 1) {
                                      return;
                                    }
                                    setPayments((current) =>
                                      current.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? { ...item, amount: event.target.value }
                                          : item,
                                      ),
                                    );
                                  }}
                                  placeholder={t("sell.paymentAmount")}
                                  inputMode="decimal"
                                  readOnly={payments.length === 1}
                                  className="h-8 px-2 text-sm"
                                />
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => removePaymentRow(index)}
                                  disabled={
                                    payments.length <= 1 || isLineBusy || completeMutation.isLoading
                                  }
                                  aria-label={tCommon("delete")}
                                >
                                  <DeleteIcon className="h-4 w-4" aria-hidden />
                                </Button>
                              </div>
                            ))}
                            <div className="flex items-center justify-between gap-3">
                              <Button
                                variant="secondary"
                                size="sm"
                                className="h-8 px-3 text-xs"
                                onClick={addPaymentRow}
                                disabled={isLineBusy || completeMutation.isLoading}
                              >
                                {t("sell.addPayment")}
                              </Button>
                              {showPaymentTotalSummary ? (
                                <p className="text-xs text-muted-foreground">
                                  {t("sell.paymentTotal")}: {paymentTotalLabel}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <Button
                        className="h-9 w-full rounded-md bg-success px-4 text-sm font-semibold text-success-foreground hover:bg-success/90 disabled:bg-success/40 disabled:text-success-foreground/70"
                        onClick={handleComplete}
                        disabled={completeDisabled}
                      >
                        <span className="flex items-center justify-center gap-2">
                          {completeMutation.isLoading ? <Spinner className="h-5 w-5" /> : null}
                          {sellInDebt ? t("sell.completeDebtSale") : t("sell.completeSale")}
                        </span>
                      </Button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </aside>
        </main>
      )}
      {CustomerEditModal()}
      {ReceiptJournalModal()}
      {JournalSaleDetailModal()}
      {JournalReturnModal()}
    </div>
  );

  const MobileCustomerSheet = () => {
    if (!customerSelectorOpen) {
      return null;
    }

    return (
      <div className="fixed inset-0 z-[70] md:hidden">
        <button
          type="button"
          className="absolute inset-0 bg-black/35"
          onClick={() => setCustomerSelectorOpen(false)}
          aria-label={tCommon("close")}
        />
        <section
          role="dialog"
          aria-modal="true"
          aria-label={t("sell.customerSelectorTitle")}
          className="absolute inset-x-0 bottom-0 max-h-[86dvh] overflow-y-auto border-t border-border bg-background p-4 shadow-2xl"
          style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {t("sell.customerSelectorTitle")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("sell.customerSelectorSubtitle")}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={() => setCustomerSelectorOpen(false)}
              aria-label={tCommon("close")}
            >
              <CloseIcon className="h-4 w-4" aria-hidden />
            </Button>
          </div>

          <div className="mt-4 space-y-3">
            <div className="flex gap-2">
              <Input
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                placeholder={t("sell.customerSearchPlaceholder")}
                autoFocus
                className="h-12"
              />
              <Button
                type="button"
                variant={customerCreateOpen ? "default" : "secondary"}
                size="icon"
                className="h-12 w-12 shrink-0"
                onClick={() => setCustomerCreateOpen((current) => !current)}
                aria-label={t("sell.createCustomer")}
                title={t("sell.createCustomer")}
              >
                <AddIcon className="h-4 w-4" aria-hidden />
              </Button>
            </div>
            <Button
              type="button"
              variant={currentCustomer ? "secondary" : "default"}
              className="h-12 w-full justify-start"
              onClick={() => void handleClearCustomer()}
              disabled={updateCustomerMutation.isLoading}
            >
              {t("sell.selectRetailCustomer")}
            </Button>
          </div>

          {customerCreateOpen ? (
            <CustomerCreatePanel
              name={newCustomerName}
              email={newCustomerEmail}
              phone={newCustomerPhone}
              address={newCustomerAddress}
              namePlaceholder={t("sell.customerNamePlaceholder")}
              emailPlaceholder={t("sell.customerEmailPlaceholder")}
              phonePlaceholder={t("sell.customerPhonePlaceholder")}
              addressPlaceholder={t("sell.customerAddressPlaceholder")}
              submitLabel={t("sell.createCustomer")}
              isLoading={createCustomerMutation.isLoading}
              disabled={createCustomerMutation.isLoading || !activeStoreId}
              onNameChange={setNewCustomerName}
              onEmailChange={setNewCustomerEmail}
              onPhoneChange={setNewCustomerPhone}
              onAddressChange={setNewCustomerAddress}
              onSubmit={() => void handleCreateCustomer()}
            />
          ) : null}

          {customerSearchQuery.isLoading || customerSearchQuery.isFetching ? (
            <div className="mt-4 flex items-center justify-center gap-2 border border-border bg-card py-5 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : null}

          {customerSearchQuery.error ? (
            <div className="mt-4 border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
              {translateError(tErrors, customerSearchQuery.error)}
            </div>
          ) : null}

          {!customerSearchQuery.isLoading &&
          !customerSearchQuery.error &&
          !(customerSearchQuery.data?.items.length ?? 0) ? (
            <div className="mt-4 border border-border bg-card px-4 py-5 text-center text-sm text-muted-foreground">
              {t("sell.customerNotFound")}
            </div>
          ) : null}

          {customerSearchQuery.data?.items.length ? (
            <div className="mt-4 divide-y divide-border border border-border bg-card">
              {customerSearchQuery.data.items.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  className="flex min-h-14 w-full flex-col gap-1 px-4 py-3 text-left transition hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    void handleSelectCustomer({
                      id: customer.id,
                      name: customer.name,
                      email: customer.email,
                      phone: customer.phone,
                      address: customer.address,
                    });
                  }}
                  disabled={updateCustomerMutation.isLoading}
                >
                  <span className="font-medium text-foreground">{customer.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {[customer.phone, customer.email].filter(Boolean).join(" · ") ||
                      t("sell.customerNoContact")}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    );
  };

  const MobilePosView = () => {
    const cartSheetOpen = mobileCheckoutOpen || showCompletedSale;
    const showMobileRegisterPanel = !hasOpenShift || (registersQuery.data?.length ?? 0) > 1;

    return (
      <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
        <header className="sticky top-0 z-30 border-b border-border bg-background/95 px-3 py-3 shadow-sm backdrop-blur md:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {selectedRegister?.store.name ?? t("entry.register")}
              </p>
              <div className="mt-1 flex min-w-0 items-center gap-2">
                <h1 className="truncate text-lg font-semibold text-foreground">
                  {t("sell.title")}
                </h1>
                <Badge variant={hasOpenShift ? "success" : "warning"} className="shrink-0">
                  {hasOpenShift ? t("entry.shiftOpen") : t("entry.shiftClosed")}
                </Badge>
              </div>
            </div>
            <Button
              asChild
              type="button"
              variant="secondary"
              size="icon"
              className="h-11 w-11 shrink-0"
              aria-label={tCommon("back")}
            >
              <Link href={`/pos${registerId ? `?registerId=${registerId}` : ""}`}>
                <BackIcon className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              className="h-11 flex-1 justify-start"
              onClick={() => setReceiptJournalOpen(true)}
              disabled={!journalStoreId}
            >
              <SalesOrdersIcon className="h-4 w-4" aria-hidden />
              {t("sell.receiptJournal")}
            </Button>
          </div>

          <div className="mt-3 flex min-h-12 items-center gap-2 border border-input bg-card px-3">
            <SearchIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <ScanInput
              ref={lineSearchInputRef}
              context="pos"
              value={lineSearch}
              onValueChange={setLineSearch}
              placeholder={t("sell.searchProduct")}
              ariaLabel={t("sell.searchProduct")}
              onResolved={handleScanResolved}
              supportsTabSubmit
              showDropdown={false}
              disabled={!hasOpenShift}
              className="min-w-0 flex-1"
              inputClassName="h-11 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0"
            />
          </div>
        </header>

        <main className="mx-auto w-full max-w-md space-y-4 px-3 pb-[calc(11rem+env(safe-area-inset-bottom))] pt-4 md:hidden">
          {showMobileRegisterPanel ? (
            <section className="rounded-md border border-border bg-card p-3 shadow-sm">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">{t("entry.register")}</label>
                <Select value={registerId} onValueChange={setRegisterId}>
                  <SelectTrigger aria-label={t("entry.register")} className="h-11">
                    <SelectValue placeholder={t("entry.selectRegister")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(registersQuery.data ?? []).map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.store.name} · {item.name} ({item.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {shiftOpenedLabel ? <span>{shiftOpenedLabel}</span> : null}
                {!hasOpenShift && registerId ? (
                  <Button asChild variant="secondary" className="h-10 w-full">
                    <Link href={`/pos?registerId=${registerId}`}>{t("sell.openShiftFirst")}</Link>
                  </Button>
                ) : null}
              </div>
            </section>
          ) : null}

          {activeDraft && !saleId ? (
            <section className="border border-warning/40 bg-warning/10 p-3 text-sm">
              <p className="font-semibold text-foreground">{t("sell.draftDetectedTitle")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("sell.draftDetectedHint", { number: activeDraft.number })}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  className="h-11"
                  onClick={handleResumeActiveDraft}
                  disabled={isLineBusy || completeMutation.isLoading}
                >
                  {t("sell.resumeDraft")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11"
                  onClick={() => void handleDiscardActiveDraft()}
                  disabled={isLineBusy || completeMutation.isLoading}
                >
                  {cancelDraftMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                  {t("sell.discardSale")}
                </Button>
              </div>
            </section>
          ) : null}

          <section className="space-y-3">
            <div className="scrollbar-none -mx-3 overflow-x-auto px-3">
              <div className="flex w-max min-w-full gap-2">
                <Button
                  type="button"
                  variant={selectedCategory ? "secondary" : "default"}
                  className="h-10 shrink-0"
                  onClick={() => {
                    setSelectedCategory("");
                    setLineSearch("");
                  }}
                >
                  {t("sell.allProducts")}
                </Button>
                {visibleProductCategories.map((category) => (
                  <Button
                    key={category}
                    type="button"
                    variant={selectedCategory === category ? "default" : "secondary"}
                    className="h-10 shrink-0"
                    onClick={() => setSelectedCategory(category)}
                  >
                    {categoryLabel(category)}
                  </Button>
                ))}
              </div>
            </div>

            {catalogProductsQuery.error ? (
              <div className="border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                {translateError(tErrors, catalogProductsQuery.error)}
              </div>
            ) : null}

            {productGridLoading ? (
              <div className="flex min-h-28 items-center justify-center gap-2 border border-border bg-card text-sm text-muted-foreground">
                <Spinner className="h-4 w-4" />
                {tCommon("loading")}
              </div>
            ) : null}

            {!productGridLoading && !visibleProducts.length ? (
              <div className="grid min-h-44 place-items-center border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
                <div>
                  <SearchIcon className="mx-auto h-6 w-6" aria-hidden />
                  <p className="mt-3">
                    {hasSearchTerm || selectedCategory
                      ? t("sell.noSearchResults")
                      : t("sell.catalogEmpty")}
                  </p>
                </div>
              </div>
            ) : null}

            {visibleProducts.length ? (
              <div className="grid gap-2">
                {visibleProducts.map((product) => (
                  <PosProductButton
                    key={product.id}
                    product={product}
                    variant="mobile"
                    enableSku={enableSku}
                    enableBarcode={enableBarcode}
                    disabled={
                      !hasOpenShift || cancelDraftMutation.isLoading || completeMutation.isLoading
                    }
                    cartQty={cartQtyByProductId.get(product.id) ?? 0}
                    addProductLabel={t("sell.addProduct")}
                    decreaseQtyLabel={t("sell.decreaseQty")}
                    increaseQtyLabel={t("sell.increaseQty")}
                    priceMissingLabel={t("sell.priceMissing")}
                    formatSaleMoney={formatSaleMoney}
                    stockMeta={stockMeta}
                    onProductClick={handleProductClick}
                    onProductDecrement={handleProductDecrement}
                  />
                ))}
              </div>
            ) : null}
          </section>
        </main>

        {!cartSheetOpen ? (
          <button
            type="button"
            className="fixed inset-x-3 z-40 flex min-h-14 items-center justify-between gap-3 border border-border bg-primary px-4 py-3 text-left text-primary-foreground shadow-xl md:hidden"
            style={{ bottom: "calc(5.75rem + env(safe-area-inset-bottom))" }}
            onClick={() => setMobileCheckoutOpen(true)}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{checkoutSheetSummary}</span>
              <span className="block truncate text-xs text-primary-foreground/80">
                {selectedRegisterLabel}
              </span>
            </span>
            <span className="shrink-0 text-sm font-semibold">{t("sell.openCart")}</span>
          </button>
        ) : null}

        {cartSheetOpen ? (
          <div className="fixed inset-0 z-[60] md:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-black/35"
              onClick={() => {
                if (!showCompletedSale) {
                  setMobileCheckoutOpen(false);
                }
              }}
              aria-label={tCommon("close")}
            />
            <section
              role="dialog"
              aria-modal="true"
              aria-label={checkoutPanelTitle}
              className="absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col overflow-hidden border-t border-border bg-background shadow-2xl"
              style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            >
              {showCompletedSale && lastCompletedSale ? (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="border-b border-border p-4">
                    <Badge variant={autoReceiptStatus === "failed" ? "danger" : "success"}>
                      {t("sell.saleCompletedTitle")}
                    </Badge>
                    <h2 className="mt-4 text-xl font-semibold text-foreground">
                      {t("sell.completeSuccess", { number: lastCompletedSale.number })}
                    </h2>
                    <p
                      className={`mt-2 text-sm ${
                        autoReceiptStatus === "failed" ? "text-danger" : "text-muted-foreground"
                      }`}
                    >
                      {receiptStatusLabel}
                    </p>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    <div className="grid gap-2">
                      <Button type="button" className="h-12 w-full" onClick={handleStartNewSale}>
                        {t("sell.newSale")}
                      </Button>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          variant="secondary"
                          className="h-11"
                          onClick={() => {
                            void handleReceiptPdf("print", "precheck");
                          }}
                          disabled={Boolean(receiptAction)}
                        >
                          {receiptAction?.mode === "print" && receiptAction.kind === "precheck" ? (
                            <Spinner className="h-4 w-4" />
                          ) : (
                            <PrintIcon className="h-4 w-4" aria-hidden />
                          )}
                          {t("sell.printPrecheck")}
                        </Button>
                        <Button
                          variant="secondary"
                          className="h-11"
                          onClick={() => {
                            void handleReceiptPdf("download", "precheck");
                          }}
                          disabled={Boolean(receiptAction)}
                        >
                          {receiptAction?.mode === "download" &&
                          receiptAction.kind === "precheck" ? (
                            <Spinner className="h-4 w-4" />
                          ) : (
                            <DownloadIcon className="h-4 w-4" aria-hidden />
                          )}
                          {t("sell.downloadPrecheck")}
                        </Button>
                      </div>
                      {lastCompletedSale.kkmStatus === "SENT" ? (
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            variant="secondary"
                            className="h-11"
                            onClick={() => {
                              void handleReceiptPdf("print", "fiscal");
                            }}
                            disabled={Boolean(receiptAction)}
                          >
                            {receiptAction?.mode === "print" && receiptAction.kind === "fiscal" ? (
                              <Spinner className="h-4 w-4" />
                            ) : (
                              <PrintIcon className="h-4 w-4" aria-hidden />
                            )}
                            {t("sell.printFiscalReceipt")}
                          </Button>
                          <Button
                            variant="secondary"
                            className="h-11"
                            onClick={() => {
                              void handleReceiptPdf("download", "fiscal");
                            }}
                            disabled={Boolean(receiptAction)}
                          >
                            {receiptAction?.mode === "download" &&
                            receiptAction.kind === "fiscal" ? (
                              <Spinner className="h-4 w-4" />
                            ) : (
                              <DownloadIcon className="h-4 w-4" aria-hidden />
                            )}
                            {t("sell.downloadFiscalReceipt")}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    <p className="mt-4 text-center text-xs text-muted-foreground">
                      {t("sell.receiptActionsHint")}
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex min-h-16 items-center justify-between gap-3 border-b border-border px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-foreground">
                        {checkoutPanelTitle}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {checkoutSheetSummary}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className="h-11 w-11 shrink-0"
                      onClick={() => setMobileCheckoutOpen(false)}
                      aria-label={tCommon("close")}
                    >
                      <CloseIcon className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    {saleId && saleQuery.error ? (
                      <div className="mb-3 border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                        {translateError(tErrors, saleQuery.error)}
                      </div>
                    ) : null}

                    <div className="mb-4 border border-border bg-card p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {t("sell.customer")}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          className="min-h-11 min-w-0 flex-1 border border-border bg-background px-3 py-2 text-left"
                          onClick={() => setCustomerSelectorOpen(true)}
                          disabled={!activeStoreId}
                        >
                          <span className="block truncate text-sm font-semibold text-foreground">
                            {currentCustomerLabel}
                          </span>
                          {currentCustomerDetails ? (
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {currentCustomerDetails}
                            </span>
                          ) : null}
                        </button>
                        {currentCustomer ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="icon"
                            className="h-11 w-11 shrink-0"
                            onClick={openCustomerEdit}
                            disabled={!currentCustomer.id || updateCustomerProfileMutation.isLoading}
                            aria-label={t("sell.editCustomer")}
                          >
                            {updateCustomerProfileMutation.isLoading ? (
                              <Spinner className="h-4 w-4" />
                            ) : (
                              <EditIcon className="h-4 w-4" aria-hidden />
                            )}
                          </Button>
                        ) : null}
                        {currentCustomer ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="icon"
                            className="h-11 w-11 shrink-0"
                            onClick={() => void handleClearCustomer()}
                            disabled={updateCustomerMutation.isLoading}
                            aria-label={t("sell.clearCustomer")}
                          >
                            {updateCustomerMutation.isLoading ? (
                              <Spinner className="h-4 w-4" />
                            ) : (
                              <CloseIcon className="h-4 w-4" aria-hidden />
                            )}
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    {!hasCartLines && !saleQuery.isLoading && !saleQuery.error ? (
                      <div className="grid min-h-40 place-items-center border border-dashed border-border bg-card p-6 text-center">
                        <div>
                          <EmptyIcon
                            className="mx-auto h-6 w-6 text-muted-foreground"
                            aria-hidden
                          />
                          <p className="mt-3 text-sm font-semibold text-foreground">
                            {t("sell.emptyCartTitle")}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {t("sell.emptyCartHint")}
                          </p>
                        </div>
                      </div>
                    ) : null}

                    {saleId && saleQuery.isLoading && !hasCartLines ? (
                      <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                        <Spinner className="h-4 w-4" />
                        {tCommon("loading")}
                      </div>
                    ) : null}

                    {hasCartLines ? (
                      <div className="space-y-3">
                        {saleLines.map((line) => {
                          const lineDiscountKgs = lineDiscountById.get(line.id) ?? 0;
                          const lineNetTotalKgs = roundMoney(
                            Math.max(0, line.lineTotalKgs - lineDiscountKgs),
                          );

                          return (
                            <div
                              key={line.id}
                              className="rounded-md border border-border bg-card p-3"
                              data-testid="pos-cart-line"
                              data-product-id={getCartLineProductId(line)}
                            >
                              <div className="flex gap-3">
                                {line.product.primaryImage ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={line.product.primaryImage}
                                    alt={line.product.name}
                                    loading="lazy"
                                    decoding="async"
                                    className="h-14 w-14 shrink-0 border border-border object-cover"
                                  />
                                ) : (
                                  <span className="grid h-14 w-14 shrink-0 place-items-center border border-dashed border-border bg-muted/40 text-muted-foreground">
                                    <EmptyIcon className="h-4 w-4" aria-hidden />
                                  </span>
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="line-clamp-2 text-sm font-semibold text-foreground">
                                        {line.product.name}
                                        {line.product.isBundle ? ` · ${t("sell.bundle")}` : ""}
                                      </p>
                                      {enableSku ? (
                                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                          {line.product.sku}
                                        </p>
                                      ) : null}
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive"
                                      onClick={() => handleRemoveLine(line.id)}
                                      disabled={isLineBusy || completeMutation.isLoading}
                                      aria-label={tCommon("delete")}
                                    >
                                      <DeleteIcon className="h-4 w-4" aria-hidden />
                                    </Button>
                                  </div>

                                  <div className="mt-3 grid grid-cols-[minmax(0,1fr)_132px] gap-2">
                                    <Input
                                      data-testid="pos-line-price"
                                      value={
                                        lineInputDrafts[line.id]?.price ??
                                        formatSaleMoneyDraft(line.unitPriceKgs)
                                      }
                                      aria-label={t("sell.unitPrice")}
                                      inputMode="decimal"
                                      className="h-11 text-right"
                                      onFocus={(event) => event.currentTarget.select()}
                                      onChange={(event) =>
                                        handleUpdateLinePrice(line.id, event.currentTarget.value)
                                      }
                                      onBlur={() => handleLinePriceBlur(line)}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                          event.preventDefault();
                                          event.currentTarget.blur();
                                        }
                                        if (event.key === "Escape") {
                                          setLineInputDrafts((current) => ({
                                            ...current,
                                            [line.id]: {
                                              ...current[line.id],
                                              price: formatSaleMoneyDraft(line.unitPriceKgs),
                                            },
                                          }));
                                          event.currentTarget.blur();
                                        }
                                      }}
                                      disabled={
                                        cancelDraftMutation.isLoading || completeMutation.isLoading
                                      }
                                    />
                                    <div className="inline-flex h-11 w-[132px] items-center overflow-hidden border border-border bg-background">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-11 w-11 rounded-md text-base"
                                        onClick={() =>
                                          handleUpdateQty(
                                            line.id,
                                            String(Math.max(1, line.qty - 1)),
                                          )
                                        }
                                        disabled={
                                          line.qty <= 1 ||
                                          cancelDraftMutation.isLoading ||
                                          completeMutation.isLoading
                                        }
                                        aria-label={t("sell.decreaseQty")}
                                      >
                                        -
                                      </Button>
                                      <Input
                                        data-testid="pos-line-qty"
                                        value={lineInputDrafts[line.id]?.qty ?? String(line.qty)}
                                        onChange={(event) =>
                                          handleUpdateQty(line.id, event.currentTarget.value)
                                        }
                                        onFocus={(event) => event.currentTarget.select()}
                                        onBlur={() => handleQtyBlur(line)}
                                        className="h-11 w-11 rounded-md border-y-0 px-1 text-center shadow-none focus-visible:ring-0"
                                        inputMode="numeric"
                                        disabled={
                                          cancelDraftMutation.isLoading ||
                                          completeMutation.isLoading
                                        }
                                      />
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-11 w-11 rounded-md text-base"
                                        onClick={() =>
                                          handleUpdateQty(line.id, String(line.qty + 1))
                                        }
                                        disabled={
                                          cancelDraftMutation.isLoading ||
                                          completeMutation.isLoading
                                        }
                                        aria-label={t("sell.increaseQty")}
                                      >
                                        +
                                      </Button>
                                    </div>
                                  </div>

                                  <div className="mt-3 flex items-end justify-between gap-3">
                                    <div className="min-w-0">
                                      {lineDiscountKgs > 0 ? (
                                        <p className="truncate text-xs text-muted-foreground">
                                          {t("sell.discount")}: {formatSaleMoney(lineDiscountKgs)}
                                        </p>
                                      ) : null}
                                    </div>
                                    <p
                                      className="text-right text-base font-semibold text-foreground"
                                      data-testid="pos-line-total"
                                    >
                                      {formatSaleMoney(lineNetTotalKgs)}
                                    </p>
                                  </div>
                                </div>
                              </div>

                              {saleMarkingEnabled &&
                              line.product.complianceFlags?.requiresMarking ? (
                                <div className="mt-3 space-y-2 border border-border bg-muted/20 p-2">
                                  <p className="text-xs text-muted-foreground">
                                    {t("sell.markingLabel")}
                                    {saleMarkingMode === "REQUIRED_ON_SALE"
                                      ? ` · ${t("sell.markingRequired")}`
                                      : ""}
                                  </p>
                                  <Input
                                    value={markingInput[line.id] ?? ""}
                                    onChange={(event) =>
                                      setMarkingInput((current) => ({
                                        ...current,
                                        [line.id]: event.target.value,
                                      }))
                                    }
                                    placeholder={t("sell.markingPlaceholder")}
                                    className="h-10"
                                  />
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    className="h-9 w-full"
                                    onClick={() => handleSaveMarkingCodes(line.id)}
                                    disabled={isLineBusy || completeMutation.isLoading}
                                  >
                                    {t("sell.markingSave")}
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    {hasCartLines ? (
                      <div className="mt-4 space-y-3">
                        <div className="rounded-md border border-border bg-card p-3">
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="text-muted-foreground">{t("sell.subtotal")}</span>
                            <span className="font-medium text-foreground">
                              {formatSaleMoney(cartSubtotalKgs)}
                            </span>
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                            <span className="text-muted-foreground">{t("sell.discount")}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-xs"
                              onClick={() => setDiscountEditorOpen((current) => !current)}
                              disabled={isLineBusy || completeMutation.isLoading}
                            >
                              {cartDiscountKgs > 0
                                ? formatSaleMoney(cartDiscountKgs)
                                : `+ ${t("sell.addDiscount")}`}
                            </Button>
                          </div>
                          {showDiscountEditor ? (
                            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_72px] gap-2">
                              <Input
                                value={discountDraft}
                                onChange={(event) => setDiscountDraft(event.target.value)}
                                onBlur={() => void handleUpdateDiscount()}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    event.currentTarget.blur();
                                  }
                                }}
                                aria-label={t("sell.saleDiscount")}
                                placeholder={t("sell.discountPlaceholder")}
                                inputMode="decimal"
                                disabled={isLineBusy || completeMutation.isLoading}
                                className="h-11 text-right"
                              />
                              <span className="flex h-11 items-center justify-center border border-input bg-muted/20 px-2 text-xs font-medium text-muted-foreground">
                                {discountCurrencyCode}
                              </span>
                            </div>
                          ) : null}
                          <div className="mt-3 flex items-end justify-between gap-3">
                            <span className="text-sm font-semibold text-foreground">
                              {t("sell.amountDue")}
                            </span>
                            <span
                              className="text-xl font-bold text-foreground"
                              data-testid="pos-cart-total"
                            >
                              {formatSaleMoney(cartTotalKgs)}
                            </span>
                          </div>
                        </div>

                        <div
                          ref={paymentsSectionRef}
                          className="rounded-md border border-border bg-card p-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-foreground">
                              {t("sell.paymentsTitle")}
                            </p>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">
                                {t("sell.sellInDebt")}
                              </span>
                              <Switch
                                checked={sellInDebt}
                                onCheckedChange={handleSellInDebtChange}
                              />
                            </div>
                          </div>

                          {sellInDebt ? (
                            <div className="mt-3 space-y-2 border border-warning/30 bg-warning/10 p-2">
                              <p className="text-xs text-muted-foreground">
                                {t("sell.sellInDebtHint")}
                              </p>
                              <Input
                                value={debtFullName}
                                onChange={(event) => setDebtFullName(event.target.value)}
                                placeholder={t("sell.debtFullNamePlaceholder")}
                                disabled={isLineBusy || completeMutation.isLoading}
                                className="h-11"
                              />
                            </div>
                          ) : null}

                          {!sellInDebt ? (
                            <div className="mt-3 space-y-2">
                              {payments.map((payment, index) => (
                                <div
                                  key={`${index}-${payment.method}`}
                                  className="grid grid-cols-[1fr_1fr_44px] gap-2"
                                >
                                  <Select
                                    value={payment.method}
                                    onValueChange={(value) =>
                                      setPayments((current) =>
                                        current.map((item, itemIndex) =>
                                          itemIndex === index
                                            ? { ...item, method: value as PosPaymentMethod }
                                            : item,
                                        ),
                                      )
                                    }
                                  >
                                    <SelectTrigger
                                      aria-label={t("sell.paymentMethod")}
                                      className="h-11"
                                    >
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value={PosPaymentMethod.CASH}>
                                        {t("payments.cash")}
                                      </SelectItem>
                                      <SelectItem value={PosPaymentMethod.CARD}>
                                        {t("payments.card")}
                                      </SelectItem>
                                      <SelectItem value={PosPaymentMethod.TRANSFER}>
                                        {t("payments.transfer")}
                                      </SelectItem>
                                      <SelectItem value={PosPaymentMethod.OTHER}>
                                        {t("payments.other")}
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <Input
                                    ref={index === 0 ? firstPaymentAmountRef : undefined}
                                    value={payments.length === 1 ? cartDisplayTotalDraft : payment.amount}
                                    onChange={(event) => {
                                      if (payments.length === 1) {
                                        return;
                                      }
                                      setPayments((current) =>
                                        current.map((item, itemIndex) =>
                                          itemIndex === index
                                            ? { ...item, amount: event.target.value }
                                            : item,
                                        ),
                                      );
                                    }}
                                    placeholder={t("sell.paymentAmount")}
                                    inputMode="decimal"
                                    readOnly={payments.length === 1}
                                    className="h-11"
                                  />
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="icon"
                                    className="h-11 w-11"
                                    onClick={() => removePaymentRow(index)}
                                    disabled={
                                      payments.length <= 1 ||
                                      isLineBusy ||
                                      completeMutation.isLoading
                                    }
                                    aria-label={tCommon("delete")}
                                  >
                                    <DeleteIcon className="h-4 w-4" aria-hidden />
                                  </Button>
                                </div>
                              ))}
                              <div className="flex items-center justify-between gap-3">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  className="h-10"
                                  onClick={addPaymentRow}
                                  disabled={isLineBusy || completeMutation.isLoading}
                                >
                                  {t("sell.addPayment")}
                                </Button>
                                {showPaymentTotalSummary ? (
                                  <p className="text-sm text-muted-foreground">
                                    {t("sell.paymentTotal")}: {paymentTotalLabel}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {hasCartLines ? (
                    <div className="border-t border-border bg-background p-4">
                      <Button
                        className="h-12 w-full bg-success text-base font-semibold text-success-foreground hover:bg-success/90 disabled:bg-success/40 disabled:text-success-foreground/70"
                        onClick={handleComplete}
                        disabled={completeDisabled}
                      >
                        {completeMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                        {sellInDebt ? t("sell.completeDebtSale") : t("sell.completeSale")}
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </section>
          </div>
        ) : null}

        {MobileCustomerSheet()}
        {CustomerEditModal()}
        {ReceiptJournalModal()}
        {JournalSaleDetailModal()}
        {JournalReturnModal()}
      </div>
    );
  };

  if (isPhoneScreen === null) {
    return <div className="min-h-screen bg-background" />;
  }

  return isPhoneScreen ? MobilePosView() : DesktopPosSaleView();
};

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export default PosSellPage;

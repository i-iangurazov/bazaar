"use client";
import { parseQuantity } from "@/lib/quantity";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { CustomerOrderEmailType, CustomerOrderStatus } from "@prisma/client";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import Image from "next/image";

import { OrderPayment } from "@/components/pos/order-payment";
import { FormGrid } from "@/components/form-layout";
import {
  AddIcon,
  CheckIcon,
  CloseIcon,
  DeleteIcon,
  EditIcon,
  EmptyIcon,
  MailIcon,
  SendIcon,
  TruckIcon,
} from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { ProductSearchResultItem } from "@/components/product-search-result-item";
import { QueryErrorState } from "@/components/query-error-state";
import { ScanInput } from "@/components/ScanInput";
import { RowActions } from "@/components/row-actions";
import { SalesDocumentActions } from "@/components/sales-document-actions";
import {
  SalesOrderCustomerSelect,
  type SalesOrderCustomerOption,
} from "@/components/sales-order-customer-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { PriceInput } from "@/components/ui/price-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
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
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { currencySourceWithFallback, formatKgsMoney, resolveCurrency } from "@/lib/currencyDisplay";
import {
  isValidOptionalCustomerAddress,
  isValidOptionalCustomerPhone,
} from "@/lib/customerContact";
import { formatDate } from "@/lib/i18nFormat";
import { getCustomerOrderStatusLabel } from "@/lib/i18n/status";
import { parseSalesOrderPriceInput, salesOrderPriceInput } from "@/lib/salesOrderPriceInput";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import type { ScanResolvedResult } from "@/lib/scanning/scanRouter";

type ProductSearchResult = {
  id: string;
  name: string;
  sku: string;
  isBundle?: boolean;
};

type ManualOrderEmailType = "CONFIRMATION" | "TRACKING";
type InlineLineField = "qty" | "price";
type InlineLineDraft = Partial<Record<InlineLineField, string>>;
type DeclinedLineTarget = {
  lineId: string;
  name: string;
  expectedUpdatedAt: string;
  idempotencyKey: string;
  status: CustomerOrderStatus;
  lastLine: boolean;
};

const createIdempotencyKey = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `sales-order-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const statusVariant = (
  status: CustomerOrderStatus,
): "default" | "success" | "warning" | "danger" => {
  switch (status) {
    case CustomerOrderStatus.COMPLETED:
      return "success";
    case CustomerOrderStatus.CANCELED:
      return "danger";
    case CustomerOrderStatus.READY:
      return "warning";
    default:
      return "default";
  }
};

const sourceVariant = (source?: string | null): "warning" | "success" | "muted" =>
  source === "API" ? "success" : source === "CATALOG" ? "warning" : "muted";

const ProductImageThumb = ({ imageUrl, name }: { imageUrl?: string | null; name: string }) => {
  const fallbackLabel = name.trim().charAt(0).toUpperCase() || "#";

  if (imageUrl) {
    return (
      <Image
        src={imageUrl}
        alt={name}
        width={40}
        height={40}
        unoptimized
        className="h-10 w-10 shrink-0 rounded-md border border-border object-cover"
      />
    );
  }

  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-secondary/60 text-xs font-medium text-muted-foreground">
      {fallbackLabel}
    </div>
  );
};

const SalesOrderDetailPage = () => {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const customerOrderId = String(params?.id ?? "");
  const requestedReturnTo = searchParams.get("returnTo");
  const returnTo =
    requestedReturnTo === "/sales/orders" || requestedReturnTo?.startsWith("/sales/orders?")
      ? requestedReturnTo
      : "/sales/orders";

  const t = useTranslations("salesOrders");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const tLoyalty = useTranslations("loyalty");
  const locale = useLocale();
  const { data: session } = useSession();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const utils = trpc.useUtils();
  const sourceLabel = (source?: string | null) =>
    source === "API"
      ? t("source.api")
      : source === "CATALOG"
        ? t("source.catalog")
        : t("source.manual");

  const canFinalize = session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";
  const canManualPrice = ["ADMIN", "MANAGER", "STAFF", "CASHIER"].some(
    (role) => role === session?.user?.role,
  );

  const orderQuery = trpc.salesOrders.getById.useQuery(
    { customerOrderId },
    { enabled: Boolean(customerOrderId) },
  );
  const orderStore = orderQuery.data?.store ?? null;
  const orderCurrencySource = currencySourceWithFallback(orderQuery.data, orderStore);
  const { currencyCode: orderCurrencyCode } = resolveCurrency(orderCurrencySource);

  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerSelectionTouched, setCustomerSelectionTouched] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<SalesOrderCustomerOption | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingCarrier, setTrackingCarrier] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [trackingStatus, setTrackingStatus] = useState("");
  const customerSnapshotRef = useRef<string | null>(null);
  const trackingSnapshotRef = useRef<string | null>(null);

  const [lineDialogMode, setLineDialogMode] = useState<"add" | "edit" | null>(null);
  const [lineSearch, setLineSearch] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductSearchResult | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<string>("BASE");
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [lineQtyInput, setLineQtyInput] = useState<string>("1");
  const [linePriceInput, setLinePriceInput] = useState("");
  const [linePriceEdited, setLinePriceEdited] = useState(false);
  const lineQtyInputRef = useRef<HTMLInputElement | null>(null);
  const lineSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [inlineDrafts, setInlineDrafts] = useState<Record<string, InlineLineDraft>>({});
  const inlineDraftsRef = useRef<Record<string, InlineLineDraft>>({});
  const inlineInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const inlinePendingRef = useRef(new Set<string>());
  const [inlinePending, setInlinePending] = useState<string[]>([]);
  const [declinedLine, setDeclinedLine] = useState<DeclinedLineTarget | null>(null);
  const [declinedReason, setDeclinedReason] = useState("");
  const [confirmCancelLastLine, setConfirmCancelLastLine] = useState(false);
  const [declinedSubmitted, setDeclinedSubmitted] = useState(false);
  const declinedRequestRef = useRef<{
    customerOrderId: string;
    lineId: string;
    expectedUpdatedAt: string;
    idempotencyKey: string;
    reason: string;
    confirmCancelLastLine: boolean;
  } | null>(null);
  const postSaleKeyRef = useRef<{ orderId: string; key: string } | null>(null);

  const productSearchQuery = trpc.products.searchQuick.useQuery(
    { q: lineSearch.trim(), storeId: orderStore?.id, limit: 25 },
    {
      enabled: lineDialogMode === "add" && Boolean(orderStore?.id) && lineSearch.trim().length >= 1,
    },
  );

  const selectedProductQuery = trpc.products.getById.useQuery(
    { productId: selectedProduct?.id ?? "" },
    { enabled: lineDialogMode === "add" && Boolean(selectedProduct?.id) },
  );

  const linePriceQuery = trpc.salesOrders.linePrice.useQuery(
    {
      productId: selectedProduct?.id ?? "",
      storeId: orderStore?.id ?? "",
      variantId: selectedVariant === "BASE" ? null : selectedVariant,
    },
    {
      enabled: lineDialogMode === "add" && Boolean(selectedProduct?.id) && Boolean(orderStore?.id),
      keepPreviousData: false,
      retry: false,
    },
  );
  const manualLinePrice = linePriceEdited
    ? parseSalesOrderPriceInput(linePriceInput, orderCurrencySource)
    : null;
  const hasManualLinePrice = canManualPrice && linePriceEdited && manualLinePrice !== null;
  const displayedLinePriceInput =
    lineDialogMode === "add" && !linePriceEdited
      ? linePriceQuery.data
        ? salesOrderPriceInput(linePriceQuery.data.unitPriceKgs, orderCurrencySource)
        : ""
      : linePriceInput;

  const order = orderQuery.data;
  const paymentInfoQuery = trpc.salesOrders.paymentInfo.useQuery(
    { customerOrderId },
    { enabled: Boolean(order && canFinalize && order.status === CustomerOrderStatus.COMPLETED) },
  );
  const loyaltyQuery = trpc.loyalty.orderSummary.useQuery(
    { customerOrderId: String(params.id ?? "") },
    { enabled: Boolean(params.id), retry: false },
  );
  const lines = useMemo(() => order?.lines ?? [], [order?.lines]);

  const isEditable =
    order?.status === CustomerOrderStatus.DRAFT || order?.status === CustomerOrderStatus.CONFIRMED;

  useEffect(() => {
    if (!order) {
      return;
    }
    const customerSnapshot = JSON.stringify([
      order.id,
      order.customerId,
      order.customerName,
      order.customerEmail,
      order.customerPhone,
      order.customerAddress,
      order.notes,
    ]);
    if (customerSnapshotRef.current !== customerSnapshot) {
      customerSnapshotRef.current = customerSnapshot;
      setCustomerId(order.customerId ?? null);
      setCustomerSelectionTouched(false);
      setSelectedCustomer(null);
      setCustomerName(order.customerName ?? "");
      setCustomerEmail(order.customerEmail ?? "");
      setCustomerPhone(order.customerPhone ?? "");
      setCustomerAddress(order.customerAddress ?? "");
      setNotes(order.notes ?? "");
    }
    const trackingSnapshot = JSON.stringify([
      order.id,
      order.trackingNumber,
      order.trackingCarrier,
      order.trackingUrl,
      order.trackingStatus,
    ]);
    if (trackingSnapshotRef.current !== trackingSnapshot) {
      trackingSnapshotRef.current = trackingSnapshot;
      setTrackingNumber(order.trackingNumber ?? "");
      setTrackingCarrier(order.trackingCarrier ?? "");
      setTrackingUrl(order.trackingUrl ?? "");
      setTrackingStatus(order.trackingStatus ?? "");
    }
  }, [order]);

  const refetchAll = async (updatedOrder?: { id: string }) => {
    if (updatedOrder) {
      utils.salesOrders.getById.setData({ customerOrderId: updatedOrder.id }, (current) =>
        current ? { ...current, ...updatedOrder } : current,
      );
    }
    await Promise.all([
      utils.salesOrders.list.invalidate(),
      utils.salesOrders.getById.invalidate({ customerOrderId }),
      utils.salesOrders.paymentInfo.invalidate({ customerOrderId }),
      utils.loyalty.orderSummary.invalidate({ customerOrderId }),
    ]);
  };

  const setCustomerMutation = trpc.salesOrders.setCustomer.useMutation({
    onSuccess: async (updatedOrder) => {
      await refetchAll(updatedOrder);
      toast({ variant: "success", description: t("customerUpdated") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const saveTrackingMutation = trpc.salesOrders.updateTracking.useMutation({
    onSuccess: async (result) => {
      await refetchAll(result.order);
      toast({ variant: "success", description: t("trackingUpdated") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const saveTrackingBeforeSendMutation = trpc.salesOrders.updateTracking.useMutation({
    onSuccess: async (result) => {
      // Keep every list view coherent even if the subsequent provider send fails.
      await refetchAll(result.order);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const sendEmailMutation = trpc.salesOrders.sendEmail.useMutation({
    onSuccess: async (_result, variables) => {
      await refetchAll();
      toast({
        variant: "success",
        description:
          variables.type === CustomerOrderEmailType.CONFIRMATION
            ? t("confirmationEmailSent")
            : t("trackingEmailSent"),
      });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const addLineMutation = trpc.salesOrders.addLine.useMutation({
    onSuccess: async () => {
      await refetchAll();
      setSelectedProduct(null);
      setSelectedVariant("BASE");
      setLineQtyInput("1");
      setLinePriceInput("");
      setLinePriceEdited(false);
      setShowResults(true);
      window.requestAnimationFrame(() => lineSearchInputRef.current?.focus());
      toast({ variant: "success", description: t("lineAdded") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const updateLineMutation = trpc.salesOrders.updateLine.useMutation({
    onSuccess: async () => {
      await refetchAll();
      closeLineDialog();
      toast({ variant: "success", description: t("lineUpdated") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const inlineLineMutation = trpc.salesOrders.updateLine.useMutation({
    onSuccess: async () => {
      await refetchAll();
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const postSaleMutation = trpc.salesOrders.postSale.useMutation({
    onSuccess: async (result) => {
      postSaleKeyRef.current = null;
      await refetchAll(result);
      toast({ variant: "success", description: t("fastSale.posted") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const removeDeclinedLineMutation = trpc.salesOrders.removeDeclinedLine.useMutation({
    onSuccess: async (result) => {
      setDeclinedLine(null);
      setDeclinedReason("");
      setConfirmCancelLastLine(false);
      setDeclinedSubmitted(false);
      declinedRequestRef.current = null;
      await refetchAll();
      if (result.replacementId) {
        toast({
          variant: "success",
          description: t("fastSale.corrected", { number: result.replacementNumber ?? "" }),
        });
        router.push(
          `/sales/orders/${encodeURIComponent(result.replacementId)}?${new URLSearchParams({ returnTo })}`,
        );
      } else {
        toast({
          variant: "success",
          description: t(
            result.status === CustomerOrderStatus.CANCELED
              ? "fastSale.cancelledLastLine"
              : "lineRemoved",
          ),
        });
      }
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const removeLineMutation = trpc.salesOrders.removeLine.useMutation({
    onSuccess: async () => {
      await refetchAll();
      toast({ variant: "success", description: t("lineRemoved") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const confirmMutation = trpc.salesOrders.confirm.useMutation({
    onSuccess: async (updatedOrder) => {
      await refetchAll(updatedOrder);
      toast({ variant: "success", description: t("confirmSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const markReadyMutation = trpc.salesOrders.markReady.useMutation({
    onSuccess: async (updatedOrder) => {
      await refetchAll(updatedOrder);
      toast({ variant: "success", description: t("readySuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const cancelMutation = trpc.salesOrders.cancel.useMutation({
    onSuccess: async (result) => {
      await refetchAll(result.order);
      if (result.cancellationEmail?.status === "sent") {
        toast({ variant: "success", description: t("cancelSuccessEmailSent") });
        return;
      }
      if (
        result.cancellationEmail?.status === "skipped" &&
        result.cancellationEmail.reason === "missingEmail"
      ) {
        toast({ variant: "info", description: t("cancelSuccessEmailSkipped") });
        return;
      }
      if (result.cancellationEmail?.status === "failed") {
        toast({ variant: "error", description: t("cancelSuccessEmailFailed") });
        return;
      }
      toast({ variant: "success", description: t("cancelSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const closeLineDialog = () => {
    setLineDialogMode(null);
    setLineSearch("");
    setShowResults(false);
    setSelectedProduct(null);
    setSelectedVariant("BASE");
    setEditingLineId(null);
    setLineQtyInput("1");
    setLinePriceInput("");
    setLinePriceEdited(false);
  };

  const openAddLineDialog = () => {
    setLineDialogMode("add");
    setLineSearch("");
    setShowResults(false);
    setSelectedProduct(null);
    setSelectedVariant("BASE");
    setEditingLineId(null);
    setLineQtyInput("1");
    setLinePriceInput("");
    setLinePriceEdited(false);
  };

  const openEditLineDialog = (lineId: string) => {
    const line = lines.find((item) => item.id === lineId);
    if (!line) {
      return;
    }
    setLineDialogMode("edit");
    setLineSearch(line.product.name);
    setSelectedProduct({
      id: line.productId,
      name: line.product.name,
      sku: line.product.sku,
      isBundle: line.product.isBundle,
    });
    setSelectedVariant(line.variantId ?? "BASE");
    setEditingLineId(line.id);
    setLineQtyInput(String(line.qty));
    setLinePriceInput(salesOrderPriceInput(line.unitPriceKgs, orderCurrencySource));
    setLinePriceEdited(false);
  };

  const chooseCustomer = (customer: SalesOrderCustomerOption | null) => {
    setCustomerId(customer?.id ?? null);
    setCustomerSelectionTouched(true);
    setSelectedCustomer(customer);
    setCustomerName(customer?.name ?? "");
    setCustomerEmail(customer?.email ?? "");
    setCustomerPhone(customer?.phone ?? "");
    setCustomerAddress(customer?.address ?? "");
  };

  const validateCustomerContacts = () => {
    const baseline =
      selectedCustomer?.id === customerId
        ? selectedCustomer
        : customerId === (order?.customerId ?? null)
          ? { phone: order?.customerPhone, address: order?.customerAddress }
          : null;
    if (
      !isValidOptionalCustomerPhone(customerPhone) &&
      customerPhone.trim() !== (baseline?.phone?.trim() ?? "")
    ) {
      toast({ variant: "error", description: tErrors("customerPhoneInvalid") });
      return false;
    }
    if (
      !isValidOptionalCustomerAddress(customerAddress) &&
      customerAddress.trim() !== (baseline?.address?.trim() ?? "")
    ) {
      toast({ variant: "error", description: tErrors("customerAddressInvalid") });
      return false;
    }
    return true;
  };

  const handleSaveCustomer = async () => {
    if (!order || !validateCustomerContacts()) {
      return;
    }
    await setCustomerMutation.mutateAsync({
      customerOrderId: order.id,
      ...(customerSelectionTouched || customerId ? { customerId } : {}),
      customerName: customerName.trim() || null,
      customerEmail: customerEmail.trim() || null,
      customerPhone: customerPhone.trim() || null,
      customerAddress: customerAddress.trim() || null,
      notes: notes.trim() || null,
    });
  };

  const optionalFormValue = (value?: string | null) => {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  };

  const trackingMutationInput = (customerOrderId: string) => ({
    customerOrderId,
    trackingNumber: optionalFormValue(trackingNumber),
    trackingCarrier: optionalFormValue(trackingCarrier),
    trackingUrl: optionalFormValue(trackingUrl),
    trackingStatus: optionalFormValue(trackingStatus),
  });

  const handleSaveTracking = async () => {
    if (!order) {
      return;
    }
    await saveTrackingMutation.mutateAsync(trackingMutationInput(order.id));
  };

  const handleSendEmail = async (type: ManualOrderEmailType) => {
    if (!order) {
      return;
    }
    await sendEmailMutation.mutateAsync({
      customerOrderId: order.id,
      type,
    });
  };

  const handleSendTrackingEmail = async () => {
    if (!order || !validateCustomerContacts()) {
      return;
    }
    const customerInput = {
      customerOrderId: order.id,
      ...(customerSelectionTouched || customerId ? { customerId } : {}),
      customerName: optionalFormValue(customerName),
      customerEmail: optionalFormValue(customerEmail),
      customerPhone: optionalFormValue(customerPhone),
      customerAddress: optionalFormValue(customerAddress),
      notes: optionalFormValue(notes),
    };
    const trackingInput = trackingMutationInput(order.id);
    const shouldSaveCustomer =
      (customerSelectionTouched && customerId !== (order.customerId ?? null)) ||
      customerInput.customerName !== optionalFormValue(order.customerName) ||
      customerInput.customerEmail !== optionalFormValue(order.customerEmail) ||
      customerInput.customerPhone !== optionalFormValue(order.customerPhone) ||
      customerInput.customerAddress !== optionalFormValue(order.customerAddress) ||
      customerInput.notes !== optionalFormValue(order.notes);
    const shouldSaveTracking =
      trackingInput.trackingNumber !== optionalFormValue(order.trackingNumber) ||
      trackingInput.trackingCarrier !== optionalFormValue(order.trackingCarrier) ||
      trackingInput.trackingUrl !== optionalFormValue(order.trackingUrl) ||
      trackingInput.trackingStatus !== optionalFormValue(order.trackingStatus);

    if (!trackingInput.trackingNumber) {
      toast({ variant: "error", description: tErrors("trackingNumberMissing") });
      return;
    }
    if (!customerInput.customerEmail) {
      toast({ variant: "error", description: tErrors("customerEmailMissing") });
      return;
    }
    if (shouldSaveCustomer) {
      await setCustomerMutation.mutateAsync(customerInput);
    }
    if (shouldSaveTracking) {
      await saveTrackingBeforeSendMutation.mutateAsync(trackingInput);
    }
    await sendEmailMutation.mutateAsync({
      customerOrderId: order.id,
      type: CustomerOrderEmailType.TRACKING,
    });
  };

  const handleSubmitLine = async () => {
    if (!order) {
      return;
    }
    const normalizedQty = parseQuantity(lineQtyInput);
    if (!lineQtyInput.trim() || normalizedQty === null || normalizedQty <= 0) {
      toast({ variant: "error", description: t("qtyPositive") });
      return;
    }
    const qty = normalizedQty;
    if (linePriceEdited && !hasManualLinePrice) {
      toast({ variant: "error", description: t("unitPriceInvalid") });
      return;
    }
    const priceInput =
      hasManualLinePrice && manualLinePrice !== null ? { unitPriceKgs: manualLinePrice } : {};

    if (lineDialogMode === "edit" && editingLineId) {
      await updateLineMutation.mutateAsync({
        lineId: editingLineId,
        qty,
        ...priceInput,
      });
      return;
    }

    if (!selectedProduct) {
      toast({ variant: "error", description: t("productRequired") });
      return;
    }
    if (
      !hasManualLinePrice &&
      (linePriceQuery.isFetching || linePriceQuery.error || !linePriceQuery.data)
    ) {
      toast({ variant: "error", description: t("priceNotSetBlocking") });
      return;
    }

    await addLineMutation.mutateAsync({
      customerOrderId: order.id,
      productId: selectedProduct.id,
      variantId: selectedVariant === "BASE" ? null : selectedVariant,
      qty,
      ...priceInput,
    });
  };

  const setInlineDraftValue = (lineId: string, field: InlineLineField, value?: string) => {
    const draft = { ...inlineDraftsRef.current[lineId] };
    if (value === undefined) delete draft[field];
    else draft[field] = value;
    const next = { ...inlineDraftsRef.current, [lineId]: draft };
    inlineDraftsRef.current = next;
    setInlineDrafts(next);
  };

  const saveInlineLine = async (lineId: string, field: InlineLineField) => {
    const line = lines.find((item) => item.id === lineId);
    const raw = inlineDraftsRef.current[lineId]?.[field];
    if (raw === undefined) return true;
    if (!isEditable || !line || (field === "price" && !canManualPrice)) return false;
    const value =
      field === "qty" ? parseQuantity(raw) : parseSalesOrderPriceInput(raw, orderCurrencySource);
    if (value === null || (field === "qty" && value <= 0)) {
      toast({
        variant: "error",
        description: t(field === "qty" ? "qtyPositive" : "unitPriceInvalid"),
      });
      return false;
    }
    if (value === (field === "qty" ? line.qty : line.unitPriceKgs)) {
      setInlineDraftValue(lineId, field);
      return true;
    }
    const pendingKey = `${lineId}:${field}`;
    if (inlinePendingRef.current.has(pendingKey)) return false;
    inlinePendingRef.current.add(pendingKey);
    setInlinePending([...inlinePendingRef.current]);
    try {
      await inlineLineMutation.mutateAsync({
        lineId,
        ...(field === "qty" ? { qty: value } : { unitPriceKgs: value }),
      });
      if (inlineDraftsRef.current[lineId]?.[field] === raw) setInlineDraftValue(lineId, field);
      return true;
    } catch {
      return false;
    } finally {
      inlinePendingRef.current.delete(pendingKey);
      setInlinePending([...inlinePendingRef.current]);
    }
  };

  const handleInlineKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    lineId: string,
    field: InlineLineField,
    layout: "desktop" | "mobile",
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setInlineDraftValue(lineId, field);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    void saveInlineLine(lineId, field).then((saved) => {
      if (!saved) return;
      const nextLine = lines[lines.findIndex((line) => line.id === lineId) + 1];
      if (!nextLine) return;
      window.requestAnimationFrame(() => {
        const input = inlineInputRefs.current[`${layout}:${nextLine.id}:${field}`];
        input?.focus();
        input?.select();
      });
    });
  };

  const renderInlineLineInput = (
    lineId: string,
    field: InlineLineField,
    layout: "desktop" | "mobile",
  ) => {
    const line = lines.find((item) => item.id === lineId);
    if (!line) return null;
    const raw = inlineDrafts[lineId]?.[field];
    const value =
      raw ??
      (field === "qty"
        ? String(line.qty)
        : salesOrderPriceInput(line.unitPriceKgs, orderCurrencySource));
    const parsed =
      raw === undefined
        ? undefined
        : field === "qty"
          ? parseQuantity(raw)
          : parseSalesOrderPriceInput(raw, orderCurrencySource);
    const invalid =
      raw !== undefined && (parsed === null || (field === "qty" && (parsed ?? 0) <= 0));
    const pending = inlinePending.includes(`${lineId}:${field}`);
    const props = {
      value,
      ref: (element: HTMLInputElement | null) => {
        inlineInputRefs.current[`${layout}:${lineId}:${field}`] = element;
      },
      className: layout === "desktop" ? "h-9 w-28 min-w-0" : "h-10 w-full min-w-0",
      disabled: pending || postSaleMutation.isLoading || removeDeclinedLineMutation.isLoading,
      "aria-label": `${t(field === "qty" ? "qty" : "unitPrice")}: ${line.product.name}`,
      "aria-invalid": invalid,
      onChange: (event: ChangeEvent<HTMLInputElement>) =>
        setInlineDraftValue(lineId, field, event.target.value),
      onBlur: () => {
        void saveInlineLine(lineId, field);
      },
      onKeyDown: (event: KeyboardEvent<HTMLInputElement>) =>
        handleInlineKeyDown(event, lineId, field, layout),
    };
    return (
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-1">
          {field === "price" ? (
            <PriceInput {...props} />
          ) : (
            <Input {...props} type="text" inputMode="decimal" />
          )}
          {pending ? <Spinner className="h-3 w-3 shrink-0" /> : null}
        </div>
        {invalid ? (
          <p className="max-w-48 text-xs text-danger">
            {t(field === "qty" ? "qtyPositive" : "unitPriceInvalid")}
          </p>
        ) : null}
      </div>
    );
  };

  const handlePostSale = async () => {
    if (
      !order ||
      !canFinalize ||
      !lines.length ||
      inlinePendingRef.current.size ||
      postSaleMutation.isLoading
    )
      return;
    for (const line of lines) {
      for (const field of ["qty", "price"] as const) {
        if (!(await saveInlineLine(line.id, field))) return;
      }
    }
    if (!(await confirm({ description: t("fastSale.confirmPost") }))) return;
    if (postSaleKeyRef.current?.orderId !== order.id)
      postSaleKeyRef.current = { orderId: order.id, key: createIdempotencyKey() };
    try {
      await postSaleMutation.mutateAsync({
        customerOrderId: order.id,
        idempotencyKey: postSaleKeyRef.current.key,
      });
    } catch {
      // The same key remains available for a safe retry after an uncertain response.
    }
  };

  const openDeclinedLineDialog = (lineId: string) => {
    if (!order || !canFinalize || inlinePendingRef.current.size) return;
    const line = lines.find((item) => item.id === lineId);
    if (!line) return;
    removeDeclinedLineMutation.reset();
    setDeclinedReason("");
    setConfirmCancelLastLine(false);
    setDeclinedSubmitted(false);
    declinedRequestRef.current = null;
    if (order.status === CustomerOrderStatus.COMPLETED) void paymentInfoQuery.refetch();
    setDeclinedLine({
      lineId,
      name: [line.product.name, line.variant?.name].filter(Boolean).join(" · "),
      expectedUpdatedAt: order.updatedAt.toISOString(),
      idempotencyKey: createIdempotencyKey(),
      status: order.status,
      lastLine: lines.length === 1,
    });
  };

  const handleRemoveDeclinedLine = async () => {
    if (!order || !declinedLine || !declinedReason.trim() || removeDeclinedLineMutation.isLoading)
      return;
    if (declinedLine.lastLine && !confirmCancelLastLine) return;
    if (
      declinedLine.status === CustomerOrderStatus.COMPLETED &&
      (paymentInfoQuery.isFetching || !paymentInfoQuery.data || paymentInfoQuery.data.hasEvidence)
    )
      return;
    declinedRequestRef.current ??= {
      customerOrderId: order.id,
      lineId: declinedLine.lineId,
      expectedUpdatedAt: declinedLine.expectedUpdatedAt,
      idempotencyKey: declinedLine.idempotencyKey,
      reason: declinedReason.trim(),
      confirmCancelLastLine,
    };
    setDeclinedSubmitted(true);
    try {
      await removeDeclinedLineMutation.mutateAsync(declinedRequestRef.current);
    } catch {
      // Keep the reviewed snapshot and operation key for a safe retry.
    }
  };

  const handleConfirm = async () => {
    if (!order) {
      return;
    }
    if (!(await confirm({ description: t("confirmSubmit") }))) {
      return;
    }
    await confirmMutation.mutateAsync({ customerOrderId: order.id });
  };

  const handleMarkReady = async () => {
    if (!order) {
      return;
    }
    if (!(await confirm({ description: t("confirmMarkReady") }))) {
      return;
    }
    await markReadyMutation.mutateAsync({ customerOrderId: order.id });
  };

  const handleCancel = async () => {
    if (!order) {
      return;
    }
    if (
      !(await confirm({
        description: t("confirmCancel"),
        confirmVariant: "danger",
      }))
    ) {
      return;
    }
    await cancelMutation.mutateAsync({ customerOrderId: order.id });
  };

  const lineActionsDisabled =
    addLineMutation.isLoading ||
    updateLineMutation.isLoading ||
    removeLineMutation.isLoading ||
    inlinePending.length > 0 ||
    removeDeclinedLineMutation.isLoading ||
    postSaleMutation.isLoading;
  const trackingActionsDisabled =
    !canFinalize ||
    saveTrackingMutation.isLoading ||
    saveTrackingBeforeSendMutation.isLoading ||
    sendEmailMutation.isLoading;
  const formatOptionalDate = (value?: Date | null) =>
    value ? formatDate(value, locale) : tCommon("notAvailable");

  const canCancel =
    canFinalize &&
    (order?.status === CustomerOrderStatus.DRAFT ||
      order?.status === CustomerOrderStatus.CONFIRMED ||
      order?.status === CustomerOrderStatus.READY);
  const canCorrectDeclinedLine =
    canFinalize &&
    Boolean(
      order &&
        order.source === "MANUAL" &&
        !order.isHeld && !order.registerId && !order.shiftId &&
        (order.status === CustomerOrderStatus.READY || order.status === CustomerOrderStatus.COMPLETED),
    );

  const selectedProductVariants = selectedProductQuery.data?.variants ?? [];

  const applySelectedProduct = (product: ProductSearchResult) => {
    setSelectedProduct(product);
    setSelectedVariant("BASE");
    setLinePriceInput("");
    setLinePriceEdited(false);
    setShowResults(false);
    window.setTimeout(() => lineQtyInputRef.current?.focus(), 0);
  };

  const handleLineScanResolved = async (result: ScanResolvedResult): Promise<boolean> => {
    if (lineDialogMode !== "add") {
      return false;
    }
    if (result.kind === "notFound") {
      toast({ variant: "info", description: tCommon("nothingFound") });
      return false;
    }
    if (result.kind === "multiple") {
      setShowResults(true);
      return true;
    }
    applySelectedProduct({
      id: result.item.id,
      name: result.item.name,
      sku: result.item.sku,
      isBundle: result.item.type === "bundle",
    });
    return true;
  };

  const loading = orderQuery.isLoading;
  const error = orderQuery.error ? translateError(tErrors, orderQuery.error) : null;

  const currentLine = useMemo(
    () => lines.find((line) => line.id === editingLineId) ?? null,
    [editingLineId, lines],
  );

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" asChild>
        <Link href={returnTo}>{tCommon("back")}</Link>
      </Button>
      {order ? <SalesDocumentActions orderId={order.id} number={order.number} /> : null}
      {canCancel ? (
        <Button
          onClick={() => void handlePostSale()}
          disabled={lineActionsDisabled || !lines.length}
        >
          {postSaleMutation.isLoading ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <CheckIcon className="h-4 w-4" aria-hidden />
          )}
          {order?.status === CustomerOrderStatus.READY ? t("complete") : t("fastSale.post")}
        </Button>
      ) : null}
      {order?.status === CustomerOrderStatus.DRAFT ? (
        <Button
          variant="secondary"
          onClick={() => void handleConfirm()}
          disabled={confirmMutation.isLoading || lineActionsDisabled || !lines.length}
        >
          {confirmMutation.isLoading ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <CheckIcon className="h-4 w-4" aria-hidden />
          )}
          {t("confirmOrder")}
        </Button>
      ) : null}
      {order?.status === CustomerOrderStatus.CONFIRMED ? (
        <Button
          variant="secondary"
          onClick={() => void handleMarkReady()}
          disabled={markReadyMutation.isLoading || lineActionsDisabled}
        >
          {markReadyMutation.isLoading ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <CheckIcon className="h-4 w-4" aria-hidden />
          )}
          {t("markReady")}
        </Button>
      ) : null}
      {canCancel ? (
        <Button
          variant="danger"
          onClick={() => void handleCancel()}
          disabled={cancelMutation.isLoading || lineActionsDisabled}
        >
          {cancelMutation.isLoading ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <CloseIcon className="h-4 w-4" aria-hidden />
          )}
          {t("cancel")}
        </Button>
      ) : null}
    </div>
  );

  return (
    <div>
      <PageHeader
        title={t("detailsTitle")}
        subtitle={t("detailsSubtitle")}
        action={headerActions}
      />
      {isEditable ? (
        <p className="mb-4 text-sm text-muted-foreground">{t("orderWithoutShift")}</p>
      ) : null}

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {tCommon("loading")}
        </div>
      ) : null}

      {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}

      {!loading && !error && !order ? (
        <p className="mt-4 text-sm text-danger">{t("notFound")}</p>
      ) : null}

      {order ? (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span>{order.number}</span>
                <div className="flex items-center gap-2">
                  <Badge variant={sourceVariant(order.source)}>{sourceLabel(order.source)}</Badge>
                  <Badge variant={statusVariant(order.status)}>
                    {getCustomerOrderStatusLabel(t, order.status)}
                  </Badge>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FormGrid>
                <div>
                  <p className="text-xs text-muted-foreground">{t("store")}</p>
                  <p className="text-sm font-medium text-foreground">{order.store.name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("created")}</p>
                  <p className="text-sm font-medium text-foreground">
                    {formatDate(order.createdAt, locale)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("sourceLabel")}</p>
                  <p className="text-sm font-medium text-foreground">{sourceLabel(order.source)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("subtotal")}</p>
                  <p className="text-sm font-medium text-foreground">
                    {formatKgsMoney(order.subtotalKgs, locale, orderCurrencySource)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("total")}</p>
                  <p className="text-sm font-medium text-foreground">
                    {formatKgsMoney(order.totalKgs, locale, orderCurrencySource)}
                  </p>
                </div>
              </FormGrid>
            </CardContent>
          </Card>

          <div id="sales-order-payments">
            <OrderPayment
              customerOrderId={order.id}
              onPaid={() => {
                void loyaltyQuery.refetch();
              }}
            />
          </div>
          {loyaltyQuery.data ? (
            <Card>
              <CardHeader>
                <CardTitle>{tLoyalty("orderBlockTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <FormGrid>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {tLoyalty("loyaltyMemberDiscount")}
                    </p>
                    <p className="text-sm font-medium">
                      {formatKgsMoney(
                        loyaltyQuery.data.memberDiscountKgs,
                        locale,
                        orderCurrencySource,
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{tLoyalty("loyaltySpent")}</p>
                    <p className="text-sm font-medium tabular-nums">
                      {loyaltyQuery.data.pointsSpent}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {tLoyalty(loyaltyQuery.data.hasEarned ? "loyaltyEarned" : "willEarn")}
                    </p>
                    <p className="text-sm font-medium tabular-nums">
                      {loyaltyQuery.data.hasEarned
                        ? loyaltyQuery.data.pointsEarned
                        : loyaltyQuery.data.plannedPoints}
                    </p>
                  </div>
                </FormGrid>
                {loyaltyQuery.data.entries.length ? (
                  <ul className="divide-y divide-border text-sm">
                    {loyaltyQuery.data.entries.map((entry) => (
                      <li key={entry.id} className="flex items-center justify-between gap-3 py-2">
                        <span className="text-muted-foreground">
                          {tLoyalty(`ledger.${entry.type}` as never)}
                        </span>
                        <span
                          className={
                            entry.points < 0
                              ? "tabular-nums text-danger"
                              : "tabular-nums text-success"
                          }
                        >
                          {entry.points > 0 ? `+${entry.points}` : entry.points}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{t("customerSectionTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <p className="text-sm font-medium">
                  {t("customerCard")} ({tCommon("optional")})
                </p>
                <SalesOrderCustomerSelect
                  storeId={orderStore?.id ?? ""}
                  customerId={customerId}
                  customerName={customerName}
                  disabled={!isEditable || setCustomerMutation.isLoading}
                  onSelect={chooseCustomer}
                />
              </div>
              <FormGrid>
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">{t("customerName")}</p>
                  <Input
                    value={customerName}
                    onChange={(event) => setCustomerName(event.target.value)}
                    placeholder={t("customerNamePlaceholder")}
                    maxLength={160}
                    disabled={!isEditable || setCustomerMutation.isLoading}
                  />
                </div>
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">{t("customerEmail")}</p>
                  <Input
                    type="email"
                    value={customerEmail}
                    onChange={(event) => setCustomerEmail(event.target.value)}
                    placeholder={t("customerEmailPlaceholder")}
                    maxLength={254}
                    disabled={!isEditable || setCustomerMutation.isLoading}
                  />
                </div>
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">{t("customerPhone")}</p>
                  <Input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={customerPhone}
                    onChange={(event) => setCustomerPhone(event.target.value)}
                    placeholder={t("customerPhonePlaceholder")}
                    maxLength={64}
                    disabled={!isEditable || setCustomerMutation.isLoading}
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <p className="text-sm font-medium">{t("customerAddress")}</p>
                  <Input
                    value={customerAddress}
                    onChange={(event) => setCustomerAddress(event.target.value)}
                    placeholder={t("customerAddressPlaceholder")}
                    maxLength={512}
                    disabled={!isEditable || setCustomerMutation.isLoading}
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <p className="text-sm font-medium">{t("notes")}</p>
                  <Textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder={t("notesPlaceholder")}
                    maxLength={2000}
                    rows={4}
                    disabled={!isEditable || setCustomerMutation.isLoading}
                  />
                </div>
              </FormGrid>

              <div className="flex justify-end">
                <Button
                  variant="secondary"
                  onClick={() => void handleSaveCustomer()}
                  disabled={!isEditable || setCustomerMutation.isLoading}
                >
                  {setCustomerMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                  {t("saveCustomer")}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TruckIcon className="h-5 w-5 text-muted-foreground" aria-hidden />
                {t("trackingSectionTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormGrid>
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">{t("trackingNumber")}</p>
                  <Input
                    value={trackingNumber}
                    onChange={(event) => setTrackingNumber(event.target.value)}
                    placeholder={t("trackingNumberPlaceholder")}
                    maxLength={512}
                    disabled={trackingActionsDisabled}
                  />
                </div>
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">{t("trackingCarrier")}</p>
                  <Input
                    value={trackingCarrier}
                    onChange={(event) => setTrackingCarrier(event.target.value)}
                    placeholder={t("trackingCarrierPlaceholder")}
                    maxLength={512}
                    disabled={trackingActionsDisabled}
                  />
                </div>
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">{t("trackingStatus")}</p>
                  <Input
                    value={trackingStatus}
                    onChange={(event) => setTrackingStatus(event.target.value)}
                    placeholder={t("trackingStatusPlaceholder")}
                    maxLength={512}
                    disabled={trackingActionsDisabled}
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <p className="text-sm font-medium">{t("trackingUrl")}</p>
                  <Input
                    type="url"
                    value={trackingUrl}
                    onChange={(event) => setTrackingUrl(event.target.value)}
                    placeholder={t("trackingUrlPlaceholder")}
                    maxLength={512}
                    disabled={trackingActionsDisabled}
                  />
                </div>
              </FormGrid>

              {canFinalize ? (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => void handleSendTrackingEmail()}
                    disabled={trackingActionsDisabled}
                  >
                    {sendEmailMutation.isLoading || saveTrackingBeforeSendMutation.isLoading ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      <SendIcon className="h-4 w-4" aria-hidden />
                    )}
                    {t("sendTrackingEmail")}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => void handleSaveTracking()}
                    disabled={trackingActionsDisabled}
                  >
                    {saveTrackingMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                    {t("saveTracking")}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MailIcon className="h-5 w-5 text-muted-foreground" aria-hidden />
                {t("emailSectionTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormGrid>
                <div>
                  <p className="text-xs text-muted-foreground">{t("confirmationEmailSentAt")}</p>
                  <p className="text-sm font-medium text-foreground">
                    {formatOptionalDate(order.confirmationEmailSentAt)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("trackingEmailSentAt")}</p>
                  <p className="text-sm font-medium text-foreground">
                    {formatOptionalDate(order.trackingEmailSentAt)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("followUpEmailSentAt")}</p>
                  <p className="text-sm font-medium text-foreground">
                    {formatOptionalDate(order.followUpEmailSentAt)}
                  </p>
                </div>
              </FormGrid>

              {canFinalize ? (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => void handleSendEmail(CustomerOrderEmailType.CONFIRMATION)}
                    disabled={sendEmailMutation.isLoading}
                  >
                    {sendEmailMutation.isLoading ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      <MailIcon className="h-4 w-4" aria-hidden />
                    )}
                    {t("sendConfirmationEmail")}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{t("linesTitle")}</CardTitle>
              {isEditable ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={openAddLineDialog}
                  disabled={lineActionsDisabled}
                >
                  <AddIcon className="h-4 w-4" aria-hidden />
                  {t("addLine")}
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-3">
              {isEditable && lines.length ? (
                <p className="text-xs text-muted-foreground">{t("fastSale.inlineHint")}</p>
              ) : null}
              {!lines.length ? (
                <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  <EmptyIcon className="mx-auto mb-2 h-5 w-5" aria-hidden />
                  {t("noLines")}
                </div>
              ) : (
                <>
                  <div className="hidden overflow-x-auto md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("product")}</TableHead>
                          <TableHead>{t("variant")}</TableHead>
                          <TableHead>{t("qty")}</TableHead>
                          <TableHead>
                            {t("unitPrice")} · {orderCurrencyCode}
                          </TableHead>
                          <TableHead>{t("lineTotal")}</TableHead>
                          <TableHead className="text-right">{tCommon("actions")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lines.map((line) => (
                          <TableRow key={line.id}>
                            <TableCell>
                              <div className="flex min-w-[220px] items-center gap-3">
                                <ProductImageThumb
                                  imageUrl={
                                    line.product.photoUrl ?? line.product.images?.[0]?.url ?? null
                                  }
                                  name={line.product.name}
                                />
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-foreground">
                                    {line.product.name}
                                  </p>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {line.product.sku}
                                  </p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>{line.variant?.name ?? t("variantBase")}</TableCell>
                            <TableCell>
                              {isEditable
                                ? renderInlineLineInput(line.id, "qty", "desktop")
                                : line.qty}
                            </TableCell>
                            <TableCell>
                              {isEditable && canManualPrice
                                ? renderInlineLineInput(line.id, "price", "desktop")
                                : formatKgsMoney(line.unitPriceKgs, locale, orderCurrencySource)}
                            </TableCell>
                            <TableCell>
                              {formatKgsMoney(line.lineTotalKgs, locale, orderCurrencySource)}
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-end">
                                <RowActions
                                  moreLabel={tCommon("moreActions")}
                                  actions={[
                                    ...(isEditable
                                      ? [
                                          {
                                            key: "edit",
                                            label: t("editLine"),
                                            icon: EditIcon,
                                            onSelect: () => openEditLineDialog(line.id),
                                            disabled: lineActionsDisabled,
                                          },
                                          {
                                            key: "remove",
                                            label: t("removeLine"),
                                            icon: DeleteIcon,
                                            variant: "danger",
                                            onSelect: async () => {
                                              if (inlinePendingRef.current.size) return;
                                              if (
                                                !(await confirm({
                                                  description: t("confirmRemoveLine"),
                                                  confirmVariant: "danger",
                                                }))
                                              ) {
                                                return;
                                              }
                                              void removeLineMutation.mutateAsync({
                                                lineId: line.id,
                                              });
                                            },
                                            disabled: lineActionsDisabled,
                                          },
                                        ]
                                      : []),
                                    ...(canCorrectDeclinedLine
                                      ? [
                                          {
                                            key: "declined",
                                            label: t("fastSale.declinedAction"),
                                            icon: DeleteIcon,
                                            variant: "danger" as const,
                                            onSelect: () => openDeclinedLineDialog(line.id),
                                            disabled: lineActionsDisabled,
                                          },
                                        ]
                                      : []),
                                  ]}
                                />
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="space-y-3 md:hidden">
                    {lines.map((line) => (
                      <Card key={line.id} className="border-border">
                        <CardContent className="space-y-3 p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-3">
                              <ProductImageThumb
                                imageUrl={
                                  line.product.photoUrl ?? line.product.images?.[0]?.url ?? null
                                }
                                name={line.product.name}
                              />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-foreground">
                                  {line.product.name}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {line.product.sku}
                                </p>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {line.variant?.name ?? t("variantBase")}
                            </p>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                            <div>
                              <p>{t("qty")}</p>
                              {isEditable ? (
                                renderInlineLineInput(line.id, "qty", "mobile")
                              ) : (
                                <p className="font-medium text-foreground">{line.qty}</p>
                              )}
                            </div>
                            <div>
                              <p>
                                {t("unitPrice")} · {orderCurrencyCode}
                              </p>
                              {isEditable && canManualPrice ? (
                                renderInlineLineInput(line.id, "price", "mobile")
                              ) : (
                                <p className="font-medium text-foreground">
                                  {formatKgsMoney(line.unitPriceKgs, locale, orderCurrencySource)}
                                </p>
                              )}
                            </div>
                            <div>
                              <p>{t("lineTotal")}</p>
                              <p className="font-medium text-foreground">
                                {formatKgsMoney(line.lineTotalKgs, locale, orderCurrencySource)}
                              </p>
                            </div>
                          </div>
                          {isEditable || canCorrectDeclinedLine ? (
                            <div className="flex justify-end">
                              <RowActions
                                moreLabel={tCommon("moreActions")}
                                actions={[
                                  ...(isEditable
                                    ? [
                                        {
                                          key: "edit",
                                          label: t("editLine"),
                                          icon: EditIcon,
                                          onSelect: () => openEditLineDialog(line.id),
                                          disabled: lineActionsDisabled,
                                        },
                                        {
                                          key: "remove",
                                          label: t("removeLine"),
                                          icon: DeleteIcon,
                                          variant: "danger",
                                          onSelect: async () => {
                                            if (inlinePendingRef.current.size) return;
                                            if (
                                              !(await confirm({
                                                description: t("confirmRemoveLine"),
                                                confirmVariant: "danger",
                                              }))
                                            ) {
                                              return;
                                            }
                                            void removeLineMutation.mutateAsync({
                                              lineId: line.id,
                                            });
                                          },
                                          disabled: lineActionsDisabled,
                                        },
                                      ]
                                    : []),
                                  ...(canCorrectDeclinedLine
                                    ? [
                                        {
                                          key: "declined",
                                          label: t("fastSale.declinedAction"),
                                          icon: DeleteIcon,
                                          variant: "danger" as const,
                                          onSelect: () => openDeclinedLineDialog(line.id),
                                          disabled: lineActionsDisabled,
                                        },
                                      ]
                                    : []),
                                ]}
                              />
                            </div>
                          ) : null}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
      {confirmDialog}

      <Modal
        open={Boolean(declinedLine)}
        onOpenChange={(open) => {
          if (!open && !removeDeclinedLineMutation.isLoading) setDeclinedLine(null);
        }}
        title={t("fastSale.declinedTitle")}
        subtitle={declinedLine?.name}
      >
        {declinedLine ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t(
                declinedLine.status === CustomerOrderStatus.COMPLETED
                  ? "fastSale.declinedCompletedHint"
                  : "fastSale.declinedReadyHint",
              )}
            </p>
            {declinedLine.status === CustomerOrderStatus.COMPLETED &&
            paymentInfoQuery.isFetching ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <Spinner className="h-4 w-4" />
                {tCommon("loading")}
              </p>
            ) : declinedLine.status === CustomerOrderStatus.COMPLETED && paymentInfoQuery.error ? (
              <QueryErrorState
                error={paymentInfoQuery.error}
                onRetry={() => void paymentInfoQuery.refetch()}
              />
            ) : declinedLine.status === CustomerOrderStatus.COMPLETED &&
              paymentInfoQuery.data?.hasEvidence ? (
              <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                <p className="text-sm">{t("fastSale.paidRemovalBlocked")}</p>
                <Button variant="secondary" asChild onClick={() => setDeclinedLine(null)}>
                  <Link href="#sales-order-payments">{t("fastSale.openPayment")}</Link>
                </Button>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <label htmlFor="declined-line-reason" className="text-sm font-medium">
                {t("fastSale.reason")}
              </label>
              <Textarea
                id="declined-line-reason"
                value={declinedReason}
                onChange={(event) => setDeclinedReason(event.target.value)}
                placeholder={t("fastSale.reasonPlaceholder")}
                required
                maxLength={500}
                rows={3}
                disabled={declinedSubmitted || removeDeclinedLineMutation.isLoading}
              />
            </div>
            {declinedLine.lastLine ? (
              <div className="space-y-2 rounded-md border border-danger/30 p-3">
                <p className="text-sm text-danger">{t("fastSale.declinedLastLineHint")}</p>
                <label
                  htmlFor="declined-line-cancel-order"
                  className="flex items-start gap-2 text-sm"
                >
                  <Checkbox
                    id="declined-line-cancel-order"
                    className="mt-0.5"
                    checked={confirmCancelLastLine}
                    onCheckedChange={(value) => setConfirmCancelLastLine(value === true)}
                    disabled={declinedSubmitted || removeDeclinedLineMutation.isLoading}
                  />
                  <span>{t("fastSale.confirmCancelLastLine")}</span>
                </label>
              </div>
            ) : null}
            {removeDeclinedLineMutation.error ? (
              <div className="space-y-2">
                <p role="alert" className="text-sm text-danger">
                  {translateError(tErrors, removeDeclinedLineMutation.error)}
                </p>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDeclinedLine(null);
                    void refetchAll();
                  }}
                >
                  {t("fastSale.reload")}
                </Button>
              </div>
            ) : null}
            <ModalFooter>
              <Button
                variant="secondary"
                disabled={removeDeclinedLineMutation.isLoading}
                onClick={() => setDeclinedLine(null)}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                variant="danger"
                onClick={() => void handleRemoveDeclinedLine()}
                disabled={
                  removeDeclinedLineMutation.isLoading ||
                  !declinedReason.trim() ||
                  (declinedLine.lastLine && !confirmCancelLastLine) ||
                  (declinedLine.status === CustomerOrderStatus.COMPLETED &&
                    (paymentInfoQuery.isFetching ||
                      !paymentInfoQuery.data ||
                      Boolean(paymentInfoQuery.error) ||
                      paymentInfoQuery.data.hasEvidence))
                }
              >
                {removeDeclinedLineMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                {declinedSubmitted && removeDeclinedLineMutation.error
                  ? tCommon("tryAgain")
                  : t("fastSale.confirmDeclined")}
              </Button>
            </ModalFooter>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={lineDialogMode !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeLineDialog();
          }
        }}
        title={lineDialogMode === "edit" ? t("lineDialogEditTitle") : t("lineDialogAddTitle")}
        subtitle={t("lineDialogSubtitle")}
      >
        <div className="space-y-4">
          {lineDialogMode === "add" ? (
            <>
              <div className="space-y-1.5">
                <p className="text-sm font-medium">{t("product")}</p>
                <ScanInput
                  ref={lineSearchInputRef}
                  context="linePicker"
                  disabled={lineActionsDisabled}
                  value={lineSearch}
                  onValueChange={(nextValue) => {
                    setLineSearch(nextValue);
                    setShowResults(true);
                    if (selectedProduct && nextValue !== selectedProduct.name) {
                      setSelectedProduct(null);
                      setSelectedVariant("BASE");
                      setLinePriceInput("");
                      setLinePriceEdited(false);
                    }
                  }}
                  placeholder={t("productSearchPlaceholder")}
                  onFocus={() => setShowResults(true)}
                  ariaLabel={t("productSearchPlaceholder")}
                  supportsTabSubmit
                  showDropdown={false}
                  onResolved={handleLineScanResolved}
                />
                {showResults && lineSearch.trim().length >= 1 && !selectedProduct ? (
                  <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-background">
                    {productSearchQuery.isLoading ? (
                      <p className="px-3 py-3 text-sm text-muted-foreground">
                        {tCommon("loading")}
                      </p>
                    ) : productSearchQuery.error ? (
                      <QueryErrorState
                        error={productSearchQuery.error}
                        onRetry={() => void productSearchQuery.refetch()}
                        className="m-2"
                      />
                    ) : (productSearchQuery.data ?? []).length ? (
                      (productSearchQuery.data ?? []).map((product) => (
                        <ProductSearchResultItem
                          key={product.id}
                          product={product}
                          currencySource={orderCurrencySource}
                          onClick={() => {
                            applySelectedProduct({
                              id: product.id,
                              name: product.name,
                              sku: product.sku,
                              isBundle: product.isBundle,
                            });
                          }}
                        />
                      ))
                    ) : (
                      <p className="px-3 py-2 text-xs text-muted-foreground">
                        {tCommon("nothingFound")}
                      </p>
                    )}
                  </div>
                ) : null}
                {selectedProduct ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                      {t("selectedProduct", { sku: selectedProduct.sku })}
                    </span>
                    {selectedProduct.isBundle ? (
                      <Badge variant="muted">{t("bundleProductLabel")}</Badge>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("productSearchHint")}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <p className="text-sm font-medium">{t("variant")}</p>
                <Select
                  value={selectedVariant}
                  onValueChange={(value) => {
                    setSelectedVariant(value);
                    setLinePriceInput("");
                    setLinePriceEdited(false);
                  }}
                  disabled={!selectedProduct || lineActionsDisabled}
                >
                  <SelectTrigger aria-label={t("variant")}>
                    <SelectValue placeholder={t("variantPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BASE">{t("variantBase")}</SelectItem>
                    {selectedProductVariants.map((variant) => (
                      <SelectItem key={variant.id} value={variant.id}>
                        {variant.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedProductQuery.error ? (
                  <QueryErrorState
                    error={selectedProductQuery.error}
                    onRetry={() => void selectedProductQuery.refetch()}
                  />
                ) : null}
              </div>
            </>
          ) : (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <p className="break-words font-medium text-foreground [overflow-wrap:anywhere]">
                {selectedProduct?.name ?? currentLine?.product.name}
              </p>
              <p className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {selectedProduct?.sku ?? currentLine?.product.sku} ·{" "}
                {currentLine?.variant?.name ?? t("variantBase")}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="sales-order-line-qty" className="text-sm font-medium">
              {t("qty")}
            </label>
            <Input
              ref={lineQtyInputRef}
              id="sales-order-line-qty"
              type="text"
              inputMode="decimal"
              value={lineQtyInput}
              disabled={lineActionsDisabled}
              onChange={(event) => setLineQtyInput(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="sales-order-line-price" className="text-sm font-medium">
              {t("unitPrice")} · {orderCurrencyCode}
            </label>
            <PriceInput
              id="sales-order-line-price"
              value={displayedLinePriceInput}
              placeholder={t("priceNotSet")}
              disabled={
                lineActionsDisabled ||
                !canManualPrice ||
                (lineDialogMode === "add" && !selectedProduct)
              }
              aria-invalid={linePriceEdited && manualLinePrice === null}
              aria-describedby="sales-order-line-price-hint"
              onChange={(event) => {
                setLinePriceInput(event.target.value);
                setLinePriceEdited(true);
              }}
            />
            <p id="sales-order-line-price-hint" className="text-xs text-muted-foreground">
              {t("documentPriceHint")}
            </p>
            {linePriceEdited && manualLinePrice === null ? (
              <p role="alert" className="text-xs text-danger">
                {t("unitPriceInvalid")}
              </p>
            ) : null}
            {lineDialogMode === "add" && selectedProduct ? (
              linePriceQuery.isFetching ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                  <Spinner className="h-3 w-3" />
                  {tCommon("loading")}
                </p>
              ) : linePriceQuery.error ? (
                <QueryErrorState
                  error={linePriceQuery.error}
                  onRetry={() => void linePriceQuery.refetch()}
                />
              ) : !linePriceQuery.data ? (
                <p className="text-xs text-muted-foreground">{t("priceNotSet")}</p>
              ) : null
            ) : null}
          </div>

          <ModalFooter>
            <Button variant="secondary" onClick={closeLineDialog}>
              {tCommon(lineDialogMode === "add" ? "close" : "cancel")}
            </Button>
            <Button
              onClick={() => void handleSubmitLine()}
              disabled={
                lineActionsDisabled ||
                selectedProductQuery.isFetching ||
                (linePriceEdited && !hasManualLinePrice) ||
                (lineDialogMode === "add" &&
                  (!selectedProduct ||
                    (!hasManualLinePrice &&
                      (linePriceQuery.isFetching ||
                        Boolean(linePriceQuery.error) ||
                        !linePriceQuery.data))))
              }
            >
              {lineActionsDisabled ? <Spinner className="h-4 w-4" /> : null}
              {t("saveLine")}
            </Button>
          </ModalFooter>
        </div>
      </Modal>
    </div>
  );
};

export default SalesOrderDetailPage;

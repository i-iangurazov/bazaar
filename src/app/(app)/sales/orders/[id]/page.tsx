"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CustomerOrderStatus } from "@prisma/client";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";

import { FormGrid } from "@/components/form-layout";
import { AddIcon, CheckIcon, CloseIcon, DeleteIcon, EditIcon, EmptyIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { ScanInput } from "@/components/ScanInput";
import { RowActions } from "@/components/row-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
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
import { formatCurrencyKGS, formatDate } from "@/lib/i18nFormat";
import { getCustomerOrderStatusLabel } from "@/lib/i18n/status";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import type { ScanResolvedResult } from "@/lib/scanning/scanRouter";

type ProductSearchResult = {
  id: string;
  name: string;
  sku: string;
  isBundle?: boolean;
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

const sourceVariant = (source?: string | null): "warning" | "muted" =>
  source === "CATALOG" ? "warning" : "muted";

const SalesOrderDetailPage = () => {
  const params = useParams();
  const customerOrderId = String(params?.id ?? "");

  const t = useTranslations("salesOrders");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session } = useSession();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const utils = trpc.useUtils();
  const sourceLabel = (source?: string | null) =>
    source === "CATALOG" ? t("source.catalog") : t("source.manual");

  const canFinalize = session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";

  const orderQuery = trpc.salesOrders.getById.useQuery(
    { customerOrderId },
    { enabled: Boolean(customerOrderId) },
  );

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");

  const [lineDialogMode, setLineDialogMode] = useState<"add" | "edit" | null>(null);
  const [lineSearch, setLineSearch] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductSearchResult | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<string>("BASE");
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [lineQtyInput, setLineQtyInput] = useState<string>("1");
  const lineQtyInputRef = useRef<HTMLInputElement | null>(null);

  const productSearchQuery = trpc.products.searchQuick.useQuery(
    { q: lineSearch.trim() },
    { enabled: lineDialogMode === "add" && lineSearch.trim().length >= 1 },
  );

  const selectedProductQuery = trpc.products.getById.useQuery(
    { productId: selectedProduct?.id ?? "" },
    { enabled: lineDialogMode === "add" && Boolean(selectedProduct?.id) },
  );

  const order = orderQuery.data;
  const lines = useMemo(() => order?.lines ?? [], [order?.lines]);

  const isEditable =
    order?.status === CustomerOrderStatus.DRAFT || order?.status === CustomerOrderStatus.CONFIRMED;

  useEffect(() => {
    if (!order) {
      return;
    }
    setCustomerName(order.customerName ?? "");
    setCustomerPhone(order.customerPhone ?? "");
    setNotes(order.notes ?? "");
  }, [order]);

  const refetchAll = async () => {
    await Promise.all([orderQuery.refetch(), utils.salesOrders.list.invalidate()]);
  };

  const setCustomerMutation = trpc.salesOrders.setCustomer.useMutation({
    onSuccess: async () => {
      await refetchAll();
      toast({ variant: "success", description: t("customerUpdated") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const addLineMutation = trpc.salesOrders.addLine.useMutation({
    onSuccess: async () => {
      await refetchAll();
      closeLineDialog();
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
    onSuccess: async () => {
      await refetchAll();
      toast({ variant: "success", description: t("confirmSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const markReadyMutation = trpc.salesOrders.markReady.useMutation({
    onSuccess: async () => {
      await refetchAll();
      toast({ variant: "success", description: t("readySuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const completeMutation = trpc.salesOrders.complete.useMutation({
    onSuccess: async () => {
      await refetchAll();
      toast({ variant: "success", description: t("completeSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const cancelMutation = trpc.salesOrders.cancel.useMutation({
    onSuccess: async () => {
      await refetchAll();
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
  };

  const openAddLineDialog = () => {
    setLineDialogMode("add");
    setLineSearch("");
    setShowResults(false);
    setSelectedProduct(null);
    setSelectedVariant("BASE");
    setEditingLineId(null);
    setLineQtyInput("1");
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
  };

  const handleSaveCustomer = async () => {
    if (!order) {
      return;
    }
    await setCustomerMutation.mutateAsync({
      customerOrderId: order.id,
      customerName: customerName.trim() || null,
      customerPhone: customerPhone.trim() || null,
      notes: notes.trim() || null,
    });
  };

  const handleSubmitLine = async () => {
    if (!order) {
      return;
    }
    const normalizedQty = Number(lineQtyInput);
    if (!lineQtyInput.trim() || !Number.isFinite(normalizedQty) || normalizedQty <= 0) {
      toast({ variant: "error", description: t("qtyPositive") });
      return;
    }
    const qty = Math.trunc(normalizedQty);

    if (lineDialogMode === "edit" && editingLineId) {
      await updateLineMutation.mutateAsync({
        lineId: editingLineId,
        qty,
      });
      return;
    }

    if (!selectedProduct) {
      toast({ variant: "error", description: t("productRequired") });
      return;
    }

    await addLineMutation.mutateAsync({
      customerOrderId: order.id,
      productId: selectedProduct.id,
      variantId: selectedVariant === "BASE" ? null : selectedVariant,
      qty,
    });
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

  const handleComplete = async () => {
    if (!order) {
      return;
    }
    if (!(await confirm({ description: t("confirmComplete") }))) {
      return;
    }
    await completeMutation.mutateAsync({
      customerOrderId: order.id,
      idempotencyKey: createIdempotencyKey(),
    });
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
    addLineMutation.isLoading || updateLineMutation.isLoading || removeLineMutation.isLoading;

  const canCancel =
    canFinalize &&
    (order?.status === CustomerOrderStatus.DRAFT ||
      order?.status === CustomerOrderStatus.CONFIRMED ||
      order?.status === CustomerOrderStatus.READY);

  const selectedProductVariants = selectedProductQuery.data?.variants ?? [];

  const applySelectedProduct = (product: ProductSearchResult) => {
    setSelectedProduct(product);
    setLineSearch(product.name);
    setSelectedVariant("BASE");
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
      {order?.status === CustomerOrderStatus.DRAFT ? (
        <Button
          variant="secondary"
          onClick={() => void handleConfirm()}
          disabled={confirmMutation.isLoading || !lines.length}
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
          disabled={markReadyMutation.isLoading}
        >
          {markReadyMutation.isLoading ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <CheckIcon className="h-4 w-4" aria-hidden />
          )}
          {t("markReady")}
        </Button>
      ) : null}
      {canFinalize && order?.status === CustomerOrderStatus.READY ? (
        <Button onClick={() => void handleComplete()} disabled={completeMutation.isLoading}>
          {completeMutation.isLoading ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <CheckIcon className="h-4 w-4" aria-hidden />
          )}
          {t("complete")}
        </Button>
      ) : null}
      {canCancel ? (
        <Button
          variant="danger"
          onClick={() => void handleCancel()}
          disabled={cancelMutation.isLoading}
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
                    {formatCurrencyKGS(order.subtotalKgs, locale)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("total")}</p>
                  <p className="text-sm font-medium text-foreground">
                    {formatCurrencyKGS(order.totalKgs, locale)}
                  </p>
                </div>
              </FormGrid>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("customerSectionTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
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
                  <p className="text-sm font-medium">{t("customerPhone")}</p>
                  <Input
                    value={customerPhone}
                    onChange={(event) => setCustomerPhone(event.target.value)}
                    placeholder={t("customerPhonePlaceholder")}
                    maxLength={64}
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
              {!lines.length ? (
                <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
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
                          <TableHead>{t("unitPrice")}</TableHead>
                          <TableHead>{t("lineTotal")}</TableHead>
                          <TableHead className="text-right">{tCommon("actions")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lines.map((line) => (
                          <TableRow key={line.id}>
                            <TableCell>
                              <p className="text-sm font-medium text-foreground">
                                {line.product.name}
                              </p>
                              <p className="text-xs text-muted-foreground">{line.product.sku}</p>
                            </TableCell>
                            <TableCell>{line.variant?.name ?? t("variantBase")}</TableCell>
                            <TableCell>{line.qty}</TableCell>
                            <TableCell>{formatCurrencyKGS(line.unitPriceKgs, locale)}</TableCell>
                            <TableCell>{formatCurrencyKGS(line.lineTotalKgs, locale)}</TableCell>
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
                            <div>
                              <p className="text-sm font-semibold text-foreground">
                                {line.product.name}
                              </p>
                              <p className="text-xs text-muted-foreground">{line.product.sku}</p>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {line.variant?.name ?? t("variantBase")}
                            </p>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                            <div>
                              <p>{t("qty")}</p>
                              <p className="font-medium text-foreground">{line.qty}</p>
                            </div>
                            <div>
                              <p>{t("unitPrice")}</p>
                              <p className="font-medium text-foreground">
                                {formatCurrencyKGS(line.unitPriceKgs, locale)}
                              </p>
                            </div>
                            <div>
                              <p>{t("lineTotal")}</p>
                              <p className="font-medium text-foreground">
                                {formatCurrencyKGS(line.lineTotalKgs, locale)}
                              </p>
                            </div>
                          </div>
                          {isEditable ? (
                            <div className="flex justify-end">
                              <RowActions
                                moreLabel={tCommon("moreActions")}
                                actions={[
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
                                      if (
                                        !(await confirm({
                                          description: t("confirmRemoveLine"),
                                          confirmVariant: "danger",
                                        }))
                                      ) {
                                        return;
                                      }
                                      void removeLineMutation.mutateAsync({ lineId: line.id });
                                    },
                                    disabled: lineActionsDisabled,
                                  },
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
                  context="linePicker"
                  value={lineSearch}
                  onValueChange={(nextValue) => {
                    setLineSearch(nextValue);
                    setShowResults(true);
                    if (selectedProduct && nextValue !== selectedProduct.name) {
                      setSelectedProduct(null);
                      setSelectedVariant("BASE");
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
                    {(productSearchQuery.data ?? []).length ? (
                      (productSearchQuery.data ?? []).map((product) => (
                        <button
                          key={product.id}
                          type="button"
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                          onClick={() => {
                            applySelectedProduct({
                              id: product.id,
                              name: product.name,
                              sku: product.sku,
                              isBundle: product.isBundle,
                            });
                          }}
                        >
                          <div className="min-w-0">
                            <p className="truncate">{product.name}</p>
                            <p className="text-xs text-muted-foreground">{product.sku}</p>
                          </div>
                          {product.isBundle ? (
                            <Badge variant="muted">{t("bundleProductLabel")}</Badge>
                          ) : null}
                        </button>
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
                    <span>{t("selectedProduct", { sku: selectedProduct.sku })}</span>
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
                  onValueChange={setSelectedVariant}
                  disabled={!selectedProduct}
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
              </div>
            </>
          ) : (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <p className="font-medium text-foreground">
                {selectedProduct?.name ?? currentLine?.product.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {selectedProduct?.sku ?? currentLine?.product.sku} ·{" "}
                {currentLine?.variant?.name ?? t("variantBase")}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t("qty")}</p>
            <Input
              ref={lineQtyInputRef}
              type="number"
              min={1}
              step={1}
              value={lineQtyInput}
              onChange={(event) => setLineQtyInput(event.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={closeLineDialog}>
              {tCommon("cancel")}
            </Button>
            <Button
              onClick={() => void handleSubmitLine()}
              disabled={
                lineActionsDisabled ||
                selectedProductQuery.isFetching ||
                (lineDialogMode === "add" && !selectedProduct)
              }
            >
              {lineActionsDisabled ? <Spinner className="h-4 w-4" /> : null}
              {t("saveLine")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default SalesOrderDetailPage;

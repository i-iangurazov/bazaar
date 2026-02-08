"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Modal } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DeleteIcon,
  EditIcon,
  EmptyIcon,
  PdfIcon,
  ReceiveIcon,
  StatusDangerIcon,
  StatusPendingIcon,
  StatusSuccessIcon,
  UploadIcon,
} from "@/components/icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { RowActions } from "@/components/row-actions";
import { formatCurrencyKGS, formatNumber } from "@/lib/i18nFormat";
import { getPurchaseOrderStatusLabel } from "@/lib/i18n/status";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { useSse } from "@/lib/useSse";
import { useToast } from "@/components/ui/toast";

const PurchaseOrderDetailPage = () => {
  const params = useParams();
  const poId = String(params?.id ?? "");
  const t = useTranslations("purchaseOrders");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session } = useSession();
  const { toast } = useToast();
  const role = session?.user?.role ?? "STAFF";
  const canManage = role === "ADMIN" || role === "MANAGER";

  const poQuery = trpc.purchaseOrders.getById.useQuery({ id: poId }, { enabled: Boolean(poId) });
  type PurchaseOrderLine = NonNullable<typeof poQuery.data>["lines"][number];
  type ProductPackOption = {
    id: string;
    packName: string;
    multiplierToBase: number;
    allowInPurchasing: boolean;
    allowInReceiving: boolean;
  };
  type ProductUnitInfo = {
    baseUnit?: { labelRu: string; labelKg: string; code: string } | null;
    packs?: ProductPackOption[];
  };

  const lineSchema = useMemo(() => {
    const optionalCost = z.preprocess(
      (value) => (value === "" || value === null ? undefined : value),
      z.coerce.number().min(0, t("unitCostNonNegative")).optional(),
    );
    return z.object({
      productId: z.string().min(1, t("productRequired")),
      variantId: z.string().optional().nullable(),
      qtyOrdered: z.coerce.number().int().positive(t("qtyPositive")),
      unitSelection: z.string().min(1, t("unitRequired")),
      unitCost: optionalCost,
    });
  }, [t]);

  const lineForm = useForm<z.infer<typeof lineSchema>>({
    resolver: zodResolver(lineSchema),
    defaultValues: {
      productId: "",
      variantId: null,
      qtyOrdered: 1,
      unitSelection: "BASE",
      unitCost: undefined,
    },
  });

  const [lineDialogOpen, setLineDialogOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<PurchaseOrderLine | null>(null);
  const [lineSearch, setLineSearch] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [removingLineId, setRemovingLineId] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<{
    id: string;
    name: string;
    sku: string;
  } | null>(null);
  const [receiveDialogOpen, setReceiveDialogOpen] = useState(false);
  const [receiveLines, setReceiveLines] = useState<
    {
      lineId: string;
      productId: string;
      productName: string;
      variantName: string;
      remaining: number;
      qtyReceived: number;
      unitSelection: string;
    }[]
  >([]);
  const [allowOverReceive, setAllowOverReceive] = useState(false);

  const lineProductId = lineForm.watch("productId");
  const lineUnitSelection = lineForm.watch("unitSelection");
  const lineQtyOrdered = lineForm.watch("qtyOrdered");
  const productSearchQuery = trpc.products.searchQuick.useQuery(
    { q: lineSearch },
    { enabled: lineDialogOpen && lineSearch.trim().length >= 2 },
  );
  const lineProductQuery = trpc.products.getById.useQuery(
    { productId: lineProductId },
    { enabled: Boolean(lineProductId) },
  );
  const lineProduct = lineProductQuery.data ?? null;

  const resolveUnitLabel = (
    unit?: { labelRu: string; labelKg: string; code: string } | null,
  ) => {
    if (!unit) {
      return tCommon("notAvailable");
    }
    return (locale === "kg" ? unit.labelKg : unit.labelRu) || unit.code;
  };

  const buildUnitOptions = (product: ProductUnitInfo | null, mode: "purchasing" | "receiving") => {
    if (!product?.baseUnit) {
      return [];
    }
    const baseLabel = resolveUnitLabel(product.baseUnit);
    const options = [{ value: "BASE", label: baseLabel }];
    (product.packs ?? [])
      .filter((pack) => (mode === "purchasing" ? pack.allowInPurchasing : pack.allowInReceiving))
      .forEach((pack) => {
        options.push({
          value: pack.id,
          label: `${pack.packName} × ${pack.multiplierToBase} ${baseLabel}`,
        });
      });
    return options;
  };

  const resolveBasePreview = useCallback(
    (
      product: Pick<ProductUnitInfo, "packs"> | null,
      selection: string,
      qty: number,
    ) => {
      if (!product || !Number.isFinite(qty)) {
        return null;
      }
      if (selection === "BASE") {
        return qty;
      }
      const pack = product.packs?.find((item) => item.id === selection);
      if (!pack) {
        return null;
      }
      return qty * pack.multiplierToBase;
    },
    [],
  );

  const closeLineDialog = () => {
    setLineDialogOpen(false);
    setEditingLine(null);
    lineForm.reset({
      productId: "",
      variantId: null,
      qtyOrdered: 1,
      unitSelection: "BASE",
      unitCost: undefined,
    });
    setLineSearch("");
    setSelectedProduct(null);
    setShowResults(false);
  };

  const openAddLine = () => {
    setEditingLine(null);
    lineForm.reset({
      productId: "",
      variantId: null,
      qtyOrdered: 1,
      unitSelection: "BASE",
      unitCost: undefined,
    });
    setLineSearch("");
    setSelectedProduct(null);
    setShowResults(false);
    setLineDialogOpen(true);
  };

  const openEditLine = (line: PurchaseOrderLine) => {
    setEditingLine(line);
    lineForm.reset({
      productId: line.productId,
      variantId: line.variantId ?? null,
      qtyOrdered: line.qtyOrdered,
      unitSelection: "BASE",
      unitCost: line.unitCost ?? undefined,
    });
    setLineSearch(line.product.name);
    setSelectedProduct({ id: line.productId, name: line.product.name, sku: line.product.sku });
    setShowResults(false);
    setLineDialogOpen(true);
  };

  const submitMutation = trpc.purchaseOrders.submit.useMutation({
    onSuccess: () => {
      poQuery.refetch();
      toast({ variant: "success", description: t("submitSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const approveMutation = trpc.purchaseOrders.approve.useMutation({
    onSuccess: () => {
      poQuery.refetch();
      toast({ variant: "success", description: t("approveSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const receiveMutation = trpc.purchaseOrders.receive.useMutation({
    onSuccess: () => {
      poQuery.refetch();
      toast({ variant: "success", description: t("receiveSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const cancelMutation = trpc.purchaseOrders.cancel.useMutation({
    onSuccess: () => {
      poQuery.refetch();
      toast({ variant: "success", description: t("cancelSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const addLineMutation = trpc.purchaseOrders.addLine.useMutation({
    onSuccess: () => {
      poQuery.refetch();
      toast({ variant: "success", description: t("lineAdded") });
      closeLineDialog();
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const updateLineMutation = trpc.purchaseOrders.updateLine.useMutation({
    onSuccess: () => {
      poQuery.refetch();
      toast({ variant: "success", description: t("lineUpdated") });
      closeLineDialog();
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const removeLineMutation = trpc.purchaseOrders.removeLine.useMutation({
    onMutate: (variables) => {
      setRemovingLineId(variables.lineId);
    },
    onSuccess: () => {
      poQuery.refetch();
      toast({ variant: "success", description: t("lineRemoved") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
    onSettled: () => {
      setRemovingLineId(null);
    },
  });

  useSse({
    "purchaseOrder.updated": () => poQuery.refetch(),
  });

  const po = poQuery.data;
  const lineProductMap = useMemo(() => {
    return new Map((po?.lines ?? []).map((line) => [line.id, line.product]));
  }, [po]);
  useEffect(() => {
    if (!receiveDialogOpen || !po) {
      return;
    }
    const nextLines = po.lines
      .map((line) => {
        const remaining = line.qtyOrdered - line.qtyReceived;
        return {
          lineId: line.id,
          productId: line.productId,
          productName: line.product.name,
          variantName: line.variant?.name ?? tCommon("notAvailable"),
          remaining,
          qtyReceived: remaining > 0 ? remaining : 0,
          unitSelection: "BASE",
        };
      })
      .filter((line) => line.remaining > 0);
    setReceiveLines(nextLines);
    setAllowOverReceive(false);
  }, [receiveDialogOpen, po, tCommon]);
  const canEditLines = Boolean(po && po.status === "DRAFT" && canManage);
  const statusLabel = (status?: string) => getPurchaseOrderStatusLabel(t, status);

  const statusIcon = (status?: string) => {
    switch (status) {
      case "RECEIVED":
        return StatusSuccessIcon;
      case "PARTIALLY_RECEIVED":
        return StatusPendingIcon;
      case "CANCELLED":
        return StatusDangerIcon;
      case "SUBMITTED":
      case "APPROVED":
      case "DRAFT":
      default:
        return StatusPendingIcon;
    }
  };

  const totals = useMemo(() => {
    if (!po) {
      return { total: 0, lines: [] as { id: string; total: number }[] };
    }
    const lineTotals: { id: string; total: number }[] = po.lines.map((line: PurchaseOrderLine) => ({
      id: line.id,
      total: (line.unitCost ?? 0) * line.qtyOrdered,
    }));
    const total = lineTotals.reduce((sum, line) => sum + line.total, 0);
    return { total, lines: lineTotals };
  }, [po]);

  const receiveTotals = useMemo(() => {
    const remaining = receiveLines.reduce((sum, line) => sum + line.remaining, 0);
    const receiving = receiveLines.reduce((sum, line) => {
      const product = lineProductMap.get(line.lineId) ?? null;
      const baseQty = resolveBasePreview(product, line.unitSelection, line.qtyReceived);
      return sum + (baseQty ?? line.qtyReceived);
    }, 0);
    return { remaining, receiving };
  }, [receiveLines, lineProductMap, resolveBasePreview]);

  const hasCost = po?.lines.some((line) => line.unitCost !== null) ?? false;

  if (poQuery.isLoading) {
    return (
      <div>
        <PageHeader title={t("title")} subtitle={tCommon("loading")} />
        <div className="mt-6 flex items-center gap-2 text-sm text-gray-500">
          <Spinner className="h-4 w-4" />
          {tCommon("loading")}
        </div>
      </div>
    );
  }

  if (poQuery.error) {
    return (
      <div>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-red-500">
          <span>{translateError(tErrors, poQuery.error)}</span>
          <Button
            type="button"
            variant="secondary"
            className="w-full sm:w-auto"
            onClick={() => poQuery.refetch()}
          >
            {tCommon("tryAgain")}
          </Button>
        </div>
      </div>
    );
  }

  if (!po) {
    return (
      <div>
        <PageHeader title={t("title")} subtitle={t("notFound")} />
        <div className="mt-6 flex items-center gap-2 text-sm text-gray-500">
          <EmptyIcon className="h-4 w-4" aria-hidden />
          {t("notFound")}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t("title")}
        subtitle={po.supplier.name}
        action={
          <>
            <a
              href={`/api/purchase-orders/${poId}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="w-full sm:w-auto"
            >
              <Button variant="secondary" className="w-full sm:w-auto">
                <PdfIcon className="h-4 w-4" aria-hidden />
                {t("downloadPdf")}
              </Button>
            </a>
            {canManage ? (
              <>
                <Button
                  variant="secondary"
                  className="w-full sm:w-auto"
                  onClick={() => submitMutation.mutate({ purchaseOrderId: poId })}
                  disabled={po.status !== "DRAFT" || submitMutation.isLoading}
                >
                  {submitMutation.isLoading ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <UploadIcon className="h-4 w-4" aria-hidden />
                  )}
                  {submitMutation.isLoading ? tCommon("loading") : t("submitOrder")}
                </Button>
                <Button
                  variant="secondary"
                  className="w-full sm:w-auto"
                  onClick={() => approveMutation.mutate({ purchaseOrderId: poId })}
                  disabled={po.status !== "SUBMITTED" || approveMutation.isLoading}
                >
                  {approveMutation.isLoading ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <StatusSuccessIcon className="h-4 w-4" aria-hidden />
                  )}
                  {approveMutation.isLoading ? tCommon("loading") : t("approveOrder")}
                </Button>
                <Button
                  className="w-full sm:w-auto"
                  onClick={() => setReceiveDialogOpen(true)}
                  disabled={
                    (po.status !== "APPROVED" && po.status !== "PARTIALLY_RECEIVED") ||
                    receiveMutation.isLoading
                  }
                >
                  {receiveMutation.isLoading ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <ReceiveIcon className="h-4 w-4" aria-hidden />
                  )}
                  {receiveMutation.isLoading ? tCommon("loading") : t("receiveItems")}
                </Button>
                <Button
                  variant="danger"
                  className="w-full sm:w-auto"
                  onClick={() => {
                    if (po.status !== "DRAFT" && po.status !== "SUBMITTED") {
                      return;
                    }
                    const confirmed = window.confirm(t("confirmCancel"));
                    if (!confirmed) {
                      return;
                    }
                    cancelMutation.mutate({ purchaseOrderId: poId });
                  }}
                  disabled={
                    (po.status !== "DRAFT" && po.status !== "SUBMITTED") ||
                    cancelMutation.isLoading
                  }
                >
                  {cancelMutation.isLoading ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <StatusDangerIcon className="h-4 w-4" aria-hidden />
                  )}
                  {cancelMutation.isLoading ? tCommon("loading") : t("cancelOrder")}
                </Button>
              </>
            ) : null}
          </>
        }
        filters={
          <Badge
            variant={
              po.status === "RECEIVED"
                ? "success"
                : po.status === "PARTIALLY_RECEIVED"
                  ? "warning"
                : po.status === "CANCELLED"
                  ? "danger"
                  : "warning"
            }
          >
            {(() => {
              const Icon = statusIcon(po.status);
              return <Icon className="h-3 w-3" aria-hidden />;
            })()}
            {statusLabel(po.status)}
          </Badge>
        }
      />

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{t("linesTitle")}</CardTitle>
          {canEditLines ? (
            <Button className="w-full sm:w-auto" onClick={openAddLine}>
              <AddIcon className="h-4 w-4" aria-hidden />
              {t("addLine")}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          <ResponsiveDataList
            items={po.lines}
            getKey={(line) => line.id}
            renderDesktop={(visibleItems) => (
              <div className="overflow-x-auto">
                <TooltipProvider>
                  <Table className="min-w-[640px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tCommon("product")}</TableHead>
                        <TableHead className="hidden sm:table-cell">{t("variant")}</TableHead>
                        <TableHead>{t("ordered")}</TableHead>
                        <TableHead>{t("received")}</TableHead>
                        <TableHead className="hidden md:table-cell">{t("unitCost")}</TableHead>
                        <TableHead className="hidden md:table-cell">{t("lineTotal")}</TableHead>
                        {canEditLines ? <TableHead>{tCommon("actions")}</TableHead> : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleItems.map((line) => (
                        <TableRow key={line.id}>
                          <TableCell className="font-medium">{line.product.name}</TableCell>
                          <TableCell className="text-xs text-gray-500 hidden sm:table-cell">
                            {line.variant?.name ?? tCommon("notAvailable")}
                          </TableCell>
                          <TableCell>
                            {formatNumber(line.qtyOrdered, locale)}{" "}
                            {resolveUnitLabel(line.product.baseUnit ?? null)}
                          </TableCell>
                          <TableCell>
                            {formatNumber(line.qtyReceived, locale)}{" "}
                            {resolveUnitLabel(line.product.baseUnit ?? null)}
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            {line.unitCost === null
                              ? tCommon("notAvailable")
                              : formatCurrencyKGS(line.unitCost ?? 0, locale)}
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            {line.unitCost === null
                              ? tCommon("notAvailable")
                              : formatCurrencyKGS(
                                  totals.lines.find((item) => item.id === line.id)?.total ?? 0,
                                  locale,
                                )}
                          </TableCell>
                          {canEditLines ? (
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="shadow-none"
                                      aria-label={t("editLine")}
                                      onClick={() => openEditLine(line)}
                                    >
                                      <EditIcon className="h-4 w-4" aria-hidden />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{t("editLine")}</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="text-danger shadow-none hover:text-danger"
                                      aria-label={t("removeLine")}
                                      onClick={() => {
                                        const confirmed = window.confirm(t("confirmRemoveLine"));
                                        if (!confirmed) {
                                          return;
                                        }
                                        removeLineMutation.mutate({ lineId: line.id });
                                      }}
                                      disabled={removingLineId === line.id}
                                    >
                                      {removingLineId === line.id ? (
                                        <Spinner className="h-4 w-4" />
                                      ) : (
                                        <DeleteIcon className="h-4 w-4" aria-hidden />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{t("removeLine")}</TooltipContent>
                                </Tooltip>
                              </div>
                            </TableCell>
                          ) : null}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TooltipProvider>
              </div>
            )}
            renderMobile={(line) => {
              const total = totals.lines.find((item) => item.id === line.id)?.total ?? 0;
              const actions = canEditLines
                ? [
                    {
                      key: "edit",
                      label: t("editLine"),
                      icon: EditIcon,
                      onSelect: () => openEditLine(line),
                    },
                    {
                      key: "remove",
                      label: t("removeLine"),
                      icon: DeleteIcon,
                      variant: "danger",
                      disabled: removingLineId === line.id,
                      onSelect: () => {
                        const confirmed = window.confirm(t("confirmRemoveLine"));
                        if (!confirmed) {
                          return;
                        }
                        removeLineMutation.mutate({ lineId: line.id });
                      },
                    },
                  ]
                : [];

              return (
                <div className="rounded-md border border-gray-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{line.product.name}</p>
                      <p className="text-xs text-gray-500">
                        {line.variant?.name ?? tCommon("notAvailable")}
                      </p>
                      <p className="text-xs text-gray-500">
                        {t("ordered")}: {formatNumber(line.qtyOrdered, locale)}{" "}
                        {resolveUnitLabel(line.product.baseUnit ?? null)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {t("received")}: {formatNumber(line.qtyReceived, locale)}{" "}
                        {resolveUnitLabel(line.product.baseUnit ?? null)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {t("unitCost")}{" "}
                        {line.unitCost === null
                          ? tCommon("notAvailable")
                          : formatCurrencyKGS(line.unitCost ?? 0, locale)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {t("lineTotal")}{" "}
                        {line.unitCost === null
                          ? tCommon("notAvailable")
                          : formatCurrencyKGS(total, locale)}
                      </p>
                    </div>
                    {canEditLines ? (
                      <RowActions
                        actions={actions}
                        maxInline={1}
                        moreLabel={tCommon("tooltips.moreActions")}
                      />
                    ) : null}
                  </div>
                </div>
              );
            }}
          />
          {!po.lines.length ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
              <EmptyIcon className="h-4 w-4" aria-hidden />
              {t("noLines")}
            </div>
          ) : null}
          <div className="mt-4 flex justify-end text-sm font-semibold">
            {t("total")}:{" "}
            {hasCost ? formatCurrencyKGS(totals.total, locale) : tCommon("notAvailable")}
          </div>
        </CardContent>
      </Card>

      <Modal
        open={receiveDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setReceiveDialogOpen(false);
          }
        }}
        title={t("receiveItems")}
        subtitle={t("receiveDialogSubtitle")}
      >
        {receiveLines.length ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!po) {
                return;
              }
              const lines = receiveLines
                .filter((line) => line.qtyReceived > 0)
                .map((line) => ({
                  lineId: line.lineId,
                  qtyReceived: line.qtyReceived,
                  packId: line.unitSelection !== "BASE" ? line.unitSelection : undefined,
                }));
              if (!lines.length) {
                toast({ variant: "error", description: t("receiveQtyRequired") });
                return;
              }
              receiveMutation.mutate({
                purchaseOrderId: poId,
                idempotencyKey: crypto.randomUUID(),
                allowOverReceive,
                lines,
              });
              setReceiveDialogOpen(false);
            }}
          >
            <ResponsiveDataList
              items={receiveLines}
              getKey={(line) => line.lineId}
              renderDesktop={(visibleItems) => (
                <div className="overflow-x-auto">
                  <Table className="min-w-[520px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tCommon("product")}</TableHead>
                        <TableHead className="hidden sm:table-cell">{t("variant")}</TableHead>
                        <TableHead>{t("remaining")}</TableHead>
                        <TableHead>{t("receiveQty")}</TableHead>
                        <TableHead>{t("unit")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleItems.map((line) => (
                        <TableRow key={line.lineId}>
                          <TableCell className="font-medium">{line.productName}</TableCell>
                          <TableCell className="hidden sm:table-cell text-xs text-gray-500">
                            {line.variantName}
                          </TableCell>
                          <TableCell>{formatNumber(line.remaining, locale)}</TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              value={line.qtyReceived}
                              onChange={(event) => {
                                const nextValue = Number(event.target.value);
                                setReceiveLines((prev) =>
                                  prev.map((item) =>
                                    item.lineId === line.lineId
                                      ? { ...item, qtyReceived: Number.isFinite(nextValue) ? nextValue : 0 }
                                      : item,
                                  ),
                                );
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <Select
                                value={line.unitSelection}
                                onValueChange={(value) => {
                                  setReceiveLines((prev) =>
                                    prev.map((item) =>
                                      item.lineId === line.lineId
                                        ? { ...item, unitSelection: value }
                                        : item,
                                    ),
                                  );
                                }}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder={t("unitPlaceholder")} />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {buildUnitOptions(lineProductMap.get(line.lineId) ?? null, "receiving").map(
                                    (option) => (
                                      <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                      </SelectItem>
                                    ),
                                  )}
                                </SelectContent>
                              </Select>
                              {line.unitSelection !== "BASE" ? (
                                (() => {
                                  const product = lineProductMap.get(line.lineId) ?? null;
                                  const baseQty = resolveBasePreview(
                                    product,
                                    line.unitSelection,
                                    line.qtyReceived,
                                  );
                                  if (baseQty === null) {
                                    return null;
                                  }
                                  return (
                                    <span className="text-xs text-gray-500">
                                      {t("baseQtyPreview", {
                                        qty: formatNumber(baseQty, locale),
                                        unit: resolveUnitLabel(product?.baseUnit ?? null),
                                      })}
                                    </span>
                                  );
                                })()
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              renderMobile={(line) => {
                const product = lineProductMap.get(line.lineId) ?? null;
                const baseQty =
                  line.unitSelection === "BASE"
                    ? null
                    : resolveBasePreview(product, line.unitSelection, line.qtyReceived);

                return (
                  <div className="rounded-md border border-gray-200 bg-white p-3">
                    <div className="flex flex-col gap-2">
                      <div>
                        <p className="text-sm font-medium text-ink">{line.productName}</p>
                        <p className="text-xs text-gray-500">{line.variantName}</p>
                      </div>
                      <div className="text-xs text-gray-500">
                        {t("remaining")}: {formatNumber(line.remaining, locale)}
                      </div>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={line.qtyReceived}
                        onChange={(event) => {
                          const nextValue = Number(event.target.value);
                          setReceiveLines((prev) =>
                            prev.map((item) =>
                              item.lineId === line.lineId
                                ? { ...item, qtyReceived: Number.isFinite(nextValue) ? nextValue : 0 }
                                : item,
                            ),
                          );
                        }}
                      />
                      <div className="flex flex-col gap-1">
                        <Select
                          value={line.unitSelection}
                          onValueChange={(value) => {
                            setReceiveLines((prev) =>
                              prev.map((item) =>
                                item.lineId === line.lineId ? { ...item, unitSelection: value } : item,
                              ),
                            );
                          }}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t("unitPlaceholder")} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {buildUnitOptions(product, "receiving").map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {baseQty !== null ? (
                          <span className="text-xs text-gray-500">
                            {t("baseQtyPreview", {
                              qty: formatNumber(baseQty, locale),
                              unit: resolveUnitLabel(product?.baseUnit ?? null),
                            })}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              }}
            />
            <div className="flex flex-col gap-2 text-sm text-gray-500">
              <div className="flex items-center justify-between">
                <span>{t("remainingTotal")}</span>
                <span className="font-medium text-ink">
                  {formatNumber(receiveTotals.remaining, locale)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>{t("receivingTotal")}</span>
                <span className="font-medium text-ink">
                  {formatNumber(receiveTotals.receiving, locale)}
                </span>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-md border border-gray-100 bg-gray-50 p-3">
              <Switch checked={allowOverReceive} onCheckedChange={setAllowOverReceive} />
              <div>
                <p className="text-sm font-medium text-ink">{t("allowOverReceive")}</p>
                <p className="text-xs text-gray-500">{t("allowOverReceiveHint")}</p>
              </div>
            </div>
            <FormActions>
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => setReceiveDialogOpen(false)}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                className="w-full sm:w-auto"
                disabled={receiveMutation.isLoading}
              >
                {receiveMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                {receiveMutation.isLoading ? tCommon("loading") : t("receiveSubmit")}
              </Button>
            </FormActions>
          </form>
        ) : (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <EmptyIcon className="h-4 w-4" aria-hidden />
            {t("nothingToReceive")}
          </div>
        )}
      </Modal>

      <Modal
        open={lineDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeLineDialog();
          }
        }}
        title={editingLine ? t("editLineTitle") : t("addLineTitle")}
        subtitle={editingLine ? editingLine.product.name : t("lineDialogSubtitle")}
      >
        <Form {...lineForm}>
          <form
            className="space-y-4"
            onSubmit={lineForm.handleSubmit((values) => {
              if (!po) {
                return;
              }
              const packId = values.unitSelection !== "BASE" ? values.unitSelection : undefined;
              if (editingLine) {
                updateLineMutation.mutate({
                  lineId: editingLine.id,
                  qtyOrdered: values.qtyOrdered,
                  unitCost: values.unitCost ?? undefined,
                  packId,
                });
                return;
              }
              addLineMutation.mutate({
                purchaseOrderId: po.id,
                productId: values.productId,
                variantId: values.variantId ?? undefined,
                qtyOrdered: values.qtyOrdered,
                unitCost: values.unitCost ?? undefined,
                packId,
              });
            })}
          >
            <FormGrid>
              <FormField
                control={lineForm.control}
                name="productId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tCommon("product")}</FormLabel>
                    {editingLine ? (
                      <FormControl>
                        <Input value={editingLine.product.name} disabled />
                      </FormControl>
                    ) : (
                      <div className="relative">
                        <FormControl>
                          <Input
                            value={lineSearch}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              setLineSearch(nextValue);
                              setShowResults(true);
                              if (selectedProduct && nextValue !== selectedProduct.name) {
                                setSelectedProduct(null);
                                field.onChange("");
                                lineForm.setValue("variantId", null, { shouldValidate: true });
                                lineForm.setValue("unitSelection", "BASE", { shouldValidate: true });
                              }
                            }}
                            onFocus={() => setShowResults(true)}
                            onBlur={() => {
                              setTimeout(() => setShowResults(false), 150);
                            }}
                            placeholder={t("productSearchPlaceholder")}
                          />
                        </FormControl>
                        {showResults && productSearchQuery.data?.length ? (
                          <div className="absolute z-20 mt-2 w-full rounded-md border border-gray-200 bg-white shadow-lg">
                            <div className="max-h-64 overflow-y-auto py-1">
                              {productSearchQuery.data.map((product) => (
                                <button
                                  key={product.id}
                                  type="button"
                                  className="flex w-full flex-col px-3 py-2 text-left text-sm transition hover:bg-gray-50"
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => {
                                    setSelectedProduct({
                                      id: product.id,
                                      name: product.name,
                                      sku: product.sku,
                                    });
                                    setLineSearch(product.name);
                                    field.onChange(product.id);
                                    lineForm.setValue("variantId", null, { shouldValidate: true });
                                    lineForm.setValue("unitSelection", "BASE", { shouldValidate: true });
                                    setShowResults(false);
                                  }}
                                >
                                  <span className="font-medium text-ink">{product.name}</span>
                                  <span className="text-xs text-gray-500">{product.sku}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}
                    {!editingLine ? <FormDescription>{t("productSearchHint")}</FormDescription> : null}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={lineForm.control}
                name="variantId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("variant")}</FormLabel>
                    <Select
                      value={field.value ?? "BASE"}
                      onValueChange={(value) =>
                        field.onChange(value === "BASE" ? null : value)
                      }
                      disabled={!lineProductId || Boolean(editingLine)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t("variantPlaceholder")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="BASE">{t("variantBase")}</SelectItem>
                        {lineProductQuery.data?.variants.map((variant) => (
                          <SelectItem key={variant.id} value={variant.id}>
                            {variant.name ?? tCommon("notAvailable")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGrid>
            <FormGrid>
              <FormField
                control={lineForm.control}
                name="qtyOrdered"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("orderQty")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        inputMode="numeric"
                        placeholder={t("qtyPlaceholder")}
                      />
                    </FormControl>
                    {lineProduct ? (
                      <FormDescription>
                        {(() => {
                          const baseQty = resolveBasePreview(
                            lineProduct,
                            lineUnitSelection,
                            lineQtyOrdered,
                          );
                          if (baseQty === null) {
                            return null;
                          }
                          return t("baseQtyPreview", {
                            qty: formatNumber(baseQty, locale),
                            unit: resolveUnitLabel(lineProduct.baseUnit ?? null),
                          });
                        })()}
                      </FormDescription>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={lineForm.control}
                name="unitSelection"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("unit")}</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={!lineProduct}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t("unitPlaceholder")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {buildUnitOptions(lineProduct, "purchasing").map((option) => (
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
            </FormGrid>
            <FormGrid>
              <FormField
                control={lineForm.control}
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
                    <FormDescription>
                      {t("unitCostHint", {
                        unit: resolveUnitLabel(lineProduct?.baseUnit ?? null),
                      })}
                    </FormDescription>
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
                onClick={closeLineDialog}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                className="w-full sm:w-auto"
                disabled={addLineMutation.isLoading || updateLineMutation.isLoading}
              >
                {addLineMutation.isLoading || updateLineMutation.isLoading ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <AddIcon className="h-4 w-4" aria-hidden />
                )}
                {addLineMutation.isLoading || updateLineMutation.isLoading
                  ? tCommon("loading")
                  : editingLine
                    ? t("saveLine")
                    : t("addLine")}
              </Button>
            </FormActions>
          </form>
        </Form>
      </Modal>
    </div>
  );
};

export default PurchaseOrderDetailPage;

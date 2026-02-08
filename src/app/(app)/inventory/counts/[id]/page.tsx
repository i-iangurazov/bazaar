"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { PageHeader } from "@/components/page-header";
import { HelpLink } from "@/components/help-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
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
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { RowActions } from "@/components/row-actions";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { FormActions } from "@/components/form-layout";
import { Spinner } from "@/components/ui/spinner";
import {
  AddIcon,
  DeleteIcon,
  EmptyIcon,
  EditIcon,
  DownloadIcon,
  ViewIcon,
} from "@/components/icons";
import { useToast } from "@/components/ui/toast";
import { downloadTableFile, type DownloadFormat } from "@/lib/fileExport";
import { formatDateTime, formatNumber } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { getStockMovementLabel } from "@/lib/i18n/status";

const statusVariants: Record<string, "default" | "warning" | "success" | "danger"> = {
  DRAFT: "default",
  IN_PROGRESS: "warning",
  APPLIED: "success",
  CANCELLED: "danger",
};

const StockCountDetailPage = () => {
  const params = useParams();
  const countId = typeof params?.id === "string" ? params.id : "";
  const t = useTranslations("stockCounts");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const tInventory = useTranslations("inventory");
  const tExports = useTranslations("exports");
  const locale = useLocale();
  const { data: session } = useSession();
  const role = session?.user?.role;
  const canManage = role === "ADMIN" || role === "MANAGER";
  const { toast } = useToast();

  const countQuery = trpc.stockCounts.get.useQuery(
    { stockCountId: countId },
    { enabled: Boolean(countId) },
  );

  type CountData = NonNullable<typeof countQuery.data>;
  type CountLine = CountData["lines"][number];

  const count = countQuery.data;
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const [scanValue, setScanValue] = useState("");
  const [scanMode, setScanMode] = useState(true);
  const [editingLine, setEditingLine] = useState<CountLine | null>(null);
  const [exportFormat, setExportFormat] = useState<DownloadFormat>("csv");
  const [movementTarget, setMovementTarget] = useState<
    | {
        productId: string;
        variantId?: string | null;
        label: string;
      }
    | null
  >(null);

  useEffect(() => {
    if (scanMode) {
      scanInputRef.current?.focus();
    }
  }, [scanMode]);

  const addLineMutation = trpc.stockCounts.addOrUpdateLineByScan.useMutation({
    onSuccess: () => {
      countQuery.refetch();
      setScanValue("");
      scanInputRef.current?.focus();
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const setQtyMutation = trpc.stockCounts.setLineCountedQty.useMutation({
    onSuccess: () => {
      countQuery.refetch();
      setEditingLine(null);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const removeLineMutation = trpc.stockCounts.removeLine.useMutation({
    onSuccess: () => {
      countQuery.refetch();
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const applyMutation = trpc.stockCounts.apply.useMutation({
    onSuccess: () => {
      toast({ variant: "success", description: t("applySuccess") });
      countQuery.refetch();
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const cancelMutation = trpc.stockCounts.cancel.useMutation({
    onSuccess: () => {
      toast({ variant: "success", description: t("cancelSuccess") });
      countQuery.refetch();
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const editSchema = useMemo(
    () =>
      z.object({
        countedQty: z.coerce.number().int().min(0, t("countedNonNegative")),
      }),
    [t],
  );

  const editForm = useForm<z.infer<typeof editSchema>>({
    resolver: zodResolver(editSchema),
    defaultValues: { countedQty: 0 },
  });

  useEffect(() => {
    if (editingLine) {
      editForm.reset({ countedQty: editingLine.countedQty });
    }
  }, [editingLine, editForm]);

  const lines: CountLine[] = count?.lines ?? [];
  const summary = count?.summary ?? {
    totalLines: 0,
    varianceLines: 0,
    overages: 0,
    shortages: 0,
  };

  const overageLines: CountLine[] = lines.filter((line) => line.deltaQty > 0);
  const shortageLines: CountLine[] = lines.filter((line) => line.deltaQty < 0);

  const isLocked = count?.status === "APPLIED" || count?.status === "CANCELLED";

  const movementQuery = trpc.inventory.movements.useQuery(
    movementTarget && count?.storeId
      ? {
          storeId: count.storeId,
          productId: movementTarget.productId,
          variantId: movementTarget.variantId ?? undefined,
        }
      : { storeId: "", productId: "" },
    { enabled: Boolean(movementTarget && count?.storeId) },
  );

  const downloadCount = () => {
    if (!count) {
      return;
    }
    const header = ["sku", "product", "variant", "expected", "counted", "delta"];
    const rows = count.lines.map((line: CountLine) => {
      const variantLabel = line.variant?.name ?? "";
      return [
        line.product.sku,
        line.product.name,
        variantLabel,
        String(line.expectedOnHand),
        String(line.countedQty),
        String(line.deltaQty),
      ];
    });
    downloadTableFile({
      format: exportFormat,
      fileNameBase: `stock-count-${count.code}`,
      header,
      rows,
    });
  };

  const movementLabel = (type: string) => getStockMovementLabel(tInventory, type);

  const statusLabel = (status: string) => {
    switch (status) {
      case "DRAFT":
        return t("statusDraft");
      case "IN_PROGRESS":
        return t("statusInProgress");
      case "APPLIED":
        return t("statusApplied");
      case "CANCELLED":
        return t("statusCancelled");
      default:
        return status;
    }
  };

  return (
    <div>
      <PageHeader
        title={count ? `${t("detailTitle")} • ${count.code}` : t("detailTitle")}
        subtitle={count?.store?.name ?? t("detailSubtitle")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {count?.status ? (
              <Badge variant={statusVariants[count.status] ?? "default"}>
                {statusLabel(count.status)}
              </Badge>
            ) : null}
            {canManage ? (
              <Button
                variant="secondary"
                className="w-full sm:w-auto"
                disabled={!count || isLocked || cancelMutation.isLoading}
                onClick={() => {
                  if (!count) {
                    return;
                  }
                  const confirmed = window.confirm(t("confirmCancel"));
                  if (!confirmed) {
                    return;
                  }
                  cancelMutation.mutate({ stockCountId: count.id });
                }}
              >
                {cancelMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                {t("cancel")}
              </Button>
            ) : null}
            <HelpLink articleId="stockCounts" />
            <Button
              className="w-full sm:w-auto"
              disabled={!count || isLocked || !canManage || applyMutation.isLoading}
              onClick={() => {
                if (!count) {
                  return;
                }
                const confirmed = window.confirm(
                  t("confirmApply", { count: summary.varianceLines }),
                );
                if (!confirmed) {
                  return;
                }
                applyMutation.mutate({
                  stockCountId: count.id,
                  idempotencyKey: crypto.randomUUID(),
                });
              }}
            >
              {applyMutation.isLoading ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <AddIcon className="h-4 w-4" aria-hidden />
              )}
              {applyMutation.isLoading ? tCommon("loading") : t("apply")}
            </Button>
          </div>
        }
      />

      {countQuery.error ? (
        <p className="mb-4 text-sm text-red-500">
          {translateError(tErrors, countQuery.error)}
        </p>
      ) : null}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t("scanTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1">
              <Input
                ref={scanInputRef}
                value={scanValue}
                onChange={(event) => setScanValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") {
                    return;
                  }
                  event.preventDefault();
                  if (!scanValue.trim() || !count || isLocked) {
                    return;
                  }
                  addLineMutation.mutate({
                    stockCountId: count.id,
                    storeId: count.storeId,
                    barcodeOrQuery: scanValue,
                    mode: "increment",
                  });
                }}
                placeholder={t("scanPlaceholder")}
                disabled={!count || isLocked || addLineMutation.isLoading}
              />
              <p className="mt-2 text-xs text-gray-500">{t("scanHint")}</p>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={scanMode} onCheckedChange={setScanMode} />
              <span className="text-sm text-gray-500">{t("scanMode")}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t("linesTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveDataList
              items={lines}
              getKey={(line) => line.id}
              renderDesktop={(visibleItems) => (
                <div className="overflow-x-auto">
                  <Table className="min-w-[800px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tCommon("product")}</TableHead>
                        <TableHead className="hidden sm:table-cell">{t("variant")}</TableHead>
                        <TableHead>{t("expected")}</TableHead>
                        <TableHead>{t("counted")}</TableHead>
                        <TableHead>{t("delta")}</TableHead>
                        <TableHead className="hidden md:table-cell">{t("lastScanned")}</TableHead>
                        <TableHead>{tCommon("actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleItems.map((line) => (
                        <TableRow key={line.id}>
                          <TableCell className="font-medium">
                            {line.product.name}
                            <div className="text-xs text-gray-500">{line.product.sku}</div>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            {line.variant?.name ?? tCommon("notAvailable")}
                          </TableCell>
                          <TableCell>{formatNumber(line.expectedOnHand, locale)}</TableCell>
                          <TableCell>{formatNumber(line.countedQty, locale)}</TableCell>
                          <TableCell
                            className={
                              line.deltaQty === 0
                                ? ""
                                : line.deltaQty > 0
                                  ? "text-emerald-600"
                                  : "text-red-600"
                            }
                          >
                            {formatNumber(line.deltaQty, locale)}
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            {line.lastScannedAt
                              ? formatDateTime(line.lastScannedAt, locale)
                              : tCommon("notAvailable")}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="shadow-none"
                                aria-label={t("editCounted")}
                                disabled={isLocked}
                                onClick={() => setEditingLine(line)}
                              >
                                <EditIcon className="h-4 w-4" aria-hidden />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="shadow-none"
                                aria-label={t("viewMovements")}
                                onClick={() =>
                                  setMovementTarget({
                                    productId: line.productId,
                                    variantId: line.variantId,
                                    label: line.variant?.name
                                      ? `${line.product.name} • ${line.variant.name}`
                                      : line.product.name,
                                  })
                                }
                              >
                                <ViewIcon className="h-4 w-4" aria-hidden />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="text-danger shadow-none hover:text-danger"
                                aria-label={t("removeLine")}
                                disabled={isLocked || removeLineMutation.isLoading}
                                onClick={() => {
                                  const confirmed = window.confirm(t("confirmRemoveLine"));
                                  if (!confirmed) {
                                    return;
                                  }
                                  removeLineMutation.mutate({ lineId: line.id });
                                }}
                              >
                                <DeleteIcon className="h-4 w-4" aria-hidden />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              renderMobile={(line) => {
                const deltaClass =
                  line.deltaQty === 0
                    ? "text-gray-500"
                    : line.deltaQty > 0
                      ? "text-emerald-600"
                      : "text-red-600";
                const actions = [
                  {
                    key: "edit",
                    label: t("editCounted"),
                    icon: EditIcon,
                    disabled: isLocked,
                    onSelect: () => setEditingLine(line),
                  },
                  {
                    key: "movements",
                    label: t("viewMovements"),
                    icon: ViewIcon,
                    onSelect: () =>
                      setMovementTarget({
                        productId: line.productId,
                        variantId: line.variantId,
                        label: line.variant?.name
                          ? `${line.product.name} • ${line.variant.name}`
                          : line.product.name,
                      }),
                  },
                  {
                    key: "remove",
                    label: t("removeLine"),
                    icon: DeleteIcon,
                    variant: "danger",
                    disabled: isLocked || removeLineMutation.isLoading,
                    onSelect: () => {
                      const confirmed = window.confirm(t("confirmRemoveLine"));
                      if (!confirmed) {
                        return;
                      }
                      removeLineMutation.mutate({ lineId: line.id });
                    },
                  },
                ];

                return (
                  <div className="rounded-md border border-gray-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{line.product.name}</p>
                        <p className="text-xs text-gray-500">{line.product.sku}</p>
                        <p className="text-xs text-gray-500">
                          {line.variant?.name ?? tCommon("notAvailable")}
                        </p>
                        <p className="text-xs text-gray-500">
                          {t("expected")}: {formatNumber(line.expectedOnHand, locale)}
                        </p>
                        <p className="text-xs text-gray-500">
                          {t("counted")}: {formatNumber(line.countedQty, locale)}
                        </p>
                        <p className={`text-xs ${deltaClass}`}>
                          {t("delta")}: {formatNumber(line.deltaQty, locale)}
                        </p>
                        <p className="text-xs text-gray-500">
                          {t("lastScanned")}:{" "}
                          {line.lastScannedAt
                            ? formatDateTime(line.lastScannedAt, locale)
                            : tCommon("notAvailable")}
                        </p>
                      </div>
                      <RowActions
                        actions={actions}
                        maxInline={1}
                        moreLabel={tCommon("tooltips.moreActions")}
                      />
                    </div>
                  </div>
                );
              }}
            />
            {!lines.length ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
                <EmptyIcon className="h-4 w-4" aria-hidden />
                {t("noLines")}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("summaryTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span>{t("totalLines")}</span>
              <span className="font-semibold">{summary.totalLines}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>{t("varianceLines")}</span>
              <span className="font-semibold">{summary.varianceLines}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>{t("overages")}</span>
              <span className="font-semibold text-emerald-600">{summary.overages}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>{t("shortages")}</span>
              <span className="font-semibold text-red-600">{summary.shortages}</span>
            </div>
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs text-gray-500">
              {t("summaryHint")}
            </div>
          </CardContent>
        </Card>
      </div>

      {count?.status === "APPLIED" ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("overagesTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              {overageLines.length ? (
                <ul className="space-y-2 text-sm">
                  {overageLines.map((line) => (
                    <li key={line.id} className="flex items-center justify-between">
                      <span>
                        {line.product.name}
                        {line.variant?.name ? ` • ${line.variant.name}` : ""}
                      </span>
                      <span className="font-semibold text-emerald-600">
                        +{formatNumber(line.deltaQty, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-500">{t("noOverages")}</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{t("shortagesTitle")}</CardTitle>
              <div className="flex items-center gap-2">
                <div className="w-[140px]">
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
                <Button variant="secondary" size="sm" onClick={downloadCount}>
                  <DownloadIcon className="h-4 w-4" aria-hidden />
                  {exportFormat === "csv" ? t("exportCsv") : t("exportXlsx")}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {shortageLines.length ? (
                <ul className="space-y-2 text-sm">
                  {shortageLines.map((line) => (
                    <li key={line.id} className="flex items-center justify-between">
                      <span>
                        {line.product.name}
                        {line.variant?.name ? ` • ${line.variant.name}` : ""}
                      </span>
                      <span className="font-semibold text-red-600">
                        {formatNumber(line.deltaQty, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-500">{t("noShortages")}</p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Modal
        open={Boolean(editingLine)}
        onOpenChange={(open) => {
          if (!open) {
            setEditingLine(null);
          }
        }}
        title={t("editCounted")}
        subtitle={editingLine?.product?.name ?? ""}
      >
        <Form {...editForm}>
          <form
            className="space-y-4"
            onSubmit={editForm.handleSubmit((values) => {
              if (!editingLine) {
                return;
              }
              setQtyMutation.mutate({ lineId: editingLine.id, countedQty: values.countedQty });
            })}
          >
            <FormField
              control={editForm.control}
              name="countedQty"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("counted")}</FormLabel>
                  <FormControl>
                    <Input {...field} type="number" inputMode="numeric" />
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
                onClick={() => setEditingLine(null)}
              >
                {tCommon("cancel")}
              </Button>
              <Button type="submit" className="w-full sm:w-auto" disabled={setQtyMutation.isLoading}>
                {setQtyMutation.isLoading ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <EditIcon className="h-4 w-4" aria-hidden />
                )}
                {setQtyMutation.isLoading ? tCommon("loading") : t("saveCounted")}
              </Button>
            </FormActions>
          </form>
        </Form>
      </Modal>

      <Modal
        open={Boolean(movementTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setMovementTarget(null);
          }
        }}
        title={t("movementHistory")}
        subtitle={movementTarget?.label ?? ""}
      >
        {movementQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Spinner className="h-4 w-4" />
            {tCommon("loading")}
          </div>
        ) : movementQuery.data?.length ? (
          <ResponsiveDataList
            items={movementQuery.data}
            getKey={(movement) => movement.id}
            renderDesktop={(visibleItems) => (
              <div className="overflow-x-auto">
                <Table className="min-w-[560px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tInventory("movementTypeLabel")}</TableHead>
                      <TableHead>{tInventory("qtyDelta")}</TableHead>
                      <TableHead>{tInventory("movementDate")}</TableHead>
                      <TableHead>{tInventory("movementUser")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleItems.map((movement) => (
                      <TableRow key={movement.id}>
                        <TableCell>{movementLabel(movement.type)}</TableCell>
                        <TableCell>{formatNumber(movement.qtyDelta, locale)}</TableCell>
                        <TableCell>{formatDateTime(movement.createdAt, locale)}</TableCell>
                        <TableCell>
                          {movement.createdBy?.name ??
                            movement.createdBy?.email ??
                            tCommon("notAvailable")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            renderMobile={(movement) => (
              <div className="rounded-md border border-gray-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">
                      {movementLabel(movement.type)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatDateTime(movement.createdAt, locale)}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-ink">
                    {formatNumber(movement.qtyDelta, locale)}
                  </p>
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  <span className="text-[11px] uppercase tracking-wide text-gray-400">
                    {tInventory("movementUser")}
                  </span>
                  <div className="text-gray-700">
                    {movement.createdBy?.name ??
                      movement.createdBy?.email ??
                      tCommon("notAvailable")}
                  </div>
                </div>
              </div>
            )}
          />
        ) : (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <EmptyIcon className="h-4 w-4" aria-hidden />
            {tInventory("noMovements")}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default StockCountDetailPage;

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";

import { PageHeader } from "@/components/page-header";
import { AddIcon, BackIcon, DeleteIcon, EditIcon, EmptyIcon, SearchIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { formatCurrencyKGS } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

type EditorLineState = {
  key: string;
  lineId: string | null;
  customerOrderLineId: string | null;
  productId: string;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  quantityInput: string;
  unitCostInput: string;
};

type EditorProductChoice = {
  product: { id: string; name: string; sku?: string | null };
  snapshot: { variantId?: string | null };
  variant?: { name?: string | null } | null;
  primaryBarcode?: string | null;
  unitCostKgs?: number | null;
  customerOrderLineId?: string | null;
};

export const ProductMovementDocumentEditorPage = ({
  documentKey,
  backHref = "/inventory/movements",
}: {
  documentKey: string;
  backHref?: string;
}) => {
  const t = useTranslations("inventory.movementJournal");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const trpcUtils = trpc.useUtils();

  const [lines, setLines] = useState<EditorLineState[]>([]);
  const [search, setSearch] = useState("");
  const [replaceLineKey, setReplaceLineKey] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [destinationStoreId, setDestinationStoreId] = useState("");
  const [compactLines, setCompactLines] = useState(false);

  const storesQuery = trpc.stores.list.useQuery();
  const stores = storesQuery.data ?? [];
  const editableDocumentQuery = trpc.inventory.editableProductMovementDocument.useQuery(
    { documentKey },
    { enabled: Boolean(documentKey), staleTime: 0 },
  );
  const editableDocument = editableDocumentQuery.data ?? null;
  const storeId = editableDocument?.storeId ?? "";

  const productSearchQuery = trpc.inventory.searchProducts.useQuery(
    {
      storeId,
      search: search.trim() || undefined,
      limit: 30,
    },
    {
      enabled: Boolean(editableDocument && storeId && search.trim()),
      keepPreviousData: true,
    },
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      setCompactLines(false);
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const update = () => setCompactLines(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!editableDocument) {
      return;
    }
    setNotes(editableDocument.notes ?? "");
    setReason("");
    setReplaceLineKey(null);
    setDestinationStoreId(editableDocument.destinationStoreId ?? "");
    setLines(
      editableDocument.lines.map((line, index) => ({
        key: line.lineId ?? `${line.productId}:${line.variantId ?? "BASE"}:${index}`,
        lineId: line.lineId,
        customerOrderLineId: line.customerOrderLineId,
        productId: line.productId,
        variantId: line.variantId,
        productName: line.productName,
        variantName: line.variantName,
        quantityInput: String(line.quantity),
        unitCostInput: line.unitCostKgs === null ? "" : String(line.unitCostKgs),
      })),
    );
  }, [editableDocument]);

  const productChoices = useMemo<EditorProductChoice[]>(
    () =>
      (productSearchQuery.data ?? []).map((result) => ({
        product: result.product,
        snapshot: result.snapshot,
        variant: result.variant,
        primaryBarcode: result.primaryBarcode,
        unitCostKgs: result.unitCostKgs,
        customerOrderLineId: null,
      })),
    [productSearchQuery.data],
  );

  const parseNumberInput = (value: string) => {
    const normalized = value.trim().replace(",", ".");
    if (!normalized) {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const updateLine = (key: string, patch: Partial<EditorLineState>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const removeLine = (key: string) => {
    setLines((current) => current.filter((line) => line.key !== key));
  };

  const applyProductToLine = (lineKey: string, result: EditorProductChoice) => {
    if (
      lines.some(
        (line) =>
          line.key !== lineKey &&
          line.productId === result.product.id &&
          (line.variantId ?? null) === (result.snapshot.variantId ?? null),
      )
    ) {
      toast({ variant: "error", description: t("editDuplicateLine") });
      return;
    }
    updateLine(lineKey, {
      productId: result.product.id,
      variantId: result.snapshot.variantId ?? null,
      productName: result.product.name,
      variantName: result.variant?.name ?? null,
      customerOrderLineId: result.customerOrderLineId ?? null,
      unitCostInput: String(result.unitCostKgs ?? 0),
    });
    setSearch("");
    setReplaceLineKey(null);
  };

  const addProduct = (result: EditorProductChoice) => {
    if (replaceLineKey) {
      applyProductToLine(replaceLineKey, result);
      return;
    }
    if (
      lines.some(
        (line) =>
          line.productId === result.product.id &&
          (line.variantId ?? null) === (result.snapshot.variantId ?? null),
      )
    ) {
      toast({ variant: "error", description: t("editDuplicateLine") });
      return;
    }
    setLines((current) => [
      ...current,
      {
        key:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${result.product.id}:${Date.now()}`,
        lineId: null,
        customerOrderLineId: result.customerOrderLineId ?? null,
        productId: result.product.id,
        variantId: result.snapshot.variantId ?? null,
        productName: result.product.name,
        variantName: result.variant?.name ?? null,
        quantityInput: "1",
        unitCostInput: String(result.unitCostKgs ?? 0),
      },
    ]);
    setSearch("");
  };

  const getLineTotal = useCallback((line: EditorLineState) => {
    const quantity = parseNumberInput(line.quantityInput) ?? 0;
    const unitCost = parseNumberInput(line.unitCostInput) ?? 0;
    return quantity * unitCost;
  }, []);

  const total = lines.reduce((sum, line) => sum + getLineTotal(line), 0);

  const editMutation = trpc.inventory.editProductMovementDocument.useMutation({
    onSuccess: async () => {
      toast({ variant: "success", description: t("editSaved") });
      await Promise.all([
        trpcUtils.inventory.productMovements.invalidate(),
        trpcUtils.inventory.productMovementDocument.invalidate(),
        trpcUtils.inventory.editableProductMovementDocument.invalidate(),
      ]);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const submitEdit = async () => {
    if (!editableDocument || !lines.length) {
      toast({ variant: "error", description: t("editLinesRequired") });
      return;
    }

    const normalized = lines.map((line) => {
      const quantity = parseNumberInput(line.quantityInput);
      const unitCostKgs = parseNumberInput(line.unitCostInput);
      return { line, quantity, unitCostKgs };
    });
    const invalidLine = normalized.find(
      ({ quantity, unitCostKgs }) =>
        quantity === null ||
        !Number.isInteger(quantity) ||
        quantity <= 0 ||
        unitCostKgs === null ||
        unitCostKgs < 0,
    );
    if (invalidLine) {
      toast({ variant: "error", description: t("editInvalidLine") });
      return;
    }

    await editMutation.mutateAsync({
      documentKey,
      notes,
      reason,
      destinationStoreId:
        editableDocument.documentType === "TRANSFER" ? destinationStoreId : undefined,
      lines: normalized.map(({ line, quantity, unitCostKgs }) => ({
        lineId: line.lineId,
        customerOrderLineId: line.customerOrderLineId,
        productId: line.productId,
        variantId: line.variantId,
        quantity: quantity ?? 0,
        unitCostKgs,
      })),
      idempotencyKey:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `movement-edit-${Date.now()}`,
    });
  };

  const lineColumns = useMemo<ColumnDef<EditorLineState>[]>(
    () => [
      {
        id: "product",
        header: tCommon("product"),
        cell: ({ row }) => {
          const line = row.original;
          return (
            <div className="min-w-0">
              <p className="truncate font-medium">
                {line.productName}
                {line.variantName ? ` · ${line.variantName}` : ""}
              </p>
              {replaceLineKey === line.key ? (
                <p className="text-xs text-primary">{t("editReplaceActive")}</p>
              ) : null}
            </div>
          );
        },
        meta: { className: "min-w-[18rem]" },
      },
      {
        id: "quantity",
        header: t("quantity"),
        cell: ({ row }) => {
          const line = row.original;
          return (
            <Input
              value={line.quantityInput}
              inputMode="numeric"
              className="text-right"
              data-testid="movement-edit-line-qty"
              onChange={(event) => updateLine(line.key, { quantityInput: event.target.value })}
            />
          );
        },
        meta: { className: "w-28 min-w-[7rem] text-right" },
      },
      {
        id: "unitCost",
        header: t("printUnitCost"),
        cell: ({ row }) => {
          const line = row.original;
          return (
            <Input
              value={line.unitCostInput}
              inputMode="decimal"
              className="text-right"
              data-testid="movement-edit-line-price"
              onChange={(event) => updateLine(line.key, { unitCostInput: event.target.value })}
            />
          );
        },
        meta: { className: "w-36 min-w-[9rem] text-right" },
      },
      {
        id: "lineTotal",
        header: t("printLineTotal"),
        cell: ({ row }) => formatCurrencyKGS(getLineTotal(row.original), locale),
        meta: { className: "w-36 min-w-[9rem] text-right" },
      },
      {
        id: "actions",
        header: tCommon("actions"),
        cell: ({ row }) => {
          const line = row.original;
          return (
            <div className="flex justify-end gap-1">
              <Button
                type="button"
                variant={replaceLineKey === line.key ? "default" : "secondary"}
                size="sm"
                data-testid="movement-edit-line-replace"
                onClick={() => {
                  setReplaceLineKey(line.key);
                  setSearch("");
                }}
              >
                <EditIcon className="h-4 w-4" aria-hidden />
                {t("editReplace")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                data-testid="movement-edit-line-remove"
                onClick={() => removeLine(line.key)}
                aria-label={t("editRemoveLine")}
                title={t("editRemoveLine")}
              >
                <DeleteIcon className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          );
        },
        meta: { className: "w-40 min-w-[10rem] text-right" },
      },
    ],
    [getLineTotal, locale, replaceLineKey, t, tCommon],
  );

  const documentNumber = editableDocument?.documentNumber || "";
  const documentType = editableDocument?.documentType;
  const documentLabel = documentType ? t(`type.${documentType}`) : t("editTitle");
  const isTransfer = documentType === "TRANSFER";

  return (
    <div data-testid="movement-native-edit-page">
      <PageHeader
        title={documentLabel}
        subtitle={
          documentNumber
            ? t("editSubtitle", { number: documentNumber })
            : t("nativeEditSubtitle")
        }
        action={
          <Button asChild variant="secondary">
            <Link href={backHref}>
              <BackIcon className="h-4 w-4" aria-hidden />
              {t("backToMovements")}
            </Link>
          </Button>
        }
      />

      {editableDocumentQuery.error ? (
        <Alert variant="destructive" role="alert" className="mb-4">
          {translateError(tErrors, editableDocumentQuery.error)}
        </Alert>
      ) : null}

      {editableDocumentQuery.isLoading ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="grid gap-3 md:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-16 rounded-xl" />
              ))}
            </div>
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-12 rounded-xl" />
            ))}
          </CardContent>
        </Card>
      ) : editableDocument ? (
        <Card>
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>{t("editTitle")}</CardTitle>
              <Badge variant="muted">{documentNumber || editableDocument.referenceId}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-border/65 bg-muted/35 p-3">
                <p className="text-xs text-muted-foreground">{t("documentType")}</p>
                <p className="mt-1 font-medium text-foreground">{documentLabel}</p>
              </div>
              <div className="rounded-xl border border-border/65 bg-muted/35 p-3">
                <p className="text-xs text-muted-foreground">{t("store")}</p>
                <p className="mt-1 font-medium text-foreground">
                  {stores.find((store) => store.id === editableDocument.sourceStoreId)?.name ||
                    stores.find((store) => store.id === editableDocument.storeId)?.name ||
                    tCommon("notAvailable")}
                </p>
              </div>
              <div className="rounded-xl border border-border/65 bg-muted/35 p-3">
                <p className="text-xs text-muted-foreground">{t("amount")}</p>
                <p className="mt-1 font-medium text-foreground">
                  {formatCurrencyKGS(total, locale)}
                </p>
              </div>
            </div>

            {isTransfer ? (
              <div className="space-y-1">
                <Label htmlFor="movement-edit-destination-store">{t("recipient")}</Label>
                <Select value={destinationStoreId} onValueChange={setDestinationStoreId}>
                  <SelectTrigger
                    id="movement-edit-destination-store"
                    data-testid="movement-edit-destination-store"
                  >
                    <SelectValue placeholder={t("recipientPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {stores
                      .filter((store) => store.id !== editableDocument.sourceStoreId)
                      .map((store) => (
                        <SelectItem key={store.id} value={store.id}>
                          {store.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="space-y-3 rounded-xl border border-border/65 bg-muted/25 p-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-end">
                <div className="min-w-0 flex-1 space-y-1">
                  <Label htmlFor="movement-edit-search">
                    {replaceLineKey ? t("editReplaceProduct") : t("editAddProduct")}
                  </Label>
                  <div className="relative">
                    <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="movement-edit-search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={t("editProductSearchPlaceholder")}
                      className="pl-9"
                      data-testid="movement-edit-product-search"
                    />
                  </div>
                </div>
                {replaceLineKey ? (
                  <Button type="button" variant="secondary" onClick={() => setReplaceLineKey(null)}>
                    {t("editCancelReplace")}
                  </Button>
                ) : null}
              </div>

              {search.trim() ? (
                <div className="max-h-56 overflow-y-auto rounded-xl border border-border/65 bg-card shadow-sm">
                  {productSearchQuery.isLoading ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground">{tCommon("loading")}</p>
                  ) : productChoices.length ? (
                    productChoices.map((result) => (
                      <button
                        key={`${result.product.id}:${result.snapshot.variantId ?? "BASE"}`}
                        type="button"
                        data-testid="movement-edit-product-result"
                        className="flex w-full items-center justify-between gap-3 border-b border-border/55 px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-primary/5"
                        onClick={() => addProduct(result)}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">
                            {result.product.name}
                            {result.variant?.name ? ` · ${result.variant.name}` : ""}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {result.product.sku ||
                              result.primaryBarcode ||
                              tCommon("notAvailable")}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {replaceLineKey ? t("editReplace") : t("editAdd")}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-2 text-sm text-muted-foreground">
                      {tCommon("nothingFound")}
                    </p>
                  )}
                </div>
              ) : null}
            </div>

            {lines.length ? (
              compactLines ? (
                <div className="space-y-2" data-testid="movement-edit-lines-compact">
                  {lines.map((line) => (
                    <div
                      key={line.key}
                      data-testid="movement-edit-line"
                      className="space-y-3 rounded-xl border border-border/65 bg-card p-3 shadow-sm"
                    >
                      <div className="min-w-0">
                        <p className="break-words font-medium text-foreground">
                          {line.productName}
                          {line.variantName ? ` · ${line.variantName}` : ""}
                        </p>
                        {replaceLineKey === line.key ? (
                          <p className="mt-1 text-xs font-medium text-primary">
                            {t("editReplaceActive")}
                          </p>
                        ) : null}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label>{t("quantity")}</Label>
                          <Input
                            value={line.quantityInput}
                            inputMode="numeric"
                            className="text-right"
                            data-testid="movement-edit-line-qty"
                            onChange={(event) =>
                              updateLine(line.key, { quantityInput: event.target.value })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>{t("printUnitCost")}</Label>
                          <Input
                            value={line.unitCostInput}
                            inputMode="decimal"
                            className="text-right"
                            data-testid="movement-edit-line-price"
                            onChange={(event) =>
                              updateLine(line.key, { unitCostInput: event.target.value })
                            }
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/45 px-3 py-2 text-sm">
                        <span className="text-muted-foreground">{t("printLineTotal")}</span>
                        <span className="font-medium text-foreground">
                          {formatCurrencyKGS(getLineTotal(line), locale)}
                        </span>
                      </div>
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                        <Button
                          type="button"
                          variant={replaceLineKey === line.key ? "default" : "secondary"}
                          size="sm"
                          data-testid="movement-edit-line-replace"
                          onClick={() => {
                            setReplaceLineKey(line.key);
                            setSearch("");
                          }}
                        >
                          <EditIcon className="h-4 w-4" aria-hidden />
                          {t("editReplace")}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          data-testid="movement-edit-line-remove"
                          onClick={() => removeLine(line.key)}
                          aria-label={t("editRemoveLine")}
                          title={t("editRemoveLine")}
                        >
                          <DeleteIcon className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <DataTable
                  columns={lineColumns}
                  data={lines}
                  getRowId={(line) => line.key}
                  rowTestId="movement-edit-line"
                  tableClassName="min-w-[820px]"
                />
              )
            ) : (
              <EmptyState
                icon={<EmptyIcon className="h-8 w-8" aria-hidden />}
                description={t("editLinesRequired")}
                className="min-h-[10rem] rounded-xl border border-dashed"
              />
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="movement-edit-notes">{t("comment")}</Label>
                <Textarea
                  id="movement-edit-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  data-testid="movement-edit-notes"
                  rows={3}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="movement-edit-reason">{t("reason")}</Label>
                <Textarea
                  id="movement-edit-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={t("editReasonPlaceholder")}
                  data-testid="movement-edit-reason"
                  rows={3}
                />
              </div>
            </div>

            <div className="sticky bottom-3 z-10 flex flex-col gap-2 rounded-xl border border-border/65 bg-card/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-end">
              <div className="flex min-h-10 items-center justify-between rounded-xl bg-muted/45 px-3 py-2 text-sm sm:mr-auto sm:min-w-[16rem]">
                <span className="text-muted-foreground">{t("amount")}</span>
                <span className="font-semibold text-foreground" data-testid="movement-edit-total">
                  {formatCurrencyKGS(total, locale)}
                </span>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.push(backHref)}
                disabled={editMutation.isLoading}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="button"
                onClick={submitEdit}
                disabled={editMutation.isLoading}
                data-testid="movement-edit-save"
              >
                <AddIcon className="h-4 w-4" aria-hidden />
                {editMutation.isLoading ? tCommon("saving") : tCommon("save")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <EmptyState description={t("editUnavailable.missingReference")} />
      )}
    </div>
  );
};

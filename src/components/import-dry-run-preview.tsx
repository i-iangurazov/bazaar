"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { ResponsiveDataList } from "@/components/responsive-data-list";
import { Badge } from "@/components/ui/badge";
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

type ImportPreviewValue = string | number | string[] | null;

type ImportPreviewRow = {
  sourceRowNumber: number;
  sku: string;
  name: string | null;
  action: "create" | "update" | "skipped";
  matchStatus:
    | "new"
    | "matched_barcode"
    | "matched_sku"
    | "matched_name_category"
    | "matched_name_price"
    | "possible_duplicate"
    | "cross_store_conflict"
    | "error";
  matchReason:
    | "barcode"
    | "sku"
    | "name_category"
    | "name_price"
    | "possible_duplicate"
    | "cross_store_barcode"
    | "cross_store_sku"
    | "none";
  existingProduct: {
    id: string;
    sku: string;
    name: string;
    isDeleted: boolean;
  } | null;
  possibleDuplicate: {
    id: string;
    sku: string;
    name: string;
    isDeleted: boolean;
  } | null;
  changes: Array<{
    field:
      | "name"
      | "unit"
      | "category"
      | "color"
      | "description"
      | "photoUrl"
      | "variants"
      | "barcodes"
      | "basePriceKgs"
      | "purchasePriceKgs"
      | "avgCostKgs"
      | "minStock"
      | "stockQty";
    before: ImportPreviewValue;
    after: ImportPreviewValue;
  }>;
  warnings: Array<
    | {
        code: "barcodeConflict";
        severity: "blocking";
        barcode: string;
        productId: string;
        productSku: string;
        productName: string;
        isDeleted: boolean;
      }
    | {
        code: "likelyDuplicateName";
        severity: "warning";
        productId: string;
        productSku: string;
        productName: string;
        isDeleted: boolean;
      }
    | {
        code: "crossStoreSkuConflict";
        severity: "blocking";
        productId: string;
        productSku: string;
        productName: string;
        isDeleted: boolean;
      }
    | {
        code: "crossStoreBarcodeConflict";
        severity: "blocking";
        barcode: string;
        productId: string;
        productSku: string;
        productName: string;
        isDeleted: boolean;
      }
    | {
        code: "archivedProductWillBeRestored";
        severity: "warning";
        productId: string;
        productSku: string;
        productName: string;
      }
    | {
        code: "missingExistingProduct";
        severity: "warning";
      }
  >;
  hasBlockingWarnings: boolean;
};

export type ImportDryRunPreviewData = {
  rows: ImportPreviewRow[];
  summary: {
    creates: number;
    updates: number;
    skipped: number;
    warningCount: number;
    blockingWarningCount: number;
    possibleDuplicateCount?: number;
    totalRows: number;
    returnedRows: number;
    truncated: boolean;
  };
};

type ImportDryRunPreviewProps = {
  preview: ImportDryRunPreviewData;
  rowActions?: Record<
    number,
    {
      sourceRowNumber: number;
      action: "create" | "update" | "skip";
      existingProductId?: string;
    }
  >;
  onRowActionChange?: (
    sourceRowNumber: number,
    action: "create" | "update" | "skip",
    existingProductId?: string,
  ) => void;
};

const formatPreviewValue = (value: ImportPreviewValue, fallback: string) => {
  if (Array.isArray(value)) {
    return value.length ? value.join(", ") : fallback;
  }
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  return String(value);
};

export const ImportDryRunPreview = ({
  preview,
  rowActions,
  onRowActionChange,
}: ImportDryRunPreviewProps) => {
  const t = useTranslations("imports");
  const tCommon = useTranslations("common");

  const resolveActionVariant = (
    action: ImportPreviewRow["action"],
    hasBlockingWarnings: boolean,
  ) => {
    if (hasBlockingWarnings) {
      return "danger" as const;
    }
    if (action === "create") {
      return "success" as const;
    }
    if (action === "update") {
      return "warning" as const;
    }
    return "muted" as const;
  };

  const resolveActionLabel = (action: ImportPreviewRow["action"]) => {
    if (action === "create") {
      return t("dryRunActionCreate");
    }
    if (action === "update") {
      return t("dryRunActionUpdate");
    }
    return t("dryRunActionSkip");
  };

  const resolveMatchStatusLabel = (status: ImportPreviewRow["matchStatus"]) =>
    t(`dryRunMatchStatus.${status}`);

  const renderRowDecision = (row: ImportPreviewRow) => {
    if (row.matchStatus !== "possible_duplicate" || !row.possibleDuplicate || !onRowActionChange) {
      return null;
    }
    const selected = rowActions?.[row.sourceRowNumber]?.action ?? "skip";
    return (
      <div className="space-y-1">
        <p className="text-[11px] font-medium text-warning-foreground">
          {t("dryRunPossibleDuplicateDecision")}
        </p>
        <Select
          value={selected}
          onValueChange={(value) =>
            onRowActionChange(
              row.sourceRowNumber,
              value as "create" | "update" | "skip",
              row.possibleDuplicate?.id,
            )
          }
        >
          <SelectTrigger className="h-8 min-w-[150px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="skip">{t("dryRunActionSkip")}</SelectItem>
            <SelectItem value="update">{t("dryRunActionUpdate")}</SelectItem>
            <SelectItem value="create">{t("dryRunActionCreate")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  };

  const resolveFieldLabel = (field: ImportPreviewRow["changes"][number]["field"]) => {
    switch (field) {
      case "name":
        return t("fieldName");
      case "unit":
        return t("fieldUnit");
      case "category":
        return t("fieldCategory");
      case "color":
        return t("fieldColor");
      case "description":
        return t("fieldDescription");
      case "photoUrl":
        return t("fieldPhotoUrl");
      case "variants":
        return t("fieldVariants");
      case "barcodes":
        return t("fieldBarcodes");
      case "basePriceKgs":
        return t("fieldBasePrice");
      case "purchasePriceKgs":
        return t("fieldPurchasePrice");
      case "avgCostKgs":
        return t("fieldAvgCost");
      case "minStock":
        return t("fieldMinStock");
      case "stockQty":
        return t("fieldStockQty");
    }
  };

  const renderWarnings = (row: ImportPreviewRow) =>
    row.warnings.length ? (
      <div className="space-y-1">
        {row.warnings.map((warning, index) => {
          if (warning.code === "barcodeConflict") {
            return (
              <p
                key={`${warning.code}-${warning.barcode}-${warning.productId}-${index}`}
                className="text-xs text-danger"
              >
                {t("dryRunWarningBarcodeConflict", {
                  barcode: warning.barcode,
                  product: warning.productName,
                  sku: warning.productSku,
                })}
              </p>
            );
          }
          if (warning.code === "likelyDuplicateName") {
            return (
              <p
                key={`${warning.code}-${warning.productId}-${index}`}
                className="text-xs text-warning-foreground"
              >
                {t("dryRunWarningLikelyDuplicate", {
                  product: warning.productName,
                  sku: warning.productSku,
                })}
              </p>
            );
          }
          if (warning.code === "crossStoreSkuConflict") {
            return (
              <p
                key={`${warning.code}-${warning.productId}-${index}`}
                className="text-xs text-danger"
              >
                {t("dryRunWarningCrossStoreSku", {
                  product: warning.productName,
                  sku: warning.productSku,
                })}
              </p>
            );
          }
          if (warning.code === "crossStoreBarcodeConflict") {
            return (
              <p
                key={`${warning.code}-${warning.barcode}-${warning.productId}-${index}`}
                className="text-xs text-danger"
              >
                {t("dryRunWarningCrossStoreBarcode", {
                  barcode: warning.barcode,
                  product: warning.productName,
                  sku: warning.productSku,
                })}
              </p>
            );
          }
          if (warning.code === "archivedProductWillBeRestored") {
            return (
              <p
                key={`${warning.code}-${warning.productId}-${index}`}
                className="text-xs text-warning-foreground"
              >
                {t("dryRunWarningArchivedRestore", {
                  product: warning.productName,
                  sku: warning.productSku,
                })}
              </p>
            );
          }
          return (
            <p key={`${warning.code}-${index}`} className="text-xs text-warning-foreground">
              {t("dryRunWarningMissingExisting")}
            </p>
          );
        })}
      </div>
    ) : (
      <span className="text-xs text-muted-foreground">{t("dryRunWarningsEmpty")}</span>
    );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <div className="rounded-md border border-success/30 bg-success/10 p-3">
          <p className="text-xs text-muted-foreground">{t("dryRunCreates")}</p>
          <p className="text-lg font-semibold text-foreground">{preview.summary.creates}</p>
        </div>
        <div className="rounded-md border border-warning/30 bg-warning/10 p-3">
          <p className="text-xs text-muted-foreground">{t("dryRunUpdates")}</p>
          <p className="text-lg font-semibold text-foreground">{preview.summary.updates}</p>
        </div>
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">{t("dryRunSkipped")}</p>
          <p className="text-lg font-semibold text-foreground">{preview.summary.skipped}</p>
        </div>
        <div className="rounded-md border border-warning/30 bg-warning/10 p-3">
          <p className="text-xs text-muted-foreground">{t("dryRunWarnings")}</p>
          <p className="text-lg font-semibold text-foreground">{preview.summary.warningCount}</p>
        </div>
        <div className="rounded-md border border-warning/30 bg-warning/10 p-3">
          <p className="text-xs text-muted-foreground">{t("dryRunPossibleDuplicates")}</p>
          <p className="text-lg font-semibold text-foreground">
            {preview.summary.possibleDuplicateCount ?? 0}
          </p>
        </div>
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3">
          <p className="text-xs text-muted-foreground">{t("dryRunBlockingWarnings")}</p>
          <p className="text-lg font-semibold text-foreground">
            {preview.summary.blockingWarningCount}
          </p>
        </div>
      </div>
      {preview.summary.truncated ? (
        <p className="text-xs text-muted-foreground">
          {t("dryRunShowingRows", {
            shown: preview.summary.returnedRows,
            total: preview.summary.totalRows,
          })}
        </p>
      ) : null}

      <ResponsiveDataList
        items={preview.rows}
        getKey={(row) => `${row.sourceRowNumber}-${row.sku}`}
        defaultPageSize={10}
        renderDesktop={(items) => (
          <div className="overflow-x-auto">
            <Table className="min-w-[920px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("dryRunRow")}</TableHead>
                  <TableHead>{t("dryRunAction")}</TableHead>
                  <TableHead>{t("dryRunMatchStatusTitle")}</TableHead>
                  <TableHead>{t("fieldSku")}</TableHead>
                  <TableHead>{t("fieldName")}</TableHead>
                  <TableHead>{t("dryRunExisting")}</TableHead>
                  <TableHead>{t("dryRunChanges")}</TableHead>
                  <TableHead>{t("dryRunWarningsColumn")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((row) => (
                  <TableRow key={`${row.sourceRowNumber}-${row.sku}`}>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.sourceRowNumber}
                    </TableCell>
                    <TableCell>
                      <Badge variant={resolveActionVariant(row.action, row.hasBlockingWarnings)}>
                        {resolveActionLabel(row.action)}
                      </Badge>
                      <div className="mt-2">{renderRowDecision(row)}</div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {resolveMatchStatusLabel(row.matchStatus)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.sku}</TableCell>
                    <TableCell className="font-medium">
                      {row.name ?? tCommon("notAvailable")}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.existingProduct ? (
                        <div className="space-y-1">
                          <p className="text-foreground">{row.existingProduct.name}</p>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="muted">{row.existingProduct.sku}</Badge>
                            {row.existingProduct.isDeleted ? (
                              <Badge variant="muted">{t("historyRolledBack")}</Badge>
                            ) : null}
                            <Link
                              href={`/products/${row.existingProduct.id}`}
                              target="_blank"
                              className="text-primary underline-offset-4 hover:underline"
                            >
                              {t("dryRunOpenProduct")}
                            </Link>
                          </div>
                        </div>
                      ) : row.possibleDuplicate ? (
                        <div className="space-y-1">
                          <p className="text-foreground">{row.possibleDuplicate.name}</p>
                          <Badge variant="warning">{row.possibleDuplicate.sku}</Badge>
                        </div>
                      ) : (
                        t("dryRunCreateNew")
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.changes.length ? (
                        <div className="space-y-2">
                          {row.changes.map((change, index) => (
                            <div key={`${change.field}-${index}`}>
                              <p className="font-medium text-foreground">
                                {resolveFieldLabel(change.field)}
                              </p>
                              <p>
                                {formatPreviewValue(change.before, tCommon("notAvailable"))} {"->"}{" "}
                                {formatPreviewValue(change.after, tCommon("notAvailable"))}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        t("dryRunNoChanges")
                      )}
                    </TableCell>
                    <TableCell>{renderWarnings(row)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        renderMobile={(row) => (
          <div className="rounded-md border border-border bg-card p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  {t("dryRunRowLabel", { row: row.sourceRowNumber })}
                </p>
                <p className="truncate text-sm font-medium text-foreground">
                  {row.name ?? tCommon("notAvailable")}
                </p>
                <p className="text-xs text-muted-foreground">{row.sku}</p>
              </div>
              <Badge variant={resolveActionVariant(row.action, row.hasBlockingWarnings)}>
                {resolveActionLabel(row.action)}
              </Badge>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="muted">{resolveMatchStatusLabel(row.matchStatus)}</Badge>
              {renderRowDecision(row)}
            </div>
            <div className="mt-3 space-y-3">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                  {t("dryRunExisting")}
                </p>
                {row.existingProduct ? (
                  <div className="space-y-1">
                    <p className="text-sm text-foreground">{row.existingProduct.name}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="muted">{row.existingProduct.sku}</Badge>
                      <Link
                        href={`/products/${row.existingProduct.id}`}
                        target="_blank"
                        className="text-xs text-primary underline-offset-4 hover:underline"
                      >
                        {t("dryRunOpenProduct")}
                      </Link>
                    </div>
                  </div>
                ) : row.possibleDuplicate ? (
                  <div className="space-y-1">
                    <p className="text-sm text-foreground">{row.possibleDuplicate.name}</p>
                    <Badge variant="warning">{row.possibleDuplicate.sku}</Badge>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("dryRunCreateNew")}</p>
                )}
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                  {t("dryRunChanges")}
                </p>
                {row.changes.length ? (
                  <div className="mt-1 space-y-2">
                    {row.changes.map((change, index) => (
                      <div key={`${change.field}-${index}`} className="text-xs text-foreground">
                        <p className="font-medium">{resolveFieldLabel(change.field)}</p>
                        <p>
                          {formatPreviewValue(change.before, tCommon("notAvailable"))} {"->"}{" "}
                          {formatPreviewValue(change.after, tCommon("notAvailable"))}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("dryRunNoChanges")}</p>
                )}
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                  {t("dryRunWarningsColumn")}
                </p>
                <div className="mt-1">{renderWarnings(row)}</div>
              </div>
            </div>
          </div>
        )}
      />
    </div>
  );
};

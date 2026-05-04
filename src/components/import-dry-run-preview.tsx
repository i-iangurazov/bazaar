"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { ResponsiveDataList } from "@/components/responsive-data-list";
import { Badge } from "@/components/ui/badge";
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
  existingProduct: {
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
      | "description"
      | "photoUrl"
      | "variants"
      | "barcodes"
      | "basePriceKgs"
      | "purchasePriceKgs"
      | "avgCostKgs"
      | "minStock";
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
    totalRows: number;
    returnedRows: number;
    truncated: boolean;
  };
};

type ImportDryRunPreviewProps = {
  preview: ImportDryRunPreviewData;
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

export const ImportDryRunPreview = ({ preview }: ImportDryRunPreviewProps) => {
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

  const resolveFieldLabel = (field: ImportPreviewRow["changes"][number]["field"]) => {
    switch (field) {
      case "name":
        return t("fieldName");
      case "unit":
        return t("fieldUnit");
      case "category":
        return t("fieldCategory");
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
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-none border border-success/30 bg-success/10 p-3">
          <p className="text-xs text-muted-foreground">{t("dryRunCreates")}</p>
          <p className="text-lg font-semibold text-foreground">{preview.summary.creates}</p>
        </div>
        <div className="rounded-none border border-warning/30 bg-warning/10 p-3">
          <p className="text-xs text-muted-foreground">{t("dryRunUpdates")}</p>
          <p className="text-lg font-semibold text-foreground">{preview.summary.updates}</p>
        </div>
        <div className="rounded-none border border-border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">{t("dryRunSkipped")}</p>
          <p className="text-lg font-semibold text-foreground">{preview.summary.skipped}</p>
        </div>
        <div className="rounded-none border border-warning/30 bg-warning/10 p-3">
          <p className="text-xs text-muted-foreground">{t("dryRunWarnings")}</p>
          <p className="text-lg font-semibold text-foreground">{preview.summary.warningCount}</p>
        </div>
        <div className="rounded-none border border-danger/30 bg-danger/10 p-3">
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
          <div className="rounded-none border border-border bg-card p-3">
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

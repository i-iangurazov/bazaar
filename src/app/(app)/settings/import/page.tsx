"use client";

import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import Papa from "papaparse";
import * as XLSX from "xlsx";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Modal } from "@/components/ui/modal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormGrid } from "@/components/form-layout";
import { useToast } from "@/components/ui/toast";
import { DownloadIcon, EmptyIcon, RestoreIcon, UploadIcon } from "@/components/icons";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { formatDateTime } from "@/lib/i18nFormat";

type ImportRow = {
  sku: string;
  name: string;
  unit: string;
  category?: string;
  description?: string;
  photoUrl?: string;
  barcodes?: string[];
};

type RawRow = Record<string, unknown>;

type MappingKey =
  | "sku"
  | "name"
  | "unit"
  | "category"
  | "description"
  | "photoUrl"
  | "barcodes";

type MappingState = Record<MappingKey, string>;

type ValidationError = {
  row: number;
  message: string;
};

type ImportSource = "cloudshop" | "onec" | "csv";

const ImportPreviewTable = dynamic(() => import("@/components/import-preview-table"), {
  ssr: false,
  loading: () => (
    <div className="h-32 animate-pulse rounded-lg border border-dashed border-gray-200 bg-gray-50" aria-hidden />
  ),
});

const normalizeHeader = (value: string) =>
  value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[_\-]/g, "")
    .trim();

const normalizeValue = (value: unknown) =>
  typeof value === "string" ? value.trim() : String(value ?? "").trim();

const parseBarcodes = (value: string) =>
  Array.from(
    new Set(
      value
        .split(/[|,;]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );

const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;

const detectColumn = (headers: string[], candidates: string[]) => {
  const normalizedCandidates = new Set(candidates.map((value) => normalizeHeader(value)));
  const match = headers.find((header) =>
    normalizedCandidates.has(normalizeHeader(header)),
  );
  return match ?? "";
};

const detectSource = (headers: string[]): ImportSource => {
  const normalized = headers.map((header) => normalizeHeader(header));
  const hasCloudShop =
    normalized.some((value) => ["артикул", "sku", "штрихкод"].includes(value)) &&
    normalized.some((value) => ["наименование", "название", "name"].includes(value));
  if (hasCloudShop) {
    return "cloudshop";
  }
  const hasOneC =
    normalized.some((value) => ["код", "номенклатура"].includes(value)) &&
    normalized.some((value) => value.includes("ед"));
  if (hasOneC) {
    return "onec";
  }
  return "csv";
};

const buildDefaultMapping = (headers: string[]): MappingState => ({
  sku: detectColumn(headers, ["sku", "артикул", "код", "code"]),
  name: detectColumn(headers, ["name", "наименование", "название", "товар"]),
  unit: detectColumn(headers, ["unit", "ед.изм", "едизм", "ед", "unitcode"]),
  category: detectColumn(headers, ["category", "категория", "группа"]),
  description: detectColumn(headers, ["description", "описание"]),
  photoUrl: detectColumn(headers, ["photo", "photoUrl", "изображение", "image", "url"]),
  barcodes: detectColumn(headers, ["barcode", "barcodes", "штрихкод", "штрихкоды"]),
});

const ImportPage = () => {
  const t = useTranslations("imports");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session, status } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const isForbidden = status === "authenticated" && !isAdmin;
  const { toast } = useToast();

  const [fileName, setFileName] = useState<string | null>(null);
  const [rawRows, setRawRows] = useState<RawRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<MappingState>({
    sku: "",
    name: "",
    unit: "",
    category: "",
    description: "",
    photoUrl: "",
    barcodes: "",
  });
  const [fileError, setFileError] = useState<string | null>(null);
  const [source, setSource] = useState<ImportSource>("csv");
  const [rollbackBatchId, setRollbackBatchId] = useState<string | null>(null);

  const batchesQuery = trpc.imports.list.useQuery(undefined, { enabled: isAdmin });
  const rollbackDetailsQuery = trpc.imports.get.useQuery(
    { batchId: rollbackBatchId ?? "" },
    { enabled: Boolean(rollbackBatchId) },
  );

  const importMutation = trpc.products.importCsv.useMutation({
    onSuccess: (payload) => {
      toast({
        variant: "success",
        description: t("importSuccess", { count: payload.results.length }),
      });
      batchesQuery.refetch();
      setRawRows([]);
      setHeaders([]);
      setMapping({
        sku: "",
        name: "",
        unit: "",
        category: "",
        description: "",
        photoUrl: "",
        barcodes: "",
      });
      setFileName(null);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const rollbackMutation = trpc.imports.rollback.useMutation({
    onSuccess: () => {
      batchesQuery.refetch();
      setRollbackBatchId(null);
      toast({ variant: "success", description: t("rollbackSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const batches = batchesQuery.data ?? [];
  const rollbackBatch = batches.find((batch) => batch.id === rollbackBatchId) ?? null;
  const resolveEntityLabel = (entityType: string) => {
    switch (entityType) {
      case "Product":
        return t("rollbackEntities.product");
      case "ProductBarcode":
        return t("rollbackEntities.barcode");
      case "AttributeDefinition":
        return t("rollbackEntities.attribute");
      case "PurchaseOrder":
        return t("rollbackEntities.purchaseOrder");
      default:
        return entityType;
    }
  };

  const mappingFields = useMemo(
    () => [
      { key: "sku" as const, label: t("fieldSku"), required: true },
      { key: "name" as const, label: t("fieldName"), required: true },
      { key: "unit" as const, label: t("fieldUnit"), required: true },
      { key: "category" as const, label: t("fieldCategory"), required: false },
      { key: "description" as const, label: t("fieldDescription"), required: false },
      { key: "photoUrl" as const, label: t("fieldPhotoUrl"), required: false },
      { key: "barcodes" as const, label: t("fieldBarcodes"), required: false },
    ],
    [t],
  );

  const missingRequired = useMemo(
    () => mappingFields.filter((field) => field.required && !mapping[field.key]),
    [mapping, mappingFields],
  );

  const validation = useMemo(() => {
    if (!rawRows.length || missingRequired.length) {
      return { rows: [] as ImportRow[], errors: [] as ValidationError[] };
    }

    const errors: ValidationError[] = [];
    const rows: ImportRow[] = [];
    const seenSkus = new Set<string>();
    const seenBarcodes = new Set<string>();

    rawRows.forEach((row, index) => {
      const rowNumber = index + 1;
      const sku = normalizeValue(row[mapping.sku]);
      const name = normalizeValue(row[mapping.name]);
      const unit = normalizeValue(row[mapping.unit]);

      if (!sku) {
        errors.push({ row: rowNumber, message: t("rowMissing", { row: rowNumber, field: t("fieldSku") }) });
        return;
      }
      if (!name) {
        errors.push({ row: rowNumber, message: t("rowMissing", { row: rowNumber, field: t("fieldName") }) });
        return;
      }
      if (!unit) {
        errors.push({ row: rowNumber, message: t("rowMissing", { row: rowNumber, field: t("fieldUnit") }) });
        return;
      }

      if (seenSkus.has(sku)) {
        errors.push({ row: rowNumber, message: t("duplicateSku", { row: rowNumber, value: sku }) });
        return;
      }

      const barcodesValue = mapping.barcodes
        ? normalizeValue(row[mapping.barcodes])
        : "";
      const barcodes = barcodesValue ? parseBarcodes(barcodesValue) : [];
      const duplicateBarcode = barcodes.find((barcode) => seenBarcodes.has(barcode));
      if (duplicateBarcode) {
        errors.push({
          row: rowNumber,
          message: t("duplicateBarcode", { row: rowNumber, value: duplicateBarcode }),
        });
        return;
      }

      seenSkus.add(sku);
      barcodes.forEach((barcode) => seenBarcodes.add(barcode));

      rows.push({
        sku,
        name,
        unit,
        category: mapping.category ? normalizeValue(row[mapping.category]) || undefined : undefined,
        description: mapping.description
          ? normalizeValue(row[mapping.description]) || undefined
          : undefined,
        photoUrl: mapping.photoUrl
          ? normalizeValue(row[mapping.photoUrl]) || undefined
          : undefined,
        barcodes: barcodes.length ? barcodes : undefined,
      });
    });

    return { rows, errors };
  }, [rawRows, mapping, missingRequired.length, t]);

  const handleFile = async (file: File) => {
    setFileError(null);
    setFileName(file.name);
    setRawRows([]);
    setHeaders([]);
    setMapping({
      sku: "",
      name: "",
      unit: "",
      category: "",
      description: "",
      photoUrl: "",
      barcodes: "",
    });

    try {
      if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: "" });
        const nextHeaders = Object.keys(data[0] ?? {});
        setRawRows(data);
        setHeaders(nextHeaders);
        setMapping(buildDefaultMapping(nextHeaders));
        setSource(detectSource(nextHeaders));
        return;
      }

      Papa.parse<RawRow>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const nextHeaders = Object.keys(results.data[0] ?? {});
          setRawRows(results.data);
          setHeaders(nextHeaders);
          setMapping(buildDefaultMapping(nextHeaders));
          setSource(detectSource(nextHeaders));
        },
        error: () => {
          setFileError(t("fileParseError"));
        },
      });
    } catch {
      setFileError(t("fileParseError"));
    }
  };

  const handleDownloadErrors = () => {
    if (!validation.errors.length) {
      return;
    }
    const lines = [
      [t("errorCsvRowHeader"), t("errorCsvMessageHeader")].map(escapeCsv).join(","),
      ...validation.errors.map((error) =>
        [String(error.row), error.message].map(escapeCsv).join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `import-errors-${locale}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadTemplate = () => {
    const header = t("templateHeaders");
    const example = t("templateExample");
    const blob = new Blob([`${header}\n${example}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `template-1c-${locale}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (isForbidden) {
    return (
      <div>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <p className="mt-4 text-sm text-red-500">{tErrors("forbidden")}</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <Button
            variant="secondary"
            className="w-full sm:w-auto"
            onClick={handleDownloadTemplate}
          >
            <DownloadIcon className="h-4 w-4" aria-hidden />
            {t("templateDownload")}
          </Button>
        }
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t("uploadTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            type="file"
            accept=".csv,text/csv,.xlsx,.xls"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleFile(file);
              }
            }}
          />
          {fileName ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <Badge variant="muted">{fileName}</Badge>
              <span>{t("sourceDetected", { source: t(`source.${source}`) })}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <EmptyIcon className="h-4 w-4" aria-hidden />
              {t("uploadHint")}
            </div>
          )}
          {fileError ? <p className="text-sm text-red-500">{fileError}</p> : null}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t("mappingTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {headers.length ? (
            <FormGrid className="items-start">
              {mappingFields.map((field) => (
                <div key={field.key} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-ink">{field.label}</p>
                    {field.required ? (
                      <Badge variant="warning" className="text-[10px]">
                        {t("required")}
                      </Badge>
                    ) : (
                      <Badge variant="muted" className="text-[10px]">
                        {t("optional")}
                      </Badge>
                    )}
                  </div>
                  <Select
                    value={mapping[field.key] || "none"}
                    onValueChange={(value) =>
                      setMapping((prev) => ({
                        ...prev,
                        [field.key]: value === "none" ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("mappingPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{tCommon("notAvailable")}</SelectItem>
                      {headers.map((header) => (
                        <SelectItem key={`${field.key}-${header}`} value={header}>
                          {header}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </FormGrid>
          ) : (
            <p className="text-sm text-gray-500">{t("mappingEmpty")}</p>
          )}
          {missingRequired.length ? (
            <p className="text-sm text-red-500">{t("mappingRequired")}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t("previewTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {validation.rows.length ? (
            <ImportPreviewTable rows={validation.rows} />
          ) : (
            <p className="text-sm text-gray-500">{t("previewEmpty")}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("validationTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600">
            <span>
              {t("validationSummary", {
                valid: validation.rows.length,
                invalid: validation.errors.length,
              })}
            </span>
            {validation.errors.length ? (
              <Button type="button" variant="ghost" onClick={handleDownloadErrors}>
                <DownloadIcon className="h-4 w-4" aria-hidden />
                {t("downloadErrors")}
              </Button>
            ) : null}
          </div>
          {validation.errors.length ? (
            <div className="space-y-2">
              {validation.errors.slice(0, 5).map((error) => (
                <p key={`${error.row}-${error.message}`} className="text-xs text-red-500">
                  {error.message}
                </p>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              onClick={() => {
                if (!validation.rows.length) {
                  toast({ variant: "error", description: t("importEmpty") });
                  return;
                }
                importMutation.mutate({ rows: validation.rows, source });
              }}
              disabled={importMutation.isLoading || missingRequired.length > 0}
            >
              {importMutation.isLoading ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <UploadIcon className="h-4 w-4" aria-hidden />
              )}
              {importMutation.isLoading ? tCommon("loading") : t("applyImport")}
            </Button>
          </div>
          {importMutation.error ? (
            <p className="text-sm text-red-500">
              {translateError(tErrors, importMutation.error)}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("historyTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {batchesQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : !batches.length ? (
            <p className="text-sm text-gray-500">{t("historyEmpty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("historyColumns.date")}</TableHead>
                    <TableHead>{t("historyColumns.source")}</TableHead>
                    <TableHead>{t("historyColumns.rows")}</TableHead>
                    <TableHead>{t("historyColumns.created")}</TableHead>
                    <TableHead>{t("historyColumns.updated")}</TableHead>
                    <TableHead>{t("historyColumns.status")}</TableHead>
                    <TableHead className="text-right">{tCommon("actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map((batch) => {
                    const summary = (batch.summary ?? {}) as {
                      rows?: number;
                      created?: number;
                      updated?: number;
                      source?: string;
                    };
                    const sourceLabel = summary.source ? t(`source.${summary.source}`) : t("source.csv");
                    return (
                      <TableRow key={batch.id}>
                        <TableCell className="text-xs text-gray-500">
                          {formatDateTime(batch.createdAt, locale)}
                        </TableCell>
                        <TableCell className="text-xs text-gray-500">{sourceLabel}</TableCell>
                        <TableCell className="text-xs text-gray-500">{summary.rows ?? 0}</TableCell>
                        <TableCell className="text-xs text-gray-500">{summary.created ?? 0}</TableCell>
                        <TableCell className="text-xs text-gray-500">{summary.updated ?? 0}</TableCell>
                        <TableCell>
                          {batch.rolledBackAt ? (
                            <Badge variant="muted">{t("historyRolledBack")}</Badge>
                          ) : (
                            <Badge variant="success">{t("historyCompleted")}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {batch.rolledBackAt ? (
                            <span className="text-xs text-gray-400">{t("historyDone")}</span>
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={t("rollbackAction")}
                              onClick={() => setRollbackBatchId(batch.id)}
                            >
                              <RestoreIcon className="h-4 w-4" aria-hidden />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal
        open={Boolean(rollbackBatchId)}
        onOpenChange={(open) => {
          if (!open) {
            setRollbackBatchId(null);
          }
        }}
        title={t("rollbackTitle")}
        subtitle={
          rollbackBatch
            ? t("rollbackSubtitle", {
                date: formatDateTime(rollbackBatch.createdAt, locale),
              })
            : t("rollbackSubtitleEmpty")
        }
      >
        {rollbackDetailsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Spinner className="h-4 w-4" />
            {tCommon("loading")}
          </div>
        ) : rollbackDetailsQuery.data ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">{t("rollbackHint")}</p>
            {rollbackDetailsQuery.data.counts.length ? (
              <div className="space-y-2 text-sm text-gray-600">
                {rollbackDetailsQuery.data.counts.map((item) => (
                  <div key={item.entityType} className="flex items-center justify-between">
                    <span>{resolveEntityLabel(item.entityType)}</span>
                    <span className="font-semibold text-ink">{item.count}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">{t("rollbackNothing")}</p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setRollbackBatchId(null)}>
                {tCommon("cancel")}
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  if (!rollbackBatchId) {
                    return;
                  }
                  rollbackMutation.mutate({ batchId: rollbackBatchId });
                }}
                disabled={rollbackMutation.isLoading}
              >
                {rollbackMutation.isLoading ? tCommon("loading") : t("rollbackConfirm")}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">{t("rollbackMissing")}</p>
        )}
      </Modal>
    </div>
  );
};

export default ImportPage;

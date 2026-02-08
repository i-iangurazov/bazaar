"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import Papa from "papaparse";
import * as XLSX from "xlsx";

import { PageHeader } from "@/components/page-header";
import { ResponsiveDataList } from "@/components/responsive-data-list";
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
import { RowActions } from "@/components/row-actions";
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
  basePriceKgs?: number;
  purchasePriceKgs?: number;
  avgCostKgs?: number;
};

type RawRow = Record<string, unknown>;

type MappingKey =
  | "sku"
  | "name"
  | "unit"
  | "category"
  | "description"
  | "photoUrl"
  | "barcodes"
  | "basePriceKgs"
  | "purchasePriceKgs"
  | "avgCostKgs";

type MappingState = Record<MappingKey, string>;

type ValidationError = {
  row: number;
  message: string;
  code: "missingField" | "duplicateSku" | "duplicateBarcode" | "minLength" | "invalidNumber";
  value?: string;
};

type ImportSource = "cloudshop" | "onec" | "csv";

type ImportRunSummary = {
  rows?: number;
  created?: number;
  updated?: number;
  source?: string;
  images?: {
    downloaded?: number;
    fallback?: number;
    missing?: number;
  };
};

const ImportPreviewTable = dynamic(() => import("@/components/import-preview-table"), {
  ssr: false,
  loading: () => (
    <div className="h-32 animate-pulse rounded-lg border border-dashed border-gray-200 bg-gray-50" aria-hidden />
  ),
});

const normalizeHeader = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
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

const parseOptionalNumericValue = (value: string) => {
  const normalized = value.trim();
  if (!normalized) {
    return { value: undefined as number | undefined, invalid: false };
  }
  const compact = normalized.replace(/\s+/g, "").replace(",", ".");
  const parsed = Number(compact);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { value: undefined as number | undefined, invalid: true };
  }
  return { value: parsed, invalid: false };
};

const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;

const detectColumn = (
  headers: string[],
  candidates: string[],
  options?: { allowContains?: boolean },
) => {
  const normalizedCandidates = candidates.map((value) => normalizeHeader(value));
  const exactCandidates = new Set(normalizedCandidates);
  const exactMatch = headers.find((header) => exactCandidates.has(normalizeHeader(header)));
  if (exactMatch) {
    return exactMatch;
  }
  if (!options?.allowContains) {
    return "";
  }
  const containsMatch = headers.find((header) => {
    const normalized = normalizeHeader(header);
    return normalizedCandidates.some((candidate) =>
      normalized.includes(candidate) || candidate.includes(normalized),
    );
  });
  return containsMatch ?? "";
};

const parseSpreadsheetRows = (sheet: XLSX.WorkSheet) => {
  const rangeRef = sheet["!ref"];
  if (!rangeRef) {
    return { rows: [] as RawRow[], headers: [] as string[] };
  }

  const range = XLSX.utils.decode_range(rangeRef);
  const headers: string[] = [];
  for (let col = range.s.c; col <= range.e.c; col += 1) {
    const headerAddress = XLSX.utils.encode_cell({ r: range.s.r, c: col });
    const headerCell = sheet[headerAddress];
    const header = normalizeValue(headerCell?.v);
    headers.push(header || `Column${col + 1}`);
  }

  const rows: RawRow[] = [];
  for (let rowIndex = range.s.r + 1; rowIndex <= range.e.r; rowIndex += 1) {
    const row: RawRow = {};
    let hasValue = false;
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const header = headers[col - range.s.c];
      const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: col });
      const cell = sheet[cellAddress] as
        | (XLSX.CellObject & { l?: { Target?: string } })
        | undefined;
      const hyperlink = cell?.l?.Target?.trim();
      const formula = typeof cell?.f === "string" ? cell.f.trim() : "";
      const rawValue = hyperlink || formula || cell?.v;
      const value = normalizeValue(rawValue);
      row[header] = value;
      if (value) {
        hasValue = true;
      }
    }
    if (hasValue) {
      rows.push(row);
    }
  }

  return { rows, headers };
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
  basePriceKgs: detectColumn(
    headers,
    ["saleprice", "baseprice", "price", "ценапродажи", "продажнаяцена", "базоваяцена"],
    { allowContains: true },
  ),
  purchasePriceKgs: detectColumn(
    headers,
    ["purchaseprice", "buyprice", "цена закупки", "закупочнаяцена", "ценазакупки"],
    { allowContains: true },
  ),
  avgCostKgs: detectColumn(
    headers,
    ["cost", "avgcost", "себестоимость", "средняясебестоимость", "costprice"],
    { allowContains: true },
  ),
  photoUrl: detectColumn(
    headers,
    [
      "photo",
      "photoUrl",
      "photo_url",
      "photo link",
      "photo_link",
      "image",
      "image url",
      "imageurl",
      "image link",
      "imagelink",
      "изображение",
      "изображениеurl",
      "изображениессылка",
      "ссылка на изображение",
      "ссылка на фото",
      "фото",
      "фотоurl",
      "фототовара",
      "фотоссылка",
      "картинка",
      "картинкассылка",
      "url",
    ],
    { allowContains: true },
  ),
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
    basePriceKgs: "",
    purchasePriceKgs: "",
    avgCostKgs: "",
    photoUrl: "",
    barcodes: "",
  });
  const [fileError, setFileError] = useState<string | null>(null);
  const [source, setSource] = useState<ImportSource>("csv");
  const [rollbackBatchId, setRollbackBatchId] = useState<string | null>(null);
  const [defaultUnitCode, setDefaultUnitCode] = useState("");
  const [skippedRows, setSkippedRows] = useState<number[]>([]);
  const [importStartedAt, setImportStartedAt] = useState<number | null>(null);
  const [importElapsedSeconds, setImportElapsedSeconds] = useState(0);
  const [lastImportSummary, setLastImportSummary] = useState<ImportRunSummary | null>(null);

  const batchesQuery = trpc.imports.list.useQuery(undefined, { enabled: isAdmin });
  const unitsQuery = trpc.units.list.useQuery(undefined, { enabled: isAdmin });
  const rollbackDetailsQuery = trpc.imports.get.useQuery(
    { batchId: rollbackBatchId ?? "" },
    { enabled: Boolean(rollbackBatchId) },
  );

  const importMutation = trpc.products.importCsv.useMutation({
    onMutate: () => {
      const now = Date.now();
      setImportStartedAt(now);
      setImportElapsedSeconds(0);
    },
    onSuccess: (payload) => {
      setLastImportSummary(payload.summary as ImportRunSummary);
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
        basePriceKgs: "",
        purchasePriceKgs: "",
        avgCostKgs: "",
        photoUrl: "",
        barcodes: "",
      });
      setFileName(null);
      setDefaultUnitCode("");
      setSkippedRows([]);
    },
    onSettled: () => {
      setImportStartedAt(null);
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
      { key: "basePriceKgs" as const, label: t("fieldBasePrice"), required: false },
      { key: "purchasePriceKgs" as const, label: t("fieldPurchasePrice"), required: false },
      { key: "avgCostKgs" as const, label: t("fieldAvgCost"), required: false },
      { key: "photoUrl" as const, label: t("fieldPhotoUrl"), required: false },
      { key: "barcodes" as const, label: t("fieldBarcodes"), required: false },
    ],
    [t],
  );

  const missingRequired = useMemo(
    () =>
      mappingFields.filter((field) => {
        if (!field.required) {
          return false;
        }
        if (field.key === "unit") {
          return !mapping.unit && !defaultUnitCode;
        }
        return !mapping[field.key];
      }),
    [defaultUnitCode, mapping, mappingFields],
  );

  const validation = useMemo(() => {
    if (!rawRows.length || missingRequired.length) {
      return { rows: [] as ImportRow[], errors: [] as ValidationError[] };
    }

    const errors: ValidationError[] = [];
    const rows: ImportRow[] = [];
    const seenSkus = new Set<string>();
    const seenBarcodes = new Set<string>();
    const skippedRowsSet = new Set(skippedRows);

    rawRows.forEach((row, index) => {
      const rowNumber = index + 1;
      if (skippedRowsSet.has(rowNumber)) {
        return;
      }
      const sku = normalizeValue(row[mapping.sku]);
      const name = normalizeValue(row[mapping.name]);
      const unitFromRow = mapping.unit ? normalizeValue(row[mapping.unit]) : "";
      const unit = unitFromRow || defaultUnitCode;

      if (!sku) {
        errors.push({
          row: rowNumber,
          message: t("rowMissing", { row: rowNumber, field: t("fieldSku") }),
          code: "missingField",
          value: "sku",
        });
        return;
      }
      if (!name) {
        errors.push({
          row: rowNumber,
          message: t("rowMissing", { row: rowNumber, field: t("fieldName") }),
          code: "missingField",
          value: "name",
        });
        return;
      }
      if (!unit) {
        errors.push({
          row: rowNumber,
          message: t("rowMissing", { row: rowNumber, field: t("fieldUnit") }),
          code: "missingField",
          value: "unit",
        });
        return;
      }
      if (sku.length < 2) {
        errors.push({
          row: rowNumber,
          message: t("rowMinLength", {
            row: rowNumber,
            field: t("fieldSku"),
            min: 2,
          }),
          code: "minLength",
          value: "sku",
        });
        return;
      }
      if (name.length < 2) {
        errors.push({
          row: rowNumber,
          message: t("rowMinLength", {
            row: rowNumber,
            field: t("fieldName"),
            min: 2,
          }),
          code: "minLength",
          value: "name",
        });
        return;
      }

      if (seenSkus.has(sku)) {
        errors.push({
          row: rowNumber,
          message: t("duplicateSku", { row: rowNumber, value: sku }),
          code: "duplicateSku",
          value: sku,
        });
        return;
      }

      const barcodesValue = mapping.barcodes
        ? normalizeValue(row[mapping.barcodes])
        : "";
      const barcodes = barcodesValue ? parseBarcodes(barcodesValue) : [];
      const basePriceCandidate = mapping.basePriceKgs
        ? normalizeValue(row[mapping.basePriceKgs])
        : "";
      const purchasePriceCandidate = mapping.purchasePriceKgs
        ? normalizeValue(row[mapping.purchasePriceKgs])
        : "";
      const avgCostCandidate = mapping.avgCostKgs
        ? normalizeValue(row[mapping.avgCostKgs])
        : "";
      const basePriceResult = parseOptionalNumericValue(basePriceCandidate);
      const purchasePriceResult = parseOptionalNumericValue(purchasePriceCandidate);
      const avgCostResult = parseOptionalNumericValue(avgCostCandidate);

      if (basePriceResult.invalid) {
        errors.push({
          row: rowNumber,
          message: t("rowInvalidNumber", { row: rowNumber, field: t("fieldBasePrice") }),
          code: "invalidNumber",
          value: "basePriceKgs",
        });
        return;
      }
      if (purchasePriceResult.invalid) {
        errors.push({
          row: rowNumber,
          message: t("rowInvalidNumber", { row: rowNumber, field: t("fieldPurchasePrice") }),
          code: "invalidNumber",
          value: "purchasePriceKgs",
        });
        return;
      }
      if (avgCostResult.invalid) {
        errors.push({
          row: rowNumber,
          message: t("rowInvalidNumber", { row: rowNumber, field: t("fieldAvgCost") }),
          code: "invalidNumber",
          value: "avgCostKgs",
        });
        return;
      }

      const duplicateBarcode = barcodes.find((barcode) => seenBarcodes.has(barcode));
      if (duplicateBarcode) {
        errors.push({
          row: rowNumber,
          message: t("duplicateBarcode", { row: rowNumber, value: duplicateBarcode }),
          code: "duplicateBarcode",
          value: duplicateBarcode,
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
        basePriceKgs: basePriceResult.value,
        purchasePriceKgs: purchasePriceResult.value,
        avgCostKgs: avgCostResult.value,
        photoUrl: mapping.photoUrl
          ? normalizeValue(row[mapping.photoUrl]) || undefined
          : undefined,
        barcodes: barcodes.length ? barcodes : undefined,
      });
    });

    return { rows, errors };
  }, [defaultUnitCode, missingRequired.length, mapping, rawRows, skippedRows, t]);

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
      basePriceKgs: "",
      purchasePriceKgs: "",
      avgCostKgs: "",
      photoUrl: "",
      barcodes: "",
    });
    setDefaultUnitCode("");
    setSkippedRows([]);

    try {
      if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const parsed = parseSpreadsheetRows(sheet);
        setRawRows(parsed.rows);
        setHeaders(parsed.headers);
        setMapping(buildDefaultMapping(parsed.headers));
        setSource(detectSource(parsed.headers));
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

  const handleToggleSkipRow = (rowNumber: number) => {
    setSkippedRows((prev) =>
      prev.includes(rowNumber)
        ? prev.filter((value) => value !== rowNumber)
        : [...prev, rowNumber].sort((a, b) => a - b),
    );
  };

  const handleClearDuplicateBarcode = (rowNumber: number, barcode: string) => {
    if (!mapping.barcodes) {
      return;
    }
    setRawRows((prev) =>
      prev.map((row, index) => {
        if (index + 1 !== rowNumber) {
          return row;
        }
        const current = normalizeValue(row[mapping.barcodes]);
        const next = parseBarcodes(current).filter((value) => value !== barcode);
        return { ...row, [mapping.barcodes]: next.join("|") };
      }),
    );
  };

  const handleAutoFixDuplicateBarcodes = () => {
    if (!mapping.barcodes) {
      return;
    }
    setRawRows((prev) => {
      const seen = new Set<string>();
      return prev.map((row, index) => {
        if (skippedRows.includes(index + 1)) {
          return row;
        }
        const current = normalizeValue(row[mapping.barcodes]);
        if (!current) {
          return row;
        }
        const next = parseBarcodes(current).filter((value) => {
          if (seen.has(value)) {
            return false;
          }
          seen.add(value);
          return true;
        });
        if (next.join("|") === parseBarcodes(current).join("|")) {
          return row;
        }
        return { ...row, [mapping.barcodes]: next.join("|") };
      });
    });
  };

  const handleUseSkuAsName = (rowNumber: number) => {
    if (!mapping.name || !mapping.sku) {
      return;
    }
    setRawRows((prev) =>
      prev.map((row, index) => {
        if (index + 1 !== rowNumber) {
          return row;
        }
        const sku = normalizeValue(row[mapping.sku]);
        if (sku.length < 2) {
          return row;
        }
        return { ...row, [mapping.name]: sku };
      }),
    );
  };

  const handleAutoFixShortNames = () => {
    if (!mapping.name || !mapping.sku) {
      return;
    }
    setRawRows((prev) =>
      prev.map((row, index) => {
        if (skippedRows.includes(index + 1)) {
          return row;
        }
        const name = normalizeValue(row[mapping.name]);
        const sku = normalizeValue(row[mapping.sku]);
        if (name.length >= 2 || sku.length < 2) {
          return row;
        }
        return { ...row, [mapping.name]: sku };
      }),
    );
  };

  const handleApplyDefaultUnitToRow = (rowNumber: number) => {
    if (!mapping.unit || !defaultUnitCode) {
      return;
    }
    setRawRows((prev) =>
      prev.map((row, index) =>
        index + 1 === rowNumber ? { ...row, [mapping.unit]: defaultUnitCode } : row,
      ),
    );
  };

  const handleAutoApplyDefaultUnit = () => {
    if (!mapping.unit || !defaultUnitCode) {
      return;
    }
    setRawRows((prev) =>
      prev.map((row, index) => {
        if (skippedRows.includes(index + 1)) {
          return row;
        }
        const current = normalizeValue(row[mapping.unit]);
        if (current) {
          return row;
        }
        return { ...row, [mapping.unit]: defaultUnitCode };
      }),
    );
  };

  const duplicateBarcodeErrors = validation.errors.filter(
    (error) => error.code === "duplicateBarcode" && Boolean(error.value),
  );
  const shortNameErrors = validation.errors.filter(
    (error) => error.code === "minLength" && error.value === "name",
  );
  const missingUnitErrors = validation.errors.filter(
    (error) => error.code === "missingField" && error.value === "unit",
  );

  useEffect(() => {
    if (!importMutation.isLoading || !importStartedAt) {
      setImportElapsedSeconds(0);
      return;
    }
    const interval = window.setInterval(() => {
      setImportElapsedSeconds(Math.floor((Date.now() - importStartedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [importMutation.isLoading, importStartedAt]);

  const importProgressStage = useMemo(() => {
    if (importElapsedSeconds < 5) {
      return t("progressStage.validating");
    }
    if (importElapsedSeconds < 15) {
      return t("progressStage.resolvingImages");
    }
    return t("progressStage.writingDatabase");
  }, [importElapsedSeconds, t]);

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
            <div className="space-y-4">
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
              <div className="max-w-sm space-y-2">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-ink">{t("defaultUnitTitle")}</p>
                  <Badge variant="muted" className="text-[10px]">
                    {t("optional")}
                  </Badge>
                </div>
                <Select
                  value={defaultUnitCode || "none"}
                  onValueChange={(value) =>
                    setDefaultUnitCode(value === "none" ? "" : value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("defaultUnitPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{tCommon("notAvailable")}</SelectItem>
                    {(unitsQuery.data ?? []).map((unit) => (
                      <SelectItem key={unit.id} value={unit.code}>
                        {unit.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500">{t("defaultUnitHint")}</p>
              </div>
            </div>
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
            <div className="flex flex-wrap items-center gap-2">
              {skippedRows.length ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setSkippedRows([])}
                >
                  {t("clearSkippedRows", { count: skippedRows.length })}
                </Button>
              ) : null}
              {validation.errors.length ? (
                <Button type="button" variant="ghost" onClick={handleDownloadErrors}>
                  <DownloadIcon className="h-4 w-4" aria-hidden />
                  {t("downloadErrors")}
                </Button>
              ) : null}
            </div>
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
          {shortNameErrors.length ? (
            <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-blue-900">
                  {t("shortNameResolveTitle", { count: shortNameErrors.length })}
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleAutoFixShortNames}
                >
                  {t("shortNameAutoFix")}
                </Button>
              </div>
              <div className="space-y-2">
                {shortNameErrors.slice(0, 8).map((error) => (
                  <div
                    key={`resolve-name-${error.row}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-blue-200 bg-white p-2"
                  >
                    <p className="text-xs text-blue-900">{error.message}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleUseSkuAsName(error.row)}
                      >
                        {t("shortNameUseSku")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleSkipRow(error.row)}
                      >
                        {skippedRows.includes(error.row) ? t("unskipRow") : t("skipRow")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {missingUnitErrors.length ? (
            <div className="space-y-2 rounded-md border border-indigo-200 bg-indigo-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-indigo-900">
                  {t("missingUnitResolveTitle", { count: missingUnitErrors.length })}
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleAutoApplyDefaultUnit}
                  disabled={!defaultUnitCode}
                >
                  {t("missingUnitApplyDefault")}
                </Button>
              </div>
              <p className="text-xs text-indigo-700">
                {defaultUnitCode
                  ? t("missingUnitHintSelected", { unit: defaultUnitCode })
                  : t("missingUnitHintSelectDefault")}
              </p>
              <div className="space-y-2">
                {missingUnitErrors.slice(0, 8).map((error) => (
                  <div
                    key={`resolve-unit-${error.row}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-indigo-200 bg-white p-2"
                  >
                    <p className="text-xs text-indigo-900">{error.message}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleApplyDefaultUnitToRow(error.row)}
                        disabled={!defaultUnitCode}
                      >
                        {t("missingUnitApplyToRow")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleSkipRow(error.row)}
                      >
                        {skippedRows.includes(error.row) ? t("unskipRow") : t("skipRow")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {duplicateBarcodeErrors.length ? (
            <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-amber-900">
                  {t("duplicateResolveTitle", { count: duplicateBarcodeErrors.length })}
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleAutoFixDuplicateBarcodes}
                >
                  {t("duplicateAutoFix")}
                </Button>
              </div>
              <div className="space-y-2">
                {duplicateBarcodeErrors.slice(0, 8).map((error) => (
                  <div
                    key={`resolve-${error.row}-${error.value}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-white p-2"
                  >
                    <p className="text-xs text-amber-900">{error.message}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          handleClearDuplicateBarcode(error.row, error.value ?? "")
                        }
                      >
                        {t("duplicateRemove")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleSkipRow(error.row)}
                      >
                        {skippedRows.includes(error.row) ? t("unskipRow") : t("skipRow")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
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
                if (validation.errors.length) {
                  toast({
                    variant: "error",
                    description: t("importHasErrors", { count: validation.errors.length }),
                  });
                  return;
                }
                importMutation.mutate({ rows: validation.rows, source });
              }}
              disabled={
                importMutation.isLoading ||
                missingRequired.length > 0 ||
                validation.errors.length > 0 ||
                validation.rows.length === 0
              }
            >
              {importMutation.isLoading ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <UploadIcon className="h-4 w-4" aria-hidden />
              )}
              {importMutation.isLoading ? tCommon("loading") : t("applyImport")}
            </Button>
          </div>
          {importMutation.isLoading ? (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
              <p className="font-medium text-ink">
                {t("importInProgress", {
                  count: validation.rows.length,
                  elapsed: importElapsedSeconds,
                })}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {t("importInProgressStage", { stage: importProgressStage })}
              </p>
            </div>
          ) : null}
          {importMutation.error ? (
            <p className="text-sm text-red-500">
              {translateError(tErrors, importMutation.error)}
            </p>
          ) : null}
          {lastImportSummary ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <p className="font-medium">{t("importResultTitle")}</p>
              <p className="mt-1 text-xs text-emerald-800">
                {t("importSuccess", { count: (lastImportSummary.rows ?? 0) })}
              </p>
              <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                <div className="rounded border border-emerald-200 bg-white p-2">
                  <p className="text-emerald-700">{t("imageDownloaded")}</p>
                  <p className="font-semibold text-emerald-900">
                    {lastImportSummary.images?.downloaded ?? 0}
                  </p>
                </div>
                <div className="rounded border border-emerald-200 bg-white p-2">
                  <p className="text-emerald-700">{t("imageFallback")}</p>
                  <p className="font-semibold text-emerald-900">
                    {lastImportSummary.images?.fallback ?? 0}
                  </p>
                </div>
                <div className="rounded border border-emerald-200 bg-white p-2">
                  <p className="text-emerald-700">{t("imageMissing")}</p>
                  <p className="font-semibold text-emerald-900">
                    {lastImportSummary.images?.missing ?? 0}
                  </p>
                </div>
              </div>
            </div>
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
            <ResponsiveDataList
              items={batches}
              getKey={(batch) => batch.id}
              renderDesktop={(visibleItems) => (
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
                      {visibleItems.map((batch) => {
                        const summary = (batch.summary ?? {}) as {
                          rows?: number;
                          created?: number;
                          updated?: number;
                          source?: string;
                        };
                        const sourceLabel = summary.source ? t(`source.${summary.source}`) : t("source.csv");
                        const actions = [
                          {
                            key: "rollback",
                            label: t("rollbackAction"),
                            icon: RestoreIcon,
                            variant: "danger" as const,
                            onSelect: () => setRollbackBatchId(batch.id),
                            disabled: rollbackMutation.isLoading,
                          },
                        ];

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
                                <RowActions
                                  actions={actions}
                                  maxInline={1}
                                  moreLabel={tCommon("tooltips.moreActions")}
                                  className="justify-end"
                                />
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              renderMobile={(batch) => {
                const summary = (batch.summary ?? {}) as {
                  rows?: number;
                  created?: number;
                  updated?: number;
                  source?: string;
                };
                const sourceLabel = summary.source ? t(`source.${summary.source}`) : t("source.csv");
                const actions = [
                  {
                    key: "rollback",
                    label: t("rollbackAction"),
                    icon: RestoreIcon,
                    variant: "danger" as const,
                    onSelect: () => setRollbackBatchId(batch.id),
                    disabled: rollbackMutation.isLoading,
                  },
                ];

                return (
                  <div className="rounded-md border border-gray-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">
                          {formatDateTime(batch.createdAt, locale)}
                        </p>
                        <p className="text-xs text-gray-500">{sourceLabel}</p>
                      </div>
                      {batch.rolledBackAt ? (
                        <Badge variant="muted">{t("historyRolledBack")}</Badge>
                      ) : (
                        <Badge variant="success">{t("historyCompleted")}</Badge>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-500">
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-gray-400">
                          {t("historyColumns.rows")}
                        </p>
                        <p className="text-gray-700">{summary.rows ?? 0}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-gray-400">
                          {t("historyColumns.created")}
                        </p>
                        <p className="text-gray-700">{summary.created ?? 0}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-gray-400">
                          {t("historyColumns.updated")}
                        </p>
                        <p className="text-gray-700">{summary.updated ?? 0}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-gray-400">
                          {t("historyColumns.status")}
                        </p>
                        <p className="text-gray-700">
                          {batch.rolledBackAt ? t("historyRolledBack") : t("historyCompleted")}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-end">
                      {batch.rolledBackAt ? (
                        <span className="text-xs text-gray-400">{t("historyDone")}</span>
                      ) : (
                        <RowActions
                          actions={actions}
                          maxInline={1}
                          moreLabel={tCommon("tooltips.moreActions")}
                        />
                      )}
                    </div>
                  </div>
                );
              }}
            />
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

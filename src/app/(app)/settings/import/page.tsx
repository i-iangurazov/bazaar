"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import dynamic from "next/dynamic";

import {
  ImportDryRunPreview,
  type ImportDryRunPreviewData,
} from "@/components/import-dry-run-preview";
import { PageHeader } from "@/components/page-header";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Modal, ModalFooter } from "@/components/ui/modal";
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
  sourceRowNumber: number;
  sku: string;
  name?: string;
  unit?: string;
  category?: string;
  categories?: string[];
  color?: string;
  description?: string;
  photoUrl?: string;
  images?: { url: string; position?: number }[];
  variants?: {
    name?: string;
    sku?: string;
    attributes?: Record<string, unknown>;
  }[];
  barcodes?: string[];
  basePriceKgs?: number;
  purchasePriceKgs?: number;
  avgCostKgs?: number;
  minStock?: number;
  stockQty?: number;
};

type RawRow = Record<string, unknown>;

type MappingKey =
  | "sku"
  | "name"
  | "unit"
  | "category"
  | "color"
  | "description"
  | "photoUrl"
  | "variants"
  | "options"
  | "barcodes"
  | "basePriceKgs"
  | "purchasePriceKgs"
  | "avgCostKgs"
  | "minStock"
  | "stockQty";

type MappingState = Record<MappingKey, string>;

type ValidationError = {
  row: number;
  message: string;
  code:
    | "missingField"
    | "duplicateSku"
    | "duplicateBarcode"
    | "minLength"
    | "invalidNumber"
    | "invalidVariants"
    | "missingStoreForMinStock";
  value?: string;
};

type ImportSource = "cloudshop" | "onec" | "csv";
type ImportType = "products" | "customers";
type ImportMode = "full" | "update_selected";
type ImportUpdateField =
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

type ProductExistingBehavior = "update" | "skip";
type ProductEmptyValueBehavior = "keep" | "overwrite";
type ProductStockBehavior = "ignore" | "set" | "add";
type ProductImportRowAction = "create" | "update" | "skip";
type ProductImportRowDecision = {
  sourceRowNumber: number;
  action: ProductImportRowAction;
  existingProductId?: string;
};

type ImportRunSummary = {
  rows?: number;
  created?: number;
  updated?: number;
  skipped?: number;
  source?: string;
  mode?: ImportMode;
  updateMask?: ImportUpdateField[] | null;
  existingBehavior?: ProductExistingBehavior;
  emptyValueBehavior?: ProductEmptyValueBehavior;
  stockBehavior?: ProductStockBehavior;
  targetStoreId?: string;
  targetStoreName?: string;
  images?: {
    downloaded?: number;
    fallback?: number;
    missing?: number;
  };
};

type CustomerMappingKey =
  | "name"
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "phoneFallback"
  | "address"
  | "address1"
  | "address2"
  | "city"
  | "province"
  | "country"
  | "zip"
  | "createdAt";
type CustomerMappingState = Record<CustomerMappingKey, string>;
type CustomerImportRunSummary = {
  rows?: number;
  created?: number;
  updated?: number;
  skipped?: number;
  targetStoreName?: string;
  errors?: number;
};
type CustomerImportPreviewData = {
  rows: Array<{
    rowNumber: number;
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    action: "created" | "updated" | "skipped";
    matchStatus: "new" | "matched_email" | "matched_phone" | "possible_duplicate" | "error";
    matchedCustomer?: {
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
    } | null;
    createdAt?: Date | string | null;
    errors: string[];
    warnings: string[];
  }>;
  summary: {
    total: number;
    creatable: number;
    updatable: number;
    skipped: number;
    errors: number;
  };
};

/* eslint-disable-next-line @typescript-eslint/consistent-type-imports */
type XlsxModule = typeof import("xlsx");
/* eslint-disable-next-line @typescript-eslint/consistent-type-imports */
type PapaModule = typeof import("papaparse");
/* eslint-disable-next-line @typescript-eslint/consistent-type-imports */
type XlsxWorkSheet = import("xlsx").WorkSheet;
/* eslint-disable-next-line @typescript-eslint/consistent-type-imports */
type XlsxCellObject = import("xlsx").CellObject;

let xlsxModulePromise: Promise<XlsxModule> | null = null;
const loadXlsx = () => {
  if (!xlsxModulePromise) {
    xlsxModulePromise = import("xlsx");
  }
  return xlsxModulePromise;
};

const resolvePapaModule = (module: PapaModule): PapaModule => {
  if ("default" in module) {
    const maybeDefault = module.default;
    if (
      typeof maybeDefault === "object" &&
      maybeDefault !== null &&
      "parse" in maybeDefault &&
      typeof maybeDefault.parse === "function"
    ) {
      return maybeDefault as PapaModule;
    }
  }
  return module;
};

let papaModulePromise: Promise<PapaModule> | null = null;
const loadPapa = () => {
  if (!papaModulePromise) {
    papaModulePromise = import("papaparse").then((module) => resolvePapaModule(module));
  }
  return papaModulePromise;
};

const ImportPreviewTable = dynamic(() => import("@/components/import-preview-table"), {
  ssr: false,
  loading: () => (
    <div
      className="h-32 animate-pulse rounded-xl border border-dashed border-border bg-muted/30"
      aria-hidden
    />
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

const parseImageLinks = (value: string) => {
  const normalized = value.trim();
  if (!normalized) {
    return [];
  }
  const urlMatches = normalized.match(
    /(?:https?:\/\/|\/\/|www\.|\/uploads\/)[^\s"'`<>\[\]{}(),;|]+/gi,
  );
  const candidates = urlMatches?.length
    ? urlMatches
    : normalized
        .split(/[|,;\n\r]+/)
        .map((item) => item.trim())
        .filter(Boolean);

  return Array.from(
    new Set(
      candidates
        .map((item) => item.trim().replace(/^[\s"'`[\]{}()]+|[\s"'`[\]{}()]+$/g, ""))
        .filter(Boolean),
    ),
  );
};

const normalizeVariantAttributeValue = (value: unknown): unknown => {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeVariantAttributeValue(item)).filter((item) => item !== "");
  }
  return value;
};

const parseCategoryHierarchy = (value: string) =>
  value
    .split(/[|,]/)
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter((item) => item.length > 0)
    .filter((item, index, list) => list.indexOf(item) === index);

const applyColorToVariants = (variants: NonNullable<ImportRow["variants"]>, color: string) => {
  if (!color || !variants.length) {
    return variants;
  }
  return variants.map((variant) => ({
    ...variant,
    attributes: {
      color,
      ...(variant.attributes ?? {}),
    },
  }));
};

const parseVariants = (value: string) => {
  const normalized = value.trim();
  if (!normalized) {
    return {
      variants: [] as NonNullable<ImportRow["variants"]>,
      invalid: false,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    if (/^[\[{]/.test(normalized)) {
      return {
        variants: [] as NonNullable<ImportRow["variants"]>,
        invalid: true,
      };
    }
    const names = normalized
      .split(/[|,;\n\r]+/)
      .map((item) => item.trim().replace(/\s+/g, " "))
      .filter((item) => item.length > 0)
      .filter((item, index, list) => list.indexOf(item) === index);
    if (names.length) {
      return {
        variants: names.map((name) => ({ name })) as NonNullable<ImportRow["variants"]>,
        invalid: false,
      };
    }
    return {
      variants: [] as NonNullable<ImportRow["variants"]>,
      invalid: true,
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      variants: [] as NonNullable<ImportRow["variants"]>,
      invalid: true,
    };
  }

  const variants: NonNullable<ImportRow["variants"]> = [];
  const seenNames = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { variants: [], invalid: true };
    }
    const record = item as Record<string, unknown>;
    const name = normalizeValue(record.name);
    if (!name) {
      return { variants: [], invalid: true };
    }
    const nameKey = name.toLocaleLowerCase();
    if (seenNames.has(nameKey)) {
      continue;
    }
    seenNames.add(nameKey);
    const sku = normalizeValue(record.sku);
    const attributes = Object.fromEntries(
      Object.entries(record)
        .filter(([key]) => !["id", "name", "sku"].includes(key.toLocaleLowerCase()))
        .map(([key, attributeValue]) => [
          key.trim(),
          normalizeVariantAttributeValue(attributeValue),
        ])
        .filter(([key, attributeValue]) => key && attributeValue !== ""),
    );

    variants.push({
      name,
      sku: sku || undefined,
      attributes: Object.keys(attributes).length ? attributes : undefined,
    });
  }

  return { variants, invalid: false };
};

const normalizeOptionAttributeKey = (value: string) => {
  const normalized = value.trim().replace(/\s+/g, " ");
  const key = normalized.toLocaleLowerCase("ru-RU");
  if (["цвет", "color", "colour", "түс"].includes(key)) {
    return "color";
  }
  if (["размер", "size", "өлчөм"].includes(key)) {
    return "size";
  }
  return normalized;
};

const parseVariantOptions = (value: string) => {
  const normalized = value.trim();
  if (!normalized) {
    return {
      attributes: {} as Record<string, unknown>,
      invalid: false,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    const entries = normalized
      .split(/[;|\n\r]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    const attributes: Record<string, unknown> = {};
    for (const entry of entries) {
      const separatorIndex = entry.search(/[:=]/);
      if (separatorIndex <= 0) {
        return { attributes: {}, invalid: true };
      }
      const key = normalizeOptionAttributeKey(entry.slice(0, separatorIndex));
      const attributeValue = entry.slice(separatorIndex + 1).trim();
      if (!key || !attributeValue) {
        return { attributes: {}, invalid: true };
      }
      attributes[key] = attributeValue;
    }
    return { attributes, invalid: false };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { attributes: {}, invalid: true };
  }

  const attributes = Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>)
      .map(([key, attributeValue]) => [
        normalizeOptionAttributeKey(key),
        normalizeVariantAttributeValue(attributeValue),
      ])
      .filter(([key, attributeValue]) => key && attributeValue !== ""),
  );

  return { attributes, invalid: false };
};

const mergeOptionsIntoVariants = (
  variants: NonNullable<ImportRow["variants"]>,
  attributes: Record<string, unknown>,
) => {
  const optionEntries = Object.entries(attributes).filter(([, value]) => value !== "");
  if (!optionEntries.length) {
    return variants;
  }
  if (variants.length) {
    return variants.map((variant) => ({
      ...variant,
      attributes: {
        ...attributes,
        ...(variant.attributes ?? {}),
      },
    }));
  }

  return [
    {
      name: optionEntries.map(([, value]) => String(value)).join(" / "),
      attributes,
    },
  ] as NonNullable<ImportRow["variants"]>;
};

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

const parseOptionalIntegerValue = (value: string) => {
  const normalized = value.trim();
  if (!normalized) {
    return { value: undefined as number | undefined, invalid: false };
  }
  const compact = normalized.replace(/\s+/g, "").replace(",", ".");
  const parsed = Number(compact);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
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
    return normalizedCandidates.some(
      (candidate) => normalized.includes(candidate) || candidate.includes(normalized),
    );
  });
  return containsMatch ?? "";
};

const parseSpreadsheetRows = (sheet: XlsxWorkSheet, xlsx: XlsxModule) => {
  const rangeRef = sheet["!ref"];
  if (!rangeRef) {
    return { rows: [] as RawRow[], headers: [] as string[] };
  }

  const range = xlsx.utils.decode_range(rangeRef);
  const headers: string[] = [];
  for (let col = range.s.c; col <= range.e.c; col += 1) {
    const headerAddress = xlsx.utils.encode_cell({ r: range.s.r, c: col });
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
      const cellAddress = xlsx.utils.encode_cell({ r: rowIndex, c: col });
      const cell = sheet[cellAddress] as (XlsxCellObject & { l?: { Target?: string } }) | undefined;
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
  unit: detectColumn(headers, [
    "unit",
    "ед.изм",
    "едизм",
    "ед",
    "ед измерения",
    "единица измерения",
    "единицы измерения",
    "unitcode",
  ]),
  category: detectColumn(headers, ["category", "categories", "категория", "категории", "группа"]),
  color: detectColumn(headers, ["color", "colour", "цвет", "цветтовара", "түс"]),
  description: detectColumn(headers, ["description", "описание"]),
  basePriceKgs: detectColumn(
    headers,
    [
      "saleprice",
      "sale price",
      "baseprice",
      "base price",
      "price",
      "цена",
      "ценапродажи",
      "цена продажи",
      "продажнаяцена",
      "продажная цена",
      "базоваяцена",
      "базовая цена",
      "баа",
    ],
    { allowContains: true },
  ),
  purchasePriceKgs: detectColumn(
    headers,
    [
      "purchaseprice",
      "purchase price",
      "buyprice",
      "buy price",
      "цена закупки",
      "закупочнаяцена",
      "закупочная цена",
      "ценазакупки",
    ],
    { allowContains: true },
  ),
  avgCostKgs: detectColumn(
    headers,
    ["cost", "avgcost", "себестоимость", "средняясебестоимость", "costprice"],
    { allowContains: true },
  ),
  minStock: detectColumn(
    headers,
    ["minstock", "minimumstock", "минимальныйостаток", "миностаток", "минкалдык"],
    { allowContains: true },
  ),
  stockQty: detectColumn(
    headers,
    [
      "stock",
      "quantity",
      "qty",
      "onhand",
      "on hand",
      "in stock",
      "instock",
      "available",
      "в наличии",
      "наличие",
      "остаток",
      "остаток на складе",
      "количество",
      "кол-во",
      "колво",
      "саны",
      "калдыгы",
    ],
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
      "images",
      "image url",
      "imageurl",
      "image link",
      "imagelink",
      "изображение",
      "изображения",
      "изображениеurl",
      "изображениессылка",
      "ссылка на изображение",
      "ссылка на фото",
      "фото",
      "фотографии",
      "фотоurl",
      "фототовара",
      "фотоссылка",
      "картинка",
      "картинкассылка",
      "url",
    ],
    { allowContains: true },
  ),
  variants: detectColumn(
    headers,
    [
      "variants",
      "variant",
      "variant json",
      "variant_json",
      "варианты",
      "вариации",
      "модификации",
      "размеры",
      "вариант",
    ],
    { allowContains: true },
  ),
  options: detectColumn(
    headers,
    [
      "options",
      "option",
      "attributes",
      "properties",
      "опции",
      "опция",
      "характеристики",
      "свойства",
    ],
    { allowContains: true },
  ),
  barcodes: detectColumn(headers, ["barcode", "barcodes", "штрихкод", "штрихкоды"]),
});

const emptyCustomerMapping = (): CustomerMappingState => ({
  name: "",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  phoneFallback: "",
  address: "",
  address1: "",
  address2: "",
  city: "",
  province: "",
  country: "",
  zip: "",
  createdAt: "",
});

const buildDefaultCustomerMapping = (headers: string[]): CustomerMappingState => ({
  name: detectColumn(headers, [
    "name",
    "full name",
    "customer name",
    "customer",
    "client",
    "клиент",
    "фио",
  ]),
  firstName: detectColumn(headers, ["first name", "firstname", "first_name", "имя", "аты"]),
  lastName: detectColumn(headers, ["last name", "lastname", "last_name", "фамилия"]),
  email: detectColumn(headers, ["email", "e-mail", "почта", "электронная почта", "элпочта"]),
  phone: detectColumn(headers, [
    "phone",
    "телефон",
    "номер",
    "тел",
    "mobile",
    "customer phone",
    "байланыш",
  ]),
  phoneFallback: detectColumn(headers, [
    "default address phone",
    "address phone",
    "default_address_phone",
  ]),
  address: detectColumn(headers, ["address", "адрес", "дарек"]),
  address1: detectColumn(headers, ["default address address1", "address1", "address 1", "улица"]),
  address2: detectColumn(headers, [
    "default address address2",
    "address2",
    "address 2",
    "квартира",
  ]),
  city: detectColumn(headers, ["default address city", "city", "город", "шаар"]),
  province: detectColumn(headers, [
    "default address province code",
    "province",
    "province code",
    "region",
    "область",
  ]),
  country: detectColumn(headers, [
    "default address country code",
    "country",
    "country code",
    "страна",
  ]),
  zip: detectColumn(headers, ["default address zip", "zip", "postal code", "postcode", "индекс"]),
  createdAt: detectColumn(headers, ["created", "created at", "date created", "создан", "создано"]),
});

const detectCustomerImportSource = (headers: string[]) => {
  const normalized = headers.map((header) => normalizeHeader(header));
  const looksLikeShopify =
    normalized.some((header) => header.includes("defaultaddress")) ||
    normalized.some((header) => header.includes("accepts") || header.includes("totalorders"));
  return looksLikeShopify ? "Shopify import" : "Import";
};

const DRY_RUN_PREVIEW_ROW_LIMIT = 100;
const MAX_IMPORT_TRANSPORT_ROWS = 500;
const MAX_IMPORT_TRANSPORT_IMAGES = 200;
const MAX_IMPORT_TRANSPORT_BYTES = 1_500_000;

type ImportTransportBase = {
  source: ImportSource;
  storeId: string;
  mode: ImportMode;
  updateMask?: ImportUpdateField[];
  previewLimit?: number;
  existingBehavior?: ProductExistingBehavior;
  emptyValueBehavior?: ProductEmptyValueBehavior;
  stockBehavior?: ProductStockBehavior;
  rowActions?: ProductImportRowDecision[];
};

type ImportTransportPayload = ImportTransportBase & {
  rows: ImportRow[];
};

const jsonByteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

const countImportRowImages = (row: ImportRow) => {
  if (row.images?.length) {
    return row.images.length;
  }
  return row.photoUrl ? 1 : 0;
};

const splitRowsForTransport = (
  rows: ImportRow[],
  base: ImportTransportBase,
): ImportTransportPayload[] => {
  const chunks: ImportTransportPayload[] = [];
  const baseBytes = jsonByteLength({ ...base, rows: [] });
  let chunkRows: ImportRow[] = [];
  let chunkBytes = baseBytes;
  let chunkImages = 0;

  const flushChunk = () => {
    if (!chunkRows.length) {
      return;
    }
    chunks.push({ ...base, rows: chunkRows });
    chunkRows = [];
    chunkBytes = baseBytes;
    chunkImages = 0;
  };

  rows.forEach((row) => {
    const rowBytes = jsonByteLength(row) + 2;
    const rowImages = countImportRowImages(row);
    const wouldExceedRows = chunkRows.length >= MAX_IMPORT_TRANSPORT_ROWS;
    const wouldExceedImages =
      chunkRows.length > 0 && chunkImages + rowImages > MAX_IMPORT_TRANSPORT_IMAGES;
    const wouldExceedBytes =
      chunkRows.length > 0 && chunkBytes + rowBytes > MAX_IMPORT_TRANSPORT_BYTES;
    if (wouldExceedRows || wouldExceedImages || wouldExceedBytes) {
      flushChunk();
    }
    chunkRows.push(row);
    chunkBytes += rowBytes;
    chunkImages += rowImages;
  });

  flushChunk();
  return chunks;
};

type DryRunPreviewRow = ImportDryRunPreviewData["rows"][number];
type DryRunPreviewSummary = ImportDryRunPreviewData["summary"];

const createEmptyDryRunSummary = (): DryRunPreviewSummary => ({
  creates: 0,
  updates: 0,
  skipped: 0,
  warningCount: 0,
  blockingWarningCount: 0,
  possibleDuplicateCount: 0,
  totalRows: 0,
  returnedRows: 0,
  truncated: false,
});

const dryRunRowKey = (row: DryRunPreviewRow) => `${row.sourceRowNumber}:${row.sku}`;

const selectDryRunRows = (rows: DryRunPreviewRow[], limit: number) => {
  if (rows.length <= limit) {
    return rows;
  }
  const selected = new Map<string, DryRunPreviewRow>();
  const addRows = (candidates: DryRunPreviewRow[]) => {
    for (const row of candidates) {
      if (selected.size >= limit) {
        return;
      }
      selected.set(dryRunRowKey(row), row);
    }
  };

  addRows(rows.filter((row) => row.hasBlockingWarnings));
  addRows(rows.filter((row) => row.warnings.length > 0));
  addRows(rows);

  return Array.from(selected.values()).sort(
    (left, right) => left.sourceRowNumber - right.sourceRowNumber,
  );
};

const mergeDryRunPreview = (
  current: ImportDryRunPreviewData,
  next: ImportDryRunPreviewData,
): ImportDryRunPreviewData => {
  const totalRows = current.summary.totalRows + next.summary.totalRows;
  const rows = selectDryRunRows([...current.rows, ...next.rows], DRY_RUN_PREVIEW_ROW_LIMIT);

  return {
    rows,
    summary: {
      creates: current.summary.creates + next.summary.creates,
      updates: current.summary.updates + next.summary.updates,
      skipped: current.summary.skipped + next.summary.skipped,
      warningCount: current.summary.warningCount + next.summary.warningCount,
      blockingWarningCount:
        current.summary.blockingWarningCount + next.summary.blockingWarningCount,
      possibleDuplicateCount:
        (current.summary.possibleDuplicateCount ?? 0) + (next.summary.possibleDuplicateCount ?? 0),
      totalRows,
      returnedRows: rows.length,
      truncated: rows.length < totalRows,
    },
  };
};

const resetImportFormState = (setters: {
  setRawRows: (rows: RawRow[]) => void;
  setHeaders: (headers: string[]) => void;
  setMapping: (mapping: MappingState) => void;
  setFileName: (fileName: string | null) => void;
  setDefaultUnitCode: (unitCode: string) => void;
  setSkippedRows: (rows: number[]) => void;
}) => {
  setters.setRawRows([]);
  setters.setHeaders([]);
  setters.setMapping({
    sku: "",
    name: "",
    unit: "",
    category: "",
    color: "",
    description: "",
    basePriceKgs: "",
    purchasePriceKgs: "",
    avgCostKgs: "",
    minStock: "",
    stockQty: "",
    photoUrl: "",
    variants: "",
    options: "",
    barcodes: "",
  });
  setters.setFileName(null);
  setters.setDefaultUnitCode("");
  setters.setSkippedRows([]);
};

const PRODUCT_TEMPLATE_HEADERS = [
  "Название",
  "SKU",
  "Штрихкод",
  "Категория",
  "Описание",
  "Цена",
  "Себестоимость",
  "В наличии",
  "Минимальный остаток",
  "Ед. изм.",
  "Изображения",
  "Варианты",
  "Опции",
];

const PRODUCT_TEMPLATE_EXAMPLE = [
  "Тестовый товар",
  "SKU-0001",
  "1234567890123",
  "Тестовая категория",
  "Описание тестового товара",
  100,
  70,
  15,
  3,
  "шт",
  "https://example.com/product-1.jpg; https://example.com/product-2.jpg",
  '[{"name":"Черный / M","sku":"SKU-0001-BLK-M","color":"черный","size":"M"}]',
  "Цвет: черный; Размер: M",
];

const PRODUCT_TEMPLATE_INSTRUCTIONS = [
  ["Поле", "Формат"],
  [
    "Изображения",
    "Один URL или несколько URL через запятую, точку с запятой, | или перенос строки.",
  ],
  [
    "Варианты",
    'JSON-массив вариантов: [{"name":"Черный / M","sku":"SKU-0001-BLK-M","color":"черный","size":"M"}]. Также поддерживается простой список названий через запятую, точку с запятой или |.',
  ],
  [
    "Опции",
    'Пары ключ-значение через точку с запятой: "Цвет: черный; Размер: M". Если колонка "Варианты" пустая, опции создают один вариант.',
  ],
];

const CustomerImportPanel = ({
  targetStoreId,
  selectedStoreName,
}: {
  targetStoreId: string;
  selectedStoreName?: string | null;
}) => {
  const t = useTranslations("imports");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { toast } = useToast();
  const [fileName, setFileName] = useState<string | null>(null);
  const [rawRows, setRawRows] = useState<RawRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<CustomerMappingState>(() => emptyCustomerMapping());
  const [importSourceLabel, setImportSourceLabel] = useState("Import");
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<CustomerImportPreviewData | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<CustomerImportRunSummary | null>(null);
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [previewStartedAt, setPreviewStartedAt] = useState<number | null>(null);
  const [previewElapsedSeconds, setPreviewElapsedSeconds] = useState(0);
  const [importStartedAt, setImportStartedAt] = useState<number | null>(null);
  const [importElapsedSeconds, setImportElapsedSeconds] = useState(0);
  const previewMutation = trpc.customers.previewImport.useMutation();
  const importMutation = trpc.customers.importRows.useMutation();
  const previewMutationRef = useRef(previewMutation.mutateAsync);
  const previewRequestRef = useRef(0);

  useEffect(() => {
    previewMutationRef.current = previewMutation.mutateAsync;
  }, [previewMutation.mutateAsync]);

  const mappedRows = useMemo(
    () =>
      rawRows.map((row, index) => {
        const firstName = mapping.firstName ? normalizeValue(row[mapping.firstName]) : "";
        const lastName = mapping.lastName ? normalizeValue(row[mapping.lastName]) : "";
        const fullName = mapping.name ? normalizeValue(row[mapping.name]) : "";
        const email = mapping.email ? normalizeValue(row[mapping.email]) : "";
        const primaryPhone = mapping.phone ? normalizeValue(row[mapping.phone]) : "";
        const fallbackPhone = mapping.phoneFallback
          ? normalizeValue(row[mapping.phoneFallback])
          : "";
        const phone = primaryPhone || fallbackPhone;
        const address = mapping.address ? normalizeValue(row[mapping.address]) : "";
        const address1 = mapping.address1 ? normalizeValue(row[mapping.address1]) : "";
        const address2 = mapping.address2 ? normalizeValue(row[mapping.address2]) : "";
        const city = mapping.city ? normalizeValue(row[mapping.city]) : "";
        const province = mapping.province ? normalizeValue(row[mapping.province]) : "";
        const country = mapping.country ? normalizeValue(row[mapping.country]) : "";
        const zip = mapping.zip ? normalizeValue(row[mapping.zip]) : "";
        const name =
          [firstName, lastName].filter(Boolean).join(" ") ||
          fullName ||
          firstName ||
          lastName ||
          (email.includes("@") ? email.split("@")[0] : email) ||
          phone ||
          "Без имени";
        const createdAt = mapping.createdAt ? normalizeValue(row[mapping.createdAt]) : "";
        return {
          rowNumber: index + 2,
          name,
          email,
          phone,
          address,
          address1,
          address2,
          city,
          province,
          country,
          zip,
          createdAt: createdAt || undefined,
        };
      }),
    [mapping, rawRows],
  );

  const missingMapping =
    !mapping.name &&
    !mapping.firstName &&
    !mapping.lastName &&
    !mapping.email &&
    !mapping.phone &&
    !mapping.phoneFallback;
  const canPreview = Boolean(targetStoreId && mappedRows.length && !missingMapping);
  const isPreviewing =
    canPreview &&
    (previewStartedAt !== null || previewMutation.isLoading || (!preview && !previewError));
  const isImporting = importStartedAt !== null || importMutation.isLoading;
  const importableCustomerRows = preview
    ? preview.summary.creatable + preview.summary.updatable
    : 0;

  useEffect(() => {
    const runId = previewRequestRef.current + 1;
    previewRequestRef.current = runId;
    setPreview(null);
    setPreviewError(null);
    setPreviewStartedAt(null);
    if (!canPreview) {
      return;
    }
    const timer = window.setTimeout(() => {
      setPreviewElapsedSeconds(0);
      setPreviewStartedAt(Date.now());
      previewMutationRef
        .current({ storeId: targetStoreId, rows: mappedRows })
        .then((result) => {
          if (previewRequestRef.current === runId) {
            setPreview(result);
          }
        })
        .catch((error) => {
          if (previewRequestRef.current === runId) {
            setPreviewError(translateError(tErrors, error));
          }
        })
        .finally(() => {
          if (previewRequestRef.current === runId) {
            setPreviewStartedAt(null);
          }
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [canPreview, mappedRows, targetStoreId, tErrors]);

  useEffect(() => {
    if (!previewStartedAt) {
      setPreviewElapsedSeconds(0);
      return;
    }
    const updateElapsed = () =>
      setPreviewElapsedSeconds(Math.max(0, Math.floor((Date.now() - previewStartedAt) / 1000)));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [previewStartedAt]);

  useEffect(() => {
    if (!importStartedAt) {
      setImportElapsedSeconds(0);
      return;
    }
    const updateElapsed = () =>
      setImportElapsedSeconds(Math.max(0, Math.floor((Date.now() - importStartedAt) / 1000)));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [importStartedAt]);

  const handleFile = async (file: File) => {
    setIsParsingFile(true);
    setFileError(null);
    setFileName(file.name);
    setRawRows([]);
    setHeaders([]);
    setMapping(emptyCustomerMapping());
    setPreview(null);
    setPreviewError(null);
    setLastSummary(null);
    setImportSourceLabel("Import");

    try {
      if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
        const xlsx = await loadXlsx();
        const buffer = await file.arrayBuffer();
        const workbook = xlsx.read(buffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const parsed = parseSpreadsheetRows(sheet, xlsx);
        setRawRows(parsed.rows);
        setHeaders(parsed.headers);
        setMapping(buildDefaultCustomerMapping(parsed.headers));
        setImportSourceLabel(detectCustomerImportSource(parsed.headers));
        setIsParsingFile(false);
        return;
      }

      const papa = await loadPapa();
      papa.parse<RawRow>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results: { data: RawRow[] }) => {
          const nextHeaders = Object.keys(results.data[0] ?? {});
          setRawRows(results.data);
          setHeaders(nextHeaders);
          setMapping(buildDefaultCustomerMapping(nextHeaders));
          setImportSourceLabel(detectCustomerImportSource(nextHeaders));
          setIsParsingFile(false);
        },
        error: () => {
          setFileError(t("fileParseError"));
          setIsParsingFile(false);
        },
      });
    } catch {
      setFileError(t("fileParseError"));
      setIsParsingFile(false);
    }
  };

  const handleDownloadErrors = () => {
    const rows = preview?.rows.filter((row) => row.errors.length) ?? [];
    if (!rows.length) {
      return;
    }
    const lines = [
      [t("errorCsvRowHeader"), t("errorCsvMessageHeader")].map(escapeCsv).join(","),
      ...rows.map((row) =>
        [String(row.rowNumber), row.errors.join(" | ")].map(escapeCsv).join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `customer-import-errors-${locale}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    if (!targetStoreId) {
      toast({ variant: "error", description: tErrors("storeRequired") });
      return;
    }
    if (!mappedRows.length || missingMapping) {
      toast({ variant: "error", description: tErrors("invalidInput") });
      return;
    }
    if (!preview || importableCustomerRows <= 0) {
      toast({ variant: "error", description: t("importEmpty") });
      return;
    }
    setImportElapsedSeconds(0);
    setImportStartedAt(Date.now());
    try {
      const result = await importMutation.mutateAsync({
        storeId: targetStoreId,
        rows: mappedRows,
        source: importSourceLabel,
      });
      setLastSummary(result.summary as CustomerImportRunSummary);
      const importedCount = (result.summary.created ?? 0) + (result.summary.updated ?? 0);
      toast({
        variant: "success",
        description: t("customerImport.success", { count: importedCount }),
      });
    } catch (error) {
      toast({
        variant: "error",
        description: translateError(tErrors, error as Parameters<typeof translateError>[1]),
      });
    } finally {
      setImportStartedAt(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="bazaar-admin-surface">
        <CardHeader>
          <CardTitle>{t("customerImport.uploadTitle")}</CardTitle>
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
            <Badge variant="muted">{fileName}</Badge>
          ) : (
            <div className="bazaar-admin-notice flex items-center gap-2">
              <EmptyIcon className="h-4 w-4" aria-hidden />
              {t("customerImport.uploadHint")}
            </div>
          )}
          {isParsingFile ? (
            <div className="bazaar-admin-notice flex items-center gap-2">
              <Spinner className="h-4 w-4" />
              {t("customerImport.parsingFile", { file: fileName ?? "" })}
            </div>
          ) : null}
          {fileError ? <p className="text-sm text-danger">{fileError}</p> : null}
        </CardContent>
      </Card>

      <Card className="bazaar-admin-surface">
        <CardHeader>
          <CardTitle>{t("customerImport.mappingTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {headers.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {(
                [
                  "firstName",
                  "lastName",
                  "name",
                  "email",
                  "phone",
                  "phoneFallback",
                  "address1",
                  "address2",
                  "address",
                  "city",
                  "province",
                  "country",
                  "zip",
                  "createdAt",
                ] as CustomerMappingKey[]
              ).map((field) => (
                <div key={field} className="space-y-1.5">
                  <p className="text-sm font-medium">{t(`customerImport.fields.${field}`)}</p>
                  <Select
                    value={mapping[field] || "__none"}
                    onValueChange={(value) =>
                      setMapping((current) => ({
                        ...current,
                        [field]: value === "__none" ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("mappingSelectPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">{t("mappingIgnore")}</SelectItem>
                      {headers.map((header) => (
                        <SelectItem key={header} value={header}>
                          {header}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("mappingEmpty")}</p>
          )}
          {missingMapping && headers.length ? (
            <p className="text-sm text-danger">{t("customerImport.mappingRequired")}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="bazaar-admin-surface">
        <CardHeader>
          <CardTitle>{t("customerImport.previewTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isPreviewing ? (
            <div className="bazaar-admin-notice flex items-start gap-3">
              <Spinner className="h-4 w-4" />
              <div className="space-y-1">
                <p className="font-medium text-foreground">
                  {t("customerImport.previewInProgress", {
                    count: mappedRows.length,
                    elapsed: previewElapsedSeconds,
                  })}
                </p>
                <p>{t("customerImport.previewInProgressHint")}</p>
              </div>
            </div>
          ) : null}
          {previewError ? <p className="text-sm text-danger">{previewError}</p> : null}
          {preview ? (
            <>
              {preview.summary.errors > 0 ? (
                <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-muted-foreground">
                  {t("customerImport.partialImportHint", {
                    valid: importableCustomerRows,
                    skipped: preview.summary.skipped,
                  })}
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                <div className="bazaar-admin-info-tile">
                  <p className="text-muted-foreground">{t("customerImport.summary.created")}</p>
                  <p className="text-lg font-semibold">{preview.summary.creatable}</p>
                </div>
                <div className="bazaar-admin-info-tile">
                  <p className="text-muted-foreground">{t("customerImport.summary.updated")}</p>
                  <p className="text-lg font-semibold">{preview.summary.updatable}</p>
                </div>
                <div className="bazaar-admin-info-tile">
                  <p className="text-muted-foreground">{t("customerImport.summary.skipped")}</p>
                  <p className="text-lg font-semibold">{preview.summary.skipped}</p>
                </div>
                <div className="bazaar-admin-info-tile">
                  <p className="text-muted-foreground">{t("customerImport.summary.errors")}</p>
                  <p className="text-lg font-semibold">{preview.summary.errors}</p>
                </div>
              </div>
              <div className="bazaar-admin-table-shell bazaar-admin-table-scroll">
                <Table className="min-w-[760px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("errorCsvRowHeader")}</TableHead>
                      <TableHead>{t("customerImport.fields.name")}</TableHead>
                      <TableHead>{t("customerImport.fields.email")}</TableHead>
                      <TableHead>{t("customerImport.fields.phone")}</TableHead>
                      <TableHead>{t("customerImport.fields.address")}</TableHead>
                      <TableHead>{t("customerImport.fields.matchStatus")}</TableHead>
                      <TableHead>{t("customerImport.fields.matchedCustomer")}</TableHead>
                      <TableHead>{t("customerImport.fields.action")}</TableHead>
                      <TableHead>{t("customerImport.fields.errors")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.slice(0, 50).map((row) => (
                      <TableRow key={row.rowNumber}>
                        <TableCell>{row.rowNumber}</TableCell>
                        <TableCell>{row.name || "-"}</TableCell>
                        <TableCell>{row.email ?? "-"}</TableCell>
                        <TableCell>{row.phone ?? "-"}</TableCell>
                        <TableCell>{row.address ?? "-"}</TableCell>
                        <TableCell>{t(`customerImport.matchStatus.${row.matchStatus}`)}</TableCell>
                        <TableCell>
                          {row.matchedCustomer ? (
                            <div className="space-y-1 text-xs text-muted-foreground">
                              <p className="font-medium text-foreground">
                                {row.matchedCustomer.name}
                              </p>
                              <p>{row.matchedCustomer.email ?? row.matchedCustomer.phone ?? "-"}</p>
                            </div>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell>{t(`customerImport.actions.${row.action}`)}</TableCell>
                        <TableCell className={row.errors.length ? "text-danger" : undefined}>
                          {row.errors.length
                            ? row.errors
                                .map((error) => t(`customerImport.errors.${error}`))
                                .join(", ")
                            : row.warnings.length
                              ? row.warnings
                                  .map((warning) =>
                                    warning.startsWith("customerConflicts:")
                                      ? t("customerImport.warnings.customerConflicts")
                                      : t(`customerImport.warnings.${warning}`),
                                  )
                                  .join(", ")
                              : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {preview.rows.some((row) => row.errors.length) ? (
                <Button type="button" variant="secondary" onClick={handleDownloadErrors}>
                  <DownloadIcon className="h-4 w-4" aria-hidden />
                  {t("downloadErrors")}
                </Button>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("customerImport.previewEmpty")}</p>
          )}
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => void handleImport()}
              disabled={
                !targetStoreId ||
                !mappedRows.length ||
                missingMapping ||
                isParsingFile ||
                isImporting ||
                isPreviewing ||
                Boolean(previewError) ||
                !preview ||
                importableCustomerRows <= 0
              }
            >
              {isImporting ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <UploadIcon className="h-4 w-4" aria-hidden />
              )}
              {isImporting ? tCommon("loading") : t("customerImport.apply")}
            </Button>
          </div>
          {isImporting ? (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              <div className="space-y-1">
                <p className="font-medium text-foreground">
                  {t("customerImport.importInProgress", {
                    count: mappedRows.length,
                    elapsed: importElapsedSeconds,
                  })}
                </p>
                <p>{t("customerImport.importInProgressHint")}</p>
              </div>
            </div>
          ) : null}
          {lastSummary ? (
            <div className="rounded-xl border border-success/40 bg-success/10 p-3 text-sm">
              <p className="font-medium">{t("importResultTitle")}</p>
              <p className="text-xs text-muted-foreground">
                {t("targetStoreApplied", {
                  store: lastSummary.targetStoreName ?? selectedStoreName ?? "",
                })}
              </p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div className="border border-success/40 bg-card p-2">
                  {t("historyColumns.created")}: {lastSummary.created ?? 0}
                </div>
                <div className="border border-success/40 bg-card p-2">
                  {t("historyColumns.updated")}: {lastSummary.updated ?? 0}
                </div>
                <div className="border border-success/40 bg-card p-2">
                  {t("historyColumns.skipped")}: {lastSummary.skipped ?? 0}
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};

const ImportPage = () => {
  const t = useTranslations("imports");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session, status } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const canUseImports = session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";
  const isForbidden = status === "authenticated" && !canUseImports;
  const { toast } = useToast();
  const [importType, setImportType] = useState<ImportType>("products");

  const [fileName, setFileName] = useState<string | null>(null);
  const [rawRows, setRawRows] = useState<RawRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<MappingState>({
    sku: "",
    name: "",
    unit: "",
    category: "",
    color: "",
    description: "",
    basePriceKgs: "",
    purchasePriceKgs: "",
    avgCostKgs: "",
    minStock: "",
    stockQty: "",
    photoUrl: "",
    variants: "",
    options: "",
    barcodes: "",
  });
  const [importMode, setImportMode] = useState<ImportMode>("full");
  const [existingBehavior, setExistingBehavior] = useState<ProductExistingBehavior>("update");
  const [emptyValueBehavior, setEmptyValueBehavior] = useState<ProductEmptyValueBehavior>("keep");
  const [stockBehavior, setStockBehavior] = useState<ProductStockBehavior>("set");
  const [productRowActions, setProductRowActions] = useState<
    Record<number, ProductImportRowDecision>
  >({});
  const [selectedUpdateFields, setSelectedUpdateFields] = useState<ImportUpdateField[]>([
    "basePriceKgs",
    "purchasePriceKgs",
    "avgCostKgs",
    "minStock",
  ]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [source, setSource] = useState<ImportSource>("csv");
  const [rollbackBatchId, setRollbackBatchId] = useState<string | null>(null);
  const [defaultUnitCode, setDefaultUnitCode] = useState("");
  const [targetStoreId, setTargetStoreId] = useState("");
  const [skippedRows, setSkippedRows] = useState<number[]>([]);
  const [importStartedAt, setImportStartedAt] = useState<number | null>(null);
  const [importElapsedSeconds, setImportElapsedSeconds] = useState(0);
  const [lastImportSummary, setLastImportSummary] = useState<ImportRunSummary | null>(null);
  const [dryRunPreview, setDryRunPreview] = useState<ImportDryRunPreviewData | null>(null);
  const [dryRunPreviewError, setDryRunPreviewError] = useState<string | null>(null);
  const [dryRunPreviewPending, setDryRunPreviewPending] = useState(false);
  const dryRunRequestVersionRef = useRef(0);

  const batchesQuery = trpc.imports.list.useQuery(undefined, { enabled: isAdmin });
  const unitsQuery = trpc.units.list.useQuery(undefined, {
    enabled: isAdmin && importType === "products",
  });
  const storesQuery = trpc.stores.list.useQuery(undefined, { enabled: Boolean(canUseImports) });
  const rollbackDetailsQuery = trpc.imports.get.useQuery(
    { batchId: rollbackBatchId ?? "" },
    { enabled: Boolean(rollbackBatchId) },
  );

  const importMutation = trpc.products.importCsv.useMutation();
  const importCsvRef = useRef(importMutation.mutateAsync);
  const previewMutation = trpc.products.previewImportCsv.useMutation();
  const previewImportRef = useRef(previewMutation.mutateAsync);

  useEffect(() => {
    previewImportRef.current = previewMutation.mutateAsync;
  }, [previewMutation.mutateAsync]);

  useEffect(() => {
    importCsvRef.current = importMutation.mutateAsync;
  }, [importMutation.mutateAsync]);

  useEffect(() => {
    if (status === "authenticated" && !isAdmin) {
      setImportType("customers");
    }
  }, [isAdmin, status]);

  const stores = useMemo(() => storesQuery.data ?? [], [storesQuery.data]);
  const selectedTargetStore = stores.find((store) => store.id === targetStoreId) ?? null;

  useEffect(() => {
    setTargetStoreId((currentStoreId) => {
      if (!stores.length) {
        return "";
      }
      if (currentStoreId && stores.some((store) => store.id === currentStoreId)) {
        return currentStoreId;
      }
      return stores[0].id;
    });
  }, [stores]);

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

  const batches = (batchesQuery.data ?? []).filter((batch) => batch.type === "products");
  const rollbackBatch = batches.find((batch) => batch.id === rollbackBatchId) ?? null;
  const resolveEntityLabel = (entityType: string) => {
    switch (entityType) {
      case "Product":
        return t("rollbackEntities.product");
      case "ProductBarcode":
        return t("rollbackEntities.barcode");
      case "ProductVariant":
        return t("rollbackEntities.variant");
      case "AttributeDefinition":
        return t("rollbackEntities.attribute");
      case "PurchaseOrder":
        return t("rollbackEntities.purchaseOrder");
      case "ReorderPolicy":
        return t("rollbackEntities.reorderPolicy");
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
      { key: "color" as const, label: t("fieldColor"), required: false },
      { key: "description" as const, label: t("fieldDescription"), required: false },
      { key: "basePriceKgs" as const, label: t("fieldBasePrice"), required: false },
      { key: "purchasePriceKgs" as const, label: t("fieldPurchasePrice"), required: false },
      { key: "avgCostKgs" as const, label: t("fieldAvgCost"), required: false },
      { key: "minStock" as const, label: t("fieldMinStock"), required: false },
      { key: "stockQty" as const, label: t("fieldStockQty"), required: false },
      { key: "photoUrl" as const, label: t("fieldPhotoUrl"), required: false },
      { key: "variants" as const, label: t("fieldVariants"), required: false },
      { key: "options" as const, label: t("fieldOptions"), required: false },
      { key: "barcodes" as const, label: t("fieldBarcodes"), required: false },
    ],
    [t],
  );

  const selectedUpdateFieldSet = useMemo(
    () => new Set<ImportUpdateField>(selectedUpdateFields),
    [selectedUpdateFields],
  );
  const isUpdateSelectedMode = importMode === "update_selected";
  const requiredFields = useMemo(() => {
    const required = new Set<MappingKey>(["sku"]);
    if (isUpdateSelectedMode) {
      selectedUpdateFieldSet.forEach((field) => {
        required.add(field as MappingKey);
      });
      return required;
    }
    required.add("name");
    required.add("unit");
    return required;
  }, [isUpdateSelectedMode, selectedUpdateFieldSet]);
  const updateSelectableFields = useMemo(
    () => mappingFields.filter((field) => field.key !== "sku" && field.key !== "options"),
    [mappingFields],
  );

  const missingRequired = useMemo(
    () =>
      mappingFields.filter((field) => {
        if (!requiredFields.has(field.key)) {
          return false;
        }
        if (field.key === "unit") {
          return !mapping.unit && !defaultUnitCode;
        }
        return !mapping[field.key];
      }),
    [defaultUnitCode, mapping, mappingFields, requiredFields],
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
      const name = mapping.name ? normalizeValue(row[mapping.name]) : "";
      const unitFromRow = mapping.unit ? normalizeValue(row[mapping.unit]) : "";
      const unit = unitFromRow || defaultUnitCode;
      const shouldApply = (field: ImportUpdateField) =>
        importMode === "full" || selectedUpdateFieldSet.has(field);

      if (!sku) {
        errors.push({
          row: rowNumber,
          message: t("rowMissing", { row: rowNumber, field: t("fieldSku") }),
          code: "missingField",
          value: "sku",
        });
        return;
      }
      if (shouldApply("name") && !name) {
        errors.push({
          row: rowNumber,
          message: t("rowMissing", { row: rowNumber, field: t("fieldName") }),
          code: "missingField",
          value: "name",
        });
        return;
      }
      if (shouldApply("unit") && !unit) {
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
      if (shouldApply("name") && name.length < 2) {
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

      const barcodesValue =
        shouldApply("barcodes") && mapping.barcodes ? normalizeValue(row[mapping.barcodes]) : "";
      const barcodes = barcodesValue ? parseBarcodes(barcodesValue) : [];
      const basePriceCandidate =
        shouldApply("basePriceKgs") && mapping.basePriceKgs
          ? normalizeValue(row[mapping.basePriceKgs])
          : "";
      const purchasePriceCandidate =
        shouldApply("purchasePriceKgs") && mapping.purchasePriceKgs
          ? normalizeValue(row[mapping.purchasePriceKgs])
          : "";
      const avgCostCandidate =
        shouldApply("avgCostKgs") && mapping.avgCostKgs
          ? normalizeValue(row[mapping.avgCostKgs])
          : "";
      const minStockCandidate =
        shouldApply("minStock") && mapping.minStock ? normalizeValue(row[mapping.minStock]) : "";
      const stockQtyCandidate =
        stockBehavior !== "ignore" && shouldApply("stockQty") && mapping.stockQty
          ? normalizeValue(row[mapping.stockQty])
          : "";
      const categories =
        shouldApply("category") && mapping.category
          ? parseCategoryHierarchy(normalizeValue(row[mapping.category]))
          : [];
      const color = shouldApply("color") && mapping.color ? normalizeValue(row[mapping.color]) : "";
      const imageValue =
        shouldApply("photoUrl") && mapping.photoUrl ? normalizeValue(row[mapping.photoUrl]) : "";
      const imageUrls = imageValue ? parseImageLinks(imageValue) : [];
      const variantsValue =
        shouldApply("variants") && mapping.variants ? normalizeValue(row[mapping.variants]) : "";
      const parsedVariants = variantsValue
        ? parseVariants(variantsValue)
        : { variants: [] as NonNullable<ImportRow["variants"]>, invalid: false };
      const optionsValue =
        shouldApply("variants") && mapping.options ? normalizeValue(row[mapping.options]) : "";
      const parsedOptions = optionsValue
        ? parseVariantOptions(optionsValue)
        : { attributes: {} as Record<string, unknown>, invalid: false };
      const variantsWithOptions = mergeOptionsIntoVariants(
        parsedVariants.variants,
        parsedOptions.attributes,
      );
      const variants = color
        ? applyColorToVariants(variantsWithOptions, color)
        : variantsWithOptions;
      const basePriceResult = parseOptionalNumericValue(basePriceCandidate);
      const purchasePriceResult = parseOptionalNumericValue(purchasePriceCandidate);
      const avgCostResult = parseOptionalNumericValue(avgCostCandidate);
      const minStockResult = parseOptionalIntegerValue(minStockCandidate);
      const stockQtyResult = parseOptionalIntegerValue(stockQtyCandidate);

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
      if (minStockResult.invalid) {
        errors.push({
          row: rowNumber,
          message: t("rowInvalidInteger", { row: rowNumber, field: t("fieldMinStock") }),
          code: "invalidNumber",
          value: "minStock",
        });
        return;
      }
      if (stockQtyResult.invalid) {
        errors.push({
          row: rowNumber,
          message: t("rowInvalidInteger", { row: rowNumber, field: t("fieldStockQty") }),
          code: "invalidNumber",
          value: "stockQty",
        });
        return;
      }
      if (parsedVariants.invalid) {
        errors.push({
          row: rowNumber,
          message: t("rowInvalidVariants", { row: rowNumber }),
          code: "invalidVariants",
          value: "variants",
        });
        return;
      }
      if (parsedOptions.invalid) {
        errors.push({
          row: rowNumber,
          message: t("rowInvalidVariants", { row: rowNumber }),
          code: "invalidVariants",
          value: "options",
        });
        return;
      }
      if (minStockResult.value !== undefined && !targetStoreId) {
        errors.push({
          row: rowNumber,
          message: t("rowStoreRequiredForMinStock", { row: rowNumber }),
          code: "missingStoreForMinStock",
          value: "minStock",
        });
        return;
      }
      if (stockQtyResult.value !== undefined && !targetStoreId) {
        errors.push({
          row: rowNumber,
          message: t("rowStoreRequiredForStock", { row: rowNumber }),
          code: "missingStoreForMinStock",
          value: "stockQty",
        });
        return;
      }

      if (shouldApply("barcodes")) {
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
      }

      seenSkus.add(sku);
      if (shouldApply("barcodes")) {
        barcodes.forEach((barcode) => seenBarcodes.add(barcode));
      }

      rows.push({
        sourceRowNumber: rowNumber,
        sku,
        name: shouldApply("name") ? name || undefined : undefined,
        unit: shouldApply("unit") ? unit || undefined : undefined,
        category: categories[0],
        categories: categories.length ? categories : undefined,
        color: color || undefined,
        description:
          shouldApply("description") && mapping.description
            ? normalizeValue(row[mapping.description]) || undefined
            : undefined,
        basePriceKgs: basePriceResult.value,
        purchasePriceKgs: purchasePriceResult.value,
        avgCostKgs: avgCostResult.value,
        minStock: minStockResult.value,
        stockQty: stockQtyResult.value,
        photoUrl: imageUrls[0],
        images: imageUrls.length
          ? imageUrls.map((url, position) => ({ url, position }))
          : undefined,
        variants:
          (shouldApply("variants") || shouldApply("color")) && variants.length
            ? variants
            : undefined,
        barcodes: shouldApply("barcodes") && barcodes.length ? barcodes : undefined,
      });
    });

    return { rows, errors };
  }, [
    defaultUnitCode,
    importMode,
    missingRequired.length,
    mapping,
    rawRows,
    selectedUpdateFieldSet,
    skippedRows,
    stockBehavior,
    t,
    targetStoreId,
  ]);

  const previewInput = useMemo(
    () =>
      missingRequired.length > 0 ||
      !targetStoreId ||
      (isUpdateSelectedMode && selectedUpdateFields.length === 0) ||
      validation.rows.length === 0
        ? null
        : {
            rows: validation.rows,
            source,
            storeId: targetStoreId,
            mode: importMode,
            updateMask: isUpdateSelectedMode ? selectedUpdateFields : undefined,
            existingBehavior,
            emptyValueBehavior,
            stockBehavior,
            rowActions: Object.values(productRowActions),
          },
    [
      emptyValueBehavior,
      existingBehavior,
      importMode,
      isUpdateSelectedMode,
      missingRequired.length,
      productRowActions,
      selectedUpdateFields,
      source,
      stockBehavior,
      targetStoreId,
      validation.rows,
    ],
  );
  useEffect(() => {
    if (!previewInput) {
      dryRunRequestVersionRef.current += 1;
      setDryRunPreview(null);
      setDryRunPreviewError(null);
      setDryRunPreviewPending(false);
      return;
    }

    const requestVersion = dryRunRequestVersionRef.current + 1;
    dryRunRequestVersionRef.current = requestVersion;
    setDryRunPreviewPending(true);
    setDryRunPreviewError(null);
    let cancelled = false;

    const timer = window.setTimeout(() => {
      const chunks = splitRowsForTransport(previewInput.rows, {
        source: previewInput.source,
        storeId: previewInput.storeId,
        mode: previewInput.mode,
        updateMask: previewInput.updateMask,
        existingBehavior: previewInput.existingBehavior,
        emptyValueBehavior: previewInput.emptyValueBehavior,
        stockBehavior: previewInput.stockBehavior,
        rowActions: previewInput.rowActions,
        previewLimit: DRY_RUN_PREVIEW_ROW_LIMIT,
      });

      void (async () => {
        let merged: ImportDryRunPreviewData = {
          rows: [],
          summary: createEmptyDryRunSummary(),
        };

        try {
          for (const chunk of chunks) {
            const result = await previewImportRef.current(chunk);
            if (cancelled || dryRunRequestVersionRef.current !== requestVersion) {
              return;
            }
            merged = mergeDryRunPreview(merged, result);
            setDryRunPreview(merged);
          }
          if (cancelled || dryRunRequestVersionRef.current !== requestVersion) {
            return;
          }
          setDryRunPreviewPending(false);
        } catch (error) {
          if (cancelled || dryRunRequestVersionRef.current !== requestVersion) {
            return;
          }
          setDryRunPreview(null);
          setDryRunPreviewPending(false);
          setDryRunPreviewError(
            translateError(tErrors, error as Parameters<typeof translateError>[1]),
          );
        }
      })();
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [previewInput, tErrors]);

  const applyDetectedProductMapping = (nextHeaders: string[]) => {
    const nextMapping = buildDefaultMapping(nextHeaders);
    setMapping(nextMapping);
    if (nextMapping.stockQty) {
      setStockBehavior("set");
    }
  };

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
      color: "",
      description: "",
      basePriceKgs: "",
      purchasePriceKgs: "",
      avgCostKgs: "",
      minStock: "",
      stockQty: "",
      photoUrl: "",
      barcodes: "",
      variants: "",
      options: "",
    });
    setDefaultUnitCode("");
    setSkippedRows([]);
    setProductRowActions({});

    try {
      if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
        const xlsx = await loadXlsx();
        const buffer = await file.arrayBuffer();
        const workbook = xlsx.read(buffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const parsed = parseSpreadsheetRows(sheet, xlsx);
        setRawRows(parsed.rows);
        setHeaders(parsed.headers);
        applyDetectedProductMapping(parsed.headers);
        setSource(detectSource(parsed.headers));
        return;
      }

      const papa = await loadPapa();
      papa.parse<RawRow>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results: { data: RawRow[] }) => {
          const nextHeaders = Object.keys(results.data[0] ?? {});
          setRawRows(results.data);
          setHeaders(nextHeaders);
          applyDetectedProductMapping(nextHeaders);
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

  const handleDownloadTemplate = async () => {
    try {
      const xlsx = await loadXlsx();
      const workbook = xlsx.utils.book_new();
      const productSheet = xlsx.utils.aoa_to_sheet([
        PRODUCT_TEMPLATE_HEADERS,
        PRODUCT_TEMPLATE_EXAMPLE,
      ]);
      productSheet["!cols"] = PRODUCT_TEMPLATE_HEADERS.map((header) => ({
        wch: Math.max(header.length + 4, 16),
      }));
      const instructionsSheet = xlsx.utils.aoa_to_sheet(PRODUCT_TEMPLATE_INSTRUCTIONS);
      instructionsSheet["!cols"] = [{ wch: 24 }, { wch: 120 }];
      xlsx.utils.book_append_sheet(workbook, productSheet, "Products");
      xlsx.utils.book_append_sheet(workbook, instructionsSheet, "Instructions");
      const data = xlsx.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
      const blob = new Blob([data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `product-import-template-${locale}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ variant: "error", description: t("fileParseError") });
    }
  };

  const handleDownloadCustomerTemplate = () => {
    const blob = new Blob(
      [`${t("customerImport.templateHeaders")}\n${t("customerImport.templateExample")}`],
      {
        type: "text/csv;charset=utf-8",
      },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `customers-template-${locale}.csv`;
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

  const handleToggleUpdateField = (field: ImportUpdateField) => {
    setSelectedUpdateFields((prev) =>
      prev.includes(field) ? prev.filter((value) => value !== field) : [...prev, field],
    );
  };

  const applyUpdatePreset = (preset: "prices" | "minStock" | "all" | "none") => {
    if (preset === "prices") {
      setSelectedUpdateFields(["basePriceKgs", "purchasePriceKgs", "avgCostKgs"]);
      return;
    }
    if (preset === "minStock") {
      setSelectedUpdateFields(["minStock"]);
      return;
    }
    if (preset === "all") {
      setSelectedUpdateFields(
        updateSelectableFields.map((field) => field.key as ImportUpdateField),
      );
      return;
    }
    setSelectedUpdateFields([]);
  };

  const handleProductRowActionChange = (
    sourceRowNumber: number,
    action: ProductImportRowAction,
    existingProductId?: string,
  ) => {
    setProductRowActions((current) => ({
      ...current,
      [sourceRowNumber]: {
        sourceRowNumber,
        action,
        existingProductId,
      },
    }));
  };

  const handleApplyImport = async () => {
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
    if (missingRequired.length > 0 || (isUpdateSelectedMode && selectedUpdateFields.length === 0)) {
      toast({ variant: "error", description: tErrors("invalidInput") });
      return;
    }
    if (!targetStoreId) {
      toast({ variant: "error", description: tErrors("storeRequired") });
      return;
    }
    if (dryRunPreviewPending || dryRunPreviewError) {
      toast({ variant: "error", description: dryRunPreviewError ?? t("dryRunLoading") });
      return;
    }
    if ((dryRunPreview?.summary.blockingWarningCount ?? 0) > 0) {
      toast({ variant: "error", description: t("dryRunBlockingWarnings") });
      return;
    }

    const chunks = splitRowsForTransport(validation.rows, {
      source,
      storeId: targetStoreId,
      mode: importMode,
      updateMask: isUpdateSelectedMode ? selectedUpdateFields : undefined,
      existingBehavior,
      emptyValueBehavior,
      stockBehavior,
      rowActions: Object.values(productRowActions),
    });
    const aggregateSummary: ImportRunSummary = {
      source,
      mode: importMode,
      updateMask: isUpdateSelectedMode ? selectedUpdateFields : null,
      existingBehavior,
      emptyValueBehavior,
      stockBehavior,
      targetStoreId,
      rows: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      images: {
        downloaded: 0,
        fallback: 0,
        missing: 0,
      },
    };
    let importedRows = 0;

    setImportStartedAt(Date.now());
    setImportElapsedSeconds(0);

    try {
      for (const chunk of chunks) {
        const payload = await importCsvRef.current(chunk);
        const summary = payload.summary as ImportRunSummary;
        importedRows += payload.results.length;
        aggregateSummary.rows =
          (aggregateSummary.rows ?? 0) + (summary.rows ?? payload.results.length);
        aggregateSummary.created = (aggregateSummary.created ?? 0) + (summary.created ?? 0);
        aggregateSummary.updated = (aggregateSummary.updated ?? 0) + (summary.updated ?? 0);
        aggregateSummary.skipped = (aggregateSummary.skipped ?? 0) + (summary.skipped ?? 0);
        aggregateSummary.targetStoreName =
          aggregateSummary.targetStoreName ?? summary.targetStoreName;
        aggregateSummary.images = {
          downloaded:
            (aggregateSummary.images?.downloaded ?? 0) + (summary.images?.downloaded ?? 0),
          fallback: (aggregateSummary.images?.fallback ?? 0) + (summary.images?.fallback ?? 0),
          missing: (aggregateSummary.images?.missing ?? 0) + (summary.images?.missing ?? 0),
        };
      }

      setLastImportSummary(aggregateSummary);
      toast({
        variant: "success",
        description: t("importSuccess", { count: aggregateSummary.rows ?? importedRows }),
      });
      await batchesQuery.refetch();
      resetImportFormState({
        setRawRows,
        setHeaders,
        setMapping,
        setFileName,
        setDefaultUnitCode,
        setSkippedRows,
      });
      setProductRowActions({});
    } catch (error) {
      toast({
        variant: "error",
        description: translateError(tErrors, error as Parameters<typeof translateError>[1]),
      });
    } finally {
      setImportStartedAt(null);
    }
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
    if (!importStartedAt) {
      setImportElapsedSeconds(0);
      return;
    }
    const interval = window.setInterval(() => {
      setImportElapsedSeconds(Math.floor((Date.now() - importStartedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [importStartedAt]);

  const importProgressStage = useMemo(() => {
    if (importElapsedSeconds < 5) {
      return t("progressStage.validating");
    }
    if (importElapsedSeconds < 15) {
      return t("progressStage.resolvingImages");
    }
    return t("progressStage.writingDatabase");
  }, [importElapsedSeconds, t]);
  const isImporting = importStartedAt !== null || importMutation.isLoading;

  const importTypeCard = (
    <Card className="bazaar-admin-surface mb-6">
      <CardHeader>
        <CardTitle>{t("importType.title")}</CardTitle>
      </CardHeader>
      <CardContent className="max-w-sm space-y-2">
        <Select
          value={importType}
          onValueChange={(value) => setImportType(value as ImportType)}
          disabled={!isAdmin}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {isAdmin ? <SelectItem value="products">{t("importType.products")}</SelectItem> : null}
            <SelectItem value="customers">{t("importType.customers")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {isAdmin ? t("importType.hint") : t("importType.managerHint")}
        </p>
      </CardContent>
    </Card>
  );

  const targetStoreCard = (
    <Card className="bazaar-admin-surface mb-6">
      <CardHeader>
        <CardTitle>{t("targetStoreTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="max-w-sm space-y-2">
          <Select
            value={targetStoreId}
            onValueChange={setTargetStoreId}
            disabled={storesQuery.isLoading || !stores.length}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("targetStorePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {stores.map((store) => (
                <SelectItem key={store.id} value={store.id}>
                  {store.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {storesQuery.isLoading
              ? tCommon("loading")
              : selectedTargetStore
                ? t("targetStoreHint")
                : tErrors("storeRequired")}
          </p>
        </div>
      </CardContent>
    </Card>
  );

  if (isForbidden) {
    return (
      <div>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <p className="mt-4 text-sm text-danger">{tErrors("forbidden")}</p>
      </div>
    );
  }

  if (importType === "customers") {
    return (
      <div>
        <PageHeader
          title={t("title")}
          subtitle={t("subtitle")}
          action={
            <Button
              variant="secondary"
              className="w-full sm:w-auto"
              onClick={handleDownloadCustomerTemplate}
            >
              <DownloadIcon className="h-4 w-4" aria-hidden />
              {t("templateDownload")}
            </Button>
          }
        />
        {importTypeCard}
        {targetStoreCard}
        <CustomerImportPanel
          targetStoreId={targetStoreId}
          selectedStoreName={selectedTargetStore?.name}
        />
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
            onClick={() => void handleDownloadTemplate()}
          >
            <DownloadIcon className="h-4 w-4" aria-hidden />
            {t("templateDownload")}
          </Button>
        }
      />

      {importTypeCard}
      {targetStoreCard}

      <Card className="bazaar-admin-surface mb-6">
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
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="muted">{fileName}</Badge>
              <span>{t("sourceDetected", { source: t(`source.${source}`) })}</span>
            </div>
          ) : (
            <div className="bazaar-admin-notice flex items-center gap-2">
              <EmptyIcon className="h-4 w-4" aria-hidden />
              {t("uploadHint")}
            </div>
          )}
          {fileError ? <p className="text-sm text-danger">{fileError}</p> : null}
        </CardContent>
      </Card>

      <Card className="bazaar-admin-surface mb-6">
        <CardHeader>
          <CardTitle>{t("mappingTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {headers.length ? (
            <div className="space-y-4">
              <div className="bazaar-admin-modal-card space-y-3">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">{t("importModeTitle")}</p>
                  <Select
                    value={importMode}
                    onValueChange={(value) => setImportMode(value as ImportMode)}
                  >
                    <SelectTrigger className="max-w-sm">
                      <SelectValue placeholder={t("importModePlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full">{t("mode.full")}</SelectItem>
                      <SelectItem value="update_selected">{t("mode.update_selected")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{t("importModeHint")}</p>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">
                      {t("existingBehaviorTitle")}
                    </p>
                    <Select
                      value={existingBehavior}
                      onValueChange={(value) =>
                        setExistingBehavior(value as ProductExistingBehavior)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="update">{t("existingBehavior.update")}</SelectItem>
                        <SelectItem value="skip">{t("existingBehavior.skip")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">
                      {t("emptyValueBehaviorTitle")}
                    </p>
                    <Select
                      value={emptyValueBehavior}
                      onValueChange={(value) =>
                        setEmptyValueBehavior(value as ProductEmptyValueBehavior)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="keep">{t("emptyValueBehavior.keep")}</SelectItem>
                        <SelectItem value="overwrite">
                          {t("emptyValueBehavior.overwrite")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">{t("stockBehaviorTitle")}</p>
                    <Select
                      value={stockBehavior}
                      onValueChange={(value) => setStockBehavior(value as ProductStockBehavior)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ignore">{t("stockBehavior.ignore")}</SelectItem>
                        <SelectItem value="set">{t("stockBehavior.set")}</SelectItem>
                        <SelectItem value="add">{t("stockBehavior.add")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {isUpdateSelectedMode ? (
                  <div className="bazaar-admin-notice space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-medium text-foreground">
                        {t("updateFieldsTitle")}
                      </p>
                      {selectedUpdateFields.length ? (
                        <Badge variant="muted" className="text-[10px]">
                          {selectedUpdateFields.length}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">{t("updateFieldsHint")}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => applyUpdatePreset("prices")}
                      >
                        {t("updatePresetPrices")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => applyUpdatePreset("minStock")}
                      >
                        {t("updatePresetMinStock")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => applyUpdatePreset("all")}
                      >
                        {t("updatePresetAll")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => applyUpdatePreset("none")}
                      >
                        {t("updatePresetNone")}
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {updateSelectableFields.map((field) => {
                        const selected = selectedUpdateFields.includes(
                          field.key as ImportUpdateField,
                        );
                        return (
                          <Button
                            key={`mask-${field.key}`}
                            type="button"
                            size="sm"
                            variant={selected ? "default" : "secondary"}
                            onClick={() => handleToggleUpdateField(field.key as ImportUpdateField)}
                          >
                            {field.label}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>

              <FormGrid className="items-start">
                {mappingFields.map((field) => (
                  <div key={field.key} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{field.label}</p>
                      {requiredFields.has(field.key) ? (
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
                  <p className="text-sm font-medium text-foreground">{t("defaultUnitTitle")}</p>
                  <Badge variant="muted" className="text-[10px]">
                    {t("optional")}
                  </Badge>
                </div>
                <Select
                  value={defaultUnitCode || "none"}
                  onValueChange={(value) => setDefaultUnitCode(value === "none" ? "" : value)}
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
                <p className="text-xs text-muted-foreground">{t("defaultUnitHint")}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("mappingEmpty")}</p>
          )}
          {missingRequired.length ? (
            <p className="text-sm text-danger">{t("mappingRequired")}</p>
          ) : null}
          {isUpdateSelectedMode && selectedUpdateFields.length === 0 ? (
            <p className="text-sm text-danger">{t("updateMaskRequired")}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="bazaar-admin-surface mb-6">
        <CardHeader>
          <CardTitle>{t("previewTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {validation.rows.length ? (
            <ImportPreviewTable rows={validation.rows} />
          ) : (
            <p className="text-sm text-muted-foreground">{t("previewEmpty")}</p>
          )}
          <div className="bazaar-admin-modal-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-foreground">{t("dryRunTitle")}</p>
                <p className="text-xs text-muted-foreground">{t("dryRunSubtitle")}</p>
              </div>
              {dryRunPreviewPending ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner className="h-4 w-4" />
                  {t("dryRunLoading")}
                </div>
              ) : null}
            </div>
            <div className="mt-4">
              {dryRunPreview ? (
                <ImportDryRunPreview
                  preview={dryRunPreview}
                  rowActions={productRowActions}
                  onRowActionChange={handleProductRowActionChange}
                />
              ) : dryRunPreviewError ? (
                <p className="text-sm text-danger">{dryRunPreviewError}</p>
              ) : (
                <p className="text-sm text-muted-foreground">{t("dryRunEmpty")}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bazaar-admin-surface">
        <CardHeader>
          <CardTitle>{t("validationTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
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
                  variant="secondary"
                  size="sm"
                  onClick={() => setSkippedRows([])}
                >
                  {t("clearSkippedRows", { count: skippedRows.length })}
                </Button>
              ) : null}
              {validation.errors.length ? (
                <Button type="button" variant="secondary" size="sm" onClick={handleDownloadErrors}>
                  <DownloadIcon className="h-4 w-4" aria-hidden />
                  {t("downloadErrors")}
                </Button>
              ) : null}
            </div>
          </div>
          {validation.errors.length ? (
            <div className="space-y-2">
              {validation.errors.slice(0, 5).map((error) => (
                <p key={`${error.row}-${error.message}`} className="text-xs text-danger">
                  {error.message}
                </p>
              ))}
            </div>
          ) : null}
          {shortNameErrors.length ? (
            <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/10 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-foreground">
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
                    className="bazaar-admin-modal-card flex flex-wrap items-center justify-between gap-2 p-2"
                  >
                    <p className="text-xs text-foreground">{error.message}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => handleUseSkuAsName(error.row)}
                      >
                        {t("shortNameUseSku")}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
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
            <div className="space-y-2 rounded-xl border border-secondary/70 bg-secondary/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-foreground">
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
              <p className="text-xs text-muted-foreground">
                {defaultUnitCode
                  ? t("missingUnitHintSelected", { unit: defaultUnitCode })
                  : t("missingUnitHintSelectDefault")}
              </p>
              <div className="space-y-2">
                {missingUnitErrors.slice(0, 8).map((error) => (
                  <div
                    key={`resolve-unit-${error.row}`}
                    className="bazaar-admin-modal-card flex flex-wrap items-center justify-between gap-2 p-2"
                  >
                    <p className="text-xs text-foreground">{error.message}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => handleApplyDefaultUnitToRow(error.row)}
                        disabled={!defaultUnitCode}
                      >
                        {t("missingUnitApplyToRow")}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
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
            <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-foreground">
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
                    className="bazaar-admin-modal-card flex flex-wrap items-center justify-between gap-2 p-2"
                  >
                    <p className="text-xs text-foreground">{error.message}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => handleClearDuplicateBarcode(error.row, error.value ?? "")}
                      >
                        {t("duplicateRemove")}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
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
              onClick={() => void handleApplyImport()}
              disabled={
                isImporting ||
                dryRunPreviewPending ||
                missingRequired.length > 0 ||
                (isUpdateSelectedMode && selectedUpdateFields.length === 0) ||
                !targetStoreId ||
                validation.errors.length > 0 ||
                validation.rows.length === 0 ||
                Boolean(dryRunPreviewError) ||
                (dryRunPreview?.summary.blockingWarningCount ?? 0) > 0
              }
            >
              {isImporting ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <UploadIcon className="h-4 w-4" aria-hidden />
              )}
              {isImporting ? tCommon("loading") : t("applyImport")}
            </Button>
          </div>
          {isImporting ? (
            <div className="bazaar-admin-notice text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                {t("importInProgress", {
                  count: validation.rows.length,
                  elapsed: importElapsedSeconds,
                })}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("importInProgressStage", { stage: importProgressStage })}
              </p>
            </div>
          ) : null}
          {importMutation.error ? (
            <p className="text-sm text-danger">{translateError(tErrors, importMutation.error)}</p>
          ) : null}
          {lastImportSummary ? (
            <div className="rounded-xl border border-success/40 bg-success/10 p-3 text-sm text-foreground">
              <p className="font-medium">{t("importResultTitle")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("importSuccess", { count: lastImportSummary.rows ?? 0 })}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t(`mode.${lastImportSummary.mode ?? "full"}`)}
              </p>
              {lastImportSummary.targetStoreName ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("targetStoreApplied", { store: lastImportSummary.targetStoreName })}
                </p>
              ) : null}
              <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                <div className="rounded-lg border border-success/40 bg-card p-2">
                  <p className="text-muted-foreground">{t("historyColumns.created")}</p>
                  <p className="font-semibold text-foreground">{lastImportSummary.created ?? 0}</p>
                </div>
                <div className="rounded-lg border border-success/40 bg-card p-2">
                  <p className="text-muted-foreground">{t("historyColumns.updated")}</p>
                  <p className="font-semibold text-foreground">{lastImportSummary.updated ?? 0}</p>
                </div>
                <div className="rounded-lg border border-success/40 bg-card p-2">
                  <p className="text-muted-foreground">{t("historyColumns.skipped")}</p>
                  <p className="font-semibold text-foreground">{lastImportSummary.skipped ?? 0}</p>
                </div>
                <div className="rounded-lg border border-success/40 bg-card p-2">
                  <p className="text-muted-foreground">{t("imageDownloaded")}</p>
                  <p className="font-semibold text-foreground">
                    {lastImportSummary.images?.downloaded ?? 0}
                  </p>
                </div>
                <div className="rounded-lg border border-success/40 bg-card p-2">
                  <p className="text-muted-foreground">{t("imageFallback")}</p>
                  <p className="font-semibold text-foreground">
                    {lastImportSummary.images?.fallback ?? 0}
                  </p>
                </div>
                <div className="rounded-lg border border-success/40 bg-card p-2">
                  <p className="text-muted-foreground">{t("imageMissing")}</p>
                  <p className="font-semibold text-foreground">
                    {lastImportSummary.images?.missing ?? 0}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="bazaar-admin-surface mt-6">
        <CardHeader>
          <CardTitle>{t("historyTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {batchesQuery.isLoading ? (
            <div className="bazaar-admin-notice flex items-center gap-2">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : !batches.length ? (
            <p className="text-sm text-muted-foreground">{t("historyEmpty")}</p>
          ) : (
            <ResponsiveDataList
              items={batches}
              getKey={(batch) => batch.id}
              renderDesktop={(visibleItems) => (
                <div className="bazaar-admin-table-shell bazaar-admin-table-scroll">
                  <Table className="min-w-[640px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("historyColumns.date")}</TableHead>
                        <TableHead>{t("historyColumns.source")}</TableHead>
                        <TableHead>{t("historyColumns.rows")}</TableHead>
                        <TableHead>{t("historyColumns.created")}</TableHead>
                        <TableHead>{t("historyColumns.updated")}</TableHead>
                        <TableHead>{t("historyColumns.skipped")}</TableHead>
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
                          skipped?: number;
                          source?: string;
                          mode?: ImportMode;
                          targetStoreName?: string;
                        };
                        const sourceLabel = summary.source
                          ? t(`source.${summary.source}`)
                          : t("source.csv");
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
                            <TableCell className="text-xs text-muted-foreground">
                              {formatDateTime(batch.createdAt, locale)}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              <div className="space-y-1">
                                <p>{sourceLabel}</p>
                                <p className="text-[11px] text-muted-foreground/80">
                                  {t(`mode.${summary.mode ?? "full"}`)}
                                </p>
                                {summary.targetStoreName ? (
                                  <p className="text-[11px] text-muted-foreground/80">
                                    {t("historyStoreValue", { store: summary.targetStoreName })}
                                  </p>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {summary.rows ?? 0}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {summary.created ?? 0}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {summary.updated ?? 0}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {summary.skipped ?? 0}
                            </TableCell>
                            <TableCell>
                              {batch.rolledBackAt ? (
                                <Badge variant="muted">{t("historyRolledBack")}</Badge>
                              ) : (
                                <Badge variant="success">{t("historyCompleted")}</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {batch.rolledBackAt ? (
                                <span className="text-xs text-muted-foreground/80">
                                  {t("historyDone")}
                                </span>
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
                  skipped?: number;
                  source?: string;
                  mode?: ImportMode;
                  targetStoreName?: string;
                };
                const sourceLabel = summary.source
                  ? t(`source.${summary.source}`)
                  : t("source.csv");
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
                  <div className="bazaar-admin-mobile-card">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {formatDateTime(batch.createdAt, locale)}
                        </p>
                        <p className="text-xs text-muted-foreground">{sourceLabel}</p>
                        <p className="text-xs text-muted-foreground/80">
                          {t(`mode.${summary.mode ?? "full"}`)}
                        </p>
                        {summary.targetStoreName ? (
                          <p className="text-xs text-muted-foreground/80">
                            {t("historyStoreValue", { store: summary.targetStoreName })}
                          </p>
                        ) : null}
                      </div>
                      {batch.rolledBackAt ? (
                        <Badge variant="muted">{t("historyRolledBack")}</Badge>
                      ) : (
                        <Badge variant="success">{t("historyCompleted")}</Badge>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                          {t("historyColumns.rows")}
                        </p>
                        <p className="text-foreground/90">{summary.rows ?? 0}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                          {t("historyColumns.created")}
                        </p>
                        <p className="text-foreground/90">{summary.created ?? 0}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                          {t("historyColumns.updated")}
                        </p>
                        <p className="text-foreground/90">{summary.updated ?? 0}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                          {t("historyColumns.skipped")}
                        </p>
                        <p className="text-foreground/90">{summary.skipped ?? 0}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                          {t("historyColumns.status")}
                        </p>
                        <p className="text-foreground/90">
                          {batch.rolledBackAt ? t("historyRolledBack") : t("historyCompleted")}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-end">
                      {batch.rolledBackAt ? (
                        <span className="text-xs text-muted-foreground/80">{t("historyDone")}</span>
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
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" />
            {tCommon("loading")}
          </div>
        ) : rollbackDetailsQuery.data ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("rollbackHint")}</p>
            {rollbackDetailsQuery.data.counts.length ? (
              <div className="space-y-2 text-sm text-muted-foreground">
                {rollbackDetailsQuery.data.counts.map((item) => (
                  <div key={item.entityType} className="flex items-center justify-between">
                    <span>{resolveEntityLabel(item.entityType)}</span>
                    <span className="font-semibold text-foreground">{item.count}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("rollbackNothing")}</p>
            )}
            <ModalFooter>
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
            </ModalFooter>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("rollbackMissing")}</p>
        )}
      </Modal>
    </div>
  );
};

export default ImportPage;

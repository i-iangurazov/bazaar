import { createReadStream, promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import {
  CashDrawerMovementType,
  CustomerOrderStatus,
  ExportJobStatus,
  ExportType,
  MarkingCodeStatus,
  PosPaymentMethod,
  PosReturnStatus,
  Prisma,
  RegisterShiftStatus,
  StockMovementType,
  type ExportJob,
} from "@prisma/client";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import * as XLSX from "xlsx";

import { prisma } from "@/server/db/prisma";
import { isProductionRuntime } from "@/server/config/runtime";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { sanitizeSpreadsheetValue, toCsv } from "@/server/services/csv";
import { toJson } from "@/server/services/json";
import { registerJob, runJob, type JobPayload } from "@/server/jobs";
import { assertUserCanAccessStore, type StoreAccessUser } from "@/server/services/storeAccess";

type ExportRequestInput = {
  organizationId: string;
  storeId: string;
  type: ExportType;
  format?: ExportFormat;
  periodStart: Date;
  periodEnd: Date;
  requestedById: string;
  requestId: string;
};

type ComplianceFlags = {
  enableMarking: boolean;
  enableEttn: boolean;
};

type StoreSummary = {
  id: string;
  name: string;
  code: string;
  currencyCode: string;
  currencyRateKgsPerUnit: Prisma.Decimal;
};

export type ExportFormat = "csv" | "xlsx";

const EXPORT_SCHEMA_VERSION = "v1";
const DEFAULT_EXPORT_FORMAT: ExportFormat = "csv";
const DEFAULT_EXPORT_LIST_LIMIT = 50;
const MAX_EXPORT_LIST_LIMIT = 200;
const MAX_ACTIVE_EXPORT_JOBS_PER_ORG = 20;
const R2_STORAGE_PREFIX = "r2://";
const EXPORT_R2_KEY_PREFIX = "exports";

const formatDay = (date: Date) => date.toISOString().slice(0, 10);
const roundMoney = (value: number) => Math.round(value * 100) / 100;

const ensureExportDir = async () => {
  const directory = join(tmpdir(), "exports");
  await fs.mkdir(directory, { recursive: true });
  return directory;
};

const normalizeExportFormat = (value: unknown): ExportFormat =>
  value === "xlsx" ? "xlsx" : DEFAULT_EXPORT_FORMAT;

const readJobFormat = (paramsJson: Prisma.JsonValue | null | undefined): ExportFormat => {
  if (!paramsJson || typeof paramsJson !== "object" || Array.isArray(paramsJson)) {
    return DEFAULT_EXPORT_FORMAT;
  }
  return normalizeExportFormat((paramsJson as Record<string, unknown>).format);
};

const exportFileSlugs: Record<ExportType, string> = {
  INVENTORY_MOVEMENTS_LEDGER: "inventory-movements-ledger",
  INVENTORY_BALANCES_AT_DATE: "inventory-balances",
  PURCHASES_RECEIPTS: "purchase-receipts",
  PRICE_LIST: "price-list",
  SALES_SUMMARY: "sales-summary",
  STOCK_MOVEMENTS: "stock-movements",
  PURCHASES: "purchases",
  INVENTORY_ON_HAND: "inventory-on-hand",
  PERIOD_CLOSE_REPORT: "period-close",
  RECEIPTS_FOR_KKM: "receipts-for-kkm",
  RECEIPTS_REGISTRY: "receipts-registry",
  SHIFT_X_REPORT: "shift-x-report",
  SHIFT_Z_REPORT: "shift-z-report",
  SALES_BY_DAY: "sales-by-day",
  SALES_BY_ITEM: "sales-by-item",
  RETURNS_BY_DAY: "returns-by-day",
  RETURNS_BY_ITEM: "returns-by-item",
  CASH_DRAWER_MOVEMENTS: "cash-drawer-movements",
  MARKING_SALES_REGISTRY: "marking-sales-registry",
  ETTN_REFERENCES: "ettn-references",
  ESF_REFERENCES: "esf-references",
};

const buildFileName = (
  type: ExportType,
  jobId: string,
  format: ExportFormat,
  periodStart: Date,
  periodEnd: Date,
) => {
  const slug = exportFileSlugs[type] ?? type.toLowerCase().replace(/_/g, "-");
  return `${slug}-${formatDay(periodStart)}_to_${formatDay(periodEnd)}-${jobId.slice(0, 8)}.${format}`;
};

type ExportDownloadUnavailableReason = "exportFileMissing";

type ExportR2Config = {
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  endpoint: string;
};

type ExportArtifactStats = {
  size: number;
};

type ExportArtifactStream = {
  stream: Readable;
  fileSize: number;
};

const normalizePathSegment = (value: string) =>
  value.replace(/[^a-zA-Z0-9_-]/g, "").trim() || "default";

const resolveExportR2Config = (): ExportR2Config | null => {
  const accountId = process.env.R2_ACCOUNT_ID?.trim() ?? "";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim() ?? "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim() ?? "";
  const bucketName = process.env.R2_BUCKET_NAME?.trim() ?? "";
  const endpoint =
    process.env.R2_ENDPOINT?.trim() ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");

  if (!accessKeyId || !secretAccessKey || !bucketName || !endpoint) {
    return null;
  }

  return {
    accessKeyId,
    secretAccessKey,
    bucketName,
    endpoint,
  };
};

const shouldUseR2ExportStorage = () => {
  const explicitProvider = process.env.EXPORT_STORAGE_PROVIDER?.trim().toLowerCase();
  if (explicitProvider) {
    return explicitProvider === "r2";
  }
  return (
    isProductionRuntime() && process.env.IMAGE_STORAGE_PROVIDER?.trim().toLowerCase() === "r2"
  );
};

let exportR2Client: S3Client | null = null;

const getExportR2Client = (config: ExportR2Config) => {
  if (exportR2Client) {
    return exportR2Client;
  }

  exportR2Client = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return exportR2Client;
};

const buildExportR2Key = (organizationId: string, jobId: string, fileName: string) =>
  [
    EXPORT_R2_KEY_PREFIX,
    normalizePathSegment(organizationId),
    normalizePathSegment(jobId),
    fileName.replace(/[^a-zA-Z0-9_.-]/g, "_"),
  ].join("/");

const formatR2StoragePath = (bucketName: string, key: string) =>
  `${R2_STORAGE_PREFIX}${bucketName}/${key}`;

const parseR2StoragePath = (storagePath: string) => {
  if (!storagePath.startsWith(R2_STORAGE_PREFIX)) {
    return null;
  }
  const withoutPrefix = storagePath.slice(R2_STORAGE_PREFIX.length);
  const slashIndex = withoutPrefix.indexOf("/");
  if (slashIndex <= 0) {
    return null;
  }

  const bucketName = withoutPrefix.slice(0, slashIndex);
  const key = withoutPrefix.slice(slashIndex + 1);
  const config = resolveExportR2Config();
  if (!key || !config || config.bucketName !== bucketName) {
    return null;
  }

  return { config, key };
};

const toReadable = (body: unknown): Readable => {
  if (body instanceof Readable) {
    return body;
  }
  if (body && typeof (body as { transformToWebStream?: unknown }).transformToWebStream === "function") {
    return Readable.fromWeb(
      (
        body as { transformToWebStream: () => NodeReadableStream<Uint8Array> }
      ).transformToWebStream(),
    );
  }
  if (body && typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === "function") {
    return Readable.from(body as AsyncIterable<Uint8Array>);
  }
  throw new AppError("exportFileMissing", "CONFLICT", 410);
};

const writeExportArtifact = async (input: {
  organizationId: string;
  jobId: string;
  fileName: string;
  content: Buffer;
  mimeType: string;
}) => {
  if (shouldUseR2ExportStorage()) {
    const config = resolveExportR2Config();
    if (!config) {
      throw new AppError("exportStorageNotConfigured", "INTERNAL_SERVER_ERROR", 500);
    }
    const key = buildExportR2Key(input.organizationId, input.jobId, input.fileName);
    await getExportR2Client(config).send(
      new PutObjectCommand({
        Bucket: config.bucketName,
        Key: key,
        Body: input.content,
        ContentType: input.mimeType,
        CacheControl: "private, no-store",
      }),
    );
    return formatR2StoragePath(config.bucketName, key);
  }

  const directory = await ensureExportDir();
  const storagePath = join(directory, input.fileName);
  await fs.writeFile(storagePath, input.content);
  return storagePath;
};

const openExportArtifactStream = async (
  storagePath: string,
): Promise<ExportArtifactStream | null> => {
  if (storagePath.startsWith(R2_STORAGE_PREFIX)) {
    const location = parseR2StoragePath(storagePath);
    if (!location) {
      return null;
    }
    try {
      const response = await getExportR2Client(location.config).send(
        new GetObjectCommand({
          Bucket: location.config.bucketName,
          Key: location.key,
        }),
      );
      const fileSize =
        typeof response.ContentLength === "number"
          ? response.ContentLength
          : (await readExportFileStats(storagePath))?.size;
      if (!response.Body || typeof fileSize !== "number") {
        return null;
      }
      return {
        stream: toReadable(response.Body),
        fileSize,
      };
    } catch {
      return null;
    }
  }

  const stats = await readExportFileStats(storagePath);
  if (!stats) {
    return null;
  }
  return {
    stream: createReadStream(storagePath),
    fileSize: stats.size,
  };
};

export type ExportJobWithDownloadState = ExportJob & {
  downloadAvailable: boolean;
  downloadUrl: string | null;
  downloadUnavailableReason: ExportDownloadUnavailableReason | null;
};

const readExportFileStats = async (
  storagePath?: string | null,
): Promise<ExportArtifactStats | null> => {
  if (!storagePath) {
    return null;
  }
  if (storagePath.startsWith(R2_STORAGE_PREFIX)) {
    const location = parseR2StoragePath(storagePath);
    if (!location) {
      return null;
    }
    try {
      const response = await getExportR2Client(location.config).send(
        new HeadObjectCommand({
          Bucket: location.config.bucketName,
          Key: location.key,
        }),
      );
      return typeof response.ContentLength === "number" ? { size: response.ContentLength } : null;
    } catch {
      return null;
    }
  }
  try {
    const stats = await fs.stat(storagePath);
    return stats.isFile() ? { size: stats.size } : null;
  } catch {
    return null;
  }
};

const withDownloadState = async (job: ExportJob): Promise<ExportJobWithDownloadState> => {
  if (job.status !== ExportJobStatus.DONE) {
    return {
      ...job,
      downloadAvailable: false,
      downloadUrl: null,
      downloadUnavailableReason: null,
    };
  }

  const stats = await readExportFileStats(job.storagePath);
  return {
    ...job,
    fileSize: stats?.size ?? job.fileSize,
    downloadAvailable: Boolean(stats),
    downloadUrl: stats ? `/api/exports/${job.id}` : null,
    downloadUnavailableReason: stats ? null : "exportFileMissing",
  };
};

const exportColumnLabels: Record<string, string> = {
  actor: "Автор",
  amountKgs: "Сумма KGS",
  avgCostKgs: "Средняя себестоимость KGS",
  barcode: "Штрихкод",
  basePriceKgs: "Базовая цена KGS",
  cardKgs: "Карта KGS",
  cardRefundsKgs: "Возвраты на карту KGS",
  cardSalesKgs: "Продажи картой KGS",
  cashKgs: "Наличные KGS",
  cashPayInKgs: "Внесения KGS",
  cashPayOutKgs: "Изъятия KGS",
  cashRefundsKgs: "Возвраты наличными KGS",
  cashSalesKgs: "Продажи наличными KGS",
  cashierEmail: "Кассир",
  capturedAt: "Зафиксировано",
  capturedBy: "Зафиксировал",
  closedAt: "Закрыто",
  closedBy: "Закрыл",
  completedAt: "Завершено",
  countedCashKgs: "Пересчитанная наличность KGS",
  counterpartyName: "Контрагент",
  createdAt: "Создано",
  createdBy: "Создал",
  currencyCode: "Валюта",
  currencyRateKgsPerUnit: "Курс к KGS",
  date: "Дата",
  day: "Дата",
  discrepancyKgs: "Расхождение KGS",
  docNumber: "Номер документа",
  docType: "Тип документа",
  documentId: "ID документа",
  documentType: "Тип документа",
  effectivePriceKgs: "Цена продажи KGS",
  expectedCashKgs: "Расчетная наличность KGS",
  esfDate: "Дата ЭСФ",
  esfNumber: "Номер ЭСФ",
  ettnDate: "Дата ЭТТН",
  ettnNumber: "Номер ЭТТН",
  ettnRequired: "ЭТТН нужна",
  fiscalError: "Ошибка фискализации",
  fiscalMode: "Фискальный режим",
  fiscalNumber: "Фискальный номер",
  fiscalStatus: "Фискальный статус",
  inventoryValueKgs: "Стоимость остатков KGS",
  kkmStatus: "Статус ККМ",
  lineTotalKgs: "Сумма строки KGS",
  marginPct: "Маржа %",
  markingCode: "Код маркировки",
  markingRequired: "Маркировка нужна",
  markingType: "Тип маркировки",
  minStock: "Мин. остаток",
  movementCount: "Операций",
  movementId: "ID движения",
  movementType: "Тип движения",
  markupPct: "Наценка %",
  nonCashNetKgs: "Безналичный итог KGS",
  nonCashRefundsKgs: "Безналичные возвраты KGS",
  nonCashSalesKgs: "Безналичные продажи KGS",
  notes: "Примечание",
  occurredAt: "Дата движения",
  onHand: "В наличии",
  onOrder: "В заказе",
  openedAt: "Открыта",
  openedBy: "Открыл",
  openingCashKgs: "Наличные на открытии KGS",
  orderStatus: "Статус заказа",
  ordersCount: "Чеков",
  orgId: "ID организации",
  otherKgs: "Другое KGS",
  otherRefundsKgs: "Прочие возвраты KGS",
  otherSalesKgs: "Прочие продажи KGS",
  overWithdrawalKgs: "Сверхизъятие KGS",
  paidAmountKgs: "Оплачено KGS",
  periodEnd: "Конец периода",
  periodStart: "Начало периода",
  poId: "ID закупки",
  poNumber: "Номер закупки",
  product: "Товар",
  productName: "Товар",
  providerReceiptId: "ID чека провайдера",
  purchasesTotalKgs: "Закупки KGS",
  qty: "Кол-во",
  qtyDelta: "Изменение кол-ва",
  qtyOrdered: "Заказано",
  qtyReceived: "Принято",
  reason: "Причина",
  receiptCreatedAt: "Чек создан",
  receiptId: "ID чека",
  receiptNumber: "Номер чека",
  receivedAt: "Дата приемки",
  reference: "Основание",
  registerCode: "Код кассы",
  registerName: "Касса",
  reorderPoint: "Точка заказа",
  reportType: "Тип отчета",
  requestId: "ID запроса",
  returnsCount: "Кол-во возвратов",
  returnsTotalKgs: "Возвраты KGS",
  revenueKgs: "Выручка KGS",
  salesCount: "Кол-во продаж",
  salesTotalKgs: "Продажи KGS",
  shiftId: "ID смены",
  sku: "Артикул",
  skuCount: "Товаров",
  status: "Статус",
  store: "Магазин",
  storeCode: "Код магазина",
  storeName: "Магазин",
  storeOverridePriceKgs: "Цена магазина KGS",
  supplier: "Поставщик",
  supplierInn: "ИНН поставщика",
  supplierName: "Поставщик",
  totalCostKgs: "Сумма себестоимости KGS",
  totalKgs: "Итого KGS",
  totalQty: "Продано шт.",
  transferKgs: "Перевод KGS",
  transferRefundsKgs: "Возвраты переводом KGS",
  transferSalesKgs: "Продажи переводом KGS",
  type: "Тип",
  unit: "Ед.",
  unitCostKgs: "Цена за ед. KGS",
  userEmail: "Пользователь",
  variant: "Вариант",
  variantName: "Вариант",
  variantSku: "Артикул варианта",
};

const humanizeExportColumn = (column: string) =>
  column
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());

const toExportDisplayHeader = (header: string[]) =>
  header.map((column) => exportColumnLabels[column] ?? humanizeExportColumn(column));

const calculateColumnWidths = (header: string[], bodyRows: unknown[][]) =>
  header.map((label, columnIndex) => {
    const sampleLengths = bodyRows
      .slice(0, 250)
      .map((row) => String(row[columnIndex] ?? "").length);
    const maxLength = Math.max(label.length, ...sampleLengths);
    return { wch: Math.min(Math.max(maxLength + 2, 10), 42) };
  });

const buildExportFile = (
  format: ExportFormat,
  header: string[],
  keys: string[],
  rows: Array<Record<string, unknown>>,
) => {
  const displayHeader = toExportDisplayHeader(header);
  if (format === "xlsx") {
    const workbook = XLSX.utils.book_new();
    const bodyRows = rows.map((row) => keys.map((key) => sanitizeSpreadsheetValue(row[key])));
    const values = [
      displayHeader,
      ...bodyRows,
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(values);
    worksheet["!cols"] = calculateColumnWidths(displayHeader, bodyRows);
    if (displayHeader.length) {
      worksheet["!autofilter"] = {
        ref: XLSX.utils.encode_range({
          s: { r: 0, c: 0 },
          e: { r: Math.max(values.length - 1, 0), c: displayHeader.length - 1 },
        }),
      };
    }
    XLSX.utils.book_append_sheet(workbook, worksheet, "Отчет");
    const content = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return {
      content,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  }

  const csv = toCsv(displayHeader, rows, keys);
  return {
    content: Buffer.from(csv, "utf8"),
    mimeType: "text/csv;charset=utf-8",
  };
};

const resolveComplianceFlags = async (
  organizationId: string,
  storeId: string,
): Promise<ComplianceFlags> => {
  const profile = await prisma.storeComplianceProfile.findFirst({
    where: { organizationId, storeId },
    select: { enableMarking: true, enableEttn: true },
  });
  return {
    enableMarking: profile?.enableMarking ?? false,
    enableEttn: profile?.enableEttn ?? false,
  };
};

const loadComplianceFlags = async (organizationId: string, productIds: string[]) => {
  if (!productIds.length) {
    return new Map<
      string,
      { requiresMarking: boolean; requiresEttn: boolean; markingType: string | null }
    >();
  }
  const flags = await prisma.productComplianceFlags.findMany({
    where: { organizationId, productId: { in: productIds } },
    select: { productId: true, requiresMarking: true, requiresEttn: true, markingType: true },
  });
  return new Map(flags.map((flag) => [flag.productId, flag]));
};

const buildKey = (productId: string, variantId?: string | null) =>
  `${productId}:${variantId ?? "BASE"}`;

const loadPriceMap = async (storeId: string, productIds: string[]) => {
  if (!productIds.length) {
    return new Map<string, number>();
  }
  const prices = await prisma.storePrice.findMany({
    where: { storeId, productId: { in: productIds } },
    select: { productId: true, variantId: true, priceKgs: true },
  });
  return new Map(
    prices.map((price) => [buildKey(price.productId, price.variantId), Number(price.priceKgs)]),
  );
};

const loadCostMap = async (organizationId: string, productIds: string[]) => {
  if (!productIds.length) {
    return new Map<string, number>();
  }
  const costs = await prisma.productCost.findMany({
    where: { organizationId, productId: { in: productIds } },
    select: { productId: true, variantId: true, avgCostKgs: true },
  });
  return new Map(
    costs.map((cost) => [buildKey(cost.productId, cost.variantId), Number(cost.avgCostKgs)]),
  );
};

const buildSalesSummaryRows = async (
  storeId: string,
  storeName: string,
  periodStart: Date,
  periodEnd: Date,
) => {
  const movements = await prisma.stockMovement.findMany({
    where: {
      storeId,
      type: StockMovementType.SALE,
      createdAt: { gte: periodStart, lte: periodEnd },
    },
    select: { qtyDelta: true, createdAt: true },
  });

  const byDay = new Map<string, { totalQty: number; movementCount: number }>();
  movements.forEach((movement) => {
    const day = formatDay(movement.createdAt);
    const entry = byDay.get(day) ?? { totalQty: 0, movementCount: 0 };
    entry.totalQty += Math.abs(movement.qtyDelta);
    entry.movementCount += 1;
    byDay.set(day, entry);
  });

  return Array.from(byDay.entries()).map(([day, entry]) => ({
    date: day,
    store: storeName,
    totalQty: entry.totalQty,
    movementCount: entry.movementCount,
  }));
};

const buildStockMovementsRows = async (
  organizationId: string,
  storeId: string,
  storeName: string,
  periodStart: Date,
  periodEnd: Date,
  compliance: ComplianceFlags,
) => {
  const movements = await prisma.stockMovement.findMany({
    where: {
      storeId,
      createdAt: { gte: periodStart, lte: periodEnd },
    },
    include: {
      product: { select: { id: true, sku: true, name: true } },
      variant: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const productIds = movements.map((movement) => movement.product.id);
  const flagsMap = await loadComplianceFlags(organizationId, productIds);

  return movements.map((movement) => {
    const flags = flagsMap.get(movement.product.id);
    const row: Record<string, unknown> = {
      date: movement.createdAt.toISOString(),
      store: storeName,
      sku: movement.product.sku,
      product: movement.product.name,
      variant: movement.variant?.name ?? "",
      movementType: movement.type,
      qtyDelta: movement.qtyDelta,
      reference: [movement.referenceType, movement.referenceId].filter(Boolean).join(":"),
      actor: movement.createdBy?.name ?? "",
    };
    if (compliance.enableMarking) {
      row.markingRequired = flags?.requiresMarking ?? false;
      row.markingType = flags?.markingType ?? "";
    }
    if (compliance.enableEttn) {
      row.ettnRequired = flags?.requiresEttn ?? false;
    }
    return row;
  });
};

const buildPurchasesRows = async (
  organizationId: string,
  storeId: string,
  storeName: string,
  periodStart: Date,
  periodEnd: Date,
  compliance: ComplianceFlags,
) => {
  const orders = await prisma.purchaseOrder.findMany({
    where: {
      organizationId,
      storeId,
      createdAt: { gte: periodStart, lte: periodEnd },
    },
    include: {
      supplier: true,
      lines: {
        include: { product: { select: { id: true, sku: true, name: true } }, variant: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const productIds = orders.flatMap((order) => order.lines.map((line) => line.product.id));
  const flagsMap = await loadComplianceFlags(organizationId, productIds);

  return orders.flatMap((order) =>
    order.lines.map((line) => {
      const flags = flagsMap.get(line.product.id);
      const unitCost = line.unitCost ? Number(line.unitCost) : null;
      const row: Record<string, unknown> = {
        poId: order.id,
        status: order.status,
        createdAt: order.createdAt.toISOString(),
        receivedAt: order.receivedAt ? order.receivedAt.toISOString() : "",
        store: storeName,
        supplier: order.supplier?.name ?? "",
        sku: line.product.sku,
        product: line.product.name,
        variant: line.variant?.name ?? "",
        qtyOrdered: line.qtyOrdered,
        qtyReceived: line.qtyReceived,
        unitCostKgs: unitCost ?? "",
        lineTotalKgs: unitCost ? unitCost * line.qtyReceived : "",
      };
      if (compliance.enableMarking) {
        row.markingRequired = flags?.requiresMarking ?? false;
        row.markingType = flags?.markingType ?? "";
      }
      if (compliance.enableEttn) {
        row.ettnRequired = flags?.requiresEttn ?? false;
      }
      return row;
    }),
  );
};

const buildInventoryRows = async (
  organizationId: string,
  storeId: string,
  storeName: string,
  compliance: ComplianceFlags,
) => {
  const snapshots = await prisma.inventorySnapshot.findMany({
    where: { storeId },
    include: {
      product: { select: { id: true, sku: true, name: true, basePriceKgs: true } },
      variant: { select: { id: true, name: true } },
    },
  });
  const policies = await prisma.reorderPolicy.findMany({
    where: { storeId },
    select: { productId: true, minStock: true },
  });
  const policyMap = new Map(policies.map((policy) => [policy.productId, policy.minStock]));

  const storePrices = await prisma.storePrice.findMany({
    where: { storeId },
    select: { productId: true, variantId: true, priceKgs: true },
  });

  const productIds = snapshots.map((snapshot) => snapshot.product.id);
  const flagsMap = await loadComplianceFlags(organizationId, productIds);

  return snapshots.map((snapshot) => {
    const priceOverride =
      storePrices.find(
        (price) =>
          price.productId === snapshot.product.id &&
          (price.variantId ?? null) === (snapshot.variantId ?? null),
      ) ?? storePrices.find((price) => price.productId === snapshot.product.id && !price.variantId);
    const basePrice = snapshot.product.basePriceKgs ? Number(snapshot.product.basePriceKgs) : null;
    const effectivePrice = priceOverride ? Number(priceOverride.priceKgs) : basePrice;
    const flags = flagsMap.get(snapshot.product.id);

    const row: Record<string, unknown> = {
      store: storeName,
      sku: snapshot.product.sku,
      product: snapshot.product.name,
      variant: snapshot.variant?.name ?? "",
      onHand: snapshot.onHand,
      onOrder: snapshot.onOrder,
      minStock: policyMap.get(snapshot.product.id) ?? 0,
      reorderPoint: policyMap.get(snapshot.product.id) ?? 0,
      effectivePriceKgs: effectivePrice ?? "",
    };

    if (compliance.enableMarking) {
      row.markingRequired = flags?.requiresMarking ?? false;
      row.markingType = flags?.markingType ?? "";
    }
    if (compliance.enableEttn) {
      row.ettnRequired = flags?.requiresEttn ?? false;
    }

    return row;
  });
};

const buildPeriodCloseRows = async (
  organizationId: string,
  storeId: string,
  storeName: string,
  periodStart: Date,
  periodEnd: Date,
) => {
  const close = await prisma.periodClose.findFirst({
    where: { organizationId, storeId, periodStart, periodEnd },
  });
  if (!close) {
    throw new AppError("periodNotClosed", "NOT_FOUND", 404);
  }
  const totals = (close.totals as Record<string, unknown> | null) ?? {};
  return [
    {
      store: storeName,
      periodStart: formatDay(periodStart),
      periodEnd: formatDay(periodEnd),
      closedAt: close.closedAt.toISOString(),
      movementCount: totals.movementCount ?? 0,
      skuCount: totals.skuCount ?? 0,
      salesTotalKgs: totals.salesTotalKgs ?? "",
      purchasesTotalKgs: totals.purchasesTotalKgs ?? "",
    },
  ];
};

const buildReceiptsRows = async (
  organizationId: string,
  storeId: string,
  storeName: string,
  periodStart: Date,
  periodEnd: Date,
  compliance: ComplianceFlags,
) => {
  const movements = await prisma.stockMovement.findMany({
    where: {
      storeId,
      type: StockMovementType.SALE,
      createdAt: { gte: periodStart, lte: periodEnd },
    },
    include: { product: { select: { id: true, sku: true, name: true } }, variant: true },
  });

  const productIds = movements.map((movement) => movement.product.id);
  const flagsMap = await loadComplianceFlags(organizationId, productIds);

  return movements.map((movement) => {
    const flags = flagsMap.get(movement.product.id);
    const row: Record<string, unknown> = {
      receiptId: movement.id,
      date: movement.createdAt.toISOString(),
      store: storeName,
      sku: movement.product.sku,
      product: movement.product.name,
      variant: movement.variant?.name ?? "",
      qty: Math.abs(movement.qtyDelta),
    };
    if (compliance.enableMarking) {
      row.markingRequired = flags?.requiresMarking ?? false;
      row.markingType = flags?.markingType ?? "";
    }
    if (compliance.enableEttn) {
      row.ettnRequired = flags?.requiresEttn ?? false;
    }
    return row;
  });
};

const buildReceiptsRegistryRows = async (
  organizationId: string,
  store: StoreSummary,
  periodStart: Date,
  periodEnd: Date,
) => {
  const receipts = await prisma.customerOrder.findMany({
    where: {
      organizationId,
      storeId: store.id,
      isPosSale: true,
      createdAt: { gte: periodStart, lte: periodEnd },
    },
    include: {
      register: { select: { code: true, name: true } },
      createdBy: { select: { email: true } },
      payments: {
        where: { isRefund: false },
        select: { method: true, amountKgs: true },
      },
      fiscalReceipts: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          status: true,
          mode: true,
          fiscalNumber: true,
          providerReceiptId: true,
          lastError: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return receipts.map((receipt) => {
    const payments = {
      cash: 0,
      card: 0,
      transfer: 0,
      other: 0,
    };

    for (const payment of receipt.payments) {
      const amount = Number(payment.amountKgs);
      if (payment.method === "CASH") {
        payments.cash = roundMoney(payments.cash + amount);
      } else if (payment.method === "CARD") {
        payments.card = roundMoney(payments.card + amount);
      } else if (payment.method === "TRANSFER") {
        payments.transfer = roundMoney(payments.transfer + amount);
      } else {
        payments.other = roundMoney(payments.other + amount);
      }
    }

    const fiscal = receipt.fiscalReceipts[0];
    return {
      orgId: organizationId,
      storeCode: store.code,
      storeName: store.name,
      receiptNumber: receipt.number,
      createdAt: receipt.createdAt.toISOString(),
      completedAt: receipt.completedAt ? receipt.completedAt.toISOString() : "",
      status: receipt.status,
      registerCode: receipt.register?.code ?? "",
      registerName: receipt.register?.name ?? "",
      cashierEmail: receipt.createdBy?.email ?? "",
      currencyCode: receipt.currencyCode ?? store.currencyCode,
      currencyRateKgsPerUnit:
        receipt.currencyRateKgsPerUnit?.toString?.() ?? store.currencyRateKgsPerUnit.toString(),
      totalKgs: Number(receipt.totalKgs),
      cashKgs: payments.cash,
      cardKgs: payments.card,
      transferKgs: payments.transfer,
      otherKgs: payments.other,
      kkmStatus: receipt.kkmStatus,
      fiscalStatus: fiscal?.status ?? "",
      fiscalMode: fiscal?.mode ?? "",
      fiscalNumber: fiscal?.fiscalNumber ?? "",
      providerReceiptId: fiscal?.providerReceiptId ?? "",
      fiscalError: fiscal?.lastError ?? "",
    };
  });
};

const buildShiftReportRows = async (
  organizationId: string,
  store: StoreSummary,
  periodStart: Date,
  periodEnd: Date,
  mode: "x" | "z",
) => {
  const shifts = await prisma.registerShift.findMany({
    where: {
      organizationId,
      storeId: store.id,
      openedAt: { gte: periodStart, lte: periodEnd },
      ...(mode === "z" ? { status: RegisterShiftStatus.CLOSED } : {}),
    },
    include: {
      register: { select: { code: true, name: true } },
      openedBy: { select: { email: true } },
      closedBy: { select: { email: true } },
    },
    orderBy: { openedAt: "desc" },
  });

  if (!shifts.length) {
    return [];
  }

  const shiftIds = shifts.map((shift) => shift.id);

  const [salesAgg, returnsAgg, paymentsAgg, cashAgg] = await Promise.all([
    prisma.customerOrder.groupBy({
      by: ["shiftId"],
      where: {
        organizationId,
        isPosSale: true,
        status: CustomerOrderStatus.COMPLETED,
        shiftId: { in: shiftIds },
      },
      _sum: { totalKgs: true },
      _count: { _all: true },
    }),
    prisma.saleReturn.groupBy({
      by: ["shiftId"],
      where: {
        organizationId,
        status: PosReturnStatus.COMPLETED,
        shiftId: { in: shiftIds },
      },
      _sum: { totalKgs: true },
      _count: { _all: true },
    }),
    prisma.salePayment.groupBy({
      by: ["shiftId", "method", "isRefund"],
      where: {
        organizationId,
        shiftId: { in: shiftIds },
        OR: [
          {
            isRefund: false,
            customerOrder: {
              isPosSale: true,
              status: CustomerOrderStatus.COMPLETED,
            },
          },
          {
            isRefund: true,
            saleReturn: {
              status: PosReturnStatus.COMPLETED,
            },
          },
        ],
      },
      _sum: { amountKgs: true },
    }),
    prisma.cashDrawerMovement.groupBy({
      by: ["shiftId", "type"],
      where: {
        organizationId,
        shiftId: { in: shiftIds },
      },
      _sum: { amountKgs: true },
    }),
  ]);

  const salesMap = new Map(salesAgg.map((row) => [row.shiftId, row]));
  const returnsMap = new Map(returnsAgg.map((row) => [row.shiftId, row]));
  const paymentsMap = new Map<string, Array<(typeof paymentsAgg)[number]>>();
  for (const row of paymentsAgg) {
    const list = paymentsMap.get(row.shiftId) ?? [];
    list.push(row);
    paymentsMap.set(row.shiftId, list);
  }
  const cashMap = new Map<string, Array<(typeof cashAgg)[number]>>();
  for (const row of cashAgg) {
    const list = cashMap.get(row.shiftId) ?? [];
    list.push(row);
    cashMap.set(row.shiftId, list);
  }

  return shifts.map((shift) => {
    const sales = salesMap.get(shift.id);
    const returns = returnsMap.get(shift.id);
    const paymentRows = paymentsMap.get(shift.id) ?? [];
    const cashRows = cashMap.get(shift.id) ?? [];

    const cashSales = paymentRows
      .filter((row) => row.method === PosPaymentMethod.CASH && !row.isRefund)
      .reduce((sum, row) => sum + Number(row._sum.amountKgs ?? 0), 0);
    const cashRefunds = paymentRows
      .filter((row) => row.method === PosPaymentMethod.CASH && row.isRefund)
      .reduce((sum, row) => sum + Number(row._sum.amountKgs ?? 0), 0);
    const cardSales = paymentRows
      .filter((row) => row.method === PosPaymentMethod.CARD && !row.isRefund)
      .reduce((sum, row) => sum + Number(row._sum.amountKgs ?? 0), 0);
    const cardRefunds = paymentRows
      .filter((row) => row.method === PosPaymentMethod.CARD && row.isRefund)
      .reduce((sum, row) => sum + Number(row._sum.amountKgs ?? 0), 0);
    const transferSales = paymentRows
      .filter((row) => row.method === PosPaymentMethod.TRANSFER && !row.isRefund)
      .reduce((sum, row) => sum + Number(row._sum.amountKgs ?? 0), 0);
    const transferRefunds = paymentRows
      .filter((row) => row.method === PosPaymentMethod.TRANSFER && row.isRefund)
      .reduce((sum, row) => sum + Number(row._sum.amountKgs ?? 0), 0);
    const otherSales = paymentRows
      .filter((row) => row.method === PosPaymentMethod.OTHER && !row.isRefund)
      .reduce((sum, row) => sum + Number(row._sum.amountKgs ?? 0), 0);
    const otherRefunds = paymentRows
      .filter((row) => row.method === PosPaymentMethod.OTHER && row.isRefund)
      .reduce((sum, row) => sum + Number(row._sum.amountKgs ?? 0), 0);
    const nonCashSales = roundMoney(cardSales + transferSales + otherSales);
    const nonCashRefunds = roundMoney(cardRefunds + transferRefunds + otherRefunds);
    const payIn = cashRows
      .filter((row) => row.type === CashDrawerMovementType.PAY_IN)
      .reduce((sum, row) => sum + Number(row._sum.amountKgs ?? 0), 0);
    const payOut = cashRows
      .filter((row) => row.type === CashDrawerMovementType.PAY_OUT)
      .reduce((sum, row) => sum + Number(row._sum.amountKgs ?? 0), 0);

    const expectedCash = roundMoney(
      Number(shift.openingCashKgs) + payIn - payOut + cashSales - cashRefunds,
    );
    const overWithdrawal = expectedCash < 0 ? roundMoney(Math.abs(expectedCash)) : 0;
    const countedCash = shift.closingCashCountedKgs ? Number(shift.closingCashCountedKgs) : null;
    const discrepancy = countedCash === null ? null : roundMoney(countedCash - expectedCash);

    return {
      orgId: organizationId,
      storeCode: store.code,
      reportType: mode === "x" ? "SHIFT_X" : "SHIFT_Z",
      shiftId: shift.id,
      status: shift.status,
      currencyCode: shift.currencyCode ?? store.currencyCode,
      currencyRateKgsPerUnit:
        shift.currencyRateKgsPerUnit?.toString?.() ?? store.currencyRateKgsPerUnit.toString(),
      registerCode: shift.register.code,
      registerName: shift.register.name,
      openedAt: shift.openedAt.toISOString(),
      openedBy: shift.openedBy.email ?? "",
      closedAt: shift.closedAt ? shift.closedAt.toISOString() : "",
      closedBy: shift.closedBy?.email ?? "",
      salesCount: sales?._count._all ?? 0,
      salesTotalKgs: Number(sales?._sum.totalKgs ?? 0),
      cashSalesKgs: roundMoney(cashSales),
      nonCashSalesKgs: nonCashSales,
      cardSalesKgs: roundMoney(cardSales),
      transferSalesKgs: roundMoney(transferSales),
      otherSalesKgs: roundMoney(otherSales),
      returnsCount: returns?._count._all ?? 0,
      returnsTotalKgs: Number(returns?._sum.totalKgs ?? 0),
      cashRefundsKgs: roundMoney(cashRefunds),
      nonCashRefundsKgs: nonCashRefunds,
      cardRefundsKgs: roundMoney(cardRefunds),
      transferRefundsKgs: roundMoney(transferRefunds),
      otherRefundsKgs: roundMoney(otherRefunds),
      nonCashNetKgs: roundMoney(nonCashSales - nonCashRefunds),
      openingCashKgs: Number(shift.openingCashKgs),
      cashPayInKgs: roundMoney(payIn),
      cashPayOutKgs: roundMoney(payOut),
      expectedCashKgs: expectedCash,
      overWithdrawalKgs: overWithdrawal,
      countedCashKgs: countedCash ?? "",
      discrepancyKgs: discrepancy ?? "",
    };
  });
};

const buildSalesByDayRows = async (
  organizationId: string,
  store: StoreSummary,
  periodStart: Date,
  periodEnd: Date,
) => {
  const sales = await prisma.customerOrder.findMany({
    where: {
      organizationId,
      storeId: store.id,
      isPosSale: true,
      status: CustomerOrderStatus.COMPLETED,
      completedAt: { gte: periodStart, lte: periodEnd },
    },
    select: { completedAt: true, totalKgs: true },
  });

  const grouped = new Map<string, { ordersCount: number; revenueKgs: number }>();
  for (const sale of sales) {
    if (!sale.completedAt) {
      continue;
    }
    const day = formatDay(sale.completedAt);
    const entry = grouped.get(day) ?? { ordersCount: 0, revenueKgs: 0 };
    entry.ordersCount += 1;
    entry.revenueKgs = roundMoney(entry.revenueKgs + Number(sale.totalKgs));
    grouped.set(day, entry);
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, entry]) => ({
      orgId: organizationId,
      storeCode: store.code,
      day,
      ordersCount: entry.ordersCount,
      revenueKgs: entry.revenueKgs,
    }));
};

const buildSalesByItemRows = async (
  organizationId: string,
  store: StoreSummary,
  periodStart: Date,
  periodEnd: Date,
) => {
  const lines = await prisma.customerOrderLine.findMany({
    where: {
      customerOrder: {
        organizationId,
        storeId: store.id,
        isPosSale: true,
        status: CustomerOrderStatus.COMPLETED,
        completedAt: { gte: periodStart, lte: periodEnd },
      },
    },
    select: {
      product: { select: { sku: true, name: true } },
      variant: { select: { sku: true, name: true } },
      qty: true,
      lineTotalKgs: true,
    },
  });

  const grouped = new Map<
    string,
    {
      sku: string;
      productName: string;
      variantSku: string;
      variantName: string;
      qty: number;
      revenueKgs: number;
    }
  >();
  for (const line of lines) {
    const key = `${line.product.sku}:${line.variant?.sku ?? "BASE"}`;
    const entry = grouped.get(key) ?? {
      sku: line.product.sku,
      productName: line.product.name,
      variantSku: line.variant?.sku ?? "",
      variantName: line.variant?.name ?? "",
      qty: 0,
      revenueKgs: 0,
    };
    entry.qty += line.qty;
    entry.revenueKgs = roundMoney(entry.revenueKgs + Number(line.lineTotalKgs));
    grouped.set(key, entry);
  }

  return Array.from(grouped.values()).map((entry) => ({
    orgId: organizationId,
    storeCode: store.code,
    ...entry,
  }));
};

const buildReturnsByDayRows = async (
  organizationId: string,
  store: StoreSummary,
  periodStart: Date,
  periodEnd: Date,
) => {
  const returns = await prisma.saleReturn.findMany({
    where: {
      organizationId,
      storeId: store.id,
      status: PosReturnStatus.COMPLETED,
      completedAt: { gte: periodStart, lte: periodEnd },
    },
    select: { completedAt: true, totalKgs: true },
  });

  const grouped = new Map<string, { returnsCount: number; returnsTotalKgs: number }>();
  for (const item of returns) {
    if (!item.completedAt) {
      continue;
    }
    const day = formatDay(item.completedAt);
    const entry = grouped.get(day) ?? { returnsCount: 0, returnsTotalKgs: 0 };
    entry.returnsCount += 1;
    entry.returnsTotalKgs = roundMoney(entry.returnsTotalKgs + Number(item.totalKgs));
    grouped.set(day, entry);
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, entry]) => ({
      orgId: organizationId,
      storeCode: store.code,
      day,
      returnsCount: entry.returnsCount,
      returnsTotalKgs: entry.returnsTotalKgs,
    }));
};

const buildReturnsByItemRows = async (
  organizationId: string,
  store: StoreSummary,
  periodStart: Date,
  periodEnd: Date,
) => {
  const lines = await prisma.saleReturnLine.findMany({
    where: {
      saleReturn: {
        organizationId,
        storeId: store.id,
        status: PosReturnStatus.COMPLETED,
        completedAt: { gte: periodStart, lte: periodEnd },
      },
    },
    select: {
      product: { select: { sku: true, name: true } },
      variant: { select: { sku: true, name: true } },
      qty: true,
      lineTotalKgs: true,
    },
  });

  const grouped = new Map<
    string,
    {
      sku: string;
      productName: string;
      variantSku: string;
      variantName: string;
      qty: number;
      returnsTotalKgs: number;
    }
  >();
  for (const line of lines) {
    const key = `${line.product.sku}:${line.variant?.sku ?? "BASE"}`;
    const entry = grouped.get(key) ?? {
      sku: line.product.sku,
      productName: line.product.name,
      variantSku: line.variant?.sku ?? "",
      variantName: line.variant?.name ?? "",
      qty: 0,
      returnsTotalKgs: 0,
    };
    entry.qty += line.qty;
    entry.returnsTotalKgs = roundMoney(entry.returnsTotalKgs + Number(line.lineTotalKgs));
    grouped.set(key, entry);
  }

  return Array.from(grouped.values()).map((entry) => ({
    orgId: organizationId,
    storeCode: store.code,
    ...entry,
  }));
};

const buildCashDrawerMovementRows = async (
  organizationId: string,
  store: StoreSummary,
  periodStart: Date,
  periodEnd: Date,
) => {
  const rows = await prisma.cashDrawerMovement.findMany({
    where: {
      organizationId,
      storeId: store.id,
      createdAt: { gte: periodStart, lte: periodEnd },
    },
    include: {
      shift: { select: { id: true, register: { select: { code: true, name: true } } } },
      createdBy: { select: { email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return rows.map((row) => ({
    orgId: organizationId,
    storeCode: store.code,
    createdAt: row.createdAt.toISOString(),
    shiftId: row.shiftId,
    registerCode: row.shift.register.code,
    registerName: row.shift.register.name,
    type: row.type,
    currencyCode: row.currencyCode ?? store.currencyCode,
    currencyRateKgsPerUnit:
      row.currencyRateKgsPerUnit?.toString?.() ?? store.currencyRateKgsPerUnit.toString(),
    amountKgs: Number(row.amountKgs),
    reason: row.reason,
    createdBy: row.createdBy?.email ?? "",
  }));
};

const buildMarkingSalesRegistryRows = async (
  organizationId: string,
  store: StoreSummary,
  periodStart: Date,
  periodEnd: Date,
) => {
  const rows = await prisma.markingCodeCapture.findMany({
    where: {
      organizationId,
      storeId: store.id,
      status: MarkingCodeStatus.CAPTURED,
      capturedAt: { gte: periodStart, lte: periodEnd },
      sale: {
        isPosSale: true,
      },
    },
    include: {
      sale: { select: { number: true, createdAt: true } },
      saleLine: {
        select: {
          qty: true,
          product: { select: { sku: true, name: true } },
        },
      },
      capturedBy: { select: { email: true } },
    },
    orderBy: { capturedAt: "desc" },
  });

  return rows.map((row) => ({
    orgId: organizationId,
    storeCode: store.code,
    capturedAt: row.capturedAt.toISOString(),
    receiptNumber: row.sale.number,
    receiptCreatedAt: row.sale.createdAt.toISOString(),
    sku: row.saleLine.product.sku,
    productName: row.saleLine.product.name,
    qty: row.saleLine.qty,
    markingCode: row.code,
    capturedBy: row.capturedBy?.email ?? "",
  }));
};

const buildEttnReferenceRows = async (
  organizationId: string,
  store: StoreSummary,
  periodStart: Date,
  periodEnd: Date,
) => {
  const rows = await prisma.ettnReference.findMany({
    where: {
      organizationId,
      storeId: store.id,
      createdAt: { gte: periodStart, lte: periodEnd },
    },
    include: {
      createdBy: { select: { email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return rows.map((row) => ({
    orgId: organizationId,
    storeCode: store.code,
    createdAt: row.createdAt.toISOString(),
    documentType: row.documentType,
    documentId: row.documentId,
    ettnNumber: row.ettnNumber,
    ettnDate: row.ettnDate ? row.ettnDate.toISOString() : "",
    notes: row.notes ?? "",
    createdBy: row.createdBy?.email ?? "",
  }));
};

const buildEsfReferenceRows = async (
  organizationId: string,
  store: StoreSummary,
  periodStart: Date,
  periodEnd: Date,
) => {
  const rows = await prisma.esfReference.findMany({
    where: {
      organizationId,
      storeId: store.id,
      createdAt: { gte: periodStart, lte: periodEnd },
    },
    include: {
      createdBy: { select: { email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return rows.map((row) => ({
    orgId: organizationId,
    storeCode: store.code,
    createdAt: row.createdAt.toISOString(),
    documentType: row.documentType,
    documentId: row.documentId,
    esfNumber: row.esfNumber,
    esfDate: row.esfDate ? row.esfDate.toISOString() : "",
    counterpartyName: row.counterpartyName ?? "",
    createdBy: row.createdBy?.email ?? "",
  }));
};

const buildInventoryMovementsLedgerRows = async (
  organizationId: string,
  store: StoreSummary,
  periodStart: Date,
  periodEnd: Date,
  compliance: ComplianceFlags,
) => {
  const movements = await prisma.stockMovement.findMany({
    where: { storeId: store.id, createdAt: { gte: periodStart, lte: periodEnd } },
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          unit: true,
          basePriceKgs: true,
          barcodes: { select: { value: true } },
        },
      },
      variant: { select: { id: true, name: true, sku: true } },
      createdBy: { select: { email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const productIds = movements.map((movement) => movement.product.id);
  const flagsMap = await loadComplianceFlags(organizationId, productIds);
  const priceMap = await loadPriceMap(store.id, productIds);
  const costMap = await loadCostMap(organizationId, productIds);

  return movements.map((movement) => {
    const flags = flagsMap.get(movement.product.id);
    const key = buildKey(movement.product.id, movement.variant?.id ?? null);
    const override = priceMap.get(key) ?? priceMap.get(buildKey(movement.product.id, null));
    const basePrice = movement.product.basePriceKgs ? Number(movement.product.basePriceKgs) : null;
    const effectivePrice = override ?? basePrice;
    const avgCost = costMap.get(key) ?? costMap.get(buildKey(movement.product.id, null)) ?? null;
    const totalCost = avgCost !== null ? avgCost * Math.abs(movement.qtyDelta) : null;
    const barcode = movement.product.barcodes?.[0]?.value ?? "";
    const row: Record<string, unknown> = {
      orgId: organizationId,
      storeCode: store.code,
      storeName: store.name,
      movementId: movement.id,
      movementType: movement.type,
      occurredAt: movement.createdAt.toISOString(),
      sku: movement.product.sku,
      variantSku: movement.variant?.sku ?? "",
      productName: movement.product.name,
      variantName: movement.variant?.name ?? "",
      barcode,
      qtyDelta: movement.qtyDelta,
      unit: movement.product.unit,
      unitCostKgs: avgCost ?? "",
      totalCostKgs: totalCost ?? "",
      effectivePriceKgs: effectivePrice ?? "",
      reason: movement.note ?? "",
      docType: movement.referenceType ?? "",
      docNumber: movement.referenceId ?? "",
      userEmail: movement.createdBy?.email ?? "",
      requestId: "",
    };
    if (compliance.enableMarking) {
      row.markingRequired = flags?.requiresMarking ?? false;
      row.markingType = flags?.markingType ?? "";
    }
    if (compliance.enableEttn) {
      row.ettnRequired = flags?.requiresEttn ?? false;
    }
    return row;
  });
};

const buildInventoryBalancesRows = async (organizationId: string, store: StoreSummary) => {
  const snapshots = await prisma.inventorySnapshot.findMany({
    where: { storeId: store.id },
    include: {
      product: { select: { id: true, sku: true, name: true, unit: true } },
      variant: { select: { id: true, sku: true } },
    },
  });
  const productIds = snapshots.map((snapshot) => snapshot.product.id);
  const costMap = await loadCostMap(organizationId, productIds);

  return snapshots.map((snapshot) => {
    const key = buildKey(snapshot.product.id, snapshot.variant?.id ?? null);
    const avgCost = costMap.get(key) ?? costMap.get(buildKey(snapshot.product.id, null)) ?? null;
    const inventoryValue = avgCost !== null ? avgCost * snapshot.onHand : null;
    return {
      orgId: organizationId,
      storeCode: store.code,
      sku: snapshot.product.sku,
      variantSku: snapshot.variant?.sku ?? "",
      productName: snapshot.product.name,
      onHand: snapshot.onHand,
      unit: snapshot.product.unit,
      avgCostKgs: avgCost ?? "",
      inventoryValueKgs: inventoryValue ?? "",
    };
  });
};

const buildPurchasesReceiptsRows = async (
  organizationId: string,
  store: StoreSummary,
  periodStart: Date,
  periodEnd: Date,
) => {
  const orders = await prisma.purchaseOrder.findMany({
    where: {
      organizationId,
      storeId: store.id,
      receivedAt: { gte: periodStart, lte: periodEnd },
    },
    include: {
      supplier: true,
      lines: {
        include: {
          product: { select: { sku: true, name: true, unit: true } },
          variant: { select: { sku: true } },
        },
      },
    },
  });

  return orders.flatMap((order) =>
    order.lines
      .filter((line) => line.qtyReceived > 0)
      .map((line) => {
        const unitCost = line.unitCost ? Number(line.unitCost) : null;
        return {
          orgId: organizationId,
          storeCode: store.code,
          supplierName: order.supplier?.name ?? "",
          supplierInn: "",
          poNumber: order.id,
          receivedAt: order.receivedAt ? order.receivedAt.toISOString() : "",
          sku: line.product.sku,
          qty: line.qtyReceived,
          unit: line.product.unit,
          unitCostKgs: unitCost ?? "",
          lineTotalKgs: unitCost ? unitCost * line.qtyReceived : "",
        };
      }),
  );
};

const buildPriceListRows = async (organizationId: string, store: StoreSummary) => {
  const products = await prisma.product.findMany({
    where: { organizationId, isDeleted: false },
    select: { id: true, sku: true, name: true, basePriceKgs: true },
  });
  const productIds = products.map((product) => product.id);
  const priceMap = await loadPriceMap(store.id, productIds);
  const costMap = await loadCostMap(organizationId, productIds);

  return products.map((product) => {
    const basePrice = product.basePriceKgs ? Number(product.basePriceKgs) : null;
    const override = priceMap.get(buildKey(product.id, null)) ?? null;
    const effectivePrice = override ?? basePrice;
    const avgCost = costMap.get(buildKey(product.id, null)) ?? null;
    const marginPct =
      effectivePrice && avgCost !== null && effectivePrice > 0
        ? ((effectivePrice - avgCost) / effectivePrice) * 100
        : null;
    const markupPct =
      avgCost && avgCost > 0 && effectivePrice !== null
        ? ((effectivePrice - avgCost) / avgCost) * 100
        : null;

    return {
      orgId: organizationId,
      storeCode: store.code,
      sku: product.sku,
      productName: product.name,
      basePriceKgs: basePrice ?? "",
      storeOverridePriceKgs: override ?? "",
      effectivePriceKgs: effectivePrice ?? "",
      avgCostKgs: avgCost ?? "",
      marginPct: marginPct !== null ? Number(marginPct.toFixed(2)) : "",
      markupPct: markupPct !== null ? Number(markupPct.toFixed(2)) : "",
    };
  });
};

const buildExportData = async (
  input: ExportRequestInput,
  store: StoreSummary,
  compliance: ComplianceFlags,
) => {
  switch (input.type) {
    case ExportType.INVENTORY_MOVEMENTS_LEDGER: {
      const rows = await buildInventoryMovementsLedgerRows(
        input.organizationId,
        store,
        input.periodStart,
        input.periodEnd,
        compliance,
      );
      const header = [
        "orgId",
        "storeCode",
        "storeName",
        "movementId",
        "movementType",
        "occurredAt",
        "sku",
        "variantSku",
        "productName",
        "variantName",
        "barcode",
        "qtyDelta",
        "unit",
        "unitCostKgs",
        "totalCostKgs",
        "effectivePriceKgs",
        "reason",
        "docType",
        "docNumber",
        "userEmail",
        "requestId",
      ];
      const keys = [...header];
      if (compliance.enableMarking) {
        header.push("markingRequired", "markingType");
        keys.push("markingRequired", "markingType");
      }
      if (compliance.enableEttn) {
        header.push("ettnRequired");
        keys.push("ettnRequired");
      }
      return { header, keys, rows };
    }
    case ExportType.INVENTORY_BALANCES_AT_DATE: {
      const rows = await buildInventoryBalancesRows(input.organizationId, store);
      return {
        header: [
          "orgId",
          "storeCode",
          "sku",
          "variantSku",
          "productName",
          "onHand",
          "unit",
          "avgCostKgs",
          "inventoryValueKgs",
        ],
        keys: [
          "orgId",
          "storeCode",
          "sku",
          "variantSku",
          "productName",
          "onHand",
          "unit",
          "avgCostKgs",
          "inventoryValueKgs",
        ],
        rows,
      };
    }
    case ExportType.PURCHASES_RECEIPTS: {
      const rows = await buildPurchasesReceiptsRows(
        input.organizationId,
        store,
        input.periodStart,
        input.periodEnd,
      );
      return {
        header: [
          "orgId",
          "storeCode",
          "supplierName",
          "supplierInn",
          "poNumber",
          "receivedAt",
          "sku",
          "qty",
          "unit",
          "unitCostKgs",
          "lineTotalKgs",
        ],
        keys: [
          "orgId",
          "storeCode",
          "supplierName",
          "supplierInn",
          "poNumber",
          "receivedAt",
          "sku",
          "qty",
          "unit",
          "unitCostKgs",
          "lineTotalKgs",
        ],
        rows,
      };
    }
    case ExportType.PRICE_LIST: {
      const rows = await buildPriceListRows(input.organizationId, store);
      return {
        header: [
          "orgId",
          "storeCode",
          "sku",
          "productName",
          "basePriceKgs",
          "storeOverridePriceKgs",
          "effectivePriceKgs",
          "avgCostKgs",
          "marginPct",
          "markupPct",
        ],
        keys: [
          "orgId",
          "storeCode",
          "sku",
          "productName",
          "basePriceKgs",
          "storeOverridePriceKgs",
          "effectivePriceKgs",
          "avgCostKgs",
          "marginPct",
          "markupPct",
        ],
        rows,
      };
    }
    case ExportType.SALES_SUMMARY: {
      const rows = await buildSalesSummaryRows(
        input.storeId,
        store.name,
        input.periodStart,
        input.periodEnd,
      );
      return {
        header: ["date", "store", "totalQty", "movementCount"],
        keys: ["date", "store", "totalQty", "movementCount"],
        rows,
      };
    }
    case ExportType.STOCK_MOVEMENTS: {
      const rows = await buildStockMovementsRows(
        input.organizationId,
        input.storeId,
        store.name,
        input.periodStart,
        input.periodEnd,
        compliance,
      );
      const header = [
        "date",
        "store",
        "sku",
        "product",
        "variant",
        "movementType",
        "qtyDelta",
        "reference",
        "actor",
      ];
      const keys = [
        "date",
        "store",
        "sku",
        "product",
        "variant",
        "movementType",
        "qtyDelta",
        "reference",
        "actor",
      ];
      if (compliance.enableMarking) {
        header.push("markingRequired", "markingType");
        keys.push("markingRequired", "markingType");
      }
      if (compliance.enableEttn) {
        header.push("ettnRequired");
        keys.push("ettnRequired");
      }
      return { header, keys, rows };
    }
    case ExportType.PURCHASES: {
      const rows = await buildPurchasesRows(
        input.organizationId,
        input.storeId,
        store.name,
        input.periodStart,
        input.periodEnd,
        compliance,
      );
      const header = [
        "poId",
        "status",
        "createdAt",
        "receivedAt",
        "store",
        "supplier",
        "sku",
        "product",
        "variant",
        "qtyOrdered",
        "qtyReceived",
        "unitCostKgs",
        "lineTotalKgs",
      ];
      const keys = [
        "poId",
        "status",
        "createdAt",
        "receivedAt",
        "store",
        "supplier",
        "sku",
        "product",
        "variant",
        "qtyOrdered",
        "qtyReceived",
        "unitCostKgs",
        "lineTotalKgs",
      ];
      if (compliance.enableMarking) {
        header.push("markingRequired", "markingType");
        keys.push("markingRequired", "markingType");
      }
      if (compliance.enableEttn) {
        header.push("ettnRequired");
        keys.push("ettnRequired");
      }
      return { header, keys, rows };
    }
    case ExportType.INVENTORY_ON_HAND: {
      const rows = await buildInventoryRows(
        input.organizationId,
        input.storeId,
        store.name,
        compliance,
      );
      const header = [
        "store",
        "sku",
        "product",
        "variant",
        "onHand",
        "onOrder",
        "minStock",
        "reorderPoint",
        "effectivePriceKgs",
      ];
      const keys = [
        "store",
        "sku",
        "product",
        "variant",
        "onHand",
        "onOrder",
        "minStock",
        "reorderPoint",
        "effectivePriceKgs",
      ];
      if (compliance.enableMarking) {
        header.push("markingRequired", "markingType");
        keys.push("markingRequired", "markingType");
      }
      if (compliance.enableEttn) {
        header.push("ettnRequired");
        keys.push("ettnRequired");
      }
      return { header, keys, rows };
    }
    case ExportType.PERIOD_CLOSE_REPORT: {
      const rows = await buildPeriodCloseRows(
        input.organizationId,
        input.storeId,
        store.name,
        input.periodStart,
        input.periodEnd,
      );
      return {
        header: [
          "store",
          "periodStart",
          "periodEnd",
          "closedAt",
          "movementCount",
          "skuCount",
          "salesTotalKgs",
          "purchasesTotalKgs",
        ],
        keys: [
          "store",
          "periodStart",
          "periodEnd",
          "closedAt",
          "movementCount",
          "skuCount",
          "salesTotalKgs",
          "purchasesTotalKgs",
        ],
        rows,
      };
    }
    case ExportType.RECEIPTS_FOR_KKM: {
      const rows = await buildReceiptsRows(
        input.organizationId,
        input.storeId,
        store.name,
        input.periodStart,
        input.periodEnd,
        compliance,
      );
      const header = ["receiptId", "date", "store", "sku", "product", "variant", "qty"];
      const keys = ["receiptId", "date", "store", "sku", "product", "variant", "qty"];
      if (compliance.enableMarking) {
        header.push("markingRequired", "markingType");
        keys.push("markingRequired", "markingType");
      }
      if (compliance.enableEttn) {
        header.push("ettnRequired");
        keys.push("ettnRequired");
      }
      return { header, keys, rows };
    }
    case ExportType.RECEIPTS_REGISTRY: {
      const rows = await buildReceiptsRegistryRows(
        input.organizationId,
        store,
        input.periodStart,
        input.periodEnd,
      );
      const header = [
        "orgId",
        "storeCode",
        "storeName",
        "receiptNumber",
        "createdAt",
        "completedAt",
        "status",
        "registerCode",
        "registerName",
        "cashierEmail",
        "currencyCode",
        "currencyRateKgsPerUnit",
        "totalKgs",
        "cashKgs",
        "cardKgs",
        "transferKgs",
        "otherKgs",
        "kkmStatus",
        "fiscalStatus",
        "fiscalMode",
        "fiscalNumber",
        "providerReceiptId",
        "fiscalError",
      ];
      return { header, keys: [...header], rows };
    }
    case ExportType.SHIFT_X_REPORT: {
      const rows = await buildShiftReportRows(
        input.organizationId,
        store,
        input.periodStart,
        input.periodEnd,
        "x",
      );
      const header = [
        "orgId",
        "storeCode",
        "reportType",
        "shiftId",
        "status",
        "currencyCode",
        "currencyRateKgsPerUnit",
        "registerCode",
        "registerName",
        "openedAt",
        "openedBy",
        "closedAt",
        "closedBy",
        "salesCount",
        "salesTotalKgs",
        "cashSalesKgs",
        "nonCashSalesKgs",
        "cardSalesKgs",
        "transferSalesKgs",
        "otherSalesKgs",
        "returnsCount",
        "returnsTotalKgs",
        "cashRefundsKgs",
        "nonCashRefundsKgs",
        "cardRefundsKgs",
        "transferRefundsKgs",
        "otherRefundsKgs",
        "nonCashNetKgs",
        "openingCashKgs",
        "cashPayInKgs",
        "cashPayOutKgs",
        "expectedCashKgs",
        "overWithdrawalKgs",
        "countedCashKgs",
        "discrepancyKgs",
      ];
      return { header, keys: [...header], rows };
    }
    case ExportType.SHIFT_Z_REPORT: {
      const rows = await buildShiftReportRows(
        input.organizationId,
        store,
        input.periodStart,
        input.periodEnd,
        "z",
      );
      const header = [
        "orgId",
        "storeCode",
        "reportType",
        "shiftId",
        "status",
        "currencyCode",
        "currencyRateKgsPerUnit",
        "registerCode",
        "registerName",
        "openedAt",
        "openedBy",
        "closedAt",
        "closedBy",
        "salesCount",
        "salesTotalKgs",
        "cashSalesKgs",
        "nonCashSalesKgs",
        "cardSalesKgs",
        "transferSalesKgs",
        "otherSalesKgs",
        "returnsCount",
        "returnsTotalKgs",
        "cashRefundsKgs",
        "nonCashRefundsKgs",
        "cardRefundsKgs",
        "transferRefundsKgs",
        "otherRefundsKgs",
        "nonCashNetKgs",
        "openingCashKgs",
        "cashPayInKgs",
        "cashPayOutKgs",
        "expectedCashKgs",
        "overWithdrawalKgs",
        "countedCashKgs",
        "discrepancyKgs",
      ];
      return { header, keys: [...header], rows };
    }
    case ExportType.SALES_BY_DAY: {
      const rows = await buildSalesByDayRows(
        input.organizationId,
        store,
        input.periodStart,
        input.periodEnd,
      );
      return {
        header: ["orgId", "storeCode", "day", "ordersCount", "revenueKgs"],
        keys: ["orgId", "storeCode", "day", "ordersCount", "revenueKgs"],
        rows,
      };
    }
    case ExportType.SALES_BY_ITEM: {
      const rows = await buildSalesByItemRows(
        input.organizationId,
        store,
        input.periodStart,
        input.periodEnd,
      );
      return {
        header: [
          "orgId",
          "storeCode",
          "sku",
          "productName",
          "variantSku",
          "variantName",
          "qty",
          "revenueKgs",
        ],
        keys: [
          "orgId",
          "storeCode",
          "sku",
          "productName",
          "variantSku",
          "variantName",
          "qty",
          "revenueKgs",
        ],
        rows,
      };
    }
    case ExportType.RETURNS_BY_DAY: {
      const rows = await buildReturnsByDayRows(
        input.organizationId,
        store,
        input.periodStart,
        input.periodEnd,
      );
      return {
        header: ["orgId", "storeCode", "day", "returnsCount", "returnsTotalKgs"],
        keys: ["orgId", "storeCode", "day", "returnsCount", "returnsTotalKgs"],
        rows,
      };
    }
    case ExportType.RETURNS_BY_ITEM: {
      const rows = await buildReturnsByItemRows(
        input.organizationId,
        store,
        input.periodStart,
        input.periodEnd,
      );
      return {
        header: [
          "orgId",
          "storeCode",
          "sku",
          "productName",
          "variantSku",
          "variantName",
          "qty",
          "returnsTotalKgs",
        ],
        keys: [
          "orgId",
          "storeCode",
          "sku",
          "productName",
          "variantSku",
          "variantName",
          "qty",
          "returnsTotalKgs",
        ],
        rows,
      };
    }
    case ExportType.CASH_DRAWER_MOVEMENTS: {
      const rows = await buildCashDrawerMovementRows(
        input.organizationId,
        store,
        input.periodStart,
        input.periodEnd,
      );
      return {
        header: [
          "orgId",
          "storeCode",
          "createdAt",
          "shiftId",
          "registerCode",
          "registerName",
          "type",
          "currencyCode",
          "currencyRateKgsPerUnit",
          "amountKgs",
          "reason",
          "createdBy",
        ],
        keys: [
          "orgId",
          "storeCode",
          "createdAt",
          "shiftId",
          "registerCode",
          "registerName",
          "type",
          "currencyCode",
          "currencyRateKgsPerUnit",
          "amountKgs",
          "reason",
          "createdBy",
        ],
        rows,
      };
    }
    case ExportType.MARKING_SALES_REGISTRY: {
      const rows = await buildMarkingSalesRegistryRows(
        input.organizationId,
        store,
        input.periodStart,
        input.periodEnd,
      );
      return {
        header: [
          "orgId",
          "storeCode",
          "capturedAt",
          "receiptNumber",
          "receiptCreatedAt",
          "sku",
          "productName",
          "qty",
          "markingCode",
          "capturedBy",
        ],
        keys: [
          "orgId",
          "storeCode",
          "capturedAt",
          "receiptNumber",
          "receiptCreatedAt",
          "sku",
          "productName",
          "qty",
          "markingCode",
          "capturedBy",
        ],
        rows,
      };
    }
    case ExportType.ETTN_REFERENCES: {
      const rows = await buildEttnReferenceRows(
        input.organizationId,
        store,
        input.periodStart,
        input.periodEnd,
      );
      return {
        header: [
          "orgId",
          "storeCode",
          "createdAt",
          "documentType",
          "documentId",
          "ettnNumber",
          "ettnDate",
          "notes",
          "createdBy",
        ],
        keys: [
          "orgId",
          "storeCode",
          "createdAt",
          "documentType",
          "documentId",
          "ettnNumber",
          "ettnDate",
          "notes",
          "createdBy",
        ],
        rows,
      };
    }
    case ExportType.ESF_REFERENCES: {
      const rows = await buildEsfReferenceRows(
        input.organizationId,
        store,
        input.periodStart,
        input.periodEnd,
      );
      return {
        header: [
          "orgId",
          "storeCode",
          "createdAt",
          "documentType",
          "documentId",
          "esfNumber",
          "esfDate",
          "counterpartyName",
          "createdBy",
        ],
        keys: [
          "orgId",
          "storeCode",
          "createdAt",
          "documentType",
          "documentId",
          "esfNumber",
          "esfDate",
          "counterpartyName",
          "createdBy",
        ],
        rows,
      };
    }
    default:
      throw new AppError("exportTypeInvalid", "BAD_REQUEST", 400);
  }
};

type ListExportJobsInput = {
  storeId?: string;
  storeIds?: string[];
  limit?: number;
};

const normalizeListLimit = (limit?: number) => {
  if (!Number.isFinite(limit)) {
    return DEFAULT_EXPORT_LIST_LIMIT;
  }
  return Math.max(1, Math.min(MAX_EXPORT_LIST_LIMIT, Math.trunc(limit as number)));
};

const assertExportQueueCapacity = async (organizationId: string) => {
  const activeJobsCount = await prisma.exportJob.count({
    where: {
      organizationId,
      status: {
        in: [ExportJobStatus.QUEUED, ExportJobStatus.RUNNING],
      },
    },
  });
  if (activeJobsCount >= MAX_ACTIVE_EXPORT_JOBS_PER_ORG) {
    throw new AppError("exportQueueBusy", "TOO_MANY_REQUESTS", 429);
  }
};

export const listExportJobs = async (organizationId: string, input?: ListExportJobsInput) => {
  const take = normalizeListLimit(input?.limit);
  if (input?.storeIds && input.storeIds.length === 0) {
    return [];
  }
  const jobs = await prisma.exportJob.findMany({
    where: {
      organizationId,
      ...(input?.storeId
        ? { storeId: input.storeId }
        : input?.storeIds
          ? { storeId: { in: input.storeIds } }
          : {}),
    },
    orderBy: { createdAt: "desc" },
    take,
  });
  return Promise.all(jobs.map((job) => withDownloadState(job)));
};

export const getExportJob = async (organizationId: string, jobId: string, storeIds?: string[]) => {
  if (storeIds && storeIds.length === 0) {
    return null;
  }
  const job = await prisma.exportJob.findFirst({
    where: {
      id: jobId,
      organizationId,
      ...(storeIds ? { storeId: { in: storeIds } } : {}),
    },
  });
  return job ? withDownloadState(job) : null;
};

export const resolveExportJobDownload = async (input: {
  organizationId: string;
  jobId: string;
  user: StoreAccessUser;
}) => {
  let job = await prisma.exportJob.findFirst({
    where: {
      id: input.jobId,
      organizationId: input.organizationId,
    },
  });
  if (!job) {
    throw new AppError("exportJobNotFound", "NOT_FOUND", 404);
  }
  await assertUserCanAccessStore(prisma, input.user, job.storeId);
  if (job.status !== ExportJobStatus.DONE) {
    throw new AppError("exportNotReady", "CONFLICT", 409);
  }

  let artifact = job.storagePath ? await openExportArtifactStream(job.storagePath) : null;
  if (!artifact) {
    await runExportJob({
      jobId: job.id,
      organizationId: input.organizationId,
      requestId: `export-download-rebuild-${job.id}`,
    });
    job = await prisma.exportJob.findFirst({
      where: {
        id: input.jobId,
        organizationId: input.organizationId,
      },
    });
    artifact = job?.storagePath ? await openExportArtifactStream(job.storagePath) : null;
  }

  if (!job || !artifact || !job.storagePath) {
    throw new AppError("exportFileMissing", "CONFLICT", 410);
  }

  const defaultExtension =
    job.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      ? "xlsx"
      : "csv";

  return {
    job,
    storagePath: job.storagePath,
    fileName: job.fileName ?? `export-${job.id}.${defaultExtension}`,
    mimeType: job.mimeType ?? "text/csv;charset=utf-8",
    fileSize: artifact.fileSize,
    stream: artifact.stream,
  };
};

export const retryExportJob = async (input: {
  organizationId: string;
  jobId: string;
  actorId: string;
  requestId: string;
  storeIds?: string[];
}) => {
  if (input.storeIds && input.storeIds.length === 0) {
    throw new AppError("exportJobNotFound", "NOT_FOUND", 404);
  }
  const job = await prisma.exportJob.findFirst({
    where: {
      id: input.jobId,
      organizationId: input.organizationId,
      ...(input.storeIds ? { storeId: { in: input.storeIds } } : {}),
    },
  });
  if (!job) {
    throw new AppError("exportJobNotFound", "NOT_FOUND", 404);
  }
  if (job.status !== ExportJobStatus.FAILED) {
    throw new AppError("exportRetryUnavailable", "CONFLICT", 409);
  }
  await assertExportQueueCapacity(input.organizationId);

  const updated = await prisma.exportJob.update({
    where: { id: job.id },
    data: {
      status: ExportJobStatus.QUEUED,
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
      errorJson: Prisma.DbNull,
    },
  });

  await writeAuditLog(prisma, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    action: "EXPORT_RETRIED",
    entity: "ExportJob",
    entityId: updated.id,
    before: toJson(job),
    after: toJson(updated),
    requestId: input.requestId,
  });

  if (process.env.NODE_ENV !== "test") {
    void runJob("export-job", {
      jobId: updated.id,
      organizationId: input.organizationId,
      requestId: input.requestId,
    }).catch(() => null);
  }

  return updated;
};

export const requestExport = async (input: ExportRequestInput) => {
  await assertExportQueueCapacity(input.organizationId);
  const format = input.format ?? DEFAULT_EXPORT_FORMAT;
  const store = await prisma.store.findFirst({
    where: { id: input.storeId, organizationId: input.organizationId },
    select: { id: true, name: true, code: true },
  });
  if (!store) {
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  }

  const job = await prisma.exportJob.create({
    data: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      type: input.type,
      status: ExportJobStatus.QUEUED,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      requestedById: input.requestedById,
      paramsJson: {
        schemaVersion: EXPORT_SCHEMA_VERSION,
        type: input.type,
        format,
        storeId: input.storeId,
        periodStart: input.periodStart.toISOString(),
        periodEnd: input.periodEnd.toISOString(),
      },
    },
  });

  await writeAuditLog(prisma, {
    organizationId: input.organizationId,
    actorId: input.requestedById,
    action: "EXPORT_REQUESTED",
    entity: "ExportJob",
    entityId: job.id,
    before: Prisma.DbNull,
    after: toJson(job),
    requestId: input.requestId,
  });

  if (process.env.NODE_ENV !== "test") {
    void runJob("export-job", {
      jobId: job.id,
      organizationId: input.organizationId,
      requestId: input.requestId,
    }).catch(() => null);
  }

  return job;
};

const runExportJob = async (
  payload?: JobPayload,
): Promise<{ job: string; status: "ok" | "skipped"; details?: Record<string, unknown> }> => {
  const jobId =
    payload && typeof payload === "object" && payload !== null && "jobId" in payload
      ? String((payload as Record<string, unknown>).jobId ?? "")
      : "";

  const job = jobId
    ? await prisma.exportJob.findFirst({ where: { id: jobId } })
    : await prisma.exportJob.findFirst({
        where: { status: ExportJobStatus.QUEUED },
        orderBy: { createdAt: "asc" },
      });

  if (!job) {
    return { job: "export-job", status: "skipped", details: { reason: "empty" } };
  }

  const store = await prisma.store.findFirst({
    where: { id: job.storeId, organizationId: job.organizationId },
    select: {
      id: true,
      name: true,
      code: true,
      currencyCode: true,
      currencyRateKgsPerUnit: true,
    },
  });
  if (!store) {
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  }

  const input: ExportRequestInput = {
    organizationId: job.organizationId,
    storeId: job.storeId,
    type: job.type,
    format: readJobFormat(job.paramsJson),
    periodStart: job.periodStart,
    periodEnd: job.periodEnd,
    requestedById: job.requestedById,
    requestId:
      payload && typeof payload === "object" && payload !== null && "requestId" in payload
        ? String((payload as Record<string, unknown>).requestId ?? "")
        : "",
  };

  const running = await prisma.exportJob.update({
    where: { id: job.id },
    data: {
      status: ExportJobStatus.RUNNING,
      startedAt: new Date(),
      errorMessage: null,
      errorJson: Prisma.DbNull,
    },
  });

  try {
    const compliance = await resolveComplianceFlags(input.organizationId, input.storeId);
    const { header, keys, rows } = await buildExportData(input, store, compliance);
    const format = input.format ?? DEFAULT_EXPORT_FORMAT;
    const file = buildExportFile(format, header, keys, rows);
    const fileName = buildFileName(input.type, job.id, format, input.periodStart, input.periodEnd);
    const storagePath = await writeExportArtifact({
      organizationId: input.organizationId,
      jobId: job.id,
      fileName,
      content: file.content,
      mimeType: file.mimeType,
    });

    const updated = await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        status: ExportJobStatus.DONE,
        finishedAt: new Date(),
        fileName,
        mimeType: file.mimeType,
        fileSize: file.content.byteLength,
        storagePath,
      },
    });

    await writeAuditLog(prisma, {
      organizationId: input.organizationId,
      actorId: input.requestedById,
      action: "EXPORT_FINISHED",
      entity: "ExportJob",
      entityId: updated.id,
      before: toJson(running),
      after: toJson(updated),
      requestId: input.requestId,
    });

    return { job: "export-job", status: "ok", details: { jobId: updated.id } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "exportFailed";
    const failed = await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        status: ExportJobStatus.FAILED,
        finishedAt: new Date(),
        errorMessage: message,
        errorJson: toJson({ message }),
      },
    });

    await writeAuditLog(prisma, {
      organizationId: input.organizationId,
      actorId: input.requestedById,
      action: "EXPORT_FAILED",
      entity: "ExportJob",
      entityId: failed.id,
      before: toJson(running),
      after: toJson(failed),
      requestId: input.requestId,
    });

    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("exportFailed", "INTERNAL_SERVER_ERROR", 500);
  }
};

registerJob("export-job", {
  handler: runExportJob,
  maxAttempts: 3,
  baseDelayMs: 1000,
});

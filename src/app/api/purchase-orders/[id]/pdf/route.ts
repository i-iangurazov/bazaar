import PDFDocument from "pdfkit";
import { cookies } from "next/headers";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";

import { prisma } from "@/server/db/prisma";
import { getServerAuthToken } from "@/server/auth/token";
import { getPurchaseOrderStatusLabel, type Translator } from "@/lib/i18n/status";
import { normalizeLocale, toIntlLocale, defaultLocale } from "@/lib/locales";
import { getMessageFromFallback } from "@/lib/i18nFallback";

export const runtime = "nodejs";

const formatCurrency = (amount: number, locale: string) =>
  new Intl.NumberFormat(locale, { style: "currency", currency: "KGS" }).format(amount);

const formatDate = (value: Date, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(value);

type PdfLabels = {
  title: string;
  id: string;
  status: string;
  created: string;
  supplier: string;
  email: string;
  phone: string;
  store: string;
  storeLegalName: string;
  storeLegalType: string;
  storeInn: string;
  storeAddress: string;
  storePhone: string;
  lineItems: string;
  product: string;
  qty: string;
  unit: string;
  cost: string;
  total: string;
};

type MessageTree = Record<string, unknown>;

const loadMessages = async (locale: string) => {
  const filepath = join(process.cwd(), "messages", `${locale}.json`);
  const raw = await readFile(filepath, "utf8");
  return JSON.parse(raw) as MessageTree;
};

const getMessageValue = (messages: MessageTree | undefined, path: string) => {
  if (!messages) {
    return undefined;
  }
  const parts = path.split(".");
  let current: unknown = messages;
  for (const part of parts) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
};

const getMessage = (messages: MessageTree | undefined, key: string) =>
  getMessageValue(messages, key) ?? getMessageFromFallback(key) ?? key;

const createTranslator = (messages: MessageTree | undefined, namespace?: string): Translator => {
  if (!namespace) {
    return (key) => getMessage(messages, key);
  }
  return (key) => getMessage(messages, `${namespace}.${key}`);
};

const getPdfLabels = (tPurchaseOrders: Translator): PdfLabels => ({
  title: tPurchaseOrders("pdf.title"),
  id: tPurchaseOrders("pdf.id"),
  status: tPurchaseOrders("pdf.status"),
  created: tPurchaseOrders("pdf.created"),
  supplier: tPurchaseOrders("pdf.supplier"),
  email: tPurchaseOrders("pdf.email"),
  phone: tPurchaseOrders("pdf.phone"),
  store: tPurchaseOrders("pdf.store"),
  storeLegalName: tPurchaseOrders("pdf.storeLegalName"),
  storeLegalType: tPurchaseOrders("pdf.storeLegalType"),
  storeInn: tPurchaseOrders("pdf.storeInn"),
  storeAddress: tPurchaseOrders("pdf.storeAddress"),
  storePhone: tPurchaseOrders("pdf.storePhone"),
  lineItems: tPurchaseOrders("pdf.lineItems"),
  product: tPurchaseOrders("pdf.product"),
  qty: tPurchaseOrders("pdf.qty"),
  unit: tPurchaseOrders("pdf.unit"),
  cost: tPurchaseOrders("pdf.cost"),
  total: tPurchaseOrders("pdf.total"),
});

const getLegalEntityLabel = (tStores: Translator, value?: string | null) => {
  switch (value) {
    case "IP":
      return tStores("legalTypeIp");
    case "OSOO":
      return tStores("legalTypeOsoo");
    case "AO":
      return tStores("legalTypeAo");
    case "OTHER":
      return tStores("legalTypeOther");
    default:
      return null;
  }
};

export const GET = async (
  _request: Request,
  { params }: { params: { id: string } },
) => {
  const localeCookie = cookies().get("NEXT_LOCALE")?.value;
  const locale = normalizeLocale(localeCookie) ?? defaultLocale;
  let messages: MessageTree | undefined;
  try {
    messages = await loadMessages(locale);
  } catch {
    messages = undefined;
  }
  const tPurchaseOrders = createTranslator(messages, "purchaseOrders");
  const tStores = createTranslator(messages, "stores");
  const tErrors = createTranslator(messages, "errors");
  const tCommon = createTranslator(messages, "common");
  const labels = getPdfLabels(tPurchaseOrders);
  const token = await getServerAuthToken();
  if (!token) {
    return new Response(tErrors("unauthorized"), { status: 401 });
  }
  const intlLocale = toIntlLocale(locale);

  const po = await prisma.purchaseOrder.findFirst({
    where: { id: params.id, organizationId: token.organizationId as string },
    include: {
      supplier: true,
      store: true,
      lines: { include: { product: true, variant: true } },
    },
  });

  if (!po) {
    return new Response(tErrors("poNotFound"), { status: 404 });
  }

  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const fontPath = join(process.cwd(), "assets", "fonts", "NotoSans-Regular.ttf");
  const fallbackPath = join(process.cwd(), "assets", "fonts", "ArialUnicode.ttf");
  const resolvedFont = existsSync(fontPath) ? fontPath : existsSync(fallbackPath) ? fallbackPath : null;
  if (resolvedFont) {
    doc.registerFont("Body", resolvedFont);
    doc.font("Body");
  }
  const body = Readable.toWeb(doc as unknown as Readable) as ReadableStream<Uint8Array>;

  doc.fontSize(18).text(labels.title, { align: "left" });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor("#444");
  doc.text(`${labels.id}: ${po.id}`);
  doc.text(`${labels.status}: ${getPurchaseOrderStatusLabel(tPurchaseOrders, po.status)}`);
  doc.text(`${labels.created}: ${formatDate(po.createdAt, intlLocale)}`);
  doc.moveDown();

  doc.fontSize(11).fillColor("#000");
  doc.text(`${labels.supplier}: ${po.supplier?.name ?? tCommon("supplierUnassigned")}`);
  if (po.supplier?.email) {
    doc.text(`${labels.email}: ${po.supplier.email}`);
  }
  if (po.supplier?.phone) {
    doc.text(`${labels.phone}: ${po.supplier.phone}`);
  }
  doc.text(`${labels.store}: ${po.store.name}`);
  if (po.store.legalName) {
    doc.text(`${labels.storeLegalName}: ${po.store.legalName}`);
  }
  const legalTypeLabel = getLegalEntityLabel(tStores, po.store.legalEntityType);
  if (legalTypeLabel) {
    doc.text(`${labels.storeLegalType}: ${legalTypeLabel}`);
  }
  if (po.store.inn) {
    doc.text(`${labels.storeInn}: ${po.store.inn}`);
  }
  if (po.store.address) {
    doc.text(`${labels.storeAddress}: ${po.store.address}`);
  }
  if (po.store.phone) {
    doc.text(`${labels.storePhone}: ${po.store.phone}`);
  }

  doc.moveDown();
  doc.fontSize(12).text(labels.lineItems, { underline: true });
  doc.moveDown(0.5);

  const tableTop = doc.y;
  const colX = [40, 240, 330, 400, 470];
  const drawTableHeader = (y: number) => {
    doc.fontSize(10).text(labels.product, colX[0], y);
    doc.text(labels.qty, colX[1], y);
    doc.text(labels.unit, colX[2], y);
    doc.text(labels.cost, colX[3], y, { width: 60, align: "right" });
    doc.text(labels.total, colX[4], y, { width: 60, align: "right" });
  };

  drawTableHeader(tableTop);

  let total = 0;
  let y = tableTop + 16;

  for (const line of po.lines) {
    const lineTotal = (line.unitCost ? Number(line.unitCost) : 0) * line.qtyOrdered;
    total += lineTotal;

    const name = `${line.product.name}${line.variant?.name ? ` (${line.variant.name})` : ""}`;
    const nameHeight = doc.heightOfString(name, { width: 180 });
    const rowHeight = Math.max(16, nameHeight + 2);

    if (y + rowHeight > doc.page.height - doc.page.margins.bottom - 60) {
      doc.addPage();
      const nextTableTop = doc.page.margins.top;
      drawTableHeader(nextTableTop);
      y = nextTableTop + 16;
    }

    doc.text(name, colX[0], y, { width: 180 });
    doc.text(String(line.qtyOrdered), colX[1], y);
    doc.text(line.product.unit, colX[2], y);
    doc.text(formatCurrency(line.unitCost ? Number(line.unitCost) : 0, intlLocale), colX[3], y, {
      width: 60,
      align: "right",
    });
    doc.text(formatCurrency(lineTotal, intlLocale), colX[4], y, { width: 60, align: "right" });
    y += rowHeight;
  }

  doc.y = y + 12;
  doc.fontSize(12).text(`${labels.total}: ${formatCurrency(total, intlLocale)}`, {
    align: "right",
  });

  doc.end();
  return new Response(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename=\"po-${po.id}.pdf\"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
};

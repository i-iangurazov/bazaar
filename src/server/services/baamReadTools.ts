import { z } from "zod";
import { helpGuides, helpGuideId, getHelpGuideById } from "@/content/help/catalog";
import { prisma } from "@/server/db/prisma";
import type { Context } from "@/server/trpc/trpc";
import { baamAccess, baamJson } from "./baamConversations";
import { businessCaller } from "./baamBusiness";
import { getBaamSalesMetrics } from "./baamMetrics";
import { assertFeatureEnabled } from "./planLimits";
import { AppError } from "./errors";

export const baamSearchSchema = z
  .object({
    kind: z.enum([
      "stores",
      "products",
      "units",
      "attributes",
      "customers",
      "suppliers",
      "registers",
      "sales",
      "orders",
      "purchases",
      "stock_counts",
      "returns",
    ]),
    query: z.string().trim().max(160).optional(),
    storeId: z.string().max(100).optional(),
    offset: z.number().int().min(0).max(1000).default(0),
  })
  .strict();
export async function baamSearch(ctx: Context, input: z.infer<typeof baamSearchSchema>) {
  const { scope, ctx: fresh } = await baamAccess(ctx, input.storeId);
  const organizationId = scope.organizationId;
  const feature = ["registers", "sales", "returns"].includes(input.kind)
    ? "pos"
    : input.kind === "orders"
      ? "customerOrders"
      : input.kind === "stock_counts"
        ? "stockCounts"
        : undefined;
  if (feature) await assertFeatureEnabled({ organizationId, feature });
  const storeIds = input.storeId ? [input.storeId] : scope.storeIds;
  const storeId = { in: storeIds };
  const contains = { contains: input.query ?? "", mode: "insensitive" as const };
  const page = { take: 21, skip: input.offset };
  const api = businessCaller(fresh);
  let items: unknown[];
  switch (input.kind) {
    case "stores":
      items = scope.availableStores.filter(
        (s) => !input.query || s.name.toLocaleLowerCase().includes(input.query.toLocaleLowerCase()),
      );
      break;
    case "units":
      items = await prisma.unit.findMany({
        where: {
          organizationId,
          OR: [{ code: contains }, { labelRu: contains }, { labelKg: contains }],
        },
        select: { id: true, code: true, labelRu: true, labelKg: true },
        ...page,
        orderBy: { id: "asc" },
      });
      break;
    case "attributes":
      items = await prisma.attributeDefinition.findMany({
        where: { organizationId, isActive: true },
        select: {
          key: true,
          type: true,
          labelRu: true,
          labelKg: true,
          required: true,
          optionsRu: true,
          optionsKg: true,
        },
        ...page,
        orderBy: { id: "asc" },
      });
      break;
    case "products":
      items = await prisma.product.findMany({
        where: {
          organizationId,
          isDeleted: false,
          ...(input.storeId || (scope.role !== "ADMIN" && !scope.isOrgOwner)
            ? { storeProducts: { some: { storeId, isActive: true } } }
            : {}),
          OR: [{ name: contains }, { sku: contains }, { barcodes: { some: { value: contains } } }],
        },
        select: {
          id: true,
          name: true,
          sku: true,
          baseUnitId: true,
          unit: true,
          basePriceKgs: true,
          variants: {
            where: { isActive: true },
            select: { id: true, name: true, sku: true, attributes: true },
          },
          storeProducts: { where: { storeId, isActive: true }, select: { storeId: true } },
        },
        ...page,
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
      break;
    case "customers":
      items = await prisma.customer.findMany({
        where: {
          organizationId,
          storeId,
          deletedAt: null,
          OR: [{ name: contains }, { phone: contains }, { email: contains }],
        },
        select: { id: true, name: true, phone: true, email: true, storeId: true },
        ...page,
        orderBy: { id: "asc" },
      });
      break;
    case "suppliers":
      items = await prisma.supplier.findMany({
        where: { organizationId, OR: [{ name: contains }, { phone: contains }] },
        select: { id: true, name: true, phone: true, email: true },
        ...page,
        orderBy: { id: "asc" },
      });
      break;
    case "registers":
      items = await api.pos.registers.list({ storeId: input.storeId, status: "active" });
      break;
    case "orders":
    case "sales":
      items = await prisma.customerOrder.findMany({
        where: {
          organizationId,
          storeId,
          isPosSale: input.kind === "sales",
          OR: [{ number: contains }, { customerName: contains }],
        },
        select: {
          id: true,
          number: true,
          status: true,
          storeId: true,
          registerId: true,
          customerName: true,
          totalKgs: true,
          createdAt: true,
          isHeld: true,
        },
        ...page,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      break;
    case "purchases":
      items = await prisma.purchaseOrder.findMany({
        where: {
          organizationId,
          storeId,
          ...(input.query ? { supplier: { name: contains } } : {}),
        },
        select: {
          id: true,
          status: true,
          storeId: true,
          supplier: { select: { name: true } },
          createdAt: true,
        },
        ...page,
        orderBy: { id: "desc" },
      });
      break;
    case "stock_counts":
      items = await prisma.stockCount.findMany({
        where: { organizationId, storeId, code: contains },
        select: { id: true, code: true, storeId: true, status: true, createdAt: true },
        ...page,
        orderBy: { id: "desc" },
      });
      break;
    case "returns":
      items = await prisma.saleReturn.findMany({
        where: { organizationId, storeId, number: contains },
        select: {
          id: true,
          number: true,
          storeId: true,
          status: true,
          originalSaleId: true,
          totalKgs: true,
          createdAt: true,
        },
        ...page,
        orderBy: { id: "desc" },
      });
      break;
  }
  return baamJson({
    items: items.slice(0, 20),
    nextOffset: items.length > 20 ? input.offset + 20 : null,
    scope: { organizationId, storeIds },
    found: items.length > 0,
  });
}

export const baamInspectSchema = z
  .object({
    kind: z.enum([
      "product",
      "stock",
      "sale",
      "order",
      "purchase",
      "return",
      "register",
      "count",
      "shift",
    ]),
    id: z.string().min(1),
    storeId: z.string().optional(),
  })
  .strict();
export async function baamInspect(ctx: Context, input: z.infer<typeof baamInspectSchema>) {
  const { scope, ctx: fresh } = await baamAccess(ctx, input.storeId);
  const api = businessCaller(fresh);
  switch (input.kind) {
    case "shift":
      return baamJson(await api.pos.shifts.xReport({ shiftId: input.id }));
    case "count":
      return baamJson(await api.counts.get({ stockCountId: input.id }));
    case "sale":
      return baamJson(await api.pos.sales.get({ saleId: input.id }));
    case "order":
      return baamJson(await api.orders.getById({ customerOrderId: input.id }));
    case "purchase":
      return baamJson(await api.purchases.getById({ id: input.id }));
    case "return":
      return baamJson(await api.pos.returns.get({ saleReturnId: input.id }));
    case "register": {
      const register = await prisma.posRegister.findFirst({
        where: {
          id: input.id,
          organizationId: scope.organizationId,
          storeId: { in: scope.storeIds },
        },
        select: {
          id: true,
          storeId: true,
          name: true,
          shifts: { where: { status: "OPEN" }, select: { id: true, openedAt: true }, take: 1 },
        },
      });
      if (!register) throw new AppError("posRegisterNotFound", "NOT_FOUND", 404);
      return baamJson({
        ...register,
        activeDraft: await api.pos.sales.activeDraft({ registerId: register.id }),
      });
    }
    case "product":
    case "stock": {
      const product = await prisma.product.findFirst({
        where: {
          id: input.id,
          organizationId: scope.organizationId,
          isDeleted: false,
          ...(scope.role === "ADMIN" || scope.isOrgOwner
            ? {}
            : { storeProducts: { some: { storeId: { in: scope.storeIds }, isActive: true } } }),
        },
        select: {
          id: true,
          name: true,
          sku: true,
          unit: true,
          baseUnitId: true,
          basePriceKgs: true,
          photoUrl: true,
          updatedAt: true,
          variants: {
            where: { isActive: true },
            select: { id: true, name: true, sku: true, attributes: true },
          },
        },
      });
      if (!product) throw new AppError("productNotFound", "NOT_FOUND", 404);
      const snapshots = await prisma.inventorySnapshot.findMany({
        where: {
          store: { organizationId: scope.organizationId },
          productId: product.id,
          storeId: { in: input.storeId ? [input.storeId] : scope.storeIds },
        },
        select: { storeId: true, variantId: true, onHand: true, version: true, updatedAt: true },
      });
      return baamJson({
        product,
        snapshots,
        semantics:
          "onHand is physical stock in base units, may be negative. No matching snapshot means no recorded snapshot, not proof of a zero opening quantity.",
      });
    }
  }
}
export const baamReportSchema = z
  .object({
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    storeId: z.string().optional(),
  })
  .strict();
export async function baamReport(ctx: Context, input: z.infer<typeof baamReportSchema>) {
  await baamAccess(ctx, input.storeId);
  return baamJson(await getBaamSalesMetrics({ ...input, actorId: ctx.user!.id }));
}

export const baamNavigation = [
  {
    key: "products",
    href: "/products",
    description: "Products, variants, units, photos, prices, CSV import and export",
  },
  {
    key: "inventory",
    href: "/inventory",
    description: "Physical stock, receiving, write-offs, transfers and stock movement journal",
  },
  { key: "pos", href: "/pos", description: "Registers, shifts, sales, payments and returns" },
  {
    key: "purchases",
    href: "/purchase-orders",
    description: "Purchase orders: draft, submit, approve, receive and cancel",
  },
  { key: "orders", href: "/sales/orders", description: "Customer orders and fulfilment" },
  { key: "customers", href: "/customers", description: "Customer contacts and purchase history" },
  { key: "suppliers", href: "/suppliers", description: "Suppliers and contact details" },
  {
    key: "reports",
    href: "/reports/analytics",
    description: "Sales reports by actual completed receipts, returns and payment methods",
  },
  {
    key: "counts",
    href: "/inventory/counts",
    description: "Stock counts: scan, count, review differences and apply",
  },
  {
    key: "help",
    href: "/help",
    description: "Instructions for all supported application workflows",
  },
] as const;

export const baamHelpSchema = z
  .object({
    guideId: z.string().max(160).optional(),
    page: z.string().max(180).optional(),
    query: z.string().max(160).optional(),
  })
  .strict();
export async function baamHelp(
  ctx: Context,
  input: z.infer<typeof baamHelpSchema>,
  locale: string,
) {
  await baamAccess(ctx);
  const language = locale === "kg" || locale === "en" ? locale : "ru";
  if (input.guideId) {
    const guide = getHelpGuideById(input.guideId);
    if (!guide) throw new AppError("notFound", "NOT_FOUND", 404);
    return {
      title: guide.title[language],
      summary: guide.summary[language],
      steps: guide.steps.map((s) => ({
        title: s.title[language],
        body: s.body[language],
        note: s.note?.[language],
        checklist: s.checklist?.map((t) => t[language]),
      })),
      success: guide.success[language],
      href: `/help/${helpGuideId(guide)}`,
    };
  }
  const query = input.query?.toLocaleLowerCase();
  return helpGuides
    .filter(
      (g) =>
        (!query ||
          [g.title, g.summary, g.keywords, g.aliases].some((field) =>
            Object.values(field).some((value) => value.toLocaleLowerCase().includes(query)),
          )) &&
        (!input.page || input.page.startsWith(g.appRoute) || g.appRoute.startsWith(input.page)),
    )
    .slice(0, 8)
    .map((g) => ({
      id: helpGuideId(g),
      title: g.title[language],
      summary: g.summary[language],
      href: `/help/${helpGuideId(g)}`,
    }));
}

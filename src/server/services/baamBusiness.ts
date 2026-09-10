import { z } from "zod";
import { PosPaymentMethod } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { Context } from "@/server/trpc/trpc";
import { productsRouter } from "@/server/trpc/routers/products";
import { inventoryRouter } from "@/server/trpc/routers/inventory";
import { suppliersRouter } from "@/server/trpc/routers/suppliers";
import { customersRouter } from "@/server/trpc/routers/customers";
import { purchaseOrdersRouter } from "@/server/trpc/routers/purchaseOrders";
import { salesOrdersRouter } from "@/server/trpc/routers/salesOrders";
import { posRouter } from "@/server/trpc/routers/pos";
import { stockCountsRouter } from "@/server/trpc/routers/stockCounts";
import { createProductInputSchema } from "@/server/trpc/routers/products.schemas";
import { WRITE_OFF_REASONS } from "@/lib/inventory/writeOff";
import { baamText, type BaamActionSummary, type BaamActionResult } from "@/lib/baam/companion";
import { baamAccess, type BaamAccess } from "./baamConversations";
import { AppError } from "./errors";

export const businessCaller = (ctx: Context) => ({
  products: productsRouter.createCaller(ctx),
  inventory: inventoryRouter.createCaller(ctx),
  suppliers: suppliersRouter.createCaller(ctx),
  customers: customersRouter.createCaller(ctx),
  purchases: purchaseOrdersRouter.createCaller(ctx),
  orders: salesOrdersRouter.createCaller(ctx),
  pos: posRouter.createCaller(ctx),
  counts: stockCountsRouter.createCaller(ctx),
});
export type BusinessCaller = ReturnType<typeof businessCaller>;
export type PreparedAction = {
  input: unknown;
  summary: BaamActionSummary;
  storeIds: string[];
  reviews?: { entity: string; id: string; updatedAt: string }[];
};
export type PrepareContext = BaamAccess & { conversationId: string; locale: string };
export type ExecutionStep = (
  name: string,
  audits: readonly string[],
  run: (caller: BusinessCaller, key: string) => Promise<unknown>,
) => Promise<unknown>;
export type ActionExecution = { step: ExecutionStep; ctx: Context; locale: string };
export type BusinessAction = {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  roles: readonly string[];
  prepare: (ctx: PrepareContext, input: unknown) => Promise<PreparedAction>;
  execute: (ctx: ActionExecution, input: unknown) => Promise<BaamActionResult>;
};
export const baamActions: Record<string, BusinessAction> = {};
const id = z.string().min(1).max(100);
const text = z.string().trim().min(1).max(1000);
const qty = z.number().int().positive().max(2147483647);
const money = z.number().min(0).max(100000000);
const productRef = z.object({ productId: id, variantId: id.nullable().optional() }).strict();
const quantityLine = productRef.extend({ qty });
const saleLines = z.array(quantityLine).min(1).max(40);
const contact = z
  .object({
    name: z.string().trim().min(2).max(180),
    email: z.string().email().optional(),
    phone: z.string().max(80).optional(),
  })
  .strict();
const payment = z
  .object({ method: z.nativeEnum(PosPaymentMethod), amountKgs: money.positive() })
  .strict();
const attributePairs = z
  .array(
    z
      .object({ key: text, value: z.union([z.string().max(500), z.number(), z.boolean()]) })
      .strict(),
  )
  .max(20);
const paymentLabel = (locale: string, method: PosPaymentMethod) => {
  const names = {
    CASH: ["Наличные", "Cash", "Накталай"],
    CARD: ["Карта", "Card", "Карта"],
    TRANSFER: ["Перевод", "Transfer", "Которуу"],
    OTHER: ["Другой способ", "Other method", "Башка ыкма"],
  };
  const [ru, en, kg] = names[method];
  return baamText(locale, ru, en, kg);
};
const title = (c: { locale: string }, ru: string, en: string, kg: string) =>
  baamText(c.locale, ru, en, kg);

function defineAction<S extends z.ZodTypeAny, P>(config: {
  name: string;
  description: string;
  schema: S;
  roles?: readonly string[];
  prepare: (
    ctx: PrepareContext,
    input: z.output<S>,
  ) => Promise<{
    input: P;
    summary: BaamActionSummary;
    storeIds: string[];
    reviews?: PreparedAction["reviews"];
  }>;
  execute: (ctx: ActionExecution, input: P) => Promise<BaamActionResult>;
}) {
  baamActions[config.name] = {
    ...config,
    roles: config.roles ?? ["ADMIN", "MANAGER"],
    prepare: (ctx, value) => config.prepare(ctx, config.schema.parse(value)),
    // P is written exclusively by this adapter, read from an owned immutable DB action.
    execute: (ctx, value) => config.execute(ctx, value as P),
  };
}

export async function baamStore(ctx: PrepareContext, storeId: string) {
  const store = ctx.scope.availableStores.find((s) => s.id === storeId);
  if (!store) throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
  return store;
}
export async function baamProduct(
  ctx: PrepareContext,
  productId: string,
  variantId?: string | null,
  storeId?: string,
) {
  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      organizationId: ctx.scope.organizationId,
      isDeleted: false,
      ...(storeId
        ? { storeProducts: { some: { storeId, isActive: true } } }
        : ctx.scope.role === "ADMIN" || ctx.scope.isOrgOwner
          ? {}
          : { storeProducts: { some: { storeId: { in: ctx.scope.storeIds }, isActive: true } } }),
    },
    include: { variants: { where: { isActive: true } }, baseUnit: true },
  });
  if (!product) throw new AppError("productNotFound", "NOT_FOUND", 404);
  const variant = variantId ? product.variants.find((v) => v.id === variantId) : null;
  if (variantId && !variant) throw new AppError("variantNotFound", "NOT_FOUND", 404);
  if (!variantId && product.variants.length)
    throw new AppError("variantRequired", "BAD_REQUEST", 400);
  return {
    product,
    label: `${product.name}${variant ? ` · ${variant.name ?? variant.sku}` : ""} (${product.sku})`,
  };
}
async function lineDetails(
  ctx: PrepareContext,
  storeId: string,
  lines: { productId: string; variantId?: string | null; qty: number }[],
) {
  const keys = lines.map((l) => `${l.productId}:${l.variantId ?? "BASE"}`);
  if (new Set(keys).size !== keys.length)
    throw new AppError("baamDuplicateLines", "BAD_REQUEST", 400);
  return Promise.all(
    lines.map(async (l) => {
      const p = await baamProduct(ctx, l.productId, l.variantId, storeId);
      return `${p.label} — ${l.qty} ${p.product.baseUnit?.code ?? p.product.unit}`;
    }),
  );
}
const result = (summary: BaamActionSummary, resourceId?: string): BaamActionResult => ({
  title: summary.title,
  details: summary.details,
  href: summary.href ?? "/inventory",
  ...(resourceId ? { resourceId } : {}),
});
export function resultId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  // These are the actual domain response envelopes, never provider output.
  for (const key of [
    "id",
    "productId",
    "customerId",
    "saleId",
    "purchaseOrderId",
    "customerOrderId",
    "saleReturnId",
    "stockCountId",
    "shiftId",
  ]) {
    if (typeof record[key] === "string") return record[key];
  }
  return record.customer ? resultId(record.customer) : undefined;
}

const productCreate = createProductInputSchema
  .omit({
    idempotencyKey: true,
    photoUrl: true,
    images: true,
    variants: true,
    packs: true,
    bundleComponents: true,
  })
  .extend({
    name: z.string().trim().min(2).max(180),
    storeId: id,
    imageChoice: z.enum(["without_photo", "attached_photo"]),
    attachmentId: id.optional(),
    variants: z
      .array(
        z
          .object({
            name: text,
            sku: z.string().min(2).max(100).optional(),
            attributes: attributePairs.optional(),
            storePriceKgs: money.optional(),
          })
          .strict(),
      )
      .max(40)
      .optional(),
    bundleComponents: z
      .array(z.object({ componentProductId: id, componentVariantId: id.optional(), qty }).strict())
      .max(40)
      .optional(),
    packs: z
      .array(
        z
          .object({
            packName: text,
            packBarcode: z.string().max(100).optional(),
            multiplierToBase: qty,
            allowInPurchasing: z.boolean().optional(),
            allowInReceiving: z.boolean().optional(),
          })
          .strict(),
      )
      .max(10)
      .optional(),
  })
  .strict();
defineAction({
  name: "product_create",
  description:
    "Create a product in a chosen store. Ask for required name and unit and offer photo upload or no photo. Use unit IDs from search. Initial stock >0 requires ADMIN; receiving is available to MANAGER. Never invent price, attributes or quantities.",
  schema: productCreate,
  async prepare(c, input) {
    const store = await baamStore(c, input.storeId);
    if ((input.initialOnHand ?? 0) > 0 && c.scope.role !== "ADMIN")
      throw new AppError("inventoryAdminRequired", "FORBIDDEN", 403);
    const unit = await prisma.unit.findFirst({
      where: { id: input.baseUnitId, organizationId: c.scope.organizationId },
    });
    if (!unit) throw new AppError("unitNotFound", "NOT_FOUND", 404);
    if (
      input.supplierId &&
      !(await prisma.supplier.count({
        where: { id: input.supplierId, organizationId: c.scope.organizationId },
      }))
    )
      throw new AppError("supplierNotFound", "NOT_FOUND", 404);
    const attachment = input.attachmentId
      ? await prisma.baamAttachment.findFirst({
          where: { id: input.attachmentId, conversationId: c.conversationId },
        })
      : null;
    if (input.imageChoice === "attached_photo" && !attachment)
      throw new AppError("baamAttachmentRequired", "BAD_REQUEST", 400);
    const { imageChoice, attachmentId: _attachmentId, ...fields } = input;
    void _attachmentId;
    for (const component of fields.bundleComponents ?? [])
      await baamProduct(c, component.componentProductId, component.componentVariantId, store.id);
    const data = {
      ...fields,
      variants: fields.variants?.map((v) => ({
        ...v,
        attributes: v.attributes
          ? Object.fromEntries(v.attributes.map((a) => [a.key, a.value]))
          : undefined,
      })),
      ...(imageChoice === "attached_photo" && attachment ? { photoUrl: attachment.url } : {}),
    };
    const summary = {
      title: title(c, "Создать товар", "Create product", "Товар түзүү"),
      details: [
        input.name,
        store.name,
        unit.code,
        ...(input.basePriceKgs !== undefined ? [`${input.basePriceKgs} KGS`] : []),
        ...(input.initialOnHand !== undefined
          ? [
              `${title(c, "Начальный остаток", "Opening stock", "Баштапкы калдык")}: ${input.initialOnHand}`,
            ]
          : []),
        title(
          c,
          imageChoice === "without_photo" ? "Без фотографии" : "С фотографией",
          imageChoice === "without_photo" ? "Without photo" : "With photo",
          imageChoice === "without_photo" ? "Сүрөтсүз" : "Сүрөт менен",
        ),
        ...(input.variants?.map((v) => v.name) ?? []),
      ],
      href: "/products",
    };
    return { input: { data, summary }, summary, storeIds: [store.id] };
  },
  async execute(c, p) {
    const created = await c.step("create", ["PRODUCT_CREATE"], (api, key) =>
      api.products.create({ ...p.data, idempotencyKey: key }),
    );
    const productId = resultId(created);
    return {
      ...result(p.summary, productId),
      href: productId ? `/products/${productId}` : "/products",
    };
  },
});

defineAction({
  name: "product_assign_store",
  description: "Assign existing products to a store, without changing stock.",
  schema: z.object({ storeId: id, productIds: z.array(id).min(1).max(40) }).strict(),
  async prepare(c, data) {
    const store = await baamStore(c, data.storeId);
    const products = await prisma.product.findMany({
      where: {
        id: { in: data.productIds },
        organizationId: c.scope.organizationId,
        isDeleted: false,
        ...(c.scope.role === "ADMIN" || c.scope.isOrgOwner
          ? {}
          : { storeProducts: { some: { storeId: { in: c.scope.storeIds }, isActive: true } } }),
      },
    });
    if (products.length !== new Set(data.productIds).size)
      throw new AppError("productNotFound", "NOT_FOUND", 404);
    const summary = {
      title: title(
        c,
        "Добавить товары в магазин",
        "Assign products to store",
        "Товарларды дүкөнгө кошуу",
      ),
      details: [store.name, ...products.map((p) => p.name)],
      href: "/products",
    };
    return { input: { data, summary }, summary, storeIds: [store.id] };
  },
  async execute(c, p) {
    await c.step("assign", ["PRODUCT_STORE_ASSIGN"], (api) => api.products.assignToStore(p.data));
    return result(p.summary);
  },
});

defineAction({
  name: "product_update",
  description:
    "Update only specified product fields, preserving all others. Photos use owned attachments. addVariants adds variants without removing existing ones; search attributes first. Server rejects changes since the review. Stock changes must use stock actions, not this tool.",
  schema: z
    .object({
      productId: id,
      storeId: id.optional(),
      name: z.string().min(2).max(180).optional(),
      sku: z.string().min(2).max(100).optional(),
      baseUnitId: id.optional(),
      basePriceKgs: money.optional(),
      description: z.string().max(4000).optional(),
      categories: z.array(text).max(20).optional(),
      barcodes: z.array(z.string().min(1).max(100)).max(20).optional(),
      photo: z.enum(["keep", "remove", "attach"]).default("keep"),
      attachmentId: id.optional(),
      addVariants: z
        .array(
          z
            .object({
              name: text,
              sku: z.string().min(2).max(100).optional(),
              attributes: attributePairs.optional(),
              storePriceKgs: money.optional(),
            })
            .strict(),
        )
        .max(20)
        .optional(),
    })
    .strict(),
  async prepare(c, input) {
    if (input.storeId) await baamStore(c, input.storeId);
    const product = await prisma.product.findFirst({
      where: {
        id: input.productId,
        organizationId: c.scope.organizationId,
        isDeleted: false,
        ...(c.scope.role === "ADMIN" || c.scope.isOrgOwner
          ? {}
          : { storeProducts: { some: { storeId: { in: c.scope.storeIds }, isActive: true } } }),
      },
      include: {
        images: true,
        barcodes: true,
        variants: { where: { isActive: true } },
        storeProducts: { where: { isActive: true, storeId: { in: c.scope.storeIds } } },
      },
    });
    if (!product) throw new AppError("productNotFound", "NOT_FOUND", 404);
    const attachment = input.attachmentId
      ? await prisma.baamAttachment.findFirst({
          where: { id: input.attachmentId, conversationId: c.conversationId },
        })
      : null;
    if (input.photo === "attach" && !attachment)
      throw new AppError("baamAttachmentRequired", "BAD_REQUEST", 400);
    if (
      input.baseUnitId &&
      !(await prisma.unit.count({
        where: { id: input.baseUnitId, organizationId: c.scope.organizationId },
      }))
    )
      throw new AppError("unitNotFound", "NOT_FOUND", 404);
    const data = {
      productId: product.id,
      storeId: input.storeId,
      sku: input.sku ?? product.sku,
      name: input.name ?? product.name,
      baseUnitId: input.baseUnitId ?? product.baseUnitId,
      basePriceKgs:
        input.basePriceKgs ??
        (product.basePriceKgs === null ? undefined : Number(product.basePriceKgs)),
      categories: input.categories ?? product.categories,
      description: input.description ?? product.description ?? undefined,
      supplierId: product.supplierId,
      barcodes: input.barcodes ?? product.barcodes.map((b) => b.value),
      photoUrl:
        input.photo === "attach"
          ? attachment!.url
          : input.photo === "keep"
            ? (product.photoUrl ?? undefined)
            : undefined,
      images:
        input.photo === "remove"
          ? []
          : input.photo === "attach"
            ? [{ url: attachment!.url }, ...product.images.map((i) => ({ id: i.id, url: i.url }))]
            : product.images.map((i) => ({ id: i.id, url: i.url })),
      variants: input.addVariants
        ? [
            ...product.variants.map((v) => ({
              id: v.id,
              name: v.name ?? undefined,
              sku: v.sku ?? undefined,
              imageId: v.imageId,
              attributes: v.attributes as Record<string, unknown>,
            })),
            ...input.addVariants.map((v) => ({
              ...v,
              attributes: v.attributes
                ? Object.fromEntries(v.attributes.map((a) => [a.key, a.value]))
                : undefined,
            })),
          ]
        : undefined,
    };
    const summary = {
      title: title(c, "Изменить товар", "Update product", "Товарды өзгөртүү"),
      details: [
        product.name,
        ...(input.name ? [input.name] : []),
        ...(input.sku ? [input.sku] : []),
        ...(input.basePriceKgs !== undefined ? [`${input.basePriceKgs} KGS`] : []),
        ...(input.description !== undefined ? [input.description] : []),
        ...(input.categories ?? []),
        ...(input.barcodes ?? []),
        ...(input.addVariants?.map((v) => v.name) ?? []),
        ...(input.photo === "remove"
          ? [title(c, "Удалить фотографию", "Remove photo", "Сүрөттү өчүрүү")]
          : input.photo === "attach"
            ? [attachment!.name]
            : []),
      ],
      href: `/products/${product.id}`,
    };
    return {
      input: { data, summary },
      summary,
      storeIds: input.storeId ? [input.storeId] : product.storeProducts.map((s) => s.storeId),
      reviews: [{ entity: "Product", id: product.id, updatedAt: product.updatedAt.toISOString() }],
    };
  },
  async execute(c, p) {
    await c.step("update", ["PRODUCT_UPDATE"], (api) => api.products.update(p.data));
    return result(p.summary, p.data.productId);
  },
});

defineAction({
  name: "stock_receive",
  description:
    "Post a stock receiving document. Each line needs product, variant when present, positive integer quantity in base units and explicit unit cost (zero is allowed). One document with all lines.",
  schema: z
    .object({
      storeId: id,
      supplierName: z.string().max(160).optional(),
      note: z.string().max(1000).optional(),
      referenceNumber: z.string().max(80).optional(),
      date: z.string().datetime().optional(),
      lines: z
        .array(productRef.extend({ quantity: qty, unitCost: money }))
        .min(1)
        .max(40),
    })
    .strict(),
  async prepare(c, data) {
    const store = await baamStore(c, data.storeId);
    const details = await lineDetails(
      c,
      store.id,
      data.lines.map((l) => ({ ...l, qty: l.quantity })),
    );
    const summary = {
      title: title(c, "Оприходовать товары", "Receive stock", "Товарларды кириштөө"),
      details: [
        store.name,
        ...details.map((s, i) => `${s} × ${data.lines[i].unitCost} KGS`),
        ...(data.supplierName ? [data.supplierName] : []),
        ...(data.note ? [data.note] : []),
      ],
      href: "/inventory",
    };
    return { input: { data, summary }, summary, storeIds: [store.id] };
  },
  async execute(c, p) {
    await c.step("receive", ["INVENTORY_RECEIVE"], (api, key) =>
      api.inventory.postStockReceiving({ ...p.data, idempotencyKey: key }),
    );
    return result(p.summary);
  },
});
defineAction({
  name: "stock_adjust",
  description:
    "Adjust stock by a signed nonzero delta in base units. Requires a reason. Distinguish delta from absolute stock.",
  schema: productRef.extend({
    storeId: id,
    qtyDelta: z
      .number()
      .int()
      .refine((n) => n !== 0),
    reason: z.string().min(3).max(500),
  }),
  async prepare(c, data) {
    const store = await baamStore(c, data.storeId);
    const p = await baamProduct(c, data.productId, data.variantId, store.id);
    const summary = {
      title: title(c, "Скорректировать остаток", "Adjust stock", "Калдыкты өзгөртүү"),
      details: [
        store.name,
        p.label,
        `${data.qtyDelta > 0 ? "+" : ""}${data.qtyDelta}`,
        data.reason,
      ],
      href: "/inventory",
    };
    return { input: { data, summary }, summary, storeIds: [store.id] };
  },
  async execute(c, p) {
    await c.step("adjust", ["INVENTORY_ADJUST"], (api, key) =>
      api.inventory.adjust({
        ...p.data,
        variantId: p.data.variantId ?? undefined,
        idempotencyKey: key,
      }),
    );
    return result(p.summary);
  },
});
defineAction({
  name: "stock_set",
  description:
    "Set a NEW ABSOLUTE stock quantity with a reason. Server snapshots current quantity and version; any intervening sale/adjustment causes a conflict, never a silent overwrite.",
  schema: productRef.extend({
    storeId: id,
    targetOnHand: z.number().int().min(-2147483648).max(2147483647),
    reason: z.string().min(3).max(500),
  }),
  async prepare(c, input) {
    const store = await baamStore(c, input.storeId);
    const p = await baamProduct(c, input.productId, input.variantId, store.id);
    const snapshot = await prisma.inventorySnapshot.findFirst({
      where: {
        storeId: store.id,
        productId: input.productId,
        variantKey: input.variantId ?? "BASE",
        store: { organizationId: c.scope.organizationId },
      },
    });
    if ((snapshot?.onHand ?? 0) === input.targetOnHand)
      throw new AppError("baamAlreadyCurrent", "CONFLICT", 409);
    const data = {
      ...input,
      expectedOnHand: snapshot?.onHand ?? 0,
      expectedVersion: snapshot?.version ?? 0,
    };
    const summary = {
      title: title(c, "Установить остаток", "Set stock quantity", "Калдыкты белгилөө"),
      details: [store.name, p.label, `${data.expectedOnHand} → ${data.targetOnHand}`, data.reason],
      href: "/inventory",
    };
    return { input: { data, summary }, summary, storeIds: [store.id] };
  },
  async execute(c, p) {
    await c.step("set", ["INVENTORY_SET_ON_HAND"], (api, key) =>
      api.inventory.setOnHand({ ...p.data, idempotencyKey: key }),
    );
    return result(p.summary);
  },
});
defineAction({
  name: "stock_write_off",
  description: "Post a write-off with selected reason and base-unit quantities.",
  schema: z
    .object({
      storeId: id,
      reason: z.enum(WRITE_OFF_REASONS),
      comment: z.string().max(1000).optional(),
      lines: saleLines,
    })
    .strict(),
  async prepare(c, data) {
    const store = await baamStore(c, data.storeId);
    const summary = {
      title: title(c, "Списать товары", "Write off stock", "Товарларды эсептен чыгаруу"),
      details: [
        store.name,
        ...(await lineDetails(c, store.id, data.lines)),
        data.reason,
        ...(data.comment ? [data.comment] : []),
      ],
      href: "/inventory",
    };
    return { input: { data, summary }, summary, storeIds: [store.id] };
  },
  async execute(c, p) {
    await c.step("write-off", ["INVENTORY_WRITE_OFF"], (api, key) =>
      api.inventory.postStockWriteOff({ ...p.data, idempotencyKey: key }),
    );
    return result(p.summary);
  },
});
defineAction({
  name: "stock_transfer",
  description:
    "Transfer products between two accessible stores in one document. Require both stores and exact base-unit quantities.",
  schema: z
    .object({
      fromStoreId: id,
      toStoreId: id,
      lines: saleLines,
      note: z.string().max(1000).optional(),
    })
    .strict(),
  async prepare(c, data) {
    const from = await baamStore(c, data.fromStoreId),
      to = await baamStore(c, data.toStoreId);
    if (from.id === to.id) throw new AppError("transferSameStore", "BAD_REQUEST", 400);
    const summary = {
      title: title(c, "Переместить товары", "Transfer stock", "Товарларды которуу"),
      details: [
        `${from.name} → ${to.name}`,
        ...(await lineDetails(c, from.id, data.lines)),
        ...(data.note ? [data.note] : []),
      ],
      href: "/inventory",
    };
    return { input: { data, summary }, summary, storeIds: [from.id, to.id] };
  },
  async execute(c, p) {
    await c.step("transfer", ["INVENTORY_TRANSFER_OUT", "INVENTORY_TRANSFER_IN"], (api, key) =>
      api.inventory.transfer({ ...p.data, idempotencyKey: key }),
    );
    return result(p.summary);
  },
});

defineAction({
  name: "supplier_create",
  description: "Create a supplier. Name is required; contact details optional.",
  schema: contact.extend({ notes: z.string().max(1000).optional() }),
  async prepare(c, data) {
    const summary = {
      title: title(c, "Создать поставщика", "Create supplier", "Жеткирүүчүнү түзүү"),
      details: [data.name, data.email, data.phone].filter((v): v is string => Boolean(v)),
      href: "/suppliers",
    };
    return { input: { data, summary }, summary, storeIds: [] };
  },
  async execute(c, p) {
    const value = await c.step("create", ["SUPPLIER_CREATE"], (api) =>
      api.suppliers.create(p.data),
    );
    return result(p.summary, resultId(value));
  },
});
defineAction({
  name: "customer_create",
  description:
    "Create a customer in a selected accessible store using existing contact matching rules.",
  schema: contact.extend({ storeId: id, address: z.string().max(500).optional() }),
  async prepare(c, data) {
    const store = await baamStore(c, data.storeId);
    const summary = {
      title: title(c, "Создать клиента", "Create customer", "Кардарды түзүү"),
      details: [store.name, data.name, data.email, data.phone].filter((v): v is string =>
        Boolean(v),
      ),
      href: "/customers",
    };
    return { input: { data, summary }, summary, storeIds: [store.id] };
  },
  async execute(c, p) {
    const value = await c.step("create", ["CUSTOMER_UPSERT"], (api) =>
      api.customers.create(p.data),
    );
    return result(p.summary, resultId(value));
  },
});

defineAction({
  name: "purchase_create",
  description:
    "Create a purchase order draft, or submit it if explicitly requested. Supplier optional; quantities are ordered base units, zero unit cost allowed.",
  schema: z
    .object({
      storeId: id,
      supplierId: id.optional(),
      submit: z.boolean().optional(),
      lines: z
        .array(productRef.extend({ qtyOrdered: qty, unitCost: money.optional() }))
        .min(1)
        .max(40),
    })
    .strict(),
  async prepare(c, input) {
    const store = await baamStore(c, input.storeId);
    const supplier = input.supplierId
      ? await prisma.supplier.findFirst({
          where: { id: input.supplierId, organizationId: c.scope.organizationId },
        })
      : null;
    if (input.supplierId && !supplier) throw new AppError("supplierNotFound", "NOT_FOUND", 404);
    const data = {
      ...input,
      lines: input.lines.map((l) => ({ ...l, variantId: l.variantId ?? undefined })),
    };
    const summary = {
      title: title(
        c,
        "Создать заказ поставщику",
        "Create purchase order",
        "Жеткирүүчүгө буйрутма түзүү",
      ),
      details: [
        store.name,
        ...(
          await lineDetails(
            c,
            store.id,
            input.lines.map((l) => ({ ...l, qty: l.qtyOrdered })),
          )
        ).map((label, i) => `${label} × ${input.lines[i].unitCost ?? 0} KGS`),
        ...(supplier ? [supplier.name] : []),
      ],
      href: "/purchase-orders",
    };
    return { input: { data, summary }, summary, storeIds: [store.id] };
  },
  async execute(c, p) {
    const value = await c.step("create", ["PO_CREATE", "PO_SUBMIT"], (api, key) =>
      api.purchases.create({ ...p.data, idempotencyKey: key }),
    );
    return result(p.summary, resultId(value));
  },
});
for (const operation of ["submit", "approve", "cancel", "receive"] as const) {
  defineAction({
    name: `purchase_${operation}`,
    description: `${operation} an existing purchase order. Receive uses the outstanding quantities from the reviewed document; use purchase_receive_lines for partial receipt.`,
    schema: z.object({ purchaseOrderId: id }).strict(),
    async prepare(c, data) {
      const order = await businessCaller(c.ctx).purchases.getById({ id: data.purchaseOrderId });
      if (!order) throw new AppError("poNotFound", "NOT_FOUND", 404);
      const store = await baamStore(c, order.storeId);
      const destination = {
        submit: "SUBMITTED",
        approve: "APPROVED",
        cancel: "CANCELLED",
        receive: "RECEIVED",
      }[operation];
      if (order.status === destination) throw new AppError("baamAlreadyCurrent", "CONFLICT", 409);
      const names = {
        submit: ["Отправить заказ", "Submit purchase order", "Буйрутманы жөнөтүү"],
        approve: ["Утвердить заказ", "Approve purchase order", "Буйрутманы бекитүү"],
        cancel: ["Отменить заказ", "Cancel purchase order", "Буйрутманы жокко чыгаруу"],
        receive: ["Принять заказ", "Receive purchase order", "Буйрутманы кабыл алуу"],
      };
      const n = names[operation];
      const summary = {
        title: title(c, n[0], n[1], n[2]),
        details: [
          store.name,
          ...order.lines.map((l) => `${l.product.name} — ${l.qtyOrdered - l.qtyReceived}`),
        ],
        href: `/purchase-orders/${order.id}`,
      };
      return {
        input: { data, summary },
        summary,
        storeIds: [store.id],
        reviews: [
          { entity: "PurchaseOrder", id: order.id, updatedAt: order.updatedAt.toISOString() },
        ],
      };
    },
    async execute(c, p) {
      await c.step(operation, [`PO_${operation.toUpperCase()}`], (api, key) =>
        operation === "receive"
          ? api.purchases.receive({ ...p.data, idempotencyKey: key })
          : api.purchases[operation](p.data),
      );
      return result(p.summary, p.data.purchaseOrderId);
    },
  });
}

defineAction({
  name: "order_create",
  description:
    "Create a customer order draft (not a paid POS sale), with selected store/products and optional customer contacts.",
  schema: z
    .object({
      storeId: id,
      customerName: z.string().max(160).optional(),
      customerEmail: z.string().email().optional(),
      customerPhone: z.string().max(64).optional(),
      notes: z.string().max(2000).optional(),
      lines: saleLines,
    })
    .strict(),
  async prepare(c, data) {
    const store = await baamStore(c, data.storeId);
    const summary = {
      title: title(
        c,
        "Создать заказ клиента",
        "Create customer order",
        "Кардардын буйрутмасын түзүү",
      ),
      details: [
        store.name,
        ...(await lineDetails(c, store.id, data.lines)),
        ...(data.customerName ? [data.customerName] : []),
      ],
      href: "/sales/orders",
    };
    return { input: { data, summary }, summary, storeIds: [store.id] };
  },
  async execute(c, p) {
    const value = await c.step("create", ["SALES_ORDER_CREATE"], (api, key) =>
      api.orders.createDraft({ ...p.data, idempotencyKey: key }),
    );
    return result(p.summary, resultId(value));
  },
});
for (const operation of ["confirm", "markReady", "complete", "cancel"] as const) {
  defineAction({
    name: `order_${operation}`,
    description: `${operation} an existing CUSTOMER order, following its current status and stock rules. Not for POS sales.`,
    schema: z.object({ customerOrderId: id }).strict(),
    async prepare(c, data) {
      const order = await businessCaller(c.ctx).orders.getById({
        customerOrderId: data.customerOrderId,
      });
      if (!order) throw new AppError("salesOrderNotFound", "NOT_FOUND", 404);
      const store = await baamStore(c, order.storeId);
      const destination = {
        confirm: "CONFIRMED",
        markReady: "READY",
        complete: "COMPLETED",
        cancel: "CANCELED",
      }[operation];
      if (order.status === destination) throw new AppError("baamAlreadyCurrent", "CONFLICT", 409);
      const names = {
        confirm: ["Подтвердить заказ", "Confirm order", "Буйрутманы ырастоо"],
        markReady: ["Отметить готовность заказа", "Mark order ready", "Буйрутма даяр"],
        complete: ["Завершить заказ", "Complete order", "Буйрутманы бүтүрүү"],
        cancel: ["Отменить заказ", "Cancel order", "Буйрутманы жокко чыгаруу"],
      };
      const n = names[operation];
      const summary = {
        title: title(c, n[0], n[1], n[2]),
        details: [
          store.name,
          order.number,
          ...order.lines.map((l) => `${l.product.name} — ${l.qty}`),
        ],
        href: `/sales/orders/${order.id}`,
      };
      return {
        input: { data, summary },
        summary,
        storeIds: [store.id],
        reviews: [
          { entity: "CustomerOrder", id: order.id, updatedAt: order.updatedAt.toISOString() },
        ],
      };
    },
    async execute(c, p) {
      await c.step(operation, ["SALES_ORDER_STATUS_UPDATE", "SALES_ORDER_COMPLETE"], (api, key) =>
        operation === "complete"
          ? api.orders.complete({ ...p.data, idempotencyKey: key })
          : api.orders[operation](p.data),
      );
      return result(p.summary, p.data.customerOrderId);
    },
  });
}

defineAction({
  name: "pos_create_draft",
  description:
    "Prepare a new POS cart using actual price/discount services. Requires an open register shift. This is NOT a completed sale. After creation inspect the sale and collect payment before pos_complete. Does not modify another active cart.",
  schema: z
    .object({
      registerId: id,
      customerId: id.optional(),
      lines: saleLines,
      notes: z.string().max(2000).optional(),
    })
    .strict(),
  async prepare(c, data) {
    const register = await prisma.posRegister.findFirst({
      where: { id: data.registerId, organizationId: c.scope.organizationId, isActive: true },
    });
    if (!register) throw new AppError("posRegisterNotFound", "NOT_FOUND", 404);
    const store = await baamStore(c, register.storeId);
    if (await businessCaller(c.ctx).pos.sales.activeDraft({ registerId: register.id }))
      throw new AppError("baamExistingCart", "CONFLICT", 409);
    if (!(await prisma.registerShift.count({ where: { registerId: register.id, status: "OPEN" } })))
      throw new AppError("posShiftNotOpen", "CONFLICT", 409);
    const summary = {
      title: title(c, "Подготовить чек", "Prepare sale", "Чекти даярдоо"),
      details: [store.name, register.name, ...(await lineDetails(c, store.id, data.lines))],
      href: `/pos/sell?registerId=${register.id}`,
    };
    return { input: { data, summary }, summary, storeIds: [store.id] };
  },
  async execute(c, p) {
    const value = await c.step("draft", ["POS_SALE_CREATE"], (api) =>
      api.pos.sales.createDraft({ ...p.data, requireNewDraft: true }),
    );
    return result(p.summary, resultId(value));
  },
});
defineAction({
  name: "pos_complete",
  description:
    "Complete a prepared POS sale with actual payment methods (CASH,CARD,TRANSFER,OTHER). Inspect the sale first. Payment totals must equal the current amount due; never invent payment. The server checks the exact reviewed cart again at commit. Zero/negative stock remains allowed by existing POS rules.",
  schema: z.object({ saleId: id, payments: z.array(payment).min(1).max(4) }).strict(),
  async prepare(c, input) {
    const sale = await businessCaller(c.ctx).pos.sales.get({ saleId: input.saleId });
    if (!sale) throw new AppError("posSaleNotFound", "NOT_FOUND", 404);
    const store = await baamStore(c, sale.storeId);
    if (sale.status !== "DRAFT") throw new AppError("posSaleNotEditable", "CONFLICT", 409);
    const total = Number(sale.totalKgs);
    if (Math.abs(input.payments.reduce((s, p) => s + p.amountKgs, 0) - total) > 0.005)
      throw new AppError("posPaymentMismatch", "BAD_REQUEST", 400);
    const data = {
      ...input,
      clientState: {
        visibleCartLineCount: sale.lines.length,
        visibleCartTotalKgs: total,
        reviewedLines: sale.lines.map((l) => ({
          productId: l.productId,
          variantId: l.variantId,
          qty: l.qty,
          unitPriceKgs: Number(l.unitPriceKgs),
        })),
      },
    };
    const summary = {
      title: title(
        c,
        "Оплатить и завершить продажу",
        "Pay and complete sale",
        "Төлөп, сатууну бүтүрүү",
      ),
      details: [
        store.name,
        sale.number,
        ...sale.lines.map((l) => `${l.product.name} — ${l.qty} × ${l.unitPriceKgs} KGS`),
        `${total} KGS`,
        ...input.payments.map((p) => `${paymentLabel(c.locale, p.method)}: ${p.amountKgs} KGS`),
      ],
      href: "/pos",
    };
    return { input: { data, summary }, summary, storeIds: [store.id] };
  },
  async execute(c, p) {
    await c.step("complete", ["POS_SALE_COMPLETE"], (api, key) =>
      api.pos.sales.complete({ ...p.data, idempotencyKey: key }),
    );
    return result(p.summary, p.data.saleId);
  },
});
for (const operation of ["holdDraft", "resumeHeldDraft", "cancelDraft"] as const) {
  defineAction({
    name: `pos_${operation}`,
    description: `${operation} a draft POS sale. Cancellation only cancels a draft, not an already completed payment.`,
    schema: z.object({ saleId: id }).strict(),
    async prepare(c, data) {
      const sale = await businessCaller(c.ctx).pos.sales.get(data);
      if (!sale) throw new AppError("posSaleNotFound", "NOT_FOUND", 404);
      const store = await baamStore(c, sale.storeId);
      if (sale.status !== "DRAFT") throw new AppError("posSaleNotEditable", "CONFLICT", 409);
      if (
        (operation === "holdDraft" && sale.isHeld) ||
        (operation === "resumeHeldDraft" && !sale.isHeld)
      )
        throw new AppError("baamAlreadyCurrent", "CONFLICT", 409);
      const n =
        operation === "holdDraft"
          ? ["Отложить чек", "Hold sale", "Чекти кийинкиге калтыруу"]
          : operation === "resumeHeldDraft"
            ? ["Продолжить чек", "Resume sale", "Чекти улантуу"]
            : ["Отменить черновик чека", "Cancel sale draft", "Чектин долбоорун жокко чыгаруу"];
      if (!sale.registerId) throw new AppError("posRegisterNotFound", "NOT_FOUND", 404);
      const summary = {
        title: title(c, n[0], n[1], n[2]),
        details: [store.name, sale.number],
        href: `/pos/sell?registerId=${sale.registerId}`,
      };
      return {
        input: { data: { ...data, registerId: sale.registerId }, summary },
        summary,
        storeIds: [store.id],
      };
    },
    async execute(c, p) {
      await c.step(
        operation,
        ["POS_SALE_HOLD", "POS_SALE_RESUME_HELD", "POS_SALE_DRAFT_CANCEL"],
        (api) => api.pos.sales[operation](p.data),
      );
      return result(p.summary, p.data.saleId);
    },
  });
}

export async function prepareBusinessAction(
  ctx: Context,
  input: { tool: string; arguments: unknown; conversationId: string; locale: string },
) {
  const access = await baamAccess(ctx);
  const action = baamActions[input.tool];
  if (!action || !action.roles.includes(access.scope.role))
    throw new AppError("baamActionUnavailable", "FORBIDDEN", 403);
  return action.prepare(
    { ...access, conversationId: input.conversationId, locale: input.locale },
    input.arguments,
  );
}

defineAction({
  name: "count_create",
  description:
    "Create an inventory count draft in a store. Counting does not change physical stock until apply.",
  schema: z.object({ storeId: id, notes: z.string().max(1000).optional() }).strict(),
  async prepare(c, data) {
    const store = await baamStore(c, data.storeId);
    const summary = {
      title: title(c, "Начать инвентаризацию", "Start inventory count", "Инвентаризацияны баштоо"),
      details: [store.name, ...(data.notes ? [data.notes] : [])],
      href: "/inventory/counts",
    };
    return { input: { data, summary }, summary, storeIds: [store.id] };
  },
  async execute(c, p) {
    const created = await c.step("create", ["STOCK_COUNT_CREATE"], (api) =>
      api.counts.create(p.data),
    );
    const countId = resultId(created);
    return {
      ...result(p.summary, countId),
      href: countId ? `/inventory/counts/${countId}` : "/inventory/counts",
    };
  },
});
defineAction({
  name: "count_set_quantity",
  description:
    "Set the counted physical quantity for one exact product/variant in a draft inventory count. Zero allowed; inspect/search actual product first. Does not apply the discrepancy to stock yet.",
  schema: productRef.extend({ stockCountId: id, countedQty: z.number().int().min(0) }),
  async prepare(c, input) {
    const count = await businessCaller(c.ctx).counts.get({ stockCountId: input.stockCountId });
    if (!count) throw new AppError("stockCountNotFound", "NOT_FOUND", 404);
    const store = await baamStore(c, count.storeId);
    const p = await baamProduct(c, input.productId, input.variantId, store.id);
    const sku = input.variantId
      ? p.product.variants.find((v) => v.id === input.variantId)?.sku
      : p.product.sku;
    if (!sku) throw new AppError("variantSkuRequired", "BAD_REQUEST", 400);
    const data = {
      stockCountId: count.id,
      storeId: store.id,
      barcodeOrQuery: sku,
      mode: "set" as const,
      countedQty: input.countedQty,
    };
    const summary = {
      title: title(
        c,
        "Указать посчитанное количество",
        "Set counted quantity",
        "Саналган санын көрсөтүү",
      ),
      details: [store.name, count.code, p.label, `${input.countedQty}`],
      href: `/inventory/counts/${count.id}`,
    };
    return {
      input: { data, summary },
      summary,
      storeIds: [store.id],
      reviews: [{ entity: "StockCount", id: count.id, updatedAt: count.updatedAt.toISOString() }],
    };
  },
  async execute(c, p) {
    await c.step("count", ["STOCK_COUNT_LINE_SET"], (api, key) =>
      api.counts.addOrUpdateLineByScan({ ...p.data, idempotencyKey: key }),
    );
    return result(p.summary, p.data.stockCountId);
  },
});
for (const operation of ["applyCount", "cancel"] as const)
  defineAction({
    name: `count_${operation}`,
    description:
      operation === "applyCount"
        ? "Apply the reviewed inventory-count discrepancies through normal stock adjustments, preserving sales/receipts since counting."
        : "Cancel an unapplied inventory count.",
    schema: z.object({ stockCountId: id }).strict(),
    async prepare(c, data) {
      const count = await businessCaller(c.ctx).counts.get(data);
      if (!count) throw new AppError("stockCountNotFound", "NOT_FOUND", 404);
      const store = await baamStore(c, count.storeId);
      if (count.status === (operation === "applyCount" ? "APPLIED" : "CANCELLED"))
        throw new AppError("baamAlreadyCurrent", "CONFLICT", 409);
      const summary = {
        title:
          operation === "applyCount"
            ? title(
                c,
                "Применить инвентаризацию",
                "Apply inventory count",
                "Инвентаризацияны колдонуу",
              )
            : title(
                c,
                "Отменить инвентаризацию",
                "Cancel inventory count",
                "Инвентаризацияны жокко чыгаруу",
              ),
        details: [
          store.name,
          count.code,
          ...count.lines.map(
            (l) => `${l.product.name}: ${l.expectedOnHand} → ${l.countedQty} (Δ ${l.deltaQty})`,
          ),
        ],
        href: `/inventory/counts/${count.id}`,
      };
      return {
        input: { data, summary },
        summary,
        storeIds: [store.id],
        reviews: [{ entity: "StockCount", id: count.id, updatedAt: count.updatedAt.toISOString() }],
      };
    },
    async execute(c, p) {
      await c.step(operation, ["STOCK_COUNT_DOCUMENT_APPLY", "STOCK_COUNT_CANCEL"], (api, key) =>
        operation === "applyCount"
          ? api.counts.applyCount({ ...p.data, idempotencyKey: key })
          : api.counts.cancel(p.data),
      );
      return result(p.summary, p.data.stockCountId);
    },
  });

defineAction({
  name: "return_create_draft",
  description:
    "Prepare a customer return for an actual completed POS receipt in an open shift. Include exact original receipt line IDs and return quantities. Creates a draft; inspect it and collect refund method before return_complete. Successful steps survive retry.",
  schema: z
    .object({
      shiftId: id,
      originalSaleId: id,
      notes: z.string().max(2000).optional(),
      lines: z
        .array(z.object({ customerOrderLineId: id, qty }).strict())
        .min(1)
        .max(40),
    })
    .strict(),
  async prepare(c, data) {
    const sale = await businessCaller(c.ctx).pos.sales.get({ saleId: data.originalSaleId });
    if (!sale) throw new AppError("posSaleNotFound", "NOT_FOUND", 404);
    const store = await baamStore(c, sale.storeId);
    const shift = await prisma.registerShift.findFirst({
      where: {
        id: data.shiftId,
        organizationId: c.scope.organizationId,
        storeId: store.id,
        status: "OPEN",
      },
    });
    if (!shift) throw new AppError("posShiftNotOpen", "CONFLICT", 409);
    const details = data.lines.map((l) => {
      const original = sale.lines.find((s) => s.id === l.customerOrderLineId);
      if (!original || l.qty > original.qty)
        throw new AppError("invalidReturnQty", "BAD_REQUEST", 400);
      return `${original.product.name} — ${l.qty}`;
    });
    if (new Set(data.lines.map((l) => l.customerOrderLineId)).size !== data.lines.length)
      throw new AppError("baamDuplicateLines", "BAD_REQUEST", 400);
    const summary = {
      title: title(c, "Подготовить возврат", "Prepare return", "Кайтарууну даярдоо"),
      details: [store.name, sale.number, ...details],
      href: "/pos/receipts",
    };
    return { input: { data, summary }, summary, storeIds: [store.id] };
  },
  async execute(c, p) {
    const draft = await c.step("draft", ["POS_RETURN_CREATE"], (api) =>
      api.pos.returns.createDraft({
        shiftId: p.data.shiftId,
        originalSaleId: p.data.originalSaleId,
        notes: p.data.notes,
      }),
    );
    const saleReturnId = resultId(draft);
    if (!saleReturnId) throw new AppError("baamExecutionUncertain", "CONFLICT", 409);
    for (const [index, line] of p.data.lines.entries())
      await c.step(`line-${index}`, ["POS_RETURN_LINE_ADD", "POS_RETURN_LINE_UPDATE"], (api) =>
        api.pos.returns.addLine({ ...line, saleReturnId }),
      );
    return result(p.summary, saleReturnId);
  },
});
defineAction({
  name: "return_complete",
  description:
    "Complete a reviewed customer return using the existing refund/stock process. Inspect the draft for exact amount and explicitly collect supported refund payment methods.",
  schema: z.object({ saleReturnId: id, payments: z.array(payment).min(1).max(4) }).strict(),
  async prepare(c, data) {
    const returned = await businessCaller(c.ctx).pos.returns.get({
      saleReturnId: data.saleReturnId,
    });
    if (!returned) throw new AppError("posReturnNotFound", "NOT_FOUND", 404);
    const store = await baamStore(c, returned.storeId);
    if (
      returned.status !== "DRAFT" ||
      Math.abs(data.payments.reduce((s, p) => s + p.amountKgs, 0) - Number(returned.totalKgs)) >
        0.005
    )
      throw new AppError("posPaymentMismatch", "BAD_REQUEST", 400);
    const summary = {
      title: title(c, "Провести возврат", "Complete return", "Кайтарууну өткөрүү"),
      details: [
        store.name,
        returned.number,
        ...returned.lines.map((l) => `${l.product.name} — ${l.qty}`),
        `${returned.totalKgs} KGS`,
        ...data.payments.map((p) => `${paymentLabel(c.locale, p.method)}: ${p.amountKgs} KGS`),
      ],
      href: "/pos/receipts",
    };
    return {
      input: { data, summary },
      summary,
      storeIds: [store.id],
      reviews: [
        { entity: "SaleReturn", id: returned.id, updatedAt: returned.updatedAt.toISOString() },
      ],
    };
  },
  async execute(c, p) {
    await c.step("complete", ["POS_RETURN_COMPLETE"], (api, key) =>
      api.pos.returns.complete({ ...p.data, idempotencyKey: key }),
    );
    return result(p.summary, p.data.saleReturnId);
  },
});
defineAction({
  name: "return_cancel",
  description: "Cancel an unfinished return draft. Cannot undo a completed refund.",
  schema: z.object({ saleReturnId: id }).strict(),
  async prepare(c, data) {
    const returned = await businessCaller(c.ctx).pos.returns.get(data);
    if (!returned) throw new AppError("posReturnNotFound", "NOT_FOUND", 404);
    const store = await baamStore(c, returned.storeId);
    if (returned.status !== "DRAFT") throw new AppError("baamAlreadyCurrent", "CONFLICT", 409);
    const summary = {
      title: title(c, "Отменить возврат", "Cancel return draft", "Кайтарууну жокко чыгаруу"),
      details: [store.name, returned.number],
      href: "/pos/receipts",
    };
    return { input: { data, summary }, summary, storeIds: [store.id] };
  },
  async execute(c, p) {
    await c.step("cancel", ["POS_RETURN_CANCEL"], (api, key) =>
      api.pos.returns.cancel({ ...p.data, idempotencyKey: key }),
    );
    return result(p.summary, p.data.saleReturnId);
  },
});

defineAction({
  name: "supplier_update",
  description:
    "Update only specified supplier contact fields, preserving the rest. Requires an exact supplier found by search; changes after review cause a conflict.",
  schema: contact.partial().extend({ supplierId: id, notes: z.string().max(1000).optional() }),
  async prepare(c, input) {
    const before = await prisma.supplier.findFirst({
      where: { id: input.supplierId, organizationId: c.scope.organizationId },
    });
    if (!before) throw new AppError("supplierNotFound", "NOT_FOUND", 404);
    const data = {
      supplierId: before.id,
      name: input.name ?? before.name,
      email: input.email ?? before.email ?? undefined,
      phone: input.phone ?? before.phone ?? undefined,
      notes: input.notes ?? before.notes ?? undefined,
    };
    const summary = {
      title: title(c, "Изменить поставщика", "Update supplier", "Жеткирүүчүнү өзгөртүү"),
      details: [before.name, input.name, input.email, input.phone, input.notes].filter(
        (v): v is string => v !== undefined,
      ),
      href: "/suppliers",
    };
    return {
      input: { data, summary },
      summary,
      storeIds: [],
      reviews: [{ entity: "Supplier", id: before.id, updatedAt: before.updatedAt.toISOString() }],
    };
  },
  async execute(c, p) {
    await c.step("update", ["SUPPLIER_UPDATE"], (api) => api.suppliers.update(p.data));
    return result(p.summary, p.data.supplierId);
  },
});
defineAction({
  name: "customer_update",
  description:
    "Update only specified customer details. Uses the existing store and duplicate-contact checks, with a review version check.",
  schema: contact.partial().extend({ customerId: id, address: z.string().max(500).optional() }),
  async prepare(c, input) {
    const before = await prisma.customer.findFirst({
      where: {
        id: input.customerId,
        organizationId: c.scope.organizationId,
        deletedAt: null,
        storeId: { in: c.scope.storeIds },
      },
    });
    if (!before) throw new AppError("customerNotFound", "NOT_FOUND", 404);
    const data = {
      customerId: before.id,
      name: input.name ?? before.name,
      email: input.email ?? before.email,
      phone: input.phone ?? before.phone,
      address: input.address ?? before.address,
    };
    const summary = {
      title: title(c, "Изменить клиента", "Update customer", "Кардарды өзгөртүү"),
      details: [before.name, input.name, input.email, input.phone, input.address].filter(
        (v): v is string => v !== undefined,
      ),
      href: "/customers",
    };
    return {
      input: { data, summary },
      summary,
      storeIds: [before.storeId],
      reviews: [{ entity: "Customer", id: before.id, updatedAt: before.updatedAt.toISOString() }],
    };
  },
  async execute(c, p) {
    await c.step("update", ["CUSTOMER_UPDATE"], (api) => api.customers.update(p.data));
    return result(p.summary, p.data.customerId);
  },
});

async function purchaseReview(c: PrepareContext, purchaseOrderId: string) {
  const document = await businessCaller(c.ctx).purchases.getById({ id: purchaseOrderId });
  if (!document) throw new AppError("poNotFound", "NOT_FOUND", 404);
  const store = await baamStore(c, document.storeId);
  return {
    document,
    store,
    reviews: [
      { entity: "PurchaseOrder", id: document.id, updatedAt: document.updatedAt.toISOString() },
    ],
  };
}
defineAction({
  name: "purchase_receive_lines",
  description:
    "Receive selected outstanding purchase-order lines, in base units. Resolve exact lines by inspecting the order. No over-receiving; zero cost follows the existing document.",
  schema: z
    .object({
      purchaseOrderId: id,
      lines: z
        .array(z.object({ lineId: id, qtyReceived: qty }).strict())
        .min(1)
        .max(40),
    })
    .strict(),
  async prepare(c, data) {
    const { document, store, reviews } = await purchaseReview(c, data.purchaseOrderId);
    if (new Set(data.lines.map((l) => l.lineId)).size !== data.lines.length)
      throw new AppError("baamDuplicateLines", "BAD_REQUEST", 400);
    const details = data.lines.map((l) => {
      const line = document.lines.find((x) => x.id === l.lineId);
      if (!line || l.qtyReceived > line.qtyOrdered - line.qtyReceived)
        throw new AppError("invalidInput", "BAD_REQUEST", 400);
      return `${line.product.name} — ${l.qtyReceived} × ${line.unitCost ?? "?"} KGS`;
    });
    const summary = {
      title: title(
        c,
        "Частично принять заказ",
        "Receive selected quantities",
        "Тандалган сандарды кабыл алуу",
      ),
      details: [store.name, ...details],
      href: `/purchase-orders/${document.id}`,
    };
    return { input: { data, summary }, summary, storeIds: [store.id], reviews };
  },
  async execute(c, p) {
    await c.step("receive", ["PO_RECEIVE"], (api, key) =>
      api.purchases.receive({ ...p.data, idempotencyKey: key }),
    );
    return result(p.summary, p.data.purchaseOrderId);
  },
});
for (const operation of ["add", "update", "remove"] as const)
  defineAction({
    name: `purchase_${operation}_line`,
    description: `${operation} one line of a draft purchase order. Use document and line references from inspection. Add needs product and quantity; update needs quantity; omitted cost is preserved.`,
    schema: z
      .object({
        purchaseOrderId: id,
        lineId: id.optional(),
        productId: id.optional(),
        variantId: id.optional(),
        qtyOrdered: qty.optional(),
        unitCost: money.optional(),
      })
      .strict(),
    async prepare(c, input) {
      const { document, store, reviews } = await purchaseReview(c, input.purchaseOrderId);
      const line = document.lines.find((l) => l.id === input.lineId);
      if (
        (operation !== "add" && !line) ||
        (operation === "add" && !input.productId) ||
        (operation !== "remove" && input.qtyOrdered === undefined)
      )
        throw new AppError("invalidInput", "BAD_REQUEST", 400);
      const data = {
        ...input,
        qtyOrdered: input.qtyOrdered ?? line!.qtyOrdered,
        productId: input.productId ?? line!.productId,
        lineId: line?.id ?? "",
        unitCost: input.unitCost ?? line?.unitCost ?? undefined,
      };
      const label =
        operation === "add"
          ? (await baamProduct(c, data.productId, data.variantId, store.id)).label
          : line!.product.name;
      const n =
        operation === "remove"
          ? ["Убрать товар из заказа", "Remove purchase line", "Буйрутмадан товарды алып салуу"]
          : ["Изменить состав закупки", "Edit purchase lines", "Сатып алуунун курамын өзгөртүү"];
      const summary = {
        title: title(c, n[0], n[1], n[2]),
        details: [
          store.name,
          label,
          `${data.qtyOrdered}${data.unitCost !== undefined ? ` × ${data.unitCost} KGS` : ""}`,
        ],
        href: `/purchase-orders/${document.id}`,
      };
      return { input: { data, summary }, summary, storeIds: [store.id], reviews };
    },
    async execute(c, p) {
      await c.step(operation, [`PO_LINE_${operation.toUpperCase()}`], (api) =>
        operation === "add"
          ? api.purchases.addLine(p.data)
          : operation === "update"
            ? api.purchases.updateLine(p.data)
            : api.purchases.removeLine({ lineId: p.data.lineId }),
      );
      return result(p.summary, p.data.purchaseOrderId);
    },
  });
for (const operation of ["add", "update", "remove"] as const)
  defineAction({
    name: `order_${operation}_line`,
    description: `${operation} one line in an editable customer order. Resolve document/line with inspection. Add needs product and quantity; update needs quantity.`,
    schema: z
      .object({
        customerOrderId: id,
        lineId: id.optional(),
        productId: id.optional(),
        variantId: id.optional(),
        qty: qty.optional(),
      })
      .strict(),
    async prepare(c, input) {
      const document = await businessCaller(c.ctx).orders.getById({
        customerOrderId: input.customerOrderId,
      });
      if (!document) throw new AppError("salesOrderNotFound", "NOT_FOUND", 404);
      const store = await baamStore(c, document.storeId);
      const line = document.lines.find((l) => l.id === input.lineId);
      if (
        (operation !== "add" && !line) ||
        (operation === "add" && !input.productId) ||
        (operation !== "remove" && input.qty === undefined)
      )
        throw new AppError("invalidInput", "BAD_REQUEST", 400);
      const data = {
        ...input,
        qty: input.qty ?? line!.qty,
        productId: input.productId ?? line!.productId,
        lineId: line?.id ?? "",
      };
      const label =
        operation === "add"
          ? (await baamProduct(c, data.productId, data.variantId, store.id)).label
          : line!.product.name;
      const summary = {
        title:
          operation === "remove"
            ? title(
                c,
                "Убрать товар из заказа",
                "Remove order line",
                "Буйрутмадан товарды алып салуу",
              )
            : title(
                c,
                "Изменить состав заказа",
                "Edit order lines",
                "Буйрутманын курамын өзгөртүү",
              ),
        details: [store.name, document.number, label, `${data.qty}`],
        href: `/sales/orders/${document.id}`,
      };
      return {
        input: { data, summary },
        summary,
        storeIds: [store.id],
        reviews: [
          { entity: "CustomerOrder", id: document.id, updatedAt: document.updatedAt.toISOString() },
        ],
      };
    },
    async execute(c, p) {
      await c.step(operation, [`SALES_ORDER_LINE_${operation.toUpperCase()}`], (api) =>
        operation === "add"
          ? api.orders.addLine(p.data)
          : operation === "update"
            ? api.orders.updateLine(p.data)
            : api.orders.removeLine({ lineId: p.data.lineId }),
      );
      return result(p.summary, p.data.customerOrderId);
    },
  });
for (const operation of ["add", "update", "remove"] as const)
  defineAction({
    name: `pos_${operation}_line`,
    description: `${operation} one reviewed POS cart line through normal pricing/permissions. Add quantity is a delta for an existing product; update quantity is absolute. No payment occurs.`,
    schema: z
      .object({
        saleId: id,
        lineId: id.optional(),
        productId: id.optional(),
        variantId: id.optional(),
        qty: qty.optional(),
        unitPriceKgs: money.optional(),
      })
      .strict(),
    async prepare(c, input) {
      const document = await businessCaller(c.ctx).pos.sales.get({ saleId: input.saleId });
      if (!document) throw new AppError("posSaleNotFound", "NOT_FOUND", 404);
      const store = await baamStore(c, document.storeId);
      const line = document.lines.find((l) => l.id === input.lineId);
      if (
        (operation !== "add" && !line) ||
        (operation === "add" && (!input.productId || input.qty === undefined)) ||
        (operation === "update" && input.qty === undefined && input.unitPriceKgs === undefined)
      )
        throw new AppError("invalidInput", "BAD_REQUEST", 400);
      const data = {
        ...input,
        qty: input.qty ?? line!.qty,
        productId: input.productId ?? line!.productId,
        lineId: line?.id ?? "",
      };
      const label =
        operation === "add"
          ? (await baamProduct(c, data.productId, data.variantId, store.id)).label
          : line!.product.name;
      const summary = {
        title:
          operation === "remove"
            ? title(c, "Убрать товар из чека", "Remove sale line", "Чектен товарды алып салуу")
            : title(c, "Изменить состав чека", "Edit cart", "Чектин курамын өзгөртүү"),
        details: [
          store.name,
          document.number,
          label,
          `${operation === "add" ? "+" : ""}${data.qty}`,
          ...(input.unitPriceKgs !== undefined ? [`${input.unitPriceKgs} KGS`] : []),
        ],
        href: `/pos/sell?registerId=${document.registerId}`,
      };
      return {
        input: { data, summary },
        summary,
        storeIds: [store.id],
        reviews: [
          { entity: "CustomerOrder", id: document.id, updatedAt: document.updatedAt.toISOString() },
        ],
      };
    },
    async execute(c, p) {
      await c.step(
        operation,
        operation === "add"
          ? ["POS_SALE_LINE_ADD", "POS_SALE_LINE_UPDATE"]
          : [`POS_SALE_LINE_${operation.toUpperCase()}`],
        (api) =>
          operation === "add"
            ? api.pos.sales.addLine(p.data)
            : operation === "update"
              ? api.pos.sales.updateLine(p.data)
              : api.pos.sales.removeLine({ lineId: p.data.lineId }),
      );
      return result(p.summary, p.data.saleId);
    },
  });
defineAction({
  name: "count_remove_line",
  description:
    "Remove an incorrectly added line from an unapplied inventory count. Does not change physical stock.",
  schema: z.object({ stockCountId: id, lineId: id }).strict(),
  async prepare(c, data) {
    const document = await businessCaller(c.ctx).counts.get({ stockCountId: data.stockCountId });
    const line = document?.lines.find((l) => l.id === data.lineId);
    if (!document || !line) throw new AppError("stockCountNotFound", "NOT_FOUND", 404);
    const store = await baamStore(c, document.storeId);
    const summary = {
      title: title(c, "Убрать строку подсчёта", "Remove count line", "Санак сабын алып салуу"),
      details: [store.name, document.code, line.product.name],
      href: `/inventory/counts/${document.id}`,
    };
    return {
      input: { data, summary },
      summary,
      storeIds: [store.id],
      reviews: [
        { entity: "StockCount", id: document.id, updatedAt: document.updatedAt.toISOString() },
      ],
    };
  },
  async execute(c, p) {
    await c.step("remove", ["STOCK_COUNT_LINE_REMOVE"], (api) =>
      api.counts.removeLine({ lineId: p.data.lineId }),
    );
    return result(p.summary, p.data.stockCountId);
  },
});

for (const operation of ["add", "update", "remove"] as const)
  defineAction({
    name: `return_${operation}_line`,
    description: `${operation} a line in a DRAFT return; no refund until completion. Inspect original sale and return first. Add needs original sale line ID; update/remove needs return line ID.`,
    schema: z
      .object({
        saleReturnId: id,
        returnLineId: id.optional(),
        customerOrderLineId: id.optional(),
        qty: qty.optional(),
      })
      .strict(),
    async prepare(c, input) {
      const document = await businessCaller(c.ctx).pos.returns.get({
        saleReturnId: input.saleReturnId,
      });
      if (!document) throw new AppError("posReturnNotFound", "NOT_FOUND", 404);
      const store = await baamStore(c, document.storeId);
      const line = document.lines.find((l) => l.id === input.returnLineId);
      if (
        (operation !== "add" && !line) ||
        (operation === "add" && !input.customerOrderLineId) ||
        (operation !== "remove" && input.qty === undefined)
      )
        throw new AppError("invalidInput", "BAD_REQUEST", 400);
      const original = await businessCaller(c.ctx).pos.sales.get({
        saleId: document.originalSaleId,
      });
      const source = original?.lines.find(
        (l) => l.id === (input.customerOrderLineId ?? line?.customerOrderLineId),
      );
      if (!source) throw new AppError("posReturnLineNotFound", "NOT_FOUND", 404);
      const data = {
        ...input,
        qty: input.qty ?? line!.qty,
        returnLineId: line?.id ?? "",
        customerOrderLineId: source.id,
      };
      const summary = {
        title:
          operation === "remove"
            ? title(
                c,
                "Убрать товар из возврата",
                "Remove return line",
                "Кайтаруудан товарды алып салуу",
              )
            : title(
                c,
                "Изменить состав возврата",
                "Edit return lines",
                "Кайтаруунун курамын өзгөртүү",
              ),
        details: [store.name, document.number, source.product.name, `${data.qty}`],
        href: "/pos/receipts",
      };
      return {
        input: { data, summary },
        summary,
        storeIds: [store.id],
        reviews: [
          { entity: "SaleReturn", id: document.id, updatedAt: document.updatedAt.toISOString() },
        ],
      };
    },
    async execute(c, p) {
      await c.step(operation, [`POS_RETURN_LINE_${operation.toUpperCase()}`], (api) =>
        operation === "add"
          ? api.pos.returns.addLine(p.data)
          : operation === "update"
            ? api.pos.returns.updateLine(p.data)
            : api.pos.returns.removeLine({ returnLineId: p.data.returnLineId }),
      );
      return result(p.summary, p.data.saleReturnId);
    },
  });
defineAction({
  name: "pos_open_shift",
  description:
    "Open an accessible register shift with the user's explicit opening cash amount (zero allowed). Does not create payments or a sale. Closing/cash reconciliation is done in the normal POS shift screen.",
  schema: z
    .object({ registerId: id, openingCashKgs: money, notes: z.string().max(500).optional() })
    .strict(),
  async prepare(c, data) {
    const register = await prisma.posRegister.findFirst({
      where: { id: data.registerId, organizationId: c.scope.organizationId, isActive: true },
    });
    if (!register) throw new AppError("posRegisterNotFound", "NOT_FOUND", 404);
    const store = await baamStore(c, register.storeId);
    if (await businessCaller(c.ctx).pos.shifts.current({ registerId: register.id }))
      throw new AppError("posShiftAlreadyOpen", "CONFLICT", 409);
    const summary = {
      title: title(c, "Открыть смену", "Open shift", "Сменаны ачуу"),
      details: [
        store.name,
        register.name,
        `${data.openingCashKgs} KGS`,
        ...(data.notes ? [data.notes] : []),
      ],
      href: `/pos/sell?registerId=${register.id}`,
    };
    return { input: { data, summary }, summary, storeIds: [store.id] };
  },
  async execute(c, p) {
    const value = await c.step("open", ["POS_SHIFT_OPEN"], (api, key) =>
      api.pos.shifts.open({ ...p.data, idempotencyKey: key }),
    );
    return result(p.summary, resultId(value));
  },
});

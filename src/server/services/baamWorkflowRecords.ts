import { prisma } from "@/server/db/prisma";
import type { Context } from "@/server/trpc/trpc";
import { baamSearch, baamInspect } from "./baamReadTools";
import { ownBaamConversation } from "./baamConversations";
import { workflowFieldAt } from "./baamWorkflowCatalog";
import {
  workflowGet,
  workflowSet,
  type WorkflowField,
  type WorkflowValues,
  type WorkflowOption,
  type WorkflowPresentation,
} from "@/lib/baam/workflows";
import { AppError } from "./errors";

type RecordValue = {
  id?: string;
  key?: string;
  name?: string;
  number?: string;
  code?: string;
  labelRu?: string;
  labelKg?: string;
  sku?: string;
  status?: string;
  phone?: string;
  createdAt?: string;
  isActive?: boolean;
  productId?: string;
  qty?: number;
  qtyOrdered?: number;
  quantity?: number;
  supplier?: { name: string };
  product?: { name: string };
  variant?: { name: string };
  variants?: RecordValue[];
  lines?: RecordValue[];
  items?: RecordValue[];
};
const isRecordId = (value: unknown) =>
  typeof value === "string" && (/^c[a-z0-9]{20,}$/.test(value) || /^[a-f0-9-]{36}$/i.test(value));
export function recordOption(item: RecordValue, locale: string): WorkflowOption {
  const label = String(
    item.name ?? item.number ?? item.code ?? item.supplier?.name ?? item.labelRu ?? "",
  );
  return {
    value: String(item.id ?? item.key),
    label:
      locale === "en" && item.code
        ? item.code
        : locale === "kg" && item.labelKg
          ? `${item.labelKg} (${item.code})`
          : item.labelRu
            ? `${item.labelRu} (${item.code})`
            : label,
    detail: [
      item.sku,
      item.status,
      item.phone,
      item.createdAt
        ? new Date(item.createdAt).toLocaleDateString(locale === "kg" ? "ru" : locale)
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}
export async function lookupWorkflow(
  ctx: Context,
  input: {
    id: string;
    path: string;
    query?: string;
    locale?: string;
    selected?: string;
    parameters?: WorkflowValues;
  },
) {
  const wf = await prisma.baamWorkflow.findUnique({ where: { id: input.id } });
  if (!wf) throw new AppError("baamActionNotFound", "NOT_FOUND", 404);
  const access = await ownBaamConversation(ctx, wf.conversationId);
  const p = wf.presentation as unknown as WorkflowPresentation;
  const field = workflowFieldAt(p.fields, input.path);
  if (!field?.lookup) throw new AppError("invalidInput", "BAD_REQUEST", 400);
  const values = input.parameters ?? (wf.parameters as WorkflowValues);
  const locale =
    input.locale ?? (await prisma.baamTurn.findUniqueOrThrow({ where: { id: wf.turnId } })).locale;
  const storeId =
    typeof values.storeId === "string"
      ? values.storeId
      : (access.conversation.storeId ?? undefined);
  if (storeId && !access.scope.storeIds.includes(storeId))
    throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
  if (field.lookup === "shifts")
    return (
      await prisma.registerShift.findMany({
        where: {
          organizationId: access.scope.organizationId,
          storeId: { in: storeId ? [storeId] : access.scope.storeIds },
          status: "OPEN",
        },
        include: { register: { select: { name: true } }, store: { select: { name: true } } },
        orderBy: { openedAt: "desc" },
        take: 30,
      })
    ).map((s) => ({
      value: s.id,
      label: `${s.register.name} · ${s.store.name}`,
      detail: new Date(s.openedAt).toLocaleString(locale === "kg" ? "ru" : locale),
    }));
  if (field.lookup === "variants") {
    const parent = input.path.split(".").slice(0, -1).join(".");
    const productKey = field.key === "componentVariantId" ? "componentProductId" : "productId";
    const productId = workflowGet(values, parent ? `${parent}.${productKey}` : productKey);
    if (typeof productId !== "string") return [];
    const product = (await baamInspect(ctx, {
      kind: "product",
      id: productId,
      storeId,
    })) as { product: RecordValue };
    return ((product.product.variants ?? []) as RecordValue[])
      .filter((v) => v.isActive !== false)
      .map((v) => recordOption(v, locale));
  }
  if (field.lookup === "lines") {
    const candidates = [
      ["saleId", "sale"],
      ["originalSaleId", "sale"],
      ["customerOrderId", "order"],
      ["purchaseOrderId", "purchase"],
      ["saleReturnId", "return"],
      ["stockCountId", "count"],
    ] as const;
    const ref = candidates.find(([key]) => typeof values[key] === "string");
    if (!ref) return [];
    const doc = (await baamInspect(ctx, {
      kind: ref[1],
      id: String(values[ref[0]]),
      storeId,
    })) as RecordValue;
    return ((doc.lines ?? []) as RecordValue[]).map((l) => ({
      value: String(l.id),
      label: l.product?.name ?? l.name ?? String(l.productId),
      detail: `${l.qty ?? l.qtyOrdered ?? l.quantity ?? ""} · ${l.variant?.name ?? ""}`,
    }));
  }
  const response = (await baamSearch(ctx, {
    kind: field.lookup,
    storeId: field.lookup === "stores" || field.lookup === "units" ? undefined : storeId,
    query: input.query,
    offset: 0,
  })) as RecordValue;
  const options = (response.items as RecordValue[]).map((item) => recordOption(item, locale));
  if (input.selected && !options.some((o) => o.value === input.selected)) {
    const org = { organizationId: access.scope.organizationId };
    const stores = { storeId: { in: storeId ? [storeId] : access.scope.storeIds } };
    let selected: RecordValue | null = null;
    switch (field.lookup) {
      case "products":
        selected = await prisma.product.findFirst({
          where: {
            id: input.selected,
            ...org,
            isDeleted: false,
            ...(storeId || (access.scope.role !== "ADMIN" && !access.scope.isOrgOwner)
              ? { storeProducts: { some: { ...stores, isActive: true } } }
              : {}),
          },
          select: { id: true, name: true, sku: true },
        });
        break;
      case "units":
        selected = await prisma.unit.findFirst({
          where: { id: input.selected, ...org },
          select: { id: true, code: true, labelRu: true, labelKg: true },
        });
        break;
      case "stores": {
        const store = access.scope.availableStores.find((s) => s.id === input.selected);
        selected = store ? { id: store.id, name: store.name } : null;
        break;
      }
      case "registers":
        selected = await prisma.posRegister.findFirst({
          where: { id: input.selected, ...org, ...stores, isActive: true },
          select: { id: true, name: true },
        });
        break;
      case "customers":
        selected = await prisma.customer.findFirst({
          where: { id: input.selected, ...org, ...stores, deletedAt: null },
          select: { id: true, name: true },
        });
        break;
      case "suppliers":
        selected = await prisma.supplier.findFirst({
          where: { id: input.selected, ...org },
          select: { id: true, name: true },
        });
        break;
      default: {
        const kinds = {
          sales: "sale",
          orders: "order",
          purchases: "purchase",
          stock_counts: "count",
          returns: "return",
        } as const;
        const kind = kinds[field.lookup as keyof typeof kinds];
        if (kind)
          try {
            selected = (await baamInspect(ctx, {
              kind,
              id: input.selected,
              storeId,
            })) as RecordValue;
          } catch (error) {
            if (!(error instanceof AppError) || error.status !== 404) throw error;
          }
      }
    }
    if (selected) options.unshift(recordOption(selected, locale));
  }
  return options;
}
export async function resolveWorkflowValues(
  ctx: Context,
  input: {
    conversationId: string;
    fields: WorkflowField[];
    parameters: WorkflowValues;
    locale: string;
  },
) {
  const access = await ownBaamConversation(ctx, input.conversationId);
  let values = structuredClone(input.parameters);
  const labels: Record<string, string> = {},
    choices: Record<string, WorkflowOption[]> = {};
  if (input.fields.some((f) => f.key === "storeId") && !values.storeId) {
    const id =
      access.conversation.storeId ??
      (access.scope.availableStores.length === 1 ? access.scope.availableStores[0].id : undefined);
    if (id) values.storeId = id;
  }
  const slots: Array<{ path: string; field: WorkflowField }> = [];
  const walk = (fields: WorkflowField[], prefix = "") => {
    for (const field of fields) {
      const path = prefix ? `${prefix}.${field.key}` : field.key;
      const v = workflowGet(values, path);
      if (field.lookup) slots.push({ path, field });
      if (field.kind === "array" && Array.isArray(v) && field.item?.fields)
        v.forEach((_, i) => walk(field.item!.fields!, `${path}.${i}`));
      if (field.fields) walk(field.fields, path);
    }
  };
  walk(input.fields);
  // Resolve independent references concurrently; each query remains organization/store scoped.
  await Promise.all(
    slots
      .filter((s) => s.field.lookup === "stores")
      .map(async (s) => {
        const value = workflowGet(values, s.path);
        const options = access.scope.availableStores.map((x) => ({ value: x.id, label: x.name }));
        const matches = options.filter(
          (o) =>
            o.value === value || o.label.toLocaleLowerCase() === String(value).toLocaleLowerCase(),
        );
        if (matches.length === 1) {
          values = workflowSet(values, s.path, matches[0].value);
          labels[s.path] = matches[0].label;
        } else if (value) {
          values = workflowSet(values, s.path, undefined);
          choices[s.path] = options;
        }
      }),
  );
  const storeId =
    typeof values.storeId === "string"
      ? values.storeId
      : (access.conversation.storeId ?? undefined);
  // One bounded product query for all names/SKUs in a multi-line request.
  const productTerms = [
    ...new Set(
      slots
        .filter((s) => s.field.lookup === "products")
        .map((s) => workflowGet(values, s.path))
        .filter((v): v is string => typeof v === "string" && Boolean(v)),
    ),
  ];
  const products = productTerms.length
    ? await prisma.product.findMany({
        where: {
          organizationId: access.scope.organizationId,
          isDeleted: false,
          ...(storeId || (access.scope.role !== "ADMIN" && !access.scope.isOrgOwner)
            ? {
                storeProducts: {
                  some: {
                    storeId: { in: storeId ? [storeId] : access.scope.storeIds },
                    isActive: true,
                  },
                },
              }
            : {}),
          OR: productTerms.flatMap((term) => [
            { id: term },
            { name: { contains: term, mode: "insensitive" as const } },
            { sku: { contains: term, mode: "insensitive" as const } },
            { barcodes: { some: { value: term } } },
          ]),
        },
        select: { id: true, name: true, sku: true, barcodes: { select: { value: true } } },
        take: Math.min(800, productTerms.length * 21),
      })
    : [];
  const searchCache = new Map<string, Promise<WorkflowOption[]>>();
  await Promise.all(
    slots
      .filter(
        (s) =>
          s.field.lookup !== "stores" &&
          s.field.lookup !== "variants" &&
          s.field.lookup !== "lines" &&
          s.field.lookup !== "shifts",
      )
      .map(async (s) => {
        const value = workflowGet(values, s.path);
        if (!value && !["units", "registers"].includes(s.field.lookup!)) return;
        const key = `${s.field.lookup}:${value ?? ""}`;
        let pending = searchCache.get(key);
        if (!pending && s.field.lookup === "products") {
          pending = Promise.resolve(
            products
              .filter(
                (p) =>
                  p.id === value ||
                  p.barcodes.some((b) => b.value === value) ||
                  [p.name, p.sku].some((x) =>
                    x.toLocaleLowerCase().includes(String(value).toLocaleLowerCase()),
                  ),
              )
              .slice(0, 21)
              .map((p) => recordOption(p, input.locale)),
          );
          searchCache.set(key, pending);
        }
        if (!pending) {
          pending = baamSearch(ctx, {
            kind: s.field.lookup as Parameters<typeof baamSearch>[1]["kind"],
            query: typeof value === "string" && !/^c[a-z0-9]{20,}$/.test(value) ? value : undefined,
            storeId: s.field.lookup === "units" ? undefined : storeId,
            offset: 0,
          }).then((r) =>
            ((r as RecordValue).items as RecordValue[]).map((x) => recordOption(x, input.locale)),
          );
          searchCache.set(key, pending);
        }
        const options = await pending;
        const exact = options.filter(
          (o) =>
            o.value === value ||
            o.label.toLocaleLowerCase() === String(value).toLocaleLowerCase() ||
            o.detail?.split(" · ")[0]?.toLowerCase() === String(value).toLowerCase(),
        );
        const selected =
          exact.length === 1
            ? exact[0]
            : !isRecordId(value) && options.length === 1
              ? options[0]
              : undefined;
        if (selected) {
          values = workflowSet(values, s.path, selected.value);
          labels[s.path] = selected.label;
        } else {
          if (value && !isRecordId(value)) values = workflowSet(values, s.path, undefined);
          choices[s.path] = options;
        }
      }),
  );
  const variantCache = new Map<string, Promise<RecordValue[]>>();
  await Promise.all(
    slots
      .filter((s) => s.field.lookup === "variants")
      .map(async (s) => {
        const value = workflowGet(values, s.path);
        if (!value) return;
        const parent = s.path.split(".").slice(0, -1).join(".");
        const key = s.field.key === "componentVariantId" ? "componentProductId" : "productId";
        const productId = workflowGet(values, parent ? `${parent}.${key}` : key);
        if (typeof productId !== "string" || !isRecordId(productId)) {
          values = workflowSet(values, s.path, undefined);
          return;
        }
        let pending = variantCache.get(productId);
        if (!pending) {
          pending = baamInspect(ctx, { kind: "product", id: productId, storeId }).then(
            (r) => (r as { product: RecordValue }).product.variants ?? [],
          );
          variantCache.set(productId, pending);
        }
        const variants = await pending;
        const exact = variants.filter((v) =>
          [v.id, v.name, v.sku].some(
            (x) => x?.toLocaleLowerCase() === String(value).toLocaleLowerCase(),
          ),
        );
        if (exact.length === 1) {
          const option = recordOption(exact[0], input.locale);
          values = workflowSet(values, s.path, option.value);
          labels[s.path] = option.label;
        } else {
          if (!isRecordId(value)) values = workflowSet(values, s.path, undefined);
          choices[s.path] = variants.map((v) => recordOption(v, input.locale));
        }
      }),
  );
  return { parameters: values, labels, choices };
}

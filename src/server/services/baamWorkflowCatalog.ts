import { z } from "zod";
import { baamActions } from "./baamBusiness";
import { baamText } from "@/lib/baam/companion";
import { workflowTitle, type WorkflowField, type WorkflowLookupKind } from "@/lib/baam/workflows";
import { AppError } from "./errors";

import { workflowLabels as labels, workflowEnums as enums } from "@/lib/baam/workflowLabels";
const lookups: Record<string, WorkflowLookupKind> = {
  shiftId: "shifts",
  storeId: "stores",
  fromStoreId: "stores",
  toStoreId: "stores",
  sourceStoreId: "stores",
  destinationStoreId: "stores",
  baseUnitId: "units",
  supplierId: "suppliers",
  customerId: "customers",
  productId: "products",
  productIds: "products",
  componentProductId: "products",
  variantId: "variants",
  componentVariantId: "variants",
  registerId: "registers",
  saleId: "sales",
  originalSaleId: "sales",
  customerOrderId: "orders",
  purchaseOrderId: "purchases",
  saleReturnId: "returns",
  stockCountId: "stock_counts",
  lineId: "lines",
  returnLineId: "lines",
  customerOrderLineId: "lines",
};
const primary: Record<string, string[]> = {
  product_create: ["name", "storeId", "baseUnitId", "basePriceKgs", "imageChoice", "attachmentId"],
  product_update: ["productId", "name", "basePriceKgs", "photo", "attachmentId"],
  stock_receive: ["storeId", "supplierName", "lines"],
  pos_create_draft: ["storeId", "registerId", "lines"],
  supplier_create: ["name", "phone", "email"],
  customer_create: ["storeId", "name", "phone", "email"],
};
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable)
    return unwrap(schema.unwrap());
  if (schema instanceof z.ZodDefault) return unwrap(schema.removeDefault());
  if (schema instanceof z.ZodEffects) return unwrap(schema.innerType());
  return schema;
}
export function describeWorkflowField(
  key: string,
  schema: z.ZodTypeAny,
  locale: string,
): WorkflowField {
  const raw = unwrap(schema),
    label = labels[key] ?? ["Значение", "Value", "Маани"];
  const field: WorkflowField = {
    key,
    label: baamText(locale, ...label),
    kind: "text",
    required: !schema.isOptional() && !schema.isNullable(),
  };
  if (raw instanceof z.ZodObject) {
    field.kind = "object";
    field.fields = Object.entries(raw.shape).map(([name, value]) =>
      describeWorkflowField(name, value as z.ZodTypeAny, locale),
    );
  } else if (raw instanceof z.ZodArray) {
    field.kind = "array";
    field.item = describeWorkflowField(
      key === "productIds" ? "productId" : key,
      raw.element,
      locale,
    );
    field.item.required = true;
    field.min = raw._def.minLength?.value;
    field.max = raw._def.maxLength?.value ?? 40;
  } else if (raw instanceof z.ZodNumber) {
    field.kind = "number";
    field.integer = raw.isInt;
    field.min = raw.minValue ?? undefined;
    field.max = raw.maxValue ?? undefined;
  } else if (raw instanceof z.ZodBoolean) field.kind = "boolean";
  else if (raw instanceof z.ZodEnum || raw instanceof z.ZodNativeEnum) {
    field.kind = "select";
    const values: unknown[] = raw instanceof z.ZodEnum ? raw.options : Object.values(raw.enum);
    field.options = values
      .filter((v): v is string => typeof v === "string")
      .map((value) => ({ value, label: enums[value] ? baamText(locale, ...enums[value]) : value }));
  } else if (raw instanceof z.ZodString && raw.isDatetime) field.kind = "date";
  if (lookups[key] && field.kind !== "array") {
    field.kind = "lookup";
    field.lookup = lookups[key];
  }
  if (key === "attachmentId") field.kind = "photo";
  return field;
}
const cachedFields = new Map<string, WorkflowField[]>();
export function workflowFields(kind: string, locale: string): WorkflowField[] {
  const cacheKey = `${kind}:${locale}`;
  const cached = cachedFields.get(cacheKey);
  if (cached) return structuredClone(cached);
  const action = baamActions[kind];
  if (!action) throw new AppError("baamActionUnavailable", "BAD_REQUEST", 400);
  const raw = unwrap(action.schema);
  if (!(raw instanceof z.ZodObject))
    throw new AppError("baamActionUnavailable", "BAD_REQUEST", 400);
  let fields = Object.entries(raw.shape).map(([key, schema]) =>
    describeWorkflowField(key, schema as z.ZodTypeAny, locale),
  );
  const line = /^(purchase|order|pos|return)_(add|update|remove)_line$/.exec(kind);
  if (line) {
    const mode = line[2];
    fields = fields.filter(
      (f) =>
        !(mode !== "add" && ["productId", "variantId", "customerOrderLineId"].includes(f.key)) &&
        !(mode === "add" && ["lineId", "returnLineId"].includes(f.key)) &&
        !(mode === "remove" && ["qty", "qtyOrdered", "unitCost", "unitPriceKgs"].includes(f.key)),
    );
    for (const f of fields) {
      if (
        (["lineId", "returnLineId"].includes(f.key) && mode !== "add") ||
        (["productId", "customerOrderLineId"].includes(f.key) && mode === "add") ||
        (f.key === "qtyOrdered" && mode !== "remove") ||
        (f.key === "qty" && mode === "add")
      )
        f.required = true;
    }
  }
  if (kind === "pos_create_draft")
    fields.unshift(describeWorkflowField("storeId", z.string().optional(), locale));
  for (const f of fields) {
    if (primary[kind]) f.advanced = !primary[kind].includes(f.key);
    if (f.key === "imageChoice") f.advanced = true;
    if (f.key === "attachmentId") f.advanced = false;
  }
  const order = primary[kind];
  if (order)
    fields.sort(
      (a, b) =>
        (order.includes(a.key) ? order.indexOf(a.key) : 99) -
        (order.includes(b.key) ? order.indexOf(b.key) : 99),
    );
  cachedFields.set(cacheKey, fields);
  return structuredClone(fields);
}
export const workflowCatalog = (role: string, locale: string) =>
  Object.values(baamActions)
    .filter((a) => a.roles.includes(role))
    .map((a) => ({
      kind: a.name,
      title: workflowTitle(a.name, locale),
      fields: workflowFields(a.name, locale),
    }));
export function workflowFieldAt(fields: WorkflowField[], path: string): WorkflowField | undefined {
  const keys = path.split(".");
  let field: WorkflowField | undefined;
  for (let i = 0; i < keys.length; i++) {
    field = fields.find((f) => f.key === keys[i]);
    if (!field) return undefined;
    if (i === keys.length - 1) return field;
    if (field.kind === "array") {
      if (!/^\d+$/.test(keys[++i]) || Number(keys[i]) >= 40) return undefined;
      field = field.item;
      if (i === keys.length - 1) return field;
    }
    fields = field?.fields ?? [];
  }
  return field;
}
export function workflowFieldLabel(key: string, locale: string) {
  return baamText(locale, ...(labels[key] ?? ["Значение", "Value", "Маани"]));
}

import type { WorkflowValues } from "@/lib/baam/workflows";
export type BaamRecentRecord = { kind: string; resourceId: string; name?: string };

// Bind explicit pronouns to a server-owned conversational reference. A named
// different record is never replaced, and normal access checks still run later.
export function bindBaamRecentRecord(
  text: string,
  action: string,
  parameters: WorkflowValues,
  recent: BaamRecentRecord[],
): WorkflowValues {
  if (
    !/(?:\b(?:it|its|this product|that product|this customer|this supplier)\b|(?<!\p{L})(?:ему|его|ей|её|ее|этому товару|этого товара|этот товар|ушул товар|анын)(?!\p{L}))/iu.test(
      text,
    )
  )
    return parameters;
  const entity = action.startsWith("product_")
    ? "product"
    : action.startsWith("customer_")
      ? "customer"
      : action.startsWith("supplier_")
        ? "supplier"
        : null;
  if (!entity || action.endsWith("_create")) return parameters;
  const record = recent.find((r) => r.kind.startsWith(`${entity}_`));
  if (!record) return parameters;
  const name =
    record.name ?? recent.find((r) => r.resourceId === record.resourceId && r.name)?.name;
  const key = `${entity}Id`,
    value = parameters[key];
  if (
    value &&
    value !== record.resourceId &&
    value !== name &&
    !/^(?:он|она|его|её|ее|этот товар|этого товара|this product|it)$/iu.test(String(value))
  )
    return parameters;
  return { ...parameters, [key]: record.resourceId };
}

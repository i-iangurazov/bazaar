import { z } from "zod";

const id = z.string().min(1).max(200);
const inputSchema = z.object({
  storeId: id,
  idempotencyKey: z.string().min(8).max(200),
  priceMode: z.enum(["RETAIL", "WHOLESALE"]).optional(),
  customerId: id.nullable().optional(),
  customerName: z.string().max(180).nullable().optional(),
  customerEmail: z.string().max(254).nullable().optional(),
  customerPhone: z.string().max(64).nullable().optional(),
  customerAddress: z.string().max(512).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  lines: z
    .array(
      z.object({
        productId: id,
        variantId: id.nullable().optional(),
        qty: z.number().finite().positive(),
        unitPriceKgs: z.number().finite().min(0).max(9_999_999_999.99).optional(),
      }),
    )
    .min(1)
    .max(10_000),
});

const pendingSchema = z.object({
  version: z.literal(1),
  userId: id,
  organizationId: id,
  input: inputSchema,
  storeName: z.string().max(200),
  totalLabel: z.string().max(200),
});

export type PendingSalesOrderSale = z.infer<typeof pendingSchema>;
type Owner = Pick<PendingSalesOrderSale, "userId" | "organizationId">;
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

const key = (owner: Owner) =>
  `bazaar:sales-pending:v1:${encodeURIComponent(owner.organizationId)}:${encodeURIComponent(owner.userId)}`;

/** Persist before posting. A lost response or page reload must reuse the exact request. */
export function writePendingSalesOrderSale(storage: Storage, pending: PendingSalesOrderSale) {
  const parsed = pendingSchema.parse(pending);
  storage.setItem(key(parsed), JSON.stringify(parsed));
}

export function readPendingSalesOrderSale(
  storage: Storage,
  owner: Owner,
): PendingSalesOrderSale | null {
  const raw = storage.getItem(key(owner));
  if (raw === null) return null;
  const result = pendingSchema.safeParse(JSON.parse(raw));
  if (
    !result.success ||
    result.data.userId !== owner.userId ||
    result.data.organizationId !== owner.organizationId
  ) {
    throw new Error("invalidPendingSalesOrderSale");
  }
  return result.data;
}

/** A late response cannot clear a newer attempt. */
export function clearPendingSalesOrderSale(storage: Storage, pending: PendingSalesOrderSale) {
  const current = readPendingSalesOrderSale(storage, pending);
  if (current?.input.idempotencyKey === pending.input.idempotencyKey)
    storage.removeItem(key(pending));
}

export function isSafeSalesOrderFailure(error: {
  message?: string;
  data?: { code?: string } | null;
}) {
  // These errors originate inside the operation handler after replay lookup.
  // Authentication/permissions/validation can fail before that lookup and do
  // not prove that a previous request failed to commit.
  return [
    "insufficientStock",
    "productNotFound",
    "variantNotFound",
    "salesOrderEmpty",
    "wholeQuantityRequired",
    "invalidQuantity",
    "salesOrderPriceRequired",
    "customerNotFound",
    "customerPhoneInvalid",
    "customerAddressInvalid",
  ].includes(error.message ?? "");
}

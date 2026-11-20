import { z } from "zod";

const identifier = z.string().min(1);
const priceMode = z.enum(["RETAIL", "WHOLESALE"]);
const draftLine = z.object({
  lineId: identifier.nullish(),
  productId: identifier,
  variantId: identifier.nullish(),
  productName: z.string(),
  productSku: z.string(),
  qty: z.number().finite(),
  qtyInput: z.string(),
  isBundle: z.boolean(),
  unitPriceKgs: z.number().finite().nonnegative().max(9_999_999_999.99).nullable(),
  lineTotalKgs: z.number().finite().nonnegative().nullable(),
  priceInput: z.string(),
  priceEdited: z.boolean(),
  priceTouched: z.boolean().optional(),
  priceSource: z.enum(["RETAIL", "WHOLESALE", "STANDARD", "MISSING", "MANUAL"]).optional(),
  repriced: z.boolean().optional(),
});

const draftSchema = z.object({
  id: identifier,
  storeId: z.string(),
  priceMode,
  selectedCustomer: z.object({
    id: identifier,
    name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    address: z.string().nullable(),
  }).nullable(),
  customerSelectionTouched: z.boolean(),
  customerName: z.string(),
  customerEmail: z.string(),
  customerPhone: z.string(),
  customerAddress: z.string(),
  notes: z.string(),
  lineSearch: z.string(),
  pendingQty: z.string(),
  lines: z.array(draftLine).max(10_000),
  saveAttempt: z.object({
    payload: z.string(),
    idempotencyKey: z.string().min(8).max(200),
  }).nullable(),
});

export type SalesOrderDraft = z.infer<typeof draftSchema>;
export type SalesOrderDraftLine = z.infer<typeof draftLine>;
type Owner = { userId: string; organizationId: string };
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

const key = ({ organizationId, userId }: Owner) =>
  `bazaar:sales-draft:v1:${encodeURIComponent(organizationId)}:${encodeURIComponent(userId)}`;

export function readSalesOrderDraft(storage: Storage, owner: Owner): SalesOrderDraft | null {
  const raw = storage.getItem(key(owner));
  if (raw === null) return null;
  return draftSchema.parse(JSON.parse(raw));
}

export function writeSalesOrderDraft(storage: Storage, owner: Owner, draft: SalesOrderDraft) {
  storage.setItem(key(owner), JSON.stringify(draft));
}

export function clearSalesOrderDraft(storage: Storage, owner: Owner, draftId: string) {
  if (readSalesOrderDraft(storage, owner)?.id === draftId) storage.removeItem(key(owner));
}

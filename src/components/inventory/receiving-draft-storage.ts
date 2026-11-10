import { reviewedStockReceivingSchema, type ReviewedStockReceiving } from "@/lib/stockReceivingCommerce";
import { parsePriceInput } from "@/lib/priceInput";
import { convertToKgs, normalizeCurrencyCode } from "@/lib/currency";

export const RECEIVING_DRAFT_STORAGE_VERSION = 2 as const;
export const RECEIVING_DRAFT_TTL_MS = 8 * 60 * 60 * 1_000;

const receivingDraftStoragePrefix = "bazaar:inventory-receiving-draft:";
const maximumStoredDraftBytes = 1_000_000;
const maximumDraftLines = 500;

export type ReceivingDraftIdentity = {
  organizationId: string;
  userId: string;
  storeId: string;
};

export type ReceivingDraftLine = {
  key: string;
  productId: string;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  sku: string;
  barcode: string | null;
  imageUrl: string | null;
  currentStock: number;
  unitCostInput: string;
  quantityInput: string;
  salePriceInput?: string;
  duplicateHint?: boolean;
  storeWarning?: "notAssigned";
};

export type ReceivingDraftFocus =
  | { target: "search" }
  | { target: "lineInput"; key: string; field: "quantity" | "unitCost" | "salePrice" };

export type ReceivingDraft = {
  storeId: string;
  dateTime: string;
  exactDateIso?: string;
  supplierName: string;
  referenceNumber: string;
  note: string;
  search: string;
  lines: ReceivingDraftLine[];
  currencyCode?: string;
  currencyRateKgsPerUnit?: number;
  pageScrollY?: number;
  searchResultsScrollTop?: number;
  focusedElement?: ReceivingDraftFocus | null;
};

type ReceivingDraftRecord = {
  version: typeof RECEIVING_DRAFT_STORAGE_VERSION;
  namespace: ReceivingDraftIdentity;
  createdAtMs: number;
  expiresAtMs: number;
  draft: ReceivingDraft;
};

type ReceivingDraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type ReceivingDraftStorageOptions = {
  storage?: ReceivingDraftStorage;
  nowMs?: number;
};

const resolveStorage = (storage?: ReceivingDraftStorage) => {
  if (storage) {
    return storage;
  }
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const validOpaqueKey = (value: string) =>
  value.length >= 8 && value.length <= 160 && /^[A-Za-z0-9_-]+$/.test(value);

const validIdentityPart = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 191 && value === value.trim();

const validIdentity = (value: unknown): value is ReceivingDraftIdentity => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const identity = value as Partial<ReceivingDraftIdentity>;
  return (
    validIdentityPart(identity.organizationId) &&
    validIdentityPart(identity.userId) &&
    validIdentityPart(identity.storeId)
  );
};

const sameIdentity = (left: ReceivingDraftIdentity, right: ReceivingDraftIdentity) =>
  left.organizationId === right.organizationId &&
  left.userId === right.userId &&
  left.storeId === right.storeId;

const validNullableString = (value: unknown) => value === null || typeof value === "string";
const validOptionalScrollPosition = (value: unknown) =>
  value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0);

const validFocus = (value: unknown): value is ReceivingDraftFocus | null | undefined => {
  if (value === undefined || value === null) {
    return true;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const focus = value as Partial<ReceivingDraftFocus>;
  if (focus.target === "search") {
    return true;
  }
  return (
    focus.target === "lineInput" &&
    typeof focus.key === "string" &&
    focus.key.length > 0 &&
    (focus.field === "quantity" || focus.field === "unitCost" || focus.field === "salePrice")
  );
};

const validLine = (value: unknown): value is ReceivingDraftLine => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const line = value as Partial<ReceivingDraftLine>;
  return (
    typeof line.key === "string" &&
    line.key.length > 0 &&
    typeof line.productId === "string" &&
    line.productId.length > 0 &&
    validNullableString(line.variantId) &&
    typeof line.productName === "string" &&
    validNullableString(line.variantName) &&
    typeof line.sku === "string" &&
    validNullableString(line.barcode) &&
    validNullableString(line.imageUrl) &&
    typeof line.currentStock === "number" &&
    Number.isFinite(line.currentStock) &&
    typeof line.unitCostInput === "string" &&
    typeof line.quantityInput === "string" &&
    (line.salePriceInput === undefined || typeof line.salePriceInput === "string") &&
    (line.duplicateHint === undefined || typeof line.duplicateHint === "boolean") &&
    (line.storeWarning === undefined || line.storeWarning === "notAssigned")
  );
};

const validDraft = (value: unknown): value is ReceivingDraft => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const draft = value as Partial<ReceivingDraft>;
  return (
    validIdentityPart(draft.storeId) &&
    typeof draft.dateTime === "string" &&
    (draft.exactDateIso === undefined || (typeof draft.exactDateIso === "string" &&
      draft.exactDateIso.length <= 40 && Number.isFinite(Date.parse(draft.exactDateIso)))) &&
    typeof draft.supplierName === "string" &&
    typeof draft.referenceNumber === "string" &&
    typeof draft.note === "string" &&
    typeof draft.search === "string" &&
    Array.isArray(draft.lines) &&
    draft.lines.length <= maximumDraftLines &&
    draft.lines.every(validLine) &&
    (draft.currencyCode === undefined || ["KGS", "USD", "GBP"].includes(draft.currencyCode)) &&
    (draft.currencyRateKgsPerUnit === undefined || (typeof draft.currencyRateKgsPerUnit === "number" &&
      Number.isFinite(draft.currencyRateKgsPerUnit) && draft.currencyRateKgsPerUnit > 0)) &&
    validOptionalScrollPosition(draft.pageScrollY) &&
    validOptionalScrollPosition(draft.searchResultsScrollTop) &&
    validFocus(draft.focusedElement)
  );
};

export const getReceivingDraftStorageKey = (key: string) => `${receivingDraftStoragePrefix}${key}`;

export const removeReceivingDraft = (
  key: string,
  options: Pick<ReceivingDraftStorageOptions, "storage"> = {},
) => {
  if (!validOpaqueKey(key)) {
    return false;
  }
  const storage = resolveStorage(options.storage);
  if (!storage) {
    return false;
  }
  try {
    storage.removeItem(getReceivingDraftStorageKey(key));
    return true;
  } catch {
    return false;
  }
};

export const writeReceivingDraft = (
  key: string,
  namespace: ReceivingDraftIdentity,
  draft: ReceivingDraft,
  options: ReceivingDraftStorageOptions = {},
) => {
  if (
    !validOpaqueKey(key) ||
    !validIdentity(namespace) ||
    !validDraft(draft) ||
    draft.storeId !== namespace.storeId
  ) {
    return false;
  }
  const storage = resolveStorage(options.storage);
  if (!storage) {
    return false;
  }
  const createdAtMs = options.nowMs ?? Date.now();
  if (!Number.isFinite(createdAtMs) || createdAtMs < 0) {
    return false;
  }
  const record: ReceivingDraftRecord = {
    version: RECEIVING_DRAFT_STORAGE_VERSION,
    namespace,
    createdAtMs,
    expiresAtMs: createdAtMs + RECEIVING_DRAFT_TTL_MS,
    draft,
  };
  try {
    const serialized = JSON.stringify(record);
    if (serialized.length > maximumStoredDraftBytes) {
      return false;
    }
    storage.setItem(getReceivingDraftStorageKey(key), serialized);
    return true;
  } catch {
    return false;
  }
};

export const consumeReceivingDraft = (
  key: string,
  expectedNamespace: ReceivingDraftIdentity,
  options: ReceivingDraftStorageOptions = {},
): ReceivingDraft | null => {
  if (!validOpaqueKey(key) || !validIdentity(expectedNamespace)) {
    return null;
  }
  const storage = resolveStorage(options.storage);
  if (!storage) {
    return null;
  }

  let raw: string | null;
  try {
    raw = storage.getItem(getReceivingDraftStorageKey(key));
    if (raw === null) {
      return null;
    }
    // Draft handoff is intentionally one-shot. Never restore state that could
    // not also be removed from a shared browser session.
    storage.removeItem(getReceivingDraftStorageKey(key));
  } catch {
    return null;
  }

  if (raw.length > maximumStoredDraftBytes) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ReceivingDraftRecord>;
    const nowMs = options.nowMs ?? Date.now();
    if (
      parsed.version !== RECEIVING_DRAFT_STORAGE_VERSION ||
      !validIdentity(parsed.namespace) ||
      !sameIdentity(parsed.namespace, expectedNamespace) ||
      !Number.isFinite(nowMs) ||
      typeof parsed.createdAtMs !== "number" ||
      !Number.isFinite(parsed.createdAtMs) ||
      typeof parsed.expiresAtMs !== "number" ||
      !Number.isFinite(parsed.expiresAtMs) ||
      parsed.createdAtMs > nowMs ||
      parsed.expiresAtMs <= nowMs ||
      parsed.expiresAtMs - parsed.createdAtMs !== RECEIVING_DRAFT_TTL_MS ||
      !validDraft(parsed.draft) ||
      parsed.draft.storeId !== expectedNamespace.storeId
    ) {
      return null;
    }
    return parsed.draft;
  } catch {
    return null;
  }
};

// An unresolved financial operation must survive reload and must not expire into
// an apparently new receipt. Only a confirmed POSTED/CANCELED result removes it.
export type ReceivingPendingOperation = {
  request: ReviewedStockReceiving;
  draft: ReceivingDraft;
};
const pendingStorageKey = (identity: ReceivingDraftIdentity) =>
  `bazaar:inventory-receiving-pending:${encodeURIComponent(identity.organizationId)}:${encodeURIComponent(identity.userId)}:${encodeURIComponent(identity.storeId)}`;

export const hasReceivingPending = (
  identity: ReceivingDraftIdentity,
  options: Pick<ReceivingDraftStorageOptions, "storage"> = {},
) => {
  if (!validIdentity(identity)) return false;
  return readReceivingPendingState(identity, options).status !== "EMPTY";
};

const validPendingDisplay = (pending: ReceivingPendingOperation) => {
  const { draft, request } = pending;
  if (!draft.currencyCode || draft.currencyRateKgsPerUnit === undefined ||
      (draft.currencyCode === "KGS" && draft.currencyRateKgsPerUnit !== 1) ||
      draft.lines.length !== request.receiving.lines.length) return false;
  if ((draft.supplierName.trim() || undefined) !== request.receiving.supplierName ||
      (draft.referenceNumber.trim() || undefined) !== request.receiving.referenceNumber ||
      (draft.note.trim() || undefined) !== request.receiving.note) return false;
  if (request.receiving.date && Date.parse(draft.exactDateIso ?? draft.dateTime) !== Date.parse(request.receiving.date)) return false;
  return draft.lines.every((line, index) => {
    const frozen = request.receiving.lines[index];
    if (line.key !== `${line.productId}:${line.variantId ?? "BASE"}` ||
        line.productId !== frozen.productId || line.variantId !== (frozen.variantId ?? null) ||
        Number(line.quantityInput.replace(",", ".")) !== frozen.quantity ||
        parsePriceInput(line.unitCostInput) !== frozen.unitCost) return false;
    const draftPrice = line.salePriceInput?.trim() ? parsePriceInput(line.salePriceInput) : undefined;
    if (draftPrice === null) return false;
    const priceKgs = draftPrice === undefined ? undefined : Number(convertToKgs(
      draftPrice, draft.currencyRateKgsPerUnit!, normalizeCurrencyCode(draft.currencyCode),
    ).toFixed(2));
    return priceKgs === frozen.salePriceKgs;
  });
};

export const removeReceivingPending = (
  identity: ReceivingDraftIdentity,
  expectedIdempotencyKey: string,
  options: Pick<ReceivingDraftStorageOptions, "storage"> = {},
) => {
  if (!validIdentity(identity)) return false;
  try {
    const storage = resolveStorage(options.storage);
    if (!storage) return false;
    const raw = storage.getItem(pendingStorageKey(identity));
    if (raw === null) return true;
    const record = JSON.parse(raw);
    if (!validIdentity(record.identity) || !sameIdentity(record.identity, identity) ||
        record.pending?.request?.idempotencyKey !== expectedIdempotencyKey) return false;
    storage.removeItem(pendingStorageKey(identity));
    return true;
  } catch { return false; }
};

export const writeReceivingPending = (
  identity: ReceivingDraftIdentity,
  pending: ReceivingPendingOperation,
  options: Pick<ReceivingDraftStorageOptions, "storage"> = {},
) => {
  if (!validIdentity(identity) || !validDraft(pending.draft) ||
      pending.draft.storeId !== identity.storeId) return false;
  const request = reviewedStockReceivingSchema.safeParse(pending.request);
  if (!request.success || request.data.receiving.storeId !== identity.storeId ||
      !validPendingDisplay({ ...pending, request: request.data })) return false;
  try {
    const storage = resolveStorage(options.storage);
    if (!storage) return false;
    const raw = JSON.stringify({ version: 1, identity, pending: { ...pending, request: request.data } });
    if (raw.length > maximumStoredDraftBytes) return false;
    const previous = storage.getItem(pendingStorageKey(identity));
    if (previous !== null) return previous === raw;
    storage.setItem(pendingStorageKey(identity), raw);
    // Refuse a write-only or silently unavailable storage before posting.
    return storage.getItem(pendingStorageKey(identity)) === raw;
  } catch { return false; }
};

export const readReceivingPending = (
  identity: ReceivingDraftIdentity,
  options: Pick<ReceivingDraftStorageOptions, "storage"> = {},
): ReceivingPendingOperation | null => {
  const result = readReceivingPendingState(identity, options);
  return result.status === "PENDING" ? result.pending : null;
};

export type ReceivingPendingState =
  | { status: "EMPTY" | "UNAVAILABLE" | "INVALID" }
  | { status: "PENDING"; pending: ReceivingPendingOperation };

export const readReceivingPendingState = (
  identity: ReceivingDraftIdentity,
  options: Pick<ReceivingDraftStorageOptions, "storage"> = {},
): ReceivingPendingState => {
  if (!validIdentity(identity)) return { status: "INVALID" };
  let raw: string | null;
  try {
    const storage = resolveStorage(options.storage);
    if (!storage) return { status: "UNAVAILABLE" };
    raw = storage.getItem(pendingStorageKey(identity));
  } catch { return { status: "UNAVAILABLE" }; }
  if (raw === null) return { status: "EMPTY" };
  if (raw.length > maximumStoredDraftBytes) return { status: "INVALID" };
  try {
    const record = JSON.parse(raw);
    const request = reviewedStockReceivingSchema.safeParse(record.pending?.request);
    if (record.version !== 1 || !validIdentity(record.identity) ||
        !sameIdentity(record.identity, identity) || !request.success ||
        request.data.receiving.storeId !== identity.storeId ||
        !validDraft(record.pending?.draft) || record.pending.draft.storeId !== identity.storeId)
      return { status: "INVALID" };
    const pending = { request: request.data, draft: record.pending.draft };
    return validPendingDisplay(pending) ? { status: "PENDING", pending } : { status: "INVALID" };
  } catch { return { status: "INVALID" }; }
};

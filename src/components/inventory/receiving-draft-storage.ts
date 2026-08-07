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
  duplicateHint?: boolean;
  storeWarning?: "notAssigned";
};

export type ReceivingDraftFocus =
  | { target: "search" }
  | { target: "lineInput"; key: string; field: "quantity" | "unitCost" };

export type ReceivingDraft = {
  storeId: string;
  dateTime: string;
  supplierName: string;
  referenceNumber: string;
  note: string;
  search: string;
  lines: ReceivingDraftLine[];
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
    (focus.field === "quantity" || focus.field === "unitCost")
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
    typeof draft.supplierName === "string" &&
    typeof draft.referenceNumber === "string" &&
    typeof draft.note === "string" &&
    typeof draft.search === "string" &&
    Array.isArray(draft.lines) &&
    draft.lines.length <= maximumDraftLines &&
    draft.lines.every(validLine) &&
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

import { formatCurrencyKGS, formatDate, formatNumber } from "@/lib/i18nFormat";

export type SessionRole = "ADMIN" | "MANAGER" | "STAFF" | "CASHIER" | string | null | undefined;

export type InlineEditInputType = "text" | "number" | "select" | "date" | "money";

export type InlineEditTableKey =
  | "products"
  | "inventory"
  | "suppliers"
  | "stores"
  | "users"
  | "units";

export type InlineMutationRoute =
  | "products.inlineUpdate"
  | "products.bulkUpdateCategory"
  | "storePrices.upsert"
  | "inventory.setMinStock"
  | "suppliers.update"
  | "stores.update"
  | "stores.updatePolicy"
  | "stores.updateLegalDetails"
  | "users.update"
  | "users.setActive"
  | "units.update";

export type InlineMutationInputByRoute = {
  "products.inlineUpdate": {
    productId: string;
    patch: {
      name?: string;
      baseUnitId?: string;
      basePriceKgs?: number | null;
    };
  };
  "products.bulkUpdateCategory": {
    productIds: string[];
    category: string | null;
  };
  "storePrices.upsert": {
    storeId: string;
    productId: string;
    variantId: string | null;
    priceKgs: number;
  };
  "inventory.setMinStock": {
    storeId: string;
    productId: string;
    minStock: number;
  };
  "suppliers.update": {
    supplierId: string;
    name: string;
    email?: string;
    phone?: string;
    notes?: string;
  };
  "stores.update": {
    storeId: string;
    name: string;
    code: string;
  };
  "stores.updatePolicy": {
    storeId: string;
    allowNegativeStock: boolean;
    trackExpiryLots: boolean;
  };
  "stores.updateLegalDetails": {
    storeId: string;
    legalEntityType: "IP" | "OSOO" | "AO" | "OTHER" | null;
    legalName: string | null;
    inn: string | null;
    address: string | null;
    phone: string | null;
  };
  "users.update": {
    userId: string;
    email: string;
    name: string;
    role: "ADMIN" | "MANAGER" | "STAFF" | "CASHIER";
    preferredLocale: "ru" | "kg";
  };
  "users.setActive": {
    userId: string;
    isActive: boolean;
  };
  "units.update": {
    unitId: string;
    labelRu: string;
    labelKg: string;
  };
};

export type InlineMutationOperation<R extends InlineMutationRoute = InlineMutationRoute> =
  R extends InlineMutationRoute
    ? {
        route: R;
        input: InlineMutationInputByRoute[R];
      }
    : never;

export type InlineParseResult<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; errorKey: string };

export type InlineDisplayContext = {
  locale: string;
  notAvailableLabel: string;
  tTable: (key: string) => string;
  tCommon: (key: string) => string;
};

export type InlineSelectOption = {
  value: string;
  label: string;
};

export type InlineEditColumnDefinition<TRow, TValue, TContext> = {
  tableKey: InlineEditTableKey;
  columnKey: string;
  inputType: InlineEditInputType;
  formatter: (value: TValue, row: TRow, context: TContext, display: InlineDisplayContext) => string;
  parser: (raw: string, row: TRow, context: TContext) => InlineParseResult<TValue>;
  mutation: (row: TRow, value: TValue, context: TContext) => InlineMutationOperation;
  permissionCheck: (role: SessionRole, row: TRow, context: TContext) => boolean;
  selectOptions?: (row: TRow, context: TContext, display: InlineDisplayContext) => InlineSelectOption[];
  equals?: (left: TValue, right: TValue) => boolean;
};

export type InlineProductsRow = {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  baseUnitId: string;
  basePriceKgs: number | null;
};

export type InlineProductsContext = {
  storeId?: string | null;
  categories: string[];
};

export type InlineInventoryRow = {
  snapshot: {
    storeId: string;
    productId: string;
  };
  minStock: number;
};

export type InlineSuppliersRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
};

export type InlineStoresRow = {
  id: string;
  name: string;
  code: string;
  allowNegativeStock: boolean;
  trackExpiryLots: boolean;
  legalEntityType: "IP" | "OSOO" | "AO" | "OTHER" | null;
  legalName: string | null;
  inn: string | null;
  address: string | null;
  phone: string | null;
};

export type InlineUsersRow = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "MANAGER" | "STAFF" | "CASHIER";
  preferredLocale: string;
  isActive: boolean;
};

export type InlineUsersContext = {
  currentUserId?: string | null;
};

export type InlineUnitsRow = {
  id: string;
  labelRu: string;
  labelKg: string;
};

const isAdmin = (role: SessionRole) => role === "ADMIN";

const isManagerOrAdmin = (role: SessionRole) => role === "ADMIN" || role === "MANAGER";

const trimToNull = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const trimToOptional = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

const parseRequiredText = (raw: string): InlineParseResult<string> => {
  const trimmed = raw.trim();
  if (!trimmed.length) {
    return { ok: false, errorKey: "validationError" };
  }
  return { ok: true, value: trimmed };
};

const parseNullableText = (raw: string): InlineParseResult<string | null> => ({
  ok: true,
  value: trimToNull(raw),
});

const parseNonNegativeMoney = (raw: string): InlineParseResult<number> => {
  const normalized = raw.replace(/\s+/g, "").replace(",", ".");
  if (!normalized.length) {
    return { ok: false, errorKey: "validationError" };
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ok: false, errorKey: "validationError" };
  }
  return { ok: true, value: parsed };
};

const parseNonNegativeInt = (raw: string): InlineParseResult<number> => {
  const normalized = raw.replace(/\s+/g, "");
  if (!normalized.length) {
    return { ok: false, errorKey: "validationError" };
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    return { ok: false, errorKey: "validationError" };
  }
  return { ok: true, value: parsed };
};

const parseBooleanSelect = (raw: string): InlineParseResult<boolean> => {
  if (raw === "true") {
    return { ok: true, value: true };
  }
  if (raw === "false") {
    return { ok: true, value: false };
  }
  return { ok: false, errorKey: "validationError" };
};

const parseRoleSelect = (
  raw: string,
): InlineParseResult<"ADMIN" | "MANAGER" | "STAFF" | "CASHIER"> => {
  if (raw === "ADMIN" || raw === "MANAGER" || raw === "STAFF" || raw === "CASHIER") {
    return { ok: true, value: raw };
  }
  return { ok: false, errorKey: "validationError" };
};

const parseLocaleSelect = (raw: string): InlineParseResult<"ru" | "kg"> => {
  if (raw === "ru" || raw === "kg") {
    return { ok: true, value: raw };
  }
  return { ok: false, errorKey: "validationError" };
};

const normalizePreferredLocale = (value: string): "ru" | "kg" => {
  return value === "kg" ? "kg" : "ru";
};

const parseLegalTypeSelect = (
  raw: string,
): InlineParseResult<"IP" | "OSOO" | "AO" | "OTHER" | null> => {
  if (!raw || raw === "none") {
    return { ok: true, value: null };
  }
  if (raw === "IP" || raw === "OSOO" || raw === "AO" || raw === "OTHER") {
    return { ok: true, value: raw };
  }
  return { ok: false, errorKey: "validationError" };
};

const formatText = (value: string | null | undefined, notAvailableLabel: string) =>
  value && value.trim().length ? value : notAvailableLabel;

const formatMoney = (value: number | null | undefined, locale: string, notAvailableLabel: string) =>
  value === null || value === undefined ? notAvailableLabel : formatCurrencyKGS(value, locale);

const formatInt = (value: number | null | undefined, locale: string, notAvailableLabel: string) =>
  value === null || value === undefined ? notAvailableLabel : formatNumber(value, locale);

export type InlineEditRegistry = {
  products: {
    name: InlineEditColumnDefinition<InlineProductsRow, string, InlineProductsContext>;
    category: InlineEditColumnDefinition<InlineProductsRow, string | null, InlineProductsContext>;
    salePrice: InlineEditColumnDefinition<InlineProductsRow, number | null, InlineProductsContext>;
  };
  inventory: {
    minStock: InlineEditColumnDefinition<InlineInventoryRow, number, Record<string, never>>;
  };
  suppliers: {
    name: InlineEditColumnDefinition<InlineSuppliersRow, string, Record<string, never>>;
    email: InlineEditColumnDefinition<InlineSuppliersRow, string | null, Record<string, never>>;
    phone: InlineEditColumnDefinition<InlineSuppliersRow, string | null, Record<string, never>>;
    notes: InlineEditColumnDefinition<InlineSuppliersRow, string | null, Record<string, never>>;
  };
  stores: {
    name: InlineEditColumnDefinition<InlineStoresRow, string, Record<string, never>>;
    code: InlineEditColumnDefinition<InlineStoresRow, string, Record<string, never>>;
    allowNegativeStock: InlineEditColumnDefinition<InlineStoresRow, boolean, Record<string, never>>;
    trackExpiryLots: InlineEditColumnDefinition<InlineStoresRow, boolean, Record<string, never>>;
    legalEntityType: InlineEditColumnDefinition<
      InlineStoresRow,
      "IP" | "OSOO" | "AO" | "OTHER" | null,
      Record<string, never>
    >;
    inn: InlineEditColumnDefinition<InlineStoresRow, string | null, Record<string, never>>;
  };
  users: {
    name: InlineEditColumnDefinition<InlineUsersRow, string, InlineUsersContext>;
    email: InlineEditColumnDefinition<InlineUsersRow, string, InlineUsersContext>;
    role: InlineEditColumnDefinition<
      InlineUsersRow,
      "ADMIN" | "MANAGER" | "STAFF" | "CASHIER",
      InlineUsersContext
    >;
    preferredLocale: InlineEditColumnDefinition<InlineUsersRow, string, InlineUsersContext>;
    isActive: InlineEditColumnDefinition<InlineUsersRow, boolean, InlineUsersContext>;
  };
  units: {
    labelRu: InlineEditColumnDefinition<InlineUnitsRow, string, Record<string, never>>;
    labelKg: InlineEditColumnDefinition<InlineUnitsRow, string, Record<string, never>>;
  };
};

export const inlineEditRegistry: InlineEditRegistry = {
  products: {
    name: {
      tableKey: "products",
      columnKey: "name",
      inputType: "text",
      formatter: (value, _row, _context, display) => formatText(value, display.notAvailableLabel),
      parser: (raw) => parseRequiredText(raw),
      mutation: (row, value) => ({
        route: "products.inlineUpdate",
        input: { productId: row.id, patch: { name: value } },
      }),
      permissionCheck: (role) => isAdmin(role),
    },
    category: {
      tableKey: "products",
      columnKey: "category",
      inputType: "select",
      formatter: (value, _row, _context, display) => formatText(value, display.notAvailableLabel),
      parser: (raw) => (raw === "__none" ? { ok: true, value: null } : parseNullableText(raw)),
      mutation: (row, value) => ({
        route: "products.bulkUpdateCategory",
        input: { productIds: [row.id], category: value },
      }),
      permissionCheck: (role) => isAdmin(role),
      selectOptions: (_row, context, display) => [
        { value: "__none", label: display.notAvailableLabel },
        ...context.categories.map((category) => ({ value: category, label: category })),
      ],
    },
    salePrice: {
      tableKey: "products",
      columnKey: "salePrice",
      inputType: "money",
      formatter: (value, _row, _context, display) =>
        formatMoney(value, display.locale, display.notAvailableLabel),
      parser: (raw) => parseNonNegativeMoney(raw),
      mutation: (row, value, context) => {
        const nextPrice = value ?? 0;
        if (context.storeId) {
          return {
            route: "storePrices.upsert",
            input: {
              storeId: context.storeId,
              productId: row.id,
              variantId: null,
              priceKgs: nextPrice,
            },
          };
        }
        return {
          route: "products.inlineUpdate",
          input: { productId: row.id, patch: { basePriceKgs: nextPrice } },
        };
      },
      permissionCheck: (role, _row, context) =>
        context.storeId ? isManagerOrAdmin(role) : isAdmin(role),
    },
  },
  inventory: {
    minStock: {
      tableKey: "inventory",
      columnKey: "minStock",
      inputType: "number",
      formatter: (value, _row, _context, display) =>
        formatInt(value, display.locale, display.notAvailableLabel),
      parser: (raw) => parseNonNegativeInt(raw),
      mutation: (row, value) => ({
        route: "inventory.setMinStock",
        input: {
          storeId: row.snapshot.storeId,
          productId: row.snapshot.productId,
          minStock: value,
        },
      }),
      permissionCheck: (role) => isManagerOrAdmin(role),
    },
  },
  suppliers: {
    name: {
      tableKey: "suppliers",
      columnKey: "name",
      inputType: "text",
      formatter: (value, _row, _context, display) => formatText(value, display.notAvailableLabel),
      parser: (raw) => parseRequiredText(raw),
      mutation: (row, value) => ({
        route: "suppliers.update",
        input: {
          supplierId: row.id,
          name: value,
          email: trimToOptional(row.email ?? ""),
          phone: trimToOptional(row.phone ?? ""),
          notes: trimToOptional(row.notes ?? ""),
        },
      }),
      permissionCheck: (role) => isManagerOrAdmin(role),
    },
    email: {
      tableKey: "suppliers",
      columnKey: "email",
      inputType: "text",
      formatter: (value, _row, _context, display) => formatText(value, display.notAvailableLabel),
      parser: (raw) => parseNullableText(raw),
      mutation: (row, value) => ({
        route: "suppliers.update",
        input: {
          supplierId: row.id,
          name: row.name,
          email: trimToOptional(value ?? ""),
          phone: trimToOptional(row.phone ?? ""),
          notes: trimToOptional(row.notes ?? ""),
        },
      }),
      permissionCheck: (role) => isManagerOrAdmin(role),
    },
    phone: {
      tableKey: "suppliers",
      columnKey: "phone",
      inputType: "text",
      formatter: (value, _row, _context, display) => formatText(value, display.notAvailableLabel),
      parser: (raw) => parseNullableText(raw),
      mutation: (row, value) => ({
        route: "suppliers.update",
        input: {
          supplierId: row.id,
          name: row.name,
          email: trimToOptional(row.email ?? ""),
          phone: trimToOptional(value ?? ""),
          notes: trimToOptional(row.notes ?? ""),
        },
      }),
      permissionCheck: (role) => isManagerOrAdmin(role),
    },
    notes: {
      tableKey: "suppliers",
      columnKey: "notes",
      inputType: "text",
      formatter: (value, _row, _context, display) => formatText(value, display.notAvailableLabel),
      parser: (raw) => parseNullableText(raw),
      mutation: (row, value) => ({
        route: "suppliers.update",
        input: {
          supplierId: row.id,
          name: row.name,
          email: trimToOptional(row.email ?? ""),
          phone: trimToOptional(row.phone ?? ""),
          notes: trimToOptional(value ?? ""),
        },
      }),
      permissionCheck: (role) => isManagerOrAdmin(role),
    },
  },
  stores: {
    name: {
      tableKey: "stores",
      columnKey: "name",
      inputType: "text",
      formatter: (value, _row, _context, display) => formatText(value, display.notAvailableLabel),
      parser: (raw) => parseRequiredText(raw),
      mutation: (row, value) => ({
        route: "stores.update",
        input: {
          storeId: row.id,
          name: value,
          code: row.code,
        },
      }),
      permissionCheck: (role) => isManagerOrAdmin(role),
    },
    code: {
      tableKey: "stores",
      columnKey: "code",
      inputType: "text",
      formatter: (value, _row, _context, display) => formatText(value, display.notAvailableLabel),
      parser: (raw) => {
        const parsed = parseRequiredText(raw);
        if (!parsed.ok) {
          return parsed;
        }
        return { ok: true, value: parsed.value.toUpperCase() };
      },
      mutation: (row, value) => ({
        route: "stores.update",
        input: {
          storeId: row.id,
          name: row.name,
          code: value,
        },
      }),
      permissionCheck: (role) => isManagerOrAdmin(role),
    },
    allowNegativeStock: {
      tableKey: "stores",
      columnKey: "allowNegativeStock",
      inputType: "select",
      formatter: (value, _row, _context, display) =>
        value ? display.tCommon("yes") : display.tCommon("no"),
      parser: (raw) => parseBooleanSelect(raw),
      mutation: (row, value) => ({
        route: "stores.updatePolicy",
        input: {
          storeId: row.id,
          allowNegativeStock: value,
          trackExpiryLots: row.trackExpiryLots,
        },
      }),
      permissionCheck: (role) => isManagerOrAdmin(role),
      selectOptions: (_row, _context, display) => [
        { value: "true", label: display.tCommon("yes") },
        { value: "false", label: display.tCommon("no") },
      ],
    },
    trackExpiryLots: {
      tableKey: "stores",
      columnKey: "trackExpiryLots",
      inputType: "select",
      formatter: (value, _row, _context, display) =>
        value ? display.tCommon("yes") : display.tCommon("no"),
      parser: (raw) => parseBooleanSelect(raw),
      mutation: (row, value) => ({
        route: "stores.updatePolicy",
        input: {
          storeId: row.id,
          allowNegativeStock: row.allowNegativeStock,
          trackExpiryLots: value,
        },
      }),
      permissionCheck: (role) => isManagerOrAdmin(role),
      selectOptions: (_row, _context, display) => [
        { value: "true", label: display.tCommon("yes") },
        { value: "false", label: display.tCommon("no") },
      ],
    },
    legalEntityType: {
      tableKey: "stores",
      columnKey: "legalEntityType",
      inputType: "select",
      formatter: (value, _row, _context, display) =>
        value
          ? value === "IP"
            ? display.tTable("legalTypeIp")
            : value === "OSOO"
              ? display.tTable("legalTypeOsoo")
              : value === "AO"
                ? display.tTable("legalTypeAo")
                : display.tTable("legalTypeOther")
          : display.notAvailableLabel,
      parser: (raw) => parseLegalTypeSelect(raw),
      mutation: (row, value) => ({
        route: "stores.updateLegalDetails",
        input: {
          storeId: row.id,
          legalEntityType: value,
          legalName: row.legalName ?? null,
          inn: row.inn ?? null,
          address: row.address ?? null,
          phone: row.phone ?? null,
        },
      }),
      permissionCheck: (role) => isAdmin(role),
      selectOptions: (_row, _context, display) => [
        { value: "none", label: display.notAvailableLabel },
        { value: "IP", label: display.tTable("legalTypeIp") },
        { value: "OSOO", label: display.tTable("legalTypeOsoo") },
        { value: "AO", label: display.tTable("legalTypeAo") },
        { value: "OTHER", label: display.tTable("legalTypeOther") },
      ],
    },
    inn: {
      tableKey: "stores",
      columnKey: "inn",
      inputType: "text",
      formatter: (value, _row, _context, display) => formatText(value, display.notAvailableLabel),
      parser: (raw) => parseNullableText(raw),
      mutation: (row, value) => ({
        route: "stores.updateLegalDetails",
        input: {
          storeId: row.id,
          legalEntityType: row.legalEntityType ?? null,
          legalName: row.legalName ?? null,
          inn: value,
          address: row.address ?? null,
          phone: row.phone ?? null,
        },
      }),
      permissionCheck: (role) => isAdmin(role),
    },
  },
  users: {
    name: {
      tableKey: "users",
      columnKey: "name",
      inputType: "text",
      formatter: (value, _row, _context, display) => formatText(value, display.notAvailableLabel),
      parser: (raw) => parseRequiredText(raw),
      mutation: (row, value) => ({
        route: "users.update",
        input: {
          userId: row.id,
          email: row.email,
          name: value,
          role: row.role,
          preferredLocale: normalizePreferredLocale(row.preferredLocale),
        },
      }),
      permissionCheck: (role) => isAdmin(role),
    },
    email: {
      tableKey: "users",
      columnKey: "email",
      inputType: "text",
      formatter: (value, _row, _context, display) => formatText(value, display.notAvailableLabel),
      parser: (raw) => parseRequiredText(raw),
      mutation: (row, value) => ({
        route: "users.update",
        input: {
          userId: row.id,
          email: value,
          name: row.name,
          role: row.role,
          preferredLocale: normalizePreferredLocale(row.preferredLocale),
        },
      }),
      permissionCheck: (role) => isAdmin(role),
    },
    role: {
      tableKey: "users",
      columnKey: "role",
      inputType: "select",
      formatter: (value, _row, _context, display) => display.tCommon(`roles.${value.toLowerCase()}`),
      parser: (raw) => parseRoleSelect(raw),
      mutation: (row, value) => ({
        route: "users.update",
        input: {
          userId: row.id,
          email: row.email,
          name: row.name,
          role: value,
          preferredLocale: normalizePreferredLocale(row.preferredLocale),
        },
      }),
      permissionCheck: (role) => isAdmin(role),
      selectOptions: (_row, _context, display) => [
        { value: "ADMIN", label: display.tCommon("roles.admin") },
        { value: "MANAGER", label: display.tCommon("roles.manager") },
        { value: "CASHIER", label: display.tCommon("roles.cashier") },
        { value: "STAFF", label: display.tCommon("roles.staff") },
      ],
    },
    preferredLocale: {
      tableKey: "users",
      columnKey: "preferredLocale",
      inputType: "select",
      formatter: (value, _row, _context, display) =>
        display.tCommon(`locales.${normalizePreferredLocale(value)}`),
      parser: (raw) => parseLocaleSelect(raw),
      mutation: (row, value) => ({
        route: "users.update",
        input: {
          userId: row.id,
          email: row.email,
          name: row.name,
          role: row.role,
          preferredLocale: normalizePreferredLocale(value),
        },
      }),
      permissionCheck: (role) => isAdmin(role),
      selectOptions: (_row, _context, display) => [
        { value: "ru", label: display.tCommon("locales.ru") },
        { value: "kg", label: display.tCommon("locales.kg") },
      ],
    },
    isActive: {
      tableKey: "users",
      columnKey: "isActive",
      inputType: "select",
      formatter: (value, _row, _context, display) =>
        value ? display.tTable("active") : display.tTable("inactive"),
      parser: (raw) => parseBooleanSelect(raw),
      mutation: (row, value) => ({
        route: "users.setActive",
        input: {
          userId: row.id,
          isActive: value,
        },
      }),
      permissionCheck: (role, row, context) =>
        isAdmin(role) && row.id !== context.currentUserId,
      selectOptions: (_row, _context, display) => [
        { value: "true", label: display.tTable("active") },
        { value: "false", label: display.tTable("inactive") },
      ],
    },
  },
  units: {
    labelRu: {
      tableKey: "units",
      columnKey: "labelRu",
      inputType: "text",
      formatter: (value, _row, _context, display) => formatText(value, display.notAvailableLabel),
      parser: (raw) => parseRequiredText(raw),
      mutation: (row, value) => ({
        route: "units.update",
        input: {
          unitId: row.id,
          labelRu: value,
          labelKg: row.labelKg,
        },
      }),
      permissionCheck: (role) => isAdmin(role),
    },
    labelKg: {
      tableKey: "units",
      columnKey: "labelKg",
      inputType: "text",
      formatter: (value, _row, _context, display) => formatText(value, display.notAvailableLabel),
      parser: (raw) => parseRequiredText(raw),
      mutation: (row, value) => ({
        route: "units.update",
        input: {
          unitId: row.id,
          labelRu: row.labelRu,
          labelKg: value,
        },
      }),
      permissionCheck: (role) => isAdmin(role),
    },
  },
};

export const resolveInlineDefinition = <
  TTableKey extends keyof InlineEditRegistry,
  TColumnKey extends keyof InlineEditRegistry[TTableKey],
>(
  tableKey: TTableKey,
  columnKey: TColumnKey,
) => inlineEditRegistry[tableKey][columnKey];

export const formatInlineDate = (
  value: Date | string | number | null | undefined,
  locale: string,
  notAvailableLabel: string,
) => {
  if (!value) {
    return notAvailableLabel;
  }
  return formatDate(value, locale);
};

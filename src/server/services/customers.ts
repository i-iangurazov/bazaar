import { randomUUID } from "node:crypto";
import { CustomerOrderStatus, CustomerSource, type Customer, type Prisma } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { AppError } from "@/server/services/errors";
import { toJson } from "@/server/services/json";
import { assertFeatureEnabled } from "@/server/services/planLimits";
import {
  assertUserCanAccessStore,
  resolveAccessibleStoreIds,
  type StoreAccessUser,
} from "@/server/services/storeAccess";

type CustomerClient = Prisma.TransactionClient | typeof prisma;

export type CustomerImportRow = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
  zip?: string | null;
  createdAt?: string | Date | null;
  rowNumber?: number;
};

export type CustomerImportRowResult = {
  rowNumber: number;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  action: "created" | "updated" | "skipped";
  matchStatus: "new" | "matched_email" | "matched_phone" | "possible_duplicate" | "error";
  matchedCustomer?: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
  } | null;
  customerId?: string;
  createdAt?: Date | null;
  errors: string[];
  warnings: string[];
};

const MAX_CUSTOMER_IMPORT_ROWS = 5_000;
const CUSTOMER_IMPORT_CHUNK_SIZE = 100;
const CUSTOMER_IMPORT_CHUNK_TRANSACTION_TIMEOUT_MS = 30_000;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeCustomerEmail = (value?: string | null) => {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
};

export const normalizeCustomerPhone = (value?: string | null) => {
  const raw = value
    ?.trim()
    .replace(/^[\uFEFF\u200B\u200C\u200D'’‘`´]+/, "")
    .trim();
  if (!raw) {
    return null;
  }
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) {
    return null;
  }
  return raw.startsWith("+") ? `+${digits}` : digits;
};

const normalizeOptionalText = (value?: string | null) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

export const normalizeCustomerImportAddress = (row: {
  address?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
  zip?: string | null;
}) => {
  const seen = new Set<string>();
  const parts = [
    row.address1,
    row.address2,
    row.address,
    row.city,
    row.province,
    row.country,
    row.zip,
  ]
    .map((value) => normalizeOptionalText(value)?.replace(/\s+/g, " "))
    .filter((value): value is string => Boolean(value))
    .filter((value) => {
      const key = value.toLocaleLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

  return parts.length ? parts.join(", ") : null;
};

const normalizeCustomerNameForMatch = (value?: string | null) =>
  value
    ?.toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim() ?? "";

const parseCustomerImportDate = (value?: string | Date | null) => {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

const ensureCustomerContact = (input: { email?: string | null; phone?: string | null }) => {
  if (!input.email && !input.phone) {
    throw new AppError("customerContactRequired", "BAD_REQUEST", 400);
  }
};

const normalizeManualCustomerInput = (input: {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
}) => {
  const name = normalizeOptionalText(input.name);
  const email = normalizeCustomerEmail(input.email);
  const rawPhone = normalizeOptionalText(input.phone);
  const phone = normalizeCustomerPhone(input.phone);
  const address = normalizeOptionalText(input.address);

  if (!name) {
    throw new AppError("customerNameRequired", "BAD_REQUEST", 400);
  }
  if (rawPhone && !phone) {
    throw new AppError("customerPhoneDigitsRequired", "BAD_REQUEST", 400);
  }
  ensureCustomerContact({ email, phone });
  if (email && !emailPattern.test(email)) {
    throw new AppError("customerEmailInvalid", "BAD_REQUEST", 400);
  }

  return { name, email, phone, address };
};

const validateImportRow = (
  row: CustomerImportRow,
  rowNumber: number,
): Omit<CustomerImportRowResult, "action"> => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const email = normalizeCustomerEmail(row.email);
  const phone = normalizeCustomerPhone(row.phone);
  const name =
    normalizeOptionalText(row.name) ?? (email ? email.split("@")[0] : null) ?? phone ?? "Без имени";
  const address = normalizeCustomerImportAddress(row);
  const createdAt = parseCustomerImportDate(row.createdAt);

  if (!normalizeOptionalText(row.name) && !email && !phone) {
    errors.push("customerEmpty");
  } else if (!email && !phone) {
    warnings.push("customerContactMissing");
  }
  if (email && !emailPattern.test(email)) {
    errors.push("customerEmailInvalid");
  }

  return {
    rowNumber,
    name,
    email,
    phone,
    address,
    matchStatus: errors.length ? "error" : "new",
    matchedCustomer: null,
    createdAt,
    errors,
    warnings,
  };
};

type CustomerMatch = Pick<Customer, "id" | "name" | "email" | "phone" | "address">;

type CustomerLookup = {
  byEmail: Map<string, CustomerMatch>;
  byPhone: Map<string, CustomerMatch>;
  customers: CustomerMatch[];
};

const addCustomerToLookup = (lookup: CustomerLookup, customer: CustomerMatch) => {
  const email = normalizeCustomerEmail(customer.email);
  const phone = normalizeCustomerPhone(customer.phone);
  if (email && !lookup.byEmail.has(email)) {
    lookup.byEmail.set(email, customer);
  }
  if (phone && !lookup.byPhone.has(phone)) {
    lookup.byPhone.set(phone, customer);
  }
  if (!lookup.customers.some((item) => item.id === customer.id)) {
    lookup.customers.push(customer);
  }
};

const findMatchingCustomerInLookup = (
  lookup: CustomerLookup,
  input: { email?: string | null; phone?: string | null },
) => {
  if (input.email) {
    const byEmail = lookup.byEmail.get(input.email);
    if (byEmail) {
      return { customer: byEmail, reason: "email" as const };
    }
  }
  if (input.phone) {
    const byPhone = lookup.byPhone.get(input.phone);
    if (byPhone) {
      return { customer: byPhone, reason: "phone" as const };
    }
  }
  return null;
};

const findPossibleCustomerDuplicate = (
  lookup: CustomerLookup,
  input: { name?: string | null; email?: string | null; phone?: string | null },
) => {
  const normalizedName = normalizeCustomerNameForMatch(input.name);
  if (normalizedName.length < 3) {
    return null;
  }
  const emailLocalPart = input.email?.split("@")[0]?.toLowerCase() ?? "";
  const phoneTail = input.phone && input.phone.length >= 4 ? input.phone.slice(-4) : "";
  return (
    lookup.customers.find((customer) => {
      if (normalizeCustomerNameForMatch(customer.name) !== normalizedName) {
        return false;
      }
      const customerEmailLocalPart = customer.email?.split("@")[0]?.toLowerCase() ?? "";
      const customerPhone = normalizeCustomerPhone(customer.phone);
      const customerPhoneTail =
        customerPhone && customerPhone.length >= 4 ? customerPhone.slice(-4) : "";
      return (
        (emailLocalPart && customerEmailLocalPart === emailLocalPart) ||
        (phoneTail && customerPhoneTail === phoneTail)
      );
    }) ?? null
  );
};

const loadCustomerLookup = async (
  client: CustomerClient,
  input: {
    organizationId: string;
    storeId: string;
    rows: Array<{ name?: string | null; email?: string | null; phone?: string | null }>;
  },
): Promise<CustomerLookup> => {
  const emails = Array.from(
    new Set(input.rows.map((row) => row.email).filter((value): value is string => Boolean(value))),
  );
  const phones = Array.from(
    new Set(input.rows.map((row) => row.phone).filter((value): value is string => Boolean(value))),
  );
  const names = Array.from(
    new Set(
      input.rows
        .map((row) => normalizeCustomerNameForMatch(row.name))
        .filter((value) => value.length >= 3),
    ),
  );
  const lookup: CustomerLookup = { byEmail: new Map(), byPhone: new Map(), customers: [] };

  if (!emails.length && !phones.length && !names.length) {
    return lookup;
  }

  const customers = await client.customer.findMany({
    where: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      deletedAt: null,
      OR: [
        ...(emails.length ? [{ email: { not: null } }] : []),
        ...(phones.length ? [{ phone: { not: null } }] : []),
        ...(names.length ? [{ name: { not: "" } }] : []),
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 10_000,
  });

  customers.forEach((customer) => addCustomerToLookup(lookup, customer));
  return lookup;
};

const findMatchingCustomer = async (
  client: CustomerClient,
  input: {
    organizationId: string;
    storeId: string;
    email?: string | null;
    phone?: string | null;
  },
) => {
  if (input.email) {
    const byEmail = await client.customer.findFirst({
      where: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        email: { equals: input.email, mode: "insensitive" },
        deletedAt: null,
      },
      orderBy: { createdAt: "asc" },
    });
    if (byEmail) {
      return byEmail;
    }
  }

  if (input.phone) {
    const phoneCandidates = await client.customer.findMany({
      where: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        phone: { not: null },
        deletedAt: null,
      },
      orderBy: { createdAt: "asc" },
      take: 10_000,
    });
    return (
      phoneCandidates.find((customer) => normalizeCustomerPhone(customer.phone) === input.phone) ??
      null
    );
  }

  return null;
};

const missingOnlyCustomerData = (
  existing: CustomerMatch,
  input: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    source?: CustomerSource;
    lastOrderAt?: Date | null;
    incrementOrderCount?: boolean;
  },
): Prisma.CustomerUpdateInput => {
  const data: Prisma.CustomerUpdateInput = {};
  if (!normalizeOptionalText(existing.name) && input.name) {
    data.name = input.name;
  }
  if (!existing.email && input.email) {
    data.email = input.email;
  }
  if (!existing.phone && input.phone) {
    data.phone = input.phone;
  }
  if (!existing.address && input.address) {
    data.address = input.address;
  }
  if (input.lastOrderAt) {
    data.lastOrderAt = input.lastOrderAt;
  }
  if (input.incrementOrderCount) {
    data.orderCount = { increment: 1 };
  }
  return data;
};

const upsertCustomerTx = async (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    storeId: string;
    actorId?: string | null;
    source: CustomerSource;
    name: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    metadata?: Prisma.InputJsonValue;
  },
) => {
  const existing = await findMatchingCustomer(tx, input);
  if (existing) {
    const data = missingOnlyCustomerData(existing, input);
    const updated = Object.keys(data).length
      ? await tx.customer.update({
          where: { id: existing.id },
          data,
        })
      : existing;
    return { customer: updated, action: "updated" as const };
  }

  const customer = await tx.customer.create({
    data: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      createdById: input.actorId ?? undefined,
      source: input.source,
      name: input.name,
      email: input.email,
      phone: input.phone,
      address: input.address,
      metadata: input.metadata,
    },
  });
  return { customer, action: "created" as const };
};

export const listCustomers = async (input: {
  user: StoreAccessUser;
  storeId?: string | null;
  search?: string | null;
  source?: CustomerSource | "ALL" | null;
  page?: number;
  pageSize?: number;
}) => {
  const accessibleStoreIds = await resolveAccessibleStoreIds(prisma, input.user);
  if (!accessibleStoreIds.length) {
    return {
      items: [],
      total: 0,
      page: 1,
      pageSize: Math.min(100, Math.max(1, Math.trunc(input.pageSize ?? 25))),
      accessibleStoreIds,
    };
  }

  const storeId = input.storeId?.trim() || accessibleStoreIds[0] || null;
  if (!storeId) {
    throw new AppError("storeRequired", "BAD_REQUEST", 400);
  }
  await assertUserCanAccessStore(prisma, input.user, storeId);

  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(input.pageSize ?? 25)));
  const search = normalizeOptionalText(input.search);
  const source = input.source && input.source !== "ALL" ? input.source : null;
  const where: Prisma.CustomerWhereInput = {
    organizationId: input.user.organizationId,
    storeId,
    deletedAt: null,
    ...(source ? { source } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { phone: { contains: search, mode: "insensitive" } },
            { address: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return { items, total, page, pageSize, accessibleStoreIds };
};

export const getCustomerDetail = async (input: { user: StoreAccessUser; customerId: string }) => {
  const customer = await prisma.customer.findFirst({
    where: {
      id: input.customerId,
      organizationId: input.user.organizationId,
      deletedAt: null,
    },
  });
  if (!customer) {
    throw new AppError("customerNotFound", "NOT_FOUND", 404);
  }
  await assertUserCanAccessStore(prisma, input.user, customer.storeId);

  const customerMatches: Prisma.CustomerOrderWhereInput[] = [
    ...(customer.email ? [{ customerEmail: customer.email }] : []),
    ...(customer.phone ? [{ customerPhone: customer.phone }] : []),
  ];
  if (!customerMatches.length) {
    customerMatches.push({ customerName: customer.name });
  }

  const recentOrders = await prisma.customerOrder.findMany({
    where: {
      organizationId: input.user.organizationId,
      storeId: customer.storeId,
      isPosSale: true,
      status: CustomerOrderStatus.COMPLETED,
      OR: customerMatches,
    },
    select: {
      id: true,
      number: true,
      customerName: true,
      customerEmail: true,
      customerPhone: true,
      totalKgs: true,
      currencyCode: true,
      currencyRateKgsPerUnit: true,
      completedAt: true,
      createdAt: true,
      payments: {
        select: {
          id: true,
          method: true,
          amountKgs: true,
          currencyCode: true,
          currencyRateKgsPerUnit: true,
          isRefund: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    take: 10,
  });

  return {
    customer,
    recentOrders: recentOrders.map((order) => ({
      ...order,
      totalKgs: Number(order.totalKgs),
      payments: order.payments.map((payment) => ({
        ...payment,
        amountKgs: Number(payment.amountKgs),
      })),
    })),
  };
};

export const createCustomer = async (input: {
  user: StoreAccessUser;
  storeId: string;
  actorId: string;
  requestId: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
}) => {
  await assertUserCanAccessStore(prisma, input.user, input.storeId);
  const normalized = normalizeManualCustomerInput(input);

  const result = await prisma.$transaction(async (tx) => {
    const created = await upsertCustomerTx(tx, {
      organizationId: input.user.organizationId,
      storeId: input.storeId,
      actorId: input.actorId,
      source: CustomerSource.MANUAL,
      ...normalized,
    });
    await writeAuditLog(tx, {
      organizationId: input.user.organizationId,
      actorId: input.actorId,
      action: "CUSTOMER_UPSERT",
      entity: "Customer",
      entityId: created.customer.id,
      before: null,
      after: toJson({ action: created.action, customerId: created.customer.id }),
      requestId: input.requestId,
    });
    return created;
  });

  return result;
};

export const updateCustomer = async (input: {
  user: StoreAccessUser;
  customerId: string;
  actorId: string;
  requestId: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
}) => {
  const existing = await prisma.customer.findFirst({
    where: {
      id: input.customerId,
      organizationId: input.user.organizationId,
      deletedAt: null,
    },
  });
  if (!existing) {
    throw new AppError("customerNotFound", "NOT_FOUND", 404);
  }
  await assertUserCanAccessStore(prisma, input.user, existing.storeId);
  const normalized = normalizeManualCustomerInput(input);

  const duplicate = await findMatchingCustomer(prisma, {
    organizationId: input.user.organizationId,
    storeId: existing.storeId,
    email: normalized.email,
    phone: normalized.phone,
  });
  if (duplicate && duplicate.id !== existing.id) {
    throw new AppError("customerDuplicate", "CONFLICT", 409);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.customer.update({
      where: { id: existing.id },
      data: normalized,
    });
    await writeAuditLog(tx, {
      organizationId: input.user.organizationId,
      actorId: input.actorId,
      action: "CUSTOMER_UPDATE",
      entity: "Customer",
      entityId: updated.id,
      before: toJson(existing),
      after: toJson(updated),
      requestId: input.requestId,
    });
    return updated;
  });
};

export const deleteCustomer = async (input: {
  user: StoreAccessUser;
  customerId: string;
  actorId: string;
  requestId: string;
}) => {
  const existing = await prisma.customer.findFirst({
    where: {
      id: input.customerId,
      organizationId: input.user.organizationId,
      deletedAt: null,
    },
  });
  if (!existing) {
    throw new AppError("customerNotFound", "NOT_FOUND", 404);
  }
  await assertUserCanAccessStore(prisma, input.user, existing.storeId);

  return prisma.$transaction(async (tx) => {
    const deleted = await tx.customer.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });
    await writeAuditLog(tx, {
      organizationId: input.user.organizationId,
      actorId: input.actorId,
      action: "CUSTOMER_ARCHIVE",
      entity: "Customer",
      entityId: deleted.id,
      before: toJson(existing),
      after: toJson({ deletedAt: deleted.deletedAt }),
      requestId: input.requestId,
    });
    return deleted;
  });
};

export const previewCustomerImport = async (input: {
  user: StoreAccessUser;
  storeId: string;
  rows: CustomerImportRow[];
}) => {
  await assertFeatureEnabled({ organizationId: input.user.organizationId, feature: "imports" });
  await assertUserCanAccessStore(prisma, input.user, input.storeId);
  if (input.rows.length > MAX_CUSTOMER_IMPORT_ROWS) {
    throw new AppError("importTooManyRows", "BAD_REQUEST", 400);
  }

  const validatedRows = input.rows.map((row, index) => {
    const rowNumber = row?.rowNumber ?? index + 2;
    return validateImportRow(row ?? {}, rowNumber);
  });
  const lookup = await loadCustomerLookup(prisma, {
    organizationId: input.user.organizationId,
    storeId: input.storeId,
    rows: validatedRows.filter((row) => row.errors.length === 0),
  });

  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();
  const results: CustomerImportRowResult[] = [];
  let creatable = 0;
  let updatable = 0;
  let skipped = 0;
  let errors = 0;

  for (const validated of validatedRows) {
    const duplicateInFile =
      (validated.email ? seenEmails.has(validated.email) : false) ||
      (validated.phone ? seenPhones.has(validated.phone) : false);
    let action: CustomerImportRowResult["action"] = "created";

    if (validated.errors.length === 0) {
      if (duplicateInFile) {
        validated.errors.push("customerDuplicateInFile");
        action = "skipped";
        validated.matchStatus = "error";
      } else {
        if (validated.email) {
          seenEmails.add(validated.email);
        }
        if (validated.phone) {
          seenPhones.add(validated.phone);
        }
        const existingMatch = findMatchingCustomerInLookup(lookup, validated);
        if (existingMatch) {
          action = "updated";
          validated.matchStatus =
            existingMatch.reason === "email" ? "matched_email" : "matched_phone";
          validated.matchedCustomer = {
            id: existingMatch.customer.id,
            name: existingMatch.customer.name,
            email: existingMatch.customer.email,
            phone: existingMatch.customer.phone,
          };
          const conflictFields = [
            validated.name &&
            existingMatch.customer.name &&
            normalizeOptionalText(existingMatch.customer.name) !== validated.name
              ? "name"
              : null,
            validated.phone &&
            existingMatch.customer.phone &&
            normalizeCustomerPhone(existingMatch.customer.phone) !== validated.phone
              ? "phone"
              : null,
            validated.address &&
            existingMatch.customer.address &&
            normalizeOptionalText(existingMatch.customer.address) !== validated.address
              ? "address"
              : null,
          ].filter((value): value is string => Boolean(value));
          if (conflictFields.length) {
            validated.warnings.push(`customerConflicts:${conflictFields.join("|")}`);
          }
        } else {
          const possibleDuplicate = findPossibleCustomerDuplicate(lookup, validated);
          if (possibleDuplicate) {
            action = "skipped";
            validated.matchStatus = "possible_duplicate";
            validated.matchedCustomer = {
              id: possibleDuplicate.id,
              name: possibleDuplicate.name,
              email: possibleDuplicate.email,
              phone: possibleDuplicate.phone,
            };
            validated.warnings.push("customerPossibleDuplicate");
          } else {
            action = "created";
            validated.matchStatus = "new";
          }
        }
      }
    } else if (validated.errors.length > 0) {
      action = "skipped";
      validated.matchStatus = "error";
    }

    if (action === "created") {
      creatable += 1;
    } else if (action === "updated") {
      updatable += 1;
    } else {
      skipped += 1;
    }
    errors += validated.errors.length;
    results.push({ ...validated, action });
  }

  return {
    rows: results,
    summary: {
      total: results.length,
      creatable,
      updatable,
      skipped,
      errors,
    },
  };
};

export const runCustomerImport = async (input: {
  user: StoreAccessUser;
  storeId: string;
  actorId: string;
  requestId: string;
  rows: CustomerImportRow[];
  source?: string;
}) => {
  const preview = await previewCustomerImport({
    user: input.user,
    storeId: input.storeId,
    rows: input.rows,
  });
  const importableRows = preview.rows.filter((row) => row.errors.length === 0);

  const store = await prisma.store.findFirst({
    where: { id: input.storeId, organizationId: input.user.organizationId },
    select: { id: true, name: true },
  });
  if (!store) {
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  }

  const batch = await prisma.importBatch.create({
    data: {
      organizationId: input.user.organizationId,
      type: "customers",
      createdById: input.actorId,
      summary: {
        source: input.source ?? "csv",
        targetStoreId: store.id,
        targetStoreName: store.name,
        rows: input.rows.length,
      },
    },
  });

  const lookup = await loadCustomerLookup(prisma, {
    organizationId: input.user.organizationId,
    storeId: input.storeId,
    rows: importableRows,
  });
  const rows: CustomerImportRowResult[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (let start = 0; start < preview.rows.length; start += CUSTOMER_IMPORT_CHUNK_SIZE) {
    const chunk = preview.rows.slice(start, start + CUSTOMER_IMPORT_CHUNK_SIZE);
    const refreshedLookup = await loadCustomerLookup(prisma, {
      organizationId: input.user.organizationId,
      storeId: input.storeId,
      rows: chunk.filter((row) => row.errors.length === 0),
    });
    refreshedLookup.customers.forEach((customer) => addCustomerToLookup(lookup, customer));

    const chunkResult = await prisma.$transaction(
      async (tx) => {
        const chunkRows: CustomerImportRowResult[] = [];
        const lookupUpdates: CustomerMatch[] = [];
        const newCustomers: Prisma.CustomerCreateManyInput[] = [];
        const importedEntities: Prisma.ImportedEntityCreateManyInput[] = [];
        let chunkCreated = 0;
        let chunkUpdated = 0;
        let chunkSkipped = 0;
        let chunkErrors = 0;

        for (const row of chunk) {
          if (row.errors.length > 0) {
            chunkRows.push({ ...row, action: "skipped" });
            chunkSkipped += 1;
            chunkErrors += row.errors.length;
            continue;
          }

          if (row.matchStatus === "possible_duplicate") {
            chunkRows.push({ ...row, action: "skipped" });
            chunkSkipped += 1;
            continue;
          }

          const existingMatch = findMatchingCustomerInLookup(lookup, row);
          const existing = existingMatch?.customer ?? null;
          if (existing) {
            const data = missingOnlyCustomerData(existing, row);
            const customer = Object.keys(data).length
              ? await tx.customer.update({
                  where: { id: existing.id },
                  data,
                })
              : existing;
            chunkUpdated += 1;
            lookupUpdates.push(customer);
            importedEntities.push({
              batchId: batch.id,
              entityType: "Customer",
              entityId: customer.id,
            });
            chunkRows.push({
              ...row,
              action: "updated",
              customerId: customer.id,
            });
            continue;
          }

          const possibleDuplicate = findPossibleCustomerDuplicate(lookup, row);
          if (possibleDuplicate) {
            chunkRows.push({
              ...row,
              action: "skipped",
              matchStatus: "possible_duplicate",
              matchedCustomer: {
                id: possibleDuplicate.id,
                name: possibleDuplicate.name,
                email: possibleDuplicate.email,
                phone: possibleDuplicate.phone,
              },
              warnings: row.warnings.includes("customerPossibleDuplicate")
                ? row.warnings
                : [...row.warnings, "customerPossibleDuplicate"],
            });
            chunkSkipped += 1;
            continue;
          }

          const customerId = randomUUID();
          const createdCustomer: CustomerMatch = {
            id: customerId,
            name: row.name,
            email: row.email,
            phone: row.phone,
            address: row.address,
          };
          newCustomers.push({
            id: customerId,
            organizationId: input.user.organizationId,
            storeId: input.storeId,
            createdById: input.actorId,
            source: CustomerSource.IMPORT,
            name: row.name,
            email: row.email,
            phone: row.phone,
            address: row.address,
            createdAt: row.createdAt ?? undefined,
          });
          lookupUpdates.push(createdCustomer);
          importedEntities.push({
            batchId: batch.id,
            entityType: "Customer",
            entityId: customerId,
          });
          chunkRows.push({
            ...row,
            action: "created",
            customerId,
          });
          chunkCreated += 1;
        }

        if (newCustomers.length) {
          await tx.customer.createMany({ data: newCustomers });
        }
        if (importedEntities.length) {
          await tx.importedEntity.createMany({
            data: importedEntities,
            skipDuplicates: true,
          });
        }

        return {
          rows: chunkRows,
          lookupUpdates,
          created: chunkCreated,
          updated: chunkUpdated,
          skipped: chunkSkipped,
          errors: chunkErrors,
        };
      },
      { maxWait: 10_000, timeout: CUSTOMER_IMPORT_CHUNK_TRANSACTION_TIMEOUT_MS },
    );

    chunkResult.lookupUpdates.forEach((customer) => addCustomerToLookup(lookup, customer));
    rows.push(...chunkResult.rows);
    created += chunkResult.created;
    updated += chunkResult.updated;
    skipped += chunkResult.skipped;
    errors += chunkResult.errors;
  }

  const summary = {
    source: input.source ?? "csv",
    targetStoreId: store.id,
    targetStoreName: store.name,
    rows: input.rows.length,
    created,
    updated,
    skipped,
    errors,
  };

  const updatedBatch = await prisma.$transaction(
    async (tx) => {
      const updatedImportBatch = await tx.importBatch.update({
        where: { id: batch.id },
        data: { summary },
      });

      await writeAuditLog(tx, {
        organizationId: input.user.organizationId,
        actorId: input.actorId,
        action: "CUSTOMER_IMPORT",
        entity: "ImportBatch",
        entityId: batch.id,
        before: null,
        after: toJson(summary),
        requestId: input.requestId,
      });

      return updatedImportBatch;
    },
    { maxWait: 10_000, timeout: CUSTOMER_IMPORT_CHUNK_TRANSACTION_TIMEOUT_MS },
  );

  return {
    batch: updatedBatch,
    rows,
    summary,
    skippedRows: preview.rows.length - importableRows.length,
  };
};

export const upsertCustomerFromOrderTx = async (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    storeId: string;
    customerName?: string | null;
    customerEmail?: string | null;
    customerPhone?: string | null;
    customerAddress?: string | null;
    orderedAt?: Date | null;
    countOrder?: boolean;
  },
) => {
  const email = normalizeCustomerEmail(input.customerEmail);
  const phone = normalizeCustomerPhone(input.customerPhone);
  if (!email && !phone) {
    return null;
  }
  const name = normalizeOptionalText(input.customerName) ?? email ?? phone ?? "Customer";
  const address = normalizeOptionalText(input.customerAddress);
  const orderedAt = input.orderedAt ?? new Date();
  const countOrder = input.countOrder ?? true;

  const existing = await findMatchingCustomer(tx, {
    organizationId: input.organizationId,
    storeId: input.storeId,
    email,
    phone,
  });

  if (existing) {
    return tx.customer.update({
      where: { id: existing.id },
      data: missingOnlyCustomerData(existing, {
        name,
        email,
        phone,
        address,
        lastOrderAt: orderedAt,
        incrementOrderCount: countOrder,
      }),
    });
  }

  return tx.customer.create({
    data: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      name,
      email,
      phone,
      address,
      source: CustomerSource.ORDER,
      lastOrderAt: orderedAt,
      orderCount: countOrder ? 1 : 0,
    },
  });
};

export const countEmailReachableCustomers = async (input: {
  user: StoreAccessUser;
  storeId: string;
  source?: CustomerSource | "ALL" | null;
}) => {
  await assertUserCanAccessStore(prisma, input.user, input.storeId);
  return prisma.customer.count({
    where: {
      organizationId: input.user.organizationId,
      storeId: input.storeId,
      deletedAt: null,
      emailMarketingUnsubscribedAt: null,
      email: { not: null },
      ...(input.source && input.source !== "ALL" ? { source: input.source } : {}),
    },
  });
};

export const listEmailReachableCustomers = async (input: {
  organizationId: string;
  storeId: string;
  source?: CustomerSource | "ALL" | null;
  limit?: number;
}) =>
  prisma.customer.findMany({
    where: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      deletedAt: null,
      emailMarketingUnsubscribedAt: null,
      email: { not: null },
      ...(input.source && input.source !== "ALL" ? { source: input.source } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(5_000, Math.max(1, input.limit ?? 5_000)),
  });

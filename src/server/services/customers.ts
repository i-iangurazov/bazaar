import { CustomerSource, type Customer, type Prisma } from "@prisma/client";

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
  rowNumber?: number;
};

export type CustomerImportRowResult = {
  rowNumber: number;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  action: "created" | "updated" | "skipped";
  customerId?: string;
  errors: string[];
  warnings: string[];
};

const MAX_CUSTOMER_IMPORT_ROWS = 5_000;
const CUSTOMER_IMPORT_TRANSACTION_TIMEOUT_MS = 120_000;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeCustomerEmail = (value?: string | null) => {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
};

export const normalizeCustomerPhone = (value?: string | null) => {
  const normalized = value
    ?.trim()
    .replace(/^[\uFEFF\u200B\u200C\u200D'’‘`´]+/, "")
    .trim()
    .replace(/\s+/g, " ");
  return normalized ? normalized : null;
};

const normalizeOptionalText = (value?: string | null) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
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
  const phone = normalizeCustomerPhone(input.phone);
  const address = normalizeOptionalText(input.address);

  if (!name) {
    throw new AppError("customerNameRequired", "BAD_REQUEST", 400);
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
  const name = normalizeOptionalText(row.name) ?? "";
  const email = normalizeCustomerEmail(row.email);
  const phone = normalizeCustomerPhone(row.phone);
  const address = normalizeOptionalText(row.address);

  if (!name) {
    errors.push("customerNameRequired");
  }
  if (!email && !phone) {
    errors.push("customerContactRequired");
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
    errors,
    warnings,
  };
};

type CustomerLookup = {
  byEmail: Map<string, Customer>;
  byPhone: Map<string, Customer>;
};

const addCustomerToLookup = (lookup: CustomerLookup, customer: Customer) => {
  if (customer.email && !lookup.byEmail.has(customer.email)) {
    lookup.byEmail.set(customer.email, customer);
  }
  if (customer.phone && !lookup.byPhone.has(customer.phone)) {
    lookup.byPhone.set(customer.phone, customer);
  }
};

const findMatchingCustomerInLookup = (
  lookup: CustomerLookup,
  input: { email?: string | null; phone?: string | null },
) => {
  if (input.email) {
    const byEmail = lookup.byEmail.get(input.email);
    if (byEmail) {
      return byEmail;
    }
  }
  return input.phone ? (lookup.byPhone.get(input.phone) ?? null) : null;
};

const loadCustomerLookup = async (
  client: CustomerClient,
  input: {
    organizationId: string;
    storeId: string;
    rows: Array<{ email?: string | null; phone?: string | null }>;
  },
): Promise<CustomerLookup> => {
  const emails = Array.from(
    new Set(input.rows.map((row) => row.email).filter((value): value is string => Boolean(value))),
  );
  const phones = Array.from(
    new Set(input.rows.map((row) => row.phone).filter((value): value is string => Boolean(value))),
  );
  const lookup: CustomerLookup = { byEmail: new Map(), byPhone: new Map() };

  if (!emails.length && !phones.length) {
    return lookup;
  }

  const customers = await client.customer.findMany({
    where: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      deletedAt: null,
      OR: [
        ...(emails.length ? [{ email: { in: emails } }] : []),
        ...(phones.length ? [{ phone: { in: phones } }] : []),
      ],
    },
    orderBy: { createdAt: "asc" },
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
        email: input.email,
        deletedAt: null,
      },
      orderBy: { createdAt: "asc" },
    });
    if (byEmail) {
      return byEmail;
    }
  }

  if (input.phone) {
    return client.customer.findFirst({
      where: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        phone: input.phone,
        deletedAt: null,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  return null;
};

const missingOnlyCustomerData = (
  existing: Customer,
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
      } else {
        if (validated.email) {
          seenEmails.add(validated.email);
        }
        if (validated.phone) {
          seenPhones.add(validated.phone);
        }
        const existing = findMatchingCustomerInLookup(lookup, validated);
        action = existing ? "updated" : "created";
      }
    } else if (validated.errors.length > 0) {
      action = "skipped";
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

  const result = await prisma.$transaction(
    async (tx) => {
      const store = await tx.store.findFirst({
        where: { id: input.storeId, organizationId: input.user.organizationId },
        select: { id: true, name: true },
      });
      if (!store) {
        throw new AppError("storeNotFound", "NOT_FOUND", 404);
      }

      const batch = await tx.importBatch.create({
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

      const lookup = await loadCustomerLookup(tx, {
        organizationId: input.user.organizationId,
        storeId: input.storeId,
        rows: importableRows,
      });
      const rows: CustomerImportRowResult[] = [];
      const importedEntities: Array<{ batchId: string; entityType: string; entityId: string }> = [];
      let created = 0;
      let updated = 0;
      let skipped = 0;
      let errors = 0;

      for (const row of preview.rows) {
        if (row.errors.length > 0) {
          rows.push({ ...row, action: "skipped" });
          skipped += 1;
          errors += row.errors.length;
          continue;
        }

        const existing = findMatchingCustomerInLookup(lookup, row);
        let customer: Customer;
        let action: CustomerImportRowResult["action"];
        if (existing) {
          const data = missingOnlyCustomerData(existing, row);
          customer = Object.keys(data).length
            ? await tx.customer.update({
                where: { id: existing.id },
                data,
              })
            : existing;
          action = "updated";
          updated += 1;
        } else {
          customer = await tx.customer.create({
            data: {
              organizationId: input.user.organizationId,
              storeId: input.storeId,
              createdById: input.actorId,
              source: CustomerSource.IMPORT,
              name: row.name,
              email: row.email,
              phone: row.phone,
              address: row.address,
            },
          });
          action = "created";
          created += 1;
        }

        addCustomerToLookup(lookup, customer);
        importedEntities.push({
          batchId: batch.id,
          entityType: "Customer",
          entityId: customer.id,
        });
        rows.push({
          ...row,
          action,
          customerId: customer.id,
        });
      }

      if (importedEntities.length) {
        await tx.importedEntity.createMany({
          data: importedEntities,
          skipDuplicates: true,
        });
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

      const updatedBatch = await tx.importBatch.update({
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

      return { batch: updatedBatch, rows, summary };
    },
    { maxWait: 10_000, timeout: CUSTOMER_IMPORT_TRANSACTION_TIMEOUT_MS },
  );

  return {
    ...result,
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

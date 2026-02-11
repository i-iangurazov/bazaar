import {
  Prisma,
  PrismaClient,
  LegalEntityType,
  PurchaseOrderStatus,
  Role,
  StockMovementType,
  type Organization,
  type Product,
  type Store,
  type User,
} from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const RESET_PASSWORDS = process.env.SEED_RESET_PASSWORDS === "1";
const PLATFORM_OWNER_EMAIL = process.env.SEED_PLATFORM_OWNER_EMAIL?.trim() || "owner@example.com";
const PLATFORM_OWNER_PASSWORD = process.env.SEED_PLATFORM_OWNER_PASSWORD || "Owner123!";
const PLATFORM_OWNER_NAME = process.env.SEED_PLATFORM_OWNER_NAME || "Platform Owner";

const seededRandom = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 48271) % 0x7fffffff;
    return state / 0x7fffffff;
  };
};

const ensureInventoryConstraints = async () => {
  const result = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'inventorysnapshot_nonnegative_check'
    ) AS "exists";
  `;

  if (!result[0]?.exists) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "InventorySnapshot"
      ADD CONSTRAINT "inventorysnapshot_nonnegative_check"
      CHECK ("allowNegativeStock" OR "onHand" >= 0)
    `);
  }
};

const getOrCreateOrganization = async () => {
  const existing = await prisma.organization.findFirst({
    where: { name: "BAZAAR Retail" },
  });
  if (existing) {
    return existing;
  }
  return prisma.organization.create({
    data: {
      name: "BAZAAR Retail",
    },
  });
};

const getOrCreateUser = async (
  org: Organization,
  input: { email: string; name: string; role: Role; password: string; isOrgOwner?: boolean },
): Promise<User> => {
  const baseEmail = input.email.trim().toLowerCase();
  let targetEmail = baseEmail;
  let existing = await prisma.user.findUnique({ where: { email: targetEmail } });
  const passwordHash = await bcrypt.hash(input.password, 10);

  if (existing && existing.organizationId && existing.organizationId !== org.id) {
    const atIndex = baseEmail.indexOf("@");
    if (atIndex <= 0 || atIndex === baseEmail.length - 1) {
      throw new Error(`Seed email ${baseEmail} is invalid`);
    }

    const localPart = baseEmail.slice(0, atIndex);
    const domain = baseEmail.slice(atIndex + 1);
    const orgSuffix = org.id.slice(0, 8);

    let resolved = false;
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const candidate =
        attempt === 1
          ? `${localPart}+seed-${orgSuffix}@${domain}`
          : `${localPart}+seed-${orgSuffix}-${attempt}@${domain}`;
      const candidateExisting = await prisma.user.findUnique({ where: { email: candidate } });
      if (!candidateExisting || candidateExisting.organizationId === org.id) {
        targetEmail = candidate;
        existing = candidateExisting;
        resolved = true;
        break;
      }
    }

    if (!resolved) {
      throw new Error(`Unable to resolve seed email conflict for ${baseEmail}`);
    }

    console.warn(
      `[seed] ${baseEmail} is used by another organization; seeding this org with ${targetEmail}`,
    );
  }

  return prisma.user.upsert({
    where: { email: targetEmail },
    update: RESET_PASSWORDS
      ? {
          passwordHash,
          name: input.name,
          role: input.role,
          isOrgOwner: Boolean(input.isOrgOwner),
          isActive: true,
          preferredLocale: "ru",
          emailVerifiedAt: new Date(),
        }
      : {
          name: input.name,
          role: input.role,
          isOrgOwner: input.isOrgOwner ?? existing?.isOrgOwner ?? false,
          isActive: true,
          preferredLocale: existing?.preferredLocale ?? "ru",
          emailVerifiedAt: existing?.emailVerifiedAt ?? new Date(),
        },
    create: {
      organizationId: org.id,
      email: targetEmail,
      name: input.name,
      passwordHash,
      role: input.role,
      isOrgOwner: Boolean(input.isOrgOwner),
      preferredLocale: "ru",
      emailVerifiedAt: new Date(),
    },
  });
};

const getOrCreateSupplier = async (orgId: string) => {
  const existing = await prisma.supplier.findFirst({
    where: { organizationId: orgId, name: "Acme Supply Co." },
  });
  if (existing) {
    return existing;
  }
  return prisma.supplier.create({
    data: {
      organizationId: orgId,
      name: "Acme Supply Co.",
      email: "orders@acme.example",
      phone: "+1-555-0100",
    },
  });
};

const ensureUnits = async (orgId: string) => {
  const units = [
    { code: "шт", labelRu: "шт", labelKg: "даана" },
    { code: "кг", labelRu: "кг", labelKg: "кг" },
    { code: "л", labelRu: "л", labelKg: "л" },
    { code: "м", labelRu: "м", labelKg: "м" },
  ];

  const results = await Promise.all(
    units.map((unit) =>
      prisma.unit.upsert({
        where: { organizationId_code: { organizationId: orgId, code: unit.code } },
        update: {
          labelRu: unit.labelRu,
          labelKg: unit.labelKg,
        },
        create: {
          organizationId: orgId,
          code: unit.code,
          labelRu: unit.labelRu,
          labelKg: unit.labelKg,
        },
      }),
    ),
  );

  return new Map(results.map((unit) => [unit.code, unit]));
};

const upsertStores = async (orgId: string): Promise<Store[]> =>
  Promise.all([
    prisma.store.upsert({
      where: { organizationId_code: { organizationId: orgId, code: "DTW" } },
      update: {
        name: "Downtown Store",
        allowNegativeStock: false,
        legalEntityType: LegalEntityType.IP,
        legalName: "IP Akylbekov",
        inn: "123456789012",
        address: "Bishkek, Chui Ave 123",
        phone: "+996-555-010-200",
      },
      create: {
        organizationId: orgId,
        name: "Downtown Store",
        code: "DTW",
        allowNegativeStock: false,
        legalEntityType: LegalEntityType.IP,
        legalName: "IP Akylbekov",
        inn: "123456789012",
        address: "Bishkek, Chui Ave 123",
        phone: "+996-555-010-200",
      },
    }),
    prisma.store.upsert({
      where: { organizationId_code: { organizationId: orgId, code: "AIR" } },
      update: { name: "Airport Store", allowNegativeStock: true },
      create: {
        organizationId: orgId,
        name: "Airport Store",
        code: "AIR",
        allowNegativeStock: true,
      },
    }),
  ]);

const upsertProducts = async (
  orgId: string,
  supplierId: string,
  unitMap: Map<string, { id: string }>,
) => {
  const baseUnit = unitMap.get("шт");
  if (!baseUnit) {
    throw new Error("Base unit 'шт' is missing");
  }
  const products: Product[] = [];
  for (let i = 1; i <= 20; i += 1) {
    const sku = `SKU-${String(i).padStart(3, "0")}`;
    const product = await prisma.product.upsert({
      where: { organizationId_sku: { organizationId: orgId, sku } },
      update: {
        name: `Product ${i}`,
        category: i % 3 === 0 ? "Snacks" : i % 3 === 1 ? "Beverages" : "Household",
        unit: "шт",
        baseUnitId: baseUnit.id,
        description: `Sample description for Product ${i}.`,
        photoUrl: null,
        supplierId,
        isDeleted: false,
      },
      create: {
        organizationId: orgId,
        supplierId,
        sku,
        name: `Product ${i}`,
        category: i % 3 === 0 ? "Snacks" : i % 3 === 1 ? "Beverages" : "Household",
        unit: "шт",
        baseUnitId: baseUnit.id,
        description: `Sample description for Product ${i}.`,
        photoUrl: null,
      },
    });
    await prisma.productBarcode.upsert({
      where: { organizationId_value: { organizationId: orgId, value: `00000${i}` } },
      update: { productId: product.id },
      create: { organizationId: orgId, productId: product.id, value: `00000${i}` },
    });
    if (i <= 3) {
      const existingVariant = await prisma.productVariant.findFirst({
        where: { productId: product.id, name: "Size M" },
      });
      if (!existingVariant) {
        await prisma.productVariant.create({
          data: {
            productId: product.id,
            name: "Size M",
            sku: `${sku}-M`,
            attributes: { size: "M" },
          },
        });
      }
    }
    products.push(product);
  }
  return products;
};

const seedStockMovements = async (stores: Store[], products: Product[], adminUser: User, staffUser: User) => {
  const existingSeedMovement = await prisma.stockMovement.findFirst({
    where: {
      referenceType: "INITIAL",
      referenceId: "seed",
      storeId: { in: stores.map((store) => store.id) },
    },
  });

  if (existingSeedMovement) {
    return;
  }

  const rng = seededRandom(42);
  const movements: {
    storeId: string;
    productId: string;
    type: StockMovementType;
    qtyDelta: number;
    createdAt: Date;
    createdById: string;
    referenceType?: string;
    referenceId?: string;
    note?: string;
  }[] = [];

  const seedStart = new Date();
  seedStart.setDate(seedStart.getDate() - 35);

  for (const store of stores) {
    for (const product of products) {
      movements.push({
        storeId: store.id,
        productId: product.id,
        type: StockMovementType.RECEIVE,
        qtyDelta: 100,
        createdAt: seedStart,
        createdById: adminUser.id,
        referenceType: "INITIAL",
        referenceId: "seed",
        note: "Initial stock",
      });
    }
  }

  for (let day = 30; day >= 1; day -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - day);
    for (const store of stores) {
      for (const product of products.slice(0, 10)) {
        const qty = Math.max(1, Math.floor(rng() * 5));
        movements.push({
          storeId: store.id,
          productId: product.id,
          type: StockMovementType.SALE,
          qtyDelta: -qty,
          createdAt: date,
          createdById: staffUser.id,
          referenceType: "SALE",
          referenceId: `seed-${day}`,
        });
      }
    }
  }

  await prisma.stockMovement.createMany({ data: movements });
};

const seedPurchaseOrder = async (
  orgId: string,
  store: Store,
  supplierId: string,
  adminUser: User,
  products: Product[],
) => {
  const existing = await prisma.purchaseOrder.findFirst({
    where: {
      organizationId: orgId,
      storeId: store.id,
      supplierId,
      status: PurchaseOrderStatus.SUBMITTED,
    },
  });

  if (existing) {
    return existing;
  }

  return prisma.purchaseOrder.create({
    data: {
      organizationId: orgId,
      storeId: store.id,
      supplierId,
      status: PurchaseOrderStatus.SUBMITTED,
      submittedAt: new Date(),
      createdById: adminUser.id,
      updatedById: adminUser.id,
      lines: {
        create: products.slice(0, 3).map((product, index) => ({
          productId: product.id,
          qtyOrdered: 25 + index * 10,
          unitCost: 12.5 + index,
        })),
      },
    },
  });
};

const refreshInventorySnapshots = async (stores: Store[], products: Product[]) => {
  const storeIds = stores.map((store) => store.id);
  const productIds = products.map((product) => product.id);

  const movementAggregates = await prisma.stockMovement.groupBy({
    by: ["storeId", "productId", "variantId"],
    where: { storeId: { in: storeIds }, productId: { in: productIds } },
    _sum: { qtyDelta: true },
  });

  const movementTotals = new Map<string, number>();
  for (const row of movementAggregates) {
    const variantKey = row.variantId ?? "BASE";
    const key = `${row.storeId}:${row.productId}:${variantKey}`;
    movementTotals.set(key, row._sum?.qtyDelta ?? 0);
  }

  const openPoLines = await prisma.purchaseOrderLine.findMany({
    where: {
      purchaseOrder: {
        status: { in: [PurchaseOrderStatus.SUBMITTED, PurchaseOrderStatus.APPROVED] },
        storeId: { in: storeIds },
      },
    },
    include: { purchaseOrder: true },
  });

  const onOrderTotals = new Map<string, number>();
  for (const line of openPoLines) {
    const remaining = line.qtyOrdered - line.qtyReceived;
    if (remaining <= 0) {
      continue;
    }
    const variantKey = line.variantId ?? "BASE";
    const key = `${line.purchaseOrder.storeId}:${line.productId}:${variantKey}`;
    onOrderTotals.set(key, (onOrderTotals.get(key) ?? 0) + remaining);
  }

  for (const store of stores) {
    for (const product of products) {
      const key = `${store.id}:${product.id}:BASE`;
      await prisma.inventorySnapshot.upsert({
        where: {
          storeId_productId_variantKey: {
            storeId: store.id,
            productId: product.id,
            variantKey: "BASE",
          },
        },
        update: {
          onHand: movementTotals.get(key) ?? 0,
          onOrder: onOrderTotals.get(key) ?? 0,
          allowNegativeStock: store.allowNegativeStock,
        },
        create: {
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
          onHand: movementTotals.get(key) ?? 0,
          onOrder: onOrderTotals.get(key) ?? 0,
          allowNegativeStock: store.allowNegativeStock,
        },
      });
    }
  }
};

const seedForecasts = async (storeId: string, products: Product[]) => {
  const productIds = products.slice(0, 8).map((product) => product.id);
  const existing = await prisma.forecastSnapshot.findMany({
    where: { storeId, productId: { in: productIds } },
    select: { productId: true },
  });
  const existingSet = new Set(existing.map((forecast) => forecast.productId));

  const forecasts = products.slice(0, 8)
    .filter((product) => !existingSet.has(product.id))
    .map((product, index) => ({
      storeId,
      productId: product.id,
      p50Daily: 3 + (index % 3),
      p90Daily: 5 + (index % 4),
      horizonDays: 14,
    }));

  if (forecasts.length) {
    await prisma.forecastSnapshot.createMany({ data: forecasts });
  }
};

const main = async () => {
  await ensureInventoryConstraints();

  const org = await getOrCreateOrganization();

  const [adminUser, managerUser, staffUser] = await Promise.all([
    getOrCreateUser(org, {
      email: "admin@example.com",
      name: "Admin User",
      role: Role.ADMIN,
      password: "Admin123!",
      isOrgOwner: true,
    }),
    getOrCreateUser(org, {
      email: "manager@example.com",
      name: "Manager User",
      role: Role.MANAGER,
      password: "Manager123!",
    }),
    getOrCreateUser(org, {
      email: "staff@example.com",
      name: "Staff User",
      role: Role.STAFF,
      password: "Staff123!",
    }),
  ]);

  await getOrCreateUser(org, {
    email: PLATFORM_OWNER_EMAIL,
    name: PLATFORM_OWNER_NAME,
    role: Role.ADMIN,
    password: PLATFORM_OWNER_PASSWORD,
  });

  const stores = await upsertStores(org.id);
  const [storeA] = stores;

  const unitMap = await ensureUnits(org.id);
  const supplier = await getOrCreateSupplier(org.id);
  const products = await upsertProducts(org.id, supplier.id, unitMap);

  await Promise.all(
    products.slice(0, 8).map((product, index) =>
      prisma.reorderPolicy.upsert({
        where: { storeId_productId: { storeId: storeA.id, productId: product.id } },
        update: {
          minStock: 15 + (index % 4) * 5,
          leadTimeDays: 5 + (index % 3),
          reviewPeriodDays: 7,
          safetyStockDays: 2,
          minOrderQty: 10,
        },
        create: {
          storeId: storeA.id,
          productId: product.id,
          minStock: 15 + (index % 4) * 5,
          leadTimeDays: 5 + (index % 3),
          reviewPeriodDays: 7,
          safetyStockDays: 2,
          minOrderQty: 10,
        },
      }),
    ),
  );

  await seedStockMovements(stores, products, adminUser, staffUser);
  await seedPurchaseOrder(org.id, storeA, supplier.id, adminUser, products);
  await refreshInventorySnapshots(stores, products);
  await seedForecasts(storeA.id, products);

  const existingAudit = await prisma.auditLog.findFirst({
    where: { organizationId: org.id, action: "SEED", requestId: "seed" },
  });
  if (!existingAudit) {
    await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        actorId: adminUser.id,
        action: "SEED",
        entity: "Seed",
        entityId: org.id,
        before: Prisma.DbNull,
        after: { message: "Initial seed completed" },
        requestId: "seed",
      },
    });
  }

  console.log("Seed complete");
};

main()
  .catch(async (error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

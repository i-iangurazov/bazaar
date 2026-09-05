import { mkdir, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { stabilizationEnvironment, assertStabilizationDatabase } from "./environment";

Object.assign(process.env, stabilizationEnvironment());
assertStabilizationDatabase();
const { createCommerceFixtures } = await import("../../tests/stabilization/fixtures");
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
try {
  const fixture = await createCommerceFixtures(db);
  const tenant = fixture.tenants.a;
  const unit = await db.unit.create({
    data: { organizationId: tenant.org.id, code: "each", labelRu: "Штука", labelKg: "Даана" },
  });
  const supplier = await db.supplier.create({
    data: { organizationId: tenant.org.id, name: "Synthetic supplier", email: "supplier@example.invalid" },
  });
  for (let index = 1; index <= 30; index++) {
    const product = await db.product.create({
      data: {
        organizationId: tenant.org.id, baseUnitId: unit.id, unit: unit.code,
        supplierId: supplier.id, sku: `SYNTHETIC-${String(index).padStart(3, "0")}`,
        name: `Синтетический товар ${index} — длинное название для проверки интерфейса`,
        basePriceKgs: index * 100,
      },
    });
    await db.storeProduct.create({
      data: { organizationId: tenant.org.id, productId: product.id, storeId: tenant.stores[0].id },
    });
  }
  await db.customer.createMany({
    data: [1, 2].map((index) => ({
      organizationId: tenant.org.id, storeId: tenant.stores[0].id,
      name: `Synthetic customer ${index}`, email: `customer-${index}@example.invalid`,
      address: "Synthetic address",
    })),
  });
  const directory = "artifacts/bazaar-stabilization";
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/browser-fixture.json`, JSON.stringify({
    syntheticOnly: true, database: "127.0.0.1:55432/bazaar_hardening_ci",
    password: fixture.password,
    organizationId: tenant.org.id,
    stores: tenant.stores.map(({ id, name }) => ({ id, name })),
    users: Object.fromEntries(Object.entries(tenant.users).map(([role, user]) => [role, { id: user.id, email: user.email }])),
  }, null, 2));
  console.log("Created synthetic browser metadata and all roles; no stock, receipt or provider operations.");
} finally { await db.$disconnect(); }

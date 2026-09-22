import { writeFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { seedBase } from "../../tests/helpers/db";
import { createTestCaller } from "../../tests/helpers/context";
import { prisma } from "../../src/server/db/prisma";
const url = new URL(process.env.DATABASE_URL ?? "");
if (url.hostname !== "127.0.0.1" || url.port !== "55432" || url.pathname !== "/bazaar_hardening_ci")
  throw new Error("Isolated local DB required");
const { org, store, adminUser, baseUnit, product } = await seedBase({
  plan: "BUSINESS",
  allowNegativeStock: true,
});
await prisma.user.update({
  where: { id: adminUser.id },
  data: { passwordHash: await bcrypt.hash("sept22-local-only", 10) },
});
const register = await prisma.posRegister.create({
  data: { organizationId: org.id, storeId: store.id, name: "QA register", code: "QA" },
});
const caller = createTestCaller({ ...adminUser, organizationId: org.id });
await caller.pos.shifts.open({
  registerId: register.id,
  openingCashKgs: 0,
  idempotencyKey: "sept22-qa-shift",
});
await prisma.product.createMany({
  data: Array.from({ length: 999 }, (_, i) => ({
    id: `sept22-product-${i}`,
    organizationId: org.id,
    baseUnitId: baseUnit.id,
    unit: "each",
    sku: `QA-${i}`,
    name: `Кисточка ${String(i).padStart(4, "0")}`,
    basePriceKgs: 100,
    category: "Кисточки",
  })),
});
await prisma.storeProduct.createMany({
  data: Array.from({ length: 999 }, (_, i) => ({
    organizationId: org.id,
    storeId: store.id,
    productId: `sept22-product-${i}`,
  })),
});
await prisma.productBarcode.create({
  data: { organizationId: org.id, productId: product.id, value: "0123456789012" },
});
writeFileSync(
  "/private/tmp/bazaar-qa-fixture.json",
  JSON.stringify({
    orgId: org.id,
    storeId: store.id,
    registerId: register.id,
    productId: product.id,
    baseUnitId: baseUnit.id,
  }),
);
await prisma.$disconnect();

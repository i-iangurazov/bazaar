import { stockAuditEnvironment, assertStockAuditDatabase } from "./environment";
import { readFile, writeFile } from "node:fs/promises";
Object.assign(process.env, stockAuditEnvironment());
assertStockAuditDatabase();
const { prisma } = await import("../../src/server/db/prisma");
const { receiveStock } = await import("../../src/server/services/inventory");
const path = "artifacts/bazaar-stock-audit/fixture.json";
const fixture = JSON.parse(await readFile(path, "utf8"));
const identity = { organizationId: fixture.organizationId, storeId: fixture.storeId };
try {
  const original = await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } });
  for (let index = 0; index < 27; index += 1) {
    const sku = `QA-PAGE-${String(index).padStart(2, "0")}`;
    const product = await prisma.product.upsert({
      where: { organizationId_sku: { organizationId: fixture.organizationId, sku } },
      update: {},
      create: {
        organizationId: fixture.organizationId,
        sku,
        name: `A Audit ${String(index).padStart(2, "0")}`,
        unit: original.unit,
        baseUnitId: original.baseUnitId,
        basePriceKgs: 100,
      },
    });
    await receiveStock({
      ...identity,
      productId: product.id,
      actorId: fixture.adminId,
      qtyReceived: 1,
      unitCost: 0,
      requestId: sku,
      idempotencyKey: sku,
    });
  }
  const product = await prisma.product.upsert({
    where: { organizationId_sku: { organizationId: fixture.organizationId, sku: "QA-VARIANT" } },
    update: {},
    create: {
      organizationId: fixture.organizationId,
      sku: "QA-VARIANT",
      name: "Variant Audit",
      unit: original.unit,
      baseUnitId: original.baseUnitId,
      basePriceKgs: 100,
    },
  });
  const variant =
    (await prisma.productVariant.findFirst({ where: { productId: product.id, name: "Blue" } })) ??
    (await prisma.productVariant.create({
      data: { productId: product.id, name: "Blue", attributes: {} },
    }));
  await receiveStock({
    ...identity,
    productId: product.id,
    actorId: fixture.adminId,
    qtyReceived: 2,
    unitCost: 0,
    requestId: "QA-VARIANT-BASE",
    idempotencyKey: "QA-VARIANT-BASE",
  });
  await receiveStock({
    ...identity,
    productId: product.id,
    variantId: variant.id,
    actorId: fixture.adminId,
    qtyReceived: 5,
    unitCost: 0,
    requestId: "QA-VARIANT-BLUE",
    idempotencyKey: "QA-VARIANT-BLUE",
  });
  await writeFile(
    path,
    JSON.stringify({ ...fixture, variantProductId: product.id, variantId: variant.id }, null, 2),
  );
  console.log("Pagination and variant fixtures ready");
} finally {
  await prisma.$disconnect();
}

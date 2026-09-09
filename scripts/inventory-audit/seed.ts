import { stockAuditEnvironment, assertStockAuditDatabase } from "./environment";
Object.assign(process.env, stockAuditEnvironment());
assertStockAuditDatabase();
const { prisma } = await import("../../src/server/db/prisma");
const { seedBase } = await import("../../tests/helpers/db");
const { default: bcrypt } = await import("bcryptjs");
const { receiveStock } = await import("../../src/server/services/inventory");
const { mkdir, writeFile } = await import("node:fs/promises");
try {
  // This database is disposable; seed only an empty database, never reset implicitly.
  if (await prisma.organization.count())
    throw new Error("Seed requires an empty stock-audit database");
  const base = await seedBase({ plan: "ENTERPRISE" });
  const passwordHash = await bcrypt.hash("InventoryAudit123!", 10);
  await prisma.user.updateMany({ where: { organizationId: base.org.id }, data: { passwordHash } });
  await prisma.userGuideState.createMany({
    data: [base.adminUser, base.managerUser, base.staffUser, base.cashierUser].map((user) => ({
      userId: user.id,
      completedToursJson: [],
      dismissedTipsJson: ["__guidance:tours_disabled__"],
    })),
  });
  await prisma.product.update({ where: { id: base.product.id }, data: { basePriceKgs: 100 } });
  const storeB = await prisma.store.create({
    data: {
      organizationId: base.org.id,
      name: "Audit Store B",
      code: "AUDIT-B",
    },
  });
  await receiveStock({
    storeId: base.store.id,
    productId: base.product.id,
    qtyReceived: 12,
    unitCost: 0,
    organizationId: base.org.id,
    actorId: base.adminUser.id,
    requestId: "audit-seed",
    idempotencyKey: "audit-seed-inventory",
  });
  await mkdir("artifacts/bazaar-stock-audit", { recursive: true });
  await writeFile(
    "artifacts/bazaar-stock-audit/fixture.json",
    JSON.stringify(
      {
        organizationId: base.org.id,
        storeId: base.store.id,
        storeBId: storeB.id,
        productId: base.product.id,
        adminId: base.adminUser.id,
        managerId: base.managerUser.id,
      },
      null,
      2,
    ),
  );
  console.log("Isolated inventory browser fixture ready");
} finally {
  await prisma.$disconnect();
  const { getRedisPublisher } = await import("../../src/server/redis");
  const publisher = getRedisPublisher();
  if (publisher) {
    try { await publisher.quit(); } finally { publisher.disconnect(); }
  }
}

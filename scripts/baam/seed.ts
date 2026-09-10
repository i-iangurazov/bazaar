import { baamTestEnvironment, assertBaamTestDatabase } from "./environment";
Object.assign(process.env, baamTestEnvironment());
assertBaamTestDatabase();
const { prisma } = await import("../../src/server/db/prisma");
const { seedBase } = await import("../../tests/helpers/db");
const { default: bcrypt } = await import("bcryptjs");
const { mkdir, writeFile } = await import("node:fs/promises");
try {
  if (await prisma.organization.count())
    throw new Error("BAAM seed only accepts an empty database");
  const base = await seedBase({ plan: "ENTERPRISE" });
  const passwordHash = await bcrypt.hash("BaamCompanion123!", 10);
  await prisma.user.updateMany({ where: { organizationId: base.org.id }, data: { passwordHash } });
  await prisma.organization.update({
    where: { id: base.org.id },
    data: { name: "BAAM Test Organization" },
  });
  await prisma.unit.update({
    where: { id: base.baseUnit.id },
    data: { code: "pcs", labelRu: "шт.", labelKg: "даана" },
  });
  await prisma.userGuideState.createMany({
    data: [base.adminUser, base.managerUser, base.staffUser, base.cashierUser].map((user) => ({
      userId: user.id,
      completedToursJson: [],
      dismissedTipsJson: ["__guidance:tours_disabled__"],
    })),
  });
  const otherStore = await prisma.store.create({
    data: { organizationId: base.org.id, name: "Ош", code: "OSH" },
  });
  await mkdir("artifacts/baam-companion", { recursive: true });
  await writeFile(
    "artifacts/baam-companion/fixture.json",
    JSON.stringify(
      {
        organizationId: base.org.id,
        storeId: base.store.id,
        otherStoreId: otherStore.id,
        productId: base.product.id,
        unitId: base.baseUnit.id,
        supplierId: base.supplier.id,
        adminId: base.adminUser.id,
        managerId: base.managerUser.id,
        staffId: base.staffUser.id,
        cashierId: base.cashierUser.id,
      },
      null,
      2,
    ),
  );
  console.log("Isolated BAAM fixture ready");
} finally {
  await prisma.$disconnect();
}

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { uxEnvironment, assertUxDatabase } from "./environment";
Object.assign(process.env, uxEnvironment());
assertUxDatabase();
const { prisma } = await import("../../src/server/db/prisma");
const { seedBase } = await import("../../tests/helpers/db");
const { businessCaller } = await import("../../src/server/services/baamBusiness");
const { getLogger } = await import("../../src/server/logging");
try {
  if (await prisma.organization.count())
    throw new Error("UI fixture only accepts an empty database");
  const f = await seedBase({ plan: "ENTERPRISE" });
  await prisma.organization.update({
    where: { id: f.org.id },
    data: { name: "UI QA · Базар Маркет" },
  });
  await prisma.store.update({
    where: { id: f.store.id },
    data: { name: "Бишкек · Центр", code: "BISH" },
  });
  await prisma.unit.update({
    where: { id: f.baseUnit.id },
    data: { labelRu: "шт.", labelKg: "даана" },
  });
  const passwordHash = await bcrypt.hash("BazaarUxTest123!", 10);
  await prisma.user.updateMany({ where: { organizationId: f.org.id }, data: { passwordHash } });
  await prisma.userGuideState.createMany({
    data: [f.adminUser, f.managerUser, f.staffUser, f.cashierUser].map((u) => ({
      userId: u.id,
      completedToursJson: [],
      dismissedTipsJson: ["__guidance:tours_disabled__"],
    })),
  });
  const otherStore = await prisma.store.create({
    data: { organizationId: f.org.id, name: "Ош · Южный", code: "OSH" },
  });
  await prisma.userStoreAccess.create({
    data: { organizationId: f.org.id, userId: f.managerUser.id, storeId: otherStore.id },
  });
  const emptyStore = await prisma.store.create({
    data: { organizationId: f.org.id, name: "Новый магазин", code: "NEW" },
  });
  await prisma.supplier.update({
    where: { id: f.supplier.id },
    data: {
      name: "Учебный поставщик «Ала-Тоо»",
      email: "supplier@example.invalid",
      phone: "+996 555 000 001",
    },
  });
  const ctx = {
    prisma,
    user: {
      id: f.adminUser.id,
      email: f.adminUser.email,
      role: f.adminUser.role,
      organizationId: f.org.id,
      isOrgOwner: true,
      isPlatformOwner: false,
    },
    impersonator: null,
    impersonationSessionId: null,
    ip: "127.0.0.1",
    requestId: randomUUID(),
    logger: getLogger("ux-fixture"),
  };
  const api = businessCaller(ctx);
  const names = [
    "Чай чёрный листовой, 100 г",
    "Кофе молотый арабика, 250 г",
    "Рис длиннозёрный, 1 кг",
    "Шоколад тёмный 70%, 90 г",
    "Кружка керамическая с крышкой и ситечком, коллекция «Горы Кыргызстана», 450 мл",
    "Блокнот A5 в твёрдом переплёте",
    "Вода питьевая, 1 л",
    "Мёд цветочный, 500 г",
  ];
  const categories = ["Бакалея", "Напитки", "Товары для дома", "Канцелярия"];
  const products = [];
  for (let i = 0; i < 144; i++) {
    const category = categories[i % categories.length];
    const product = await prisma.product.create({
      data: {
        organizationId: f.org.id,
        supplierId: f.supplier.id,
        sku: `UX-${String(i + 1).padStart(4, "0")}`,
        name: `${names[i % names.length]}${i >= names.length ? ` · серия ${Math.floor(i / names.length) + 1}` : ""}`,
        category,
        categories: [category],
        unit: f.baseUnit.code,
        baseUnitId: f.baseUnit.id,
        basePriceKgs: i % 23 === 0 ? null : 95 + i * 13.5,
        description: "Изолированные учебные данные для проверки интерфейса Bazaar.",
      },
    });
    await prisma.storeProduct.create({
      data: { organizationId: f.org.id, storeId: f.store.id, productId: product.id },
    });
    if (i % 5 !== 0)
      await prisma.productBarcode.create({
        data: {
          organizationId: f.org.id,
          productId: product.id,
          value: `2900000${String(i + 1).padStart(6, "0")}`,
        },
      });
    products.push(product);
  }
  for (let i = 0; i < products.length; i += 36)
    await api.inventory.postStockReceiving({
      storeId: f.store.id,
      supplierName: "Учебный поставщик «Ала-Тоо»",
      note: "Изолированное учебное поступление",
      lines: products
        .slice(i, i + 36)
        .map((p, n) => ({ productId: p.id, quantity: 5 + n, unitCost: 40 + n })),
      idempotencyKey: randomUUID(),
    });
  for (const product of products.slice(0, 6))
    await api.inventory.setMinStock({ storeId: f.store.id, productId: product.id, minStock: 30 });
  await api.inventory.adjust({
    storeId: f.store.id,
    productId: products[2].id,
    qtyDelta: -10,
    reason: "Изолированная проверка отрицательного остатка",
    idempotencyKey: randomUUID(),
  });
  await api.products.assignToStore({
    storeId: otherStore.id,
    productIds: products.slice(0, 8).map((p) => p.id),
  });
  await api.inventory.postStockReceiving({
    storeId: otherStore.id,
    note: "Учебное поступление в другой магазин",
    lines: products.slice(0, 8).map((p) => ({ productId: p.id, quantity: 12, unitCost: 30 })),
    idempotencyKey: randomUUID(),
  });
  for (let i = 0; i < 12; i++)
    await prisma.customer.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        name: `Учебный клиент ${i + 1}`,
        email: `customer-${i + 1}@example.invalid`,
        phone: `+996 555 000 ${String(i + 10).padStart(3, "0")}`,
      },
    });
  const purchase = await api.purchases.create({
    storeId: f.store.id,
    supplierId: f.supplier.id,
    lines: products.slice(0, 3).map((p) => ({ productId: p.id, qtyOrdered: 20, unitCost: 45 })),
    submit: true,
    idempotencyKey: randomUUID(),
  });
  const register = await api.pos.registers.create({
    storeId: f.store.id,
    name: "Учебная касса",
    code: "QA",
  });
  await api.pos.shifts.open({
    registerId: register.id,
    openingCashKgs: 0,
    idempotencyKey: randomUUID(),
  });
  const sale = await api.pos.sales.createDraft({
    registerId: register.id,
    lines: [{ productId: products[1].id, qty: 2 }],
    requireNewDraft: true,
  });
  const current = await api.pos.sales.get({ saleId: sale.id });
  await api.pos.sales.complete({
    saleId: sale.id,
    payments: [{ method: "CASH", amountKgs: Number(current!.totalKgs) }],
    idempotencyKey: randomUUID(),
  });
  await mkdir("artifacts/ux", { recursive: true });
  await writeFile(
    "artifacts/ux/fixture.json",
    JSON.stringify(
      {
        organizationId: f.org.id,
        storeId: f.store.id,
        otherStoreId: otherStore.id,
        emptyStoreId: emptyStore.id,
        adminId: f.adminUser.id,
        managerId: f.managerUser.id,
        staffId: f.staffUser.id,
        cashierId: f.cashierUser.id,
        productId: products[0].id,
        longProductId: products[4].id,
        unitId: f.baseUnit.id,
        supplierId: f.supplier.id,
        registerId: register.id,
        saleId: sale.id,
        purchase,
        products: products.map((p) => ({ id: p.id, name: p.name, sku: p.sku })),
      },
      null,
      2,
    ),
  );
  console.log("UI fixture ready: 3 stores, 4 roles, 144 products; isolated domain documents only.");
} finally {
  await prisma.$disconnect();
  // Domain operations publish inventory/POS events. Release that connection so
  // the fixture process exits and the browser orchestrator can continue.
  const { getRedisPublisher } = await import("../../src/server/redis");
  const publisher = getRedisPublisher();
  if (publisher) {
    try {
      await publisher.quit();
    } finally {
      publisher.disconnect();
    }
  }
}

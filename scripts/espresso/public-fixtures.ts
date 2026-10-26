/** Additive consumer QA fixtures, confined to an independent local organization. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { assertUxDatabase, uxEnvironment } from "../ux/environment";

assert.equal(process.env.UX_SUITE, "espresso");
Object.assign(process.env, uxEnvironment());
assertUxDatabase();
const { prisma } = await import("../../src/server/db/prisma");
const { applyEntry } = await import("../../src/server/services/loyalty/ledger");
try {
  let organization = await prisma.organization.findFirst({ where: { name: "UI QA · Espresso Public" } });
  if (!organization) organization = await prisma.organization.create({ data: { name: "UI QA · Espresso Public", plan: "ENTERPRISE" } });
  const organizationId = organization.id;
  let store = await prisma.store.findFirst({ where: { organizationId, code: "ESPPUBLIC" } });
  if (!store) store = await prisma.store.create({ data: { organizationId, code: "ESPPUBLIC", name: "Ала-Тоо · учебный магазин", currencyCode: "KGS" } });
  const unit = await prisma.unit.upsert({ where: { organizationId_code: { organizationId, code: "each" } }, update: {}, create: { organizationId, code: "each", labelRu: "шт.", labelKg: "даана" } });
  const products = [];
  for (let index = 1; index <= 26; index++) {
    const product = await prisma.product.upsert({
      where: { organizationId_sku: { organizationId, sku: `ESPPUBLIC-${index}` } }, update: {},
      create: { organizationId, sku: `ESPPUBLIC-${index}`, name: `${index <= 13 ? "Чай" : "Кружка"} · коллекция ${String(index).padStart(2, "0")}`, category: index <= 13 ? "Напитки" : "Для дома", unit: unit.code, baseUnitId: unit.id, basePriceKgs: 100 + index * 10 },
    });
    const existing = await prisma.storeProduct.findFirst({ where: { organizationId, storeId: store.id, productId: product.id } });
    if (!existing) await prisma.storeProduct.create({ data: { organizationId, storeId: store.id, productId: product.id, isActive: true } });
    products.push(product);
  }
  let variant = await prisma.productVariant.findFirst({ where: { productId: products[0].id } });
  if (!variant) variant = await prisma.productVariant.create({ data: { productId: products[0].id, name: "Зелёный · 100 г", attributes: { type: "green" } } });
  const catalog = await prisma.bazaarCatalog.upsert({
    where: { storeId: store.id }, update: {},
    create: { organizationId, storeId: store.id, status: "PUBLISHED", slug: "espresso-public-qa", publicUrlPath: "/c/espresso-public-qa", title: "Ала-Тоо · каталог", accentColor: "#2a6be4", fontFamily: "Inter", publishedAt: new Date() },
  });
  assert.equal(catalog.organizationId, organizationId);
  const program = await prisma.loyaltyProgram.upsert({
    where: { organizationId }, update: {},
    create: { organizationId, enabled: true, rulesText: "Учебная программа: скидка 5%, начисление 5%, 1 балл = 1 сом. Реальных покупок и списаний нет." },
  });
  const target = await prisma.loyaltyProgramStore.upsert({
    where: { programId_storeId: { programId: program.id, storeId: store.id } }, update: {},
    create: { organizationId, programId: program.id, storeId: store.id },
  });
  const email = "consumer@espresso.example.invalid";
  const member = await prisma.loyaltyMember.upsert({
    where: { programId_contactKey: { programId: program.id, contactKey: `email:${email}` } }, update: {},
    create: { organizationId, programId: program.id, contactKey: `email:${email}`, email, displayName: "Покупатель для проверки" },
  });
  const account = await prisma.loyaltyAccount.upsert({ where: { memberId: member.id }, update: {}, create: { organizationId, programId: program.id, memberId: member.id } });
  await prisma.$transaction((tx) => applyEntry(tx, { organizationId, programId: program.id, memberId: member.id, accountId: account.id, type: "ADJUSTMENT", points: 125, eventKey: "espresso-public-fixture-initial-balance", reason: "Isolated synthetic UI fixture" }));
  const evidence = { database: "bazaar_espresso_ui", organizationId, storeId: store.id, catalogSlug: catalog.slug, programStoreId: target.id, memberEmail: email, memberId: member.id, accountId: account.id, productIds: products.map((product) => product.id), variantId: variant.id, syntheticInitialPoints: 125 };
  await writeFile("artifacts/ux/espresso/public-fixtures.json", JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence));
} finally { await prisma.$disconnect(); }
